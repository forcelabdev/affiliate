"use client"

import { useEffect, useState, useCallback, useRef } from "react"

// ── Bulk bonus state ──────────────────────────────────────────────────────────
interface BulkBonusForm {
  usernames: string
  amount: string
  bonusType: string
  wagerRequirement: string
  minDeposit: string
  minWithdraw: string
  note: string
  category: string
}

interface BulkBonusResult {
  success: boolean
  message: string
  processed?: number
  processedUsers?: string[]
  skippedIpConflict?: string[]
  skippedLastBonus?: string[]
  skippedNotPartnerMember?: string[]
  notFound?: string[]
  errors?: string[]
  bonusType?: string
  wagerRequirement?: number
  minDeposit?: number
  minWithdraw?: number
  amount?: number
}

interface IpGroup {
  ip: string
  userCount: number
  users: {
    _id: string
    username: string
    name?: string
    createdAt?: string
    lastSeen?: string
  }[]
}

interface AllUser {
  _id: string
  username: string
  name?: string
  rank?: string
  createdAt?: string
  ipCount: number
  lastIp?: string
  lastTxType?: "bonus" | "deposit" | "none"
  lastTxDate?: string | null
}

interface IpInfo {
  ip: string
  country: string | null
  countryCode: string | null
  city: string | null
  isp: string | null
  org: string | null
  isProxy: boolean
  isHosting: boolean
  isMobile: boolean
  status: string
}

type Tab = "conflicts" | "all" | "bonus" | "vpn"

function getToken() {
  if (typeof window === "undefined") return ""
  return localStorage.getItem("affiliate_token") || ""
}

export default function IpAnalysisPage() {
  const [tab, setTab] = useState<Tab>("conflicts")
  const [conflicts, setConflicts] = useState<IpGroup[]>([])
  const [allUsers, setAllUsers] = useState<AllUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [expandedIps, setExpandedIps] = useState<Set<string>>(new Set())
  const [minAccounts, setMinAccounts] = useState(2)

  // VPN check state
  const [vpnResults, setVpnResults] = useState<IpInfo[]>([])
  const [vpnLoading, setVpnLoading] = useState(false)
  const [vpnChecked, setVpnChecked] = useState(false)
  const [vpnSearch, setVpnSearch] = useState("")
  const [vpnFilter, setVpnFilter] = useState<"all" | "proxy" | "hosting" | "clean">("all")
  // IP → IpInfo map (conflict tab için badge)
  const [ipInfoMap, setIpInfoMap] = useState<Map<string, IpInfo>>(new Map())

  // Partner list for bonus filtering
  const [partners, setPartners] = useState<{ id: number; username: string; name: string | null }[]>([])
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | "">("")

  // Bulk bonus state
  const [bonusForm, setBonusForm] = useState<BulkBonusForm>({
    usernames: "", amount: "", bonusType: "Genel Bonus",
    wagerRequirement: "", minDeposit: "", minWithdraw: "", note: "", category: "affiliate_bonus",
  })
  const [bonusLoading, setBonusLoading] = useState(false)
  const [bonusResult, setBonusResult] = useState<BulkBonusResult | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const token = getToken()
      const res = await fetch(`/api/affiliate/ip-analysis`, {
        headers: { "x-auth-token": token },
      })
      const json = await res.json()
      if (json.success) {
        setConflicts(json.conflicts ?? [])
        setAllUsers(json.users ?? [])
      }
    } catch (e) {
      console.error("[v0] ip-analysis fetch error:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Fetch partners for bonus tab
  useEffect(() => {
    async function fetchPartners() {
      try {
        const token = getToken()
        const res = await fetch("/api/affiliate/partners", {
          headers: { "x-auth-token": token },
        })
        const json = await res.json()
        if (json.success && json.partners) {
          setPartners(
            json.partners.map((p: any) => ({
              id: parseInt(p.neonId ?? "0"),
              username: p.username,
              name: p.name ?? null,
            }))
          )
        }
      } catch {}
    }
    fetchPartners()
  }, [])

  const toggleIp = (ip: string) => {
    setExpandedIps(prev => {
      const next = new Set(prev)
      next.has(ip) ? next.delete(ip) : next.add(ip)
      return next
    })
  }

  async function checkVpn() {
    // Çakışma listesindeki tüm benzersiz IP'leri al
    const uniqueIps = [...new Set(conflicts.map(g => g.ip))].slice(0, 100)
    if (uniqueIps.length === 0) return
    setVpnLoading(true)
    setVpnChecked(false)
    try {
      const token = getToken()
      const res = await fetch("/api/affiliate/ip-lookup", {
        method: "POST",
        headers: { "x-auth-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ ips: uniqueIps }),
      })
      const json = await res.json()
      if (json.success) {
        setVpnResults(json.data)
        const map = new Map<string, IpInfo>()
        json.data.forEach((info: IpInfo) => map.set(info.ip, info))
        setIpInfoMap(map)
        setVpnChecked(true)
      }
    } catch {
      // sessiz hata
    } finally {
      setVpnLoading(false)
    }
  }

  const bulkSubmittingRef = useRef(false)

  async function submitBulkBonus() {
    if (bulkSubmittingRef.current) return
    bulkSubmittingRef.current = true
    setBonusLoading(true)
    setBonusResult(null)
    try {
      const token = getToken()
      const res = await fetch("/api/affiliate/bonus/bulk", {
        method: "POST",
        headers: { "x-auth-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({
          usernames: bonusForm.usernames,
          amount: parseFloat(bonusForm.amount),
          bonusType: bonusForm.bonusType,
          wagerRequirement: bonusForm.wagerRequirement ? parseFloat(bonusForm.wagerRequirement) : 0,
          minDeposit: bonusForm.minDeposit ? parseFloat(bonusForm.minDeposit) : 0,
          minWithdraw: bonusForm.minWithdraw ? parseFloat(bonusForm.minWithdraw) : 0,
          note: bonusForm.note,
          category: bonusForm.category,
          partnerId: selectedPartnerId || null,
        }),
      })
      const json = await res.json()
      setBonusResult(json)
    } catch {
      setBonusResult({ success: false, message: "Bağlantı hatası." })
    } finally {
      setBonusLoading(false)
      bulkSubmittingRef.current = false
    }
  }

  const filteredConflicts = conflicts
    .filter(g => g.userCount >= minAccounts)
    .filter(g =>
      !search ||
      g.ip.includes(search) ||
      g.users.some(u => u.username.toLowerCase().includes(search.toLowerCase()))
    )

  const filteredUsers = allUsers.filter(u =>
    !search ||
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.lastIp?.includes(search)
  )

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">IP Analizi</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Multi hesap tespiti ve üye IP takibi</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-secondary transition-colors text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Yenile
        </button>
      </div>

      {/* İstatistik kartları */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Toplam Üye</p>
          <p className="text-2xl font-bold text-foreground">{allUsers.length.toLocaleString("tr-TR")}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground mb-1">IP Çakışması</p>
          <p className="text-2xl font-bold text-destructive">{conflicts.filter(g => g.userCount >= 2).length.toLocaleString("tr-TR")}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Şüpheli Üye</p>
          <p className="text-2xl font-bold text-warning">
            {[...new Set(conflicts.filter(g => g.userCount >= 2).flatMap(g => g.users.map(u => u._id)))].length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground mb-1">5+ Hesap / IP</p>
          <p className="text-2xl font-bold text-primary">{conflicts.filter(g => g.userCount >= 5).length}</p>
        </div>
      </div>

      {/* Tab + Arama + Filtre */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex bg-secondary rounded-xl p-1 gap-1">
          <button
            onClick={() => setTab("conflicts")}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === "conflicts" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            IP Çakışmaları
          </button>
          <button
            onClick={() => setTab("all")}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Tüm Üyeler
          </button>
          <button
            onClick={() => setTab("bonus")}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === "bonus" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Toplu Bonus Ekle
          </button>
          <button
            onClick={() => setTab("vpn")}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${tab === "vpn" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
            VPN Kontrol
          </button>
        </div>

        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            placeholder={tab === "conflicts" ? "IP veya kullanıcı adı ara..." : "Kullanıcı adı, isim veya IP ara..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {tab !== "bonus" && tab === "conflicts" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Min hesap:</span>
            <select
              value={minAccounts}
              onChange={e => setMinAccounts(Number(e.target.value))}
              className="bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              {[2, 3, 5, 10].map(n => <option key={n} value={n}>{n}+</option>)}
            </select>
          </div>
        )}
      </div>

      {/* İçerik */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : tab === "conflicts" ? (
        /* IP Çakışmaları */
        <div className="flex flex-col gap-3">
          {filteredConflicts.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
              </svg>
              <span className="text-sm font-medium">IP çakışması bulunamadı</span>
            </div>
          ) : (
            filteredConflicts.map(group => (
              <div key={group.ip} className="bg-card border border-border rounded-2xl overflow-hidden">
                {/* Grup başlığı */}
                <button
                  onClick={() => toggleIp(group.ip)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${group.userCount >= 5 ? "bg-destructive" : group.userCount >= 3 ? "bg-warning" : "bg-primary"}`}/>
                    <div className="text-left">
                      <p className="font-mono text-sm font-semibold text-foreground">{group.ip}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{group.userCount} hesap bu IP&apos;yi kullanıyor</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {(() => {
                      const info = ipInfoMap.get(group.ip)
                      if (!info) return null
                      return (
                        <div className="flex items-center gap-1.5">
                          {info.isProxy && (
                            <span className="px-2 py-0.5 bg-destructive/10 text-destructive text-xs font-bold rounded-lg">VPN/Proxy</span>
                          )}
                          {info.isHosting && (
                            <span className="px-2 py-0.5 bg-warning/10 text-warning text-xs font-bold rounded-lg">Hosting</span>
                          )}
                          {info.isMobile && (
                            <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-xs font-bold rounded-lg">Mobil</span>
                          )}
                          {info.countryCode && (
                            <span className="px-2 py-0.5 bg-secondary text-muted-foreground text-xs rounded-lg font-mono">{info.countryCode} · {info.city || "?"}</span>
                          )}
                        </div>
                      )
                    })()}
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                      group.userCount >= 5 ? "bg-destructive/10 text-destructive" :
                      group.userCount >= 3 ? "bg-warning/10 text-warning" :
                      "bg-primary/10 text-primary"
                    }`}>
                      {group.userCount >= 5 ? "Yüksek Risk" : group.userCount >= 3 ? "Orta Risk" : "Düşük Risk"}
                    </span>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expandedIps.has(group.ip) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </div>
                </button>

                {/* Kullanıcı listesi */}
                {expandedIps.has(group.ip) && (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-secondary/30">
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Kayıt Tarihi</th>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Son Görülme</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.users.map((u, i) => (
                          <tr key={u._id} className="border-t border-border/50 hover:bg-secondary/20 transition-colors">
                            <td className="px-5 py-3 text-muted-foreground text-xs">{i + 1}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {u.username[0]?.toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-medium text-foreground text-sm">{u.username}</p>
                                  {u.name && <p className="text-xs text-muted-foreground">{u.name}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground hidden md:table-cell">
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground hidden md:table-cell">
                              {u.lastSeen ? new Date(u.lastSeen).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : tab === "vpn" ? (
        /* VPN Kontrol */
        <div className="flex flex-col gap-4">
          {/* Kontrol butonu */}
          {!vpnChecked ? (
            <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-4">
              <svg className="w-12 h-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
              </svg>
              <div className="text-center">
                <p className="font-semibold text-foreground">IP Çakışmalarını VPN/Proxy Kontrol Et</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {conflicts.length} benzersiz IP, ip-api.com üzerinden sorgulanacak.
                  VPN, proxy, hosting ve ülke bilgisi gösterilecek.
                </p>
              </div>
              <button
                onClick={checkVpn}
                disabled={vpnLoading || conflicts.length === 0}
                className="px-6 py-2.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
              >
                {vpnLoading ? (
                  <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Sorgulanıyor...</>
                ) : "VPN Kontrolü Başlat"}
              </button>
            </div>
          ) : (
            <>
              {/* Özet kartlar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-card border border-border rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Toplam Sorgulanan</p>
                  <p className="text-2xl font-bold text-foreground">{vpnResults.length}</p>
                </div>
                <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">VPN / Proxy</p>
                  <p className="text-2xl font-bold text-destructive">{vpnResults.filter(r => r.isProxy).length}</p>
                </div>
                <div className="bg-warning/5 border border-warning/20 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Hosting / DC</p>
                  <p className="text-2xl font-bold text-warning">{vpnResults.filter(r => r.isHosting).length}</p>
                </div>
                <div className="bg-success/5 border border-success/20 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Temiz IP</p>
                  <p className="text-2xl font-bold text-success">{vpnResults.filter(r => !r.isProxy && !r.isHosting).length}</p>
                </div>
              </div>

              {/* Filtre + Arama */}
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex bg-secondary rounded-xl p-1 gap-1">
                  {(["all", "proxy", "hosting", "clean"] as const).map(f => (
                    <button key={f} onClick={() => setVpnFilter(f)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${vpnFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {f === "all" ? "Tümü" : f === "proxy" ? "VPN/Proxy" : f === "hosting" ? "Hosting" : "Temiz"}
                    </button>
                  ))}
                </div>
                <div className="flex-1 relative min-w-40">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  <input type="text" placeholder="IP, ISP veya ülke ara..." value={vpnSearch}
                    onChange={e => setVpnSearch(e.target.value)}
                    className="w-full pl-8 pr-4 py-2 bg-background border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <button onClick={() => { setVpnChecked(false); setVpnResults([]); setIpInfoMap(new Map()) }}
                  className="px-3 py-2 text-xs border border-border rounded-xl hover:bg-secondary transition-colors text-muted-foreground"
                >
                  Yeniden Sorgula
                </button>
              </div>

              {/* Tablo */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/40">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">IP Adresi</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Konum</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">ISP / Org</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hesap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vpnResults
                      .filter(r => {
                        if (vpnFilter === "proxy") return r.isProxy
                        if (vpnFilter === "hosting") return r.isHosting
                        if (vpnFilter === "clean") return !r.isProxy && !r.isHosting
                        return true
                      })
                      .filter(r => !vpnSearch ||
                        r.ip.includes(vpnSearch) ||
                        r.isp?.toLowerCase().includes(vpnSearch.toLowerCase()) ||
                        r.country?.toLowerCase().includes(vpnSearch.toLowerCase()) ||
                        r.city?.toLowerCase().includes(vpnSearch.toLowerCase())
                      )
                      .map(r => {
                        const group = conflicts.find(g => g.ip === r.ip)
                        return (
                          <tr key={r.ip} className="border-t border-border/50 hover:bg-secondary/20 transition-colors">
                            <td className="px-5 py-3 font-mono text-xs font-medium text-foreground">{r.ip}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {r.isProxy && <span className="px-2 py-0.5 bg-destructive/10 text-destructive text-xs font-bold rounded-lg">VPN/Proxy</span>}
                                {r.isHosting && <span className="px-2 py-0.5 bg-warning/10 text-warning text-xs font-bold rounded-lg">Hosting</span>}
                                {r.isMobile && <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-xs font-bold rounded-lg">Mobil</span>}
                                {!r.isProxy && !r.isHosting && !r.isMobile && <span className="px-2 py-0.5 bg-success/10 text-success text-xs font-bold rounded-lg">Temiz</span>}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground hidden md:table-cell">
                              {r.countryCode && <span className="font-medium text-foreground">{r.countryCode}</span>}
                              {r.city && <span> · {r.city}</span>}
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground hidden lg:table-cell max-w-48 truncate">{r.isp || r.org || "—"}</td>
                            <td className="px-5 py-3 text-xs">
                              {group ? (
                                <span className={`font-bold ${group.userCount >= 5 ? "text-destructive" : group.userCount >= 3 ? "text-warning" : "text-primary"}`}>
                                  {group.userCount} hesap
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : tab === "bonus" ? (
        /* Toplu Bonus Ekle */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-5">
            <div>
              <h2 className="font-bold text-foreground text-base">Toplu Bonus Ekle</h2>
              <p className="text-xs text-muted-foreground mt-0.5">IP çakışması olan kullanıcılar otomatik olarak elenecektir.</p>
            </div>

            {/* Partner Seçimi */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">
                Partner Filtresi <span className="text-muted-foreground font-normal">(opsiyonel)</span>
              </label>
              <select
                value={selectedPartnerId}
                onChange={e => setSelectedPartnerId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Tüm kullanıcılar (partner filtresi yok)</option>
                {partners.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.username} (@{p.username})
                  </option>
                ))}
              </select>
              {selectedPartnerId && (
                <p className="text-xs text-primary mt-1.5 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  Sadece bu partnerin üyelerine bonus verilecek, diğerleri atlanacak.
                </p>
              )}
            </div>

            {/* Kullanıcı adları */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">
                Kullanıcı Adları <span className="text-muted-foreground font-normal">(virgül veya satır başı ile ayır)</span>
              </label>
              <textarea
                value={bonusForm.usernames}
                onChange={e => setBonusForm(p => ({ ...p, usernames: e.target.value }))}
                placeholder={"kullanici1\nkullanici2\nkullanici3"}
                rows={6}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors resize-none font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {bonusForm.usernames.split(/[\n,]+/).filter(s => s.trim()).length} kullanıcı girildi
              </p>

              {/* Anlık IP çakışma uyarısı */}
              {(() => {
                const entered = new Set(
                  bonusForm.usernames.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
                )
                if (entered.size === 0) return null

                // Girilen kullanıcılardan en az birini içeren çakışma grupları
                const matchedGroups = conflicts.filter(g =>
                  g.users.some(u => entered.has(u.username?.toLowerCase()))
                )
                if (matchedGroups.length === 0) return null

                return (
                  <div className="mt-2 border border-destructive/30 bg-destructive/5 rounded-xl p-3.5 flex flex-col gap-2.5">
                    <p className="text-xs font-bold text-destructive flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                      </svg>
                      {matchedGroups.length} IP çakışması tespit edildi — bu kullanıcılar elenecek
                    </p>
                    <div className="flex flex-col gap-2">
                      {matchedGroups.map(g => {
                        const enteredInGroup = g.users.filter(u => entered.has(u.username?.toLowerCase()))
                        const othersInGroup  = g.users.filter(u => !entered.has(u.username?.toLowerCase()))
                        return (
                          <div key={g.ip} className="bg-background/60 rounded-lg p-2.5 text-xs">
                            <p className="font-mono text-muted-foreground mb-1.5">{g.ip}</p>
                            <div className="flex flex-wrap gap-1">
                              {enteredInGroup.map(u => (
                                <span key={u._id} className="px-2 py-0.5 bg-destructive/15 text-destructive font-bold rounded-md font-mono">
                                  {u.username}
                                </span>
                              ))}
                              {othersInGroup.length > 0 && (
                                <>
                                  <span className="px-1 py-0.5 text-muted-foreground self-center">ile aynı IP</span>
                                  {othersInGroup.map(u => (
                                    <span key={u._id} className="px-2 py-0.5 bg-secondary text-muted-foreground rounded-md font-mono">
                                      {u.username}
                                    </span>
                                  ))}
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Tutar */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Bonus Tutarı (₺)</label>
                <input
                  type="number"
                  value={bonusForm.amount}
                  onChange={e => setBonusForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="0.00"
                  min={0}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Bonus Türü</label>
                <select
                  value={bonusForm.bonusType}
                  onChange={e => setBonusForm(p => ({ ...p, bonusType: e.target.value }))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  <option>Genel Bonus</option>
                  <option>Hoşgeldin Bonusu</option>
                  <option>Yatırım Bonusu</option>
                  <option>Kayıp Bonusu</option>
                  <option>Çevrimsiz Bonus</option>
                  <option>Affiliate Bonusu</option>
                </select>
              </div>
            </div>

            {/* Şartlar */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Çevrim Şartı (x)</label>
                <input
                  type="number"
                  value={bonusForm.wagerRequirement}
                  onChange={e => setBonusForm(p => ({ ...p, wagerRequirement: e.target.value }))}
                  placeholder="Örn: 5"
                  min={0}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Min. Yatırım (₺)</label>
                <input
                  type="number"
                  value={bonusForm.minDeposit}
                  onChange={e => setBonusForm(p => ({ ...p, minDeposit: e.target.value }))}
                  placeholder="Örn: 100"
                  min={0}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            {/* Min. Çekim */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Min. Çekim (₺)</label>
              <input
                type="number"
                value={bonusForm.minWithdraw}
                onChange={e => setBonusForm(p => ({ ...p, minWithdraw: e.target.value }))}
                placeholder="Örn: 500"
                min={0}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Not */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Not / Açıklama</label>
              <input
                type="text"
                value={bonusForm.note}
                onChange={e => setBonusForm(p => ({ ...p, note: e.target.value }))}
                placeholder="Manuel işlem açıklaması..."
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Önizleme şartlar */}
            {(bonusForm.wagerRequirement || bonusForm.minDeposit || bonusForm.minWithdraw || bonusForm.bonusType !== "Genel Bonus") && (
              <div className="bg-secondary/50 border border-border rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
                <p className="font-semibold text-foreground mb-0.5">Bonus Şartları Önizleme</p>
                {bonusForm.bonusType && <p className="text-muted-foreground">Tür: <span className="text-foreground font-medium">{bonusForm.bonusType}</span></p>}
                {bonusForm.wagerRequirement && <p className="text-muted-foreground">Çevrim: <span className="text-foreground font-medium">{bonusForm.wagerRequirement}x</span></p>}
                {bonusForm.minDeposit && <p className="text-muted-foreground">Min. Yatırım: <span className="text-foreground font-medium">₺{parseFloat(bonusForm.minDeposit).toLocaleString("tr-TR")}</span></p>}
                {bonusForm.minWithdraw && <p className="text-muted-foreground">Min. Çekim: <span className="text-foreground font-medium">₺{parseFloat(bonusForm.minWithdraw).toLocaleString("tr-TR")}</span></p>}
                {bonusForm.amount && <p className="text-muted-foreground">Bonus Tutarı: <span className="text-primary font-bold">₺{parseFloat(bonusForm.amount).toLocaleString("tr-TR")}</span></p>}
              </div>
            )}

            <button
              onClick={submitBulkBonus}
              disabled={bonusLoading || !bonusForm.usernames.trim() || !bonusForm.amount}
              className="w-full py-3 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {bonusLoading ? (
                <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>İşleniyor...</>
              ) : "Bonusları Ekle"}
            </button>
          </div>

          {/* Sonuç paneli */}
          <div className="flex flex-col gap-4">
            {bonusResult ? (
              <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-4">
                <div className={`flex items-center gap-2 p-3.5 rounded-xl text-sm font-medium ${bonusResult.success ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {bonusResult.success ? (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  ) : (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  )}
                  {bonusResult.message}
                </div>

                {/* Sayısal özet */}
                {bonusResult.success && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-success/5 border border-success/20 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-success">{bonusResult.processed ?? 0}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Eklendi</p>
                    </div>
                    <div className="bg-warning/5 border border-warning/20 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-warning">{bonusResult.skippedIpConflict?.length ?? 0}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">IP Çakışması</p>
                    </div>
                    <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-orange-500">{bonusResult.skippedLastBonus?.length ?? 0}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Son Bonus Aktif</p>
                    </div>
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-purple-500">{bonusResult.skippedNotPartnerMember?.length ?? 0}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Partner Üyesi Değil</p>
                    </div>
                    <div className="bg-secondary rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-foreground">{bonusResult.notFound?.length ?? 0}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Bulunamadı</p>
                    </div>
                  </div>
                )}

                {/* Başarılı kullanıcılar */}
                {(bonusResult.processedUsers?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-2">Bonus Eklenen Kullanıcılar ({bonusResult.processedUsers!.length})</p>
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                      {bonusResult.processedUsers!.map(u => (
                        <span key={u} className="px-2 py-0.5 bg-success/10 text-success text-xs rounded-lg font-mono">{u}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Son işlemi bonus olanlar (atlandı) */}
                {(bonusResult.skippedLastBonus?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-orange-500 mb-2">
                      Son İşlemi Bonus — Atlandı ({bonusResult.skippedLastBonus!.length})
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">Bu kullanıcılar daha önce bonus almış, henüz yatırım yapmamış.</p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {bonusResult.skippedLastBonus!.map(u => (
                        <span key={u} className="px-2 py-0.5 bg-orange-500/10 text-orange-500 text-xs rounded-lg font-mono">{u}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Partner üyesi olmayan (atlandı) */}
                {(bonusResult.skippedNotPartnerMember?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-purple-500 mb-2">
                      Partner Üyesi Değil — Atlandı ({bonusResult.skippedNotPartnerMember!.length})
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">Bu kullanıcılar seçilen partnerin referansı değil.</p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {bonusResult.skippedNotPartnerMember!.map(u => (
                        <span key={u} className="px-2 py-0.5 bg-purple-500/10 text-purple-500 text-xs rounded-lg font-mono">{u}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* IP çakışması nedeniyle atlananlar */}
                {(bonusResult.skippedIpConflict?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-warning mb-2">IP Çakışması - Atlananlar ({bonusResult.skippedIpConflict!.length})</p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {bonusResult.skippedIpConflict!.map(u => (
                        <span key={u} className="px-2 py-0.5 bg-warning/10 text-warning text-xs rounded-lg font-mono">{u}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bulunamayanlar */}
                {(bonusResult.notFound?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Bulunamayan Kullanıcılar ({bonusResult.notFound!.length})</p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {bonusResult.notFound!.map(u => (
                        <span key={u} className="px-2 py-0.5 bg-secondary text-muted-foreground text-xs rounded-lg font-mono">{u}</span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => { setBonusResult(null); setBonusForm(p => ({ ...p, usernames: "" })) }}
                  className="w-full py-2 text-xs font-medium border border-border rounded-xl hover:bg-secondary transition-colors text-muted-foreground"
                >
                  Temizle ve Yeni İşlem
                </button>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground h-full min-h-64">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
                </svg>
                <p className="text-sm font-medium">İşlem sonucu burada görünecek</p>
                <p className="text-xs text-center">IP çakışması olan kullanıcılar otomatik elenecek, kalan kullanıcılara bonus eklenecektir.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tüm Üyeler */
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/30 border-b border-border">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Son IP</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">IP Sayısı</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Son İşlem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Kayıt Tarihi</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">Kullanıcı bulunamadı</td>
                </tr>
              ) : (
                filteredUsers.map((u, i) => (
                  <tr key={u._id} className="border-t border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="px-5 py-3 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {u.username[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{u.username}</p>
                          {u.name && <p className="text-xs text-muted-foreground">{u.name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="font-mono text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">{u.lastIp || "—"}</span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${u.ipCount > 5 ? "bg-warning/10 text-warning" : "text-muted-foreground"}`}>
                        {u.ipCount}
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      {!u.lastTxType || u.lastTxType === "none" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : u.lastTxType === "bonus" ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="px-2 py-0.5 bg-warning/10 text-warning text-xs font-bold rounded-lg w-fit">Bonus</span>
                          {u.lastTxDate && <span className="text-xs text-muted-foreground">{new Date(u.lastTxDate).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}</span>}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="px-2 py-0.5 bg-success/10 text-success text-xs font-bold rounded-lg w-fit">Yatırım</span>
                          {u.lastTxDate && <span className="text-xs text-muted-foreground">{new Date(u.lastTxDate).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
