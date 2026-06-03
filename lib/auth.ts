import { neon } from "@neondatabase/serverless"

export interface AffiliateUser {
  username: string
  password: string
  affiliateId?: string
  refCode?: string
  name?: string
  role: "superadmin" | "admin" | "partner"
  commissionRate?: number
  commissionType?: "deposit" | "net"
}

export interface SessionPayload {
  username: string
  role: "superadmin" | "admin" | "partner"
  affiliateId?: string
  refCode?: string
  name?: string
  commissionRate?: number
  commissionType?: "deposit" | "net"
  exp?: number
}

/** In-memory commission overrides set by admin at runtime (resets on server restart).
 *  For persistence, use AFFILIATE_USERS env var or a database.
 */
const commissionOverrides: Record<string, { rate: number; type: "deposit" | "net" }> = {}

export function setCommissionOverride(username: string, rate: number, type: "deposit" | "net") {
  commissionOverrides[username] = { rate, type }
}

export function getCommissionOverride(username: string) {
  return commissionOverrides[username] || null
}

/**
 * Get affiliate users from Neon PostgreSQL database.
 * Reads from affiliate_users table.
 */
export async function getAffiliateUsersFromDB(): Promise<AffiliateUser[]> {
  try {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      console.warn("[v0] DATABASE_URL not set, using fallback")
      return getAffiliateUsers()
    }

    const sql = neon(databaseUrl)
    const users = await sql`SELECT * FROM affiliate_users`

    if (!users || !Array.isArray(users) || users.length === 0) {
      console.warn("[v0] No users in Neon, using fallback")
      return getAffiliateUsers()
    }

    return users.map((doc: any) => {
      const rawRef = doc.ref_code
      const refCode = rawRef && rawRef !== "NULL" && rawRef !== "null" ? rawRef : undefined
      return {
        username: doc.username || "",
        password: doc.password || "",
        affiliateId: doc.id?.toString() || doc.id,
        refCode,
        name: doc.name,
        role: doc.role || "partner",
        commissionRate: doc.commission_rate,
        commissionType: doc.commission_type,
      }
    })
  } catch (err) {
    console.warn("[v0] Neon fetch failed, using fallback:", err instanceof Error ? err.message : err)
    return getAffiliateUsers()
  }
}

/** Load partner list from AFFILIATE_USERS env variable (or DB if available).
 *  Format (JSON array):
 *  [
 *    {
 *      "username": "partner1",
 *      "password": "sifre123",
 *      "refCode": "demokod",       <-- ZORUNLU: register?a= linki kodu, DB'deki affiliates.redeemedCode ile eşleşmeli
 *      "name": "Ali Yılmaz",
 *      "role": "partner",
 *      "commissionRate": 10,
 *      "commissionType": "deposit"
 *    },
 *    { "username": "admin", "password": "adminSifre", "role": "admin" }
 *  ]
 *
 *  Falls back to a built-in demo list when env var is not set (for preview only).
 */
export function getAffiliateUsers(): AffiliateUser[] {
  const raw = process.env.AFFILIATE_USERS

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AffiliateUser[]
      return parsed
    } catch {
      // fall through to demo
    }
  }

  // Env var ayarlanmamış — boş liste döner, kimse giriş yapamaz
  console.error("[auth] AFFILIATE_USERS env var not set and DATABASE_URL unavailable. No users available.")
  return []
}

import { createHmac, timingSafeEqual } from "crypto"

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error("[auth] CRITICAL: JWT_SECRET env var is not set. Set it immediately.")
}
const SECRET = JWT_SECRET || "dev-secret-change-in-production"

function hmacSign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url")
}

/** Üretir: base64url(payload).HMAC-SHA256(base64url(payload)) */
export function signToken(payload: SessionPayload): string {
  const data: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60, // 8 saat
  }
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url")
  const sig     = hmacSign(encoded)
  return `${encoded}.${sig}`
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    if (!token || typeof token !== "string") return null
    const dotIndex = token.lastIndexOf(".")
    if (dotIndex === -1) return null

    const encoded = token.slice(0, dotIndex)
    const sig     = token.slice(dotIndex + 1)
    if (!encoded || !sig) return null

    // Timing-safe HMAC karşılaştırma (timing attack'ı engeller)
    const expectedSig = hmacSign(encoded)
    const sigBuf      = Buffer.from(sig)
    const expBuf      = Buffer.from(expectedSig)
    if (sigBuf.length !== expBuf.length) return null
    if (!timingSafeEqual(sigBuf, expBuf)) return null

    const json    = Buffer.from(encoded, "base64url").toString("utf8")
    const payload = JSON.parse(json) as SessionPayload

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch {
    return null
  }
}
