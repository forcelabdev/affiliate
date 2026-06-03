import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  try {
    console.log('[v0] Dropping affiliate tables...')
    
    await sql`DROP TABLE IF EXISTS affiliate_deposits`
    await sql`DROP TABLE IF EXISTS affiliate_transfer_logs`
    await sql`DROP TABLE IF EXISTS affiliate_stats`
    await sql`DROP TABLE IF EXISTS affiliate_users`
    
    console.log('[v0] ✅ All tables dropped!')
    process.exit(0)
  } catch (err) {
    console.error('[v0] Error dropping tables:', err)
    process.exit(1)
  }
}

main()
