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
  const endDateParam   = searchParams.get("endDate")
  const isAdmin = session.role === "admin" || session.role === "superadmin"
  let refCode: string | null | undefined = isAdmin ? requestedCode || session.refCode : session.refCode || requestedCode

  // If no refCode, try to resolve from ?id= param via Neon
  if (!refCode && !isAdmin) {
    const affiliateId = searchParams.get("id")
    const dbUrl = process.env.DATABASE_URL
    if (affiliateId && dbUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sqlLookup = neon(dbUrl)
        const rows = await sqlLookup`SELECT ref_code FROM affiliate_users WHERE id = ${parseInt(affiliateId, 10)} LIMIT 1`
        const rc = rows?.[0]?.ref_code
        if (rc && rc !== "NULL" && rc !== "null") refCode = rc as string
      } catch (e) { console.warn("[deposits] id→refCode lookup error:", e) }
    }
  }

  try {
    await connectDB()
    const users = mongoose.connection.db!.collection("users")
    const databaseUrl = process.env.DATABASE_URL

    let orConditions: Record<string, unknown>[] = []

    if (!refCode && isAdmin) {
      // Superadmin: tüm partnerlerin referral kullanıcılarını çek
      let allCodes: string[] = []
      let allUsernames: string[] = []
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code IS NOT NULL`
          allCodes = rows.map((r: any) => r.ref_code)
          allUsernames = rows.map((r: any) => r.username)
        } catch (e) { console.warn("[deposits] Neon error:", e) }
      }
      const mongoPartners = await users.find(
        { "affiliates.code": { $in: allCodes } },
        { projection: { _id: 1 } }
      ).toArray()
      orConditions = [
        { "affiliates.redeemedCode": { $in: allCodes } },
        { "affiliates.referrerUsername": { $in: [...allCodes, ...allUsernames] } },
        { "affiliates.referrer": { $in: mongoPartners.map((p: any) => p._id) } },
      ]
    } else {
      if (!refCode) return NextResponse.json({ success: false, message: "Ref kodu bulunamadı." }, { status: 400 })

      // Get partner info from Neon to match transferred users
      let partnerUsername: string | null = null
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const partners = await sql`SELECT username FROM affiliate_users WHERE ref_code = ${refCode}`
          if (partners && partners.length > 0) partnerUsername = partners[0].username
        } catch (neonErr) {
          console.warn("[v0] Failed to fetch partner from Neon:", neonErr)
        }
      }

      const partner = await users.findOne({ "affiliates.code": refCode }, { projection: { _id: 1 } })

      orConditions = [{ "affiliates.redeemedCode": refCode }, { "affiliates.referrerUsername": refCode }]
      if (partner) orConditions.push({ "affiliates.referrer": partner._id })
      if (partnerUsername) orConditions.push({ "affiliates.referrerUsername": partnerUsername })
    }

    const userDocs = await users.find({ $or: orConditions }, {
      projection: { name: 1, username: 1, "affiliates.redeemedCode": 1, "affiliates.referredAt": 1, createdAt: 1 },
    }).toArray()

    if (userDocs.length === 0) {
      return NextResponse.json({ success: true, refCode, referrals: [], totalDeposits: 0, totalWithdrawals: 0 })
    }

    const userIds = userDocs.map((u: any) => u._id)

    // Use startDate from client (Türkiye saati ile hesaplanmış)
    const startDate = startDateParam ? new Date(parseInt(startDateParam)) : null
    const endDate   = endDateParam   ? new Date(parseInt(endDateParam))   : null

    const financeTx  = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTx  = mongoose.connection.db!.collection("meeldevtransactions")
    const fluxTx     = mongoose.connection.db!.collection("fluxkriptotransactions")
    const xpayTx     = mongoose.connection.db!.collection("xpaymenttransactions")
    const dateRange: Record<string, unknown> = {}
    if (startDate) dateRange.$gte = startDate
    if (endDate)   dateRange.$lte = endDate

    const approvedStatuses = ["approved", "completed", "success", "confirmed"]

    // --- forcelabfinancetransactions ---
    const depositQuery: Record<string, unknown> = {
      user: { $in: userIds },
      providerType: "deposit",
      status: { $in: approvedStatuses },
      providerName: { $not: { $regex: /bonus/i } },
      providerSlug: { $not: { $regex: /bonus/i } },
    }
    if (startDate || endDate) depositQuery.createdAt = dateRange

    const withdrawalQuery: Record<string, unknown> = {
      user: { $in: userIds },
      providerType: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) withdrawalQuery.createdAt = dateRange

    // --- meeldevtransactions ---
    const meelDepositQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: "deposit",
      status: { $in: approvedStatuses },
      providerName: { $not: { $regex: /bonus/i } },
      providerSlug: { $not: { $regex: /bonus/i } },
    }
    if (startDate || endDate) meelDepositQuery.createdAt = dateRange

    const meelWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) meelWithdrawQuery.createdAt = dateRange

    // --- fluxkriptotransactions (type: "deposit", status: "approved") ---
    const fluxDepositQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: "deposit",
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) fluxDepositQuery.createdAt = dateRange

    const fluxWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) fluxWithdrawQuery.createdAt = dateRange

    // --- xpaymenttransactions (type: "deposit", status: "approved") ---
    const xpayDepositQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: "deposit",
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) xpayDepositQuery.createdAt = dateRange

    const xpayWithdrawQuery: Record<string, unknown> = {
      user: { $in: userIds },
      type: { $in: ["withdraw", "withdrawal"] },
      status: { $in: approvedStatuses },
    }
    if (startDate || endDate) xpayWithdrawQuery.createdAt = dateRange

    // Tüm koleksiyonları paralel çek
    const [transfers, withdrawals, meelDeposits, meelWithdraws, fluxDeposits, fluxWithdraws, xpayDeposits, xpayWithdraws] = await Promise.all([
      financeTx.find(depositQuery,      { projection: { user: 1, amount: 1, status: 1, createdAt: 1, providerName: 1 } }).toArray(),
      financeTx.find(withdrawalQuery,   { projection: { user: 1, amount: 1, createdAt: 1 } }).toArray(),
      meeldevTx.find(meelDepositQuery,  { projection: { user: 1, amount: 1, status: 1, createdAt: 1, providerName: 1 } }).toArray(),
      meeldevTx.find(meelWithdrawQuery, { projection: { user: 1, amount: 1, createdAt: 1 } }).toArray(),
      fluxTx.find(fluxDepositQuery,     { projection: { user: 1, amount: 1, status: 1, createdAt: 1, currency: 1 } }).toArray(),
      fluxTx.find(fluxWithdrawQuery,    { projection: { user: 1, amount: 1, createdAt: 1 } }).toArray(),
      xpayTx.find(xpayDepositQuery,     { projection: { user: 1, amount: 1, status: 1, createdAt: 1, "account.bankName": 1 } }).toArray(),
      xpayTx.find(xpayWithdrawQuery,    { projection: { user: 1, amount: 1, createdAt: 1 } }).toArray(),
    ])

    // Group by userId — tüm kaynaklardan gelen tutarları topla
    const depositByUser: Record<string, number> = {}
    const withdrawalByUser: Record<string, number> = {}
    const txByUser: Record<string, { txId: string; source: string; amount: number; status: string; createdAt: string; method?: string }[]> = {}

    const addDeposit = (t: any, source: string, method?: string) => {
      const uid = String(t.user)
      depositByUser[uid] = (depositByUser[uid] ?? 0) + (t.amount ?? 0)
      if (!txByUser[uid]) txByUser[uid] = []
      txByUser[uid].push({ txId: String(t._id), source, amount: t.amount ?? 0, status: t.status ?? "approved", createdAt: t.createdAt?.toISOString?.() ?? String(t.createdAt ?? ""), method })
    }

    for (const t of transfers)   addDeposit(t, "forcelab",   t.providerName)
    for (const t of meelDeposits) addDeposit(t, "meeldev",   t.providerName)
    for (const t of fluxDeposits) addDeposit(t, "fluxkripto", t.currency ?? "USDT")
    for (const t of xpayDeposits) addDeposit(t, "xpayment",  t.account?.bankName)

    for (const t of [...withdrawals, ...meelWithdraws, ...fluxWithdraws, ...xpayWithdraws]) {
      const uid = String(t.user)
      withdrawalByUser[uid] = (withdrawalByUser[uid] ?? 0) + (t.amount ?? 0)
    }

    // Build ref_code → partner username map from Neon
    const codeToPartner: Record<string, string> = {}
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code IS NOT NULL`
        for (const row of rows) {
          if (row.ref_code && row.ref_code !== "NULL") {
            codeToPartner[row.ref_code] = row.username
          }
        }
      } catch (e) { console.warn("[deposits] codeToPartner Neon error:", e) }
    }

    const referrals = userDocs.map((u: any) => {
      const uid = String(u._id)
      const redeemedCode = u.affiliates?.redeemedCode
      // En son tx tarihini üst seviye createdAt olarak ver
      const userTxs = txByUser[uid] ?? []
      const latestTx = userTxs.length > 0
        ? userTxs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        : null
      return {
        _id: uid, name: u.name, username: u.username,
        depositTotal: depositByUser[uid] ?? 0,
        withdrawalTotal: withdrawalByUser[uid] ?? 0,
        redeemedCode,
        partnerName: redeemedCode ? (codeToPartner[redeemedCode] ?? redeemedCode) : null,
        referredAt: u.affiliates?.referredAt ?? u.createdAt,
        createdAt: latestTx?.createdAt ?? u.createdAt?.toISOString?.() ?? String(u.createdAt ?? ""),
        deposits: userTxs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      }
    }).sort((a, b) => b.depositTotal - a.depositTotal)

    const totalDeposits = referrals.reduce((s, r) => s + r.depositTotal, 0)
    const totalWithdrawals = referrals.reduce((s, r) => s + r.withdrawalTotal, 0)

    return NextResponse.json({ success: true, refCode, referrals, totalDeposits, totalWithdrawals })
  } catch (err) {
    console.error("[affiliate/deposits] MongoDB error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
