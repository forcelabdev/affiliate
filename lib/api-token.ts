/**
 * Fetches and caches an upstream API token via POST /affiliate/login.
 * Credentials come from env vars AFFILIATE_API_USERNAME + AFFILIATE_API_PASSWORD.
 * Token is cached in-memory for 12 hours (Node.js server lifetime).
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || ""

let cachedToken: string | null = null
let tokenExpiry = 0

export async function getUpstreamToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const username = process.env.AFFILIATE_API_USERNAME || ""
  const password = process.env.AFFILIATE_API_PASSWORD || ""

  if (!BASE_URL || !username || !password) return ""

  try {
    const res = await fetch(`${BASE_URL}/affiliate/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    // API returns { message, user: { ... }, token } or similar
    const token: string = data?.token || data?.user?.token || ""
    if (token) {
      cachedToken = token
      tokenExpiry = Date.now() + 12 * 60 * 60 * 1000 // 12 hours
    }
    return token
  } catch {
    return ""
  }
}
