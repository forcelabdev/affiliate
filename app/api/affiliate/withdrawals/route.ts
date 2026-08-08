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
  const startDateParam = searchParams.get("startDate")
  const endDateParam = searchParams.get("endDate")

  // superadmin and admin can see all withdrawals with no refCode filter.
  const isAdminAll = (session.role === "superadmin" || session.role === "admin") && !requestedCode
  const refCode = isAdminAll
    ? null
    : session.refCode || requestedCode || null

  if (!isAdminAll && !refCode) {
    return NextResponse.json({ success: false, message: "Ref kodu bulunamadı." }, { status: 400 })
  }

  try {
    await connectDB()
    const users = mongoose.connection.db!.collection("users")
    const databaseUrl = process.env.DATABASE_URL

    let orConditions: Record<string, unknown>[] = []

    if (isAdminAll) {
      // Superadmin: tüm referral kullanıcıları
      const allPartnerIds: any[] = (await users.distinct("affiliates.referrer")).filter(Boolean)
      const allReferrerUsernames: string[] = (await users.distinct("affiliates.referrerUsername")).filter((v: any) => v && typeof v === "string")
      orConditions = [{ "affiliates.redeemedCode": { $exists: true, $ne: null } }]
      if (allPartnerIds.length > 0) orConditions.push({ "affiliates.referrer": { $in: allPartnerIds } })
      if (allReferrerUsernames.length > 0) orConditions.push({ "affiliates.referrerUsername": { $in: allReferrerUsernames } })
    } else {
      // Get partner username from Neon to match transferred users
      let partnerUsername: string | null = null
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const partners = await sql`SELECT username FROM affiliate_users WHERE ref_code = ${refCode}`
          if (partners && partners.length > 0) {
            partnerUsername = partners[0].username
          }
        } catch (neonErr) {
          console.warn("[withdrawals] Failed to fetch partner from Neon:", neonErr)
        }
      }

      const partner = await users.findOne(
        { $or: [{ "affiliates.code": refCode }, { username: session.username }] },
        { projection: { _id: 1, "affiliates.code": 1 } }
      )
      const partnerMongoCode = partner?.affiliates?.code

      orConditions = [
        { "affiliates.redeemedCode": refCode },
        { "affiliates.referrerUsername": refCode },
      ]
      if (partner) orConditions.push({ "affiliates.referrer": partner._id })
      if (partnerUsername && partnerUsername !== refCode) orConditions.push({ "affiliates.referrerUsername": partnerUsername })
      if (partnerMongoCode && partnerMongoCode !== refCode) orConditions.push({ "affiliates.redeemedCode": partnerMongoCode })
    }

    const userDocs = await users.find({ $or: orConditions }, {
      projection: { name: 1, username: 1, "affiliates.redeemedCode": 1, "affiliates.referredAt": 1, createdAt: 1 },
    }).toArray()

    if (userDocs.length === 0) {
      return NextResponse.json({ success: true, refCode, data: [] })
    }

    const userIds = userDocs.map((u: any) => u._id)

    // Build date range
    const startDate = startDateParam ? new Date(parseInt(startDateParam)) : null
    const endDate = endDateParam ? new Date(parseInt(endDateParam)) : null
    const dateRange: Record<string, unknown> = {}
    if (startDate) dateRange.$gte = startDate
    if (endDate) dateRange.$lte = endDate

    const approvedStatuses = ["approved", "completed", "success", "confirmed"]

    const financeTx = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTx = mongoose.connection.db!.collection("meeldevtransactions")
    const fluxTx = mongoose.connection.db!.collection("fluxkriptotransactions")
    const xpayTx = mongoose.connection.db!.collection("xpaymenttransactions")

    // Withdrawal queries for all collections
    const forcelabWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      providerType: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) forcelabWithdrawQuery.createdAt = dateRange

    const meelWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) meelWithdrawQuery.createdAt = dateRange

    const fluxWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) fluxWithdrawQuery.createdAt = dateRange

    const xpayWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) xpayWithdrawQuery.createdAt = dateRange

    // Fetch from all collections in parallel
    const [forcelabWithdrawals, meelWithdrawals, fluxWithdrawals, xpayWithdrawals] = await Promise.all([
      financeTx.find(forcelabWithdrawQuery, { projection: { user: 1, amount: 1, createdAt: 1, status: 1 } }).toArray(),
      meeldevTx.find(meelWithdrawQuery, { projection: { user: 1, amount: 1, createdAt: 1, status: 1 } }).toArray(),
      fluxTx.find(fluxWithdrawQuery, { projection: { user: 1, amount: 1, createdAt: 1, status: 1 } }).toArray(),
      xpayTx.find(xpayWithdrawQuery, { projection: { user: 1, amount: 1, createdAt: 1, status: 1 } }).toArray(),
    ])

    // Map user ObjectIds to usernames for display
    const userMap: Record<string, string> = {}
    userDocs.forEach((u: any) => {
      userMap[u._id.toString()] = u.username
    })

    // Merge all withdrawals from all sources
    const allWithdrawals = [
      ...forcelabWithdrawals.map((w: any) => ({ ...w, _source: "forcelab" })),
      ...meelWithdrawals.map((w: any) => ({ ...w, _source: "meeldev" })),
      ...fluxWithdrawals.map((w: any) => ({ ...w, _source: "fluxkripto" })),
      ...xpayWithdrawals.map((w: any) => ({ ...w, _source: "xpayment" })),
    ]

    const formatted = allWithdrawals.map((w: any) => ({
      _id: w._id?.toString(),
      username: userMap[w.user?.toString()] || "",
      amount: w.amount || 0,
      status: w.status || "approved",
      source: w._source,
      createdAt: w.createdAt?.toISOString?.() ?? String(w.createdAt ?? ""),
    }))

    formatted.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))

    return NextResponse.json({ success: true, refCode, data: formatted })
  } catch (err) {
    console.error("[withdrawals] error:", err)
    return NextResponse.json({ success: false, message: "Veri alınamadı." }, { status: 500 })
  }
}
