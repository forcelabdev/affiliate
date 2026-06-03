import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { neon } from "@neondatabase/serverless"

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkiniz yok." }, { status: 403 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })

  const body = await req.json()
  const partnerId = parseInt(body.partnerId, 10)
  const enabled: boolean = Boolean(body.enabled)
  const threshold: number = Math.max(1, parseInt(body.threshold ?? "1000", 10))
  const goal: number = Math.max(1, parseInt(body.goal ?? "10000", 10))
  const startDate: string | null = body.startDate ? String(body.startDate) : null

  if (!partnerId || isNaN(partnerId)) {
    return NextResponse.json({ success: false, message: "Geçersiz partner ID." }, { status: 400 })
  }

  const sql = neon(dbUrl)

  const rows = await sql`
    UPDATE affiliate_users
    SET ticket_enabled    = ${enabled},
        ticket_threshold  = ${threshold},
        ticket_goal       = ${goal},
        ticket_start_date = ${startDate ? new Date(startDate) : null}
    WHERE id = ${partnerId}
    RETURNING id, username, ticket_enabled, ticket_threshold, ticket_goal, ticket_start_date
  `

  if (!rows[0]) return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })

  return NextResponse.json({
    success: true,
    message: enabled ? "Bilet sistemi aktif edildi." : "Bilet sistemi pasif edildi.",
    partner: rows[0],
  })
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  if (session.role !== "superadmin" && session.role !== "admin") {
    return NextResponse.json({ success: false, message: "Yetkiniz yok." }, { status: 403 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })

  const sql = neon(dbUrl)
  const { searchParams } = new URL(req.url)
  const partnerId = searchParams.get("partnerId")

  if (!partnerId) return NextResponse.json({ success: false, message: "partnerId gerekli." }, { status: 400 })

  const rows = await sql`
    SELECT id, username, ticket_enabled, ticket_threshold, ticket_goal, ticket_start_date
    FROM affiliate_users
    WHERE id = ${parseInt(partnerId, 10)}
    LIMIT 1
  `

  if (!rows[0]) return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })

  return NextResponse.json({ success: true, settings: rows[0] })
}
