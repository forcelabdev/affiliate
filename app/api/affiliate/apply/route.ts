import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { neon } from "@neondatabase/serverless"

// Simple in-memory rate limiter: max 5 applications per IP per 10 minutes
const applyRateMap = new Map<string, { count: number; resetAt: number }>()
function checkApplyRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = applyRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    applyRateMap.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 })
    return true
  }
  if (entry.count >= 5) return false
  entry.count++
  return true
}

// Sanitize: strip MongoDB operators and limit length
function sanitize(val: unknown, maxLen = 200): string {
  if (typeof val !== "string") return ""
  return val.replace(/[${}]/g, "").trim().slice(0, maxLen)
}

export async function POST(req: NextRequest) {
  // Rate limit by IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (!checkApplyRateLimit(ip)) {
    return NextResponse.json({ success: false, message: "Çok fazla istek. Lütfen bekleyin." }, { status: 429 })
  }

  try {
    const body = await req.json()

    // Sanitize all inputs
    const username = sanitize(body.username, 50)
    const password = sanitize(body.password, 200)
    const name     = sanitize(body.name, 100)
    const email    = sanitize(body.email, 200)
    const websiteUrl = sanitize(body.websiteUrl, 300)
    const country  = sanitize(body.country, 100)
    const currency = sanitize(body.currency, 20)
    const telegram = sanitize(body.telegram, 100)
    const teams    = sanitize(body.teams, 200)

    if (!username || !password || !email) {
      return NextResponse.json(
        { success: false, message: "Kullanıcı adı, şifre ve e-posta zorunludur." },
        { status: 400 }
      )
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, message: "Geçerli bir e-posta adresi girin." }, { status: 400 })
    }

    // Password strength: min 8 chars
    if (password.length < 8) {
      return NextResponse.json({ success: false, message: "Şifre en az 8 karakter olmalıdır." }, { status: 400 })
    }

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return NextResponse.json({ success: false, message: "Sunucu yapılandırma hatası." }, { status: 500 })
    }

    const sql = neon(databaseUrl)

    // Check duplicate username
    const existing = await sql`
      SELECT id FROM affiliate_applications WHERE username = ${username}
      UNION ALL
      SELECT id FROM affiliate_users WHERE username = ${username}
    `
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, message: "Bu kullanıcı adı zaten kullanılıyor." },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // Ensure columns exist
    await sql`ALTER TABLE affiliate_applications ADD COLUMN IF NOT EXISTS telegram TEXT`
    await sql`ALTER TABLE affiliate_applications ADD COLUMN IF NOT EXISTS teams TEXT`

    await sql`
      INSERT INTO affiliate_applications
        (username, password, name, email, website_url, country, currency, telegram, teams, status)
      VALUES
        (${username}, ${hashedPassword}, ${name || null}, ${email}, ${websiteUrl || null}, ${country || null}, ${currency || null}, ${telegram || null}, ${teams || null}, 'pending')
    `

    return NextResponse.json({ success: true, message: "Başvurunuz alındı. Onaylandıktan sonra giriş yapabilirsiniz." })
  } catch (err) {
    console.error("[apply] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
