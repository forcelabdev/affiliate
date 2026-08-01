import { NextRequest, NextResponse } from "next/server"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"
import { neon } from "@neondatabase/serverless"
import { verifyToken } from "@/lib/auth"
import { checkRateLimit, isValidObjectId, sanitizeInt, safeParse } from "@/lib/security"

export async function POST(req: NextRequest) {
  // Rate limit: IP başına 20 transfer / 10 dakika
  const rl = checkRateLimit(req, 20, 10 * 60 * 1000, "transfer")
  if (rl) return rl

  try {
    const token = req.headers.get("x-auth-token") || ""
    const payload = verifyToken(token)

    if (!payload || payload.role !== "superadmin") {
      return NextResponse.json({ success: false, message: "Yetki yok. Sadece Super Admin bu işlemi yapabilir." }, { status: 403 })
    }

    const parsed = await safeParse<{
      userId?: string
      partnerId?: unknown
      type?: string
      fromPartnerId?: unknown
      toPartnerId?: unknown
      userIds?: string[]
    }>(req)
    if ("error" in parsed) return parsed.error

    const { type, userId, partnerId, fromPartnerId, toPartnerId, userIds } = parsed.data

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ success: false, message: "DATABASE_URL not set" }, { status: 500 })
    }

    const sql = neon(databaseUrl)

    // Ensure log table exists with all columns
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_transfer_logs (
        id SERIAL PRIMARY KEY,
        from_username TEXT NOT NULL,
        to_partner_username TEXT NOT NULL,
        from_partner_username TEXT,
        transfer_type TEXT NOT NULL DEFAULT 'unassigned_to_partner',
        performed_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    // Add missing columns if table already exists (idempotent)
    await sql`ALTER TABLE affiliate_transfer_logs ADD COLUMN IF NOT EXISTS from_partner_username TEXT`
    await sql`ALTER TABLE affiliate_transfer_logs ADD COLUMN IF NOT EXISTS transfer_type TEXT NOT NULL DEFAULT 'unassigned_to_partner'`

    await connectDB()
    const users = mongoose.connection.db!.collection("users")

    const performedBy = payload.username || payload.name || "superadmin"

    // ─── MODE 1: Partner → Partner (bulk) ─────────────────────────────────────
    if (type === "partner_to_partner") {
      if (!fromPartnerId || !toPartnerId || !Array.isArray(userIds) || userIds.length === 0) {
        return NextResponse.json({ success: false, message: "fromPartnerId, toPartnerId ve userIds gerekli." }, { status: 400 })
      }

      const fromPartnerIdInt = sanitizeInt(fromPartnerId, 1)
      const toPartnerIdInt   = sanitizeInt(toPartnerId, 1)

      if (!fromPartnerIdInt || !toPartnerIdInt) {
        return NextResponse.json({ success: false, message: "Geçersiz partner ID." }, { status: 400 })
      }

      if (fromPartnerIdInt === toPartnerIdInt) {
        return NextResponse.json({ success: false, message: "Kaynak ve hedef partner aynı olamaz." }, { status: 400 })
      }

      // Validate all userIds
      for (const uid of userIds) {
        if (!isValidObjectId(uid)) {
          return NextResponse.json({ success: false, message: `Geçersiz kullanıcı ID: ${uid}` }, { status: 400 })
        }
      }

      // Fetch both partners from Neon
      const [fromPartners, toPartners] = await Promise.all([
        sql`SELECT username, ref_code FROM affiliate_users WHERE id = ${fromPartnerIdInt}`,
        sql`SELECT username, ref_code FROM affiliate_users WHERE id = ${toPartnerIdInt}`,
      ])

      if (!fromPartners || fromPartners.length === 0) {
        return NextResponse.json({ success: false, message: "Kaynak partner bulunamadı." }, { status: 404 })
      }
      if (!toPartners || toPartners.length === 0) {
        return NextResponse.json({ success: false, message: "Hedef partner bulunamadı." }, { status: 404 })
      }

      const fromPartnerUsername = fromPartners[0].username as string
      const toPartnerUsername   = toPartners[0].username as string
      const toPartnerRefCode    = toPartners[0].ref_code as string | null

      // Bulk update all selected users
      const objectIds = userIds.map((id) => new mongoose.Types.ObjectId(id))

      const updateFields: Record<string, string | null> = {
        "affiliates.referrer": toPartnerUsername,
        "affiliates.referrerUsername": toPartnerUsername,
      }
      if (toPartnerRefCode && toPartnerRefCode !== "NULL" && toPartnerRefCode !== "null") {
        updateFields["affiliates.redeemedCode"] = toPartnerRefCode
      }

      const result = await users.updateMany(
        { _id: { $in: objectIds } },
        { $set: updateFields }
      )

      if (result.modifiedCount === 0) {
        return NextResponse.json({ success: false, message: "Hiçbir kullanıcı güncellenemedi." }, { status: 500 })
      }

      // Fetch usernames for logging
      const userDocs = await users.find(
        { _id: { $in: objectIds } },
        { projection: { username: 1 } }
      ).toArray()

      // Log each transfer
      await Promise.all(
        userDocs.map((u) =>
          sql`
            INSERT INTO affiliate_transfer_logs
              (from_username, to_partner_username, from_partner_username, transfer_type, performed_by, status, reason)
            VALUES
              (${u.username || String(u._id)}, ${toPartnerUsername}, ${fromPartnerUsername}, 'partner_to_partner', ${performedBy}, 'completed', 'Partner arası transfer')
          `
        )
      )

      return NextResponse.json({
        success: true,
        message: `${result.modifiedCount} kullanıcı ${fromPartnerUsername} → ${toPartnerUsername} transfer edildi.`,
        data: {
          modifiedCount: result.modifiedCount,
          fromPartnerUsername,
          toPartnerUsername,
          transferredAt: new Date().toISOString(),
        },
      })
    }

    // ─── MODE 2: Atanmamış → Partner (tekli, mevcut) ─────────────────────────
    if (!userId || !partnerId) {
      return NextResponse.json({ success: false, message: "userId ve partnerId gerekli." }, { status: 400 })
    }

    if (!isValidObjectId(userId)) {
      return NextResponse.json({ success: false, message: "Geçersiz kullanıcı ID." }, { status: 400 })
    }
    const partnerIdInt = sanitizeInt(partnerId, 1)
    if (!partnerIdInt) {
      return NextResponse.json({ success: false, message: "Geçersiz partner ID." }, { status: 400 })
    }

    const partners = await sql`SELECT username, ref_code FROM affiliate_users WHERE id = ${partnerIdInt}`

    if (!partners || partners.length === 0) {
      return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })
    }

    const partnerUsername = partners[0].username as string
    const partnerRefCode  = partners[0].ref_code as string | null

    // Get user to transfer
    const userDoc = await users.findOne({ _id: new mongoose.Types.ObjectId(userId) })
    if (!userDoc) {
      return NextResponse.json({ success: false, message: "Kullanıcı bulunamadı." }, { status: 404 })
    }

    // Check if user already has a referrer
    if (userDoc.affiliates?.referrer) {
      return NextResponse.json({
        success: false,
        message: `Kullanıcı zaten ${userDoc.affiliates.referrerUsername || "birine"} bir referere sahip.`,
      }, { status: 400 })
    }

    const setFields: Record<string, string | null> = {
      "affiliates.referrer": partnerUsername,
      "affiliates.referrerUsername": partnerUsername,
    }
    if (partnerRefCode && partnerRefCode !== "NULL" && partnerRefCode !== "null") {
      setFields["affiliates.redeemedCode"] = partnerRefCode
    }

    const result = await users.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { $set: setFields }
    )

    if (result.modifiedCount === 0) {
      return NextResponse.json({ success: false, message: "Transfer işlemi başarısız." }, { status: 500 })
    }

    const fromUser = userDoc.username || String(userId)
    await sql`
      INSERT INTO affiliate_transfer_logs
        (from_username, to_partner_username, transfer_type, performed_by, status, reason)
      VALUES
        (${fromUser}, ${partnerUsername}, 'unassigned_to_partner', ${performedBy}, 'completed', 'Super admin transfer')
    `

    return NextResponse.json({
      success: true,
      message: `${userDoc.username} kullanıcısı ${partnerUsername} partnerine transfer edildi.`,
      data: {
        userId,
        partnerId,
        username: userDoc.username,
        partnerUsername,
        transferredAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error("[transfer] error:", err)
    return NextResponse.json({ success: false, message: "Transfer işlemi sırasında hata oluştu." }, { status: 500 })
  }
}
