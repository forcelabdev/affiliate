/**
 * lib/security.ts
 * Merkezi güvenlik yardımcıları:
 *  - sanitize    : string/int/float input temizleme
 *  - rateLimit   : IP bazlı in-memory rate limiter
 *  - requireRole : rol tabanlı yetki kontrolü
 */

import { NextRequest, NextResponse } from "next/server"
import { SessionPayload } from "@/lib/auth"

// ─── Sanitize ────────────────────────────────────────────────────────────────

/** Kullanıcıdan gelen string'i temizler: HTML, MongoDB operatör karakterleri, boşluk */
export function sanitizeStr(value: unknown, maxLen = 200): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
    .replace(/[<>"'`]/g, "")          // HTML injection
    .replace(/[${}]/g, "")             // MongoDB operator injection
    .replace(/[\x00-\x1F\x7F]/g, "")  // kontrol karakterleri
    .trim()
    .slice(0, maxLen)
  return s
}

/** Integer parse + sınır kontrolü */
export function sanitizeInt(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const n = parseInt(String(value), 10)
  if (isNaN(n) || n < min || n > max) return null
  return n
}

/** Float parse + sınır kontrolü */
export function sanitizeFloat(value: unknown, min = 0, max = 10_000_000): number | null {
  const n = parseFloat(String(value))
  if (isNaN(n) || n < min || n > max) return null
  return n
}

/** ObjectId formatını doğrular (24 hex karakter) */
export function isValidObjectId(id: unknown): boolean {
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id)
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

interface RateBucket {
  count: number
  resetAt: number
}

const rateBuckets = new Map<string, RateBucket>()

/** IP başına belirli pencerede maksimum istek sayısını kontrol eder.
 *  @returns true  → istek kabul
 *  @returns false → limit aşıldı
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (bucket.count >= maxRequests) return false

  bucket.count++
  return true
}

/** Request'ten güvenli IP alır */
export function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  )
}

/** Rate limit kontrolü yapar, limit aşıldıysa NextResponse döner */
export function checkRateLimit(
  req: NextRequest,
  maxRequests: number,
  windowMs: number,
  keyPrefix = ""
): NextResponse | null {
  const ip = getIP(req)
  const key = keyPrefix ? `${keyPrefix}:${ip}` : ip
  if (!rateLimit(key, maxRequests, windowMs)) {
    return NextResponse.json(
      { success: false, message: "Çok fazla istek gönderildi. Lütfen bekleyin." },
      { status: 429 }
    )
  }
  return null
}

// ─── Role Guard ───────────────────────────────────────────────────────────────

type Role = "superadmin" | "admin" | "partner"

/** Session'ın gerekli rolde olup olmadığını kontrol eder.
 *  @returns null  → yetki tamam
 *  @returns NextResponse → 403 hata yanıtı
 */
export function requireRole(
  session: SessionPayload,
  ...allowedRoles: Role[]
): NextResponse | null {
  if (!allowedRoles.includes(session.role as Role)) {
    return NextResponse.json(
      { success: false, message: "Bu işlem için yetkiniz yok." },
      { status: 403 }
    )
  }
  return null
}

// ─── Input Size Guard ─────────────────────────────────────────────────────────

/** Request body'nin boyutunu sınırlar (varsayılan 64KB) */
export async function safeParse<T = Record<string, unknown>>(
  req: NextRequest,
  maxBytes = 65_536
): Promise<{ data: T } | { error: NextResponse }> {
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10)
  if (contentLength > maxBytes) {
    return {
      error: NextResponse.json(
        { success: false, message: "İstek gövdesi çok büyük." },
        { status: 413 }
      ),
    }
  }
  try {
    const data = (await req.json()) as T
    return { data }
  } catch {
    return {
      error: NextResponse.json(
        { success: false, message: "Geçersiz JSON gövdesi." },
        { status: 400 }
      ),
    }
  }
}
