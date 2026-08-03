"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"

// ── Types ──────────────────────────────────────────────────────────────────────

interface BonusLog {
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
}

interface CampaignLog {
  id: string
  title: string | null
  amount: number
  mode: string | null
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
  totalBalance: number
  bonusCount: number
  campaignCount: number
  bonusLogs: BonusLog[]
  campaignLogs: CampaignLog[]
}

interface Summary {
  totalBonus: number
  totalCampaign: number
  totalBalance: number
  totalUsers: number
  totalBonusCount: number
  totalCampaignCount: number
  // kind breakdown
  totalBonusKindAmount: number
  totalBonusKindCount: number
  totalBalanceKindAmount: number
  totalBalanceKindCount: number
  // ödeme yöntemi deposit totalleri
  totalFiluxAmount: number
  totalFiluxCount: number
  totalXpayAmount: number
  totalXpayCount: number
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmt(n: number) {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  if (!d) return "—"
  return new Date(d).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
}

const KIND_LABELS: Record<string, string> = {
  bonus:   "Bonus",
  balance: "Bakiye",
  Rivo:    "Rivo",
}

const KIND_COLORS: Record<string, string> = {
  bonus:   "bg-amber-500/10 text-amber-500 border-amber-500/20",
  balance: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Rivo:    "bg-violet-500/10 text-violet-500 border-violet-500/20",
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BalanceAnalysisPage() {
  const router = useRouter()
  const [token, setToken] = useState("")

  // Auth
  useEffect(() => {
    const raw = localStorage.getItem("affiliate_user")
    const tok = localStorage.getItem("affiliate_token") || ""
    if (!raw || !tok) { router.push("/"); return }
    try {
      const parsed = JSON.parse(raw)
      if (parsed.role !== "superadmin" && parsed.role !== "admin") { router.push("/dashboard"); return }
      setToken(tok)
    } catch { router.push("/") }
  }, [router])

  // Filters
  const [period, setPeriod]           = useState("all")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd]     = useState("")
  // appliedStart/End are only updated when the user clicks "Uygula" — never on every keystroke
  const [appliedStart, setAppliedStart] = useState("")
  const [appliedEnd, setAppliedEnd]     = useState("")
  const [search, setSearch]           = useState("")
  const [searchInput, setSearchInput] = useState("")
  const searchTimeout                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Data
  const [users, setUsers]       = useState<UserBalance[]>([])
  const [summary, setSummary]   = useState<Summary | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading]   = useState(false)
  const [page, setPage]         = useState(1)

  // Expanded rows
  const [expandedUsers, setExpanded] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab]    = useState<Record<string, "bonus" | "campaign">>({})

  // Fetch
  const fetchData = useCallback(async (p = 1) => {
    if (!token) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      const range = period === "custom"
        ? {
            startDate: appliedStart ? new Date(appliedStart).getTime() : undefined,
            endDate:   appliedEnd   ? new Date(appliedEnd + "T23:59:59").getTime() : undefined,
          }
        : getDateRange(period)
      if (range.startDate) params.set("startDate", String(range.startDate))
      if (range.endDate)   params.set("endDate",   String(range.endDate))
      params.set("page",  String(p))
      params.set("limit", "50")

      const res  = await fetch(`/api/affiliate/balance-analysis?${params}`, {
        headers: { "x-auth-token": token },
      })
      const json = await res.json()
      if (json.success) {
        setUsers(json.users ?? [])
        setSummary(json.summary ?? null)
        setPagination(json.pagination ?? null)
        setPage(p)
      }
    } catch (e) { console.error("[BalanceAnalysis] fetch error:", e) }
    finally { setLoading(false) }
  }, [token, period, appliedStart, appliedEnd, search])

  useEffect(() => { if (token) fetchData(1) }, [fetchData, token])

  function handleSearchInput(v: string) {
    setSearchInput(v)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setSearch(v.trim()), 500)
  }

  function toggleExpand(uid: string) {
    setExpanded(prev => ({ ...prev, [uid]: !prev[uid] }))
  }

  function getTab(uid: string): "bonus" | "campaign" {
    return activeTab[uid] ?? "bonus"
  }

  if (!token) return null

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bakiye Analizi</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tüm üyelere yüklenen bonus ve kampanya bakiyelerinin toplu görünümü
          </p>
        </div>
        <button
          onClick={() => fetchData(page)}
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
            onClick={() => { setPeriod(p.value); if (p.value !== "custom") { setAppliedStart(""); setAppliedEnd("") } }}
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

      {/* Custom date */}
      {period === "custom" && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Başlangıç:</label>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"/>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Bitiş:</label>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"/>
          </div>
          <button
            onClick={() => { setAppliedStart(customStart); setAppliedEnd(customEnd) }}
            className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            Uygula
          </button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="flex flex-col gap-3">
          {/* Satır 1: Toplam + Manuel ayrımı */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {/* Toplam Yüklenen — büyük kart */}
            <div className="bg-card border border-border rounded-2xl p-4 col-span-2 md:col-span-1 xl:col-span-1">
              <p className="text-xs text-muted-foreground mb-1">Toplam Yüklenen</p>
              <p className="text-xl font-bold text-primary">₺{fmt(summary.totalBalance)}</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">{summary.totalUsers.toLocaleString("tr-TR")} üye</p>
            </div>

            {/* Toplam Deposit (Filux + xPayment) */}
            <div className="bg-card border border-orange-500/20 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Toplam Deposit</p>
              <p className="text-xl font-bold text-orange-400">₺{fmt(summary.totalFiluxAmount + summary.totalXpayAmount)}</p>
              <p className="text-[11px] text-orange-400/60 mt-1">{(summary.totalFiluxCount + summary.totalXpayCount)} işlem (Filux + xPayment)</p>
            </div>

            {/* Eklenen Bonus (kind=bonus) */}
            <div className="bg-card border border-amber-500/20 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Manuel Eklenen Bonus</p>
              <p className="text-xl font-bold text-amber-500">₺{fmt(summary.totalBonusKindAmount)}</p>
              <p className="text-[11px] text-amber-500/60 mt-1">{summary.totalBonusKindCount} işlem</p>
            </div>

            {/* Eklenen Bakiye (kind=balance) */}
            <div className="bg-card border border-emerald-500/20 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Manuel Eklenen Bakiye</p>
              <p className="text-xl font-bold text-emerald-500">₺{fmt(summary.totalBalanceKindAmount)}</p>
              <p className="text-[11px] text-emerald-500/60 mt-1">{summary.totalBalanceKindCount} işlem</p>
            </div>

            {/* Filux Deposit */}
            <div className="bg-card border border-cyan-500/20 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Filux Eklenen Bakiye</p>
              <p className="text-xl font-bold text-cyan-400">₺{fmt(summary.totalFiluxAmount)}</p>
              <p className="text-[11px] text-cyan-400/60 mt-1">{summary.totalFiluxCount} işlem</p>
            </div>

            {/* xPayment Deposit */}
            <div className="bg-card border border-violet-500/20 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">xPayment Eklenen Bakiye</p>
              <p className="text-xl font-bold text-violet-400">₺{fmt(summary.totalXpayAmount)}</p>
              <p className="text-[11px] text-violet-400/60 mt-1">{summary.totalXpayCount} işlem</p>
            </div>
          </div>

          {/* Satır 2: Kampanya + sayaçlar */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-card border border-blue-500/20 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Kampanya Bonusu</p>
              <p className="text-xl font-bold text-blue-500">₺{fmt(summary.totalCampaign)}</p>
              <p className="text-[11px] text-blue-500/60 mt-1">{summary.totalCampaignCount} işlem</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Manuel İşlem (Toplam)</p>
              <p className="text-xl font-bold text-foreground">{summary.totalBonusCount.toLocaleString("tr-TR")}</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Kampanya İşlem</p>
              <p className="text-xl font-bold text-foreground">{summary.totalCampaignCount.toLocaleString("tr-TR")}</p>
            </div>
          </div>
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
          placeholder="Kullanıcı adı, partner veya ref kodu ile ara..."
          className="w-full pl-10 pr-4 py-2.5 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-10 h-10 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <p className="text-sm text-muted-foreground">Kayıt bulunamadı</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Üye</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Partner</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Manuel Bonus</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Kampanya</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Toplam</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">İşlem</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const isOpen = expandedUsers[u.userId]
                  const tab    = getTab(u.userId)
                  return (
                    <React.Fragment key={u.userId}>
                      {/* Main row */}
                      <tr className={`border-b border-border transition-colors ${isOpen ? "bg-secondary/20" : "hover:bg-secondary/10"}`}>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {(page - 1) * 50 + i + 1}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary uppercase">{u.username[0]}</span>
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{u.username}</p>
                              {u.name && <p className="text-xs text-muted-foreground">{u.name}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {u.partnerName ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                              {u.partnerName}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-amber-500 font-semibold">
                          ₺{fmt(u.totalBonus)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-blue-500 hidden lg:table-cell">
                          ₺{fmt(u.totalCampaign)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-primary">
                          ₺{fmt(u.totalBalance)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden xl:table-cell">
                          <span className="text-amber-500">{u.bonusCount}</span>
                          {" + "}
                          <span className="text-blue-500">{u.campaignCount}</span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleExpand(u.userId)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border whitespace-nowrap ${
                              isOpen
                                ? "bg-secondary text-foreground border-border"
                                : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                            }`}
                          >
                            {isOpen ? "Gizle" : "Detay"}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="bg-secondary/10 border-b border-border px-4 py-4">
                            {/* Tabs */}
                            <div className="flex items-center gap-2 mb-4">
                              <button
                                onClick={() => setActiveTab(prev => ({ ...prev, [u.userId]: "bonus" }))}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                                  tab === "bonus"
                                    ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                    : "border-border text-muted-foreground hover:bg-secondary"
                                }`}
                              >
                                Manuel Bonus ({u.bonusCount})
                              </button>
                              <button
                                onClick={() => setActiveTab(prev => ({ ...prev, [u.userId]: "campaign" }))}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                                  tab === "campaign"
                                    ? "bg-blue-500/10 text-blue-500 border-blue-500/30"
                                    : "border-border text-muted-foreground hover:bg-secondary"
                                }`}
                              >
                                Kampanya ({u.campaignCount})
                              </button>
                            </div>

                            {/* Bonus logs */}
                            {tab === "bonus" && (
                              u.bonusLogs.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-4 text-center">Manuel bonus kaydı yok</p>
                              ) : (
                                <div className="overflow-x-auto rounded-xl border border-border">
                                  <table className="w-full text-xs">
                                    <thead className="bg-secondary/40">
                                      <tr>
                                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Tür</th>
                                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Kategori</th>
                                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Not</th>
                                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Admin</th>
                                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Miktar</th>
                                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Önce / Sonra</th>
                                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Tarih</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                      {u.bonusLogs.map(log => (
                                        <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                                          <td className="px-3 py-2">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${KIND_COLORS[log.type] ?? "bg-secondary text-foreground border-border"}`}>
                                              {KIND_LABELS[log.type] ?? log.type}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground">
                                            {log.category ?? "—"}
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell italic max-w-[180px] truncate">
                                            {log.note || "—"}
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                                            {log.actorUsername ?? "—"}
                                          </td>
                                          <td className="px-3 py-2 text-right font-mono font-bold text-amber-500">
                                            +₺{fmt(log.amount)}
                                          </td>
                                          <td className="px-3 py-2 text-right text-muted-foreground hidden lg:table-cell">
                                            <span className="font-mono">₺{fmt(log.balanceBefore)}</span>
                                            <span className="mx-1 text-muted-foreground/50">→</span>
                                            <span className="font-mono">₺{fmt(log.balanceAfter)}</span>
                                          </td>
                                          <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                                            {fmtDate(log.createdAt)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="bg-secondary/30 border-t border-border">
                                      <tr>
                                        <td colSpan={4} className="px-3 py-2 font-semibold text-foreground text-xs">Toplam</td>
                                        <td className="px-3 py-2 text-right font-bold text-amber-500 font-mono">
                                          +₺{fmt(u.totalBonus)}
                                        </td>
                                        <td colSpan={2}></td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )
                            )}

                            {/* Campaign logs */}
                            {tab === "campaign" && (
                              u.campaignLogs.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-4 text-center">Kampanya kaydı yok</p>
                              ) : (
                                <div className="overflow-x-auto rounded-xl border border-border">
                                  <table className="w-full text-xs">
                                    <thead className="bg-secondary/40">
                                      <tr>
                                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Kampanya</th>
                                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Mod</th>
                                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Miktar</th>
                                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Tarih</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                      {u.campaignLogs.map(log => (
                                        <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                                          <td className="px-3 py-2 text-foreground">
                                            {log.title ?? "İsimsiz Kampanya"}
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                                            {log.mode === "auto" ? "Otomatik" : log.mode === "manual" ? "Manuel" : (log.mode ?? "—")}
                                          </td>
                                          <td className="px-3 py-2 text-right font-mono font-bold text-blue-500">
                                            +₺{fmt(log.amount)}
                                          </td>
                                          <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                                            {fmtDate(log.createdAt)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="bg-secondary/30 border-t border-border">
                                      <tr>
                                        <td colSpan={2} className="px-3 py-2 font-semibold text-foreground text-xs">Toplam</td>
                                        <td className="px-3 py-2 text-right font-bold text-blue-500 font-mono">
                                          +₺{fmt(u.totalCampaign)}
                                        </td>
                                        <td></td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Toplam <span className="font-semibold text-foreground">{pagination.total}</span> üye
            — Sayfa <span className="font-semibold text-foreground">{pagination.page}</span> / {pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
            >
              Önceki
            </button>
            <button
              onClick={() => fetchData(page + 1)}
              disabled={page >= pagination.totalPages || loading}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
            >
              Sonraki
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
