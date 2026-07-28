// v3 - mongoose only
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mongoose = require("mongoose") as typeof import("mongoose")

const URI = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || ""

const g = global as typeof globalThis & {
  _mConn?: typeof mongoose
  _mProm?: Promise<typeof mongoose>
}

export async function connectDB() {
  // Always check database name — if wrong, force disconnect
  const isConnected = mongoose.connection.readyState === 1
  const isWrongDB = isConnected && mongoose.connection.db?.databaseName !== "bizzocazino"
  
  if (isWrongDB) {
    console.log("[v0] Wrong database connected:", mongoose.connection.db?.databaseName, "→ Forcing disconnect...")
    try {
      // Close the connection immediately
      await mongoose.connection.close()
      // Force reset promise
      g._mProm = undefined
      g._mConn = undefined
      // Small delay to ensure socket is truly closed
      await new Promise(r => setTimeout(r, 100))
    } catch (e) {
      console.error("[v0] Disconnect error:", e)
      g._mProm = undefined
      g._mConn = undefined
    }
  }

  // Check again after potential disconnect
  if (
    mongoose.connection.readyState === 1 && 
    mongoose.connection.db?.databaseName === "bizzocazino"
  ) {
    return mongoose
  }

  // If already connecting, wait for it
  if (g._mProm) {
    try { await g._mProm } catch (e) { g._mProm = undefined; throw e }
    // After promise resolves, verify database is correct
    if (mongoose.connection.db?.databaseName !== "bizzocazino") {
      console.log("[v0] Promise resolved but wrong DB, retrying...")
      g._mProm = undefined
      return connectDB() // Recursive call with clean state
    }
    return mongoose
  }

  // New connection
  g._mProm = mongoose
    .connect(URI, { dbName: "bizzocazino", bufferCommands: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, family: 4 })
    .then((m) => { console.log("[v0] MongoDB connected to bizzocazino"); return m })
    .catch((e) => { console.error("[v0] MongoDB connection failed:", e.message); g._mProm = undefined; throw e })

  try { 
    await g._mProm 
    // Verify after connection
    if (mongoose.connection.db?.databaseName !== "bizzocazino") {
      throw new Error("Connected but to wrong database: " + mongoose.connection.db?.databaseName)
    }
  } catch (e) { 
    g._mProm = undefined
    throw e 
  }
  
  return mongoose
}

export async function getDb() {
  await connectDB()
  return mongoose.connection.db!
}
