"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"

interface BonusLog {
  id: number
  added_by: string
  target_username: string
  amount: number
  old_balance: number
  new_balance: number
  tx_uuid: string
  note: string | null
  created_at: string
}

interface BonusResult {
  username: string
  oldBalance: number
  newBalance: number
  txUuid: string
  amount: number
}

export default function BonusPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<BonusResult | null>(null)
  const [logs, setLogs] = useState<BonusLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [token, setToken] = useState("")

  useEffect(() => {
    const raw = localStorage.getItem("affiliate_user")
    const t = localStorage.getItem("affiliate_token") ?? ""
    setToken(t)
    if (!raw) { router.push("/"); return }
    try {
      const parsed = JSON.parse(raw)
      if (parsed.role !== "superadmin") router.push("/dashboard")
    } catch {
      router.push("/")
    }
  }, [router])

  const fetchLogs = useCallback(async (t: string) => {
    setLogsLoading(true)
    try {
      const res = await fetch("/api/affiliate/bonus?limit=50", {
        headers: { Authorization: `Bearer ${t}` },
      })
      const data = await res.json()
      if (data.success) {
        setLogs(data.logs ?? [])
        setTotal(data.total ?? 0)
      }
    } catch {
      // silent
    }
    setLogsLoading(false)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token") ?? ""
    if (t) fetchLogs(t)
  }, [fetchLogs])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setResult(null)

    const parsedAmount = parseFloat(amount.replace(/,/g, "."))
    if (!username.trim()) { setError("Kullanıcı adı zorunludur."); return }
    if (isNaN(parsedAmount) || parsedAmount <= 0) { setError("Geçerli bir tutar giriniz."); return }
    if (parsedAmount > 50000) { setError("Maksimum bonus tutarı 50.000₺'dir."); return }

    setLoading(true)
    try {
      const t = localStorage.getItem("affiliate_token") ?? token
      const res = await fetch("/api/affiliate/bonus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ username: username.trim(), amount: parsedAmount, note: note.trim() }),
      })
      const data = await res.json()

      if (!data.success) {
        setError("İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.")
        setLoading(false)
        return
      }

      setResult({
        username: data.username || username.trim(),
        oldBalance: data.oldBalance,
        newBalance: data.newBalance,
        txUuid: data.txUuid,
        amount: parsedAmount,
      })
  setUsername("")
  setNote("")
      // Refresh logs from Neon
      await fetchLogs(t)
    } catch {
      setError("Sunucuya bağlanılamadı.")
    }
    setLoading(false)
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bonus Yükle</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Kullanıcıya Rivo bakiyesi olarak bonus yükler, transaction oluşturur ve kalıcı olarak kaydeder.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Form */}
        <div className="space-y-5">
          <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
            <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide text-muted-foreground">Bonus Formu</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Kullanıcı Adı</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="örn: ahmetmehmet"
                  autoComplete="off"
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Tutar</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">₺</span>
                  <input
                    type="number"
                    min={1}
                    max={50000}
                    step={1}
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="1 - 50.000"
                    className="w-full bg-background border border-border rounded-xl pl-8 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Not <span className="text-muted-foreground font-normal">(opsiyonel)</span>
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Bonus sebebi..."
                  rows={2}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors resize-none"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl py-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Yükleniyor...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                    </svg>
                    Bonus Yükle
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Success Result */}
          {result && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <span className="font-semibold text-foreground">Bonus başarıyla yüklendi</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 text-sm">
                <div className="bg-background/60 rounded-xl px-4 py-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Kullanıcı</p>
                  <p className="font-semibold text-foreground">{result.username}</p>
                </div>
                <div className="bg-background/60 rounded-xl px-4 py-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Yüklenen</p>
                  <p className="font-semibold text-green-500">+₺{result.amount.toLocaleString("tr-TR")}</p>
                </div>
                <div className="bg-background/60 rounded-xl px-4 py-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Önceki Bakiye</p>
                  <p className="font-medium text-foreground">₺{Number(result.oldBalance).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-background/60 rounded-xl px-4 py-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Yeni Bakiye</p>
                  <p className="font-semibold text-foreground">₺{Number(result.newBalance).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground font-mono break-all">TX: {result.txUuid}</p>
            </div>
          )}
        </div>

        {/* Right — Permanent History */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-foreground text-sm">İşlem Geçmişi</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Toplam {total} kayıt</p>
            </div>
            <button
              onClick={() => fetchLogs(localStorage.getItem("affiliate_token") ?? "")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Yenile
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {logsLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Yükleniyor...
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                </svg>
                <p className="text-sm">Henüz bonus işlemi yok</p>
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">{log.target_username}</span>
                        {log.note && (
                          <span className="text-xs text-muted-foreground bg-muted rounded-md px-1.5 py-0.5 truncate max-w-[120px]" title={log.note}>
                            {log.note}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(log.created_at)}
                        </span>
                        <span className="text-muted-foreground/40 text-xs">·</span>
                        <span className="text-xs text-muted-foreground">
                          Ekleyen: <span className="text-foreground font-medium">{log.added_by}</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-green-500">+₺{Number(log.amount).toLocaleString("tr-TR")}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ₺{Number(log.old_balance).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                        {" → "}
                        ₺{Number(log.new_balance).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
