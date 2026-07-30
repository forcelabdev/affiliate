"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"

interface Application {
  id: number
  username: string
  name: string | null
  email: string
  website_url: string | null
  country: string | null
  currency: string | null
  telegram: string | null
  teams: string | null
  status: "pending" | "approved" | "rejected"
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

interface ApproveModal {
  app: Application
  refCode: string
  commissionRate: number
  commissionType: "deposit" | "net"
}

export default function ApplicationsPage() {
  const router = useRouter()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState("")
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending")
  const [approveModal, setApproveModal] = useState<ApproveModal | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState("")
  const [actionSuccess, setActionSuccess] = useState("")

  const fetchApps = useCallback(async (t: string) => {
    setLoading(true)
    try {
      const res = await fetch("/api/affiliate/applications", {
        headers: { "x-auth-token": t },
      })
      const data = await res.json()
      if (data.success) setApps(data.applications || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const userData = localStorage.getItem("affiliate_user")
    if (!t || !userData) { router.push("/"); return }
    try {
      const parsed = JSON.parse(userData)
      if (parsed.role !== "superadmin") { router.push("/dashboard"); return }
      setToken(t)
      fetchApps(t)
    } catch {
      router.push("/")
    }
  }, [router, fetchApps])

  async function handleReject(app: Application) {
    setActionError("")
    setActionSuccess("")
    setActionLoading(true)
    try {
      const res = await fetch("/api/affiliate/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({ id: app.id, action: "reject" }),
      })
      const data = await res.json()
      if (data.success) {
        setActionSuccess("Başvuru reddedildi.")
        setApps(prev => prev.map(a => a.id === app.id ? { ...a, status: "rejected" } : a))
      } else {
        setActionError("İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.")
      }
    } finally {
      setActionLoading(false)
    }
  }

  async function handleApprove() {
    if (!approveModal) return
    if (!approveModal.refCode.trim()) {
      setActionError("Ref kodu zorunludur.")
      return
    }
    setActionError("")
    setActionSuccess("")
    setActionLoading(true)
    try {
      const res = await fetch("/api/affiliate/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({
          id: approveModal.app.id,
          action: "approve",
          refCode: approveModal.refCode,
          commissionRate: approveModal.commissionRate,
          commissionType: approveModal.commissionType,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setActionSuccess("Partner oluşturuldu!")
        setApps(prev => prev.map(a => a.id === approveModal.app.id ? { ...a, status: "approved" } : a))
        setTimeout(() => setApproveModal(null), 800)
      } else {
        setActionError("İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.")
      }
    } finally {
      setActionLoading(false)
    }
  }

  const filtered = apps.filter(a => filter === "all" || a.status === filter)
  const pendingCount = apps.filter(a => a.status === "pending").length

  function statusBadge(status: string) {
    if (status === "pending") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning border border-warning/20">Bekliyor</span>
    if (status === "approved") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-600 border border-green-500/20">Onaylandı</span>
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-destructive/15 text-destructive border border-destructive/20">Reddedildi</span>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Partner Başvuruları</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Partner olmak isteyen kullanıcıların başvurularını yönetin
          </p>
        </div>
        <button
          onClick={() => fetchApps(token)}
          disabled={loading}
          className="flex items-center gap-2 bg-secondary border border-border text-foreground px-4 py-2 rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Bekleyen", count: apps.filter(a => a.status === "pending").length, color: "text-warning" },
          { label: "Onaylanan", count: apps.filter(a => a.status === "approved").length, color: "text-green-600" },
          { label: "Reddedilen", count: apps.filter(a => a.status === "rejected").length, color: "text-destructive" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
          </div>
        ))}
      </div>

      {actionSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-600 font-medium">
          {actionSuccess}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "pending" ? `Bekleyenler${pendingCount > 0 ? ` (${pendingCount})` : ""}` : f === "approved" ? "Onaylananlar" : f === "rejected" ? "Reddedilenler" : "Tümü"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="w-6 h-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p className="text-sm">Başvuru bulunamadı</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-secondary/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">E-Posta</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Website</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Ülke</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Tarih</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(app => (
                <tr key={app.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-primary uppercase">{app.username[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{app.username}</p>
                        {app.name && <p className="text-xs text-muted-foreground">{app.name}</p>}
                        <div className="flex items-center gap-2 mt-0.5">
                          {app.telegram && (
                            <a
                              href={`https://t.me/${app.telegram.replace(/^@/, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Telegram: ${app.telegram}`}
                              className="flex items-center gap-1 text-[10px] text-sky-500 hover:text-sky-400 transition-colors"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L6.54 14.4l-2.95-.924c-.641-.2-.654-.641.136-.953l11.57-4.461c.537-.194 1.006.131.266.186z"/>
                              </svg>
                              {app.telegram.startsWith("@") ? app.telegram : `@${app.telegram}`}
                            </a>
                          )}
                          {app.teams && (
                            <span title={`Teams/LinkedIn: ${app.teams}`} className="flex items-center gap-1 text-[10px] text-blue-500">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20.625 0H3.375C1.511 0 0 1.511 0 3.375v17.25C0 22.489 1.511 24 3.375 24h17.25C22.489 24 24 22.489 24 20.625V3.375C24 1.511 22.489 0 20.625 0zM7.5 18.75H4.875V9.375H7.5V18.75zm-1.313-10.64a1.52 1.52 0 110-3.04 1.52 1.52 0 010 3.04zm13.188 10.64h-2.625v-4.594c0-.98-.017-2.243-1.366-2.243-1.368 0-1.578 1.068-1.578 2.172v4.665h-2.625V9.375h2.52v1.155h.035c.352-.664 1.21-1.365 2.49-1.365 2.663 0 3.154 1.753 3.154 4.031l-.005 5.554z"/>
                              </svg>
                              {app.teams}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{app.email}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {app.website_url ? (
                      <a href={app.website_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate max-w-[140px] block">
                        {app.website_url}
                      </a>
                    ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{app.country || "—"}</td>
                  <td className="px-4 py-3">{statusBadge(app.status)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                    {new Date(app.created_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3">
                    {app.status === "pending" && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setActionError("")
                            setActionSuccess("")
                            setApproveModal({ app, refCode: app.username, commissionRate: 10, commissionType: "deposit" })
                          }}
                          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
                        >
                          Onayla
                        </button>
                        <button
                          onClick={() => handleReject(app)}
                          disabled={actionLoading}
                          className="text-xs border border-destructive/30 text-destructive px-3 py-1.5 rounded-lg font-semibold hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        >
                          Reddet
                        </button>
                      </div>
                    )}
                    {app.status !== "pending" && (
                      <span className="text-xs text-muted-foreground/50 text-right block">{app.reviewed_by ? `@${app.reviewed_by}` : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Approve Modal */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setApproveModal(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-foreground">Başvuruyu Onayla</h3>
                <p className="text-xs text-muted-foreground mt-0.5">@{approveModal.app.username} — {approveModal.app.email}</p>
              </div>
              <button onClick={() => setApproveModal(null)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ref Kodu <span className="text-destructive">*</span></label>
                <input
                  value={approveModal.refCode}
                  onChange={e => setApproveModal(p => p ? { ...p, refCode: e.target.value } : p)}
                  placeholder="örn: ebrukod"
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                <p className="text-xs text-muted-foreground">Kayıt linki: bizzocasino168.com/?register={approveModal.refCode || "..."}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Komisyon %</label>
                  <input
                    type="number" min={1} max={100}
                    value={approveModal.commissionRate}
                    onChange={e => setApproveModal(p => p ? { ...p, commissionRate: Number(e.target.value) } : p)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tip</label>
                  <select
                    value={approveModal.commissionType}
                    onChange={e => setApproveModal(p => p ? { ...p, commissionType: e.target.value as "deposit" | "net" } : p)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  >
                    <option value="deposit">Deposit Bazlı</option>
                    <option value="net">Net Kazanç</option>
                  </select>
                </div>
              </div>

              {actionError && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{actionError}</p>
              )}
              {actionSuccess && (
                <p className="text-sm text-green-600 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 font-medium">{actionSuccess}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {actionLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : "Onayla ve Partner Oluştur"}
                </button>
                <button onClick={() => setApproveModal(null)} className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors">
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
