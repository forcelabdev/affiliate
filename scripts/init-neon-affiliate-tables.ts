import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  console.log('[v0] Creating affiliate management tables...')

  try {
    // Create affiliate_users table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(100),
        role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'admin', 'partner')),
        ref_code VARCHAR(50) UNIQUE,
        commission_rate DECIMAL(5, 2) DEFAULT 0,
        commission_type VARCHAR(20) CHECK (commission_type IN ('deposit', 'net')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_users table created')

    // Create affiliate_transfer_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_transfer_logs (
        id SERIAL PRIMARY KEY,
        from_user_id VARCHAR(100) NOT NULL,
        from_username VARCHAR(50) NOT NULL,
        to_partner_id VARCHAR(100) NOT NULL,
        to_partner_username VARCHAR(50) NOT NULL,
        performed_by VARCHAR(50) NOT NULL,
        performed_by_role VARCHAR(20),
        status VARCHAR(20) DEFAULT 'completed',
        reason TEXT,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_transfer_logs table created')

    // Create affiliate_stats table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_stats (
        id SERIAL PRIMARY KEY,
        partner_username VARCHAR(50) UNIQUE NOT NULL,
        total_referrals INT DEFAULT 0,
        total_deposits DECIMAL(15, 2) DEFAULT 0,
        total_earnings DECIMAL(15, 2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_stats table created')

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_affiliate_users_username ON affiliate_users(username)`
    await sql`CREATE INDEX IF NOT EXISTS idx_affiliate_users_ref_code ON affiliate_users(ref_code)`
    await sql`CREATE INDEX IF NOT EXISTS idx_affiliate_users_role ON affiliate_users(role)`
    await sql`CREATE INDEX IF NOT EXISTS idx_transfer_logs_created_at ON affiliate_transfer_logs(created_at)`
    await sql`CREATE INDEX IF NOT EXISTS idx_affiliate_stats_partner_username ON affiliate_stats(partner_username)`
    console.log('✓ Indexes created')

    console.log('[v0] ✅ All tables created successfully!')
  } catch (error) {
    console.error('[v0] ❌ Error creating tables:', error)
    process.exit(1)
  }
}

main()
