import { NextRequest, NextResponse } from "next/server"
import mongoose from "mongoose"
import { verifyToken } from "@/lib/auth"

async function connectDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db && mongoose.connection.db.databaseName === "bizzocazino") return
  if (mongoose.connection.readyState === 1 && mongoose.connection.db && mongoose.connection.db.databaseName !== "bizzocazino") await mongoose.disconnect()
  const uri = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING
  if (!uri) throw new Error("MONGODB_URI not set")
  await mongoose.connect(uri, { dbName: "bizzocazino", bufferCommands: false, serverSelectionTimeoutMS: 30000 })
}

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("x-auth-token") || ""
    const payload = verifyToken(token)

    if (!payload || (payload.role !== "superadmin" && payload.role !== "admin")) {
      return NextResponse.json({ success: false, message: "Yetki yok." }, { status: 403 })
    }

    await connectDB()
    const users = mongoose.connection.db!.collection("users")

    // Fetch users with no affiliate assignment at all
    // Must have NO referrer, NO redeemedCode, NO referrerUsername
    const unassignedUsers = await users
      .find({
        $and: [
          {
            $or: [
              { "affiliates.referrer": { $exists: false } },
              { "affiliates.referrer": null },
              { "affiliates.referrer": "" },
            ],
          },
          {
            $or: [
              { "affiliates.redeemedCode": { $exists: false } },
              { "affiliates.redeemedCode": null },
              { "affiliates.redeemedCode": "" },
            ],
          },
          {
            $or: [
              { "affiliates.referrerUsername": { $exists: false } },
              { "affiliates.referrerUsername": null },
              { "affiliates.referrerUsername": "" },
            ],
          },
        ],
      })
      .project({ username: 1, rank: 1, birthday: 1, createdAt: 1 })
      .sort({ _id: -1 })
      .limit(200)
      .toArray()

    return NextResponse.json({
      success: true,
      data: unassignedUsers.map((u: any) => ({
        _id: u._id?.toString(),
        username: u.username,
        rank: u.rank,
        birthday: u.birthday,
        createdAt: u.createdAt || null,
      })),
    })
  } catch (err) {
    console.error("[v0] Unassigned users error:", err)
    return NextResponse.json({ success: false, message: "Hata oluştu." }, { status: 500 })
  }
}
