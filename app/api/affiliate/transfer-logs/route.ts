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
      return NextResponse.json({ success: false, message: "DATABASE_URL not set" }, { status: 500 })
    }

    const sql = neon(databaseUrl)

    // Ensure log table exists (auto-create if missing)
    await sql`CREATE TABLE IF NOT EXISTS affiliate_transfer_logs (id SERIAL PRIMARY KEY, from_username TEXT NOT NULL, to_partner_username TEXT NOT NULL, performed_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`

    // Fetch last 50 transfers from Neon, sorted by newest first
    const transfers = await sql`
      SELECT 
        id,
        from_username as "fromUsername",
        to_partner_username as "toPartnerUsername",
        performed_by as "performedBy",
        status,
        created_at as "timestamp",
        reason
      FROM affiliate_transfer_logs
      ORDER BY created_at DESC
      LIMIT 50
    `

    return NextResponse.json({
      success: true,
      data: transfers.map((t: any) => ({
        id: t.id,
        fromUsername: t.fromUsername,
        toPartnerUsername: t.toPartnerUsername,
        performedBy: t.performedBy,
        status: t.status,
        timestamp: t.timestamp,
        reason: t.reason,
      })),
    })
  } catch (err) {
    console.error("[v0] Transfer logs error:", err)
    return NextResponse.json({ success: false, message: "Hata oluştu." }, { status: 500 })
  }
}
