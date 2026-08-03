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
    const fluxTx = db.collection("fluxkriptotransactions")
    const xpayTx = db.collection("xpaymenttransactions")

    // Tüm partnerleri hem Neon'dan hem MongoDB affiliate_users koleksiyonundan çek
    type PartnerRow = { id?: number | string; username: string; ref_code: string; name?: string; commission_rate?: number; commission_type?: string; short_link?: string; ticket_enabled?: boolean; ticket_threshold?: number; ticket_start_date?: string | null }
    let neonPartners: PartnerRow[] = []
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        try { await sql`ALTER TABLE affiliate_users ADD COLUMN IF NOT EXISTS short_link TEXT` } catch (_) {}
        const rows = await sql`SELECT id, username, ref_code, name, commission_rate, commission_type, short_link, ticket_enabled, ticket_threshold, ticket_start_date FROM affiliate_users WHERE ref_code IS NOT NULL AND role IN ('partner', 'affiliate_user')`
        neonPartners = rows as PartnerRow[]
      } catch (e) {
        console.error("[partners] Neon error:", e)
      }
    }

    // Also load from MongoDB affiliate_users collection — these are the REAL partners
    // whose ref_codes actually exist in users.affiliates.redeemedCode
    const mongoAffUsers = await db.collection("affiliate_users").find({}).toArray()
    const neonUsernames = new Set(neonPartners.map((p) => p.username?.toLowerCase()))
    for (const doc of mongoAffUsers) {
      const uname = doc.username || ""
      const rawRef = doc.refCode || doc.ref_code
      if (!rawRef || rawRef === "NULL" || rawRef === "null") continue
      if (neonUsernames.has(uname.toLowerCase())) continue // already in Neon list
      if (doc.role === "superadmin") continue              // skip superadmin
      neonPartners.push({
        id: String(doc._id),
        username: uname,
        ref_code: String(rawRef),
        name: doc.name,
        commission_rate: doc.commissionRate ?? doc.commission_rate ?? 10,
        commission_type: doc.commissionType ?? doc.commission_type ?? "deposit",
        short_link: null,
        ticket_enabled: false,
        ticket_threshold: 1000,
        ticket_start_date: null,
      })
    }

    // Period filtresi: today | week | month | all | custom
    const { searchParams } = new URL(req.url)
    const period = searchParams.get("period") || "month"
    const customStart = searchParams.get("start")
    const customEnd = searchParams.get("end")

    const now = new Date()
    let dateRange: { $gte: Date; $lte: Date } | null = null

    if (period === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      dateRange = { $gte: start, $lte: end }
    } else if (period === "week") {
      const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1 // Mon=0
      const start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - dayOfWeek)
      const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999)
      dateRange = { $gte: start, $lte: end }
    } else if (period === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      end.setMilliseconds(-1)
      dateRange = { $gte: start, $lte: end }
    } else if (period === "custom" && customStart && customEnd) {
      const start = new Date(customStart); start.setHours(0,0,0,0)
      const end = new Date(customEnd); end.setHours(23,59,59,999)
      dateRange = { $gte: start, $lte: end }
    }
    // period === "all" → dateRange kalır null

    // Bulk: fetch ALL users with any affiliates data once to avoid N+1 queries
    // Also gather all redeemedCodes so we can cross-reference unmatched Neon codes
    const allMongoReferralUsers = await usersCol.find(
      { "affiliates.redeemedCode": { $exists: true, $ne: null } },
      { projection: { _id: 1, username: 1, "affiliates.redeemedCode": 1, "affiliates.referrerUsername": 1, "affiliates.referrer": 1 } }
    ).toArray()

    // Build lookup maps
    const byRedeemedCode: Record<string, any[]> = {}
    const byReferrerUsername: Record<string, any[]> = {}
    for (const u of allMongoReferralUsers) {
      const rc = u.affiliates?.redeemedCode
      const ru = u.affiliates?.referrerUsername
      if (rc) { if (!byRedeemedCode[rc]) byRedeemedCode[rc] = []; byRedeemedCode[rc].push(u) }
      if (ru) { if (!byReferrerUsername[ru]) byReferrerUsername[ru] = []; byReferrerUsername[ru].push(u) }
    }

    // Also fetch users who have affiliates.code (i.e. partner accounts in MongoDB)
    const mongoPartnerDocs = await usersCol.find(
      { "affiliates.code": { $exists: true, $ne: null } },
      { projection: { _id: 1, username: 1, "affiliates.code": 1 } }
    ).toArray()
    const mongoCodeToId: Record<string, any> = {}
    for (const p of mongoPartnerDocs) {
      if (p.affiliates?.code) mongoCodeToId[p.affiliates.code] = p._id
    }

    // Her partner için MongoDB stats hesapla
    const partnerStats = await Promise.all(neonPartners.map(async (partner) => {
      const code = partner.ref_code
      const username = partner.username

      // Find this partner's MongoDB ObjectId — try by affiliates.code match OR by username
      const mongoPartner = await usersCol.findOne(
        { $or: [{ "affiliates.code": code }, { username }] },
        { projection: { _id: 1, "affiliates.code": 1 } }
      )
      const partnerMongoCode = mongoPartner?.affiliates?.code

      // Collect unique matching users using our pre-built maps
      const matchedIds = new Set<string>()
      const addUsers = (arr: any[]) => arr.forEach((u: any) => matchedIds.add(String(u._id)))

      // Match by Neon ref_code
      if (byRedeemedCode[code]) addUsers(byRedeemedCode[code])
      if (byReferrerUsername[code]) addUsers(byReferrerUsername[code])
      if (byReferrerUsername[username]) addUsers(byReferrerUsername[username])

      // Match by MongoDB affiliates.code (the actual code stored against the partner user in mongo)
      if (partnerMongoCode && partnerMongoCode !== code) {
        if (byRedeemedCode[partnerMongoCode]) addUsers(byRedeemedCode[partnerMongoCode])
        if (byReferrerUsername[partnerMongoCode]) addUsers(byReferrerUsername[partnerMongoCode])
      }

      // Match by affiliates.referrer (ObjectId reference)
      if (mongoPartner) {
        const refById = allMongoReferralUsers.filter((u: any) =>
          u.affiliates?.referrer && String(u.affiliates.referrer) === String(mongoPartner._id)
        )
        addUsers(refById)
      }

      // Tüm referral user condition'ları (for deposit aggregation)
      const matchedObjectIds = allMongoReferralUsers
        .filter((u: any) => matchedIds.has(String(u._id)))
        .map((u: any) => u._id)

      const totalReferrals = matchedIds.size
      const userIds = matchedObjectIds

      let totalDeposits = 0
      let totalWithdrawals = 0

      if (userIds.length > 0) {
        // Bonus hariç filtre
        const notBonusFilter = {
          providerName: { $not: { $regex: /bonus/i } },
          providerSlug: { $not: { $regex: /bonus/i } },
        }
        const dateFilter = dateRange ? { createdAt: dateRange } : {}
        const [forcelabDepAgg, forcelabWitAgg, meeldevDepAgg, meeldevWitAgg, fluxDepAgg, fluxWitAgg, xpayDepAgg, xpayWitAgg] = await Promise.all([
          // Forcelab deposits
          financeTx.aggregate([
            { $match: { user: { $in: userIds }, providerType: "deposit", status: { $in: approvedStatuses }, ...dateFilter, ...notBonusFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // Forcelab withdrawals
          financeTx.aggregate([
            { $match: { user: { $in: userIds }, providerType: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // Meeldev/Capora deposits
          meeldevTx.aggregate([
            { $match: { user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, ...dateFilter, ...notBonusFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // Meeldev/Capora withdrawals
          meeldevTx.aggregate([
            { $match: { user: { $in: userIds }, type: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // FluxKripto deposits
          fluxTx.aggregate([
            { $match: { user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // FluxKripto withdrawals
          fluxTx.aggregate([
            { $match: { user: { $in: userIds }, type: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // XPayment deposits
          xpayTx.aggregate([
            { $match: { user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
          // XPayment withdrawals
          xpayTx.aggregate([
            { $match: { user: { $in: userIds }, type: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, ...dateFilter } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]).toArray(),
        ])
        totalDeposits = (forcelabDepAgg[0]?.total ?? 0) + (meeldevDepAgg[0]?.total ?? 0) + (fluxDepAgg[0]?.total ?? 0) + (xpayDepAgg[0]?.total ?? 0)
        totalWithdrawals = (forcelabWitAgg[0]?.total ?? 0) + (meeldevWitAgg[0]?.total ?? 0) + (fluxWitAgg[0]?.total ?? 0) + (xpayWitAgg[0]?.total ?? 0)
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
