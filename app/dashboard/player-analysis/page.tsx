"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"

// ── Types ────────────────────────────────────────────────────────────────────

interface PlayerSummary {
  userId: string
  username: string
  name: string | null
  currentBalance: number
  redeemedCode: string | null
  totalBet: number
  totalWin: number
  totalProfit: number
  txnCount: number
  lastTxn: string | null
  providers: string[]
}

interface GameRound {
  txn_id: string
  game_code: string
  game_name: string
  provider_code: string
  game_type: string
  bet: number
  win: number
  profit: number
  balance_before: number
  balance_after: number
  created_at: string
}

interface PlayerDetail {
  user: { username: string; name: string | null; currentBalance: number }
  summary: { totalBet: number; totalWin: number; totalProfit: number; roundCount: number }
  rounds: GameRound[]
}

interface GlobalSummary {
  totalBet: number
  totalWin: number
  totalProfit: number
  uniquePlayers: number
  txnCount: number
}

const PERIODS = [
  { label: "Bugün",        value: "today" },
  { label: "Bu Hafta",     value: "week" },
  { label: "Bu Ay",        value: "month" },
  { label: "Tüm Zamanlar", value: "all" },
  { label: "Özel Tarih",   value: "custom" },
]

function getDateRange(period: string): { startDate?: number; endDate?: number } {
  const now = new Date()
  if (period === "today") {
    const s = new Date(now); s.setHours(0,0,0,0)
    return { startDate: s.getTime(), endDate: now.getTime() }
  }
  if (period === "week") {
    const s = new Date(now); s.setDate(s.getDate() - 7); s.setHours(0,0,0,0)
    return { startDate: s.getTime(), endDate: now.getTime() }
  }
  if (period === "month") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1)
    return { startDate: s.getTime(), endDate: now.getTime() }
  }
  return {}
}

function fmt(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 })
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
      <span className="text-sm font-bold text-primary uppercase">{name[0]}</span>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function PlayerAnalysisPage() {
  const router = useRouter()

  // Auth guard
  const [role, setRole] = useState<string>("")
  const [token, setToken] = useState<string>("")
  useEffect(() => {
    const raw = localStorage.getItem("affiliate_user")
    const tok = localStorage.getItem("affiliate_token") || ""
    if (!raw || !tok) { router.push("/"); return }
    try {
      const parsed = JSON.parse(raw)
      if (parsed.role !== "superadmin") { router.push("/dashboard"); return }
      setRole(parsed.role)
      setToken(tok)
    } catch { router.push("/") }
  }, [router])

  // Filters
  const [period, setPeriod]           = useState("all")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd]     = useState("")
  const [search, setSearch]           = useState("")
  const [searchInput, setSearchInput] = useState("")
  const searchTimeout                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Data
  const [players, setPlayers]       = useState<PlayerSummary[]>([])
  const [summary, setSummary]       = useState<GlobalSummary | null>(null)
  const [loading, setLoading]       = useState(false)

  // Drawer
  const [drawerOpen, setDrawerOpen]     = useState(false)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerData, setDrawerData]     = useState<PlayerDetail | null>(null)
  const [drawerPlayer, setDrawerPlayer] = useState("")

  // ── Fetch list ─────────────────────────────────────────────────────────────
  const fetchPlayers = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("username", search)
      const range = period === "custom"
        ? {
            startDate: customStart ? new Date(customStart).getTime() : undefined,
            endDate:   customEnd   ? new Date(customEnd + "T23:59:59").getTime() : undefined,
          }
        : getDateRange(period)
      if (range.startDate) params.set("startDate", String(range.startDate))
      if (range.endDate)   params.set("endDate",   String(range.endDate))
      params.set("limit", "100")

      const res  = await fetch(`/api/affiliate/player-analysis?${params}`, { headers: { "x-auth-token": token } })
      const json = await res.json()
      if (json.success) {
        setPlayers(json.players ?? [])
        setSummary(json.summary ?? null)
      }
    } catch (e) { console.error("[PlayerAnalysis] fetch error:", e) }
    finally { setLoading(false) }
  }, [token, period, customStart, customEnd, search])

  useEffect(() => { if (token) fetchPlayers() }, [fetchPlayers, token])

  // Debounced search
  function handleSearchInput(v: string) {
    setSearchInput(v)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setSearch(v.trim()), 500)
  }

  // ── Open detail drawer ────────────────────────────────────────────────────
  async function openDrawer(username: string) {
    setDrawerPlayer(username)
    setDrawerOpen(true)
    setDrawerData(null)
    setDrawerLoading(true)
    try {
      const params = new URLSearchParams({ username, detail: "1" })
      const range = period === "custom"
        ? {
            startDate: customStart ? new Date(customStart).getTime() : undefined,
            endDate:   customEnd   ? new Date(customEnd + "T23:59:59").getTime() : undefined,
          }
        : getDateRange(period)
      if (range.startDate) params.set("startDate", String(range.startDate))
      if (range.endDate)   params.set("endDate",   String(range.endDate))

      const res  = await fetch(`/api/affiliate/player-analysis?${params}`, { headers: { "x-auth-token": token } })
      const json = await res.json()
      if (json.success) setDrawerData(json)
    } catch (e) { console.error("[PlayerAnalysis] drawer error:", e) }
    finally { setDrawerLoading(false) }
  }

  if (!role) return null

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Oyuncu Analizi</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Oyuncuların oyun işlemlerini ve bakiye hareketlerini inceleyin</p>
        </div>
        <button
          onClick={fetchPlayers}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground font-medium">Periyot:</span>
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              period === p.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      {period === "custom" && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Başlangıç:</label>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Bitiş:</label>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <button
            onClick={fetchPlayers}
            className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Uygula
          </button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: "Toplam Bahis",   value: `₺${fmt(summary.totalBet)}`,                                      color: "text-foreground" },
            { label: "Toplam Kazanç",  value: `₺${fmt(summary.totalWin)}`,                                      color: "text-success" },
            { label: "Toplam Zarar",   value: `₺${fmt(Math.max(0, summary.totalBet - summary.totalWin))}`,      color: "text-destructive" },
            { label: "Kasa Karı",      value: `₺${fmt(-summary.totalProfit)}`,                                  color: summary.totalProfit < 0 ? "text-success" : "text-destructive" },
            { label: "Oyuncu Sayısı",  value: summary.uniquePlayers.toLocaleString("tr-TR"),                    color: "text-foreground" },
            { label: "İşlem Sayısı",   value: summary.txnCount.toLocaleString("tr-TR"),                         color: "text-foreground" },
          ].map(card => (
            <div key={card.label} className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
              <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          value={searchInput}
          onChange={e => handleSearchInput(e.target.value)}
          placeholder="Kullanıcı adı ile ara..."
          className="w-full pl-10 pr-4 py-2.5 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Players table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : players.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-10 h-10 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
            </svg>
            <p className="text-sm text-muted-foreground">Oyuncu bulunamadı</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Oyuncu</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mevcut Bakiye</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Toplam Bahis</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Toplam Kazanç</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Kasa Karı</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">İşlem</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Partner</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Son İşlem</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {players.map((p, i) => {
                  const kasaKari = -(p.totalProfit) // kasa profit = negative of player profit
                  return (
                    <tr key={p.userId} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground text-xs">{offset + i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={p.username} />
                          <div>
                            <p className="font-semibold text-foreground">{p.username}</p>
                            {p.name && <p className="text-xs text-muted-foreground">{p.name}</p>}
                            {p.providers.length > 0 && (
                              <p className="text-xs text-muted-foreground/70 mt-0.5">{p.providers.slice(0,3).join(", ")}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">
                        ₺{fmt(p.currentBalance)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-foreground">
                        ₺{fmt(p.totalBet)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-success hidden md:table-cell">
                        ₺{fmt(p.totalWin)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm hidden md:table-cell">
                        <span className={kasaKari >= 0 ? "text-success" : "text-destructive"}>
                          {kasaKari >= 0 ? "+" : ""}₺{fmt(kasaKari)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs hidden lg:table-cell">
                        {p.txnCount.toLocaleString("tr-TR")}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {p.redeemedCode ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                            {p.redeemedCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden xl:table-cell">
                        {p.lastTxn ? new Date(p.lastTxn).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openDrawer(p.username)}
                          className="px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors whitespace-nowrap"
                        >
                          Detay
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Detail Drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="relative ml-auto w-full max-w-2xl h-full bg-card border-l border-border flex flex-col shadow-2xl">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="font-bold text-foreground text-base">{drawerPlayer} — Oyun Geçmişi</h3>
                {drawerData && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {drawerData.user.name && <span>{drawerData.user.name} · </span>}
                    Mevcut bakiye: <span className="font-semibold text-foreground">₺{fmt(drawerData.user.currentBalance)}</span>
                  </p>
                )}
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {drawerLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
            ) : drawerData ? (
              <>
                {/* Summary */}
  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-6 py-4 border-b border-border flex-shrink-0">
          {[
            { label: "Toplam Bahis",   value: `₺${fmt(drawerData.summary.totalBet)}`,                                           color: "text-foreground" },
            { label: "Toplam Kazanç",  value: `₺${fmt(drawerData.summary.totalWin)}`,                                           color: "text-success" },
            { label: "Toplam Zarar",   value: `₺${fmt(Math.max(0, drawerData.summary.totalBet - drawerData.summary.totalWin))}`, color: "text-destructive" },
            { label: "Kasa Karı",      value: `₺${fmt(-drawerData.summary.totalProfit)}`,                                       color: drawerData.summary.totalProfit < 0 ? "text-success" : "text-destructive" },
            { label: "Tur Sayısı",     value: drawerData.summary.roundCount.toLocaleString("tr-TR"),                            color: "text-foreground" },
          ].map(c => (
                    <div key={c.label} className="bg-secondary/50 rounded-xl p-3 text-center">
                      <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
                      <p className={`text-sm font-bold ${c.color}`}>{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Rounds table */}
                <div className="flex-1 overflow-y-auto">
                  {drawerData.rounds.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Kayıt bulunamadı</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card border-b border-border z-10">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Oyun</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Provider</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bahis</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kazanç</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kasa</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Önce</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Sonra</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Tarih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {drawerData.rounds.map((r, i) => {
                          const kasaKari = -r.profit
                          return (
                            <tr key={r.txn_id + i} className="hover:bg-secondary/20 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-medium text-foreground truncate max-w-[160px]">{r.game_name}</p>
                                <p className="text-xs text-muted-foreground">{r.game_type}</p>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">{r.provider_code}</td>
                              <td className="px-4 py-3 text-right font-mono text-sm text-foreground">
                                ₺{fmt(r.bet)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-sm text-success">
                                ₺{fmt(r.win)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-sm">
                                <span className={kasaKari >= 0 ? "text-success" : "text-destructive"}>
                                  {kasaKari >= 0 ? "+" : ""}₺{fmt(kasaKari)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground hidden md:table-cell">
                                ₺{fmtInt(r.balance_before)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground hidden md:table-cell">
                                ₺{fmtInt(r.balance_after)}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                                {r.created_at ? new Date(r.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Veri yüklenemedi</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Helper for offset (used in table row numbers)
const offset = 0
