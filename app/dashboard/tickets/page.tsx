"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"

interface TicketRow {
  ticketNo: number
  mongo_user_id: string
  username: string
  tx_id: string
  deposit_amount: string   // per-ticket threshold amount
  total_deposit: string    // original full deposit
  ticket_count: number
  created_at: string
}

interface ParticipantRow {
  mongo_user_id: string
  username: string
  total_tickets: string
  total_deposit: string
  last_at: string
}

interface Stats {
  totalTickets: number
  participants: number
  totalDeposit: number
}

interface PartnerOption {
  id: number
  username: string
  name: string | null
  ticket_enabled: boolean
  ticket_threshold: number
}

type Tab = "tickets" | "participants"

export default function TicketsPage() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [role, setRole] = useState("")
  const [partnerId, setPartnerId] = useState<number | null>(null)
  const [partnerUsername, setPartnerUsername] = useState("")
  const [ticketEnabled, setTicketEnabled] = useState(false)
  const [threshold, setThreshold] = useState(1000)
  const [ticketGoal, setTicketGoal] = useState(10000)

  // Admin: partner selector
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [selectedPartner, setSelectedPartner] = useState<number | "">("")
  const [loadingPartners, setLoadingPartners] = useState(false)

  const [tab, setTab] = useState<Tab>("tickets")
  const [stats, setStats] = useState<Stats>({ totalTickets: 0, participants: 0, totalDeposit: 0 })
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [participants, setParticipants] = useState<ParticipantRow[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")

  // Manuel bilet ekleme modal
  const [manualOpen, setManualOpen] = useState(false)
  const [manualForm, setManualForm] = useState({ mongoUserId: "", username: "", ticketCount: 1, note: "" })
  const [manualLoading, setManualLoading] = useState(false)
  const [manualMsg, setManualMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Üye arama
  const [userSearch, setUserSearch] = useState("")
  const [userResults, setUserResults] = useState<{ _id: string; username: string }[]>([])
  const [userSearching, setUserSearching] = useState(false)
  const userSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchingRef = useRef(false)

  // Fetch partner list for admins
  const fetchPartnerList = useCallback(async (t: string) => {
    setLoadingPartners(true)
    try {
      const res = await fetch("/api/affiliate/partners", { headers: { "x-auth-token": t } })
      const data = await res.json()
      if (data.success) {
        const mapped = (data.partners as any[]).map((p: any) => ({
          id: parseInt(p.neonId ?? p.id ?? "0"),
          username: p.username,
          name: p.name ?? null,
          ticket_enabled: Boolean(p.ticketEnabled),
          ticket_threshold: p.ticketThreshold ?? 1000,
        }))
        setPartners(mapped)
        // Otomatik olarak ilk bilet-aktif partneri seç
        const firstActive = mapped.find((p) => p.ticket_enabled)
        if (firstActive) setSelectedPartner(firstActive.id)
      }
    } catch {}
    setLoadingPartners(false)
  }, [])

  // Fetch tickets
  const fetchTickets = useCallback(async (t: string, pid: number, currentTab: Tab, currentPage: number) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    try {
      const res = await fetch(
        `/api/affiliate/tickets?partnerId=${pid}&tab=${currentTab}&page=${currentPage}`,
        { headers: { "x-auth-token": t } }
      )
      const data = await res.json()
      if (!data.success) return
      if (!data.enabled) { setTicketEnabled(false); return }
      setTicketEnabled(true)
      setThreshold(data.threshold ?? 1000)
      setTicketGoal(data.ticketGoal ?? 10000)
      setStats(data.stats)
      setPartnerUsername(data.partnerUsername ?? "")
      if (currentTab === "tickets") setTickets(data.tickets ?? [])
      else setParticipants(data.tickets ?? [])
    } catch {}
    setLoading(false)
    fetchingRef.current = false
  }, [])

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const u = localStorage.getItem("affiliate_user")
    setToken(t)
    if (!t || !u) { router.push("/"); return }
    try {
      const parsed = JSON.parse(u)
      // Role from JWT
      let r = parsed.role || ""
      if (t) {
        try { const p = JSON.parse(atob(t.split(".")[1])); if (p.role) r = p.role } catch {}
      }
      setRole(r)
      const isAdmin = r === "superadmin" || r === "admin"
      if (isAdmin) {
        fetchPartnerList(t)
      } else {
        // partner/affiliate_user — use own id
        const pid = parseInt(parsed.affiliateId ?? parsed.id ?? "0")
        if (pid) { setPartnerId(pid); fetchTickets(t, pid, "tickets", 1) }
      }
    } catch { router.push("/") }
  }, [router, fetchPartnerList, fetchTickets])

  // When admin selects a partner
  useEffect(() => {
    if (!selectedPartner || !token) return
    const pid = Number(selectedPartner)
    setPartnerId(pid)
    setPage(1)
    setTab("tickets")
    fetchTickets(token, pid, "tickets", 1)
  }, [selectedPartner, token, fetchTickets])

  // When tab or page changes
  useEffect(() => {
    if (!partnerId || !token) return
    fetchTickets(token, partnerId, tab, page)
  }, [tab, page]) // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = role === "superadmin" || role === "admin"
  const isSuperAdmin = role === "superadmin"

  // Üye arama (debounced)
  function handleUserSearch(val: string) {
    setUserSearch(val)
    setManualForm((p) => ({ ...p, username: val, mongoUserId: "" }))
    setUserResults([])
    if (userSearchRef.current) clearTimeout(userSearchRef.current)
    if (val.length < 2) return
    userSearchRef.current = setTimeout(async () => {
      setUserSearching(true)
      try {
        const res = await fetch(`/api/affiliate/referrals/search-user?q=${encodeURIComponent(val)}&partnerId=${partnerId}`, {
          headers: { "x-auth-token": token },
        })
        const data = await res.json()
        if (data.success) setUserResults(data.users ?? [])
      } catch {}
      setUserSearching(false)
    }, 350)
  }

  function selectUser(u: { _id: string; username: string }) {
    setManualForm((p) => ({ ...p, mongoUserId: u._id, username: u.username }))
    setUserSearch(u.username)
    setUserResults([])
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!partnerId) return
    setManualLoading(true)
    setManualMsg(null)
    try {
      const res = await fetch("/api/affiliate/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({ partnerId, ...manualForm }),
      })
      const data = await res.json()
      if (data.success) {
        setManualMsg({ ok: true, text: data.message })
        setManualForm({ mongoUserId: "", username: "", ticketCount: 1, note: "" })
        setUserSearch("")
        // Listeyi yenile
        setTimeout(() => fetchTickets(token, partnerId, tab, page), 500)
      } else {
        setManualMsg({ ok: false, text: data.message || "İşlem gerçekleştirilemedi." })
      }
    } catch {
      setManualMsg({ ok: false, text: "İşlem gerçekleştirilemedi." })
    } finally {
      setManualLoading(false)
    }
  }

  const filteredTickets = tickets.filter(
    (t) => !search || t.username.toLowerCase().includes(search.toLowerCase()) || t.tx_id.includes(search)
  )
  const filteredParticipants = participants.filter(
    (p) => !search || p.username.toLowerCase().includes(search.toLowerCase())
  )

  function fmt(dateStr: string) {
    try { return new Date(dateStr).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) }
    catch { return dateStr }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground">Biletler</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Yatırım bazlı bilet takip sistemi
          </p>
        </div>
        <div className="flex items-center gap-2">
          {partnerId && isSuperAdmin && ticketEnabled && (
            <button
              onClick={() => { setManualOpen(true); setManualMsg(null) }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              Manuel Bilet Ekle
            </button>
          )}
          {partnerId && (
            <button
              onClick={() => { setPage(1); fetchTickets(token, partnerId, tab, 1) }}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Yenile
            </button>
          )}
        </div>
      </div>

      {/* Admin: partner selector */}
      {isAdmin && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Partner Seç</label>
            {partners.length > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="text-primary font-semibold">{partners.filter(p => p.ticket_enabled).length}</span>/{partners.length} bilet aktif
              </span>
            )}
          </div>
          {loadingPartners ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Yükleniyor...
            </div>
          ) : partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz partner bulunmuyor.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPartner(p.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    selectedPartner === p.id
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : "border-border bg-secondary hover:border-primary/40 hover:bg-secondary/80"
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.ticket_enabled ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  <span className="text-sm font-medium text-foreground truncate">
                    {p.name || p.username}
                  </span>
                  {p.ticket_enabled && (
                    <svg className="w-3.5 h-3.5 text-primary flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No partner selected */}
      {!partnerId && !loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 bg-card border border-border rounded-xl">
          <svg className="w-12 h-12 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
          </svg>
          <p className="text-sm text-muted-foreground">{isAdmin ? "Biletleri görmek için bir partner seçin" : "Bilet sistemi yükleniyor..."}</p>
        </div>
      )}

      {/* Ticket system disabled */}
      {partnerId && !loading && !ticketEnabled && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-card border border-border rounded-xl">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <svg className="w-7 h-7 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {partnerUsername ? `@${partnerUsername} ` : ""}için bilet sistemi aktif değil
            </p>
            {isSuperAdmin && (
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Partner Yönetimi sayfasına gidip partnerin satırındaki <span className="font-semibold text-foreground">Bilet</span> butonuna tıklayarak aktif edebilirsiniz.
              </p>
            )}
          </div>
          {isSuperAdmin && (
            <button
              onClick={() => router.push("/dashboard/partners")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
              </svg>
              Partner Yönetimine Git
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      {partnerId && ticketEnabled && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Toplam Bilet — with goal + progress */}
            <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Toplam Bilet</p>
                  <div className="flex items-baseline gap-1.5">
                    <p className="text-2xl font-bold text-primary">{stats.totalTickets.toLocaleString("tr-TR")}</p>
                    <span className="text-sm text-muted-foreground">/ {ticketGoal.toLocaleString("tr-TR")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Her ₺{threshold.toLocaleString("tr-TR")} = 1 bilet</p>
                </div>
              </div>
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (stats.totalTickets / ticketGoal) * 100).toFixed(1)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>%{Math.min(100, (stats.totalTickets / ticketGoal) * 100).toFixed(1)} dolu</span>
                  <span>{Math.max(0, ticketGoal - stats.totalTickets).toLocaleString("tr-TR")} kalan</span>
                </div>
              </div>
            </div>

            {/* Katilimci */}
            <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Katilimci</p>
                <p className="text-2xl font-bold text-blue-500 mt-0.5">{stats.participants.toLocaleString("tr-TR")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Benzersiz kullanici</p>
              </div>
            </div>

            {/* Toplam Deposit */}
            <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Toplam Deposit</p>
                <p className="text-2xl font-bold text-green-500 mt-0.5">₺{Number(stats.totalDeposit).toLocaleString("tr-TR")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Bilet kazandiran yatirimlar</p>
              </div>
            </div>
          </div>

          {/* Search + Tabs */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kullanici adi veya TX ID ile ara..."
                className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              />
            </div>

            <div className="flex gap-1 border-b border-border">
              {(["tickets", "participants"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setPage(1) }}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    tab === t
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "tickets"
                    ? `Biletler (${stats.totalTickets.toLocaleString("tr-TR")})`
                    : `Katilimcilar (${stats.participants.toLocaleString("tr-TR")})`}
                </button>
              ))}
            </div>
          </div>

          {/* Loading spinner */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
          )}

          {/* Tickets tab */}
          {!loading && tab === "tickets" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bilet No</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanici</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Deposit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tarih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTickets.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                          Bilet bulunamadi
                        </td>
                      </tr>
                    ) : filteredTickets.map((row, idx) => (
                      <tr key={`${row.ticketNo}-${idx}`} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-primary">
                          #{String(row.ticketNo).padStart(8, "0")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary uppercase">{row.username[0]}</span>
                            </div>
                            <span className="text-sm font-medium text-foreground">{row.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-green-600">
                            ₺{Number(row.deposit_amount).toLocaleString("tr-TR")}
                          </span>
                          {row.ticket_count > 1 && (
                            <span className="block text-xs text-muted-foreground">
                              toplam ₺{Number(row.total_deposit).toLocaleString("tr-TR")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground font-mono">
                          {fmt(row.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <button
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                  Onceki
                </button>
                <span className="text-xs text-muted-foreground">Sayfa {page}</span>
                <button
                  disabled={filteredTickets.length < 50 || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors font-medium"
                >
                  Sonraki
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Participants tab */}
          {!loading && tab === "participants" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanici</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Toplam Bilet</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Toplam Deposit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Son Islem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredParticipants.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                          Katilimci bulunamadi
                        </td>
                      </tr>
                    ) : filteredParticipants.map((row, i) => (
                      <tr key={row.mongo_user_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{(page - 1) * 50 + i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary uppercase">{row.username[0]}</span>
                            </div>
                            <span className="text-sm font-medium text-foreground">{row.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                            {Number(row.total_tickets).toLocaleString("tr-TR")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-green-600">
                          ₺{Number(row.total_deposit).toLocaleString("tr-TR")}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground font-mono">
                          {fmt(row.last_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <button
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                  Onceki
                </button>
                <span className="text-xs text-muted-foreground">Sayfa {page}</span>
                <button
                  disabled={filteredParticipants.length < 50 || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors font-medium"
                >
                  Sonraki
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {/* Manuel Bilet Ekleme Modal */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setManualOpen(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-foreground">Manuel Bilet Ekle</h3>
                {partnerUsername && (
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">@{partnerUsername}</p>
                )}
              </div>
              <button onClick={() => setManualOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              {/* Kullanici arama */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Kullanici
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Kullanici adi ile ara..."
                    value={userSearch}
                    onChange={(e) => handleUserSearch(e.target.value)}
                    autoComplete="off"
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                  {userSearching && (
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  )}
                </div>
                {/* Autocomplete dropdown */}
                {userResults.length > 0 && (
                  <div className="border border-border rounded-lg bg-card shadow-lg overflow-hidden">
                    {userResults.map((u) => (
                      <button
                        key={u._id}
                        type="button"
                        onClick={() => selectUser(u)}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-secondary transition-colors flex items-center gap-2 border-b border-border last:border-b-0"
                      >
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary uppercase">{u.username[0]}</span>
                        </div>
                        <span className="font-medium text-foreground">{u.username}</span>
                        <span className="ml-auto text-xs text-muted-foreground font-mono truncate max-w-[100px]">{u._id}</span>
                      </button>
                    ))}
                  </div>
                )}
                {manualForm.mongoUserId && (
                  <p className="text-xs text-green-600 font-medium">
                    Secildi: {manualForm.username}
                  </p>
                )}
              </div>

              {/* Bilet adedi */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Bilet Adedi
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={manualForm.ticketCount}
                  onChange={(e) => setManualForm((p) => ({ ...p, ticketCount: Math.max(1, parseInt(e.target.value) || 1) }))}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {/* Not */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Not (opsiyonel)
                </label>
                <input
                  type="text"
                  placeholder="Ekleme sebebi..."
                  value={manualForm.note}
                  onChange={(e) => setManualForm((p) => ({ ...p, note: e.target.value }))}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {manualMsg && (
                <p className={`text-sm px-3 py-2 rounded-lg border ${manualMsg.ok ? "text-green-600 bg-green-500/10 border-green-500/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
                  {manualMsg.text}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={manualLoading || !manualForm.mongoUserId}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {manualLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                      </svg>
                      Bilet Ekle
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Iptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
