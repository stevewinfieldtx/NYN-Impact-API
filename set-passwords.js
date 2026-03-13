const pg = require('pg');
const crypto = require('crypto');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

(async () => {
  const newHash = hashPw('password123');

  await pool.query("UPDATE customers SET password_hash = $1 WHERE LOWER(email) = LOWER('scott@jiles.net')", [newHash]);
  await pool.query("UPDATE customers SET password_hash = $1 WHERE LOWER(email) = LOWER('James@GolfFromTeeToGreen.com')", [newHash]);

  const r = await pool.query("SELECT name, email FROM customers WHERE LOWER(email) IN (LOWER('scott@jiles.net'), LOWER('James@GolfFromTeeToGreen.com'))");
  r.rows.forEach(c => console.log('  ' + c.name + ' (' + c.email + ') -> password123'));

  await pool.end();
  console.log('Done');
})();
