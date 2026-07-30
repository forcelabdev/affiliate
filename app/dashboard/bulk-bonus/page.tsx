"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"

interface BulkResult {
  processed: number
  processedUsers: string[]
  notFound: string[]
  skippedLastBonus: string[]
  skippedNotPartnerMember: string[]
  amount: number
  bonusType: string
}

export default function BulkBonusPage() {
  const router = useRouter()
  const [token, setToken] = useState("")

  // Form
  const [usernames, setUsernames]         = useState("")
  const [amount, setAmount]               = useState("")
  const [bonusType, setBonusType]         = useState("Genel Bonus")
  const [note, setNote]                   = useState("")
  const [wagerReq, setWagerReq]           = useState("")
  const [minDeposit, setMinDeposit]       = useState("")
  const [minWithdraw, setMinWithdraw]     = useState("")

  // State
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState("")
  const [result, setResult]               = useState<BulkResult | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const raw = localStorage.getItem("affiliate_user")
    const t   = localStorage.getItem("affiliate_token") ?? ""
    setToken(t)
    if (!raw) { router.push("/"); return }
    try {
      const parsed = JSON.parse(raw)
      if (parsed.role !== "superadmin") router.push("/dashboard")
    } catch { router.push("/") }
  }, [router])

  const usernameCount = usernames.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length

  const handleSubmit = useCallback(async () => {
    setError("")
    setResult(null)

    const names = usernames.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (names.length === 0) { setError("En az bir kullanıcı adı girin."); return }
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError("Geçerli bir tutar girin."); return }

    setLoading(true)
    try {
      const res = await fetch("/api/affiliate/bonus/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({
          usernames: names,
          amount: amt,
          bonusType: bonusType || "Genel Bonus",
          note,
          wagerRequirement: wagerReq ? parseFloat(wagerReq) : 0,
          minDeposit:       minDeposit ? parseFloat(minDeposit) : 0,
          minWithdraw:      minWithdraw ? parseFloat(minWithdraw) : 0,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setResult(json)
        setUsernames("")
      } else {
        setError(json.message ?? "Bir hata oluştu.")
      }
    } catch (e) {
      setError("Sunucu bağlantı hatası.")
    } finally {
      setLoading(false)
    }
  }, [token, usernames, amount, bonusType, note, wagerReq, minDeposit, minWithdraw])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Toplu Bonus Yükle</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Birden fazla üyeye aynı anda bonus ekleyin. Kullanıcı adlarını virgül veya alt satır ile ayırın.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Username list */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Kullanıcı Adları</h2>
            {usernameCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {usernameCount} kullanıcı
              </span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={usernames}
            onChange={e => setUsernames(e.target.value)}
            placeholder={"kullanici1\nkullanici2\nkullanici3"}
            rows={14}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="text-xs text-muted-foreground">
            Her satıra bir kullanıcı adı veya virgülle ayırabilirsiniz. Maksimum 500 kullanıcı.
          </p>
        </div>

        {/* Right — Bonus settings */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Bonus Ayarları</h2>

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tutar (₺)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="500"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Bonus Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Bonus Türü</label>
              <input
                type="text"
                value={bonusType}
                onChange={e => setBonusType(e.target.value)}
                placeholder="Genel Bonus"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Not (opsiyonel)</label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Kampanya notunu girin..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Conditions row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Çevrim (x)</label>
                <input
                  type="number" min="0" step="0.5"
                  value={wagerReq}
                  onChange={e => setWagerReq(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Min. Yatırım</label>
                <input
                  type="number" min="0"
                  value={minDeposit}
                  onChange={e => setMinDeposit(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Min. Çekim</label>
                <input
                  type="number" min="0"
                  value={minWithdraw}
                  onChange={e => setMinWithdraw(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || usernameCount === 0 || !amount}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "İşleniyor..." : `${usernameCount > 0 ? usernameCount + " kullanıcıya" : "Kullanıcılara"} Bonus Yükle`}
          </button>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <h2 className="text-sm font-semibold text-foreground">
              {result.processed} kullanıcıya ₺{result.amount.toLocaleString("tr-TR")} bonus eklendi
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Processed */}
            {result.processedUsers.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                <p className="text-xs font-medium text-green-500">Eklendi ({result.processedUsers.length})</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {result.processedUsers.map(u => (
                    <p key={u} className="text-xs font-mono text-foreground">{u}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Skipped last bonus */}
            {result.skippedLastBonus?.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                <p className="text-xs font-medium text-yellow-500">Son işlemi bonus ({result.skippedLastBonus.length})</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {result.skippedLastBonus.map(u => (
                    <p key={u} className="text-xs font-mono text-muted-foreground">{u}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Not found */}
            {result.notFound?.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                <p className="text-xs font-medium text-destructive">Bulunamadı ({result.notFound.length})</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {result.notFound.map(u => (
                    <p key={u} className="text-xs font-mono text-muted-foreground">{u}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
