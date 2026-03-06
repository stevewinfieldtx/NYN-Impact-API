// Check what customers, projects, and sites exist in the DB
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  console.log('=== CUSTOMERS ===');
  const customers = await pool.query('SELECT id, name, email, password_hash IS NOT NULL as has_password FROM customers ORDER BY created_at');
  customers.rows.forEach(c => console.log(`  ${c.name} | ${c.email} | pw: ${c.has_password}`));

  console.log('\n=== PROJECTS ===');
  const projects = await pool.query('SELECT p.id, p.slug, p.business_name, p.status, p.github_repo, c.email as customer_email FROM projects p JOIN customers c ON p.customer_id = c.id ORDER BY p.created_at');
  projects.rows.forEach(p => console.log(`  ${p.slug} | ${p.business_name} | ${p.status} | repo: ${p.github_repo || 'NONE'} | owner: ${p.customer_email}`));

  console.log('\n=== GENERATED SITES ===');
  const sites = await pool.query(`
    SELECT gs.id, gs.version_label, gs.is_published, gs.vercel_url, 
           gs.template_code IS NOT NULL as has_template,
           gs.content_schema IS NOT NULL as has_content,
           p.slug, p.business_name
    FROM generated_sites gs 
    JOIN projects p ON gs.project_id = p.id 
    ORDER BY gs.created_at
  `);
  sites.rows.forEach(s => console.log(`  ${s.slug} | ${s.version_label} | published: ${s.is_published} | template: ${s.has_template} | content: ${s.has_content} | url: ${s.vercel_url || 'NONE'}`));

  console.log('\n=== PORTAL URLS ===');
  projects.rows.forEach(p => {
    console.log(`  ${p.business_name}: https://nynimpact.com/cus/${p.slug}`);
  });

  await pool.end();
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
