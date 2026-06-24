"use client"

import React, { useEffect, useState, useCallback } from "react"

type Period = "daily" | "weekly" | "monthly" | "all" | "custom"

interface BonusLog {
  _id: string
  username: string
  name?: string
  partnerName: string | null
  amount: number
  balanceBefore: number
  balanceAfter: number
  category: string | null
  note: string | null
  createdAt: string
}

interface MemberBonus {
  username: string
  name?: string
  totalBonus: number
  txCount: number
  logs: BonusLog[]
}

interface PartnerBonus {
  partnerName: string
  totalBonus: number
  memberCount: number
  txCount: number
  members: MemberBonus[]
}

interface Summary {
  totalBonus: number
  totalUsers: number
  totalTxn: number
}

function getPeriodStart(period: Period): number | null {
  if (period === "all" || period === "custom") return null
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }))
  if (period === "daily")   { now.setHours(0, 0, 0, 0); return now.getTime() }
  if (period === "weekly")  { now.setDate(now.getDate() - now.getDay()); now.setHours(0, 0, 0, 0); return now.getTime() }
  if (period === "monthly") { now.setDate(1); now.setHours(0, 0, 0, 0); return now.getTime() }
  return null
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("tr-TR")
}

export default function BonusAnalysisPage() {
  const [partners, setPartners]           = useState<PartnerBonus[]>([])
  const [summary, setSummary]             = useState<Summary>({ totalBonus: 0, totalUsers: 0, totalTxn: 0 })
  const [loading, setLoading]             = useState(true)
  const [period, setPeriod]               = useState<Period>("all")
  const [customStart, setCustomStart]     = useState("")
  const [customEnd, setCustomEnd]         = useState("")
  const [search, setSearch]               = useState("")
  const [expandedPartners, setExpanded]   = useState<Record<string, boolean>>({})
  const [expandedMembers, setExpandedM]   = useState<Record<string, boolean>>({})
  const [role, setRole]                   = useState("")

  useEffect(() => {
    const u = localStorage.getItem("affiliate_user")
    if (u) { try { setRole(JSON.parse(u).role) } catch {} }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem("affiliate_token") || ""
      const params = new URLSearchParams()
      if (period === "custom" && customStart) params.set("startDate", String(new Date(customStart).getTime()))
      if (period === "custom" && customEnd)   params.set("endDate",   String(new Date(customEnd).getTime() + 86399999))
      const start = getPeriodStart(period)
      if (start) params.set("startDate", String(start))
      if (search) params.set("search", search)

      const res  = await fetch(`/api/affiliate/bonus-analysis?${params}`, { headers: { "x-auth-token": token } })
      if (!res.ok) {
        console.error("[v0] bonus-analysis API error:", res.status, res.statusText)
        return
      }
      const text = await res.text()
      if (!text) {
        console.error("[v0] bonus-analysis empty response body")
        return
      }
      const data = JSON.parse(text)
      if (data.success) {
        setPartners(data.partners)
        setSummary(data.summary)
        // auto-expand all partners
        const exp: Record<string, boolean> = {}
        data.partners.forEach((p: PartnerBonus) => { exp[p.partnerName] = true })
        setExpanded(exp)
      }
    } finally {
      setLoading(false)
    }
  }, [period, customStart, customEnd, search])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Üye Bonus Analizi</h1>
          <p className="text-sm text-muted-foreground mt-1">Partnerlerin üyelerine yüklenen manuel bonuslar</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* Period Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground font-medium">Periyot:</span>
        {([["daily","Bugün"],["weekly","Bu Hafta"],["monthly","Bu Ay"],["all","Tüm Zamanlar"],["custom","Özel Tarih"]] as [Period, string][]).map(([p, label]) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              period === p
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {label}
          </button>
        ))}
        {period === "custom" && (
          <div className="flex items-center gap-2 mt-2 w-full flex-wrap">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary" />
            <span className="text-muted-foreground text-sm">—</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary" />
            <button onClick={fetchData}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
              Uygula
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Toplam Bonus", value: `₺${fmt(summary.totalBonus)}`, color: "text-primary" },
          { label: "Toplam Üye",   value: summary.totalUsers.toLocaleString("tr-TR"), color: "text-foreground" },
          { label: "Toplam İşlem", value: summary.totalTxn.toLocaleString("tr-TR"),   color: "text-foreground" },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-2xl p-5">
            <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Kullanıcı adı veya partner ara..."
          className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : partners.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Bonus kaydı bulunamadı.</div>
      ) : (
        <div className="space-y-4">
          {partners.map(partner => {
            const isOpen = expandedPartners[partner.partnerName] !== false
            return (
              <div key={partner.partnerName} className="bg-card border border-border rounded-2xl overflow-hidden">
                {/* Partner Header */}
                <button
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpanded(prev => ({ ...prev, [partner.partnerName]: !isOpen }))}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm">
                      {partner.partnerName[0]?.toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-foreground">{partner.partnerName}</p>
                      <p className="text-xs text-muted-foreground">{partner.txCount} bonus · {partner.memberCount} üye</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-bold text-primary text-lg">₺{fmt(partner.totalBonus)}</p>
                      <p className="text-xs text-muted-foreground">toplam bonus</p>
                    </div>
                    <svg className={`w-5 h-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </div>
                </button>

                {/* Members Table */}
                {isOpen && (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/40">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Toplam Bonus</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">İşlem Sayısı</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {partner.members.map((member, idx) => {
                          const mKey = `${partner.partnerName}__${member.username}`
                          const mOpen = expandedMembers[mKey]
                          return (
                            <React.Fragment key={mKey}>
                              <tr className="hover:bg-secondary/20 transition-colors">
                                <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-foreground flex-shrink-0">
                                      {member.username[0]?.toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="font-medium text-foreground text-sm">{member.username}</p>
                                      {member.name && <p className="text-xs text-muted-foreground">{member.name}</p>}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 font-bold text-primary">₺{fmt(member.totalBonus)}</td>
                                <td className="px-4 py-3 text-muted-foreground text-sm">{member.txCount} işlem</td>
                                <td className="px-4 py-3">
                                  <button
                                    onClick={() => setExpandedM(prev => ({ ...prev, [mKey]: !prev[mKey] }))}
                                    className="px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors"
                                  >
                                    {mOpen ? "Gizle" : "Detay"}
                                  </button>
                                </td>
                              </tr>

                              {/* Member detail logs */}
                              {mOpen && (
                                <tr>
                                  <td colSpan={5} className="bg-secondary/20 px-6 py-4">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bonus İşlem Geçmişi</p>
                                    <div className="space-y-2">
                                      {member.logs.map((log, li) => (
                                        <div key={log._id || li} className="bg-card border border-border rounded-xl p-3.5 flex items-center justify-between gap-4">
                                          <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                                              <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                              </svg>
                                            </div>
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-foreground">
                                                Manuel Bonus
                                                {log.category && <span className="ml-2 text-xs bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">{log.category}</span>}
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                {log.createdAt ? new Date(log.createdAt).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                                                {log.note && <span className="ml-2 italic">"{log.note}"</span>}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="text-right flex-shrink-0 space-y-0.5">
                                            <p className="text-sm font-bold text-primary">+₺{fmt(log.amount)}</p>
                                            <p className="text-xs text-muted-foreground">
                                              ₺{fmt(log.balanceBefore)}
                                              <svg className="w-3 h-3 inline mx-1 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                                              </svg>
                                              ₺{fmt(log.balanceAfter)}
                                            </p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                      {/* Partner total row */}
                      <tfoot className="bg-secondary/30 border-t border-border">
                        <tr>
                          <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-foreground">Toplam</td>
                          <td className="px-4 py-3 font-bold text-primary">₺{fmt(partner.totalBonus)}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{partner.txCount} işlem</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
