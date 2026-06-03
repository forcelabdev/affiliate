import mongoose from "mongoose"
import * as dotenv from "dotenv"

dotenv.config()

async function seedAffiliateUsers() {
  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) {
      console.error("❌ MONGODB_URI env var not set")
      process.exit(1)
    }

    // Connect
    await mongoose.connect(mongoUri)
    console.log("✓ Connected to MongoDB")

    const db = mongoose.connection.db!
    const collection = db.collection("affiliate_users")

    // Get AFFILIATE_USERS from env
    const rawEnv = process.env.AFFILIATE_USERS
    let users: any[] = []

    if (rawEnv) {
      try {
        users = JSON.parse(rawEnv)
        console.log(`✓ Parsed ${users.length} users from AFFILIATE_USERS env`)
      } catch (err) {
        console.error("❌ Failed to parse AFFILIATE_USERS env:", err)
        process.exit(1)
      }
    } else {
      console.warn("⚠ AFFILIATE_USERS env not set, using all 16 users")
      users = [
        {"username":"superadmin","password":"SuperAdmin@2024","role":"superadmin","name":"Super Admin"},
        {"username":"senaadmin","password":"Admin@2024","role":"admin","name":"Sena Admin","refCode":"sena","commissionRate":10,"commissionType":"deposit"},
        {"username":"demo_partner","password":"partner123","role":"partner","name":"Demo Partner","refCode":"demokod","commissionRate":10,"commissionType":"deposit"},
        {"username":"admin","password":"admin123","role":"admin","name":"Admin"},
        {"username":"nil","password":"nil@2024","role":"partner","name":"Nil","refCode":"nil","commissionRate":10,"commissionType":"deposit"},
        {"username":"ela","password":"ela@2024","role":"partner","name":"Ela","refCode":"ela","commissionRate":10,"commissionType":"deposit"},
        {"username":"merve","password":"mer@2024","role":"partner","name":"Merve","refCode":"merve","commissionRate":10,"commissionType":"deposit"},
        {"username":"ekrem","password":"ekr@2024","role":"partner","name":"Ekrem","refCode":"ekrem","commissionRate":10,"commissionType":"deposit"},
        {"username":"ali","password":"ali@2024","role":"partner","name":"Ali","refCode":"ali","commissionRate":10,"commissionType":"deposit"},
        {"username":"ebru","password":"ebr@2024","role":"partner","name":"Ebru","refCode":"ebru","commissionRate":10,"commissionType":"deposit"},
        {"username":"gul","password":"gul@2024","role":"partner","name":"Gül","refCode":"gul","commissionRate":10,"commissionType":"deposit"},
        {"username":"buse","password":"bus@2024","role":"partner","name":"Buse","refCode":"buse","commissionRate":10,"commissionType":"deposit"},
        {"username":"oguz","password":"ogu@2024","role":"partner","name":"Oğuz","refCode":"oguz","commissionRate":10,"commissionType":"deposit"},
        {"username":"irem","password":"ire@2024","role":"partner","name":"İrem","refCode":"irem","commissionRate":10,"commissionType":"deposit"},
        {"username":"damla","password":"dam@2024","role":"partner","name":"Damla","refCode":"damla","commissionRate":10,"commissionType":"deposit"},
        {"username":"buket","password":"buk@2024","role":"partner","name":"Buket","refCode":"buket","commissionRate":10,"commissionType":"deposit"}
      ]
    }

    // Clear existing
    await collection.deleteMany({})
    console.log("✓ Cleared existing affiliate_users")

    // Insert new
    const result = await collection.insertMany(users)
    console.log(`✓ Inserted ${result.insertedCount} users`)

    // Verify
    const count = await collection.countDocuments()
    console.log(`✓ Verification: ${count} users in DB`)

    await mongoose.disconnect()
    console.log("✓ Disconnected\n✅ Seed complete!")
  } catch (err) {
    console.error("❌ Seed error:", err)
    process.exit(1)
  }
}

seedAffiliateUsers()
