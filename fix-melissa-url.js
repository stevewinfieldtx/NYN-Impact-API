const pg = require('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  await pool.query("UPDATE projects SET business_url = 'https://ws-melissavipmagic.vercel.app/' WHERE slug = 'melissa-vip-magic'");
  
  const r = await pool.query("SELECT slug, business_name, business_url, github_repo FROM projects WHERE github_repo IS NOT NULL");
  console.log('Projects:');
  r.rows.forEach(p => console.log('  ' + p.slug + ' | url: ' + p.business_url + ' | repo: ' + p.github_repo));
  
  await pool.end();
  console.log('Done');
})();
