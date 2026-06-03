"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"

interface User {
  _id: string
  username: string
  rank?: string
  createdAt?: string
}

interface Partner {
  _id: string | number
  username: string
  name?: string
}

interface TransferLog {
  id: number
  fromUsername: string
  toPartnerUsername: string
  performedBy: string
  status: string
  timestamp: string
  reason?: string
}

export default function TransferPage() {
  const router = useRouter()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [logs, setLogs] = useState<TransferLog[]>([])
  const [activeTab, setActiveTab] = useState<"transfer" | "logs">("transfer")
  const [selectedUser, setSelectedUser] = useState<string>("")
  const [selectedPartner, setSelectedPartner] = useState<string>("")
  const [loadingData, setLoadingData] = useState(true)
  const [transferLoading, setTransferLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [searchUser, setSearchUser] = useState("")
  const [searchPartner, setSearchPartner] = useState("")

  const loadData = useCallback(async () => {
    const token = localStorage.getItem("affiliate_token")
    if (!token) return
    setLoadingData(true)
    try {
      const [usersRes, partnersRes, logsRes] = await Promise.all([
        fetch("/api/affiliate/unassigned-users", { headers: { "x-auth-token": token } }),
        fetch("/api/affiliate/partners-list", { headers: { "x-auth-token": token } }),
        fetch("/api/affiliate/transfer-logs", { headers: { "x-auth-token": token } }),
      ])
      const [usersData, partnersData, logsData] = await Promise.all([
        usersRes.json(),
        partnersRes.json(),
        logsRes.json(),
      ])
      if (usersData.success) setUsers(usersData.data || [])
      if (partnersData.success) setPartners(partnersData.data || [])
      if (logsData.success) setLogs(logsData.data || [])
    } catch (err) {
      console.error("[v0] Load error:", err)
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem("affiliate_user")
    if (!raw) { router.push("/"); return }
    try {
      const userData = JSON.parse(raw)
      if (userData.role !== "superadmin") { router.push("/dashboard"); return }
      setIsSuperAdmin(true)
      loadData()
    } catch {
      router.push("/")
    }
  }, [router, loadData])

  const handleTransfer = async () => {
    if (!selectedUser || !selectedPartner) {
      setMessage({ type: "error", text: "Lütfen kullanıcı ve partner seçin." })
      return
    }
    setTransferLoading(true)
    setMessage(null)
    try {
      const token = localStorage.getItem("affiliate_token") || ""
      const res = await fetch("/api/affiliate/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({ userId: selectedUser, partnerId: selectedPartner }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: "success", text: data.message })
        setSelectedUser("")
        setSelectedPartner("")
        await loadData()
        setActiveTab("logs")
      } else {
        setMessage({ type: "error", text: data.message || "Transfer başarısız." })
      }
    } catch {
      setMessage({ type: "error", text: "Sunucu hatası oluştu." })
    } finally {
      setTransferLoading(false)
    }
  }

  if (!isSuperAdmin) return null

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(searchUser.toLowerCase())
  )
  const filteredPartners = partners.filter((p) =>
    (p.name || p.username).toLowerCase().includes(searchPartner.toLowerCase())
  )

  const selectedUserObj = users.find((u) => u._id === selectedUser)
  const selectedPartnerObj = partners.find((p) => String(p._id) === selectedPartner)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Affiliate Transfer Yönetimi</h1>
        <p className="text-sm text-muted-foreground mt-1">Referansı olmayan kullanıcıları partnerlara atayın</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border">
        {(["transfer", "logs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "transfer" ? "Transfer İşlemi" : `Transfer Geçmişi${logs.length > 0 ? ` (${logs.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Message */}
      {message && (
        <div className={`flex items-start gap-2.5 p-3.5 rounded-xl text-sm font-medium border ${
          message.type === "success"
            ? "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400"
            : "bg-destructive/10 text-destructive border-destructive/20"
        }`}>
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {message.type === "success"
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
            }
          </svg>
          {message.text}
        </div>
      )}

      {/* Transfer Tab */}
      {activeTab === "transfer" && (
        <div className="space-y-5">
          {/* Selection summary */}
          {(selectedUserObj || selectedPartnerObj) && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">Seçilen Transfer</p>
                <p className="text-sm font-semibold text-foreground">
                  {selectedUserObj ? (
                    <span className="text-foreground">{selectedUserObj.username}</span>
                  ) : (
                    <span className="text-muted-foreground italic">Kullanıcı seçilmedi</span>
                  )}
                  <span className="mx-2 text-muted-foreground">→</span>
                  {selectedPartnerObj ? (
                    <span className="text-primary">{selectedPartnerObj.name || selectedPartnerObj.username}</span>
                  ) : (
                    <span className="text-muted-foreground italic">Partner seçilmedi</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleTransfer}
                  disabled={!selectedUser || !selectedPartner || transferLoading}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {transferLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                    </svg>
                  )}
                  Transfer Et
                </button>
                <button
                  onClick={() => { setSelectedUser(""); setSelectedPartner(""); setMessage(null) }}
                  className="px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Temizle
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Users */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold text-foreground text-sm">
                  Atanmamış Kullanıcılar
                  {!loadingData && (
                    <span className="ml-2 text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-normal">
                      {filteredUsers.length}
                    </span>
                  )}
                </h2>
              </div>
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Kullanıcı ara..."
                    value={searchUser}
                    onChange={(e) => setSearchUser(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
              </div>
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {loadingData ? (
                  <div className="flex items-center justify-center py-10">
                    <svg className="w-5 h-5 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
                    <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
                    </svg>
                    <p className="text-sm">Atanmamış kullanıcı yok</p>
                  </div>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user._id}
                      onClick={() => setSelectedUser(selectedUser === user._id ? "" : user._id)}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between ${
                        selectedUser === user._id
                          ? "bg-primary/10 border-l-2 border-primary"
                          : "hover:bg-secondary/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          selectedUser === user._id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                        }`}>
                          {user.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{user.username}</p>
                          {user.createdAt && (
                            <p className="text-xs text-muted-foreground">{new Date(user.createdAt).toLocaleDateString("tr-TR")}</p>
                          )}
                        </div>
                      </div>
                      {selectedUser === user._id && (
                        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Partners */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-semibold text-foreground text-sm">
                  Partner Seç
                  {!loadingData && (
                    <span className="ml-2 text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-normal">
                      {filteredPartners.length}
                    </span>
                  )}
                </h2>
              </div>
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Partner ara..."
                    value={searchPartner}
                    onChange={(e) => setSearchPartner(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
              </div>
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {loadingData ? (
                  <div className="flex items-center justify-center py-10">
                    <svg className="w-5 h-5 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  </div>
                ) : filteredPartners.length === 0 ? (
                  <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
                    <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
                    </svg>
                    <p className="text-sm">Partner bulunamadı</p>
                  </div>
                ) : (
                  filteredPartners.map((partner) => (
                    <button
                      key={partner._id}
                      onClick={() => setSelectedPartner(selectedPartner === String(partner._id) ? "" : String(partner._id))}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between ${
                        selectedPartner === String(partner._id)
                          ? "bg-primary/10 border-l-2 border-primary"
                          : "hover:bg-secondary/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          selectedPartner === String(partner._id) ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                        }`}>
                          {(partner.name || partner.username)[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{partner.name || partner.username}</p>
                          <p className="text-xs text-muted-foreground font-mono">@{partner.username}</p>
                        </div>
                      </div>
                      {selectedPartner === String(partner._id) && (
                        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Transfer button when nothing selected yet */}
          {!selectedUserObj && !selectedPartnerObj && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Soldan kullanıcı, sağdan partner seçerek transfer işlemi yapabilirsiniz.
            </p>
          )}
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === "logs" && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground text-sm">Transfer Geçmişi</h2>
            <button onClick={loadData} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
              </svg>
              Yenile
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/30">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kullanıcı</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Partner</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">İşlemi Yapan</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tarih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingData ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center">
                      <svg className="w-5 h-5 animate-spin text-muted-foreground mx-auto" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                        </svg>
                        <p className="text-sm">Henüz transfer işlemi yapılmamış</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{log.fromUsername}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                          @{log.toPartnerUsername}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{log.performedBy}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-600 border border-green-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"/>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                        {new Date(log.timestamp).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
