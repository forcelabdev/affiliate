import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  const { searchParams } = new URL(req.url)
  const requestedCode = searchParams.get("refCode")
  const isAdmin = session.role === "admin" || session.role === "superadmin"
  const isAdminAll = isAdmin && !requestedCode && !session.refCode
  const refCode = isAdmin ? requestedCode || session.refCode || null : session.refCode

  if (!refCode && !isAdminAll) {
    return NextResponse.json({ success: false, message: "Ref kodu bulunamadı." }, { status: 400 })
  }

  try {
    await connectDB()
    const usersCol = mongoose.connection.db!.collection("users")
    const databaseUrl = process.env.DATABASE_URL

    let orConditions: Record<string, unknown>[] = []

    if (isAdminAll) {
      // Use MongoDB's own referral fields — do NOT filter through Neon ref_codes
      // because Neon ref_codes may not match actual MongoDB affiliates.redeemedCode values.
      const allPartnerIds: any[] = (await usersCol.distinct("affiliates.referrer")).filter(Boolean)
      const allReferrerUsernames: string[] = (await usersCol.distinct("affiliates.referrerUsername")).filter((v: any) => v && typeof v === "string")
      orConditions = [
        { "affiliates.redeemedCode": { $exists: true, $ne: null } },
      ]
      if (allPartnerIds.length > 0) orConditions.push({ "affiliates.referrer": { $in: allPartnerIds } })
      if (allReferrerUsernames.length > 0) orConditions.push({ "affiliates.referrerUsername": { $in: allReferrerUsernames } })
    } else {
      let partnerUsername: string | null = null
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const rows = await sql`SELECT username FROM affiliate_users WHERE ref_code = ${refCode} OR username = ${session.username}`
          if (rows?.length > 0) partnerUsername = rows[0].username
        } catch (e) { console.warn("[chart] Neon error:", e) }
      }
      const partner = await usersCol.findOne(
        { $or: [{ "affiliates.code": refCode }, { username: session.username }] },
        { projection: { _id: 1, "affiliates.code": 1 } }
      )
      const partnerMongoCode = partner?.affiliates?.code
      orConditions = [
        { "affiliates.redeemedCode": refCode },
        { "affiliates.referrerUsername": refCode },
      ]
      if (partner) orConditions.push({ "affiliates.referrer": partner._id })
      if (partnerUsername && partnerUsername !== refCode) orConditions.push({ "affiliates.referrerUsername": partnerUsername })
      if (partnerMongoCode && partnerMongoCode !== refCode) orConditions.push({ "affiliates.redeemedCode": partnerMongoCode })
    }

    const referralUsers = await usersCol.find({ $or: orConditions }, { projection: { _id: 1 } }).toArray()
    const userIds = referralUsers.map((u: any) => u._id)

    if (userIds.length === 0) {
      // Boş 30 günlük döngü döndür
      const emptyData = []
      const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0)
      for (let i = 0; i < 30; i++) {
        const d = new Date(from); d.setDate(d.getDate() + i)
        emptyData.push({ date: d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" }), deposits: 0, earnings: 0 })
      }
      return NextResponse.json({ success: true, data: emptyData })
    }

    // Son 30 gün
    const now = new Date()
    const from = new Date(now)
    from.setDate(from.getDate() - 29)
    from.setHours(0, 0, 0, 0)

    const financeTx  = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTx  = mongoose.connection.db!.collection("meeldevtransactions")
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]
    const notBonusFilter = {
      providerName: { $not: { $regex: /bonus/i } },
      providerSlug: { $not: { $regex: /bonus/i } },
    }

    // Her iki kaynaktan deposit aggregate (bonus hariç)
    const [forcelabAgg, meeldevAgg] = await Promise.all([
      financeTx.aggregate([
        { $match: { user: { $in: userIds }, providerType: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: from }, ...notBonusFilter } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, deposits: { $sum: "$amount" } } },
      ]).toArray(),
      meeldevTx.aggregate([
        { $match: { user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: from }, ...notBonusFilter } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, deposits: { $sum: "$amount" } } },
      ]).toArray(),
    ])

    // Günlük toplamları birleştir
    const map: Record<string, number> = {}
    for (const row of [...forcelabAgg, ...meeldevAgg]) {
      map[row._id] = (map[row._id] ?? 0) + row.deposits
    }

    const commissionRate = session.commissionRate ?? 10
    const data: { date: string; deposits: number; earnings: number }[] = []
    for (let i = 0; i < 30; i++) {
      const d = new Date(from)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      const label = d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })
      const deposits = map[key] ?? 0
      data.push({ date: label, deposits, earnings: +(deposits * (commissionRate / 100)).toFixed(2) })
    }

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error("[affiliate/chart] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
