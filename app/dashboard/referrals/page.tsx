"use client"

import { useMemo, useState, useEffect } from "react"

interface Referral {
  _id?: string
  id?: string
  username: string
  email?: string
  phone?: string
  name?: string
  createdAt?: string
  referredAt?: string
  depositTotal?: number
  withdrawalTotal?: number
  manualDepositTotal?: number
  manualWithdrawalTotal?: number
  rivoBalance?: number
  redeemedCode?: string
  partnerName?: string
}

type PromoType = "daily" | "weekly" | "monthly" | "initiative"

interface PromoState {
  open: boolean
  member: Referral | null
  date: string
  note: string
  loading: boolean
  result: { success: boolean; message: string } | null
  promotionType: PromoType
  initiativeAmount: number | null
}

const PROMO_RATES: Record<PromoType, number> = { daily: 15, weekly: 10, monthly: 5, initiative: 0 }
const INITIATIVE_AMOUNTS = [500, 1000, 1500, 2000]
const PROMO_LABELS: Record<PromoType, string> = { daily: "Günlük %15", weekly: "Haftalık %10", monthly: "Aylık %5", initiative: "İnsiyatif Bonusu" }

interface PromoPreview {
  dep: number; wit: number; net: number; promoAmount: number; loading: boolean
  totalDeposit: number; maxInitiative: number
  initiativeTiers: { minDeposit: number; amount: number }[]
}

const PAGE_SIZE = 20

interface ManualCryptoState {
  open: boolean
  username: string
  amount: string
  txHash: string
  network: string
  note: string
  loading: boolean
  result: { success: boolean; message: string } | null
}

function toSafeArray<T>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : []
}

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [userId, setUserId] = useState("")
  const [refCode, setRefCode] = useState("")
  const [token, setToken] = useState("")
  const [role, setRole] = useState<string>("")
  const [sortKey, setSortKey] = useState<keyof Referral>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const todayTR = () => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }))
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
  }
  const [promo, setPromo] = useState<PromoState>({
    open: false, member: null, date: todayTR(), note: "", loading: false, result: null,
    promotionType: "daily", initiativeAmount: null,
  })
  const PREVIEW_EMPTY: PromoPreview = { dep: 0, wit: 0, net: 0, promoAmount: 0, loading: false, totalDeposit: 0, maxInitiative: 0, initiativeTiers: [] }
  const [preview, setPreview] = useState<PromoPreview>(PREVIEW_EMPTY)

  // Manuel Kripto Deposit state
  const [cryptoModal, setCryptoModal] = useState<ManualCryptoState>({
    open: false, username: "", amount: "", txHash: "", network: "TRC20", note: "", loading: false, result: null,
  })

  function openPromo(member: Referral) {
    setPromo({ open: true, member, date: todayTR(), note: "", loading: false, result: null, promotionType: "daily", initiativeAmount: null })
    setPreview({ ...PREVIEW_EMPTY, loading: true })
  }
  function closePromo() {
    setPromo(p => ({ ...p, open: false }))
    setPreview(PREVIEW_EMPTY)
  }

  // Manuel kripto deposit gönder
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
        // Formu temizle ama modal açık kalsın
        setCryptoModal(p => ({ ...p, username: "", amount: "", txHash: "", note: "" }))
        // Listeyi yenile
        fetchReferrals(userId, token, refCode, role)
      }
    } catch {
      setCryptoModal(p => ({ ...p, loading: false, result: { success: false, message: "İşlem başarısız." } }))
    }
  }

  // Periyot, tarih veya üye değişince server-side preview çek
  useEffect(() => {
    if (!promo.open || !promo.member || promo.promotionType === "initiative") return
    const memberId = promo.member._id || promo.member.id || ""
    if (!memberId || !promo.date) return

    setPreview(p => ({ ...p, loading: true }))
    const t = localStorage.getItem("affiliate_token") || ""
    const params = new URLSearchParams({
      preview: "1",
      memberId,
      promotionType: promo.promotionType,
      refDate: promo.date,
    })
    fetch(`/api/affiliate/promotion?${params}`, { headers: { "x-auth-token": t } })
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setPreview({
            dep: json.dep, wit: json.wit, net: json.net, promoAmount: json.promoAmount,
            totalDeposit: json.totalDeposit ?? 0,
            maxInitiative: json.maxInitiative ?? 0,
            initiativeTiers: json.initiativeTiers ?? [],
            loading: false,
          })
        } else {
          setPreview(PREVIEW_EMPTY)
        }
      })
      .catch(() => setPreview(PREVIEW_EMPTY))
  }, [promo.open, promo.member, promo.promotionType, promo.date])

  async function applyPromotion() {
    if (!promo.member) return
    setPromo(p => ({ ...p, loading: true, result: null }))
    try {
      const t = localStorage.getItem("affiliate_token") || ""
      const body: Record<string, unknown> = {
        memberId:       promo.member._id || promo.member.id || "",
        memberUsername: promo.member.username,
        partnerId:      userId ? Number(userId) : undefined,
        partnerName:    promo.member.partnerName || refCode || "",
        refDate:        promo.date,
        note:           promo.note || null,
        promotionType:  promo.promotionType,
      }
      if (promo.promotionType === "initiative") {
        body.initiativeAmount = promo.initiativeAmount
      }
      const res = await fetch("/api/affiliate/promotion", {
        method: "POST",
        headers: { "x-auth-token": t, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      setPromo(p => ({ ...p, loading: false, result: { success: json.success, message: json.message } }))
    } catch {
      setPromo(p => ({ ...p, loading: false, result: { success: false, message: "Bağlantı hatası." } }))
    }
  }

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") || ""
    const u = localStorage.getItem("affiliate_user")
    setToken(t)
    if (u) {
      try {
        const parsed = JSON.parse(u)
        const id = parsed.affiliateId || parsed.id || parsed._id || ""
        const code = parsed.refCode || ""
        // Rolü localStorage yerine JWT payload'ından oku (manipülasyona karşı)
        let r = parsed.role || ""
        if (t) {
          try {
            const payload = JSON.parse(atob(t.split(".")[1]))
            if (payload.role) r = payload.role
          } catch {}
        }
        setUserId(id)
        setRefCode(code)
        setRole(r)
        fetchReferrals(id, t, code, r)
      } catch {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [])

  async function fetchReferrals(id: string, t: string, code?: string, r?: string) {
    const isAdmin = (r || role) === "admin" || (r || role) === "superadmin"
    if (!isAdmin && !id && !code) { setLoading(false); return }
    setLoading(true)
    try {
      // Admin: no refCode param → API returns all partners' referrals
      const param = isAdmin && !code
        ? `id=${encodeURIComponent(id)}`
        : code
        ? `refCode=${encodeURIComponent(code)}`
        : `id=${encodeURIComponent(id)}`
      const res = await fetch(`/api/affiliate/referrals?${param}`, {
        headers: { "x-auth-token": t },
      })
      const data = await res.json().catch(() => ({}))
      // Unwrap nested response shapes
      const raw =
        data?.data?.referrals ??
        data?.data?.users ??
        data?.data ??
        data?.referrals ??
        data?.users ??
        []
      setReferrals(toSafeArray<Referral>(raw))
    } catch {
      setReferrals([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo<Referral[]>(() => {
    const base = toSafeArray<Referral>(referrals)
    let list = [...base]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          (r.username ?? "").toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q) ||
          (r.name ?? "").toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      const av = (a[sortKey] ?? "") as string | number
      const bv = (b[sortKey] ?? "") as string | number
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return list
  }, [search, referrals, sortKey, sortDir])

  function toggleSort(key: keyof Referral) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function SortIcon({ col }: { col: keyof Referral }) {
    if (sortKey !== col) return <span className="text-muted-foreground/40">{"↕"}</span>
    return <span className="text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      {!loading && !refCode && !userId && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-warning">Oturum bilgisi eksik</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Lütfen çıkış yapıp tekrar giriş yapın.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-foreground">Referrallar</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ref kodunuzla kayıt olan tüm üyeler{" "}
            <span className="text-foreground font-medium">({filtered.length} üye)</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === "superadmin" && (
            <button
              onClick={() => setCryptoModal(p => ({ ...p, open: true, result: null }))}
              className="flex items-center gap-2 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              Manuel Kripto
            </button>
          )}
          <button
            onClick={() => fetchReferrals(userId, token, refCode, role)}
            disabled={loading || (!userId && !refCode)}
            className="flex items-center gap-2 px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Yenile
          </button>
        </div>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          type="text"
          placeholder="Kullanıcı adı, e-posta veya telefon ara..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="w-full bg-secondary border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
        />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <svg className="w-10 h-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
            <p className="text-sm text-muted-foreground">
              {search ? "Arama sonucu bulunamadı" : "Henüz referral üye yok"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("username")}
                  >
                    <span className="flex items-center gap-1.5">Kullanıcı Adı <SortIcon col="username"/></span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Telefon
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("depositTotal")}
                  >
                    <span className="flex items-center gap-1.5">Yatırım <SortIcon col="depositTotal"/></span>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none hidden lg:table-cell"
                    onClick={() => toggleSort("withdrawalTotal")}
                  >
                    <span className="flex items-center gap-1.5">Çekim <SortIcon col="withdrawalTotal"/></span>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none hidden lg:table-cell"
                    onClick={() => toggleSort("rivoBalance")}
                  >
                    <span className="flex items-center gap-1.5">
                      Bakiye
                      <SortIcon col="rivoBalance"/>
                    </span>
                  </th>
                  {(role === "admin" || role === "superadmin") && (
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("partnerName")}
                    >
                      <span className="flex items-center gap-1.5">Partner <SortIcon col="partnerName"/></span>
                    </th>
                  )}
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none hidden sm:table-cell"
                    onClick={() => toggleSort("createdAt")}
                  >
                    <span className="flex items-center gap-1.5">Kayıt Tarihi <SortIcon col="createdAt"/></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">
                    İşlem
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r, i) => (
                  <tr key={r._id || r.id || i} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary uppercase">{(r.username ?? "?")[0]}</span>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{r.username}</p>
                          {r.name && <p className="text-xs text-muted-foreground">{r.name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                      {r.phone || <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-success">
                        ₺{(r.depositTotal ?? 0).toLocaleString("tr-TR")}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-destructive font-medium">
                      ₺{(r.withdrawalTotal ?? 0).toLocaleString("tr-TR")}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="font-semibold text-foreground">
                        ₺{(r.rivoBalance ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    {(role === "admin" || role === "superadmin") && (
                      <td className="px-4 py-3">
                        {r.partnerName ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                            {r.partnerName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {role !== "affiliate_user" && (
                        <button
                          onClick={() => openPromo(r)}
                          className="px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors whitespace-nowrap"
                        >
                          Promosyon Ekle
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Promosyon Modal */}
      {promo.open && promo.member && (() => {
        // Periyot verileri server'dan gelir; initiative için preview kullanılmaz
        const { dep, wit, net, promoAmount } = preview
        const isInitiative = promo.promotionType === "initiative"
        const isAffiliateUser = role === "affiliate_user"
        const canApply = !isAffiliateUser && (isInitiative
          ? (promo.initiativeAmount !== null && promo.initiativeAmount > 0 && !!promo.date)
          : (promoAmount > 0 && !!promo.date && !preview.loading))

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closePromo}/>
            <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[92vh] overflow-y-auto">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
                <div>
                  <p className="font-bold text-foreground">{promo.member.username}</p>
                  {promo.member.name && <p className="text-xs text-muted-foreground">{promo.member.name}</p>}
                </div>
                <button onClick={closePromo} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              <div className="p-5 flex flex-col gap-5">

                {/* affiliate_user uyarısı */}
                {isAffiliateUser && (
                  <div className="bg-warning/10 border border-warning/30 rounded-xl px-4 py-3 flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                    </svg>
                    <p className="text-xs text-warning font-medium">Bu hesap Affiliate User rolündedir. Bonus ekleme ve insiyatif bonusu bu rol için pasiftir.</p>
                  </div>
                )}

                {/* ── Bölüm 1: Periyot Promosyonu ── */}
                <div className={isAffiliateUser ? "opacity-40 pointer-events-none select-none" : ""}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Periyot Promosyonu</p>

                  {/* Tip sekmeleri */}
                  <div className="grid grid-cols-3 gap-1.5 mb-4">
                    {(["daily","weekly","monthly"] as PromoType[]).map(t => (
                      <button
                        key={t}
                        onClick={() => setPromo(p => ({ ...p, promotionType: t, result: null }))}
                        className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                          promo.promotionType === t
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-secondary/40 text-muted-foreground border-border hover:border-primary/40"
                        }`}
                      >
                        {PROMO_LABELS[t]}
                      </button>
                    ))}
                  </div>

                  {/* Tarih — sekme üstünde göster ki her değişikte preview tetiklensin */}
                  {!isInitiative && (
                    <div className="flex gap-2 mb-4">
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground mb-1 block">Tarih</label>
                        <input type="date" value={promo.date} onChange={e => setPromo(p => ({ ...p, date: e.target.value, result: null }))}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"/>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground mb-1 block">Not (opsiyonel)</label>
                        <input type="text" value={promo.note} onChange={e => setPromo(p => ({ ...p, note: e.target.value }))} placeholder="Açıklama..."
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"/>
                      </div>
                    </div>
                  )}

                  {/* Stats — server-side periyot bazlı */}
                  {!isInitiative && (
                    <>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                        {[
                          { label: "Yatırım", val: dep, cls: "text-success" },
                          { label: "Çekim",   val: wit, cls: "text-destructive" },
                          { label: "Net",     val: net, cls: net > 0 ? "text-foreground" : "text-destructive" },
                        ].map(({ label, val, cls }) => (
                          <div key={label} className="bg-secondary/60 rounded-xl p-3 border border-border">
                            <p className="text-muted-foreground mb-1">{label}</p>
                            {preview.loading
                              ? <div className="h-4 w-12 mx-auto bg-muted animate-pulse rounded"/>
                              : <p className={`font-bold text-sm ${cls}`}>₺{val.toLocaleString("tr-TR")}</p>
                            }
                          </div>
                        ))}
                      </div>

                      <div className={`rounded-xl p-4 border flex items-center justify-between mb-3 transition-opacity ${preview.loading ? "opacity-50" : promoAmount > 0 ? "bg-primary/10 border-primary/30" : "bg-secondary/40 border-border opacity-60"}`}>
                        <div>
                          <p className="text-xs text-muted-foreground">%{PROMO_RATES[promo.promotionType]} Promosyon Tutarı</p>
                          {preview.loading
                            ? <div className="h-7 w-24 bg-muted animate-pulse rounded mt-1"/>
                            : <p className={`text-2xl font-bold mt-0.5 ${promoAmount > 0 ? "text-primary" : "text-muted-foreground"}`}>
                                ₺{promoAmount.toLocaleString("tr-TR")}
                              </p>
                          }
                        </div>
                        <svg className="w-9 h-9 text-primary/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                      </div>
                    </>
                  )}

                  {!isInitiative && (
                    <button onClick={applyPromotion} disabled={!canApply || promo.loading}
                      className="w-full py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {(promo.loading || preview.loading) && <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                      {preview.loading ? "Hesaplanıyor..." : promoAmount <= 0 ? "Bu periyotta işlem yok" : `₺${promoAmount.toLocaleString("tr-TR")} Promosyon Tanımla`}
                    </button>
                  )}
                </div>

                {/* Ayırıcı */}
                <div className="border-t border-border"/>

                {/* ── Bölüm 2: İnsiyatif Bonusu ─�� */}
                <div className={isAffiliateUser ? "opacity-40 pointer-events-none select-none" : ""}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">İnsiyatif Bonusu</p>
                  <p className="text-xs text-muted-foreground mb-3">Haftada 1 kez tanımlanabilir.</p>

                  {/* Toplam yatırım bilgisi */}
                  <div className="flex items-center justify-between mb-3 px-1">
                    <span className="text-xs text-muted-foreground">Toplam Yatırım</span>
                    {preview.loading
                      ? <div className="h-4 w-20 bg-muted animate-pulse rounded"/>
                      : <span className={`text-xs font-bold ${preview.totalDeposit > 0 ? "text-success" : "text-destructive"}`}>
                          ₺{preview.totalDeposit.toLocaleString("tr-TR")}
                        </span>
                    }
                  </div>

                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {(preview.initiativeTiers.length ? preview.initiativeTiers : [
                      { minDeposit: 5_000, amount: 500 },
                      { minDeposit: 10_000, amount: 1_000 },
                      { minDeposit: 15_000, amount: 1_500 },
                      { minDeposit: 20_000, amount: 2_000 },
                    ]).map(tier => {
                      const eligible = !preview.loading && preview.totalDeposit >= tier.minDeposit
                      const selected = promo.promotionType === "initiative" && promo.initiativeAmount === tier.amount
                      return (
                        <button
                          key={tier.amount}
                          disabled={!eligible}
                          onClick={() => setPromo(p => ({ ...p, promotionType: "initiative", initiativeAmount: p.initiativeAmount === tier.amount ? null : tier.amount, result: null }))}
                          className={`py-2.5 px-1 flex flex-col items-center rounded-xl border transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-secondary/40 text-foreground border-border hover:border-primary/40"
                          }`}
                        >
                          <span className="text-sm font-bold">₺{tier.amount.toLocaleString("tr-TR")}</span>
                          <span className={`text-[10px] mt-0.5 ${selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            min ₺{(tier.minDeposit / 1000).toFixed(0)}K
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {promo.promotionType === "initiative" && (
                    <div className="flex gap-2 mb-3">
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground mb-1 block">Tarih</label>
                        <input type="date" value={promo.date} onChange={e => setPromo(p => ({ ...p, date: e.target.value }))}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"/>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground mb-1 block">Not (opsiyonel)</label>
                        <input type="text" value={promo.note} onChange={e => setPromo(p => ({ ...p, note: e.target.value }))} placeholder="Açıklama..."
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"/>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={applyPromotion}
                    disabled={promo.promotionType !== "initiative" || !promo.initiativeAmount || !promo.date || promo.loading}
                    className="w-full py-2.5 text-sm font-bold bg-secondary text-foreground border border-border rounded-xl hover:border-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {promo.loading && promo.promotionType === "initiative" && <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                    {promo.initiativeAmount ? `₺${promo.initiativeAmount.toLocaleString("tr-TR")} İnsiyatif Bonusu Tanımla` : "Tutar Seçin"}
                  </button>
                </div>

                {/* Sonuç mesajı */}
                {promo.result && (
                  <div className={`text-sm rounded-xl px-4 py-2.5 ${promo.result.success ? "bg-success/10 text-success border border-success/20" : "bg-destructive/10 text-destructive border border-destructive/20"}`}>
                    {promo.result.message}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} / {filtered.length} üye
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                    p === page
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs bg-secondary border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors text-foreground"
            >
              Sonraki
            </button>
          </div>
        </div>
      )}

      {/* Manuel Kripto Deposit Modal */}
      {cryptoModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCryptoModal(p => ({ ...p, open: false }))}/>
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-amber-500/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-foreground">Manuel Kripto Yatırımı</p>
                  <p className="text-xs text-muted-foreground">TronScan veya diğer ağlardan</p>
                </div>
              </div>
              <button onClick={() => setCryptoModal(p => ({ ...p, open: false }))} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              {/* Kullanıcı Adı */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Kullanıcı Adı
                </label>
                <input
                  type="text"
                  value={cryptoModal.username}
                  onChange={e => setCryptoModal(p => ({ ...p, username: e.target.value }))}
                  placeholder="Kullanıcı adını girin..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* Tutar ve Ağ */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Tutar (TRY)
                  </label>
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
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Ağ
                  </label>
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

              {/* TX Hash */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  TX Hash <span className="text-muted-foreground font-normal">(opsiyonel)</span>
                </label>
                <input
                  type="text"
                  value={cryptoModal.txHash}
                  onChange={e => setCryptoModal(p => ({ ...p, txHash: e.target.value }))}
                  placeholder="TronScan, Etherscan vb. işlem hash'i..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors font-mono text-xs"
                />
              </div>

              {/* Not */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Not <span className="text-muted-foreground font-normal">(opsiyonel)</span>
                </label>
                <input
                  type="text"
                  value={cryptoModal.note}
                  onChange={e => setCryptoModal(p => ({ ...p, note: e.target.value }))}
                  placeholder="Ekleme sebebi..."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* Result */}
              {cryptoModal.result && (
                <div className={`px-4 py-3 rounded-xl text-sm ${
                  cryptoModal.result.success
                    ? "bg-success/10 text-success border border-success/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                }`}>
                  {cryptoModal.result.message}
                </div>
              )}

              {/* Buttons */}
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
