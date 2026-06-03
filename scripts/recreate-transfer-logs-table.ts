import { neon } from "@neondatabase/serverless"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL not set")
}

const sql = neon(databaseUrl)

async function main() {
  try {
    console.log("Dropping affiliate_transfer_logs table...")
    await sql`DROP TABLE IF EXISTS affiliate_transfer_logs`

    console.log("Creating affiliate_transfer_logs table with correct schema...")
    await sql`
      CREATE TABLE affiliate_transfer_logs (
        id SERIAL PRIMARY KEY,
        from_username VARCHAR(255) NOT NULL,
        to_partner_username VARCHAR(255) NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'completed',
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log("✓ affiliate_transfer_logs table recreated")
  } catch (err) {
    console.error("Error:", err)
    process.exit(1)
  }
}

main()
