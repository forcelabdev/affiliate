import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyToken } from "@/lib/auth"

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("x-auth-token") || ""
    const payload = verifyToken(token)

    if (!payload || (payload.role !== "superadmin" && payload.role !== "admin")) {
      return NextResponse.json({ success: false, message: "Yetki yok." }, { status: 403 })
    }

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ success: false, message: "Veritabanı URL yok." }, { status: 500 })
    }

    // Get partner list directly from Neon
    const sql = neon(databaseUrl)
    const partners = await sql`
      SELECT id, username, name, ref_code
      FROM affiliate_users
      WHERE role = 'partner'
      ORDER BY name
    `

    return NextResponse.json({
      success: true,
      data: partners.map((p: any) => ({
        _id: p.id,
        username: p.username,
        name: p.name || p.username,
      })),
    })
  } catch (err) {
    console.error("[v0] Partners list error:", err)
    return NextResponse.json({ success: false, message: "Hata oluştu." }, { status: 500 })
  }
}
