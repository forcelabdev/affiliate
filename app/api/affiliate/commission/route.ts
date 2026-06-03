import { NextRequest, NextResponse } from "next/server"
import { getAffiliateUsers, setCommissionOverride, getCommissionOverride } from "@/lib/auth"
import { requireAuth } from "@/lib/api-auth"

// GET /api/affiliate/commission — list all partners with their current commission settings
export async function GET(req: NextRequest) {
  const session = requireAuth(req)
  if (!session) return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ success: false, message: "Sadece admin erişebilir." }, { status: 403 })

  const users = getAffiliateUsers()
  const partners = users
    .filter((u) => u.role === "partner")
    .map((u) => {
      const override = getCommissionOverride(u.username)
      return {
        username: u.username,
        name: u.name || u.username,
        affiliateId: u.affiliateId || "",
        commissionRate: override?.rate ?? u.commissionRate ?? 10,
        commissionType: override?.type ?? u.commissionType ?? "deposit",
      }
    })

  return NextResponse.json({ success: true, partners })
}

// POST /api/affiliate/commission — set commission for a partner
export async function POST(req: NextRequest) {
  const session = requireAuth(req)
  if (!session) return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ success: false, message: "Sadece admin erişebilir." }, { status: 403 })

  try {
    const body = await req.json()
    const { username, commissionRate, commissionType } = body

    if (!username) return NextResponse.json({ success: false, message: "username gerekli." }, { status: 400 })

    const rate = Number(commissionRate)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return NextResponse.json({ success: false, message: "Komisyon oranı 0–100 arasında olmalı." }, { status: 400 })
    }

    const type = commissionType === "net" ? "net" : "deposit"
    setCommissionOverride(username, rate, type)

    return NextResponse.json({ success: true, message: "Komisyon güncellendi.", username, commissionRate: rate, commissionType: type })
  } catch {
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
