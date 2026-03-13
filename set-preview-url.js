const pg = require('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Set Melissa's site to use the preview branch URL in the editor
  await pool.query(
    "UPDATE generated_sites SET vercel_url = 'https://ws-melissavipmagic-git-nyn-preview-wintech-projcts.vercel.app' WHERE id = '9f058cff-d440-4b95-8950-fea7f99c2447'"
  );

  const r = await pool.query("SELECT gs.id, p.business_name, gs.vercel_url FROM generated_sites gs JOIN projects p ON gs.project_id = p.id");
  console.log('Sites:');
  r.rows.forEach(s => console.log('  ' + s.business_name + ' -> ' + (s.vercel_url || '(none)')));

  await pool.end();
  console.log('Done');
})();
