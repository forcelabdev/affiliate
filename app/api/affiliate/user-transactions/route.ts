import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "fonbet", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
  if (!mongoose.connection.db) await new Promise<void>((r) => mongoose.connection.once("connected", () => r()))
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  // Only admin/superadmin or the partner who owns the user can access
  const isAdmin = session.role === "admin" || session.role === "superadmin"
  const isPartner = session.role === "partner"
  if (!isAdmin && !isPartner) {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const username = searchParams.get("username")?.replace(/[${}]/g, "").trim()

  if (!username) {
    return NextResponse.json({ success: false, message: "Kullanıcı adı gereklidir." }, { status: 400 })
  }

  try {
    await connectDB()
    const users = mongoose.connection.db!.collection("users")
    const financeTx = mongoose.connection.db!.collection("forcelabfinancetransactions")

    // Find the user
    const user = await users.findOne(
      { username: { $regex: `^${username}$`, $options: "i" } },
      { projection: { _id: 1, username: 1, name: 1, "affiliates.redeemedCode": 1, wallets: 1 } }
    )

    if (!user) {
      return NextResponse.json({ success: false, message: "Kullanıcı bulunamadı." }, { status: 404 })
    }

    // If partner, verify this user belongs to them via redeemedCode
    if (isPartner && !isAdmin) {
      const redeemedCode = user.affiliates?.redeemedCode
      if (!redeemedCode || redeemedCode !== session.refCode) {
        return NextResponse.json({ success: false, message: "Bu kullanıcıya erişim yetkiniz yok." }, { status: 403 })
      }
    }

    // Get all transactions (deposits + withdrawals) for this user
    const transactions = await financeTx.find(
      {
        user: user._id,
        providerType: { $in: ["deposit", "withdraw", "withdrawal"] },
      },
      {
        projection: {
          _id: 1, amount: 1, providerType: 1, providerName: 1, providerSlug: 1,
          status: 1, createdAt: 1, approvedAt: 1, oldBalance: 1, newBalance: 1,
          currency: 1, metadata: 1,
        },
      }
    ).sort({ createdAt: -1 }).toArray()

    // Get Rivo wallet balance
    const wallets: any[] = Array.isArray(user.wallets) ? user.wallets : []
    const rivoWallet = wallets.find((w: any) => w?.coinType === "Rivo")
    const currentBalance = rivoWallet?.balance ?? 0

    const approvedStatuses = ["approved", "completed", "success", "confirmed"]
    const isApproved = (s: string) => approvedStatuses.includes(s)
    const isBonus = (t: any) => /bonus/i.test(t.providerName || "") || /bonus/i.test(t.providerSlug || "")

    const totalDeposit = transactions
      .filter((t: any) => t.providerType === "deposit" && isApproved(t.status) && !isBonus(t))
      .reduce((s: number, t: any) => s + (t.amount ?? 0), 0)

    const totalWithdrawal = transactions
      .filter((t: any) => ["withdraw", "withdrawal"].includes(t.providerType) && isApproved(t.status))
      .reduce((s: number, t: any) => s + (t.amount ?? 0), 0)

    // meeldevtransactions da dahil et
    const meeldevTx = mongoose.connection.db!.collection("meeldevtransactions")
    const meelTxns  = await meeldevTx.find(
      { user: user._id, type: { $in: ["deposit", "withdraw", "withdrawal"] } },
      { projection: { _id: 1, amount: 1, type: 1, status: 1, createdAt: 1, oldBalance: 1, newBalance: 1, paymentType: 1, providerName: 1, providerSlug: 1 } }
    ).sort({ createdAt: -1 }).toArray()

    const isMeelBonus = (t: any) => /bonus/i.test(t.providerName || "") || /bonus/i.test(t.providerSlug || "")
    const meelDeposit    = meelTxns.filter((t: any) => t.type === "deposit"    && isApproved(t.status) && !isMeelBonus(t)).reduce((s: number, t: any) => s + (t.amount ?? 0), 0)
    const meelWithdrawal = meelTxns.filter((t: any) => ["withdraw","withdrawal"].includes(t.type) && isApproved(t.status)).reduce((s: number, t: any) => s + (t.amount ?? 0), 0)

    const combinedTotalDeposit    = totalDeposit + meelDeposit
    const combinedTotalWithdrawal = totalWithdrawal + meelWithdrawal

    const meelMapped = meelTxns.map((t: any) => ({
      _id: String(t._id),
      amount: t.amount,
      type: t.type === "deposit" ? "deposit" : "withdrawal",
      providerName: t.paymentType ? `Meel (${t.paymentType})` : "Meel",
      status: t.status,
      createdAt: t.createdAt,
      oldBalance: t.oldBalance,
      newBalance: t.newBalance,
      currency: "TRY",
      note: null,
    }))

    return NextResponse.json({
      success: true,
      user: {
        userId: String(user._id),
        username: user.username,
        name: user.name,
        redeemedCode: user.affiliates?.redeemedCode,
        currentBalance,
      },
      summary: {
        totalDeposit:    combinedTotalDeposit,
        totalWithdrawal: combinedTotalWithdrawal,
        txCount: transactions.length + meelMapped.length,
      },
      transactions: [
        ...transactions.map((t: any) => ({
          _id: String(t._id),
          amount: t.amount,
          type: t.providerType,
          providerName: t.providerName || t.providerSlug || "—",
          status: t.status,
          createdAt: t.createdAt,
          approvedAt: t.approvedAt,
          oldBalance: t.oldBalance,
          newBalance: t.newBalance,
          currency: t.currency || "TRY",
          note: t.metadata?.note || null,
        })),
        ...meelMapped,
      ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    })
  } catch (err) {
    console.error("[user-transactions] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
