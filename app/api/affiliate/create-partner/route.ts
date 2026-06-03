import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import bcrypt from "bcryptjs"

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  if (session.role !== "admin" && session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return NextResponse.json({ success: false, message: "Veritabanı bağlantısı bulunamadı." }, { status: 500 })
  }

  try {
    const body = await req.json()
    const { username, password, name, refCode, shortLink, commissionRate, commissionType, role: rawRole } = body

    if (!username || !password || !refCode) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı, şifre ve ref kodu zorunludur." }, { status: 400 })
    }

    // Sadece superadmin affiliate_user rolü atayabilir, diğerleri daima 'partner'
    const allowedRoles = ["partner", "affiliate_user"]
    const assignedRole = session.role === "superadmin" && allowedRoles.includes(rawRole)
      ? rawRole
      : "partner"

    const { neon } = await import("@neondatabase/serverless")
    const sql = neon(databaseUrl)

    // Check if username or refCode already exists
    const existing = await sql`
      SELECT id FROM affiliate_users WHERE username = ${username} OR ref_code = ${refCode}
    `
    if (existing.length > 0) {
      return NextResponse.json({ success: false, message: "Bu kullanıcı adı veya ref kodu zaten kullanılıyor." }, { status: 409 })
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Insert new partner — add short_link column if it doesn't exist yet (safe ALTER)
    try {
      await sql`ALTER TABLE affiliate_users ADD COLUMN IF NOT EXISTS short_link TEXT`
    } catch (_) {}

    const result = await sql`
      INSERT INTO affiliate_users (username, password, name, ref_code, short_link, role, commission_rate, commission_type)
      VALUES (
        ${username},
        ${hashedPassword},
        ${name || username},
        ${refCode},
        ${shortLink || null},
        ${assignedRole},
        ${commissionRate ?? 10},
        ${commissionType ?? "deposit"}
      )
      RETURNING id, username, name, ref_code, short_link, role, commission_rate, commission_type
    `

    return NextResponse.json({ success: true, partner: result[0] })
  } catch (err: any) {
    console.error("[create-partner] error:", err)
    return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi. Lütfen tekrar deneyin." }, { status: 500 })
  }
}
