"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"

async function impersonatePartner(token: string, username: string): Promise<{ token: string; user: unknown } | null> {
  const res = await fetch("/api/affiliate/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-token": token },
    body: JSON.stringify({ username }),
  })
  const data = await res.json()
  if (!data.success) return null
  return { token: data.token, user: data.user }
}

interface PartnerStats {
  username: string
  name?: string
  refCode?: string
  shortLink?: string
  affiliateId?: string
  neonId?: number
  commissionRate?: number
  commissionType?: string
  role?: string
  totalReferrals: number
  totalDeposits: number
  totalWithdrawals: number
  totalEarnings: number
}

export default function PartnersPage() {
  const router = useRouter()
  const [partners, setPartners] = useState<PartnerStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [token, setToken] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<PartnerStats | null>(null)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const [editing, setEditing] = useState<PartnerStats | null>(null)
  const [editForm, setEditForm] = useState({ name: "", refCode: "", shortLink: "", commissionRate: 10, commissionType: "deposit", newPassword: "" })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState("")
  const [editSuccess, setEditSuccess] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Period filter
  type Period = "today" | "week" | "month" | "all" | "custom"
  const [period, setPeriod] = useState<Period>("month")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<PartnerStats | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  // Ticket settings modal
  const [ticketPartner, setTicketPartner] = useState<PartnerStats | null>(null)
  const [ticketForm, setTicketForm] = useState({ enabled: false, threshold: 1000, goal: 10000, startDate: "" })
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketMsg, setTicketMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function handleCopy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  function openEdit(partner: PartnerStats) {
    setEditing(partner)
    setEditForm({
      name: partner.name || "",
      refCode: partner.refCode || "",
      shortLink: partner.shortLink || "",
      commissionRate: partner.commissionRate ?? 10,
      commissionType: partner.commissionType || "deposit",
      newPassword: "",
    })
    setEditError("")
    setEditSuccess(false)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setEditLoading(true)
    setEditError("")
    setEditSuccess(false)
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const res = await fetch("/api/affiliate/edit-partner", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": t },
        body: JSON.stringify({ username: editing.username, ...editForm }),
      })
      const data = await res.json()
      if (!data.success) {
        setEditError("İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.")
      } else {
        setEditSuccess(true)
        // Update in local list
        setPartners((prev) => prev.map((p) =>
          p.username === editing.username
            ? { ...p, name: editForm.name, refCode: editForm.refCode, shortLink: editForm.shortLink, commissionRate: editForm.commissionRate, commissionType: editForm.commissionType }
            : p
        ))
        setTimeout(() => setEditing(null), 1200)
      }
    } catch {
      setEditError("Sunucu hatası.")
    } finally {
      setEditLoading(false)
    }
  }

  async function openTicketSettings(partner: PartnerStats) {
    setTicketMsg(null)
    setTicketLoading(true)
    setTicketPartner(partner)
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const res = await fetch(`/api/affiliate/tickets/settings?partnerId=${partner.neonId}`, {
        headers: { "x-auth-token": t },
      })
      const data = await res.json()
      if (data.success) {
        const raw = data.settings.ticket_start_date
        const startDate = raw ? new Date(raw).toISOString().slice(0, 10) : ""
        setTicketForm({
          enabled: data.settings.ticket_enabled ?? false,
          threshold: data.settings.ticket_threshold ?? 1000,
          goal: data.settings.ticket_goal ?? 10000,
          startDate,
        })
      }
    } catch {}
    setTicketLoading(false)
  }

  async function handleTicketSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ticketPartner) return
    setTicketLoading(true)
    setTicketMsg(null)
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const res = await fetch("/api/affiliate/tickets/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": t },
        body: JSON.stringify({
          partnerId: ticketPartner.neonId,
          enabled: ticketForm.enabled,
          threshold: ticketForm.threshold,
          goal: ticketForm.goal,
          startDate: ticketForm.startDate || null,
        }),
      })
      const data = await res.json()
      setTicketMsg({ ok: data.success, text: data.success ? data.message : "İşlem gerçekleştirilemedi." })
    } catch {
      setTicketMsg({ ok: false, text: "İşlem gerçekleştirilemedi." })
    } finally {
      setTicketLoading(false)
    }
  }

  const handleImpersonate = useCallback(async (partner: PartnerStats) => {
    const t = localStorage.getItem("affiliate_token") || ""
    if (!t) return
    setImpersonating(partner.username)
    try {
      const result = await impersonatePartner(t, partner.username)
      if (!result) { alert("Giriş yapılamadı."); return }
      // Save admin session to restore later
      const adminToken = localStorage.getItem("affiliate_token")
      const adminUser = localStorage.getItem("affiliate_user")
      if (adminToken) sessionStorage.setItem("admin_backup_token", adminToken)
      if (adminUser) sessionStorage.setItem("admin_backup_user", adminUser)
      // Switch to partner session
      localStorage.setItem("affiliate_token", result.token)
      localStorage.setItem("affiliate_user", JSON.stringify(result.user))
      router.push("/dashboard")
    } finally {
      setImpersonating(null)
    }
  }, [])

  const fetchPartners = useCallback(async (
    t: string,
    p: "today" | "week" | "month" | "all" | "custom" = "month",
    start = "",
    end = ""
  ) => {
    setLoading(true)
    setError("")
    try {
      let url = `/api/affiliate/partners?period=${p}`
      if (p === "custom" && start && end) url += `&start=${start}&end=${end}`
      const res = await fetch(url, { headers: { "x-auth-token": t } })
      const data = await res.json()
      if (!data.success) {
        setError("Veriler yüklenemedi. Lütfen tekrar deneyin.")
      } else {
        setPartners(data.partners || [])
      }
    } catch {
      setError("Sunucuya bağlanılamadı.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const userData = localStorage.getItem("affiliate_user")
    setToken(t)
    if (!t || !userData) { router.push("/"); return }
    try {
      const user = JSON.parse(userData)
      if (user.role !== "admin" && user.role !== "superadmin") { router.push("/dashboard"); return }
      setIsSuperAdmin(user.role === "superadmin")
      fetchPartners(t, "month")
    } catch { router.push("/") }
  }, [router, fetchPartners])

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    setDeleteError("")
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const res = await fetch(`/api/affiliate/delete-partner?username=${encodeURIComponent(deleteTarget.username)}`, {
        method: "DELETE",
        headers: { "x-auth-token": t },
      })
      const data = await res.json()
      if (!data.success) {
        setDeleteError(data.message || "İşlem gerçekleştirilemedi.")
      } else {
        setPartners((prev) => prev.filter((p) => p.username !== deleteTarget.username))
        setDeleteTarget(null)
      }
    } catch {
      setDeleteError("Sunucu hatası.")
    } finally {
      setDeleteLoading(false)
    }
  }

  function applyPeriod(p: "today" | "week" | "month" | "all" | "custom") {
    const t = localStorage.getItem("affiliate_token") || ""
    setPeriod(p)
    if (p !== "custom") fetchPartners(t, p)
  }

  function applyCustom() {
    if (!customStart || !customEnd) return
    const t = localStorage.getItem("affiliate_token") || ""
    fetchPartners(t, "custom", customStart, customEnd)
  }

  const filtered = partners.filter((p) =>
    p.username.toLowerCase().includes(search.toLowerCase()) ||
    (p.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.refCode || "").toLowerCase().includes(search.toLowerCase())
  )

  const totalReferrals = partners.reduce((s, p) => s + p.totalReferrals, 0)
  const totalDeposits = partners.reduce((s, p) => s + p.totalDeposits, 0)
  const totalWithdrawals = partners.reduce((s, p) => s + (p.totalWithdrawals ?? 0), 0)
  const totalEarnings = partners.reduce((s, p) => s + p.totalEarnings, 0)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground">Partner Yönetimi</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tüm affiliate partnerlerin istatistikleri ve yönetimi
          </p>
        </div>
        <button
          onClick={() => fetchPartners(token, period, customStart, customEnd)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* Period Filter */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(["today", "week", "month", "all", "custom"] as const).map((p) => {
            const labels: Record<string, string> = { today: "Bugün", week: "Bu Hafta", month: "Bu Ay", all: "Tüm Zamanlar", custom: "Ozel Tarih" }
            return (
              <button
                key={p}
                onClick={() => applyPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  period === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {labels[p]}
              </button>
            )
          })}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-muted-foreground text-sm">—</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={applyCustom}
              disabled={!customStart || !customEnd || loading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Uygula
            </button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Toplam Partner", value: partners.length, suffix: "kişi", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
          { label: "Toplam Referral", value: totalReferrals, suffix: "üye", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" },
          { label: "Deposit", value: `₺${totalDeposits.toLocaleString("tr-TR")}`, suffix: "", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "Cekim", value: `₺${totalWithdrawals.toLocaleString("tr-TR")}`, suffix: "", icon: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" },
          { label: "Komisyon", value: `₺${totalEarnings.toLocaleString("tr-TR")}`, suffix: "", icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
        ].map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon}/>
              </svg>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-xl font-bold text-foreground">{card.value} <span className="text-sm font-normal text-muted-foreground">{card.suffix}</span></p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Partner ara (isim, kullanıcı adı, ref kodu)..."
          className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2">
          <svg className="w-10 h-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>
          </svg>
          <p className="text-sm text-muted-foreground">Partner bulunamadı</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Partner</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ref Kodu</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referral</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Deposit</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Çekim</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Komisyon</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hak Ediş</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Oran</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((partner, i) => (
                  <tr key={partner.username} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary uppercase">{(partner.name || partner.username)[0]}</span>
                        </div>
                        <div>
                          <p className="font-medium text-foreground text-sm">{partner.name || partner.username}</p>
                          <p className="text-xs text-muted-foreground font-mono">@{partner.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-secondary border border-border px-2 py-1 rounded-md text-foreground">
                        {partner.refCode || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">{partner.totalReferrals}</td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">₺{partner.totalDeposits.toLocaleString("tr-TR")}</td>
                    <td className="px-4 py-3 text-right font-semibold text-destructive">₺{(partner.totalWithdrawals ?? 0).toLocaleString("tr-TR")}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-medium">
                        %{partner.commissionRate ?? 10}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">₺{partner.totalEarnings.toLocaleString("tr-TR")}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${Math.min(100, totalDeposits > 0 ? (partner.totalDeposits / totalDeposits) * 100 : 0)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {totalDeposits > 0 ? Math.round((partner.totalDeposits / totalDeposits) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setSelected(partner)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
                        >
                          Detay
                        </button>
                        <button
                          onClick={() => openEdit(partner)}
                          className="text-xs text-muted-foreground hover:text-primary transition-colors font-medium"
                        >
                          Düzenle
                        </button>
                        {isSuperAdmin && (
                          <button
                            onClick={() => openTicketSettings(partner)}
                            className="text-xs text-muted-foreground hover:text-amber-500 transition-colors font-medium"
                          >
                            Bilet
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button
                            onClick={() => { setDeleteTarget(partner); setDeleteError("") }}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors font-medium"
                          >
                            Sil
                          </button>
                        )}
                        <button
                          onClick={() => handleImpersonate(partner)}
                          disabled={impersonating === partner.username}
                          className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2.5 py-1.5 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {impersonating === partner.username ? (
                            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
                            </svg>
                          )}
                          Panele Gir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td colSpan={3} className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Toplam</td>
                  <td className="px-4 py-3 text-right font-bold text-foreground">{totalReferrals}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary">₺{totalDeposits.toLocaleString("tr-TR")}</td>
                  <td className="px-4 py-3 text-right font-bold text-destructive">₺{totalWithdrawals.toLocaleString("tr-TR")}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right font-bold text-foreground">₺{totalEarnings.toLocaleString("tr-TR")}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary uppercase">{(selected.name || selected.username)[0]}</span>
                </div>
                <div>
                  <p className="font-semibold text-foreground">{selected.name || selected.username}</p>
                  <p className="text-xs text-muted-foreground font-mono">@{selected.username}</p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            {/* Referans Linki */}
            <div className="mb-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referans Linki</p>
              <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2">
                <span className="flex-1 text-xs font-mono text-foreground truncate">
                  https://bizzocasino168.com/?register={selected.refCode}
                </span>
                <button
                  onClick={() => handleCopy(`https://bizzocasino168.com/?register=${selected.refCode}`, "reflink")}
                  className="flex-shrink-0 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md font-medium hover:bg-primary/90 transition-colors"
                >
                  {copied === "reflink" ? "Kopyalandı!" : "Kopyala"}
                </button>
              </div>
              {selected.shortLink && (
                <>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2">Kısa Link</p>
                  <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2">
                    <span className="flex-1 text-xs font-mono text-foreground truncate">{selected.shortLink}</span>
                    <button
                      onClick={() => handleCopy(selected.shortLink!, "shortlink")}
                      className="flex-shrink-0 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md font-medium hover:bg-primary/90 transition-colors"
                    >
                      {copied === "shortlink" ? "Kopyalandı!" : "Kopyala"}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Ref Kodu", value: selected.refCode || "—" },
                { label: "Komisyon", value: `%${selected.commissionRate ?? 10} (${selected.commissionType === "net" ? "Net" : "Deposit"})` },
                { label: "Toplam Referral", value: `${selected.totalReferrals} üye` },
                { label: "Toplam Deposit", value: `₺${selected.totalDeposits.toLocaleString("tr-TR")}` },
                { label: "Toplam Kazanç", value: `₺${selected.totalEarnings.toLocaleString("tr-TR")}` },
              ].map((item) => (
                <div key={item.label} className="bg-secondary border border-border rounded-lg px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5 font-mono truncate">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !deleteLoading && setDeleteTarget(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Partneri Sil</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Bu islem geri alinamaz</p>
              </div>
            </div>

            <div className="bg-destructive/5 border border-destructive/10 rounded-xl px-4 py-3 mb-5">
              <p className="text-sm text-foreground">
                <span className="font-semibold text-destructive">{deleteTarget.name || deleteTarget.username}</span> adli partner silinecek.
              </p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">@{deleteTarget.username} — Ref: {deleteTarget.refCode || "—"}</p>
            </div>

            {deleteError && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mb-4">{deleteError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 flex items-center justify-center gap-2 bg-destructive text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60"
              >
                {deleteLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                )}
                Evet, Sil
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Iptal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Settings Modal */}
      {ticketPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setTicketPartner(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-foreground">Bilet Sistemi</h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">@{ticketPartner.username}</p>
              </div>
              <button onClick={() => setTicketPartner(null)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleTicketSubmit} className="space-y-5">
              {/* Toggle */}
              <div className="flex items-center justify-between p-4 bg-secondary border border-border rounded-xl">
                <div>
                  <p className="text-sm font-medium text-foreground">Bilet Sistemi</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ticketForm.enabled ? "Bu partner için bilet sistemi aktif" : "Bu partner için bilet sistemi pasif"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTicketForm((p) => ({ ...p, enabled: !p.enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${ticketForm.enabled ? "bg-primary" : "bg-muted-foreground/30"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${ticketForm.enabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              {/* Threshold + Start Date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Bilet Eşiği (₺)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={ticketForm.threshold}
                    onChange={(e) => setTicketForm((p) => ({ ...p, threshold: parseInt(e.target.value) || 1000 }))}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Başlangıç Tarihi
                  </label>
                  <input
                    type="date"
                    value={ticketForm.startDate}
                    onChange={(e) => setTicketForm((p) => ({ ...p, startDate: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Her ₺{ticketForm.threshold.toLocaleString("tr-TR")} yatırım için 1 bilet —
                {ticketForm.startDate
                  ? ` ${new Date(ticketForm.startDate).toLocaleDateString("tr-TR")} tarihinden itibaren geçerli.`
                  : " tüm yatırımlar dahil (tarih seçilmedi)."}
              </p>

              {/* Toplam bilet hedefi */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Toplam Bilet Hedefi
                </label>
                <input
                  type="number"
                  min={1}
                  value={ticketForm.goal}
                  onChange={(e) => setTicketForm((p) => ({ ...p, goal: Math.max(1, parseInt(e.target.value) || 10000) }))}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                <p className="text-xs text-muted-foreground">
                  Bilet numaraları #00001&apos;den başlayarak bu hedefe kadar sıralanır. Örn: {ticketForm.goal.toLocaleString("tr-TR")} bilet → #{"0".repeat(String(ticketForm.goal).length - 1)}1 → #{ticketForm.goal.toLocaleString("tr-TR").replace(/\./g, "")}
                </p>
              </div>

              {ticketMsg && (
                <p className={`text-sm px-3 py-2 rounded-lg border ${ticketMsg.ok ? "text-green-600 bg-green-500/10 border-green-500/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
                  {ticketMsg.text}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={ticketLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {ticketLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : "Kaydet"}
                </button>
                <button type="button" onClick={() => setTicketPartner(null)} className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors">
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-foreground">Partner Düzenle</h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">@{editing.username}</p>
              </div>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ad Soyad</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ad Soyad"
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {/* Ref Code — readonly */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Ref Kodu{" "}
                  <span className="normal-case font-normal text-muted-foreground/60">(değiştirilemez)</span>
                </label>
                <input
                  value={editForm.refCode}
                  readOnly
                  tabIndex={-1}
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-muted-foreground font-mono cursor-not-allowed"
                />
              </div>

              {/* Short Link */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kısa Link</label>
                <input
                  value={editForm.shortLink}
                  onChange={(e) => setEditForm((p) => ({ ...p, shortLink: e.target.value }))}
                  placeholder="https://kisa.link/partner"
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {/* Commission Rate + Type */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Komisyon %</label>
                  <input
                    type="number" min={1} max={100}
                    value={editForm.commissionRate}
                    onChange={(e) => setEditForm((p) => ({ ...p, commissionRate: Number(e.target.value) }))}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tip</label>
                  <select
                    value={editForm.commissionType}
                    onChange={(e) => setEditForm((p) => ({ ...p, commissionType: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  >
                    <option value="deposit">Deposit Bazlı</option>
                    <option value="net">Net Kazanç</option>
                  </select>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Yeni Şifre <span className="normal-case text-muted-foreground/60">(boş bırakırsan değişmez)</span></label>
                <input
                  type="password"
                  value={editForm.newPassword}
                  onChange={(e) => setEditForm((p) => ({ ...p, newPassword: e.target.value }))}
                  placeholder="Değiştirmek istersen gir"
                  autoComplete="new-password"
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {editError && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{editError}</p>
              )}
              {editSuccess && (
                <p className="text-sm text-green-600 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 font-medium">Kaydedildi!</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {editLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : "Kaydet"}
                </button>
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors">
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
