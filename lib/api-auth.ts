import { NextRequest, NextResponse } from "next/server"
import { verifyToken, SessionPayload } from "@/lib/auth"

/** Extracts and verifies the JWT from the request.
 *  Returns { session } on success, or { error: NextResponse } on failure.
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ session: SessionPayload; error?: never } | { session?: never; error: NextResponse }> {
  const token =
    req.headers.get("x-auth-token") ||
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    ""

  if (!token) {
    return {
      error: NextResponse.json({ success: false, message: "Token gerekli." }, { status: 401 }),
    }
  }

  const session = verifyToken(token)

  if (!session) {
    return {
      error: NextResponse.json({ success: false, message: "Geçersiz veya süresi dolmuş token." }, { status: 401 }),
    }
  }

  return { session }
}
