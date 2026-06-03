import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "fonbet", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
  // Wait until db is available
  await new Promise<void>((resolve) => {
    if (mongoose.connection.db) return resolve()
    mongoose.connection.once("connected", () => resolve())
  })
}

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
      // Superadmin: tüm partnerlerin son kayıtları
      let allCodes: string[] = []
      let allUsernames: string[] = []
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code IS NOT NULL`
          allCodes = rows.map((r: any) => r.ref_code)
          allUsernames = rows.map((r: any) => r.username)
        } catch (e) { console.warn("[last-five] Neon error:", e) }
      }
      const mongoPartners = await users.find(
        { "affiliates.code": { $in: allCodes } },
        { projection: { _id: 1 } }
      ).toArray()
      orConditions = [
        { "affiliates.redeemedCode": { $in: allCodes } },
        { "affiliates.referrerUsername": { $in: [...allCodes, ...allUsernames] } },
        { "affiliates.referrer": { $in: mongoPartners.map((p: any) => p._id) } },
      ]
    } else {
      let partnerUsername: string | null = null
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const rows = await sql`SELECT username FROM affiliate_users WHERE ref_code = ${refCode}`
          if (rows?.length > 0) partnerUsername = rows[0].username
        } catch (e) { console.warn("[last-five] Neon error:", e) }
      }
      const partner = await users.findOne({ "affiliates.code": refCode }, { projection: { _id: 1 } })
      orConditions = [
        { "affiliates.redeemedCode": refCode },
        { "affiliates.referrerUsername": refCode },
      ]
      if (partner) orConditions.push({ "affiliates.referrer": partner._id })
      if (partnerUsername) orConditions.push({ "affiliates.referrerUsername": partnerUsername })
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
