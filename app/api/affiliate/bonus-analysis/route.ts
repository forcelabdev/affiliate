import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { neon } from "@neondatabase/serverless"

async function connectDB() {
  if (mongoose.connection.readyState >= 1) return
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING!, {
    dbName: "bizzocazino",
    bufferCommands: false,
  })
}

export async function GET(req: NextRequest) {
  try {
  if (!process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING) {
    return NextResponse.json({ success: false, message: "Sunucu yapılandırma hatası: MONGODB_URI tanımlı değil." }, { status: 500 })
  }

  const auth = await requireAuth(req)
  if ("error" in auth) return auth.error
  const { session } = auth

  const isAdmin    = session.role === "superadmin" || session.role === "admin"
  const isPartner  = session.role === "partner"
  if (!isAdmin && !isPartner) {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const startDateParam = searchParams.get("startDate")
  const endDateParam   = searchParams.get("endDate")
  const search         = searchParams.get("search")?.trim() || ""

  await connectDB()
  const db = mongoose.connection.db!

  // Date filter
  const dateRange: Record<string, unknown> = {}
  if (startDateParam) dateRange.$gte = new Date(parseInt(startDateParam))
  if (endDateParam)   dateRange.$lte = new Date(parseInt(endDateParam))

  // 1. Fetch all manual bonus adjustments
  const adjustmentsCol = db.collection("adminmanualadjustments")
  const baseQuery: Record<string, unknown> = {
    kind:      "bonus",
    direction: "credit",
    source:    "manual",
  }
  if (Object.keys(dateRange).length > 0) baseQuery.createdAt = dateRange

  const adjustments = await adjustmentsCol
    .find(baseQuery, {
      projection: {
        targetUser: 1, actorUser: 1, appliedAmount: 1, requestedAmount: 1,
        balanceBefore: 1, balanceAfter: 1, category: 1, note: 1, createdAt: 1,
      },
    })
    .sort({ createdAt: -1 })
    .toArray()

  if (adjustments.length === 0) {
    return NextResponse.json({ success: true, partners: [], summary: { totalBonus: 0, totalUsers: 0, totalTxn: 0 } })
  }

  // 2. Fetch target users (bonus alan üyeler)
  const targetIds = [...new Set(adjustments.map((a: any) => String(a.targetUser)))]
  const usersCol  = db.collection("users")

  // Her rol için sadece partner'lı üyeler gelir, partnersizler hariç
  // partner → sadece kendi refCode'u, admin/superadmin → tüm partnerli üyeler
  const objectIds = targetIds.map((id: string) => { try { return new mongoose.Types.ObjectId(id) } catch { return id } })
  const userQuery: Record<string, unknown> = {
    _id: { $in: objectIds },
    // partnersizleri kesinlikle hariç tut
    "affiliates.redeemedCode": isPartner && session.refCode
      ? session.refCode                                        // partner: sadece kendi kodu
      : { $exists: true, $nin: [null, "", "NULL"] },           // admin/superadmin: tüm partnerli
  }

  const userDocs = await usersCol
    .find(userQuery, { projection: { _id: 1, username: 1, name: 1, "affiliates.redeemedCode": 1 } })
    .toArray()

  const userMap: Record<string, { username: string; name?: string; redeemedCode?: string }> = {}
  userDocs.forEach((u: any) => {
    userMap[String(u._id)] = {
      username:    u.username,
      name:        u.name,
      redeemedCode: u.affiliates?.redeemedCode ?? null,
    }
  })

  // 3. Fetch partner names from Neon (refCode → username map)
  const databaseUrl = process.env.DATABASE_URL
  const codeToPartner: Record<string, string> = {}
  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl)
      const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code IS NOT NULL`
      rows.forEach((r: any) => { if (r.ref_code && r.ref_code !== "NULL") codeToPartner[r.ref_code] = r.username })
    } catch (e) { console.warn("[bonus-analysis] Neon error:", e) }
  }

  // 4. Enrich adjustments with user info — userMap'te olmayan (partnersiz) kayıtları atla
  const enriched = adjustments.flatMap((a: any) => {
    const uid  = String(a.targetUser)
    const user = userMap[uid]
    if (!user) return []  // partnersiz veya refCode'suz kullanıcıyı geç
    const partnerName = user.redeemedCode ? (codeToPartner[user.redeemedCode] ?? user.redeemedCode) : null
    if (!partnerName) return []  // refCode var ama Neon'da partner bulunamadıysa da geç
    return [{
      _id:           String(a._id),
      targetUserId:  uid,
      username:      user.username,
      name:          user.name,
      redeemedCode:  user.redeemedCode ?? null,
      partnerName,
      amount:        a.appliedAmount ?? a.requestedAmount ?? 0,
      balanceBefore: a.balanceBefore ?? 0,
      balanceAfter:  a.balanceAfter  ?? 0,
      category:      a.category ?? null,
      note:          a.note ?? null,
      createdAt:     a.createdAt,
    }]
  })

  // 5. Search filter
  const filtered = search
    ? enriched.filter(r =>
        r.username?.toLowerCase().includes(search.toLowerCase()) ||
        r.partnerName?.toLowerCase().includes(search.toLowerCase())
      )
    : enriched

  // 6. Group by partner
  const partnerMap: Record<string, {
    partnerName: string
    members: Record<string, { username: string; name?: string; totalBonus: number; txCount: number; logs: typeof filtered }>
  }> = {}

  filtered.forEach(r => {
    const pKey = r.partnerName ?? "__nopartner__"
    const pLabel = r.partnerName ?? "Partnersiz"
    if (!partnerMap[pKey]) partnerMap[pKey] = { partnerName: pLabel, members: {} }
    const members = partnerMap[pKey].members
    if (!members[r.username]) {
      members[r.username] = { username: r.username, name: r.name, totalBonus: 0, txCount: 0, logs: [] }
    }
    members[r.username].totalBonus += Number(r.amount)
    members[r.username].txCount    += 1
    members[r.username].logs.push(r)
  })

  const partners = Object.values(partnerMap).map(p => ({
    partnerName:  p.partnerName,
    totalBonus:   Object.values(p.members).reduce((s, m) => s + m.totalBonus, 0),
    memberCount:  Object.keys(p.members).length,
    txCount:      Object.values(p.members).reduce((s, m) => s + m.txCount, 0),
    members:      Object.values(p.members).sort((a, b) => b.totalBonus - a.totalBonus),
  })).sort((a, b) => b.totalBonus - a.totalBonus)

  const summary = {
    totalBonus: filtered.reduce((s, r) => s + Number(r.amount), 0),
    totalUsers: Object.keys(Object.fromEntries(filtered.map(r => [r.username, 1]))).length,
    totalTxn:   filtered.length,
  }

  return NextResponse.json({ success: true, partners, summary })
  } catch (err: any) {
    console.error("[bonus-analysis] Unhandled error:", err)
    return NextResponse.json({ success: false, message: err?.message ?? "Sunucu hatası oluştu." }, { status: 500 })
  }
}
