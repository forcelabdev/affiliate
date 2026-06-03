import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const AFFILIATE_USERS = [
  { username: 'superadmin', password: 'SuperAdmin@2024', role: 'superadmin', name: 'Super Admin' },
  { username: 'senaadmin', password: 'Admin@2024', role: 'admin', name: 'Sena Admin', refCode: 'sena', commissionRate: 10, commissionType: 'deposit' },
  { username: 'demo_partner', password: 'partner123', role: 'partner', name: 'Demo Partner', refCode: 'demokod', commissionRate: 10, commissionType: 'deposit' },
  { username: 'admin', password: 'admin123', role: 'admin', name: 'Admin' },
  { username: 'nil', password: 'nil@2024', role: 'partner', name: 'Nil', refCode: 'nil', commissionRate: 10, commissionType: 'deposit' },
  { username: 'ela', password: 'ela@2024', role: 'partner', name: 'Ela', refCode: 'ela', commissionRate: 10, commissionType: 'deposit' },
  { username: 'merve', password: 'mer@2024', role: 'partner', name: 'Merve', refCode: 'merve', commissionRate: 10, commissionType: 'deposit' },
  { username: 'ekrem', password: 'ekr@2024', role: 'partner', name: 'Ekrem', refCode: 'ekrem', commissionRate: 10, commissionType: 'deposit' },
  { username: 'ali', password: 'ali@2024', role: 'partner', name: 'Ali', refCode: 'ali', commissionRate: 10, commissionType: 'deposit' },
  { username: 'ebru', password: 'ebr@2024', role: 'partner', name: 'Ebru', refCode: 'ebru', commissionRate: 10, commissionType: 'deposit' },
  { username: 'gul', password: 'gul@2024', role: 'partner', name: 'Gül', refCode: 'gul', commissionRate: 10, commissionType: 'deposit' },
  { username: 'buse', password: 'bus@2024', role: 'partner', name: 'Buse', refCode: 'buse', commissionRate: 10, commissionType: 'deposit' },
  { username: 'oguz', password: 'ogu@2024', role: 'partner', name: 'Oğuz', refCode: 'oguz', commissionRate: 10, commissionType: 'deposit' },
  { username: 'irem', password: 'ire@2024', role: 'partner', name: 'İrem', refCode: 'irem', commissionRate: 10, commissionType: 'deposit' },
  { username: 'damla', password: 'dam@2024', role: 'partner', name: 'Damla', refCode: 'damla', commissionRate: 10, commissionType: 'deposit' },
  { username: 'buket', password: 'buk@2024', role: 'partner', name: 'Buket', refCode: 'buket', commissionRate: 10, commissionType: 'deposit' },
]

async function main() {
  console.log('[v0] Seeding affiliate users to Neon...')

  try {
    for (const user of AFFILIATE_USERS) {
      await sql`
        INSERT INTO affiliate_users (username, password, name, role, ref_code, commission_rate, commission_type)
        VALUES (${user.username}, ${user.password}, ${user.name}, ${user.role}, ${user.refCode || null}, ${user.commissionRate || 0}, ${user.commissionType || null})
        ON CONFLICT (username) DO UPDATE SET
          password = EXCLUDED.password,
          name = EXCLUDED.name,
          ref_code = EXCLUDED.ref_code,
          commission_rate = EXCLUDED.commission_rate,
          commission_type = EXCLUDED.commission_type,
          updated_at = NOW()
      `
    }

    console.log(`✓ Seeded ${AFFILIATE_USERS.length} users`)

    // Create stats entries for partners
    const partners = AFFILIATE_USERS.filter(u => u.role === 'partner')
    for (const partner of partners) {
      await sql`
        INSERT INTO affiliate_stats (partner_username, total_referrals, total_deposits, total_earnings)
        VALUES (${partner.username}, 0, 0, 0)
      `.catch(() => {
        // Ignore duplicates
      })
    }

    console.log(`✓ Created ${partners.length} stats entries`)
    console.log('[v0] ✅ Seeding complete!')
  } catch (error) {
    console.error('[v0] ❌ Error seeding:', error)
    process.exit(1)
  }
}

main()
