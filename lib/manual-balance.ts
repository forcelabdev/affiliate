import { neon } from "@neondatabase/serverless"

export type ManualBalanceType = "deposit" | "withdrawal"
export type ManualBalanceProvider = "filux" | "xpayment"

export interface ManualBalanceLog {
  id: number
  targetUsername: string
  type: ManualBalanceType
  provider: ManualBalanceProvider
  amount: number
  note: string | null
  oldTotal: number | null
  newTotal: number | null
  addedBy: string
  createdAt: string
}

export interface ManualTotals {
  deposit: number
  withdrawal: number
}

function getSql() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null
  return neon(databaseUrl)
}

function mapRow(row: any): ManualBalanceLog {
  return {
    id: row.id,
    targetUsername: row.target_username,
    type: row.type,
    provider: row.provider,
    amount: Number(row.amount ?? 0),
    note: row.note ?? null,
    oldTotal: row.old_total != null ? Number(row.old_total) : null,
    newTotal: row.new_total != null ? Number(row.new_total) : null,
    addedBy: row.added_by,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at ?? ""),
  }
}

/** Belirli bir kullanıcının manuel yatırım/çekim toplamını getirir.
 *  İsteğe bağlı tarih aralığı ile filtrelenebilir.
 */
export async function getManualTotalsForUser(
  username: string,
  dateRange?: { start?: Date | null; end?: Date | null }
): Promise<ManualTotals> {
  const sql = getSql()
  if (!sql || !username) return { deposit: 0, withdrawal: 0 }

  try {
    const start = dateRange?.start ?? null
    const end = dateRange?.end ?? null

    const rows = await sql`
      SELECT type, COALESCE(SUM(amount), 0) as total
      FROM manual_balance_logs
      WHERE target_username = ${username}
        AND (${start}::timestamptz IS NULL OR created_at >= ${start})
        AND (${end}::timestamptz IS NULL OR created_at <= ${end})
      GROUP BY type
    `

    const totals: ManualTotals = { deposit: 0, withdrawal: 0 }
    for (const row of rows as any[]) {
      if (row.type === "deposit") totals.deposit = Number(row.total ?? 0)
      else if (row.type === "withdrawal") totals.withdrawal = Number(row.total ?? 0)
    }
    return totals
  } catch (err) {
    console.warn("[manual-balance] getManualTotalsForUser error:", err)
    return { deposit: 0, withdrawal: 0 }
  }
}

/** Birden fazla kullanıcı için toplu (batch) manuel toplam getirir.
 *  Partner listesi gibi çoklu kullanıcı sorgularında N+1 sorgu yerine tek sorgu kullanır.
 */
export async function getManualTotalsForUsers(
  usernames: string[],
  dateRange?: { start?: Date | null; end?: Date | null }
): Promise<Record<string, ManualTotals>> {
  const sql = getSql()
  const result: Record<string, ManualTotals> = {}
  const uniqueUsernames = Array.from(new Set(usernames.filter(Boolean)))
  if (!sql || uniqueUsernames.length === 0) return result

  try {
    const start = dateRange?.start ?? null
    const end = dateRange?.end ?? null

    const rows = await sql`
      SELECT target_username, type, COALESCE(SUM(amount), 0) as total
      FROM manual_balance_logs
      WHERE target_username = ANY(${uniqueUsernames})
        AND (${start}::timestamptz IS NULL OR created_at >= ${start})
        AND (${end}::timestamptz IS NULL OR created_at <= ${end})
      GROUP BY target_username, type
    `

    for (const row of rows as any[]) {
      const uname = row.target_username as string
      if (!result[uname]) result[uname] = { deposit: 0, withdrawal: 0 }
      if (row.type === "deposit") result[uname].deposit = Number(row.total ?? 0)
      else if (row.type === "withdrawal") result[uname].withdrawal = Number(row.total ?? 0)
    }
    return result
  } catch (err) {
    console.warn("[manual-balance] getManualTotalsForUsers error:", err)
    return result
  }
}

/** Toplam manuel deposit/withdrawal toplamını (tüm kullanıcılar) getirir — genel bakış kartları için. */
export async function getManualTotalsOverall(
  dateRange?: { start?: Date | null; end?: Date | null }
): Promise<ManualTotals> {
  const sql = getSql()
  if (!sql) return { deposit: 0, withdrawal: 0 }

  try {
    const start = dateRange?.start ?? null
    const end = dateRange?.end ?? null

    const rows = await sql`
      SELECT type, COALESCE(SUM(amount), 0) as total
      FROM manual_balance_logs
      WHERE (${start}::timestamptz IS NULL OR created_at >= ${start})
        AND (${end}::timestamptz IS NULL OR created_at <= ${end})
      GROUP BY type
    `

    const totals: ManualTotals = { deposit: 0, withdrawal: 0 }
    for (const row of rows as any[]) {
      if (row.type === "deposit") totals.deposit = Number(row.total ?? 0)
      else if (row.type === "withdrawal") totals.withdrawal = Number(row.total ?? 0)
    }
    return totals
  } catch (err) {
    console.warn("[manual-balance] getManualTotalsOverall error:", err)
    return { deposit: 0, withdrawal: 0 }
  }
}

/** Manuel deposit toplamlarını gün bazında gruplar — Deposit Grafiği gibi zaman serisi
 *  gösterimlerinde kullanılır. usernames boş bırakılırsa (superadmin genel bakış) tüm
 *  kullanıcıların manuel kayıtları dahil edilir.
 */
export async function getManualDailyDeposits(
  dateRange: { start: Date; end: Date },
  usernames?: string[]
): Promise<Record<string, number>> {
  const sql = getSql()
  const result: Record<string, number> = {}
  if (!sql) return result

  const uniqueUsernames = usernames ? Array.from(new Set(usernames.filter(Boolean))) : null

  try {
    const rows = uniqueUsernames
      ? await sql`
          SELECT to_char(created_at, 'YYYY-MM-DD') as day, COALESCE(SUM(amount), 0) as total
          FROM manual_balance_logs
          WHERE type = 'deposit'
            AND target_username = ANY(${uniqueUsernames})
            AND created_at >= ${dateRange.start}
            AND created_at <= ${dateRange.end}
          GROUP BY day
        `
      : await sql`
          SELECT to_char(created_at, 'YYYY-MM-DD') as day, COALESCE(SUM(amount), 0) as total
          FROM manual_balance_logs
          WHERE type = 'deposit'
            AND created_at >= ${dateRange.start}
            AND created_at <= ${dateRange.end}
          GROUP BY day
        `
    for (const row of rows as any[]) {
      result[row.day] = Number(row.total ?? 0)
    }
    return result
  } catch (err) {
    console.warn("[manual-balance] getManualDailyDeposits error:", err)
    return result
  }
}

/** Yeni manuel kayıt ekler. old_total/new_total, o kullanıcının o tip (deposit/withdrawal)
 *  için mevcut toplamı üzerinden otomatik hesaplanır.
 */
export async function addManualBalanceLog(params: {
  targetUsername: string
  type: ManualBalanceType
  provider: ManualBalanceProvider
  amount: number
  note?: string | null
  addedBy: string
}): Promise<ManualBalanceLog> {
  const sql = getSql()
  if (!sql) throw new Error("DATABASE_URL is not set")

  const { targetUsername, type, provider, amount, note, addedBy } = params

  const existingTotals = await getManualTotalsForUser(targetUsername)
  const oldTotal = type === "deposit" ? existingTotals.deposit : existingTotals.withdrawal
  const newTotal = oldTotal + amount

  const rows = await sql`
    INSERT INTO manual_balance_logs (target_username, type, provider, amount, note, old_total, new_total, added_by)
    VALUES (${targetUsername}, ${type}, ${provider}, ${amount}, ${note ?? null}, ${oldTotal}, ${newTotal}, ${addedBy})
    RETURNING *
  `

  return mapRow((rows as any[])[0])
}

/** Belirli bir kullanıcı adı kümesi için manuel kayıtları getirir (opsiyonel tip ve tarih filtresiyle).
 *  Partner/deposits/withdrawals sayfalarında referral üyelerinin manuel işlem geçmişini göstermek için kullanılır.
 */
export async function listManualBalanceLogsForUsers(
  usernames: string[],
  filters?: { type?: ManualBalanceType; dateRange?: { start?: Date | null; end?: Date | null } }
): Promise<ManualBalanceLog[]> {
  const sql = getSql()
  const uniqueUsernames = Array.from(new Set(usernames.filter(Boolean)))
  if (!sql || uniqueUsernames.length === 0) return []

  const type = filters?.type ?? null
  const start = filters?.dateRange?.start ?? null
  const end = filters?.dateRange?.end ?? null

  try {
    const rows = await sql`
      SELECT * FROM manual_balance_logs
      WHERE target_username = ANY(${uniqueUsernames})
        AND (${type}::text IS NULL OR type = ${type})
        AND (${start}::timestamptz IS NULL OR created_at >= ${start})
        AND (${end}::timestamptz IS NULL OR created_at <= ${end})
      ORDER BY created_at DESC
    `
    return (rows as any[]).map(mapRow)
  } catch (err) {
    console.warn("[manual-balance] listManualBalanceLogsForUsers error:", err)
    return []
  }
}

/** Kullanıcı adı kümesiyle sınırlamadan TÜM manuel kayıtları getirir (opsiyonel tip ve tarih filtresiyle).
 *  Bakiye Analizi / grafik gibi sayfalarda, henüz başka bir koleksiyonda (bonus, kampanya vb.) görünmeyen
 *  kullanıcıların da manuel kayıtlarının kaçırılmamasını sağlar.
 */
export async function listAllManualBalanceLogs(filters?: {
  type?: ManualBalanceType
  dateRange?: { start?: Date | null; end?: Date | null }
}): Promise<ManualBalanceLog[]> {
  const sql = getSql()
  if (!sql) return []

  const type = filters?.type ?? null
  const start = filters?.dateRange?.start ?? null
  const end = filters?.dateRange?.end ?? null

  try {
    const rows = await sql`
      SELECT * FROM manual_balance_logs
      WHERE (${type}::text IS NULL OR type = ${type})
        AND (${start}::timestamptz IS NULL OR created_at >= ${start})
        AND (${end}::timestamptz IS NULL OR created_at <= ${end})
      ORDER BY created_at DESC
    `
    return (rows as any[]).map(mapRow)
  } catch (err) {
    console.warn("[manual-balance] listAllManualBalanceLogs error:", err)
    return []
  }
}

/** İşlem geçmişini listeler — en son kayıtlar önce. */
export async function listManualBalanceLogs(params?: {
  limit?: number
  offset?: number
  targetUsername?: string
}): Promise<{ logs: ManualBalanceLog[]; total: number }> {
  const sql = getSql()
  if (!sql) return { logs: [], total: 0 }

  const limit = params?.limit ?? 50
  const offset = params?.offset ?? 0
  const targetUsername = params?.targetUsername?.trim() || null

  try {
    const [rows, countRows] = await Promise.all([
      sql`
        SELECT * FROM manual_balance_logs
        WHERE (${targetUsername}::text IS NULL OR target_username = ${targetUsername})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*) as count FROM manual_balance_logs
        WHERE (${targetUsername}::text IS NULL OR target_username = ${targetUsername})
      `,
    ])

    return {
      logs: (rows as any[]).map(mapRow),
      total: Number((countRows as any[])[0]?.count ?? 0),
    }
  } catch (err) {
    console.warn("[manual-balance] listManualBalanceLogs error:", err)
    return { logs: [], total: 0 }
  }
}
