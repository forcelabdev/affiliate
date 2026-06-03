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
    const { username, name, refCode, shortLink, commissionRate, commissionType, newPassword } = body

    if (!username) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı zorunludur." }, { status: 400 })
    }

    const { neon } = await import("@neondatabase/serverless")
    const sql = neon(databaseUrl)

    // Ensure short_link column exists
    try {
      await sql`ALTER TABLE affiliate_users ADD COLUMN IF NOT EXISTS short_link TEXT`
    } catch (_) {}

    // If new password provided, hash it
    if (newPassword && newPassword.trim()) {
      const hashed = await bcrypt.hash(newPassword, 12)
      await sql`
        UPDATE affiliate_users
        SET
          name            = ${name || username},
          ref_code        = ${refCode},
          short_link      = ${shortLink || null},
          commission_rate = ${commissionRate ?? 10},
          commission_type = ${commissionType ?? "deposit"},
          password        = ${hashed}
        WHERE username = ${username}
      `
    } else {
      await sql`
        UPDATE affiliate_users
        SET
          name            = ${name || username},
          ref_code        = ${refCode},
          short_link      = ${shortLink || null},
          commission_rate = ${commissionRate ?? 10},
          commission_type = ${commissionType ?? "deposit"}
        WHERE username = ${username}
      `
    }

    const updated = await sql`
      SELECT id, username, name, ref_code, short_link, role, commission_rate, commission_type
      FROM affiliate_users WHERE username = ${username}
    `

    return NextResponse.json({ success: true, partner: updated[0] })
  } catch (err: any) {
    console.error("[edit-partner] error:", err)
    return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi. Lütfen tekrar deneyin." }, { status: 500 })
  }
}
