import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"

// ── Security: simple in-memory rate limiter ──────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(ip: string, maxRequests = 30, windowMs = 60_000): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= maxRequests) return false
  entry.count++
  return true
}

// ── Security: sanitize string inputs (prevent NoSQL injection) ───────────────
function sanitizeString(val: unknown): string {
  if (typeof val !== "string") return ""
  // Reject if contains MongoDB operator characters
  if (/[{}$]/.test(val)) return ""
  return val.trim().slice(0, 200)
}
// ────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Rate limiting ──────────────────────────────────────────────────────────
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ success: false, message: "Too many requests." }, { status: 429 })
  }

  // ── Block non-GET methods (belt-and-suspenders) ───────────────────────────
  if (req.method !== "GET") {
    return NextResponse.json({ success: false, message: "Method not allowed." }, { status: 405 })
  }

  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  const { searchParams } = new URL(req.url)

  // ── Sanitize inputs — prevent NoSQL injection ─────────────────────────────
  const rawCode = searchParams.get("refCode") || searchParams.get("code")
  const requestedCode = sanitizeString(rawCode)
  const isAdminAll = (session.role === "admin" || session.role === "superadmin") && !requestedCode
  // For partners: always resolve refCode — from session, URL param, or Neon lookup by id
  let refCode: string | null = isAdminAll ? null : (session.role === "admin" || session.role === "superadmin")
    ? requestedCode || session.refCode || null
    : session.refCode || requestedCode || null

  console.log("[v0] referrals GET — user:", session.username, "role:", session.role, "session.refCode:", session.refCode, "requestedCode:", requestedCode, "id param:", searchParams.get("id"), "refCode resolved so far:", refCode)

  // If still no refCode and we have an id param, look it up from Neon immediately
  if (!isAdminAll && !refCode) {
    const affiliateId = sanitizeString(searchParams.get("id"))
    const dbUrl = process.env.DATABASE_URL
    if (affiliateId && dbUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sqlLookup = neon(dbUrl)
        const rows = await sqlLookup`SELECT ref_code FROM affiliate_users WHERE id = ${parseInt(affiliateId, 10)} LIMIT 1`
        const rc = rows?.[0]?.ref_code
        console.log("[v0] referrals Neon lookup — id:", affiliateId, "rc:", rc)
        if (rc && rc !== "NULL" && rc !== "null") {
          refCode = rc as string
        }
      } catch (e) {
        console.warn("[referrals] early id→refCode lookup error:", e)
      }
    }
  }

  console.log("[v0] referrals final refCode:", refCode, "isAdminAll:", isAdminAll)

  try {
    await connectDB()
    const users = mongoose.connection.db!.collection("users")

    // ---- ADMIN ALL MODE: tüm partnerlerin referrallarını getir ----
    if (isAdminAll) {
      // Neon'dan tüm partnerleri çek
      let allPartners: { username: string; ref_code: string }[] = []
      const databaseUrl = process.env.DATABASE_URL
      if (databaseUrl) {
        try {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(databaseUrl)
          const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code IS NOT NULL`
          allPartners = rows as { username: string; ref_code: string }[]
        } catch (e) {
          console.warn("[referrals] Neon error:", e)
        }
      }

      // MongoDB'deki partner ObjectId'lerini bul
      const partnerCodes = allPartners.map((p) => p.ref_code)
      const partnerUsernames = allPartners.map((p) => p.username)
      const mongoPartners = await users.find(
        { "affiliates.code": { $in: partnerCodes } },
        { projection: { _id: 1, "affiliates.code": 1 } }
      ).toArray()

      const partnerIdToCode: Record<string, string> = {}
      for (const p of mongoPartners) {
        partnerIdToCode[String(p._id)] = p.affiliates?.code
      }

      // Tüm referral koşulları
      const allOrConditions: Record<string, unknown>[] = [
        { "affiliates.redeemedCode": { $in: partnerCodes } },
        { "affiliates.referrerUsername": { $in: [...partnerCodes, ...partnerUsernames] } },
        { "affiliates.referrer": { $in: mongoPartners.map((p: any) => p._id) } },
      ]

      const docs = await users.find(
        { $or: allOrConditions },
        { projection: { name: 1, username: 1, phone: 1, affiliates: 1, createdAt: 1 } }
      ).sort({ createdAt: -1 }).toArray()

      if (docs.length === 0) return NextResponse.json({ success: true, refCode: null, referrals: [] })

      const userIds = docs.map((u: any) => u._id)
      const userIdStrings = userIds.map((id: any) => String(id))
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      monthEnd.setMilliseconds(-1)

      const forcelabTx = mongoose.connection.db!.collection("forcelabfinancetransactions")
      const meeldevTx  = mongoose.connection.db!.collection("meeldevtransactions")
      const meelApprovedAdmin = ["approved", "completed", "success", "confirmed"]

      // Security: only READ operations — no write/update/delete allowed
      // Bonus işlemlerini hariç tut (providerName veya providerSlug "bonus" içeriyorsa)
      const approvedStatuses = ["approved", "completed", "success", "confirmed"]
      const notBonusFilter = { 
        providerName: { $not: { $regex: /bonus/i } },
        providerSlug: { $not: { $regex: /bonus/i } }
      }
      const [deposits, withdrawals, meelDeps, meelWits, rivoUsersAdmin] = await Promise.all([
        forcelabTx.find({ user: { $in: userIds }, providerType: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...notBonusFilter }, { projection: { user: 1, amount: 1 } }).toArray(),
        forcelabTx.find({ user: { $in: userIds }, providerType: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd } }, { projection: { user: 1, amount: 1 } }).toArray(),
        meeldevTx.find({ user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...notBonusFilter }, { projection: { user: 1, amount: 1 } }).toArray(),
        meeldevTx.find({ user: { $in: userIds }, type: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd } }, { projection: { user: 1, amount: 1 } }).toArray(),
        users.find({ _id: { $in: userIds } }, { projection: { _id: 1, wallets: 1 } }).toArray(),
      ])

      const depByUser: Record<string, number> = {}
      const witByUser: Record<string, number> = {}
      const rivoByUserAdmin: Record<string, number> = {}
      for (const t of [...deposits, ...meelDeps]) { const uid = String(t.user); depByUser[uid] = (depByUser[uid] ?? 0) + (t.amount ?? 0) }
      for (const t of [...withdrawals, ...meelWits]) { const uid = String(t.user); witByUser[uid] = (witByUser[uid] ?? 0) + (t.amount ?? 0) }
      for (const u of rivoUsersAdmin) {
        const uid = String(u._id)
        const wallets: any[] = Array.isArray(u.wallets) ? u.wallets : []
        const rivoWallet = wallets.find((w: any) => w?.coinType === "Rivo")
        rivoByUserAdmin[uid] = rivoWallet?.balance ?? 0
      }

      // Her kullanıcının hangi partnere ait olduğunu belirle
      const codeToPartnerName: Record<string, string> = {}
      for (const p of allPartners) codeToPartnerName[p.ref_code] = p.username

      const referrals = docs.map((u: any) => {
        const uid = String(u._id)
        const aff = u.affiliates || {}
        // Partner tespiti: redeemedCode > referrerUsername > referrer ObjectId
        let partnerName = aff.redeemedCode
          ? (codeToPartnerName[aff.redeemedCode] || aff.redeemedCode)
          : aff.referrerUsername
          ? aff.referrerUsername
          : aff.referrer
          ? (partnerIdToCode[String(aff.referrer)] || "—")
          : "—"
        return {
          _id: uid, name: u.name, username: u.username, phone: u.phone,
          partnerName,
          depositTotal: depByUser[uid] ?? 0,
          withdrawalTotal: witByUser[uid] ?? 0,
          rivoBalance: rivoByUserAdmin[uid] ?? 0,
          createdAt: u.createdAt,
        }
      })

      return NextResponse.json({ success: true, refCode: null, isAdminAll: true, referrals })
    }

    // ---- NORMAL (tek partner) MODE ----
    const resolvedRefCode = refCode
    if (!resolvedRefCode) return NextResponse.json({ success: true, refCode: null, referrals: [] })

    // Get partner username from Neon (to match transferred users)
    let partnerUsername: string | null = null
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        const partners = await sql`SELECT username FROM affiliate_users WHERE ref_code = ${resolvedRefCode}`
        if (partners && partners.length > 0) {
          partnerUsername = partners[0].username as string
        }
      } catch (neonErr) {
        console.warn("[v0] Failed to fetch partner from Neon:", neonErr)
      }
    }

    const partner = await users.findOne({ "affiliates.code": resolvedRefCode }, { projection: { _id: 1 } })

    const orConditions: Record<string, unknown>[] = [
      { "affiliates.redeemedCode": resolvedRefCode },
      { "affiliates.referrerUsername": resolvedRefCode },
    ]
    if (partner) {
      orConditions.push({ "affiliates.referrer": partner._id })
    }
    if (partnerUsername) {
      orConditions.push({ "affiliates.referrerUsername": partnerUsername })
    }

    const query: Record<string, unknown> = { $or: orConditions }

    const docs = await users.find(query, {
      projection: { name: 1, username: 1, phone: 1, "affiliates.redeemedCode": 1, "affiliates.referredAt": 1, "affiliates.referrer": 1, createdAt: 1, wallets: 1 },
    }).sort({ createdAt: -1 }).toArray()

    if (docs.length === 0) {
      return NextResponse.json({ success: true, refCode: resolvedRefCode, referrals: [] })
    }

    // Calculate current month date range
    const trDate = new Date()
    const monthStart = new Date(trDate.getFullYear(), trDate.getMonth(), 1)
    const monthEnd = new Date(trDate.getFullYear(), trDate.getMonth() + 1, 1)
    monthEnd.setMilliseconds(-1)

    const userIds = docs.map((u: any) => u._id)
    const forcelabTransactions = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevTransactions  = mongoose.connection.db!.collection("meeldevtransactions")
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]

    // Security: only READ operations — no write/update/delete allowed
    // Bonus işlemlerini hariç tut (providerName veya providerSlug "bonus" içeriyorsa)
    const notBonusFilter = { 
      providerName: { $not: { $regex: /bonus/i } },
      providerSlug: { $not: { $regex: /bonus/i } }
    }
    const [forcelabDeposits, forcelabWithdrawals, meelDeposits, meelWithdrawals, rivoUsers] = await Promise.all([
      forcelabTransactions.find(
        { user: { $in: userIds }, providerType: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...notBonusFilter },
        { projection: { user: 1, amount: 1 } }
      ).toArray(),
      forcelabTransactions.find(
        { user: { $in: userIds }, providerType: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd } },
        { projection: { user: 1, amount: 1 } }
      ).toArray(),
      meeldevTransactions.find(
        { user: { $in: userIds }, type: "deposit", status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...notBonusFilter },
        { projection: { user: 1, amount: 1 } }
      ).toArray(),
      meeldevTransactions.find(
        { user: { $in: userIds }, type: { $in: ["withdraw", "withdrawal"] }, status: { $in: approvedStatuses }, createdAt: { $gte: monthStart, $lte: monthEnd } },
        { projection: { user: 1, amount: 1 } }
      ).toArray(),
      users.find(
        { _id: { $in: userIds } },
        { projection: { _id: 1, wallets: 1 } }
      ).toArray(),
    ])

    const depositByUser: Record<string, number> = {}
    const withdrawalByUser: Record<string, number> = {}
    const rivoByUser: Record<string, number> = {}

    for (const t of [...forcelabDeposits, ...meelDeposits]) {
      const uid = String(t.user)
      depositByUser[uid] = (depositByUser[uid] ?? 0) + (t.amount ?? 0)
    }

    for (const t of [...forcelabWithdrawals, ...meelWithdrawals]) {
      const uid = String(t.user)
      withdrawalByUser[uid] = (withdrawalByUser[uid] ?? 0) + (t.amount ?? 0)
    }

    // Extract Rivo balance from wallets array
    for (const u of rivoUsers) {
      const uid = String(u._id)
      const wallets: any[] = Array.isArray(u.wallets) ? u.wallets : []
      const rivoWallet = wallets.find((w: any) => w?.coinType === "Rivo")
      rivoByUser[uid] = rivoWallet?.balance ?? 0
    }

    const referrals = docs.map((u: any) => {
      const uid = String(u._id)
      return {
        _id: uid, name: u.name, username: u.username, phone: u.phone,
        depositTotal: depositByUser[uid] ?? 0,
        withdrawalTotal: withdrawalByUser[uid] ?? 0,
        rivoBalance: rivoByUser[uid] ?? 0,
        redeemedCode: u.affiliates?.redeemedCode,
        referredAt: u.affiliates?.referredAt ?? u.createdAt,
        createdAt: u.createdAt,
      }
    })

    return NextResponse.json({ success: true, refCode: resolvedRefCode, referrals })
  } catch (err) {
    console.error("[affiliate/referrals] MongoDB error:", err)
    return NextResponse.json({ success: false, message: "Referral verisi alınamadı." }, { status: 500 })
  }
}
