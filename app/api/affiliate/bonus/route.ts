import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { checkRateLimit, sanitizeStr, sanitizeFloat, safeParse } from "@/lib/security"
import mongoose from "mongoose"
import { connectDB } from "@/lib/mongodb"
import { v4 as uuidv4 } from "uuid"

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, 20, 60_000, "bonus-post")
  if (rl) return rl

  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Bu işlem için süper admin yetkisi gereklidir." }, { status: 403 })
  }

  const parsed = await safeParse<{ username?: unknown; amount?: unknown; note?: unknown }>(req)
  if ("error" in parsed) return parsed.error
  const body = parsed.data

  const username = sanitizeStr(body.username, 100)
  const amount   = sanitizeFloat(body.amount, 1, 10_000) ?? NaN
  const note     = sanitizeStr(body.note, 300) || "Bonus yükleme"

  if (!username) {
    return NextResponse.json({ success: false, message: "Kullanıcı adı gereklidir." }, { status: 400 })
  }
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Geçerli bir tutar giriniz." }, { status: 400 })
  }
  if (amount > 50000) {
    return NextResponse.json({ success: false, message: "Maksimum bonus tutarı 50.000₺'dir." }, { status: 400 })
  }

  try {
    await connectDB()
    const db = mongoose.connection.db!
    const users = db.collection("users")
    const transactions = db.collection("forcelabfinancetransactions")

    // Find user by username — exact lowercase match (regex injection riski yok)
    const user = await users.findOne(
      { username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { projection: { _id: 1, username: 1, wallets: 1 } }
    )
    // Not: yukarıdaki regex escape edilmiş durumda, injection güvenli.

    if (!user) {
      return NextResponse.json({ success: false, message: `"${username}" kullanıcısı bulunamadı.` }, { status: 404 })
    }

    // Find current Rivo wallet balance
    const wallets: any[] = Array.isArray(user.wallets) ? user.wallets : []
    const rivoIndex = wallets.findIndex((w: any) => w?.coinType === "Rivo")
    const oldBalance = rivoIndex >= 0 ? (wallets[rivoIndex].balance ?? 0) : 0
    const newBalance = oldBalance + amount

    const now = new Date()
    const txUuid = uuidv4()
    const externalId = `bonus_${String(user._id)}_${Date.now()}`

    // 1. Insert transaction into forcelabfinancetransactions
    await transactions.insertOne({
      user: user._id,
      uuid: txUuid,
      externalTransactionId: externalId,
      providerSlug: "bonus",
      providerName: "Bonus",
      providerType: "deposit",
      amount,
      providerAmount: amount * 100, // kuruş cinsinden
      currency: "TRY",
      status: "approved",
      redirectUrl: "",
      oldBalance,
      newBalance,
      metadata: { note, addedBy: session.username },
      providerResponse: {},
      rejectionReason: "",
      processedAt: now,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
      __v: 0,
      callbackRawData: {},
    })

    // 2. Update Rivo wallet balance on the user
    if (rivoIndex >= 0) {
      await users.updateOne(
        { _id: user._id },
        {
          $set: {
            [`wallets.${rivoIndex}.balance`]: newBalance,
            updatedAt: now,
          },
        }
      )
    } else {
      // Rivo wallet yok, oluştur
      await users.updateOne(
        { _id: user._id },
        {
          $push: {
            wallets: {
              coinType: "Rivo",
              balance: amount,
              chain: "TRON",
              type: "trc-20",
            },
          } as any,
          $set: { updatedAt: now },
        }
      )
    }

    // 3. Write to Neon bonus_logs for permanent audit trail
    try {
      const { neon } = await import("@neondatabase/serverless")
      const databaseUrl = process.env.DATABASE_URL
      if (databaseUrl) {
        const sql = neon(databaseUrl)
        await sql`
          INSERT INTO bonus_logs (added_by, target_username, amount, old_balance, new_balance, tx_uuid, note)
          VALUES (${session.username}, ${String(user.username)}, ${amount}, ${oldBalance}, ${newBalance}, ${txUuid}, ${note})
        `
      }
    } catch (neonErr) {
      console.error("[bonus] Neon log write failed:", neonErr)
      // Non-fatal — transaction already inserted in MongoDB
    }

    return NextResponse.json({
      success: true,
      message: `${username} kullanıcısına ₺${amount.toLocaleString("tr-TR")} bonus yüklendi.`,
      username: String(user.username),
      oldBalance,
      newBalance,
      txUuid,
    })
  } catch (err) {
    console.error("[bonus] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası oluştu." }, { status: 500 })
  }
}

// GET — list bonus_logs (superadmin only)
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, 30, 60_000, "bonus-get")
  if (rl) return rl

  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  const { session } = auth

  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  try {
    const { neon } = await import("@neondatabase/serverless")
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) return NextResponse.json({ success: true, logs: [] })

    const sql = neon(databaseUrl)
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200)
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0)

    const logs = await sql`
      SELECT id, added_by, target_username, amount, old_balance, new_balance, tx_uuid, note, created_at
      FROM bonus_logs
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    const total = await sql`SELECT COUNT(*)::int AS count FROM bonus_logs`

    return NextResponse.json({ success: true, logs, total: total[0]?.count ?? 0 })
  } catch (err) {
    console.error("[bonus GET] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
