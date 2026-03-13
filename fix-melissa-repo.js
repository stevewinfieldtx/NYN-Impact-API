const pg = require('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  await pool.query("UPDATE projects SET github_repo = 'stevewinfieldtx/ws-melissavipmagic' WHERE slug = 'melissa-vip-magic'");
  
  const r = await pool.query("SELECT slug, business_name, github_repo FROM projects WHERE github_repo IS NOT NULL");
  console.log('Projects with repos:');
  r.rows.forEach(p => console.log('  ' + p.slug + ' -> ' + p.github_repo));
  
  await pool.end();
  console.log('Done');
})();
