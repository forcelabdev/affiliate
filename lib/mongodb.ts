// v3 - mongoose only
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mongoose = require("mongoose") as typeof import("mongoose")

const URI = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || ""

const g = global as typeof globalThis & {
  _mConn?: typeof mongoose
  _mProm?: Promise<typeof mongoose>
}

export async function connectDB() {
  // Yanlış database'e bağlıysa disconnect et
  if (
    mongoose.connection.readyState === 1 &&
    mongoose.connection.db?.databaseName !== "bizzocazino"
  ) {
    console.log("[v0] Wrong database connected. Disconnecting...")
    await mongoose.disconnect()
    g._mProm = undefined
    g._mConn = undefined
  }

  // Doğru database'e bağlıysa devam et
  if (mongoose.connection.readyState === 1 && mongoose.connection.db?.databaseName === "bizzocazino") {
    return mongoose
  }

  // Bağlantı kuruyorsa bekle
  if (g._mProm) {
    try { await g._mProm } catch (e) { g._mProm = undefined; throw e }
    return mongoose
  }

  // Yeni bağlantı kur
  g._mProm = mongoose
    .connect(URI, { dbName: "bizzocazino", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
    .then((m) => { console.log("[v0] MongoDB connected to bizzocazino"); g._mConn = m; return m })
    .catch((e) => { console.error("[v0] MongoDB connection failed:", e.message); g._mProm = undefined; throw e })

  try { await g._mProm } catch (e) { g._mProm = undefined; throw e }
  return mongoose
}

export async function getDb() {
  await connectDB()
  return mongoose.connection.db!
}
