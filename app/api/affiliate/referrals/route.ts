import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"

// ── Rate limiter ─────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(ip: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) { rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs }); return true }
  if (entry.count >= max) return false
  entry.count++
  return true
}

// ── NoSQL injection guard ────────────────────────────────────────────────────
function sanitize(val: unknown): string {
  if (typeof val !== "string") return ""
  if (/[{}$]/.test(val)) return ""
  return val.trim().slice(0, 200)
}

// ── Shared helpers ───────────────────────────────────────────────────────────
const APPROVED = ["approved", "completed", "success", "confirmed"]
const NO_BONUS  = { providerName: { $not: { $regex: /bonus/i } }, providerSlug: { $not: { $regex: /bonus/i } } }

async function getMonthlyStats(userIds: any[], db: any) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  monthEnd.setMilliseconds(-1)

  const fl   = db.collection("forcelabfinancetransactions")
  const meel = db.collection("meeldevtransactions")

  const [flDep, flWit, meelDep, meelWit, rivoUsers] = await Promise.all([
    fl.find({ user: { $in: userIds }, providerType: "deposit",                          status: { $in: APPROVED }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...NO_BONUS }, { projection: { user: 1, amount: 1 } }).toArray(),
    fl.find({ user: { $in: userIds }, providerType: { $in: ["withdraw","withdrawal"] }, status: { $in: APPROVED }, createdAt: { $gte: monthStart, $lte: monthEnd } },             { projection: { user: 1, amount: 1 } }).toArray(),
    meel.find({ user: { $in: userIds }, type: "deposit",                          status: { $in: APPROVED }, createdAt: { $gte: monthStart, $lte: monthEnd }, ...NO_BONUS }, { projection: { user: 1, amount: 1 } }).toArray(),
    meel.find({ user: { $in: userIds }, type: { $in: ["withdraw","withdrawal"] }, status: { $in: APPROVED }, createdAt: { $gte: monthStart, $lte: monthEnd } },             { projection: { user: 1, amount: 1 } }).toArray(),
    db.collection("users").find({ _id: { $in: userIds } }, { projection: { _id: 1, wallets: 1 } }).toArray(),
  ])

  const depByUser: Record<string, number> = {}
  const witByUser: Record<string, number> = {}
  const rivoByUser: Record<string, number> = {}

  for (const t of [...flDep, ...meelDep])  { const k = String(t.user); depByUser[k] = (depByUser[k] ?? 0) + (t.amount ?? 0) }
  for (const t of [...flWit, ...meelWit])  { const k = String(t.user); witByUser[k] = (witByUser[k] ?? 0) + (t.amount ?? 0) }
  for (const u of rivoUsers) {
    const k = String(u._id)
    const wallet = (Array.isArray(u.wallets) ? u.wallets : []).find((w: any) => w?.coinType === "Rivo")
    rivoByUser[k] = wallet?.balance ?? 0
  }

  return { depByUser, witByUser, rivoByUser }
}

// ── GET handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (!checkRateLimit(ip)) return NextResponse.json({ success: false, message: "Too many requests." }, { status: 429 })
  if (req.method !== "GET") return NextResponse.json({ success: false, message: "Method not allowed." }, { status: 405 })

  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  const { searchParams } = new URL(req.url)
  const rawCode      = searchParams.get("refCode") || searchParams.get("code")
  const requestedCode = sanitize(rawCode)
  const isAdmin      = session.role === "admin" || session.role === "superadmin"
  const isAdminAll   = isAdmin && !requestedCode

  // Resolve refCode: session > URL param > Neon lookup by id
  let refCode: string | null = isAdminAll ? null
    : isAdmin ? (requestedCode || session.refCode || null)
    : (session.refCode || requestedCode || null)

  if (!isAdminAll && !refCode) {
    const affiliateId = sanitize(searchParams.get("id"))
    const dbUrl = process.env.DATABASE_URL
    if (affiliateId && dbUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(dbUrl)
        const rows = await sql`SELECT ref_code FROM affiliate_users WHERE id = ${parseInt(affiliateId, 10)} LIMIT 1`
        const rc = rows?.[0]?.ref_code
        if (rc && rc !== "NULL" && rc !== "null") refCode = rc as string
      } catch (e) {
        console.warn("[referrals] Neon id→refCode lookup error:", e)
      }
    }
  }

  try {
    await connectDB()
    const db    = mongoose.connection.db!
    const users = db.collection("users")

    // ── ADMIN ALL: tüm redeemedCode değerleri üzerinden ───────────────────────
    if (isAdminAll) {
      // MongoDB'deki tüm unique redeemedCode değerlerini bul
      const allCodes: string[] = (await users.distinct("affiliates.redeemedCode")).filter(Boolean)

      if (allCodes.length === 0) {
        return NextResponse.json({ success: true, refCode: null, isAdminAll: true, referrals: [] })
      }

      const docs = await users.find(
        { "affiliates.redeemedCode": { $in: allCodes }, role: { $ne: "admin" } },
        { projection: { name: 1, username: 1, phone: 1, affiliates: 1, createdAt: 1 } }
      ).sort({ createdAt: -1 }).toArray()

      if (docs.length === 0) return NextResponse.json({ success: true, refCode: null, isAdminAll: true, referrals: [] })

      const userIds = docs.map((u: any) => u._id)
      const { depByUser, witByUser, rivoByUser } = await getMonthlyStats(userIds, db)

      // Her redeemedCode için partner username'i bul (MongoDB'de affiliates.code eşleşmesi)
      const codeToPartner: Record<string, string> = {}
      const partnerDocs = await users.find(
        { "affiliates.code": { $in: allCodes } },
        { projection: { username: 1, "affiliates.code": 1 } }
      ).toArray()
      for (const p of partnerDocs) {
        if (p.affiliates?.code) codeToPartner[p.affiliates.code] = p.username
      }

      // Neon'dan da eşleşen partner username'leri çek
      try {
        const dbUrl = process.env.DATABASE_URL
        if (dbUrl) {
          const { neon } = await import("@neondatabase/serverless")
          const sql = neon(dbUrl)
          const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code = ANY(${allCodes})`
          for (const r of rows as any[]) {
            if (r.ref_code && !codeToPartner[r.ref_code]) codeToPartner[r.ref_code] = r.username
          }
        }
      } catch {}

      const referrals = docs.map((u: any) => {
        const uid  = String(u._id)
        const code = u.affiliates?.redeemedCode ?? "—"
        return {
          _id: uid, name: u.name, username: u.username, phone: u.phone,
          partnerName: codeToPartner[code] ?? code,
          depositTotal:    depByUser[uid]  ?? 0,
          withdrawalTotal: witByUser[uid]  ?? 0,
          rivoBalance:     rivoByUser[uid] ?? 0,
          createdAt: u.createdAt,
        }
      })

      return NextResponse.json({ success: true, refCode: null, isAdminAll: true, referrals })
    }

    // ── NORMAL (tek partner) MODE ─────────────────────────────────────────────
    if (!refCode) return NextResponse.json({ success: true, refCode: null, referrals: [] })

    // Partner'ı MongoDB'de birden fazla yolla bul
    const partnerDoc = await users.findOne(
      { $or: [{ "affiliates.code": refCode }, { username: session.username }] },
      { projection: { _id: 1, username: 1, "affiliates.code": 1 } }
    )

    // Üyeleri bul: redeemedCode = refCode VEYA = partner.affiliates.code VEYA referrer = partner._id
    const orConditions: Record<string, unknown>[] = [
      { "affiliates.redeemedCode": refCode },
      { "affiliates.referrerUsername": refCode },
    ]
    if (partnerDoc) {
      orConditions.push({ "affiliates.referrer": partnerDoc._id })
      if (partnerDoc.affiliates?.code && partnerDoc.affiliates.code !== refCode) {
        orConditions.push({ "affiliates.redeemedCode": partnerDoc.affiliates.code })
      }
    }

    const docs = await users.find(
      { $or: orConditions, role: { $ne: "admin" } },
      { projection: { name: 1, username: 1, phone: 1, affiliates: 1, createdAt: 1, wallets: 1 } }
    ).sort({ createdAt: -1 }).toArray()

    if (docs.length === 0) return NextResponse.json({ success: true, refCode, referrals: [] })

    const userIds = docs.map((u: any) => u._id)
    const { depByUser, witByUser, rivoByUser } = await getMonthlyStats(userIds, db)

    const referrals = docs.map((u: any) => {
      const uid = String(u._id)
      return {
        _id: uid, name: u.name, username: u.username, phone: u.phone,
        depositTotal:    depByUser[uid]  ?? 0,
        withdrawalTotal: witByUser[uid]  ?? 0,
        rivoBalance:     rivoByUser[uid] ?? 0,
        redeemedCode: u.affiliates?.redeemedCode,
        referredAt:   u.affiliates?.referredAt ?? u.createdAt,
        createdAt:    u.createdAt,
      }
    })

    return NextResponse.json({ success: true, refCode, referrals })

  } catch (err) {
    console.error("[affiliate/referrals] error:", err)
    return NextResponse.json({ success: false, message: "Referral verisi alınamadı." }, { status: 500 })
  }
}
