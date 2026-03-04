// Add password support to customers table
// Usage: set DATABASE_URL=... && node add-passwords.mjs
import pg from 'pg';
import { createHash } from 'crypto';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

async function run() {
  console.log('Adding password column...');
  
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  console.log('✓ password_hash column added');

  const defaultHash = hashPassword('changeme123');
  await pool.query(`UPDATE customers SET password_hash = $1 WHERE password_hash IS NULL`, [defaultHash]);
  
  const customers = await pool.query(`SELECT id, name, email FROM customers`);
  console.log('\nCustomers with passwords set:');
  customers.rows.forEach(c => console.log(`  ${c.name} (${c.email})`));
  console.log(`\nDefault password for all: changeme123`);

  await pool.end();
  console.log('✅ Done');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
