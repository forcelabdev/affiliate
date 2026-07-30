import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { connectDB } from "@/lib/mongodb"
import mongoose from "mongoose"

// Simple rate limiter
const rateMap = new Map<string, { count: number; resetAt: number }>()
function checkRate(ip: string, limit = 30): boolean {
  const now = Date.now()
  const entry = rateMap.get(ip)
  if (!entry || now > entry.resetAt) { rateMap.set(ip, { count: 1, resetAt: now + 60_000 }); return true }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

function sanitize(v: string | null): string | null {
  if (!v) return null
  return v.replace(/[${}]/g, "").trim().slice(0, 200)
}

// GET /api/affiliate/player-analysis
// Returns paginated list of players (with transaction summary) + optional detail
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (!checkRate(ip)) {
    return NextResponse.json({ success: false, message: "Çok fazla istek." }, { status: 429 })
  }

  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const usernameFilter = sanitize(searchParams.get("username"))
  const startDateParam  = searchParams.get("startDate")
  const endDateParam    = searchParams.get("endDate")
  const detail          = searchParams.get("detail") // "1" → return individual txns for a player
  const limit           = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200)
  const offset          = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0)

  await connectDB()
  const db        = mongoose.connection.db!
  const usersCol  = db.collection("users")
  const txnCol    = db.collection("transactions")
  const gamesCol  = db.collection("games")

  // ── DETAIL MODE: return all individual transactions for one player ──────
  if (detail === "1" && usernameFilter) {
    const user = await usersCol.findOne(
      {
        username: { $regex: `^${usernameFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        role: { $ne: "admin" },
        rank: { $ne: "admin" },
      },
      { projection: { _id: 1, username: 1, name: 1, wallets: 1 } }
    )
    if (!user) {
      return NextResponse.json({ success: false, message: "Kullanıcı bulunamadı." }, { status: 404 })
    }

    const userCode = String(user._id)
    const txnQuery: Record<string, unknown> = { user_code: userCode }

    if (startDateParam || endDateParam) {
      const dateRange: Record<string, Date> = {}
      if (startDateParam) dateRange.$gte = new Date(parseInt(startDateParam))
      if (endDateParam)   dateRange.$lte = new Date(parseInt(endDateParam))
      txnQuery.created_at = dateRange
    }

    const txns = await txnCol
      .find(txnQuery, {
        projection: {
          txn_id: 1, game_type: 1, provider_code: 1, game_code: 1,
          bet_money: 1, win_money: 1, txn_type: 1, round_id: 1,
          balance_before: 1, balance_after: 1, created_at: 1,
        },
      })
      .sort({ created_at: -1 })
      .limit(500)
      .toArray()

    // Fetch game names + provider names in parallel
    const gameCodes     = [...new Set(txns.map((t: any) => t.game_code).filter(Boolean))]
    const providerCodes = [...new Set(txns.map((t: any) => t.provider_code).filter(Boolean))]
    const providersCol  = db.collection("gameproviders")

    const [gamesDocs, providerDocs] = await Promise.all([
      gameCodes.length > 0
        ? gamesCol
            .find({ game_code: { $in: gameCodes } }, { projection: { game_code: 1, game_name: 1 } })
            .toArray()
        : Promise.resolve([]),
      providerCodes.length > 0
        ? providersCol
            .find({ code: { $in: providerCodes } }, { projection: { code: 1, name: 1 } })
            .toArray()
        : Promise.resolve([]),
    ])

    const gameNameMap: Record<string, string> = {}
    gamesDocs.forEach((g: any) => { if (g.game_code) gameNameMap[g.game_code] = g.game_name })

    const providerNameMap: Record<string, string> = {}
    providerDocs.forEach((p: any) => { if (p.code) providerNameMap[p.code] = p.name })

    // Group debit+credit by round_id into rounds
    // debit = bahis çıkışı (bet_money > 0, balance_before = önceki bakiye)
    // credit = kazanç girişi (win_money > 0, balance_after = sonraki bakiye)
    // Her round için debit'in balance_before → credit'in balance_after kullanılır
    const roundMap: Record<string, {
      txn_id: string; game_code: string; game_name: string; provider_code: string; game_type: string
      bet: number; win: number; profit: number
      balance_before: number | null; balance_after: number | null
      created_at: unknown; hasDebit: boolean; hasCredit: boolean
    }> = {}

    txns.forEach((t: any) => {
      const rid = String(t.round_id || t.txn_id)
      if (!roundMap[rid]) {
        roundMap[rid] = {
          txn_id:       t.txn_id,
          game_code:    t.game_code,
          game_name:    gameNameMap[t.game_code] ?? t.game_code ?? "—",
          provider_code: providerNameMap[t.provider_code] ?? t.provider_code ?? "—",
          game_type:    t.game_type ?? "—",
          bet:          0,
          win:          0,
          profit:       0,
          balance_before: null,
          balance_after:  null,
          created_at:   t.created_at,
          hasDebit:     false,
          hasCredit:    false,
        }
      }
      if (t.txn_type === "debit") {
        roundMap[rid].bet           += Number(t.bet_money ?? 0)
        roundMap[rid].balance_before = Number(t.balance_before ?? 0)
        roundMap[rid].hasDebit       = true
        // debit'in tarihi daha eski olduğundan created_at'i debit ile set ediyoruz
        roundMap[rid].created_at     = t.created_at
      }
      if (t.txn_type === "credit") {
        roundMap[rid].win           += Number(t.win_money ?? 0)
        roundMap[rid].balance_after  = Number(t.balance_after ?? 0)
        roundMap[rid].hasCredit      = true
        // eğer debit yoksa (sadece credit) balance_before'u da burdan al
        if (roundMap[rid].balance_before === null) {
          roundMap[rid].balance_before = Number(t.balance_before ?? 0)
        }
      }
    })

    // balance_after hâlâ null ise (credit gelmemişse) debit'in balance_after'ı kullan
    Object.values(roundMap).forEach(r => {
      if (r.balance_after === null) r.balance_after = r.balance_before ?? 0
      if (r.balance_before === null) r.balance_before = 0
    })
    const rounds = Object.values(roundMap).map(r => ({
      txn_id:       r.txn_id,
      game_code:    r.game_code,
      game_name:    r.game_name,
      provider_code: r.provider_code,
      game_type:    r.game_type,
      bet:          r.bet,
      win:          r.win,
      profit:       r.win - r.bet,   // pozitif = oyuncu kazandı, negatif = kasa kazandı
      balance_before: r.balance_before,
      balance_after:  r.balance_after,
      created_at:   r.created_at,
    })).sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime())

    const wallets: any[] = Array.isArray(user.wallets) ? user.wallets : []
    const rivoWallet = wallets.find((w: any) => w?.coinType === "Rivo")

    return NextResponse.json({
      success: true,
      user: {
        username: user.username,
        name: user.name,
        currentBalance: rivoWallet?.balance ?? 0,
      },
      summary: {
        totalBet:    rounds.reduce((s, r) => s + r.bet, 0),
        totalWin:    rounds.reduce((s, r) => s + r.win, 0),
        totalProfit: rounds.reduce((s, r) => s + r.profit, 0),
        roundCount:  rounds.length,
      },
      rounds,
    })
  }

  // ── LIST MODE: players with transaction summaries ────────────────────────
  const userQuery: Record<string, unknown> = { role: { $ne: "admin" }, rank: { $ne: "admin" } }
  if (usernameFilter) {
    userQuery.username = { $regex: usernameFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
  }

  // Build date filter for transactions
  const dateRange: Record<string, Date> = {}
  if (startDateParam) dateRange.$gte = new Date(parseInt(startDateParam))
  if (endDateParam)   dateRange.$lte = new Date(parseInt(endDateParam))
  const hasDates = Object.keys(dateRange).length > 0

  // Find users with at least one transaction (aggregate for speed)
  // Step 1: find distinct user_codes in transactions within date range
  const txnMatchStage: Record<string, unknown> = {}
  if (hasDates) txnMatchStage.created_at = dateRange
  if (usernameFilter) {
    // need user_id lookup first — fetch matching users
    const matchingUsers = await usersCol
      .find(userQuery, { projection: { _id: 1 } })
      .limit(200)
      .toArray()
    txnMatchStage.user_code = { $in: matchingUsers.map((u: any) => String(u._id)) }
  }

  const pipeline: object[] = [
    { $match: txnMatchStage },
    {
      $group: {
        _id: "$user_code",
        totalBet:    { $sum: { $cond: [{ $eq: ["$txn_type", "debit"]  }, "$bet_money", 0] } },
        totalWin:    { $sum: { $cond: [{ $eq: ["$txn_type", "credit"] }, "$win_money", 0] } },
        txnCount:    { $sum: 1 },
        lastTxn:     { $max: "$created_at" },
        providers:   { $addToSet: "$provider_code" },
      },
    },
    { $sort: { totalBet: -1 } },
    { $skip: offset },
    { $limit: limit },
  ]

  const aggResult = await txnCol.aggregate(pipeline).toArray()

  // Fetch user info for these user_codes
  const userCodes = aggResult.map((r: any) => r._id)
  const userDocs  = userCodes.length > 0
    ? await usersCol.find(
        {
          _id: { $in: userCodes.map((c: string) => { try { return new mongoose.Types.ObjectId(c) } catch { return c } }) },
          role: { $ne: "admin" },
          rank: { $ne: "admin" },
        },
        { projection: { _id: 1, username: 1, name: 1, wallets: 1, affiliates: 1 } }
      ).toArray()
    : []

  const userDocMap: Record<string, any> = {}
  userDocs.forEach((u: any) => { userDocMap[String(u._id)] = u })

  const players = aggResult.map((r: any) => {
    const u = userDocMap[r._id]
    const wallets: any[] = Array.isArray(u?.wallets) ? u.wallets : []
    const rivoWallet = wallets.find((w: any) => w?.coinType === "Rivo")
    return {
      userId:      r._id,
      username:    u?.username ?? r._id,
      name:        u?.name ?? null,
      currentBalance: rivoWallet?.balance ?? 0,
      redeemedCode:   u?.affiliates?.redeemedCode ?? null,
      totalBet:    r.totalBet,
      totalWin:    r.totalWin,
      totalProfit: r.totalWin - r.totalBet,
      txnCount:    r.txnCount,
      lastTxn:     r.lastTxn,
      providers:   (r.providers ?? []).filter(Boolean).slice(0, 5),
    }
  })

  // Global summary
  const summaryPipeline: object[] = [
    { $match: txnMatchStage },
    {
      $group: {
        _id: null,
        totalBet:    { $sum: { $cond: [{ $eq: ["$txn_type", "debit"]  }, "$bet_money", 0] } },
        totalWin:    { $sum: { $cond: [{ $eq: ["$txn_type", "credit"] }, "$win_money", 0] } },
        uniquePlayers: { $addToSet: "$user_code" },
        txnCount:    { $sum: 1 },
      },
    },
  ]
  const sumRes = await txnCol.aggregate(summaryPipeline).toArray()
  const s = sumRes[0] ?? { totalBet: 0, totalWin: 0, uniquePlayers: [], txnCount: 0 }

  return NextResponse.json({
    success: true,
    players,
    summary: {
      totalBet:     s.totalBet,
      totalWin:     s.totalWin,
      totalProfit:  s.totalWin - s.totalBet,
      uniquePlayers: s.uniquePlayers?.length ?? 0,
      txnCount:     s.txnCount,
    },
    total: players.length,
  })
}
