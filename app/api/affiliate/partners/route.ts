import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/db"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  if (session.role !== "admin" && session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  try {
    await connectDB()
    const db = mongoose.connection.db!
    const usersCol = db.collection("users")
    const financeTx = db.collection("forcelabfinancetransactions")
    const meeldevTx = db.collection("meeldevtransactions")
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]

    // Neon'dan tüm partnerleri çek
    let neonPartners: { username: string; ref_code: string; name?: string; commission_rate?: number; commission_type?: string; short_link?: string }[] = []
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        try { await sql`ALTER TABLE affiliate_users ADD COLUMN IF NOT EXISTS short_link TEXT` } catch (_) {}
        const rows = await sql`SELECT id, username, ref_code, name, commission_rate, commission_type, short_link, ticket_enabled, ticket_threshold, ticket_start_date FROM affiliate_users WHERE ref_code IS NOT NULL AND role IN ('partner', 'affiliate_user')`
        neonPartners = rows as typeof neonPartners
      } catch (e) {
        console.error("[partners] Neon error:", e)
      }
    }

    // Ay başı/sonu (bu ay)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    monthEnd.setMilliseconds(-1)

    // Her partner için MongoDB stats hesapla
    const partnerStats = await Promise.all(neonPartners.map(async (partner) => {
      const code = partner.ref_code
      const username = partner.username

      // MongoDB'de bu partner'ın ObjectId'sini bul
      const mongoPartner = await usersCol.findOne(
        { "affiliates.code": code },
        { projection: { _id: 1 } }
      )

      // Tüm referral user condition'ları
      const orConditions: Record<string, unknown>[] = [
        { "affiliates.redeemedCode": code },
        { "affiliates.referrerUsername": code },
        { "affiliates.referrerUsername": username },
      ]
      if (mongoPartner) orConditions.push({ "affiliates.referrer": mongoPartner._id })

      const referralUsers = await usersCol.find(
        { $or: orConditions },
        { projection: { _id: 1 } }
      ).toArray()

      const totalReferrals = referralUsers.length
      const userIds = referralUsers.map((u: any) => u._id)

      let totalDeposits = 0
      let totalWithdrawals = 0

      if (userIds.length > 0) {
        // Bonus hariç filtre
        const notBonusFilter = {
          providerName: { $not: { $regex: /bonus/i } },
          providerSlug: { $not: { $regex: /bonus/i } },
        }
        const [forcelabDepAgg, forcelabWitAgg, meeldevDepAgg, meeldevWitAgg] = await Promise.all([
          // Forcelab deposits
          financeTx.aggregate([
            { $match: { user: { $in: userIds }, providerType: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...notBonusFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // Forcelab withdrawals
          financeTx.aggregate([
            { $match: { user: { $in: userIds }, providerType: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // Meeldev/Capora deposits
          meeldevTx.aggregate([
            { $match: { user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...notBonusFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // Meeldev/Capora withdrawals
          meeldevTx.aggregate([
            { $match: { user: { $in: userIds }, type: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
        ])
        totalDeposits = (forcelabDepAgg[0]?.total ?? 0) + (meeldevDepAgg[0]?.total ?? 0)
        totalWithdrawals = (forcelabWitAgg[0]?.total ?? 0) + (meeldevWitAgg[0]?.total ?? 0)
      }

      const commissionRate = partner.commission_rate ?? 10
      const totalEarnings = Math.round(totalDeposits * (commissionRate / 100))

      return {
        neonId: (partner as any).id,
        username,
        name: partner.name || username,
        refCode: code,
        shortLink: partner.short_link || null,
        commissionRate,
        commissionType: partner.commission_type || "deposit",
        totalReferrals,
        totalDeposits,
        totalWithdrawals,
        totalEarnings,
        ticketEnabled: (partner as any).ticket_enabled ?? false,
        ticketThreshold: (partner as any).ticket_threshold ?? 1000,
        ticketStartDate: (partner as any).ticket_start_date ?? null,
      }
    }))

    // Deposit'e göre sırala
    partnerStats.sort((a, b) => b.totalDeposits - a.totalDeposits)

    return NextResponse.json({ success: true, partners: partnerStats })
  } catch (err) {
    console.error("[partners] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
