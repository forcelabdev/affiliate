import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import mongoose from "mongoose"
import { connectDB } from "@/lib/db"

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Bu işlem için süper admin yetkisi gerekiyor." }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const username = searchParams.get("username")
  if (!username) {
    return NextResponse.json({ success: false, message: "Kullanıcı adı zorunludur." }, { status: 400 })
  }

  try {
    // 1. Neon'dan sil
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      try {
        const { neon } = await import("@neondatabase/serverless")
        const sql = neon(databaseUrl)
        await sql`DELETE FROM affiliate_users WHERE username = ${username}`
      } catch (e) {
        console.error("[delete-partner] Neon delete error:", e)
      }
    }

    // 2. MongoDB affiliate_users koleksiyonundan da sil
    await connectDB()
    const db = mongoose.connection.db!
    await db.collection("affiliate_users").deleteOne({ username })

    return NextResponse.json({ success: true, message: `${username} partneri silindi.` })
  } catch (err) {
    console.error("[delete-partner] error:", err)
    return NextResponse.json({ success: false, message: "İşlem gerçekleştirilemedi." }, { status: 500 })
  }
}
