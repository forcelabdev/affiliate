import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/connectDB"
import { neon } from "@neondatabase/serverless"

// Sabit başlangıç noktası: 04/08/2026 18:20 (Türkiye saati = UTC+3 => 15:20 UTC)
const AGENT_BALANCE_ORIGIN = new Date("2026-08-04T15:20:00.000Z")
const AGENT_BALANCE_INITIAL = 980_000

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if ("error" in auth) return auth.error
    const { session } = auth

    const isAdmin = session.role === "superadmin" || session.role === "admin"
    if (!isAdmin) {
      return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)

    // Kalan agent bakiyesi modu: sadece deposit toplamını hesapla
    if (searchParams.get("agentBalance") === "true") {
      await connectDB()
      const db = mongoose.connection.db!
      const afterOrigin = { createdAt: { $gt: AGENT_BALANCE_ORIGIN } }
      const depositQuery = { type: "deposit", status: "approved", ...afterOrigin }
      const [fluxTotal, xpayTotal] = await Promise.all([
        db.collection("fluxkriptotransactions")
          .aggregate([{ $match: depositQuery }, { $group: { _id: null, total: { $sum: "$amount" } } }])
          .toArray(),
        db.collection("xpaymenttransactions")
          .aggregate([{ $match: depositQuery }, { $group: { _id: null, total: { $sum: "$amount" } } }])
          .toArray(),
      ])
      const depositSum = Number(fluxTotal[0]?.total ?? 0) + Number(xpayTotal[0]?.total ?? 0)
      const remaining  = AGENT_BALANCE_INITIAL - depositSum
      return NextResponse.json({ success: true, depositSum, remaining })
    }

    const startDateParam = searchParams.get("startDate")
    const endDateParam   = searchParams.get("endDate")
    const search         = searchParams.get("search")?.trim() || ""
    const page           = parseInt(searchParams.get("page") || "1")
    const limit          = parseInt(searchParams.get("limit") || "50")
    const skip           = (page - 1) * limit

    await connectDB()
    const db = mongoose.connection.db!

    const dateRange: Record<string, unknown> = {}
    if (startDateParam) dateRange.$gte = new Date(parseInt(startDateParam))
    if (endDateParam)   dateRange.$lte = new Date(parseInt(endDateParam))
    const hasDate = Object.keys(dateRange).length > 0

    // 1. adminmanualadjustments — tüm credit işlemleri (bonus + balance + Rivo)
    const adjQuery: Record<string, unknown> = { direction: "credit" }
    if (hasDate) adjQuery.createdAt = dateRange

    const adjustments = await db.collection("adminmanualadjustments")
      .find(adjQuery, {
        projection: {
          targetUser: 1, targetSnapshot: 1, actorSnapshot: 1,
          kind: 1, direction: 1, source: 1, category: 1, note: 1,
          appliedAmount: 1, requestedAmount: 1,
          balanceBefore: 1, balanceAfter: 1, createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .toArray()

    // 2. Filux (fluxkriptotransactions) ve xPayment (xpaymenttransactions) deposit toplamları
    // Sadece status === "approved" olan kayıtlar alınır
    const fluxDepositQuery: Record<string, unknown> = { type: "deposit", status: "approved" }
    const xpayDepositQuery: Record<string, unknown> = { type: "deposit", status: "approved" }
    if (hasDate) { fluxDepositQuery.createdAt = dateRange; xpayDepositQuery.createdAt = dateRange }

    const [fluxDocs, xpayDocs] = await Promise.all([
      db.collection("fluxkriptotransactions")
        .find(fluxDepositQuery, { projection: { userId: 1, user: 1, amount: 1, status: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray(),
      db.collection("xpaymenttransactions")
        .find(xpayDepositQuery, { projection: { userId: 1, user: 1, amount: 1, status: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray(),
    ])

    const totalFiluxAmount  = fluxDocs.reduce((s: number, d: any) => s + Number(d.amount ?? 0), 0)
    const totalFiluxCount   = fluxDocs.length
    const totalXpayAmount   = xpayDocs.reduce((s: number, d: any) => s + Number(d.amount ?? 0), 0)
    const totalXpayCount    = xpayDocs.length

    // 3. campaigntransactions — kampanya bonusları
    const campQuery: Record<string, unknown> = { status: "completed" }
    if (hasDate) campQuery.createdAt = dateRange

    const campaigns = await db.collection("campaigntransactions")
      .find(campQuery, {
        projection: {
          user: 1, campaignTitle: 1, rewardAmount: 1, mode: 1,
          assignedByAdmin: 1, status: 1, createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .toArray()

    // 3. Build refCode → partner username map from MongoDB (source of truth for actual codes)
    // MongoDB users with affiliates.code ARE the partner accounts — these codes match redeemedCode
    const codeToPartner: Record<string, string> = {}
    const mongoPartnerDocs = await db.collection("users")
      .find(
        { "affiliates.code": { $exists: true, $ne: null } },
        { projection: { username: 1, "affiliates.code": 1 } }
      )
      .toArray()
    mongoPartnerDocs.forEach((p: any) => {
      if (p.affiliates?.code) codeToPartner[p.affiliates.code] = p.username
    })
    // Also augment from Neon (Neon ref_codes might differ but still useful as fallback)
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const sql = neon(databaseUrl)
        const rows = await sql`SELECT username, ref_code FROM affiliate_users WHERE ref_code IS NOT NULL`
        rows.forEach((r: any) => {
          if (r.ref_code && r.ref_code !== "NULL" && !codeToPartner[r.ref_code]) {
            codeToPartner[r.ref_code] = r.username
          }
        })
      } catch (e) { console.warn("[balance-analysis] Neon error:", e) }
    }

    // 4. Tüm etkilenen user id'leri topla
    const allUserIds = new Set<string>()
    adjustments.forEach((a: any) => allUserIds.add(String(a.targetUser)))
    campaigns.forEach((c: any) => allUserIds.add(String(c.user)))

    const objectIds = [...allUserIds].flatMap((id) => {
      try { return [new mongoose.Types.ObjectId(id)] } catch { return [] }
    })

    const userDocs = await db.collection("users")
      .find(
        { _id: { $in: objectIds }, role: { $ne: "admin" }, rank: { $ne: "admin" } },
        { projection: { _id: 1, username: 1, name: 1, "affiliates.redeemedCode": 1, "affiliates.code": 1 } }
      )
      .toArray()

    const userMap: Record<string, { username: string; name?: string; redeemedCode?: string; code?: string }> = {}
    userDocs.forEach((u: any) => {
      userMap[String(u._id)] = {
        username:     u.username,
        name:         u.name,
        redeemedCode: u.affiliates?.redeemedCode ?? null,
        code:         u.affiliates?.code ?? null,
      }
    })

    // 5. Her kullanıcı için özet oluştur
    interface DepositLog {
      id: string
      amount: number
      status: string | null
      createdAt: string
    }

    interface UserBalance {
      userId: string
      username: string
      name?: string
      partnerName: string | null
      redeemedCode: string | null
      totalBonus: number
      totalCampaign: number
      totalBalance: number   // bonus + campaign
      bonusCount: number
      campaignCount: number
      bonusLogs: {
        id: string
        type: "bonus" | "balance" | "Rivo"
        source: string
        category: string | null
        note: string | null
        amount: number
        balanceBefore: number
        balanceAfter: number
        actorUsername: string | null
        createdAt: string
      }[]
      campaignLogs: {
        id: string
        title: string | null
        amount: number
        mode: string | null
        createdAt: string
      }[]
      filuxLogs: DepositLog[]
      xpayLogs: DepositLog[]
    }

    const userBalMap: Record<string, UserBalance> = {}

    function ensureUser(uid: string): UserBalance {
      if (!userBalMap[uid]) {
        const u = userMap[uid]
        const rc = u?.redeemedCode ?? null
        userBalMap[uid] = {
          userId:        uid,
          // If user not found in MongoDB, mark username as null — filtered out below
          username:      u?.username ?? null as any,
          name:          u?.name,
          redeemedCode:  rc,
          partnerName:   rc ? (codeToPartner[rc] ?? rc) : null,
          totalBonus:    0,
          totalCampaign: 0,
          totalBalance:  0,
          bonusCount:    0,
          campaignCount: 0,
          bonusLogs:     [],
          campaignLogs:  [],
          filuxLogs:     [],
          xpayLogs:      [],
        }
      }
      return userBalMap[uid]
    }

    // Adjustments
    for (const a of adjustments) {
      const uid = String(a.targetUser)
      const u = ensureUser(uid)
      const amt = Number(a.appliedAmount ?? a.requestedAmount ?? 0)
      u.totalBonus    += amt
      u.totalBalance  += amt
      u.bonusCount    += 1
      u.bonusLogs.push({
        id:            String(a._id),
        type:          a.kind ?? "bonus",
        source:        a.source ?? "manual",
        category:      a.category ?? null,
        note:          a.note ?? null,
        amount:        amt,
        balanceBefore: Number(a.balanceBefore ?? 0),
        balanceAfter:  Number(a.balanceAfter ?? 0),
        actorUsername: a.actorSnapshot?.username ?? null,
        createdAt:     a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt ?? ""),
      })
    }

    // Campaigns
    for (const c of campaigns) {
      const uid = String(c.user)
      const u = ensureUser(uid)
      const amt = Number(c.rewardAmount ?? 0)
      u.totalCampaign += amt
      u.totalBalance  += amt
      u.campaignCount += 1
      u.campaignLogs.push({
        id:        String(c._id),
        title:     c.campaignTitle ?? null,
        amount:    amt,
        mode:      c.mode ?? null,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt ?? ""),
      })
    }

    // Filux logs — kullanıcı bazında eşleştir (userId veya user alanı)
    for (const d of fluxDocs) {
      const uid = String(d.userId ?? d.user ?? "")
      if (!uid) continue
      if (userBalMap[uid]) {
        userBalMap[uid].filuxLogs.push({
          id:        String(d._id),
          amount:    Number(d.amount ?? 0),
          status:    d.status ?? null,
          createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt ?? ""),
        })
      }
    }

    // xPayment logs
    for (const d of xpayDocs) {
      const uid = String(d.userId ?? d.user ?? "")
      if (!uid) continue
      if (userBalMap[uid]) {
        userBalMap[uid].xpayLogs.push({
          id:        String(d._id),
          amount:    Number(d.amount ?? 0),
          status:    d.status ?? null,
          createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt ?? ""),
        })
      }
    }

    // 6. Filter out users that couldn't be resolved in MongoDB (username would be null/ObjectId)
    let allUsers = Object.values(userBalMap).filter(u => u.username != null && u.username !== "")
    if (search) {
      const s = search.toLowerCase()
      allUsers = allUsers.filter(u =>
        u.username.toLowerCase().includes(s) ||
        (u.name ?? "").toLowerCase().includes(s) ||
        (u.partnerName ?? "").toLowerCase().includes(s) ||
        (u.redeemedCode ?? "").toLowerCase().includes(s)
      )
    }

    // 7. Sort by totalBalance desc
    allUsers.sort((a, b) => b.totalBalance - a.totalBalance)

    const totalCount = allUsers.length
    const paginated  = allUsers.slice(skip, skip + limit)

    // 8. Global summary
    // Bonus kind breakdown: "bonus" vs "balance" (from adminmanualadjustments.kind)
    let totalBonusKindAmount  = 0
    let totalBonusKindCount   = 0
    let totalBalanceKindAmount = 0
    let totalBalanceKindCount  = 0

    for (const u of allUsers) {
      for (const log of u.bonusLogs) {
        if (log.type === "bonus") {
          totalBonusKindAmount += log.amount
          totalBonusKindCount  += 1
        } else if (log.type === "balance") {
          totalBalanceKindAmount += log.amount
          totalBalanceKindCount  += 1
        }
      }
    }

    const summary = {
      totalBonus:           allUsers.reduce((s, u) => s + u.totalBonus, 0),
      totalCampaign:        allUsers.reduce((s, u) => s + u.totalCampaign, 0),
      totalBalance:         allUsers.reduce((s, u) => s + u.totalBalance, 0),
      totalUsers:           totalCount,
      totalBonusCount:      allUsers.reduce((s, u) => s + u.bonusCount, 0),
      totalCampaignCount:   allUsers.reduce((s, u) => s + u.campaignCount, 0),
      // kind breakdown
      totalBonusKindAmount,
      totalBonusKindCount,
      totalBalanceKindAmount,
      totalBalanceKindCount,
      // ödeme yöntemi deposit totalleri
      totalFiluxAmount,
      totalFiluxCount,
      totalXpayAmount,
      totalXpayCount,
    }

    return NextResponse.json({
      success: true,
      users: paginated,
      summary,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) },
    })
  } catch (err: any) {
    console.error("[balance-analysis] error:", err)
    return NextResponse.json({ success: false, message: err?.message ?? "Sunucu hatası." }, { status: 500 })
  }
}
