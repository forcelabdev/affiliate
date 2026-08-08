import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"
import { getManualTotalsForUsers } from "@/lib/manual-balance"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  const { searchParams } = new URL(req.url)

  const requestedCode = searchParams.get("refCode")
  const isAdmin = session.role === "admin" || session.role === "superadmin"
  const isAdminAll = isAdmin && !requestedCode && !session.refCode
  let refCode = isAdmin ? requestedCode || session.refCode || null : session.refCode

  // Partner kendi kodunu göremiyorsa MongoDB'den çek
  if (!refCode && !isAdminAll && session.username) {
    try {
      await connectDB()
      const usersColTemp = mongoose.connection.db!.collection("users")
      const partnerDoc = await usersColTemp.findOne(
        { username: session.username },
        { projection: { "affiliates.code": 1 } }
      )
      if (partnerDoc?.affiliates?.code) refCode = partnerDoc.affiliates.code
    } catch (_) {}
  }

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
      { projection: { _id: 1, username: 1 } }
    ).toArray()

    const totalReferrals = referralUsers.length
    const userIds = referralUsers.map((u: any) => u._id)

    // Total approved deposits (tüm zamanlar) from all payment collections (bonus hariç)
    const financeTx = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTx = mongoose.connection.db!.collection("meeldevtransactions")
    const fluxTx    = mongoose.connection.db!.collection("fluxkriptotransactions")
    const xpayTx    = mongoose.connection.db!.collection("xpaymenttransactions")
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]

    let totalDeposits = 0
    let depositBreakdown = { forcelab: 0, meeldev: 0, filux: 0, xpayment: 0, manual: 0 }
    if (userIds.length > 0) {
      const [forcelabAgg, meeldevAgg, fluxAgg, xpayAgg] = await Promise.all([
        financeTx.aggregate([
          {
            $match: {
              user: { $in: userIds },
              providerType: "deposit",
              status: { $in: approvedStatuses },
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
              providerName: { $not: { $regex: /bonus/i } },
              providerSlug: { $not: { $regex: /bonus/i } },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray(),
        fluxTx.aggregate([
          {
            $match: {
              user: { $in: userIds },
              type: "deposit",
              status: { $in: approvedStatuses },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray(),
        xpayTx.aggregate([
          {
            $match: {
              user: { $in: userIds },
              type: "deposit",
              status: { $in: approvedStatuses },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray(),
      ])
      const forcelabTotal = forcelabAgg[0]?.total ?? 0
      const meeldevTotal  = meeldevAgg[0]?.total ?? 0
      const fluxTotal     = fluxAgg[0]?.total ?? 0
      const xpayTotal     = xpayAgg[0]?.total ?? 0
      totalDeposits = forcelabTotal + meeldevTotal + fluxTotal + xpayTotal
      depositBreakdown = { forcelab: forcelabTotal, meeldev: meeldevTotal, filux: fluxTotal, xpayment: xpayTotal, manual: 0 }
    }

    // Manuel (görsel amaçlı) yatırım toplamlarını genel bakış kartlarına dahil et
    let manualDepositsTotal = 0
    if (referralUsers.length > 0) {
      const manualTotalsByUsername = await getManualTotalsForUsers(referralUsers.map((u: any) => u.username))
      manualDepositsTotal = Object.values(manualTotalsByUsername).reduce((s, t) => s + t.deposit, 0)
    }
    totalDeposits += manualDepositsTotal
    depositBreakdown.manual = manualDepositsTotal

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
        depositBreakdown,
      },
    })
  } catch (err) {
    console.error("[affiliate/info] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
