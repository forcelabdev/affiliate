"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

interface Partner {
  username: string
  name: string
  affiliateId: string
  commissionRate: number
  commissionType: "deposit" | "net"
}

export default function CommissionPage() {
  const router = useRouter()
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { rate: string; type: "deposit" | "net" }>>({})
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [token, setToken] = useState("")

  useEffect(() => {
    const userData = localStorage.getItem("affiliate_user")
    const t = localStorage.getItem("affiliate_token") || ""
    setToken(t)
    if (!userData) { router.push("/"); return }
    try {
      const u = JSON.parse(userData)
      if (u.role !== "admin") { router.push("/dashboard"); return }
    } catch {
      router.push("/")
      return
    }
    fetchPartners(t)
  }, [router])

  async function fetchPartners(t: string) {
    setLoading(true)
    try {
      const res = await fetch("/api/affiliate/commission", { headers: { "x-auth-token": t } })
      const json = await res.json().catch(() => ({}))
      const list: Partner[] = Array.isArray(json.partners) ? json.partners : []
      setPartners(list)
      // Initialize edit state
      const init: Record<string, { rate: string; type: "deposit" | "net" }> = {}
      list.forEach((p) => {
        init[p.username] = { rate: String(p.commissionRate), type: p.commissionType }
      })
      setEdits(init)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function saveCommission(username: string) {
    const edit = edits[username]
    if (!edit) return
    const rate = parseFloat(edit.rate)
    if (isNaN(rate) || rate < 0 || rate > 100) return

    setSaving(username)
    try {
      const res = await fetch("/api/affiliate/commission", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({ username, commissionRate: rate, commissionType: edit.type }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.success) {
        setSuccessMsg(`${username} için komisyon güncellendi.`)
        setTimeout(() => setSuccessMsg(null), 3000)
        // Update local list
        setPartners((prev) =>
          prev.map((p) => p.username === username ? { ...p, commissionRate: rate, commissionType: edit.type } : p)
        )
      }
    } finally {
      setSaving(null)
    }
  }

  function updateEdit(username: string, field: "rate" | "type", value: string) {
    setEdits((prev) => ({
      ...prev,
      [username]: {
        ...prev[username],
        [field]: value,
      },
    }))
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-foreground">Komisyon Ayarları</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Her partner için komisyon oranı ve hesaplama yöntemi belirleyin
        </p>
      </div>

      {/* Success message */}
      {successMsg && (
        <div className="bg-success/10 border border-success/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          <p className="text-sm text-success">{successMsg}</p>
        </div>
      )}

      {/* Info box */}
      <div className="bg-secondary border border-border rounded-xl p-4 flex items-start gap-3">
        <svg className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10"/>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4M12 8h.01"/>
        </svg>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Komisyon Hesaplama Yöntemleri</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Deposit bazlı:</span> Komisyon = Toplam Deposit × Oran
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Net kazanç bazlı:</span> Komisyon = (Toplam Deposit − Toplam Çekim) × Oran
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Not: Runtime değişiklikler sunucu yeniden başlayana kadar geçerlidir. Kalıcı ayar için <code className="bg-muted px-1 rounded text-xs">AFFILIATE_USERS</code> env değişkenini güncelleyin.
          </p>
        </div>
      </div>

      {/* Partners table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : partners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <svg className="w-10 h-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197"/>
            </svg>
            <p className="text-sm text-muted-foreground">Partner bulunamadı. AFFILIATE_USERS env değişkenini kontrol edin.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Partner</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Affiliate ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Oran (%)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Yöntem</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Önizleme</th>
                  <th className="px-4 py-3"/>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => {
                  const edit = edits[p.username] || { rate: String(p.commissionRate), type: p.commissionType }
                  const previewRate = parseFloat(edit.rate) || 0
                  const previewDeposit = 10000
                  const previewCommission = previewDeposit * (previewRate / 100)
                  const isSaving = saving === p.username

                  return (
                    <tr key={p.username} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                      {/* Partner */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-primary uppercase">{p.name[0]}</span>
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{p.name}</p>
                            <p className="text-xs text-muted-foreground">@{p.username}</p>
                          </div>
                        </div>
                      </td>
                      {/* Affiliate ID */}
                      <td className="px-4 py-4 hidden sm:table-cell">
                        <span className="font-mono text-xs bg-secondary px-2 py-1 rounded border border-border text-muted-foreground">
                          {p.affiliateId || "—"}
                        </span>
                      </td>
                      {/* Rate input */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={edit.rate}
                            onChange={(e) => updateEdit(p.username, "rate", e.target.value)}
                            className="w-20 bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                          />
                          <span className="text-muted-foreground text-sm">%</span>
                        </div>
                      </td>
                      {/* Type select */}
                      <td className="px-4 py-4">
                        <select
                          value={edit.type}
                          onChange={(e) => updateEdit(p.username, "type", e.target.value)}
                          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                        >
                          <option value="deposit">Deposit Bazlı</option>
                          <option value="net">Net Kazanç Bazlı</option>
                        </select>
                      </td>
                      {/* Preview */}
                      <td className="px-4 py-4">
                        <div className="text-xs text-muted-foreground">
                          <span>₺10.000 üzerinden:</span>
                          <span className="ml-1.5 font-semibold text-success">
                            ₺{previewCommission.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </td>
                      {/* Save */}
                      <td className="px-4 py-4">
                        <button
                          onClick={() => saveCommission(p.username)}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {isSaving ? (
                            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                          )}
                          Kaydet
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
