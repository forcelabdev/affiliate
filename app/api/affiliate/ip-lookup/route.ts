import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"

// ip-api.com batch endpoint — ücretsiz, API key gerektirmez, 100 IP / istek
// http (HTTPS pro gerektirir) — server-side'dan çağırıyoruz, CORS sorunu yok

interface IpApiResult {
  query: string
  status: string
  country?: string
  countryCode?: string
  city?: string
  isp?: string
  org?: string
  proxy?: boolean
  hosting?: boolean
  mobile?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth
  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  try {
    const body = await req.json()
    const ips: string[] = Array.isArray(body.ips) ? body.ips.slice(0, 100) : []

    if (ips.length === 0) {
      return NextResponse.json({ success: false, message: "IP listesi boş." }, { status: 400 })
    }

    // ip-api.com batch endpoint — tek çağrıda 100 IP
    const payload = ips.map(ip => ({
      query: ip,
      fields: "status,message,country,countryCode,city,isp,org,proxy,hosting,mobile,query",
    }))

    const response = await fetch("http://ip-api.com/batch?fields=status,message,country,countryCode,city,isp,org,proxy,hosting,mobile,query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return NextResponse.json({ success: false, message: `ip-api.com hatası: ${response.status}` }, { status: 502 })
    }

    const results: IpApiResult[] = await response.json()

    const data = results.map(r => ({
      ip: r.query,
      country: r.country || null,
      countryCode: r.countryCode || null,
      city: r.city || null,
      isp: r.isp || null,
      org: r.org || null,
      isProxy: r.proxy || false,
      isHosting: r.hosting || false,
      isMobile: r.mobile || false,
      status: r.status,
    }))

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error("[ip-lookup] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
