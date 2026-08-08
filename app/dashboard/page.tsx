"use client"

import { useEffect, useState } from "react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

interface SessionUser {
  username: string
  name?: string
  role: "superadmin" | "admin" | "partner"
  affiliateId?: string
}

interface AffiliateStats {
  totalReferrals?: number
  totalDeposits?: number
  totalEarnings?: number
  pendingEarnings?: number
  code?: string
  depositBreakdown?: {
    forcelab: number
    meeldev: number
    filux: number
    xpayment: number
    manual?: number
  }
}

interface LastFiveUser {
  username: string
  createdAt?: string
  depositTotal?: number
}

interface ChartDataPoint {
  date: string
  deposits: number
  earnings: number
}

function toSafeArray<T>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : []
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  icon: React.ReactNode
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground font-medium">{label}</p>
        <span className={`p-2 rounded-lg ${accent ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
          {icon}
        </span>
      </div>
      <div>
        <p className={`text-2xl font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function LastFiveList({ items }: { items: unknown }) {
  const list = toSafeArray<LastFiveUser>(items)
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <svg className="w-8 h-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
        </svg>
        <p className="text-xs text-muted-foreground">Henüz referral yok</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col">
      {list.map((u, i) => (
        <div key={i} className="flex items-center gap-2.5 py-2 border-b border-border last:border-0">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary uppercase">{(u.username ?? "?")[0]}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{u.username}</p>
            {u.createdAt && (
              <p className="text-xs text-muted-foreground">
                {new Date(u.createdAt).toLocaleDateString("tr-TR")}
              </p>
            )}
          </div>
          {u.depositTotal !== undefined && (
            <span className="text-xs font-semibold text-success">
              ₺{u.depositTotal.toLocaleString("tr-TR")}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<AffiliateStats | null>(null)
  const [lastFiveRaw, setLastFiveRaw] = useState<unknown>(null)
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState("")
  const [token, setToken] = useState("")
  const [refLink, setRefLink] = useState("")
  const [refCode, setRefCode] = useState("")
  const [copied, setCopied] = useState(false)
  const [commissionRate, setCommissionRate] = useState(10)
  const [commissionType, setCommissionType] = useState<"deposit" | "net">("deposit")
  const [role, setRole] = useState<string>("")

  // Manuel Kripto Deposit Modal
  const [cryptoModal, setCryptoModal] = useState({
    open: false, username: "", amount: "", txHash: "", network: "TRC20", note: "", loading: false,
    result: null as { success: boolean; message: string } | null,
  })

  const lastFive = toSafeArray<LastFiveUser>(lastFiveRaw)

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const u = localStorage.getItem("affiliate_user")
    
    setToken(t)
    if (u) {
      try {
        const parsed = JSON.parse(u) as SessionUser
        
        const id = parsed.affiliateId || parsed.id || parsed._id || ""
        const code = parsed.refCode || ""
        const r = parsed.role || ""
        setUserId(id)
        setRefCode(code)
        setRole(r)
        if (typeof parsed.commissionRate === "number") setCommissionRate(parsed.commissionRate)
        if (parsed.commissionType) setCommissionType(parsed.commissionType)
        if (code) setRefLink(`https://bizzocazino.com/register?a=${code}`)
        // Partner rolünde refCode yoksa bile fetchData çağır — API MongoDB'den çözer
        fetchData(id, t, code, r)
      } catch {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [])

  async function fetchData(id: string, t: string, code?: string, r?: string) {
    const isAdmin = (r || role) === "admin" || (r || role) === "superadmin"
    setLoading(true)
    try {
      if (!isAdmin && !id && !code) {
        // Son çare: kullanıcı adı ile de dene
        const storedUser = localStorage.getItem("affiliate_user")
        const username = storedUser ? JSON.parse(storedUser)?.username : null
        if (!username) { setLoading(false); return }
      }

      // Superadmin with no code: send id only, API will aggregate all partners
      const param = code ? `refCode=${encodeURIComponent(code)}` : `id=${id}`
      const [infoRes, lastFiveRes, chartRes] = await Promise.all([
        fetch(`/api/affiliate/info?${param}`, { headers: { "x-auth-token": t } }),
        fetch(`/api/affiliate/last-five?${param}`, { headers: { "x-auth-token": t } }),
        fetch(`/api/affiliate/chart?${param}`, { headers: { "x-auth-token": t } }),
      ])

      const [infoData, lastFiveData, chartJson] = await Promise.all([
        infoRes.json().catch(() => ({})),
        lastFiveRes.json().catch(() => ({})),
        chartRes.json().catch(() => ({})),
      ])

      if (infoData.success) {
        const s = infoData.stats || {}
        const code = infoData.refCode || id
        setStats({
          totalReferrals: s.totalReferrals ?? 0,
          totalDeposits: s.totalDeposits ?? 0,
          totalEarnings: s.totalEarnings ?? 0,
          pendingEarnings: s.pendingEarnings ?? 0,
          code,
          depositBreakdown: s.depositBreakdown ?? undefined,
        })
        if (s.commissionRate) setCommissionRate(s.commissionRate)
        setRefCode(code)
        setRefLink(`https://bizzocazino.com/register?a=${code}`)
      }

      // API { success, data: [...] } döndürür
      const rawLastFive = Array.isArray(lastFiveData?.data)
        ? lastFiveData.data
        : Array.isArray(lastFiveData?.users)
          ? lastFiveData.users
          : null
      setLastFiveRaw(rawLastFive)

      if (chartJson?.success && Array.isArray(chartJson.data)) {
        setChartData(chartJson.data)
      }
    } catch {
      // leave defaults
    } finally {
      setLoading(false)
    }
  }

  function copyRefLink() {
    const link = refLink || `https://bizzocazino.com/register?a=${refCode || userId}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function submitCryptoDeposit() {
    if (!cryptoModal.username || !cryptoModal.amount) return
    setCryptoModal(p => ({ ...p, loading: true, result: null }))
    try {
      const res = await fetch("/api/affiliate/manual-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({
          username: cryptoModal.username,
          amount: parseFloat(cryptoModal.amount),
          txHash: cryptoModal.txHash,
          network: cryptoModal.network,
          note: cryptoModal.note,
        }),
      })
      const data = await res.json()
      setCryptoModal(p => ({ ...p, loading: false, result: { success: data.success, message: data.message } }))
      if (data.success) {
        setCryptoModal(p => ({ ...p, username: "", amount: "", txHash: "", note: "" }))
        fetchData(userId, token, refCode, role)
      }
    } catch {
      setCryptoModal(p => ({ ...p, loading: false, result: { success: false, message: "İşlem başarısız." } }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-sm text-muted-foreground">Veriler yükleniyor...</p>
        </div>
      </div>
    )
  }

  const displayLink = refLink || (refCode ? `https://bizzocazino.com/register?a=${refCode}` : "")

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Genel Bakış</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Affiliate istatistikleriniz ve son aktiviteler</p>
        </div>
        {role === "superadmin" && (
          <button
            onClick={() => setCryptoModal(p => ({ ...p, open: true, result: null }))}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
            Manuel Kripto Ekle
          </button>
        )}
      </div>

      {!stats && !loading && role !== "superadmin" && role !== "admin" && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-warning">Veriler yüklenemedi</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Veriler geçici olarak alınamıyor. Lütfen daha sonra tekrar deneyin.
            </p>
          </div>
        </div>
      )}

      {displayLink && role !== "superadmin" && role !== "admin" && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Referans Linkiniz</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bizzocazino — Komisyon:{" "}
              <span className="font-semibold text-primary">{commissionRate}%</span>{" "}
              ({commissionType === "net" ? "Net kazanç bazlı" : "Deposit bazlı"})
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:w-96 bg-secondary border border-border rounded-lg px-3 py-2 text-xs text-foreground font-mono truncate select-all">
              {displayLink}
            </div>
            <button
              onClick={copyRefLink}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all flex-shrink-0 flex items-center gap-1.5 ${
                copied
                  ? "bg-success text-success-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                  Kopyalandı
                </>
              ) : "Kopyala"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Toplam Referral"
          value={(stats?.totalReferrals ?? 0).toLocaleString("tr-TR")}
          sub="Kayıtlı üye"
          accent
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
          }
        />
        <StatCard
          label="Toplam Deposit"
          value={`₺${(stats?.totalDeposits ?? 0).toLocaleString("tr-TR")}`}
          sub="Tüm Zamanlar"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
            </svg>
          }
        />
        <StatCard
          label={`Komisyon (${commissionRate}%)`}
          value={`₺${(stats?.totalEarnings ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`}
          sub="Tüm Zamanlar"
          accent
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
          }
        />
        <StatCard
          label="Bekleyen Kazanç"
          value={`₺${(stats?.pendingEarnings ?? 0).toLocaleString("tr-TR")}`}
          sub="Tüm Zamanlar"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          }
        />
      </div>

      {/* Deposit Yöntemi Dağılımı */}
      {stats?.depositBreakdown && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ödeme Yöntemi Dağılımı — Tüm Zamanlar</p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: "Forcelab",  value: stats.depositBreakdown.forcelab,  color: "text-foreground",   border: "border-border",          dot: "bg-muted-foreground" },
              { label: "Meeldev",   value: stats.depositBreakdown.meeldev,   color: "text-foreground",   border: "border-border",          dot: "bg-muted-foreground" },
              { label: "Filux",     value: stats.depositBreakdown.filux,     color: "text-cyan-400",     border: "border-cyan-500/20",     dot: "bg-cyan-400" },
              { label: "xPayment",  value: stats.depositBreakdown.xpayment,  color: "text-violet-400",   border: "border-violet-500/20",   dot: "bg-violet-400" },
              { label: "Manuel",    value: stats.depositBreakdown.manual ?? 0, color: "text-warning",    border: "border-warning/20",       dot: "bg-warning" },
            ].map(item => (
              <div key={item.label} className={`bg-card border ${item.border} rounded-xl p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.dot}`}/>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                </div>
                <p className={`text-lg font-bold ${item.color}`}>
                  ₺{item.value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {stats.totalDeposits ? Math.round((item.value / stats.totalDeposits) * 100) : 0}% toplam
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Deposit Grafiği</p>
              <p className="text-xs text-muted-foreground">Son 30 gün</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary inline-block"/>Deposit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-chart-2 inline-block"/>Kazanç
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#eab308" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorEarnings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false}/>
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--foreground)",
                }}
                cursor={{ stroke: "var(--border)" }}
              />
              <Area type="monotone" dataKey="deposits" stroke="#eab308" strokeWidth={2} fill="url(#colorDeposits)"/>
              <Area type="monotone" dataKey="earnings" stroke="#38bdf8" strokeWidth={2} fill="url(#colorEarnings)"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-foreground">Son Kayıtlar</p>
            <a href="/dashboard/referrals" className="text-xs text-primary hover:underline">{"Tümü"}</a>
          </div>
          <LastFiveList items={lastFive} />
        </div>
      </div>

      {/* Manuel Kripto Deposit Modal */}
      {cryptoModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCryptoModal(p => ({ ...p, open: false }))}/>
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-amber-500/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-foreground">Manuel Kripto Yatırımı</p>
                  <p className="text-xs text-muted-foreground">TronScan / Etherscan</p>
                </div>
              </div>
              <button onClick={() => setCryptoModal(p => ({ ...p, open: false }))} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Kullanıcı Adı</label>
                <input
                  type="text"
                  value={cryptoModal.username}
                  onChange={e => setCryptoModal(p => ({ ...p, username: e.target.value }))}
                  placeholder="Kullanıcı adını girin..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Tutar (TRY)</label>
                  <input
                    type="number"
                    min={1}
                    value={cryptoModal.amount}
                    onChange={e => setCryptoModal(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0"
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Ağ</label>
                  <select
                    value={cryptoModal.network}
                    onChange={e => setCryptoModal(p => ({ ...p, network: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="TRC20">TRC20 (Tron)</option>
                    <option value="ERC20">ERC20 (Ethereum)</option>
                    <option value="BEP20">BEP20 (BSC)</option>
                    <option value="SOL">Solana</option>
                    <option value="BTC">Bitcoin</option>
                    <option value="Other">Diğer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">TX Hash <span className="text-muted-foreground font-normal">(opsiyonel)</span></label>
                <input
                  type="text"
                  value={cryptoModal.txHash}
                  onChange={e => setCryptoModal(p => ({ ...p, txHash: e.target.value }))}
                  placeholder="İşlem hash'i..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors font-mono text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Not <span className="text-muted-foreground font-normal">(opsiyonel)</span></label>
                <input
                  type="text"
                  value={cryptoModal.note}
                  onChange={e => setCryptoModal(p => ({ ...p, note: e.target.value }))}
                  placeholder="Ekleme sebebi..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {cryptoModal.result && (
                <div className={`px-4 py-3 rounded-xl text-sm ${
                  cryptoModal.result.success
                    ? "bg-success/10 text-success border border-success/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                }`}>
                  {cryptoModal.result.message}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={submitCryptoDeposit}
                  disabled={cryptoModal.loading || !cryptoModal.username || !cryptoModal.amount}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {cryptoModal.loading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                      </svg>
                      Yatırım Ekle
                    </>
                  )}
                </button>
                <button
                  onClick={() => setCryptoModal(p => ({ ...p, open: false }))}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
