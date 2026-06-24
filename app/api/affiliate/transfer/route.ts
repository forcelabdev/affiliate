import { NextRequest, NextResponse } from "next/server"
import mongoose from "mongoose"
import { neon } from "@neondatabase/serverless"
import { verifyToken } from "@/lib/auth"
import { checkRateLimit, isValidObjectId, sanitizeInt, safeParse } from "@/lib/security"

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return
  const uri = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "fonbet", bufferCommands: false, serverSelectionTimeoutMS: 30000 })
}

export async function POST(req: NextRequest) {
  // Rate limit: IP başına 10 transfer / 10 dakika
  const rl = checkRateLimit(req, 10, 10 * 60 * 1000, "transfer")
  if (rl) return rl

  try {
    const token = req.headers.get("x-auth-token") || ""
    const payload = verifyToken(token)

    if (!payload || payload.role !== "superadmin") {
      return NextResponse.json({ success: false, message: "Yetki yok. Sadece Super Admin bu işlemi yapabilir." }, { status: 403 })
    }

    const parsed = await safeParse<{ userId?: string; partnerId?: unknown }>(req)
    if ("error" in parsed) return parsed.error
    const { userId, partnerId } = parsed.data

    if (!userId || !partnerId) {
      return NextResponse.json({ success: false, message: "userId ve partnerId gerekli." }, { status: 400 })
    }

    // ObjectId ve partnerId format doğrulaması
    if (!isValidObjectId(userId)) {
      return NextResponse.json({ success: false, message: "Geçersiz kullanıcı ID." }, { status: 400 })
    }
    const partnerIdInt = sanitizeInt(partnerId, 1)
    if (!partnerIdInt) {
      return NextResponse.json({ success: false, message: "Geçersiz partner ID." }, { status: 400 })
    }

    await connectDB()
    const users = mongoose.connection.db!.collection("users")

    // Get partner from Neon (partnerId is numeric from Neon)
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ success: false, message: "DATABASE_URL not set" }, { status: 500 })
    }

    const sql = neon(databaseUrl)

    // Ensure log table exists
    await sql`CREATE TABLE IF NOT EXISTS affiliate_transfer_logs (id SERIAL PRIMARY KEY, from_username TEXT NOT NULL, to_partner_username TEXT NOT NULL, performed_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`

    const partners = await sql`SELECT username FROM affiliate_users WHERE id = ${partnerIdInt}`
    
    if (!partners || partners.length === 0) {
      return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })
    }

    const partnerUsername = partners[0].username

    // Get user to transfer
    const userDoc = await users.findOne({ _id: new mongoose.Types.ObjectId(userId) })
    if (!userDoc) {
      return NextResponse.json({ success: false, message: "Kullanıcı bulunamadı." }, { status: 404 })
    }

    // Check if user already has a referrer
    if (userDoc.affiliates?.referrer) {
      return NextResponse.json({ 
        success: false, 
        message: `Kullanıcı zaten ${userDoc.affiliates.referrerUsername || "birine"} bir referere sahip.` 
      }, { status: 400 })
    }

    // Transfer: set user's referrer to partner username (as string)
    const result = await users.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { 
        $set: { 
          "affiliates.referrer": partnerUsername,
          "affiliates.referrerUsername": partnerUsername,
        }
      }
    )

    if (result.modifiedCount === 0) {
      return NextResponse.json({ success: false, message: "Transfer işlemi başarısız." }, { status: 500 })
    }

    // Log the transfer to Neon — blocking so it appears in history immediately
    const performedBy = payload.username || payload.name || "superadmin"
    const fromUser = userDoc.username || String(userId)
    await sql`
      INSERT INTO affiliate_transfer_logs (from_username, to_partner_username, performed_by, status, reason)
      VALUES (${fromUser}, ${partnerUsername}, ${performedBy}, 'completed', 'Super admin transfer')
    `

    return NextResponse.json({
      success: true,
      message: `${userDoc.username} kullanıcısı ${partnerUsername} partnerine transfer edildi.`,
      data: {
        userId,
        partnerId,
        username: userDoc.username,
        partnerUsername: partnerUsername,
        transferredAt: new Date().toISOString(),
      }
    })
  } catch (err) {
    console.error("[v0] Transfer error:", err)
    return NextResponse.json({ success: false, message: "Transfer işlemi sırasında hata oluştu." }, { status: 500 })
  }
}
