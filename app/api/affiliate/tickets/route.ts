import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { neon } from "@neondatabase/serverless"
import mongoose from "mongoose"

// ── POST: Superadmin manuel bilet ekle ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })

  const body = await req.json()
  const partnerId: number = parseInt(body.partnerId, 10)
  const mongoUserId: string = String(body.mongoUserId ?? "").trim()
  const username: string = String(body.username ?? "").trim()
  const ticketCount: number = Math.max(1, parseInt(body.ticketCount ?? "1", 10))
  const note: string = String(body.note ?? "").trim()

  if (!partnerId || isNaN(partnerId)) {
    return NextResponse.json({ success: false, message: "Geçersiz partner ID." }, { status: 400 })
  }
  if (!mongoUserId || !username) {
    return NextResponse.json({ success: false, message: "Kullanıcı bilgisi gerekli." }, { status: 400 })
  }

  const sql = neon(dbUrl)

  // Partner bilet sistemi aktif mi?
  const partnerRows = await sql`SELECT id, ticket_enabled, ticket_threshold FROM affiliate_users WHERE id = ${partnerId} LIMIT 1`
  const partner = partnerRows[0]
  if (!partner) return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })
  if (!partner.ticket_enabled) return NextResponse.json({ success: false, message: "Bu partner için bilet sistemi aktif değil." }, { status: 400 })

  // Manuel bilet — tx_id olarak benzersiz bir key üret
  const txId = `manual_${Date.now()}_${mongoUserId}_${Math.random().toString(36).slice(2, 8)}`
  const depositAmount = ticketCount * (partner.ticket_threshold ?? 1000)

  await sql`
    INSERT INTO affiliate_tickets (partner_id, mongo_user_id, username, tx_id, deposit_amount, ticket_count)
    VALUES (${partnerId}, ${mongoUserId}, ${username}, ${txId}, ${depositAmount}, ${ticketCount})
  `

  return NextResponse.json({
    success: true,
    message: `${username} kullanıcısına ${ticketCount} adet bilet eklendi.`,
    note,
  })
}

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return
  const uri = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, {
    dbName: "bizzocazino",
    bufferCommands: false,
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    family: 4,
  })
  if (!mongoose.connection.db)
    await new Promise<void>((r) => mongoose.connection.once("connected", () => r()))
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })

  const sql = neon(dbUrl)
  const { searchParams } = new URL(req.url)
  const isAdmin = session.role === "superadmin" || session.role === "admin"

  // Resolve partner record
  let partnerRow: any = null
  if (isAdmin) {
    const partnerId = searchParams.get("partnerId")
    if (!partnerId) {
      return NextResponse.json({ success: false, message: "partnerId gerekli." }, { status: 400 })
    }
    const rows = await sql`SELECT id, username, ref_code, ticket_enabled, ticket_threshold, ticket_goal, ticket_start_date FROM affiliate_users WHERE id = ${parseInt(partnerId, 10)} LIMIT 1`
    partnerRow = rows[0] ?? null
  } else {
    // Partner kendi biletlerini görüyor
    const rows = await sql`SELECT id, username, ref_code, ticket_enabled, ticket_threshold, ticket_goal, ticket_start_date FROM affiliate_users WHERE username = ${session.username} LIMIT 1`
    partnerRow = rows[0] ?? null
  }

  if (!partnerRow) return NextResponse.json({ success: false, message: "Partner bulunamadı." }, { status: 404 })
  if (!partnerRow.ticket_enabled)
    return NextResponse.json({ success: true, enabled: false, tickets: [], stats: { totalTickets: 0, participants: 0 } })

  const threshold: number = partnerRow.ticket_threshold ?? 1000
  const partnerId: number = partnerRow.id
  const startDate: Date | null = partnerRow.ticket_start_date ? new Date(partnerRow.ticket_start_date) : null

  // ── Sync new deposits → tickets (idempotent via UNIQUE tx_id + partner_id) ──
  try {
    await connectDB()
    const db = mongoose.connection.db!

    // Get referral user ids for this partner
    const users = db.collection("users")
    const refCode: string = partnerRow.ref_code
    let refUserIds: any[] = []

    if (refCode) {
      const partner = await users.findOne({ "affiliates.code": refCode }, { projection: { _id: 1 } })
      const orConds: any[] = [
        { "affiliates.redeemedCode": refCode },
        { "affiliates.referrerUsername": refCode },
        { "affiliates.referrerUsername": partnerRow.username },
      ]
      if (partner) orConds.push({ "affiliates.referrer": partner._id })
      const refDocs = await users.find({ $or: orConds }, { projection: { _id: 1, username: 1 } }).toArray()
      refUserIds = refDocs
    }

    if (refUserIds.length > 0) {
      const userIdList = refUserIds.map((u: any) => u._id)
      const usernameMap: Record<string, string> = {}
      for (const u of refUserIds) usernameMap[String(u._id)] = u.username

      const approvedStatuses = ["approved", "completed", "success", "confirmed"]
      const financeTx = db.collection("forcelabfinancetransactions")
      const meeldevTx = db.collection("meeldevtransactions")

      const dateFilter = startDate ? { createdAt: { $gte: startDate } } : {}
      // Bonus işlemlerini hariç tut
      const notBonusFilter = { 
        providerName: { $not: { $regex: /bonus/i } },
        providerSlug: { $not: { $regex: /bonus/i } }
      }

      const [forcelabDeps, meelDeps] = await Promise.all([
        financeTx.find({ user: { $in: userIdList }, providerType: "deposit", status: { $in: approvedStatuses }, ...dateFilter, ...notBonusFilter },
          { projection: { _id: 1, user: 1, amount: 1 } }).toArray(),
        meeldevTx.find({ user: { $in: userIdList }, type: "deposit", status: { $in: approvedStatuses }, ...dateFilter, ...notBonusFilter },
          { projection: { _id: 1, user: 1, amount: 1 } }).toArray(),
      ])

      const allDeps = [...forcelabDeps, ...meelDeps]

      // Batch upsert tickets — one row per tx_id+partner_id (UNIQUE constraint)
      for (const dep of allDeps) {
        const txId = String(dep._id)
        const uid = String(dep.user)
        const username = usernameMap[uid] ?? uid
        const amount: number = dep.amount ?? 0
        const ticketCount = Math.floor(amount / threshold)
        if (ticketCount < 1) continue

        await sql`
          INSERT INTO affiliate_tickets (partner_id, mongo_user_id, username, tx_id, deposit_amount, ticket_count)
          VALUES (${partnerId}, ${uid}, ${username}, ${txId}, ${amount}, ${ticketCount})
          ON CONFLICT (tx_id, partner_id) DO NOTHING
        `
      }
    }
  } catch (mongoErr) {
    console.error("[tickets] MongoDB sync error:", mongoErr)
    // Non-fatal — still return existing tickets from Neon
  }

  // ── Fetch tickets from Neon ──
  const page = parseInt(searchParams.get("page") ?? "1")
  const limit = 50
  const offset = (page - 1) * limit
  const tabFilter = searchParams.get("tab") ?? "tickets"

  const [ticketRows, statsRows] = await Promise.all([
    tabFilter === "participants"
      ? sql`
          SELECT mongo_user_id, username,
                 SUM(ticket_count) AS total_tickets,
                 SUM(deposit_amount) AS total_deposit,
                 MAX(created_at) AS last_at
          FROM affiliate_tickets
          WHERE partner_id = ${partnerId}
          GROUP BY mongo_user_id, username
          ORDER BY total_tickets DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : sql`
          SELECT id, mongo_user_id, username, tx_id, deposit_amount, ticket_count, created_at,
                 SUM(ticket_count) OVER (ORDER BY id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_end,
                 SUM(ticket_count) OVER (ORDER BY id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                   - ticket_count + 1 AS running_start
          FROM affiliate_tickets
          WHERE partner_id = ${partnerId}
          ORDER BY id ASC
        `,
    sql`
      SELECT
        COALESCE(SUM(ticket_count), 0)            AS total_tickets,
        COUNT(DISTINCT mongo_user_id)              AS participants,
        COALESCE(SUM(deposit_amount), 0)           AS total_deposit
      FROM affiliate_tickets
      WHERE partner_id = ${partnerId}
    `,
  ])

  const stats = statsRows[0] ?? {}

  // Expand each DB row into individual ticket entries (one per ticket_count)
  type RawRow = { id: number; mongo_user_id: string; username: string; tx_id: string; deposit_amount: string; ticket_count: number; created_at: string; running_start: number; running_end: number }
  const expandedTickets: { ticketNo: number; mongo_user_id: string; username: string; tx_id: string; deposit_amount: string; total_deposit: string; ticket_count: number; created_at: string }[] = []

  if (tabFilter !== "participants") {
    for (const row of ticketRows as RawRow[]) {
      const start = Number(row.running_start)
      const count = Number(row.ticket_count)
      for (let i = 0; i < count; i++) {
        expandedTickets.push({
          ticketNo: start + i,
          mongo_user_id: row.mongo_user_id,
          username: row.username,
          tx_id: row.tx_id,
          // Her bilet = 1 eşik tutarı (threshold), toplam yatırım total_deposit'te tutuluyor
          deposit_amount: String(threshold),
          total_deposit: row.deposit_amount,
          ticket_count: count,
          created_at: row.created_at,
        })
      }
    }
    // Apply pagination on expanded list
    const totalExpanded = expandedTickets.length
    const paginated = expandedTickets.slice(offset, offset + limit)
    return NextResponse.json({
      success: true,
      enabled: true,
      threshold,
      ticketGoal: partnerRow.ticket_goal ?? 10000,
      startDate: partnerRow.ticket_start_date ?? null,
      partnerId,
      partnerUsername: partnerRow.username,
      stats: {
        totalTickets: Number(stats.total_tickets ?? 0),
        participants: Number(stats.participants ?? 0),
        totalDeposit: Number(stats.total_deposit ?? 0),
      },
      tickets: paginated,
      totalExpanded,
      page,
    })
  }

  return NextResponse.json({
    success: true,
    enabled: true,
    threshold,
    ticketGoal: partnerRow.ticket_goal ?? 10000,
    startDate: partnerRow.ticket_start_date ?? null,
    partnerId,
    partnerUsername: partnerRow.username,
    stats: {
      totalTickets: Number(stats.total_tickets ?? 0),
      participants: Number(stats.participants ?? 0),
      totalDeposit: Number(stats.total_deposit ?? 0),
    },
    tickets: ticketRows,
    page,
  })
}
