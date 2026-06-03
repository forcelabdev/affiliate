import { NextRequest, NextResponse } from "next/server"
import { verifyToken, getAffiliateUsers, getCommissionOverride, signToken } from "@/lib/auth"

export async function POST(req: NextRequest) {
  try {
    const adminToken = req.headers.get("x-auth-token") || ""
    const session = verifyToken(adminToken)

    if (!session || (session.role !== "admin" && session.role !== "superadmin")) {
      return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
    }

    const body = await req.json()
    // Sanitize input
    const username = typeof body.username === "string" ? body.username.replace(/[${}]/g, "").trim().slice(0, 100) : ""
    if (!username) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı gerekli." }, { status: 400 })
    }

    const users = getAffiliateUsers()
    const target = users.find((u) => u.username.toLowerCase() === username.toLowerCase())

    if (!target) {
      return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })
    }

    const override = getCommissionOverride(target.username)
    const commissionRate = override?.rate ?? target.commissionRate ?? 10
    const commissionType = override?.type ?? target.commissionType ?? "deposit"

    const token = signToken({
      username: target.username,
      role: target.role,
      affiliateId: target.affiliateId,
      refCode: target.refCode,
      name: target.name,
      commissionRate,
      commissionType,
    })

    return NextResponse.json({
      success: true,
      token,
      user: {
        username: target.username,
        name: target.name || target.username,
        role: target.role,
        affiliateId: target.affiliateId,
        refCode: target.refCode,
        commissionRate,
        commissionType,
      },
    })
  } catch (err) {
    console.error("[v0] Impersonate error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
