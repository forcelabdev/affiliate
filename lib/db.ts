import mongoose from "mongoose"

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || ""

declare global {
  // eslint-disable-next-line no-var
  var _dbPromise: Promise<typeof mongoose> | undefined
}

export async function connectDB(): Promise<typeof mongoose> {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set")
  if (mongoose.connection.readyState === 1) return mongoose
  if (!global._dbPromise) {
    global._dbPromise = mongoose
      .connect(MONGODB_URI, {
        dbName: "bizzocasino",
        bufferCommands: false,
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        family: 4,
      })
      .then((m) => {
        console.log("[v0] MongoDB connected")
        return m
      })
      .catch((err) => {
        global._dbPromise = undefined
        throw err
      })
  }
  try {
    await global._dbPromise
  } catch (err) {
    global._dbPromise = undefined
    throw err
  }
  return mongoose
}

export async function getDb() {
  await connectDB()
  return mongoose.connection.db!
}
