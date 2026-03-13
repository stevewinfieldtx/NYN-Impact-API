const pg = require('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Set vercel_url for Melissa's generated site
  await pool.query(
    "UPDATE generated_sites SET vercel_url = 'https://ws-melissavipmagic.vercel.app/' WHERE id = '9f058cff-d440-4b95-8950-fea7f99c2447'"
  );
  
  // Verify all sites have URLs
  const r = await pool.query("SELECT gs.id, p.business_name, gs.vercel_url FROM generated_sites gs JOIN projects p ON gs.project_id = p.id");
  console.log('Sites with URLs:');
  r.rows.forEach(s => console.log('  ' + s.business_name + ' -> ' + (s.vercel_url || '(none)')));
  
  await pool.end();
  console.log('Done');
})();
