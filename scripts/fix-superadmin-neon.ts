import { neon } from "@neondatabase/serverless"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL not set")
  process.exit(1)
}

async function main() {
  const sql = neon(databaseUrl)

  // Add refCode to superadmin and other users
  try {
    await sql`UPDATE affiliate_users SET ref_code = 'superadmin' WHERE username = 'superadmin'`
    await sql`UPDATE affiliate_users SET ref_code = 'senaadmin' WHERE username = 'senaadmin'`
    await sql`UPDATE affiliate_users SET ref_code = 'admin' WHERE username = 'admin'`
    
    console.log("✅ Updated ref_code for superadmin and admins")
    
    const result = await sql`SELECT username, role, ref_code FROM affiliate_users WHERE role IN ('superadmin', 'admin')`
    console.log("Updated users:", result)
  } catch (err) {
    console.error("Error:", err)
  }
}

main()
