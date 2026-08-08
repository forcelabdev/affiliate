import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { addManualBalanceLog, listManualBalanceLogs } from "@/lib/manual-balance"

/** GET: İşlem geçmişini listeler (son kayıtlar, "Toplam N kayıt" sayacı için). Sadece superadmin. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200)
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0)
  const targetUsername = searchParams.get("username") || undefined

  try {
    const { logs, total } = await listManualBalanceLogs({ limit, offset, targetUsername })
    return NextResponse.json({ success: true, logs, total })
  } catch (err) {
    console.error("[manual-balance] GET error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}

/** POST: Yeni manuel yatırım/çekim kaydı oluşturur. Sadece superadmin.
 *  Gerçek MongoDB bakiyesine/cüzdana yazmaz — yalnızca görsel amaçlı Neon kaydı oluşturur.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const targetUsername = String(body.username ?? "").trim()
  const type = String(body.type ?? "").trim()
  const provider = String(body.provider ?? "").trim()
  const amount = Number.parseFloat(body.amount ?? "0")
  const note = body.note ? String(body.note).trim() : null

  if (!targetUsername) {
    return NextResponse.json({ success: false, message: "Kullanıcı adı gerekli." }, { status: 400 })
  }
  if (type !== "deposit" && type !== "withdrawal") {
    return NextResponse.json({ success: false, message: "Geçersiz işlem tipi." }, { status: 400 })
  }
  if (provider !== "filux" && provider !== "xpayment") {
    return NextResponse.json({ success: false, message: "Geçersiz sağlayıcı." }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Geçerli bir tutar girin." }, { status: 400 })
  }

  try {
    const log = await addManualBalanceLog({
      targetUsername,
      type: type as "deposit" | "withdrawal",
      provider: provider as "filux" | "xpayment",
      amount,
      note,
      addedBy: session.username,
    })

    return NextResponse.json({
      success: true,
      message: `${targetUsername} için manuel ${type === "deposit" ? "yatırım" : "çekim"} kaydı eklendi.`,
      log,
    })
  } catch (err) {
    console.error("[manual-balance] POST error:", err)
    return NextResponse.json({ success: false, message: "İşlem başarısız." }, { status: 500 })
  }
}
