import { rmSync, readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const root = "/vercel/share/v0-project"

// 1. Clear .next cache
const nextDir = join(root, ".next")
if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true })
  console.log("[v0] Deleted .next directory")
} else {
  console.log("[v0] .next directory not found, skipping")
}

// 2. Overwrite lib/mongodb.ts with correct content (no mongodb native import)
const mongodbTs = join(root, "lib/mongodb.ts")
const correctContent = `// cache-bust: ${Date.now()}
import mongoose from "mongoose"

const URI = process.env.MONGODB_URI || ""

const g = global as typeof globalThis & {
  _mConn?: typeof mongoose
  _mProm?: Promise<typeof mongoose>
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose
  if (!g._mProm) {
    g._mProm = mongoose
      .connect(URI, {
        dbName: "fonbet",
        bufferCommands: false,
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        family: 4,
      })
      .then((m) => {
        console.log("[v0] MongoDB connected")
        g._mConn = m
        return m
      })
      .catch((e) => {
        g._mProm = undefined
        throw e
      })
  }
  try {
    await g._mProm
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
`

writeFileSync(mongodbTs, correctContent, "utf8")
console.log("[v0] Rewrote lib/mongodb.ts")

// 3. Verify
const actual = readFileSync(mongodbTs, "utf8")
console.log("[v0] First line of lib/mongodb.ts:", actual.split("\n")[0])
console.log("[v0] Contains MongoClient:", actual.includes("MongoClient"))
console.log("[v0] Contains mongoose:", actual.includes("mongoose"))
