import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { neon } from "@neondatabase/serverless"
import bcrypt from "bcryptjs"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  if (auth.session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return NextResponse.json({ success: false, message: "DB hatası." }, { status: 500 })

  const sql = neon(databaseUrl)
  // Ensure columns exist for older installs
  await sql`ALTER TABLE affiliate_applications ADD COLUMN IF NOT EXISTS telegram TEXT`
  await sql`ALTER TABLE affiliate_applications ADD COLUMN IF NOT EXISTS teams TEXT`
  const rows = await sql`
    SELECT id, username, name, email, website_url, country, currency, telegram, teams, status, reviewed_by, reviewed_at, created_at
    FROM affiliate_applications
    ORDER BY created_at DESC
  `
  return NextResponse.json({ success: true, applications: rows })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  if (auth.session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const body = await req.json()
  const { id, action, refCode, commissionRate, commissionType } = body
  // action: "approve" | "reject"

  if (!id || !action) {
    return NextResponse.json({ success: false, message: "id ve action zorunludur." }, { status: 400 })
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return NextResponse.json({ success: false, message: "DB hatası." }, { status: 500 })

  const sql = neon(databaseUrl)

  const apps = await sql`SELECT * FROM affiliate_applications WHERE id = ${id}`
  if (!apps.length) {
    return NextResponse.json({ success: false, message: "Başvuru bulunamadı." }, { status: 404 })
  }
  const app = apps[0]

  if (action === "reject") {
    await sql`
      UPDATE affiliate_applications
      SET status = 'rejected', reviewed_by = ${auth.session.username}, reviewed_at = NOW()
      WHERE id = ${id}
    `
    return NextResponse.json({ success: true, message: "Başvuru reddedildi." })
  }

  if (action === "approve") {
    if (!refCode) {
      return NextResponse.json({ success: false, message: "Onay için ref kodu zorunludur." }, { status: 400 })
    }

    // Check ref code uniqueness
    const refExists = await sql`SELECT id FROM affiliate_users WHERE ref_code = ${refCode}`
    if (refExists.length > 0) {
      return NextResponse.json({ success: false, message: "Bu ref kodu zaten kullanılıyor." }, { status: 409 })
    }

    // Create affiliate_user
    await sql`
      INSERT INTO affiliate_users (username, password, name, ref_code, role, commission_rate, commission_type)
      VALUES (
        ${app.username},
        ${app.password},
        ${app.name || app.username},
        ${refCode},
        'partner',
        ${commissionRate ?? 10},
        ${commissionType ?? 'deposit'}
      )
    `

    // Mark application approved
    await sql`
      UPDATE affiliate_applications
      SET status = 'approved', reviewed_by = ${auth.session.username}, reviewed_at = NOW()
      WHERE id = ${id}
    `

    return NextResponse.json({ success: true, message: "Başvuru onaylandı, partner oluşturuldu." })
  }

  return NextResponse.json({ success: false, message: "Geçersiz action." }, { status: 400 })
}
