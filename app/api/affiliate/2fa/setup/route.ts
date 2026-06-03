import { NextRequest, NextResponse } from "next/server"
import { TOTP, Secret } from "otpauth"
import QRCode from "qrcode"
import { neon } from "@neondatabase/serverless"

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json()
    if (!username) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı gerekli." }, { status: 400 })
    }

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ success: false, message: "Veritabanı bağlantısı yok." }, { status: 500 })
    }

    const sql = neon(databaseUrl)

    // Ensure columns exist
    await sql`ALTER TABLE affiliate_users ADD COLUMN IF NOT EXISTS totp_secret TEXT`
    await sql`ALTER TABLE affiliate_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE`

    // Check if already has a secret — reuse it so QR stays stable
    const rows = await sql`SELECT totp_secret, totp_enabled FROM affiliate_users WHERE username = ${username}`

    let secret: string
    if (rows.length > 0 && rows[0].totp_secret) {
      secret = rows[0].totp_secret
    } else {
      // Generate new secret
      const totp = new TOTP({
        issuer: "VeloBet Affiliate",
        label: username,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      })
      secret = totp.secret.base32

      if (rows.length > 0) {
        await sql`UPDATE affiliate_users SET totp_secret = ${secret} WHERE username = ${username}`
      } else {
        await sql`INSERT INTO affiliate_users (username, totp_secret, totp_enabled) VALUES (${username}, ${secret}, FALSE) ON CONFLICT (username) DO UPDATE SET totp_secret = ${secret}`
      }
    }

    // Build TOTP URI & QR
    const totp = new TOTP({
      issuer: "VeloBet Affiliate",
      label: username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    })

    const uri = totp.toString()
    const qrDataUrl = await QRCode.toDataURL(uri, { width: 240, margin: 1 })

    return NextResponse.json({
      success: true,
      qr: qrDataUrl,
      secret,
      alreadyEnabled: rows.length > 0 && rows[0].totp_enabled === true,
    })
  } catch (err) {
    console.error("[2fa/setup] error:", err)
    return NextResponse.json({ success: false, message: "2FA kurulum hatası." }, { status: 500 })
  }
}
