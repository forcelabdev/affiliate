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

    // Ensure table and all columns exist
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
    await sql`ALTER TABLE affiliate_transfer_logs ADD COLUMN IF NOT EXISTS from_partner_username TEXT`
    await sql`ALTER TABLE affiliate_transfer_logs ADD COLUMN IF NOT EXISTS transfer_type TEXT NOT NULL DEFAULT 'unassigned_to_partner'`

    const transfers = await sql`
      SELECT
        id,
        from_username          AS "fromUsername",
        to_partner_username    AS "toPartnerUsername",
        from_partner_username  AS "fromPartnerUsername",
        transfer_type          AS "transferType",
        performed_by           AS "performedBy",
        status,
        created_at             AS "timestamp",
        reason
      FROM affiliate_transfer_logs
      ORDER BY created_at DESC
      LIMIT 200
    `

    return NextResponse.json({
      success: true,
      data: (transfers as any[]).map((t) => ({
        id:                  t.id,
        fromUsername:        t.fromUsername,
        toPartnerUsername:   t.toPartnerUsername,
        fromPartnerUsername: t.fromPartnerUsername ?? null,
        transferType:        t.transferType ?? "unassigned_to_partner",
        performedBy:         t.performedBy,
        status:              t.status,
        timestamp:           t.timestamp,
        reason:              t.reason,
      })),
    })
  } catch (err) {
    console.error("[transfer-logs] error:", err)
    return NextResponse.json({ success: false, message: "Hata oluştu." }, { status: 500 })
  }
}
