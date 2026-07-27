import mongoose from "mongoose"

const DB_NAME = "bizzocazino"

let isConnecting = false

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING
  if (!uri) throw new Error("MONGODB_URI not set")

  // Zaten doğru veritabanına bağlıysa direkt dön
  if (
    mongoose.connection.readyState === 1 &&
    mongoose.connection.db?.databaseName === DB_NAME
  ) {
    return
  }

  // Yanlış veritabanına bağlıysa önce disconnect yap
  if (mongoose.connection.readyState !== 0) {
    isConnecting = false
    await mongoose.disconnect()
    // Disconnect tamamlanana kadar bekle
    await new Promise<void>((resolve) => {
      if (mongoose.connection.readyState === 0) return resolve()
      mongoose.connection.once("disconnected", () => resolve())
    })
  }

  // Başka bir istek zaten bağlanıyorsa bekle
  if (isConnecting) {
    await new Promise<void>((resolve) => {
      mongoose.connection.once("connected", () => resolve())
    })
    return
  }

  isConnecting = true
  try {
    await mongoose.connect(uri, {
      dbName: DB_NAME,
      bufferCommands: false,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      family: 4,
    })
    await new Promise<void>((resolve) => {
      if (mongoose.connection.db) return resolve()
      mongoose.connection.once("connected", () => resolve())
    })
  } finally {
    isConnecting = false
  }
}
