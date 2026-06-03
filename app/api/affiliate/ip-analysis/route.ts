import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { connectDB } from "@/lib/db"
import mongoose from "mongoose"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error

  const { session } = auth
  if (session.role !== "superadmin") {
    return NextResponse.json({ success: false, message: "Yetkisiz erişim." }, { status: 403 })
  }

  try {
    await connectDB()
    const usersCol = mongoose.connection.db!.collection("users")

    // Tüm kullanıcıları çek (ip array dahil)
    const allDocs = await usersCol
      .find({}, { projection: { _id: 1, username: 1, name: 1, rank: 1, createdAt: 1, ips: 1 } })
      .limit(10000)
      .toArray()

    // IP → kullanıcılar haritası
    const ipMap = new Map<string, { _id: string; username: string; name?: string; createdAt?: string; lastSeen?: string }[]>()

    for (const doc of allDocs) {
      if (!doc.ips || !Array.isArray(doc.ips) || doc.ips.length === 0) continue
      // Her kullanıcı için benzersiz IP'leri işle
      const seenIps = new Set<string>()
      const sortedIps = [...doc.ips].sort((a: any, b: any) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      )
      for (const ipEntry of sortedIps) {
        const addr: string = ipEntry.address
        if (!addr || seenIps.has(addr)) continue
        seenIps.add(addr)
        if (!ipMap.has(addr)) ipMap.set(addr, [])
        ipMap.get(addr)!.push({
          _id: String(doc._id),
          username: doc.username,
          name: doc.name,
          createdAt: doc.createdAt?.toISOString?.() ?? String(doc.createdAt ?? ""),
          lastSeen: ipEntry.createdAt?.toISOString?.() ?? String(ipEntry.createdAt ?? ""),
        })
      }
    }

    // Çakışmalar: 2+ kullanıcının aynı IP'yi kullandığı gruplar
    const conflicts = Array.from(ipMap.entries())
      .filter(([, users]) => users.length >= 2)
      .map(([ip, users]) => ({ ip, userCount: users.length, users }))
      .sort((a, b) => b.userCount - a.userCount)

    // Son işlem tespiti: adminmanualadjustments (bonus) ve deposit koleksiyonları
    const adjustmentsCol = mongoose.connection.db!.collection("adminmanualadjustments")
    const forcelabCol    = mongoose.connection.db!.collection("forcelabfinancetransactions")
    const meeldevCol     = mongoose.connection.db!.collection("meeldevtransactions")

    const userObjectIds = allDocs.map((d: any) => d._id)

    // Son bonus kaydı her kullanıcı için
    const lastBonusDocs = await adjustmentsCol.aggregate([
      { $match: { targetUser: { $in: userObjectIds }, kind: "bonus", direction: "credit" } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$targetUser", lastBonusAt: { $first: "$createdAt" } } },
    ]).toArray()

    // Son yatırım kaydı: forcelab + meeldev birleştir
    const approvedStatuses = ["approved", "completed", "success", "confirmed"]
    const [lastForcelab, lastMeeldev] = await Promise.all([
      forcelabCol.aggregate([
        { $match: { userId: { $in: userObjectIds }, status: { $in: approvedStatuses } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$userId", lastDepositAt: { $first: "$createdAt" } } },
      ]).toArray(),
      meeldevCol.aggregate([
        { $match: { userId: { $in: userObjectIds }, status: { $in: approvedStatuses } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$userId", lastDepositAt: { $first: "$createdAt" } } },
      ]).toArray(),
    ])

    // userId → tarih map'leri
    const bonusMap  = new Map(lastBonusDocs.map((d: any) => [String(d._id), new Date(d.lastBonusAt)]))
    const depositMapRaw = new Map<string, Date>()
    for (const d of [...lastForcelab, ...lastMeeldev]) {
      const key = String(d._id)
      const date = new Date(d.lastDepositAt)
      if (!depositMapRaw.has(key) || depositMapRaw.get(key)! < date) {
        depositMapRaw.set(key, date)
      }
    }

    // Son işlem: bonus ve deposit tarihlerini karşılaştır
    function getLastTx(userId: string): { type: "bonus" | "deposit" | "none"; date: string | null } {
      const bonusDate   = bonusMap.get(userId)
      const depositDate = depositMapRaw.get(userId)
      if (!bonusDate && !depositDate) return { type: "none", date: null }
      if (bonusDate && !depositDate) return { type: "bonus", date: bonusDate.toISOString() }
      if (!bonusDate && depositDate) return { type: "deposit", date: depositDate.toISOString() }
      return bonusDate! > depositDate!
        ? { type: "bonus",   date: bonusDate!.toISOString() }
        : { type: "deposit", date: depositDate!.toISOString() }
    }

    // Tüm kullanıcılar listesi
    const users = allDocs.map((doc: any) => {
      const ips: any[] = Array.isArray(doc.ips) ? doc.ips : []
      const sortedIps = [...ips].sort((a: any, b: any) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      )
      const lastTx = getLastTx(String(doc._id))
      return {
        _id: String(doc._id),
        username: doc.username,
        name: doc.name,
        rank: doc.rank,
        createdAt: doc.createdAt?.toISOString?.() ?? String(doc.createdAt ?? ""),
        ipCount: new Set(ips.map((ip: any) => ip.address).filter(Boolean)).size,
        lastIp: sortedIps[0]?.address ?? null,
        lastTxType: lastTx.type,
        lastTxDate: lastTx.date,
      }
    })

    return NextResponse.json({ success: true, conflicts, users })
  } catch (err) {
    console.error("[affiliate/ip-analysis] error:", err)
    return NextResponse.json({ success: false, message: "Sunucu hatası." }, { status: 500 })
  }
}
