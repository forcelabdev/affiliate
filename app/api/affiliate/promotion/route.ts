import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { checkRateLimit, sanitizeStr, isValidObjectId, safeParse } from "@/lib/security"
import { neon } from "@neondatabase/serverless"
import mongoose from "mongoose"

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db && mongoose.connection.db.databaseName === "bizzocazino") return
  if (mongoose.connection.readyState === 1 && mongoose.connection.db && mongoose.connection.db.databaseName !== "bizzocazino") await mongoose.disconnect()
  const uri = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "bizzocazino", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
  if (!mongoose.connection.db) await new Promise<void>((r) => mongoose.connection.once("connected", () => r()))
}

// Periyot bazlı promosyon oranları
const PROMOTION_RATES: Record<string, number> = {
  daily:      15,  // Günlük %15
  weekly:     10,  // Haftalık %10
  monthly:     5,  // Aylık %5
  initiative:  0,  // Sabit tutar — oran uygulanmaz
}

/** MongoDB transaction'larından periyot bazlı dep/wit toplamını hesaplar */
async function calcPeriodAmounts(
  userObjId: mongoose.Types.ObjectId,
  promotionType: string,
  refDate: string,
  db: any
) {
  const forcelabTx = db.collection("forcelabfinancetransactions")
  const meeldevTx  = db.collection("meeldevtransactions")

  const periodEnd = new Date(`${refDate}T23:59:59+03:00`)
  let periodStart: Date

  if (promotionType === "daily") {
    periodStart = new Date(`${refDate}T00:00:00+03:00`)
  } else if (promotionType === "weekly") {
    const d = new Date(`${refDate}T00:00:00+03:00`)
    d.setDate(d.getDate() - 6)
    periodStart = d
  } else { // monthly — 30 gün
    const d = new Date(`${refDate}T00:00:00+03:00`)
    d.setDate(d.getDate() - 29)
    periodStart = d
  }

  const approvedStatuses = ["approved", "completed", "success", "confirmed"]
  const notBonusFilter = { providerName: { $not: { $regex: /bonus/i } }, providerSlug: { $not: { $regex: /bonus/i } } }
  const [fDeps, fWits, mDeps, mWits] = await Promise.all([
    forcelabTx.find({ user: userObjId, providerType: "deposit",                          status: { $in: approvedStatuses }, createdAt: { $gte: periodStart, $lte: periodEnd }, ...notBonusFilter }, { projection: { amount: 1 } }).toArray(),
    forcelabTx.find({ user: userObjId, providerType: { $in: ["withdraw","withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: periodStart, $lte: periodEnd } }, { projection: { amount: 1 } }).toArray(),
    meeldevTx.find(  { user: userObjId, type: "deposit",                                 status: { $in: approvedStatuses }, createdAt: { $gte: periodStart, $lte: periodEnd }, ...notBonusFilter }, { projection: { amount: 1 } }).toArray(),
    meeldevTx.find(  { user: userObjId, type: { $in: ["withdraw","withdrawal"] },        status: { $in: approvedStatuses }, createdAt: { $gte: periodStart, $lte: periodEnd } }, { projection: { amount: 1 } }).toArray(),
  ])

  const dep = [...fDeps, ...mDeps].reduce((s: number, t: any) => s + (t.amount ?? 0), 0)
  const wit = [...fWits, ...mWits].reduce((s: number, t: any) => s + (t.amount ?? 0), 0)
  return { dep, wit, net: dep - wit }
}

// İnsiyatif bonus eşikleri: minimum toplam yatırım → max bonus tutarı
const INITIATIVE_TIERS: { minDeposit: number; amount: number }[] = [
  { minDeposit:  5_000, amount:   500 },
  { minDeposit: 10_000, amount: 1_000 },
  { minDeposit: 15_000, amount: 1_500 },
  { minDeposit: 20_000, amount: 2_000 },
]
const INITIATIVE_AMOUNTS = INITIATIVE_TIERS.map(t => t.amount)

/** Üyenin tüm zamanki toplam yatırımını hesaplar (bonus hariç) */
async function getTotalDeposit(userObjId: mongoose.Types.ObjectId, db: any): Promise<number> {
  const forcelabTx = db.collection("forcelabfinancetransactions")
  const meeldevTx  = db.collection("meeldevtransactions")
  const approvedStatuses = ["approved", "completed", "success", "confirmed"]
  const notBonusFilter = { providerName: { $not: { $regex: /bonus/i } }, providerSlug: { $not: { $regex: /bonus/i } } }
  const [fDeps, mDeps] = await Promise.all([
    forcelabTx.find({ user: userObjId, providerType: "deposit", status: { $in: approvedStatuses }, ...notBonusFilter }, { projection: { amount: 1 } }).toArray(),
    meeldevTx.find(  { user: userObjId, type: "deposit",        status: { $in: approvedStatuses }, ...notBonusFilter }, { projection: { amount: 1 } }).toArray(),
  ])
  return [...fDeps, ...mDeps].reduce((s: number, t: any) => s + (t.amount ?? 0), 0)
}

/** Toplam yatıırma göre tanımlanabilecek max insiyatif tutarını döner (0 = hiç yok) */
function maxInitiativeAmount(totalDeposit: number): number {
  let max = 0
  for (const tier of INITIATIVE_TIERS) {
    if (totalDeposit >= tier.minDeposit) max = tier.amount
  }
  return max
}

// ─── POST: Promosyon tanımla ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, 20, 5 * 60 * 1000, "promo-post")
  if (rl) return rl

  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  const isAllowed = ["partner", "admin", "superadmin"].includes(session.role)
  if (!isAllowed) {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  const parsed = await safeParse<Record<string, unknown>>(req)
  if ("error" in parsed) return parsed.error
  const body = parsed.data

  const memberId       = sanitizeStr(body.memberId, 24)
  const memberUsername = sanitizeStr(body.memberUsername, 100)
  const partnerId      = body.partnerId ? Number(body.partnerId) : 0
  const partnerName    = sanitizeStr(body.partnerName, 100)
  const refDate        = sanitizeStr(body.refDate, 10)
  const note           = sanitizeStr(body.note, 300)
  const promotionType  = sanitizeStr(body.promotionType, 20) || "daily"
  // initiative için client'tan gelen sabit tutar (sadece INITIATIVE_AMOUNTS değerlerinden biri kabul edilir)
  const initiativeAmountRaw = body.initiativeAmount ? Number(body.initiativeAmount) : 0

  if (!memberId || !memberUsername || !partnerName || !refDate) {
    return NextResponse.json({ success: false, message: "Eksik parametre." }, { status: 400 })
  }
  if (!["daily", "weekly", "monthly", "initiative"].includes(promotionType)) {
    return NextResponse.json({ success: false, message: "Geçersiz promosyon tipi." }, { status: 400 })
  }
  if (!isValidObjectId(memberId)) {
    return NextResponse.json({ success: false, message: "Geçersiz üye ID." }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(refDate)) {
    return NextResponse.json({ success: false, message: "Geçersiz tarih formatı." }, { status: 400 })
  }

  // Initiative için tutar doğrulaması
  if (promotionType === "initiative" && !INITIATIVE_AMOUNTS.includes(initiativeAmountRaw)) {
    return NextResponse.json({ success: false, message: `Geçersiz insiyatif tutarı. İzin verilenler: ${INITIATIVE_AMOUNTS.join(", ")}₺` }, { status: 400 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi. Lütfen tekrar deneyin." }, { status: 500 })
  const sql = neon(dbUrl)

  // partnerId yoksa Neon'dan çek
  let resolvedPartnerId: number = partnerId ? Number(partnerId) : 0
  if (!resolvedPartnerId && session.role === "partner" && session.refCode) {
    const rows = await sql`SELECT id FROM affiliate_users WHERE ref_code = ${session.refCode} LIMIT 1`
    resolvedPartnerId = rows?.[0]?.id ?? 0
  }
  if (!resolvedPartnerId && partnerName) {
    const rows = await sql`SELECT id FROM affiliate_users WHERE username = ${partnerName} LIMIT 1`
    resolvedPartnerId = rows?.[0]?.id ?? 0
  }
  if (!resolvedPartnerId) {
    return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 400 })
  }

  // Partner kısıtı
  if (session.role === "partner") {
    const rows = await sql`SELECT id FROM affiliate_users WHERE ref_code = ${session.refCode} LIMIT 1`
    const ownId = rows?.[0]?.id
    if (!ownId || String(ownId) !== String(resolvedPartnerId)) {
      return NextResponse.json({ success: false, message: "Yalnızca kendi üyenize promosyon tanımlayabilirsiniz." }, { status: 403 })
    }
  }

  await connectDB()
  const db         = mongoose.connection.db!
  const usersCol   = db.collection("users")
  const adjustCol  = db.collection("adminmanualadjustments")
  const forcelabTx = db.collection("forcelabfinancetransactions")
  const meeldevTx  = db.collection("meeldevtransactions")

  let userObjId: mongoose.Types.ObjectId
  try { userObjId = new mongoose.Types.ObjectId(memberId) }
  catch { return NextResponse.json({ success: false, message: "Geçersiz üye ID." }, { status: 400 }) }

  // ── Promosyon tutarını hesapla ────────────────────────────────────────────
  let promoAmount = 0
  let dep = 0, wit = 0, net = 0
  const rate = PROMOTION_RATES[promotionType] ?? 0

  if (promotionType === "initiative") {
    // 1) Üyenin toplam yatırımını çek ve eşik kontrolü yap
    const totalDeposit = await getTotalDeposit(userObjId, db)
    if (totalDeposit <= 0) {
      return NextResponse.json({ success: false, message: "Bu üyenin hiç yatırımı yok, insiyatif bonusu tanımlanamaz." }, { status: 400 })
    }
    const maxAllowed = maxInitiativeAmount(totalDeposit)
    if (maxAllowed === 0) {
      return NextResponse.json({ success: false, message: `Toplam yatırım (₺${totalDeposit.toLocaleString("tr-TR")}) minimum eşiği karşılamıyor. En az ₺5.000 yatırım gerekli.` }, { status: 400 })
    }
    if (initiativeAmountRaw > maxAllowed) {
      return NextResponse.json({ success: false, message: `Toplam yatırım (₺${totalDeposit.toLocaleString("tr-TR")}) için maksimum insiyatif tutarı ₺${maxAllowed.toLocaleString("tr-TR")}.` }, { status: 400 })
    }

    promoAmount = initiativeAmountRaw

    // 2) Haftada 1 kez kontrol
    const weekAgo = new Date(refDate)
    weekAgo.setDate(weekAgo.getDate() - 6)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)
    const initiativeCheck = await sql`
      SELECT id FROM promotion_logs
      WHERE member_id = ${memberId}
        AND promotion_type = 'initiative'
        AND ref_date BETWEEN ${weekAgoStr} AND ${refDate}
      LIMIT 1
    `
    if (initiativeCheck.length > 0) {
      return NextResponse.json({ success: false, message: "Bu üyeye bu hafta zaten insiyatif bonusu tanımlandı." }, { status: 409 })
    }
  } else {
    // Periyot bazlı tutarları MongoDB'den hesapla
    ;({ dep, wit, net } = await calcPeriodAmounts(userObjId, promotionType, refDate, db))
    promoAmount = net > 0 ? parseFloat(((net * rate) / 100).toFixed(2)) : 0

    if (promoAmount <= 0) {
      return NextResponse.json({ success: false, message: `Net tutar 0 veya negatif (yatırım: ₺${dep}, çekim: ₺${wit}), promosyon tanımlanamaz.` }, { status: 400 })
    }

    // Tekrar tanımlama engeli — periyot tipine göre pencere belirlenir
    let dupError: string | null = null

    if (promotionType === "daily") {
      // Günlük: aynı gün içinde bir kez
      const dup = await sql`
        SELECT id FROM promotion_logs
        WHERE member_id = ${memberId} AND promotion_type = 'daily' AND ref_date = ${refDate}
        LIMIT 1
      `
      if (dup.length > 0) dupError = "Bu üyeye bugün zaten günlük promosyon tanımlandı."

    } else if (promotionType === "weekly") {
      // Haftalık: ref_date'in içinde bulunduğu ISO haftasında bir kez
      // Haftanın Pazartesi gününü bul
      const d = new Date(`${refDate}T00:00:00+03:00`)
      const day = d.getDay() === 0 ? 7 : d.getDay() // 0=Pazar → 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - (day - 1))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const monStr = monday.toISOString().slice(0, 10)
      const sunStr = sunday.toISOString().slice(0, 10)
      const dup = await sql`
        SELECT id FROM promotion_logs
        WHERE member_id = ${memberId} AND promotion_type = 'weekly'
          AND ref_date BETWEEN ${monStr} AND ${sunStr}
        LIMIT 1
      `
      if (dup.length > 0) dupError = `Bu üyeye bu hafta (${monStr} – ${sunStr}) zaten haftalık promosyon tanımlandı.`

    } else if (promotionType === "monthly") {
      // Aylık: ref_date'in yıl-ay'ında bir kez
      const yearMonth = refDate.slice(0, 7) // "YYYY-MM"
      const monthStart = `${yearMonth}-01`
      // Ayın son gününü hesapla
      const [y, m] = yearMonth.split("-").map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`
      const dup = await sql`
        SELECT id FROM promotion_logs
        WHERE member_id = ${memberId} AND promotion_type = 'monthly'
          AND ref_date BETWEEN ${monthStart} AND ${monthEnd}
        LIMIT 1
      `
      if (dup.length > 0) dupError = `Bu üyeye ${yearMonth.replace("-", " ")} ayında zaten aylık promosyon tanımlandı.`
    }

    if (dupError) {
      return NextResponse.json({ success: false, message: dupError }, { status: 409 })
    }
  }

  // Neon'a kaydet
  await sql`
    INSERT INTO promotion_logs
      (partner_id, partner_name, member_id, member_username, ref_date,
       total_deposit, total_withdraw, net_amount, promotion_rate, promotion_amount,
       applied_by, note, promotion_type)
    VALUES
      (${resolvedPartnerId}, ${partnerName}, ${memberId}, ${memberUsername}, ${refDate},
       ${dep}, ${wit}, ${net}, ${rate}, ${promoAmount},
       ${session.username ?? session.role}, ${note ?? null}, ${promotionType})
  `

  // MongoDB bakiye güncelle
  try {
    const userDoc = await usersCol.findOne({ _id: userObjId }, { projection: { _id: 1, wallets: 1 } })
    if (!userDoc) throw new Error(`Kullanıcı bulunamadı: ${memberId}`)

    const rivoWallet = (userDoc.wallets ?? []).find((w: any) => w.coinType === "Rivo")
    const balBefore  = rivoWallet?.balance ?? 0
    const balAfter   = balBefore + promoAmount

    if (rivoWallet) {
      await usersCol.updateOne({ _id: userObjId, "wallets.coinType": "Rivo" }, { $inc: { "wallets.$.balance": promoAmount } })
    } else {
      await usersCol.updateOne({ _id: userObjId }, { $push: { wallets: { coinType: "Rivo", balance: promoAmount, chain: "TRON", type: "trc-20" } } } as any)
    }

    const typeLabel: Record<string, string> = { daily: "Günlük", weekly: "Haftalık", monthly: "Aylık", initiative: "İnsiyatif" }
    await adjustCol.insertOne({
      actorUser: null, targetUser: userObjId, kind: "Rivo", direction: "credit",
      category: "PARTNER_PROMOTION",
      note: `${typeLabel[promotionType] ?? ""} partner promosyon (${partnerName}) — ${refDate}`,
      requestedAmount: promoAmount, appliedAmount: promoAmount,
      balanceBefore: balBefore, balanceAfter: balAfter,
      source: "partner_promotion", promotionType,
      createdAt: new Date(), updatedAt: new Date(),
    })
  } catch (e: any) {
    console.error("[promotion] MongoDB balance update failed:", e?.message ?? e)
    return NextResponse.json({ success: false, message: `Promosyon kaydedildi fakat bakiye güncellenemedi: ${e?.message ?? "Bilinmeyen hata"}` })
  }

  const typeLabel: Record<string, string> = { daily: "Günlük", weekly: "Haftalık", monthly: "Aylık", initiative: "İnsiyatif" }
  return NextResponse.json({
    success: true, promoAmount,
    message: `${typeLabel[promotionType] ?? ""} ₺${promoAmount.toLocaleString("tr-TR")} promosyon başarıyla tanımlandı.`,
  })
}

// ─── GET: Preview (preview=1) veya Promosyon geçmişi ─────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // ?preview=1&memberId=...&promotionType=...&refDate=...
  if (searchParams.get("preview") === "1") {
    const auth = await requireAuth(req)
    if (auth.error) return auth.error

    const memberId      = sanitizeStr(searchParams.get("memberId"), 24)
    const promotionType = sanitizeStr(searchParams.get("promotionType"), 20) || "daily"
    const refDate       = sanitizeStr(searchParams.get("refDate"), 10)

    if (!memberId || !refDate || !isValidObjectId(memberId)) {
      return NextResponse.json({ success: false, message: "Eksik veya geçersiz parametre." }, { status: 400 })
    }
    if (!["daily","weekly","monthly"].includes(promotionType)) {
      return NextResponse.json({ success: false, message: "Geçersiz promosyon tipi." }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(refDate)) {
      return NextResponse.json({ success: false, message: "Geçersiz tarih formatı." }, { status: 400 })
    }

    let userObjId: mongoose.Types.ObjectId
    try { userObjId = new mongoose.Types.ObjectId(memberId) }
    catch { return NextResponse.json({ success: false, message: "Geçersiz üye ID." }, { status: 400 }) }

    await connectDB()
    const db = mongoose.connection.db!
    const { dep, wit, net } = await calcPeriodAmounts(userObjId, promotionType, refDate, db)
    const rate = PROMOTION_RATES[promotionType] ?? 0
    const promoAmount = net > 0 ? parseFloat(((net * rate) / 100).toFixed(2)) : 0

    // Her preview çağrısında initiative eşiklerini de döndür
    const totalDeposit   = await getTotalDeposit(userObjId, db)
    const maxInitiative  = maxInitiativeAmount(totalDeposit)

    return NextResponse.json({ success: true, dep, wit, net, rate, promoAmount, totalDeposit, maxInitiative, initiativeTiers: INITIATIVE_TIERS })
  }

  // Geçmiş listesi
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  const isAdmin = session.role === "superadmin" || session.role === "admin"
  const isPartner = session.role === "partner"
  if (!isAdmin && !isPartner) {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi. Lütfen tekrar deneyin." }, { status: 500 })
  const sql = neon(dbUrl)

  const startDate = searchParams.get("startDate")
  const endDate   = searchParams.get("endDate")

  let rows: any[]

  if (isPartner) {
    // Partner: kendi partnerId'sine ait loglar
    const partnerRows = await sql`SELECT id FROM affiliate_users WHERE ref_code = ${session.refCode} LIMIT 1`
    const pid = partnerRows?.[0]?.id
    if (!pid) return NextResponse.json({ success: true, logs: [] })
    rows = startDate && endDate
      ? await sql`SELECT * FROM promotion_logs WHERE partner_id = ${pid} AND ref_date BETWEEN ${startDate} AND ${endDate} ORDER BY created_at DESC`
      : await sql`SELECT * FROM promotion_logs WHERE partner_id = ${pid} ORDER BY created_at DESC LIMIT 200`
  } else {
    rows = startDate && endDate
      ? await sql`SELECT * FROM promotion_logs WHERE ref_date BETWEEN ${startDate} AND ${endDate} ORDER BY created_at DESC`
      : await sql`SELECT * FROM promotion_logs ORDER BY created_at DESC LIMIT 500`
  }

  return NextResponse.json({ success: true, logs: rows })
}
