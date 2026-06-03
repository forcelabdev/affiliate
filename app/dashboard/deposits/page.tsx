"use client"

import { useEffect, useState, useCallback, useMemo } from "react"

interface DepositRecord {
  _id?: string
  id?: string
  amount: number
  title?: string
  type?: string
  status?: "approved" | "pending" | "rejected" | string
  method?: string
  createdAt?: string
  username?: string
  partnerName?: string | null
}

interface WithdrawalRecord {
  _id?: string
  amount: number
  status?: string
  createdAt?: string
  username?: string
}

interface UserTransaction {
  _id: string
  amount: number
  type: string
  providerName: string
  status: string
  createdAt?: string
  approvedAt?: string
  oldBalance?: number
  newBalance?: number
  currency: string
  note?: string | null
}

interface UserDetailData {
  user: { userId?: string; username: string; name?: string; redeemedCode?: string; currentBalance: number }
  summary: { totalDeposit: number; totalWithdrawal: number; txCount: number }
  transactions: UserTransaction[]
}

type Period = "daily" | "weekly" | "monthly" | "custom" | "all"

const PAGE_SIZE = 25

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  approved: { label: "Onaylandı", className: "bg-success/10 text-success" },
  pending:  { label: "Bekliyor",  className: "bg-warning/10 text-warning"  },
  rejected: { label: "Reddedildi", className: "bg-destructive/10 text-destructive" },
}

function getTRTime(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }))
}

function getTRMidnight(date: Date): number {
  // Verilen TR tarihinin gece yarısını UTC timestamp olarak döndürür
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return new Date(`${y}-${m}-${d}T00:00:00+03:00`).getTime()
}

function getPeriodStart(period: Period): number | null {
  if (period === "custom" || period === "all") return null
  const now = getTRTime()
  if (period === "daily") {
    return getTRMidnight(now)
  } else if (period === "weekly") {
    const d = new Date(now)
    d.setDate(d.getDate() - d.getDay())
    return getTRMidnight(d)
  } else {
    const d = new Date(now)
    d.setDate(1)
    return getTRMidnight(d)
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="text-muted-foreground/40">↕</span>
  return <span className="text-primary">{dir === "asc" ? "↑" : "↓"}</span>
}

const PERIOD_LABELS: Record<Period, string> = {
  daily: "Bugün", weekly: "Bu Hafta", monthly: "Bu Ay", custom: "Özel Tarih", all: "Tüm Zamanlar",
}

export default function DepositsPage() {
  const [flatDeposits, setFlatDeposits]   = useState<DepositRecord[]>([])
  const [withdrawals, setWithdrawals]     = useState<WithdrawalRecord[]>([])
  const [filtered, setFiltered]           = useState<DepositRecord[]>([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState("")
  const [statusFilter, setStatusFilter]   = useState<string>("all")
  const [period, setPeriod]               = useState<Period>("all")
  const [customStart, setCustomStart]     = useState("")
  const [customEnd, setCustomEnd]         = useState("")
  const [page, setPage]                   = useState(1)
  const [userId, setUserId]               = useState("")
  const [refCode, setRefCode]             = useState("")
  const [token, setToken]                 = useState("")
  const [sortKey, setSortKey]             = useState<"amount" | "createdAt">("createdAt")
  const [sortDir, setSortDir]             = useState<"asc" | "desc">("desc")
  const [commissionRate, setCommissionRate]   = useState(10)
  const [commissionType, setCommissionType]   = useState<"deposit" | "net">("deposit")
  const [role, setRole]                   = useState<string>("")
  const [expandedPartners, setExpandedPartners] = useState<Record<string, boolean>>({})
  const [drawerOpen, setDrawerOpen]             = useState(false)
  const [drawerLoading, setDrawerLoading]       = useState(false)
  const [drawerData, setDrawerData]             = useState<UserDetailData | null>(null)
  const [drawerUsername, setDrawerUsername]     = useState("")
  const [drawerMemberId, setDrawerMemberId]     = useState("")
  const [drawerPartnerId, setDrawerPartnerId]   = useState<number | null>(null)
  const [drawerPartnerName, setDrawerPartnerName] = useState("")
  const [promoDate, setPromoDate]               = useState(() => {
    const tr = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }))
    return `${tr.getFullYear()}-${String(tr.getMonth()+1).padStart(2,"0")}-${String(tr.getDate()).padStart(2,"0")}`
  })
  const [promoNote, setPromoNote]               = useState("")
  const [promoLoading, setPromoLoading]         = useState(false)
  const [promoResult, setPromoResult]           = useState<{ success: boolean; message: string } | null>(null)

  const fetchDeposits = useCallback(async (
    id: string, t: string, code?: string, p: Period = "all", r?: string,
    cStart?: string, cEnd?: string
  ) => {
    const isAdmin = (r || role) === "admin" || (r || role) === "superadmin"
    if (!isAdmin && !id && !code) { setLoading(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (code) params.append("refCode", code)
      else params.append("id", id)

      if (p === "custom" && cStart) {
        // TR saati UTC+3: "2026-04-21" → "2026-04-21T00:00:00+03:00" olarak parse et
        params.append("startDate", String(new Date(cStart + "T00:00:00+03:00").getTime()))
        if (cEnd) params.append("endDate", String(new Date(cEnd + "T23:59:59+03:00").getTime()))
      } else {
        const periodStart = getPeriodStart(p)
        if (periodStart) params.append("startDate", String(periodStart))
      }

      const [depositsRes, withdrawalsRes] = await Promise.all([
        fetch(`/api/affiliate/deposits?${params.toString()}`, { headers: { "x-auth-token": t } }),
        fetch(`/api/affiliate/withdrawals?${params.toString()}`, { headers: { "x-auth-token": t } }),
      ])
      const depositsJson  = await depositsRes.json().catch(() => ({}))
      const withdrawalsJson = await withdrawalsRes.json().catch(() => ({}))

      const raw = depositsJson?.data?.referrals ?? depositsJson?.referrals ?? depositsJson?.data ?? []
      const referrals = Array.isArray(raw) ? raw : []

      const flat: DepositRecord[] = []
      referrals.forEach((r: any) => {
        if (r.deposits && r.deposits.length > 0) {
          r.deposits.forEach((d: any) => flat.push({
            _id: d.txId || d._id,
            txId: d.txId,
            source: d.source,
            amount: d.amount,
            status: d.status,
            method: d.method,
            createdAt: d.createdAt,
            username: r.username,
            partnerName: r.partnerName,
          }))
        } else if (r.depositTotal && r.depositTotal > 0) {
          flat.push({
            _id: r._id || r.id,
            username: r.username,
            amount: r.depositTotal,
            status: "approved",
            method: "—",
            createdAt: r.createdAt,
            title: `${r.depositCount ?? 1} işlem`,
            partnerName: r.partnerName,
          })
        }
      })
      setFlatDeposits(flat)

      const wraw = withdrawalsJson?.data ?? []
      setWithdrawals(Array.isArray(wraw) ? wraw : [])
    } catch (e) {
      console.error("[deposits] fetch error:", e)
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const u = localStorage.getItem("affiliate_user")
    setToken(t)
    if (u) {
      try {
        const parsed = JSON.parse(u)
        const id   = parsed.affiliateId || parsed.id || parsed._id || ""
        const code = parsed.refCode || ""
        const r    = parsed.role || ""
        setUserId(id); setRefCode(code); setRole(r)
        if (typeof parsed.commissionRate === "number") setCommissionRate(parsed.commissionRate)
        if (parsed.commissionType) setCommissionType(parsed.commissionType)
        fetchDeposits(id, t, code, "all", r)
      } catch { setLoading(false) }
    } else { setLoading(false) }
  }, [fetchDeposits])

  useEffect(() => {
    const isAdmin = role === "admin" || role === "superadmin"
    if (token && (userId || refCode || isAdmin)) {
      if (period !== "custom") fetchDeposits(userId, token, refCode, period, role)
    }
  }, [period, token, userId, refCode, role, fetchDeposits])

  // Filter + sort
  useEffect(() => {
    let list = [...flatDeposits]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        d.username?.toLowerCase().includes(q) ||
        d.method?.toLowerCase().includes(q) ||
        d.partnerName?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") list = list.filter(d => d.status === statusFilter)
    list.sort((a, b) => {
      if (sortKey === "amount") return sortDir === "asc" ? a.amount - b.amount : b.amount - a.amount
      const av = a.createdAt ?? ""; const bv = b.createdAt ?? ""
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    setFiltered(list)
    setPage(1)
  }, [search, statusFilter, flatDeposits, sortKey, sortDir])

  function toggleSort(key: "amount" | "createdAt") {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("desc") }
  }

  const isAdminView = role === "admin" || role === "superadmin"
  const safeFiltered = Array.isArray(filtered) ? filtered : []
  const totalPages   = Math.max(1, Math.ceil(safeFiltered.length / PAGE_SIZE))
  const paginated    = safeFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const approvedDeposits = safeFiltered.filter(d => d.status === "approved" || !d.status)
  const totalApproved    = approvedDeposits.reduce((s, d) => s + (d.amount || 0), 0)
  const pendingAmount    = safeFiltered.filter(d => d.status === "pending").reduce((s, d) => s + (d.amount || 0), 0)
  const totalWithdrawals = withdrawals.filter(w => w.status === "approved" || !w.status).reduce((s, w) => s + (w.amount || 0), 0)
  const commissionBase   = commissionType === "net" ? Math.max(0, totalApproved - totalWithdrawals) : totalApproved
  const commissionEarned = commissionBase * (commissionRate / 100)

  // Partner-grouped view for admin/superadmin
  const partnerGroups = useMemo(() => {
    if (!isAdminView) return {}
    const groups: Record<string, { deposits: DepositRecord[]; total: number; count: number }> = {}
    for (const d of safeFiltered) {
      const key = d.partnerName || "—"
      if (!groups[key]) groups[key] = { deposits: [], total: 0, count: 0 }
      groups[key].deposits.push(d)
      if (d.status === "approved" || !d.status) groups[key].total += d.amount || 0
      groups[key].count++
    }
    return groups
  }, [safeFiltered, isAdminView])

  const sortedPartners = useMemo(() =>
    Object.entries(partnerGroups).sort((a, b) => b[1].total - a[1].total),
    [partnerGroups]
  )

  function togglePartner(name: string) {
    setExpandedPartners(prev => ({ ...prev, [name]: !prev[name] }))
  }

  async function openUserDrawer(username: string, memberId?: string, partnerId?: number, partnerName?: string) {
    setDrawerUsername(username)
    setDrawerMemberId(memberId || "")
    setDrawerPartnerId(partnerId ?? null)
    setDrawerPartnerName(partnerName || "")
    setDrawerOpen(true)
    setDrawerData(null)
    setDrawerLoading(false)
    setPromoResult(null)
    setDrawerLoading(true)
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const res = await fetch(`/api/affiliate/user-transactions?username=${encodeURIComponent(username)}`, {
        headers: { "x-auth-token": t },
      })
      const json = await res.json()
      if (json.success) {
        setDrawerData(json)
        if (json.user?.userId) setDrawerMemberId(json.user.userId)
      }
    } catch (e) {
      console.error("[drawer] fetch error:", e)
    } finally {
      setDrawerLoading(false)
    }
  }

  async function applyPromotion() {
    if (!drawerData || !drawerMemberId) return
    setPromoLoading(true)
    setPromoResult(null)
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const res = await fetch("/api/affiliate/promotion", {
        method: "POST",
        headers: { "x-auth-token": t, "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId:      drawerMemberId,
          memberUsername: drawerUsername,
          partnerId:     drawerPartnerId,
          partnerName:   drawerPartnerName,
          refDate:       promoDate,
          totalDeposit:  drawerData.summary.totalDeposit,
          totalWithdraw: drawerData.summary.totalWithdrawal,
          note:          promoNote || null,
        }),
      })
      const json = await res.json()
      setPromoResult({ success: json.success, message: json.message })
    } catch {
      setPromoResult({ success: false, message: "Bağlantı hatası." })
    } finally {
      setPromoLoading(false)
    }
  }

  function handleCustomApply() {
    fetchDeposits(userId, token, refCode, "custom", role, customStart, customEnd)
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-foreground">Depositler</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdminView ? "Tüm partnerlerin referral üyelerinin deposit işlemleri" : "Referral üyelerin deposit işlemleri ve komisyon hesabı"}
          </p>
        </div>
        <button
          onClick={() => fetchDeposits(userId, token, refCode, period, role, customStart, customEnd)}
          disabled={loading || (!userId && !refCode && !isAdminView)}
          className="flex items-center gap-2 px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* Period filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium mr-1">Periyot:</span>
        {(["daily", "weekly", "monthly", "all", "custom"] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              period === p
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-3 bg-secondary/50 border border-border rounded-xl p-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium whitespace-nowrap">Başlangıç:</label>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium whitespace-nowrap">Bitiş:</label>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            onClick={handleCustomApply}
            disabled={!customStart || loading}
            className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            Uygula
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground font-medium mb-1">Onaylanan Deposit</p>
          <p className="text-xl font-bold text-success">₺{totalApproved.toLocaleString("tr-TR")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{PERIOD_LABELS[period]}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground font-medium mb-1">Bekleyen Deposit</p>
          <p className="text-xl font-bold text-warning">₺{pendingAmount.toLocaleString("tr-TR")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{PERIOD_LABELS[period]}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground font-medium mb-1">
            Komisyon ({commissionRate}% — {commissionType === "net" ? "Net" : "Deposit"})
          </p>
          <p className="text-xl font-bold text-primary">₺{commissionEarned.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground font-medium mb-1">İşlem Sayısı</p>
          <p className="text-xl font-bold text-foreground">{safeFiltered.length.toLocaleString("tr-TR")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{PERIOD_LABELS[period]}</p>
        </div>
      </div>

      {/* Search + status filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder={isAdminView ? "Kullanıcı adı, partner veya yöntem ara..." : "Kullanıcı adı veya ödeme yöntemi ara..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "approved", "pending", "rejected"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {s === "all" ? "Tümü" : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : safeFiltered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-20 gap-2">
          <svg className="w-10 h-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
          <p className="text-sm text-muted-foreground">
            {search || statusFilter !== "all" ? "Sonuç bulunamadı" : "Henüz deposit işlemi yok"}
          </p>
        </div>
      ) : isAdminView ? (
        /* ── ADMIN VIEW: Partner bazlı gruplu liste ── */
        <div className="flex flex-col gap-4">
          {sortedPartners.map(([partnerName, group]) => {
            const isExpanded = expandedPartners[partnerName] !== false // default expanded
            const partnerApproved = group.deposits.filter(d => d.status === "approved" || !d.status).reduce((s, d) => s + d.amount, 0)
            return (
              <div key={partnerName} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Partner header */}
                <button
                  onClick={() => togglePartner(partnerName)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-primary uppercase">{partnerName[0] || "?"}</span>
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-foreground text-sm">{partnerName}</p>
                      <p className="text-xs text-muted-foreground">{group.count} işlem · {group.deposits.length} üye</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-bold text-success">₺{partnerApproved.toLocaleString("tr-TR")}</p>
                      <p className="text-xs text-muted-foreground">onaylanan</p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </div>
                </button>

                {/* Partner deposits table */}
                {isExpanded && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-secondary/30">
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                          <th
                            className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                            onClick={() => toggleSort("amount")}
                          >
                            <span className="flex items-center gap-1">Tutar <SortIcon active={sortKey === "amount"} dir={sortDir}/></span>
                          </th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Yöntem</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum</th>
                          <th
                            className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none hidden md:table-cell"
                            onClick={() => toggleSort("createdAt")}
                          >
                            <span className="flex items-center gap-1">Tarih <SortIcon active={sortKey === "createdAt"} dir={sortDir}/></span>
                          </th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.deposits.map((d, i) => {
                          const statusInfo = STATUS_CONFIG[d.status || ""] || { label: d.status || "—", className: "bg-secondary text-muted-foreground" }
                          return (
                            <tr key={d._id || d.id || i} className="border-t border-border/50 hover:bg-secondary/20 transition-colors">
                              <td className="px-4 py-3 text-muted-foreground text-xs">{i + 1}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs font-bold text-primary uppercase">{d.username?.[0] || "?"}</span>
                                  </div>
                                  <div>
                                    <p className="font-medium text-foreground text-xs">{d.username || "—"}</p>
                                    {d.title && <p className="text-xs text-muted-foreground">{d.title}</p>}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`font-semibold text-sm ${d.status === "approved" ? "text-success" : d.status === "rejected" ? "text-destructive" : "text-warning"}`}>
                                  ₺{d.amount.toLocaleString("tr-TR")}
                                </span>
                              </td>
                              <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">
                                {d.method ? d.method.replace(/-/g, " ") : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                                  {statusInfo.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                                {d.createdAt ? new Date(d.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => d.username && openUserDrawer(
                                    d.username,
                                    String(d._id || d.id || ""),
                                    isAdminView ? undefined : (userId ? Number(userId) : undefined),
                                    partnerName
                                  )}
                                  className="px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors whitespace-nowrap"
                                >
                                  Detay
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-secondary/40 border-t border-border">
                          <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Toplam</td>
                          <td className="px-4 py-2.5 text-sm font-bold text-success">
                            ₺{partnerApproved.toLocaleString("tr-TR")}
                          </td>
                          <td colSpan={3} className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                            {group.deposits.filter(d => d.status === "approved" || !d.status).length} onaylı işlem
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ── PARTNER VIEW: Düz liste ── */
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("amount")}
                  >
                    <span className="flex items-center gap-1.5">Tutar <SortIcon active={sortKey === "amount"} dir={sortDir}/></span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Yöntem</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum</th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none hidden md:table-cell"
                    onClick={() => toggleSort("createdAt")}
                  >
                    <span className="flex items-center gap-1.5">Tarih <SortIcon active={sortKey === "createdAt"} dir={sortDir}/></span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Komisyon</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((d, i) => {
                  const rowNum = (page - 1) * PAGE_SIZE + i + 1
                  const statusInfo = STATUS_CONFIG[d.status || ""] || { label: d.status || "—", className: "bg-secondary text-muted-foreground" }
                  const rowCommission = d.status === "approved" ? d.amount * (commissionRate / 100) : 0
                  return (
                    <tr key={d._id || d.id || i} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground text-xs">{rowNum}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-primary uppercase">{d.username?.[0] || "?"}</span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{d.username || "—"}</p>
                            {d.title && <p className="text-xs text-muted-foreground">{d.title}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${d.status === "approved" ? "text-success" : d.status === "rejected" ? "text-destructive" : "text-warning"}`}>
                          ₺{d.amount.toLocaleString("tr-TR")}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-muted-foreground text-xs capitalize">
                          {d.method ? d.method.replace(/-/g, " ") : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                        {d.createdAt ? new Date(d.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {rowCommission > 0 ? (
                          <span className="text-xs font-semibold text-primary">₺{rowCommission.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── USER DETAIL DRAWER ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <div className="relative ml-auto w-full max-w-xl h-full bg-card border-l border-border flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="font-bold text-foreground text-base">{drawerUsername} — İşlem Detayları</h3>
                {drawerData && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {drawerData.user.name && <span>{drawerData.user.name} · </span>}
                    Ref: <span className="font-medium">{drawerData.user.redeemedCode || "—"}</span>
                  </p>
                )}
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
              >
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
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-border flex-shrink-0">
                  <div className="bg-secondary/50 rounded-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Mevcut Bakiye</p>
                    <p className="text-sm font-bold text-foreground">₺{Number(drawerData.user.currentBalance).toLocaleString("tr-TR")}</p>
                  </div>
                  <div className="bg-success/10 rounded-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Toplam Yatırım</p>
                    <p className="text-sm font-bold text-success">₺{drawerData.summary.totalDeposit.toLocaleString("tr-TR")}</p>
                  </div>
                  <div className="bg-destructive/10 rounded-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Toplam Çekim</p>
                    <p className="text-sm font-bold text-destructive">₺{drawerData.summary.totalWithdrawal.toLocaleString("tr-TR")}</p>
                  </div>
                </div>

                {/* ── Promosyon Hesabı ── */}
                {(role === "partner" || role === "admin" || role === "superadmin") && (
                  <div className="px-6 py-4 border-b border-border flex-shrink-0 bg-secondary/20">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Promosyon Tanımla (%40)</p>
                    {(() => {
                      const dep = drawerData.summary.totalDeposit
                      const wit = drawerData.summary.totalWithdrawal
                      const net = dep - wit
                      const promo = net > 0 ? parseFloat(((net * 40) / 100).toFixed(2)) : 0
                      return (
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="bg-card rounded-lg p-2.5 border border-border">
                              <p className="text-muted-foreground mb-0.5">Yatırım</p>
                              <p className="font-bold text-success">₺{dep.toLocaleString("tr-TR")}</p>
                            </div>
                            <div className="bg-card rounded-lg p-2.5 border border-border">
                              <p className="text-muted-foreground mb-0.5">Çekim</p>
                              <p className="font-bold text-destructive">₺{wit.toLocaleString("tr-TR")}</p>
                            </div>
                            <div className="bg-card rounded-lg p-2.5 border border-border">
                              <p className="text-muted-foreground mb-0.5">Net Tutar</p>
                              <p className={`font-bold ${net > 0 ? "text-foreground" : "text-destructive"}`}>₺{net.toLocaleString("tr-TR")}</p>
                            </div>
                          </div>
                          {promo > 0 && (
                            <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex items-center justify-between">
                              <div>
                                <p className="text-xs text-muted-foreground">%40 Promosyon Tutarı</p>
                                <p className="text-lg font-bold text-primary">₺{promo.toLocaleString("tr-TR")}</p>
                              </div>
                              <svg className="w-8 h-8 text-primary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                              </svg>
                            </div>
                          )}
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-xs text-muted-foreground mb-1 block">Tarih</label>
                                <input
                                  type="date"
                                  value={promoDate}
                                  onChange={e => setPromoDate(e.target.value)}
                                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary transition-colors"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-xs text-muted-foreground mb-1 block">Not (opsiyonel)</label>
                                <input
                                  type="text"
                                  value={promoNote}
                                  onChange={e => setPromoNote(e.target.value)}
                                  placeholder="Açıklama..."
                                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                                />
                              </div>
                            </div>
                            {promoResult && (
                              <div className={`text-xs rounded-lg px-3 py-2 ${promoResult.success ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                                {promoResult.message}
                              </div>
                            )}
                            <button
                              onClick={applyPromotion}
                              disabled={promo <= 0 || promoLoading || !promoDate || !drawerMemberId}
                              className="w-full py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {promoLoading ? (
                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                              ) : null}
                              {promo <= 0 ? "Net tutar yetersiz" : `₺${promo.toLocaleString("tr-TR")} Promosyon Tanımla`}
                            </button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Transactions list */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Tüm İşlemler ({drawerData.summary.txCount})
                  </p>
                  {drawerData.transactions.length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">Henüz işlem yok</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {drawerData.transactions.map((tx, i) => {
                        const isDeposit = tx.type === "deposit"
                        const isApproved = tx.status === "approved"
                        const isPending  = tx.status === "pending"
                        return (
                          <div key={tx._id || i} className="bg-secondary/40 border border-border rounded-xl p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                {/* Type icon */}
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                                  isDeposit ? "bg-success/15" : "bg-destructive/15"
                                }`}>
                                  {isDeposit ? (
                                    <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7"/>
                                    </svg>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-foreground truncate">
                                    {tx.providerName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {tx.createdAt ? new Date(tx.createdAt).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                                  </p>
                                  {tx.note && <p className="text-xs text-muted-foreground mt-0.5 italic">"{tx.note}"</p>}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className={`text-sm font-bold ${isDeposit ? "text-success" : "text-destructive"}`}>
                                  {isDeposit ? "+" : "-"}₺{Number(tx.amount).toLocaleString("tr-TR")}
                                </p>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
                                  isApproved ? "bg-success/10 text-success" :
                                  isPending  ? "bg-warning/10 text-warning" :
                                  "bg-destructive/10 text-destructive"
                                }`}>
                                  {isApproved ? "Onaylandı" : isPending ? "Bekliyor" : "Reddedildi"}
                                </span>
                              </div>
                            </div>
                            {/* Balance change */}
                            {(tx.oldBalance !== undefined && tx.newBalance !== undefined) && (
                              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                                <span>Önceki bakiye: <span className="font-medium text-foreground">₺{Number(tx.oldBalance).toLocaleString("tr-TR")}</span></span>
                                <svg className="w-3.5 h-3.5 mx-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                                <span>Yeni bakiye: <span className="font-medium text-foreground">₺{Number(tx.newBalance).toLocaleString("tr-TR")}</span></span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Veri yüklenemedi</div>
            )}
          </div>
        </div>
      )}

      {/* Pagination (partner view only) */}
      {!isAdminView && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, safeFiltered.length)} / {safeFiltered.length} işlem
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs bg-secondary border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors text-foreground"
            >
              Önceki
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const startPage = Math.max(1, Math.min(page - 2, totalPages - 4))
              const p = startPage + i
              if (p > totalPages) return null
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs rounded-lg border transition-colors ${
                    p === page ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs bg-secondary border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors text-foreground"
            >
              Sonraki
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
