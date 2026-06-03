import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  try {
    console.log('[v0] Creating affiliate tables...')

    // Create affiliate_users table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(50) NOT NULL CHECK (role IN ('superadmin', 'admin', 'partner')),
        ref_code VARCHAR(100),
        commission_rate DECIMAL(5,2),
        commission_type VARCHAR(50) CHECK (commission_type IN ('deposit', 'net')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_users table created')

    // Create affiliate_transfer_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_transfer_logs (
        id SERIAL PRIMARY KEY,
        from_user_id VARCHAR(255) NOT NULL,
        from_username VARCHAR(255) NOT NULL,
        to_partner_id VARCHAR(255) NOT NULL,
        to_partner_username VARCHAR(255) NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        performed_by_role VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'completed',
        reason TEXT,
        ip_address VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_transfer_logs table created')

    // Create affiliate_stats table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_stats (
        id SERIAL PRIMARY KEY,
        partner_username VARCHAR(255) NOT NULL UNIQUE,
        total_referrals INT DEFAULT 0,
        total_deposits DECIMAL(15,2) DEFAULT 0,
        total_earnings DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_stats table created')

    // Create affiliate_deposits table
    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_deposits (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        partner_id VARCHAR(255) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        commission_amount DECIMAL(15,2),
        status VARCHAR(50) NOT NULL DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    console.log('✓ affiliate_deposits table created')

    console.log('[v0] ✅ All tables created successfully!')
    process.exit(0)
  } catch (err) {
    console.error('[v0] Error creating tables:', err)
    process.exit(1)
  }
}

main()
