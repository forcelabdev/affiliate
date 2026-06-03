import { NextRequest, NextResponse } from "next/server"
import { TOTP, Secret } from "otpauth"
import { neon } from "@neondatabase/serverless"
import { getAffiliateUsersFromDB, getCommissionOverride, signToken } from "@/lib/auth"

export async function POST(req: NextRequest) {
  try {
    const { username, code, isSetup } = await req.json()

    if (!username || !code) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı ve kod gerekli." }, { status: 400 })
    }

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ success: false, message: "Veritabanı bağlantısı yok." }, { status: 500 })
    }

    const sql = neon(databaseUrl)
    const rows = await sql`SELECT totp_secret, totp_enabled FROM affiliate_users WHERE username = ${username}`

    if (!rows.length || !rows[0].totp_secret) {
      return NextResponse.json({ success: false, message: "2FA kurulumu bulunamadı. Lütfen tekrar deneyin." }, { status: 400 })
    }

    const secret = rows[0].totp_secret

    const totp = new TOTP({
      issuer: "VeloBet Affiliate",
      label: username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    })

    // Validate with ±1 window tolerance
    const delta = totp.validate({ token: code.replace(/\s/g, ""), window: 1 })

    if (delta === null) {
      return NextResponse.json({ success: false, message: "Kod geçersiz veya süresi dolmuş. Lütfen tekrar deneyin." }, { status: 401 })
    }

    // If this is first-time setup, mark as enabled
    if (isSetup) {
      await sql`UPDATE affiliate_users SET totp_enabled = TRUE WHERE username = ${username}`
    }

    // Issue JWT
    const users = await getAffiliateUsersFromDB()
    const user = users.find((u: any) => u.username?.toLowerCase() === username.toLowerCase())

    if (!user) {
      return NextResponse.json({ success: false, message: "Kullanıcı bulunamadı." }, { status: 404 })
    }

    const override = getCommissionOverride(user.username)
    const commissionRate = override?.rate ?? user.commissionRate ?? 10
    const commissionType = override?.type ?? user.commissionType ?? "deposit"

    const token = signToken({
      username: user.username,
      role: user.role,
      affiliateId: user.affiliateId,
      refCode: user.refCode,
      name: user.name,
      commissionRate,
      commissionType,
    })

    return NextResponse.json({
      success: true,
      token,
      user: {
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        affiliateId: user.affiliateId,
        refCode: user.refCode,
        commissionRate,
        commissionType,
      },
    })
  } catch (err) {
    console.error("[2fa/verify] error:", err)
    return NextResponse.json({ success: false, message: "Doğrulama hatası." }, { status: 500 })
  }
}
