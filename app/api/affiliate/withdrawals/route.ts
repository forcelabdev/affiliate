import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "fonbet", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
  if (!mongoose.connection.db) await new Promise<void>((r) => mongoose.connection.once("connected", () => r()))
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  const { searchParams } = new URL(req.url)

  const requestedCode = searchParams.get("refCode")
  const startDateParam = searchParams.get("startDate")
  const refCode = session.role === "admin" ? requestedCode || session.refCode : session.refCode
  if (!refCode) return NextResponse.json({ success: false, message: "Ref kodu bulunamadı." }, { status: 400 })

  try {
    await connectDB()
    const users = mongoose.connection.db!.collection("users")

    // Get partner info from Neon to match transferred users
    let partnerUsername: string | null = null
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        const partners = await sql`SELECT username FROM affiliate_users WHERE ref_code = ${refCode}`
        if (partners && partners.length > 0) {
          partnerUsername = partners[0].username
        }
      } catch (neonErr) {
        console.warn("[v0] Failed to fetch partner from Neon:", neonErr)
      }
    }

    const partner = await users.findOne({ "affiliates.code": refCode }, { projection: { _id: 1 } })
    
    // Query: check redeemedCode (old system) OR referrer ObjectId (old system) OR referrerUsername (transferred users)
    const orConditions: Record<string, unknown>[] = [
      { "affiliates.redeemedCode": refCode },
    ]
    if (partner) {
      orConditions.push({ "affiliates.referrer": partner._id })
    }
    if (partnerUsername) {
      orConditions.push({ "affiliates.referrerUsername": partnerUsername })
    }
    orConditions.push({ "affiliates.referrerUsername": refCode })
    
    const query: Record<string, unknown> = { $or: orConditions }

    const userDocs = await users.find(query, {
      projection: { name: 1, username: 1, "affiliates.redeemedCode": 1, "affiliates.referredAt": 1, createdAt: 1 },
    }).toArray()

    if (userDocs.length === 0) {
      return NextResponse.json({ success: true, refCode, data: [] })
    }

    const userIds = userDocs.map((u: any) => u._id)

    // Use startDate from client (Türkiye saati ile hesaplanmış)
    const startDate = startDateParam ? new Date(parseInt(startDateParam)) : null

    // Fetch approved withdrawals from forcelabfinancetransactions collection
    const financeTx = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const withdrawalQuery: Record<string, unknown> = { 
      user: { $in: userIds }, 
      providerType: "withdrawal", 
      status: "approved" 
    }
    if (startDate) {
      withdrawalQuery.createdAt = { $gte: startDate }
    }

    const withdrawals = await financeTx.find(
      withdrawalQuery,
      { projection: { user: 1, amount: 1, createdAt: 1, status: 1 } }
    ).toArray()

    // Map user ObjectIds to usernames for display
    const userMap: Record<string, string> = {}
    userDocs.forEach((u: any) => {
      userMap[u._id.toString()] = u.username
    })

    const formatted = withdrawals.map((w: any) => ({
      _id: w._id?.toString(),
      username: userMap[w.user?.toString()] || "",
      amount: w.amount || 0,
      status: w.status || "pending",
      createdAt: w.createdAt?.toISOString(),
    }))

    return NextResponse.json({ success: true, refCode, data: formatted })
  } catch (err) {
    console.error("[v0] Withdrawals error:", err)
    return NextResponse.json({ success: false, message: "Veri alınamadı." }, { status: 500 })
  }
}
