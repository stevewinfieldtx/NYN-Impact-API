const pg = require('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Just clear the bad template so we can regenerate it
  // Does NOT touch business_url or anything else
  await pool.query("UPDATE generated_sites SET template_code = NULL WHERE id = '9f058cff-d440-4b95-8950-fea7f99c2447'");
  console.log('Cleared bad template for Melissa');
  console.log('Now call the generate API endpoint to create a fresh one from scratch');
  await pool.end();
})();
