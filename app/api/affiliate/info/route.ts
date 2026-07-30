import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  const { searchParams } = new URL(req.url)

  const requestedCode = searchParams.get("refCode")
  const isAdmin = session.role === "admin" || session.role === "superadmin"
  const isAdminAll = isAdmin && !requestedCode && !session.refCode
  const refCode = isAdmin ? requestedCode || session.refCode || null : session.refCode
  if (!refCode && !isAdminAll) return NextResponse.json({ success: false, message: "Ref kodu bulunamadı." }, { status: 400 })

  try {
    await connectDB()
    const usersCol = mongoose.connection.db!.collection("users")
    const databaseUrl = process.env.DATABASE_URL

    let orConditions: Record<string, unknown>[] = []
    let commissionRateOverride: number | null = null

    if (isAdminAll) {
      // Superadmin no refCode: aggregate ALL referral users directly from MongoDB
      // Use MongoDB's own distinct redeemedCode values — do NOT filter by Neon ref_codes
      // because Neon ref_codes (REF001, testreff…) may not match MongoDB's actual values.
      const allRedeemedCodes: string[] = (
        await usersCol.distinct("affiliates.redeemedCode")
      ).filter((c: any) => c && typeof c === "string")

      const allPartnerIds: any[] = (
        await usersCol.distinct("affiliates.referrer")
      ).filter(Boolean)

      const allReferrerUsernames: string[] = (
        await usersCol.distinct("affiliates.referrerUsername")
      ).filter((v: any) => v && typeof v === "string")

      orConditions = [
        { "affiliates.redeemedCode": { $exists: true, $ne: null } },
      ]
      if (allPartnerIds.length > 0) {
        orConditions.push({ "affiliates.referrer": { $in: allPartnerIds } })
      }
      if (allReferrerUsernames.length > 0) {
        orConditions.push({ "affiliates.referrerUsername": { $in: allReferrerUsernames } })
      }
    } else {
      // Single partner mode
      // 1) Try Neon for commission rate
      let partnerUsername: string | null = null
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const partners = await sql`SELECT username, commission_rate FROM affiliate_users WHERE ref_code = ${refCode} OR username = ${session.username}`
          if (partners && partners.length > 0) {
            partnerUsername = partners[0].username
            commissionRateOverride = partners[0].commission_rate ?? null
          }
        } catch (e) { console.warn("[affiliate/info] Neon error:", e) }
      }

      // 2) Find partner in MongoDB by affiliates.code OR by username
      const partner = await usersCol.findOne(
        { $or: [{ "affiliates.code": refCode }, { username: session.username }] },
        { projection: { _id: 1, username: 1, name: 1, affiliates: 1 } }
      )

      // 3) Build broad match — include the partner's own affiliates.code too
      const partnerMongoCode = partner?.affiliates?.code
      orConditions = [
        { "affiliates.redeemedCode": refCode },
        { "affiliates.referrerUsername": refCode },
      ]
      if (partner) orConditions.push({ "affiliates.referrer": partner._id })
      if (partnerUsername && partnerUsername !== refCode) {
        orConditions.push({ "affiliates.referrerUsername": partnerUsername })
      }
      if (partnerMongoCode && partnerMongoCode !== refCode) {
        orConditions.push({ "affiliates.redeemedCode": partnerMongoCode })
      }
    }

    const referralUsers = await usersCol.find(
      { $or: orConditions },
      { projection: { _id: 1 } }
    ).toArray()

    const totalReferrals = referralUsers.length
    const userIds = referralUsers.map((u: any) => u._id)

    // Current month range (Türkiye saati ile — same as referrals)
    const trDate = new Date()
    const offset = trDate.getTimezoneOffset()
    const trNow = new Date(trDate.getTime() - offset * 60 * 1000)
    const monthStart = new Date(trNow.getFullYear(), trNow.getMonth(), 1)
    const monthEnd = new Date(trNow.getFullYear(), trNow.getMonth() + 1, 1)
    monthEnd.setMilliseconds(-1)

    // Total approved deposits this month from both forcelab and meeldev (bonus hariç)
    const financeTx = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTx = mongoose.connection.db!.collection("meeldevtransactions")
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]

    let totalDeposits = 0
    if (userIds.length > 0) {
      const [forcelabAgg, meeldevAgg] = await Promise.all([
        financeTx.aggregate([
          {
            $match: {
              user: { $in: userIds },
              providerType: "deposit",
              status: { $in: approvedStatuses },
              createdAt: { $gte: monthStart, $lte: monthEnd },
              providerName: { $not: { $regex: /bonus/i } },
              providerSlug: { $not: { $regex: /bonus/i } },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray(),
        meeldevTx.aggregate([
          {
            $match: {
              user: { $in: userIds },
              type: "deposit",
              status: { $in: approvedStatuses },
              createdAt: { $gte: monthStart, $lte: monthEnd },
              providerName: { $not: { $regex: /bonus/i } },
              providerSlug: { $not: { $regex: /bonus/i } },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray(),
      ])
      totalDeposits = (forcelabAgg[0]?.total ?? 0) + (meeldevAgg[0]?.total ?? 0)
    }

    // Commission = partner's rate or default 10%
    const commissionRate = commissionRateOverride ?? session.commissionRate ?? 10
    const commission = Math.round(totalDeposits * (commissionRate / 100))

    return NextResponse.json({
      success: true,
      affiliateId: null,
      refCode: refCode || null,
      role: session.role,
      stats: {
        totalReferrals,
        totalDeposits,
        totalEarnings: commission,
        pendingEarnings: commission,
        commissionRate,
      },
    })
  } catch (err) {
    console.error("[affiliate/info] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
