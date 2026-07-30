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

  if (!refCode && !isAdminAll) return NextResponse.json({ success: true, data: [] })

  try {
    await connectDB()
    const users = mongoose.connection.db!.collection("users")
    const databaseUrl = process.env.DATABASE_URL

    let orConditions: Record<string, unknown>[] = []

    if (isAdminAll) {
      // Use MongoDB's own referral fields directly — do NOT filter by Neon ref_codes
      const allPartnerIds: any[] = (await users.distinct("affiliates.referrer")).filter(Boolean)
      const allReferrerUsernames: string[] = (await users.distinct("affiliates.referrerUsername")).filter((v: any) => v && typeof v === "string")
      orConditions = [{ "affiliates.redeemedCode": { $exists: true, $ne: null } }]
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
        } catch (e) { console.warn("[last-five] Neon error:", e) }
      }
      const partner = await users.findOne(
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

    const docs = await users.find(
      { $or: orConditions },
      { projection: { name: 1, username: 1, createdAt: 1 } }
    ).sort({ createdAt: -1 }).limit(5).toArray()

    const userIds = docs.map((u: any) => u._id)

    const financeTx = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTx = mongoose.connection.db!.collection("meeldevtransactions")

    // Her iki kaynaktan toplam deposit (bonus hariç)
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]
    const [forcelabAgg, meeldevAgg] = await Promise.all([
      financeTx.aggregate([
        { $match: { 
          user: { $in: userIds }, 
          providerType: "deposit", 
          status: { $in: approvedStatuses },
          providerName: { $not: { $regex: /bonus/i } },
          providerSlug: { $not: { $regex: /bonus/i } }
        } },
        { $group: { _id: "$user", total: { $sum: "$amount" } } },
      ]).toArray(),
      meeldevTx.aggregate([
        { $match: { 
          user: { $in: userIds }, 
          type: "deposit", 
          status: { $in: approvedStatuses },
          providerName: { $not: { $regex: /bonus/i } },
          providerSlug: { $not: { $regex: /bonus/i } }
        } },
        { $group: { _id: "$user", total: { $sum: "$amount" } } },
      ]).toArray(),
    ])

    const depositMap: Record<string, number> = {}
    for (const row of [...forcelabAgg, ...meeldevAgg]) {
      const key = String(row._id)
      depositMap[key] = (depositMap[key] ?? 0) + row.total
    }

    const data = docs.map((u: any) => ({
      _id: String(u._id), name: u.name, username: u.username,
      depositTotal: depositMap[String(u._id)] ?? 0,
      createdAt: u.createdAt,
    }))

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error("[affiliate/last-five] MongoDB error:", err)
    return NextResponse.json({ success: true, data: [] })
  }
}
