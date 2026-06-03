"use client"

import { useState, useEffect, Suspense } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sessionRefreshed, setSessionRefreshed] = useState(false)

  const [regForm, setRegForm] = useState({ username: "", password: "", confirmPassword: "", name: "", email: "", websiteUrl: "", country: "", currency: "", telegram: "", teams: "" })
  const [regError, setRegError] = useState("")
  const [regSuccess, setRegSuccess] = useState(false)
  const [regLoading, setRegLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get("reason") === "session_refresh") {
      setSessionRefreshed(true)
      return
    }
    // If already logged in, go to dashboard
    const token = localStorage.getItem("affiliate_token")
    const userData = localStorage.getItem("affiliate_user")
    if (token && userData) {
      router.replace("/dashboard")
    }
  }, [searchParams, router])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setRegError("")
    if (regForm.password !== regForm.confirmPassword) {
      setRegError("Şifreler eşleşmiyor.")
      return
    }
    if (regForm.password.length < 6) {
      setRegError("Şifre en az 6 karakter olmalıdır.")
      return
    }
    setRegLoading(true)
    try {
      const res = await fetch("/api/affiliate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: regForm.username,
          password: regForm.password,
          name: regForm.name,
          email: regForm.email,
          websiteUrl: regForm.websiteUrl,
          country: regForm.country,
          currency: regForm.currency,
          telegram: regForm.telegram,
          teams: regForm.teams,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setRegError(data.message || "Bir hata oluştu.")
      } else {
        setRegSuccess(true)
        setRegForm({ username: "", password: "", confirmPassword: "", name: "", email: "", websiteUrl: "", country: "", currency: "", telegram: "", teams: "" })
      }
    } catch {
      setRegError("Sunucuya bağlanılamadı.")
    } finally {
      setRegLoading(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/affiliate/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setError(data.message || "Kullanıcı adı veya şifre hatalı.")
        setLoading(false)
        return
      }

      localStorage.setItem("affiliate_token", data.token)
      localStorage.setItem("affiliate_user", JSON.stringify(data.user))
      if (rememberMe) localStorage.setItem("affiliate_remember", "true")
      router.push("/dashboard")
    } catch {
      setError("Sunucuya bağlanılamadı. Lütfen tekrar deneyin.")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black tracking-widest text-[#0a0f1a] uppercase select-none">
              VELO<span className="text-[#00d4b4]">BET</span>
            </h1>
            <p className="text-xs text-gray-400 tracking-[0.3em] mt-1 uppercase">Affiliate Panel</p>
          </div>

          {sessionRefreshed && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              Oturum yenilendi — lütfen tekrar giriş yapın.
            </div>
          )}

          {/* Login Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 md:p-8 relative">
            {/* Close button */}
            <button className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>

            {/* Tabs */}
            <div className="flex items-center gap-2 mb-8">
              <button
                onClick={() => setActiveTab("login")}
                className={`text-lg font-semibold transition-colors ${
                  activeTab === "login" ? "text-[#00d4b4]" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Oturum Aç
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setActiveTab("register")}
                className={`text-lg font-semibold transition-colors ${
                  activeTab === "register" ? "text-[#00d4b4]" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Kayıt
              </button>
            </div>

            {activeTab === "login" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-8">
                {/* Username */}
                <div>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    required
                    placeholder="Kullanıcı Adı *"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-3 text-gray-900 text-base placeholder:text-gray-400 placeholder:text-sm focus:outline-none focus:border-[#00d4b4] transition-colors"
                  />
                </div>

                {/* Password */}
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder="Şifre *"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-3 pr-10 text-gray-900 text-base placeholder:text-gray-400 placeholder:text-sm focus:outline-none focus:border-[#00d4b4] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      </svg>
                    )}
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {/* Remember me & Forgot password */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        rememberMe ? "bg-[#00d4b4] border-[#00d4b4]" : "border-gray-300"
                      }`}>
                        {rememberMe && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                          </svg>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-gray-700">Beni Hatırla</span>
                  </label>
                  <button type="button" className="text-sm text-[#00d4b4] hover:text-[#00b89c] transition-colors">
                    Şifremi Unuttum?
                  </button>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 bg-[#00d4b4] hover:bg-[#00b89c] text-white font-semibold rounded-xl py-3 text-sm uppercase tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 w-fit px-8"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Giriş yapılıyor...
                    </>
                  ) : (
                    "OTURUM AÇ"
                  )}
                </button>
              </form>
            ) : null}

            {activeTab === "register" && (regSuccess ? (
              <div className="py-8 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <p className="text-base font-semibold text-gray-800">Başvurunuz Alındı!</p>
                <p className="text-sm text-gray-500">Yönetici başvurunuzu inceledikten sonra giriş yapabileceksiniz.</p>
                <button
                  onClick={() => { setRegSuccess(false); setActiveTab("login") }}
                  className="text-sm text-[#00d4b4] hover:underline"
                >
                  Giriş sayfasına dön
                </button>
              </div>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      required
                      placeholder="Kullanıcı Adı *"
                      value={regForm.username}
                      onChange={(e) => setRegForm(p => ({ ...p, username: e.target.value }))}
                      className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                    />
                  </div>
                  <div>
                    <select
                      value={regForm.country}
                      onChange={(e) => setRegForm(p => ({ ...p, country: e.target.value }))}
                      className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors appearance-none"
                    >
                      <option value="">Ülke</option>
                      <option value="TR">Türkiye</option>
                      <option value="DE">Almanya</option>
                      <option value="GB">Birleşik Krallık</option>
                      <option value="US">Amerika Birleşik Devletleri</option>
                      <option value="OTHER">Diğer</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      required
                      type="password"
                      placeholder="Şifre *"
                      value={regForm.password}
                      onChange={(e) => setRegForm(p => ({ ...p, password: e.target.value }))}
                      className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                    />
                  </div>
                  <div>
                    <select
                      value={regForm.currency}
                      onChange={(e) => setRegForm(p => ({ ...p, currency: e.target.value }))}
                      className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors appearance-none"
                    >
                      <option value="">Para Birimi</option>
                      <option value="TRY">TRY — Türk Lirası</option>
                      <option value="USD">USD — Amerikan Doları</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="GBP">GBP — Sterlin</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      required
                      type="password"
                      placeholder="Şifreyi Onayla *"
                      value={regForm.confirmPassword}
                      onChange={(e) => setRegForm(p => ({ ...p, confirmPassword: e.target.value }))}
                      className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                    />
                  </div>
                  <div>
                    <input
                      placeholder="Ad Soyad"
                      value={regForm.name}
                      onChange={(e) => setRegForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <input
                    placeholder="Website URL *"
                    value={regForm.websiteUrl}
                    onChange={(e) => setRegForm(p => ({ ...p, websiteUrl: e.target.value }))}
                    className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                  />
                </div>

                <div>
                  <input
                    required
                    type="email"
                    placeholder="E-Mail *"
                    value={regForm.email}
                    onChange={(e) => setRegForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full bg-transparent border-0 border-b border-gray-300 px-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                  />
                </div>

                {/* İletişim alanları */}
                <div className="pt-1">
                  <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider font-medium">İletişim Bilgileri</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L6.54 14.4l-2.95-.924c-.641-.2-.654-.641.136-.953l11.57-4.461c.537-.194 1.006.131.266.186z"/>
                        </svg>
                      </span>
                      <input
                        placeholder="Telegram kullanıcı adı"
                        value={regForm.telegram}
                        onChange={(e) => setRegForm(p => ({ ...p, telegram: e.target.value }))}
                        className="w-full bg-transparent border-0 border-b border-gray-300 pl-6 pr-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                      />
                    </div>
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.625 0H3.375C1.511 0 0 1.511 0 3.375v17.25C0 22.489 1.511 24 3.375 24h17.25C22.489 24 24 22.489 24 20.625V3.375C24 1.511 22.489 0 20.625 0zM7.5 18.75H4.875V9.375H7.5V18.75zm-1.313-10.64a1.52 1.52 0 110-3.04 1.52 1.52 0 010 3.04zm13.188 10.64h-2.625v-4.594c0-.98-.017-2.243-1.366-2.243-1.368 0-1.578 1.068-1.578 2.172v4.665h-2.625V9.375h2.52v1.155h.035c.352-.664 1.21-1.365 2.49-1.365 2.663 0 3.154 1.753 3.154 4.031l-.005 5.554z"/>
                        </svg>
                      </span>
                      <input
                        placeholder="Teams / LinkedIn"
                        value={regForm.teams}
                        onChange={(e) => setRegForm(p => ({ ...p, teams: e.target.value }))}
                        className="w-full bg-transparent border-0 border-b border-gray-300 pl-6 pr-0 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00d4b4] transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {regError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    {regError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={regLoading}
                  className="mt-1 bg-[#00d4b4] hover:bg-[#00b89c] text-white font-bold rounded-full py-3 text-sm uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {regLoading ? (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : "KAYIT"}
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-[#0a0f1a] py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <p className="text-gray-400 text-xs">
            © 2026 AFFİLİATES. TÜM HAKLARI SAKLIDIR.
          </p>
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-[#00d4b4] flex items-center justify-center">
              <span className="text-[#00d4b4] text-xs font-bold">18+</span>
            </div>
            <Image
              src="/powered_by.svg"
              alt="Powered by EveryMatrix"
              width={111}
              height={49}
              className="object-contain"
            />
          </div>
        </div>
      </footer>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
