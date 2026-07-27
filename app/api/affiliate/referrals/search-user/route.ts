import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { neon } from "@neondatabase/serverless"
import mongoose from "mongoose"

function sanitize(val: unknown): string {
  if (typeof val !== "string") return ""
  if (/[{}$]/.test(val)) return ""
  return val.trim().slice(0, 100)
}

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return
  const uri = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "bizzocazino", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
  if (!mongoose.connection.db) await new Promise<void>((r) => mongoose.connection.once("connected", () => r()))
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin" && session.role !== "admin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const q = sanitize(searchParams.get("q"))
  const partnerIdStr = searchParams.get("partnerId")

  if (!q || q.length < 2) {
    return NextResponse.json({ success: true, users: [] })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })

  try {
    await connectDB()
    const db = mongoose.connection.db!
    const sql = neon(dbUrl)

    // Partnerin ref_code'unu bul
    let refCode: string | null = null
    let partnerUsername: string | null = null
    if (partnerIdStr) {
      const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE id = ${parseInt(partnerIdStr, 10)} LIMIT 1`
      if (rows[0]) { refCode = rows[0].ref_code; partnerUsername = rows[0].username }
    }

    // Partnerin üyelerini bul
    const users = db.collection("users")
    let userIds: any[] = []

    if (refCode) {
      const partner = await users.findOne({ "affiliates.code": refCode }, { projection: { _id: 1 } })
      const orConds: any[] = [
        { "affiliates.redeemedCode": refCode },
        { "affiliates.referrerUsername": refCode },
        ...(partnerUsername ? [{ "affiliates.referrerUsername": partnerUsername }] : []),
      ]
      if (partner) orConds.push({ "affiliates.referrer": partner._id })
      const refDocs = await users.find({ $or: orConds }, { projection: { _id: 1 } }).toArray()
      userIds = refDocs.map((u: any) => u._id)
    }

    // Username ile filtrele
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const query: any = { username: regex }
    if (userIds.length > 0) query._id = { $in: userIds }

    const results = await users
      .find(query, { projection: { _id: 1, username: 1 } })
      .limit(10)
      .toArray()

    return NextResponse.json({
      success: true,
      users: results.map((u: any) => ({ _id: String(u._id), username: u.username })),
    })
  } catch {
    return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })
  }
}
