import { NextRequest, NextResponse } from "next/server"
import { getAffiliateUsersFromDB, getCommissionOverride, signToken } from "@/lib/auth"
import { checkRateLimit, getIP, sanitizeStr, safeParse } from "@/lib/security"
import bcrypt from "bcryptjs"

export async function POST(req: NextRequest) {
  // IP başına 10 deneme / 15 dakika — brute-force koruması
  const rateLimitRes = checkRateLimit(req, 10, 15 * 60 * 1000, "auth")
  if (rateLimitRes) return rateLimitRes

  try {
    const parsed = await safeParse<{ username?: string; password?: string }>(req)
    if ("error" in parsed) return parsed.error
    const { data: body } = parsed

    const username = sanitizeStr(body.username, 100)
    const password = body.password ? String(body.password).slice(0, 200) : ""

    if (!username || !password) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı ve şifre gerekli." }, { status: 400 })
    }

    const users = await getAffiliateUsersFromDB()
    if (!users || !Array.isArray(users) || users.length === 0) {
      console.error("[v0] Auth: no users available")
      return NextResponse.json({ success: false, message: "Kullanıcı adı veya şifre hatalı." }, { status: 401 })
    }

    // Find user by username first
    const user = users.find(
      (u) => u && u.username && u.username.toLowerCase() === username.toLowerCase()
    )
    if (!user) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı veya şifre hatalı." }, { status: 401 })
    }

    // Check if applicant exists but is still pending/rejected
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        const pending = await sql`SELECT status FROM affiliate_applications WHERE username = ${username}`
        if (pending.length > 0) {
          const status = pending[0].status
          if (status === "pending") {
            return NextResponse.json({ success: false, message: "Başvurunuz henüz onaylanmadı. Onaylandıktan sonra giriş yapabilirsiniz." }, { status: 403 })
          }
          if (status === "rejected") {
            return NextResponse.json({ success: false, message: "Başvurunuz reddedildi. Daha fazla bilgi için yönetici ile iletişime geçin." }, { status: 403 })
          }
        }
      } catch (e) {
        console.error("[auth] pending check error:", e)
      }
    }

    // Check password: bcrypt hash (Neon users) OR plain text (env fallback users)
    const storedPassword = user.password || ""
    const isBcrypt = storedPassword.startsWith("$2")
    const passwordMatch = isBcrypt
      ? await bcrypt.compare(password, storedPassword)
      : storedPassword === password

    if (!passwordMatch) {
      return NextResponse.json({ success: false, message: "Kullanıcı adı veya şifre hatalı." }, { status: 401 })
    }

    const override = getCommissionOverride(user.username)
    const commissionRate = override?.rate ?? user.commissionRate ?? 10
    const commissionType = override?.type ?? user.commissionType ?? "deposit"

    const token = signToken({
      username: user.username,
      role: user.role,
      affiliateId: user.affiliateId,
      refCode: user.refCode,
      name: user.name,
      commissionRate,
      commissionType,
    })

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        affiliateId: user.affiliateId,
        refCode: user.refCode,
        commissionRate,
        commissionType,
      },
    })

    // Set HttpOnly cookie so both bizzo.partners and www.bizzo.partners share the same token.
    // domain=".bizzo.partners" covers both the apex and www subdomain.
    const isProd = process.env.NODE_ENV === "production"
    response.cookies.set("affiliate_token", token, {
      httpOnly: false,          // client JS must also read it for localStorage fallback
      secure: isProd,
      sameSite: "lax",
      maxAge: 8 * 60 * 60,     // 8 hours — same as JWT exp
      path: "/",
      domain: isProd ? ".bizzo.partners" : undefined,
    })

    return response
  } catch (err) {
    console.error("[v0] Auth error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
