"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

export default function CreatePartnerPage() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    refCode: "",
    shortLink: "",
    commissionRate: 10,
    commissionType: "deposit" as "deposit" | "net",
    role: "partner" as "partner" | "affiliate_user",
  })

  useEffect(() => {
    const t = localStorage.getItem("affiliate_token")
    const u = localStorage.getItem("affiliate_user")
    if (!t || !u) { router.push("/"); return }
    try {
      const parsed = JSON.parse(u)
      if (parsed.role !== "admin" && parsed.role !== "superadmin") {
        router.push("/dashboard")
        return
      }
      setIsSuperAdmin(parsed.role === "superadmin")
      setToken(t)
    } catch {
      router.push("/")
    }
  }, [router])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: name === "commissionRate" ? Number(value) : value,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSuccess(false)

    if (!form.username.trim() || !form.password.trim() || !form.refCode.trim()) {
      setError("Kullanıcı adı, şifre ve ref kodu zorunludur.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/affiliate/create-partner", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.success) {
        setError("İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.")
      } else {
        setSuccess(true)
        setForm({ username: "", password: "", name: "", refCode: "", shortLink: "", commissionRate: 10, commissionType: "deposit" })
      }
    } catch {
      setError("İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Partner Oluştur</h1>
        <p className="text-sm text-muted-foreground mt-1">Yeni bir affiliate partner hesabı oluşturun</p>
      </div>

      {/* Form card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Ad Soyad</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Örn: Ebru Çelik"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Kullanıcı Adı <span className="text-destructive">*</span>
            </label>
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Örn: ebru"
              autoComplete="off"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Şifre <span className="text-destructive">*</span>
            </label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Güçlü bir şifre girin"
              autoComplete="new-password"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Ref Code */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Ref Kodu <span className="text-destructive">*</span>
            </label>
            <input
              name="refCode"
              value={form.refCode}
              onChange={handleChange}
              placeholder="Örn: ebrukod"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Kayıt linki: <span className="font-mono text-foreground">bizzocasino168.com/register?a={form.refCode || "..."}</span>
            </p>
          </div>

          {/* Short Link */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Kısa Link <span className="text-muted-foreground font-normal text-xs">(opsiyonel)</span></label>
            <input
              name="shortLink"
              value={form.shortLink}
              onChange={handleChange}
              placeholder="Örn: https://kisa.link/ebru"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
            <p className="text-xs text-muted-foreground">Partner panelinde kopyalanabilir kısa link olarak gösterilir.</p>
          </div>

          {/* Rol — sadece superadmin görebilir */}
          {isSuperAdmin && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Rol</label>
              <div className="flex gap-2">
                {(["partner", "affiliate_user"] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, role: r }))}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      form.role === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r === "partner" ? "Partner" : "Affiliate User"}
                  </button>
                ))}
              </div>
              {form.role === "affiliate_user" && (
                <p className="text-xs text-muted-foreground bg-warning/10 border border-warning/20 rounded-lg px-3 py-2 mt-1">
                  Affiliate User rolünde bonus ekleme ve insiyatif bonusu özellikleri pasif olacaktır.
                </p>
              )}
            </div>
          )}

          {/* Commission Rate + Type side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Komisyon Oranı (%)</label>
              <input
                name="commissionRate"
                type="number"
                min={1}
                max={100}
                value={form.commissionRate}
                onChange={handleChange}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Komisyon Tipi</label>
              <select
                name="commissionType"
                value={form.commissionType}
                onChange={handleChange}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              >
                <option value="deposit">Deposit Bazlı</option>
                <option value="net">Net Kazanç</option>
              </select>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-destructive flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
              </svg>
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">Partner başarıyla oluşturuldu!</p>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Oluşturuluyor...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
                  </svg>
                  Partner Oluştur
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard/partners")}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors"
            >
              Partnerlere Git
            </button>
          </div>
        </form>
      </div>

      {/* Info card */}
      <div className="bg-primary/5 border border-primary/15 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <svg className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Partner oluşturulunca ne olur?</p>
            <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed">
              <li>Partner Neon veritabanına kaydedilir ve hemen giriş yapabilir.</li>
              <li>Ref kodu ile kayıt olan üyeler otomatik bu partnere bağlanır.</li>
              <li>Partner kendi panelinde referral ve deposit istatistiklerini görebilir.</li>
              <li><span className="text-foreground font-medium">Affiliate User</span> rolünde bonus ekleme ve insiyatif bonusu özellikleri pasif olur.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
