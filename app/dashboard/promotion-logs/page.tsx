"use client"

import { useEffect, useState, useCallback } from "react"

interface PromotionLog {
  id: number
  partner_id: number
  partner_name: string
  member_id: string
  member_username: string
  ref_date: string
  total_deposit: number
  total_withdraw: number
  net_amount: number
  promotion_rate: number
  promotion_amount: number
  applied_by: string
  note: string | null
  created_at: string
}

function fmt(n: number) {
  return Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 })
}

export default function PromotionLogsPage() {
  const [logs, setLogs]           = useState<PromotionLog[]>([])
  const [loading, setLoading]     = useState(true)
  const [token, setToken]         = useState("")
  const [role, setRole]           = useState("")
  const [search, setSearch]       = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate]     = useState("")

  const fetchLogs = useCallback(async (t: string, start?: string, end?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (start) params.append("startDate", start)
      if (end)   params.append("endDate", end)
      const res  = await fetch(`/api/affiliate/promotion?${params.toString()}`, {
        headers: { "x-auth-token": t },
      })
      const json = await res.json()
      if (json.success) setLogs(json.logs ?? [])
    } catch (e) {
      console.error("[promotion-logs] fetch error:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const u = localStorage.getItem("affiliate_user")
    setToken(t)
    if (u) {
      try {
        const parsed = JSON.parse(u)
        setRole(parsed.role || "")
        fetchLogs(t)
      } catch { setLoading(false) }
    } else { setLoading(false) }
  }, [fetchLogs])

  if (role && role !== "superadmin" && role !== "admin") {
    return <div className="p-8 text-muted-foreground text-sm">Bu sayfaya erişim yetkiniz yok.</div>
  }

  // Filtreleme
  const filtered = logs.filter(l => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      l.partner_name.toLowerCase().includes(q) ||
      l.member_username.toLowerCase().includes(q) ||
      l.applied_by.toLowerCase().includes(q)
    )
  })

  // Partner bazlı gruplama
  const partnerGroups: Record<string, PromotionLog[]> = {}
  for (const log of filtered) {
    if (!partnerGroups[log.partner_name]) partnerGroups[log.partner_name] = []
    partnerGroups[log.partner_name].push(log)
  }
  const sortedPartners = Object.entries(partnerGroups).sort((a, b) => {
    const sumA = a[1].reduce((s, l) => s + Number(l.promotion_amount), 0)
    const sumB = b[1].reduce((s, l) => s + Number(l.promotion_amount), 0)
    return sumB - sumA
  })

  const grandTotal = filtered.reduce((s, l) => s + Number(l.promotion_amount), 0)

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-foreground">Promosyon Geçmişi</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Partnerlerin referans üyelerine tanımladığı tüm promosyonlar
          </p>
        </div>
        <button
          onClick={() => fetchLogs(token, startDate, endDate)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-card border border-border rounded-xl p-4">
        <div className="flex-1 min-w-48">
          <label className="text-xs text-muted-foreground mb-1 block">Ara</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Partner, üye veya uygulayan ara..."
              className="w-full bg-background border border-border rounded-lg pl-8 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Başlangıç</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Bitiş</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <button
          onClick={() => fetchLogs(token, startDate, endDate)}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Filtrele
        </button>
      </div>

      {/* Grand total card */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Toplam Promosyon</p>
          <p className="text-xl font-bold text-primary">₺{fmt(grandTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">{filtered.length} işlem</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Partner Sayısı</p>
          <p className="text-xl font-bold text-foreground">{sortedPartners.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Toplam Yatırım</p>
          <p className="text-xl font-bold text-success">₺{fmt(filtered.reduce((s,l) => s + Number(l.total_deposit), 0))}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Toplam Çekim</p>
          <p className="text-xl font-bold text-destructive">₺{fmt(filtered.reduce((s,l) => s + Number(l.total_withdraw), 0))}</p>
        </div>
      </div>

      {/* Partner grouped logs */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : sortedPartners.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground text-sm">Henüz promosyon kaydı yok.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedPartners.map(([partnerName, partnerLogs]) => {
            const partnerTotal = partnerLogs.reduce((s, l) => s + Number(l.promotion_amount), 0)
            return (
              <div key={partnerName} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Partner header */}
                <div className="flex items-center justify-between px-5 py-4 bg-secondary/30 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                      <span className="text-sm font-bold text-primary uppercase">{partnerName[0]}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{partnerName}</p>
                      <p className="text-xs text-muted-foreground">{partnerLogs.length} promosyon · {new Set(partnerLogs.map(l => l.member_username)).size} üye</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">₺{fmt(partnerTotal)}</p>
                    <p className="text-xs text-muted-foreground">toplam promosyon</p>
                  </div>
                </div>

                {/* Logs table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary/20">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Üye</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tarih</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Yatırım</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Çekim</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Net</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Eklenen Bonus</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Uygulayan</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Kayıt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerLogs.map((log, idx) => (
                        <tr key={log.id} className="border-t border-border/50 hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-primary uppercase">{log.member_username[0]}</span>
                              </div>
                              <span className="font-medium text-foreground text-xs">{log.member_username}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.ref_date).toLocaleDateString("tr-TR")}
                          </td>
                          <td className="px-4 py-3 text-xs text-success font-semibold hidden sm:table-cell">
                            ₺{fmt(Number(log.total_deposit))}
                          </td>
                          <td className="px-4 py-3 text-xs text-destructive font-semibold hidden sm:table-cell">
                            ₺{fmt(Number(log.total_withdraw))}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold text-foreground hidden md:table-cell">
                            ₺{fmt(Number(log.net_amount))}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-bold text-primary">₺{fmt(Number(log.promotion_amount))}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                            {log.applied_by}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-secondary/40 border-t border-border">
                        <td colSpan={6} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">Toplam</td>
                        <td colSpan={6} className="px-4 py-2.5 md:hidden text-xs font-semibold text-muted-foreground">Toplam</td>
                        <td className="px-4 py-2.5 text-sm font-bold text-primary">₺{fmt(partnerTotal)}</td>
                        <td colSpan={2} className="hidden lg:table-cell"/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
