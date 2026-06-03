import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { connectDB } from "@/lib/mongodb"
import mongoose from "mongoose"
import { ObjectId } from "mongodb"

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz." }, { status: 403 })
  }

  const body = await req.json()
  const username = String(body.username ?? "").trim()
  const amount = parseFloat(body.amount ?? "0")
  const txHash = String(body.txHash ?? "").trim()
  const network = String(body.network ?? "TRC20").trim()
  const note = String(body.note ?? "").trim()

  if (!username) {
    return NextResponse.json({ success: false, message: "Kullanıcı adı gerekli." }, { status: 400 })
  }
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Geçerli bir tutar girin." }, { status: 400 })
  }

  try {
    await connectDB()
    const db = mongoose.connection.db!
    const usersCol = db.collection("users")
    const financeTx = db.collection("forcelabfinancetransactions")

    // Kullanıcıyı bul
    const user = await usersCol.findOne(
      { username: { $regex: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
      { projection: { _id: 1, username: 1 } }
    )

    if (!user) {
      return NextResponse.json({ success: false, message: "Kullanıcı bulunamadı." }, { status: 404 })
    }

    // Benzersiz transaction ID oluştur
    const uuid = `crypto_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const externalTransactionId = `manual_crypto_${user._id}_${Date.now()}_${txHash || "notx"}`

    // forcelabfinancetransactions'a ekle
    const now = new Date()
    const depositDoc = {
      user: new ObjectId(user._id),
      uuid,
      externalTransactionId,
      providerSlug: "crypto-manual",
      providerName: `Kripto (${network})`,
      providerType: "deposit",
      amount: amount,
      providerAmount: amount * 100, // kuruş cinsinden
      currency: "TRY",
      status: "success",
      redirectUrl: "",
      oldBalance: 0,
      newBalance: amount,
      metadata: {
        txHash: txHash || null,
        network,
        note,
        addedBy: session.username,
        manual: true,
      },
      providerResponse: {},
      callbackRawData: {},
      rejectionReason: "",
      processedAt: now,
      approvedAt: now,
      rejectedAt: null,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    }

    await financeTx.insertOne(depositDoc)

    return NextResponse.json({
      success: true,
      message: `${user.username} kullanıcısına ₺${amount.toLocaleString("tr-TR")} kripto yatırımı eklendi.`,
      deposit: {
        username: user.username,
        amount,
        network,
        txHash: txHash || null,
      },
    })
  } catch (err: any) {
    console.error("Manual deposit error:", err)
    return NextResponse.json({ success: false, message: "İşlem başarısız." }, { status: 500 })
  }
}
