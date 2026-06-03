"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import Image from "next/image"

function useDarkMode() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    // Default is always light — only go dark if explicitly saved
    const stored = localStorage.getItem("theme")
    const isDark = stored === "dark"
    setDark(isDark)
    document.documentElement.classList.toggle("dark", isDark)
  }, [])
  function toggle() {
    const next = !dark
    setDark(next)
    localStorage.setItem("theme", next ? "dark" : "light")
    document.documentElement.classList.toggle("dark", next)
  }
  return { dark, toggle }
}

interface SessionUser {
  username: string
  name?: string
  role: "superadmin" | "admin" | "partner" | "affiliate_user"
  affiliateId?: string
}

const BASE_NAV = [
  {
    href: "/dashboard",
    label: "Genel Bakış",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/referrals",
    label: "Referrallar",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/deposits",
    label: "Depositler",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/tickets",
    label: "Biletler",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/bonus-analysis",
    label: "Üye Bonus Analizi",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
]

const ADMIN_NAV = [
  {
    href: "/dashboard/partners",
    label: "Tüm Partnerler",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/applications",
    label: "Başvurular",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
    ),
    superadminOnly: true,
  },
  {
    href: "/dashboard/commission",
    label: "Komisyon Ayarları",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
    ),
    superadminOnly: true,
  },
  {
    href: "/dashboard/create-partner",
    label: "Partner Oluştur",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
      </svg>
    ),
    superadminOnly: true,
  },
  {
    href: "/dashboard/transfer",
    label: "Affiliate Transfer",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
      </svg>
    ),
    superadminOnly: true,
  },
  {
    href: "/dashboard/bonus",
    label: "Bonus Yükle",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
    superadminOnly: true,
  },

  {
    href: "/dashboard/player-analysis",
    label: "Oyuncu Analizi",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
      </svg>
    ),
    superadminOnly: true,
  },
  {
    href: "/dashboard/promotion-logs",
    label: "Promosyon Geçmişi",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
    superadminOnly: true,
  },
  {
    href: "/dashboard/ip-analysis",
    label: "IP Analizi",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
    ),
    superadminOnly: true,
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const { dark, toggle: toggleDark } = useDarkMode()

  useEffect(() => {
    setMounted(true)
    const token = localStorage.getItem("affiliate_token")
    const userData = localStorage.getItem("affiliate_user")
    const adminBackup = sessionStorage.getItem("admin_backup_token")
    if (adminBackup) setIsImpersonating(true)

    if (!token || !userData) {
      router.push("/")
      return
    }

    try {
      setUser(JSON.parse(userData))
    } catch {
      localStorage.removeItem("affiliate_token")
      localStorage.removeItem("affiliate_user")
      router.push("/")
    }
  }, [])

  function handleLogout() {
    localStorage.removeItem("affiliate_token")
    localStorage.removeItem("affiliate_user")
    sessionStorage.removeItem("admin_backup_token")
    sessionStorage.removeItem("admin_backup_user")
    router.push("/")
  }

  function handleReturnToAdmin() {
    const adminToken = sessionStorage.getItem("admin_backup_token")
    const adminUser = sessionStorage.getItem("admin_backup_user")
    if (!adminToken || !adminUser) return
    localStorage.setItem("affiliate_token", adminToken)
    localStorage.setItem("affiliate_user", adminUser)
    sessionStorage.removeItem("admin_backup_token")
    sessionStorage.removeItem("admin_backup_user")
    setIsImpersonating(false)
    router.push("/dashboard/partners")
  }

  if (!mounted) return null

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-screen z-30 w-60 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200 lg:translate-x-0 lg:static lg:h-auto lg:self-stretch lg:z-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-center px-5 py-5 border-b border-sidebar-border">
          <Image
            src="/powered_by.svg"
            alt="Logo"
            width={140}
            height={62}
            className="object-contain"
            style={{ width: "140px", height: "auto" }}
            priority
          />
        </div>

        {/* User Badge */}
        {user && (
          <div className="px-3 pt-3">
            <div className="bg-sidebar-accent rounded-xl border border-sidebar-border px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary uppercase">
                    {(user.name || user.username)[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-sidebar-foreground truncate">
                    {user.name || user.username}
                  </p>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${
                    user.role === "admin"
                      ? "bg-warning/15 text-warning"
                      : "bg-primary/15 text-primary"
                  }`}>
                    {user.role === "admin" ? "Admin" : "Partner"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
            Menü
          </p>
          {(user?.role === "admin" || user?.role === "superadmin" ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV).map((item: any) => {
            // Skip superadminOnly items if user is not superadmin
            if (item.superadminOnly && user?.role !== "superadmin") return null
            // Show partnerAllowed items to all roles (partner included)
            if (item.partnerAllowed) return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            )
            
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <span className={isActive ? "text-primary" : "text-muted-foreground"}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Çıkış Yap
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden lg:ml-0">
        {/* Top bar */}
        <header className="h-14 border-b border-border bg-card/80 backdrop-blur-sm flex items-center px-4 gap-3 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            aria-label="Menüyü aç"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="flex-1" />
          {/* Dark mode toggle */}
          <button
            onClick={toggleDark}
            className="p-1.5 rounded-lg border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Tema değiştir"
          >
            {dark ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
              </svg>
            )}
          </button>
          {user && (
            <div className="flex items-center gap-2.5">
              <span className="text-sm text-muted-foreground hidden sm:block">
                {user.name || user.username}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                user.role === "admin"
                  ? "bg-warning/15 text-warning border border-warning/20"
                  : "bg-primary/15 text-primary border border-primary/20"
              }`}>
                {user.role === "admin" ? "Admin" : "Partner"}
              </span>
              <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
                <span className="text-xs font-bold text-primary uppercase">
                  {(user.name || user.username)[0]}
                </span>
              </div>
            </div>
          )}
        </header>

        {/* Impersonation banner */}
        {isImpersonating && (
          <div className="bg-warning/15 border-b border-warning/30 px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-warning font-medium">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
              </svg>
              <span>Admin olarak <strong>{user?.name || user?.username}</strong> panelini görüntülüyorsunuz</span>
            </div>
            <button
              onClick={handleReturnToAdmin}
              className="flex items-center gap-1.5 text-xs bg-warning text-warning-foreground px-3 py-1.5 rounded-lg font-semibold hover:bg-warning/90 transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>
              </svg>
              Admin Paneline Dön
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
