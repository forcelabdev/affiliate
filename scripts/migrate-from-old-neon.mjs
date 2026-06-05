import pg from 'pg';

const { Pool } = pg;

// Eski veritabanı (kaynak)
const sourcePool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_DO7j0fWVwBoc@ep-young-truth-a4mb4sdg-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

// Yeni veritabanı (hedef) - env'den alınacak
const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

// Kolon eşleştirmeleri (eski -> yeni)
const columnMappings = {
  affiliate_users: {
    // Eski kolonlar -> Yeni kolonlar
    totp_secret: 'two_fa_secret',
    totp_enabled: 'two_fa_enabled',
    // Bu kolonlar direkt aktarılacak
    direct: ['id', 'username', 'password', 'name', 'ref_code', 'commission_rate', 'commission_type', 
             'role', 'created_at', 'updated_at', 'ticket_enabled', 'ticket_threshold', 'ticket_start_date', 'short_link']
  }
};

// Hedef tablonun kolonlarını al
async function getTargetColumns(tableName) {
  const result = await targetPool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = $1
  `, [tableName]);
  return result.rows.map(r => r.column_name);
}

async function migrateTable(tableName) {
  console.log(`\n📦 Migrating table: ${tableName}`);
  
  try {
    // Hedef tablonun kolonlarını al
    const targetColumns = await getTargetColumns(tableName);
    console.log(`  📋 Target columns: ${targetColumns.join(', ')}`);
    
    // Eski veritabanından verileri çek
    const sourceResult = await sourcePool.query(`SELECT * FROM ${tableName}`);
    const rows = sourceResult.rows;
    
    if (rows.length === 0) {
      console.log(`  ⚠️  No data found in ${tableName}`);
      return { table: tableName, migrated: 0, skipped: 0 };
    }
    
    console.log(`  📊 Found ${rows.length} rows`);
    
    let migrated = 0;
    let skipped = 0;
    
    const mapping = columnMappings[tableName] || {};
    
    for (const row of rows) {
      try {
        // Kolon eşleştirmesi yap
        const mappedRow = {};
        
        for (const [oldCol, value] of Object.entries(row)) {
          if (value === undefined || value === null) continue;
          
          // Kolon ismini dönüştür (varsa)
          let newCol = mapping[oldCol] || oldCol;
          
          // Hedef tabloda bu kolon var mı kontrol et
          if (targetColumns.includes(newCol)) {
            mappedRow[newCol] = value;
          }
        }
        
        if (Object.keys(mappedRow).length === 0) continue;
        
        const cols = Object.keys(mappedRow);
        const values = cols.map(k => mappedRow[k]);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        
        const insertQuery = `
          INSERT INTO ${tableName} (${cols.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT (id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(', ')}
        `;
        
        await targetPool.query(insertQuery, values);
        migrated++;
      } catch (err) {
        console.error(`  ❌ Error inserting row (id: ${row.id}):`, err.message);
        skipped++;
      }
    }
    
    console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
    return { table: tableName, migrated, skipped };
    
  } catch (err) {
    console.error(`  ❌ Error migrating ${tableName}:`, err.message);
    return { table: tableName, migrated: 0, skipped: 0, error: err.message };
  }
}

async function main() {
  console.log('🚀 Starting migration from old Neon database...\n');
  console.log('Source: ep-young-truth-a4mb4sdg-pooler.us-east-1.aws.neon.tech');
  console.log('Target: Current project database\n');
  
  // Önce eski veritabanındaki tabloları kontrol et
  try {
    const tablesResult = await sourcePool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📋 Tables found in source database:');
    tablesResult.rows.forEach(r => console.log(`   - ${r.table_name}`));
    
    // Aktarılacak tablolar (sıralama önemli - foreign key bağımlılıkları)
    const tablesToMigrate = [
      'affiliate_users',
      'players',
      'referred_users',
      'commissions',
      'daily_stats',
      'withdrawals',
      'payment_requests',
      'postbacks',
      'api_data_logs',
      'affiliate_applications'
    ];
    
    const results = [];
    
    for (const table of tablesToMigrate) {
      // Tablonun var olup olmadığını kontrol et
      const exists = tablesResult.rows.some(r => r.table_name === table);
      if (exists) {
        const result = await migrateTable(table);
        results.push(result);
      } else {
        console.log(`\n⏭️  Skipping ${table} - not found in source`);
      }
    }
    
    // Özet
    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    
    let totalMigrated = 0;
    let totalSkipped = 0;
    
    for (const r of results) {
      console.log(`${r.table}: ${r.migrated} migrated, ${r.skipped} skipped${r.error ? ' (ERROR: ' + r.error + ')' : ''}`);
      totalMigrated += r.migrated || 0;
      totalSkipped += r.skipped || 0;
    }
    
    console.log('='.repeat(50));
    console.log(`TOTAL: ${totalMigrated} migrated, ${totalSkipped} skipped`);
    console.log('='.repeat(50));
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main();
