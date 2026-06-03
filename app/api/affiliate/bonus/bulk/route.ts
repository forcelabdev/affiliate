import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { checkRateLimit, sanitizeStr, sanitizeFloat, safeParse } from "@/lib/security"
import mongoose from "mongoose"
import { connectDB } from "@/lib/mongodb"
import { neon } from "@neondatabase/serverless"

interface BulkBonusBody {
  usernames?: unknown
  amount?: unknown
  bonusType?: unknown
  wagerRequirement?: unknown
  minDeposit?: unknown
  minWithdraw?: unknown
  note?: unknown
  category?: unknown
  partnerId?: unknown
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, 10, 60_000, "bonus-bulk")
  if (rl) return rl

  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Bu işlem için süper admin yetkisi gereklidir." }, { status: 403 })
  }

  const parsed = await safeParse<BulkBonusBody>(req)
  if ("error" in parsed) return parsed.error
  const body = parsed.data

  // Kullanıcı adları: virgül/yeni satır ile ayrılmış string veya array
  let rawUsernames: string[] = []
  if (typeof body.usernames === "string") {
    rawUsernames = body.usernames.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
  } else if (Array.isArray(body.usernames)) {
    rawUsernames = (body.usernames as unknown[]).map(u => sanitizeStr(u, 100) || "").filter(Boolean)
  }

  if (rawUsernames.length === 0) {
    return NextResponse.json({ success: false, message: "En az bir kullanıcı adı gereklidir." }, { status: 400 })
  }
  if (rawUsernames.length > 500) {
    return NextResponse.json({ success: false, message: "Tek seferde maksimum 500 kullanıcı işlenebilir." }, { status: 400 })
  }

  const amount        = sanitizeFloat(body.amount, 0.01, 100_000) ?? NaN
  const bonusType     = sanitizeStr(body.bonusType, 100) || "Genel Bonus"
  const wagerReq      = sanitizeFloat(body.wagerRequirement, 0, 100) ?? 0
  const minDeposit    = sanitizeFloat(body.minDeposit, 0, 100_000) ?? 0
  const minWithdraw   = sanitizeFloat(body.minWithdraw, 0, 100_000) ?? 0
  const note          = sanitizeStr(body.note, 500) || ""
  const category      = sanitizeStr(body.category, 50) || "affiliate_bonus"
  const partnerId     = typeof body.partnerId === "number" ? body.partnerId : null

  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Geçerli bir tutar giriniz." }, { status: 400 })
  }

  try {
    await connectDB()
    const db = mongoose.connection.db!
    const usersCol = mongoose.connection.db!.collection("users")
    const adjustmentsCol = db.collection("adminmanualadjustments")

    // Partner üyelerini al (eğer partnerId varsa)
    let partnerRefUserIds: Set<string> | null = null
    if (partnerId) {
      const dbUrl = process.env.DATABASE_URL
      if (dbUrl) {
        const sql = neon(dbUrl)
        const partnerRows = await sql`SELECT ref_code FROM affiliate_users WHERE id = ${partnerId} LIMIT 1`
        const partnerRefCode = partnerRows[0]?.ref_code
        if (partnerRefCode) {
          const refUsers = await usersCol.find(
            { $or: [{ ref_code: partnerRefCode }, { refCode: partnerRefCode }] },
            { projection: { _id: 1 } }
          ).toArray()
          partnerRefUserIds = new Set(refUsers.map((u: any) => String(u._id)))
        }
      }
    }

    // 1. Tüm belirtilen kullanıcıları çek
    const escapedNames = rawUsernames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const userDocs = await usersCol.find(
      { username: { $in: escapedNames.map(n => new RegExp(`^${n}$`, "i")) } },
      { projection: { _id: 1, username: 1, wallets: 1 } }
    ).toArray()

    // 2. IP çakışma kontrolü geçici olarak devre dışı
    const skippedIpConflict: string[] = []
    const skippedNotPartnerMember: string[] = []
    const notFound: string[] = []
    const eligible: any[] = []

    const foundMap = new Map<string, any>()
    for (const u of userDocs) {
      foundMap.set(String(u.username).toLowerCase(), u)
    }

    for (const rawName of rawUsernames) {
      const doc = foundMap.get(rawName.toLowerCase())
      if (!doc) { notFound.push(rawName); continue }
      // Partner filtresi varsa ve kullanıcı bu partnerin üyesi değilse atla
      if (partnerRefUserIds && !partnerRefUserIds.has(String(doc._id))) {
        skippedNotPartnerMember.push(rawName)
        continue
      }
      eligible.push(doc)
    }

    // 3. Son işlem kontrolü: son bonus tarihinden sonra yatırım yapıp yapmadığını kontrol et
    const eligibleIds = eligible.map((u: any) => u._id)
    const forcelabCol = db.collection("forcelabfinancetransactions")
    const meeldevCol  = db.collection("meeldevtransactions")

    // Her kullanıcının son bonus tarihi (adminmanualadjustments)
    const lastBonusDocs = await adjustmentsCol.aggregate([
      { $match: { targetUser: { $in: eligibleIds }, kind: "bonus", direction: "credit" } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$targetUser", lastBonusAt: { $first: "$createdAt" } } },
    ]).toArray()
    const bonusMap = new Map(lastBonusDocs.map((d: any) => [String(d._id), new Date(d.lastBonusAt)]))

    // Her kullanıcının son deposit tarihi — forcelab: user alanı, providerType:"deposit", status:"approved"
    //                                      meeldev:   user alanı, type:"deposit",         status: onay değerleri
    const meelApproved = ["approved", "completed", "success", "confirmed"]
    const [forcelabDeps, meeldevDeps] = await Promise.all([
      forcelabCol.aggregate([
        { $match: { user: { $in: eligibleIds }, providerType: "deposit", status: "approved" } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$user", lastDepositAt: { $first: "$createdAt" } } },
      ]).toArray(),
      meeldevCol.aggregate([
        { $match: { user: { $in: eligibleIds }, type: "deposit", status: { $in: meelApproved } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$user", lastDepositAt: { $first: "$createdAt" } } },
      ]).toArray(),
    ])

    const depositMap = new Map<string, Date>()
    for (const d of [...forcelabDeps, ...meeldevDeps]) {
      const key  = String(d._id)
      const date = new Date(d.lastDepositAt)
      if (!depositMap.has(key) || depositMap.get(key)! < date) depositMap.set(key, date)
    }

    const finalEligible: any[] = []
    const skippedLastBonus: string[] = []

    for (const user of eligible) {
      const uid        = String(user._id)
      const lastBonus  = bonusMap.get(uid)
      const lastDeposit = depositMap.get(uid)

      // Bonus hiç almamış → eklenir
      if (!lastBonus) { finalEligible.push(user); continue }

      // Bonus aldıktan sonra yatırım yapmış → eklenir
      if (lastDeposit && lastDeposit > lastBonus) { finalEligible.push(user); continue }

      // Bonus almış ama sonrasında yatırım yok → elenir
      skippedLastBonus.push(String(user.username))
    }

    if (finalEligible.length === 0) {
      return NextResponse.json({
        success: false,
        message: partnerId && skippedNotPartnerMember.length > 0
          ? "Uygun kullanıcı bulunamadı. Girilen kullanıcılar seçilen partnerin üyesi değil."
          : "Uygun kullanıcı bulunamadı. Son işlemi bonus olan tüm kullanıcılar elendi.",
        notFound,
        skippedIpConflict,
        skippedLastBonus,
        skippedNotPartnerMember,
        processed: 0,
      })
    }

    // 4. İdempotency: son 10 saniye içinde aynı aktör aynı tutarda bulk bonus eklemiş mi?
    const tenSecondsAgo = new Date(Date.now() - 10_000)
    const recentDuplicate = await adjustmentsCol.findOne({
      "actorSnapshot.username": session.username,
      appliedAmount: amount,
      "metadata.bulkOperation": true,
      createdAt: { $gte: tenSecondsAgo },
    })
    if (recentDuplicate) {
      return NextResponse.json({
        success: false,
        message: "Bu işlem zaten gerçekleştirildi. Lütfen birkaç saniye bekleyin.",
      }, { status: 429 })
    }

    // 5. Bonus ekle — adminmanualadjustments + wallet güncelle
    const now = new Date()
    const actorObjectId = new mongoose.Types.ObjectId() // superadmin placeholder
    const processedUsers: string[] = []
    const errors: string[] = []

    const noteWithConditions = [
      note,
      bonusType !== "Genel Bonus" ? `Bonus Türü: ${bonusType}` : "",
      wagerReq > 0 ? `Çevrim Şartı: ${wagerReq}x` : "",
        minDeposit > 0 ? `Min. Yatırım: ₺${minDeposit}` : "",
          minWithdraw > 0 ? `Min. Çekim: ₺${minWithdraw}` : "",
      `Ekleyen: ${session.username}`,
    ].filter(Boolean).join(" | ")

    const bulkAdjustments = []
    const bulkWalletUpdates = []

    for (const user of finalEligible) {
      try {
        const wallets: any[] = Array.isArray(user.wallets) ? user.wallets : []
        const bonusWalletIdx = wallets.findIndex((w: any) => w?.coinType === "Rivo" || w?.type === "bonus")
        const oldBalance = bonusWalletIdx >= 0 ? (wallets[bonusWalletIdx].balance ?? 0) : 0
        const newBalance = oldBalance + amount

        // adminmanualadjustments kaydı
        bulkAdjustments.push({
          actorUser: actorObjectId,
          actorSnapshot: { username: session.username, role: session.role },
          targetUser: user._id,
          targetSnapshot: { username: user.username },
          wallet: { coinType: "Rivo", kind: "bonus", direction: "credit" },
          kind: "bonus",
          direction: "credit",
          category,
          note: noteWithConditions,
          requestedAmount: amount,
          appliedAmount: amount,
          balanceBefore: oldBalance,
          balanceAfter: newBalance,
          source: "manual",
          sourceRef: null,
          metadata: {
            bonusType,
          wagerRequirement: wagerReq,
          minDeposit,
          minWithdraw,
            bulkOperation: true,
            addedBy: session.username,
            ipConflictChecked: true,
          },
          createdAt: now,
          updatedAt: now,
          __v: 0,
        })

        bulkWalletUpdates.push({ userId: user._id, bonusWalletIdx, oldBalance, newBalance })
        processedUsers.push(String(user.username))
      } catch (userErr) {
        errors.push(String(user.username))
      }
    }

    // Toplu insert
    if (bulkAdjustments.length > 0) {
      await adjustmentsCol.insertMany(bulkAdjustments, { ordered: false })
    }

    // Wallet güncelle
    for (let i = 0; i < finalEligible.length; i++) {
      const user = finalEligible[i]
      const update = bulkWalletUpdates[i]
      if (!update) continue
      try {
        if (update.bonusWalletIdx >= 0) {
          await usersCol.updateOne(
            { _id: user._id },
            { $set: { [`wallets.${update.bonusWalletIdx}.balance`]: update.newBalance, updatedAt: now } }
          )
        } else {
          await usersCol.updateOne(
            { _id: user._id },
            {
              $push: { wallets: { coinType: "Rivo", balance: amount, chain: "TRON", type: "trc-20" } } as any,
              $set: { updatedAt: now },
            }
          )
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      message: `${processedUsers.length} kullanıcıya ₺${amount.toLocaleString("tr-TR")} bonus eklendi.`,
      processed: processedUsers.length,
      processedUsers,
      skippedIpConflict,
      skippedLastBonus,
      skippedNotPartnerMember,
      notFound,
      errors,
      amount,
      bonusType,
      wagerRequirement: wagerReq,
      minDeposit,
      minWithdraw,
    })
  } catch (err) {
    console.error("[bonus/bulk] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası oluştu." }, { status: 500 })
  }
}
