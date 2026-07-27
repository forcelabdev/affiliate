// v3 - mongoose only
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mongoose = require("mongoose") as typeof import("mongoose")

const URI = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || ""

const g = global as typeof globalThis & {
  _mConn?: typeof mongoose
  _mProm?: Promise<typeof mongoose>
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose
  if (!g._mProm) {
    g._mProm = mongoose
      .connect(URI, { dbName: "bizzocasino", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
      .then((m) => { console.log("[v0] MongoDB connected"); g._mConn = m; return m })
      .catch((e) => { g._mProm = undefined; throw e })
  }
  try { await g._mProm } catch (e) { g._mProm = undefined; throw e }
  return mongoose
}

export async function getDb() {
  await connectDB()
  return mongoose.connection.db!
}
