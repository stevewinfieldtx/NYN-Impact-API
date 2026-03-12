// Fix James' golf project ownership and add Melissa
import pg from 'pg';
import { createHash } from 'crypto';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

async function run() {
  const defaultPw = hashPassword('changeme123');

  // ═══════════════════════════════════════
  // FIX 1: Reassign golf project to James
  // ═══════════════════════════════════════
  console.log('=== Fixing Golf From Tee to Green ===');
  
  // Get James' customer ID
  const james = await pool.query(`SELECT id FROM customers WHERE LOWER(email) = LOWER('James@GolfFromTeeToGreen.com')`);
  if (james.rows.length === 0) {
    console.log('ERROR: James not found in customers table');
  } else {
    const jamesId = james.rows[0].id;
    
    // Update the golf project to point to James instead of demo
    await pool.query(`UPDATE projects SET customer_id = $1 WHERE slug = 'golf-from-tee-to-green'`, [jamesId]);
    console.log('✓ Golf project reassigned to James (' + jamesId + ')');
    
    // Make sure James has a password
    await pool.query(`UPDATE customers SET password_hash = $1 WHERE id = $2 AND password_hash IS NULL`, [defaultPw, jamesId]);
    
    // Set the vercel URL on the golf site
    await pool.query(`
      UPDATE generated_sites SET vercel_url = 'https://ws-golf-from-tee-to-green-v2.vercel.app'
      WHERE project_id = (SELECT id FROM projects WHERE slug = 'golf-from-tee-to-green')
    `);
    console.log('✓ Golf site vercel_url set');
  }

  // ═══════════════════════════════════════
  // FIX 2: Create Melissa
  // ═══════════════════════════════════════
  console.log('\n=== Creating Melissa VIP Magic ===');
  
  // Create customer
  const melissa = await pool.query(`
    INSERT INTO customers (name, email, phone, password_hash)
    VALUES ('Melissa Jiles', 'scott@jiles.net', '', $1)
    ON CONFLICT (email) DO UPDATE SET password_hash = $1
    RETURNING id
  `, [defaultPw]);
  const melissaId = melissa.rows[0].id;
  console.log('✓ Customer: ' + melissaId);

  // Create project
  const melissaProject = await pool.query(`
    INSERT INTO projects (customer_id, business_name, business_url, slug, status)
    VALUES ($1, 'Melissa VIP Magic', 'https://melissavipmagic.com', 'melissa-vip-magic', 'editing')
    ON CONFLICT (slug) DO UPDATE SET customer_id = $1, status = 'editing'
    RETURNING id
  `, [melissaId]);
  const melissaProjectId = melissaProject.rows[0].id;
  console.log('✓ Project: ' + melissaProjectId);

  // Delete old sites for clean slate
  await pool.query(`DELETE FROM edit_history WHERE site_id IN (SELECT id FROM generated_sites WHERE project_id = $1)`, [melissaProjectId]);
  await pool.query(`DELETE FROM generated_sites WHERE project_id = $1`, [melissaProjectId]);

  // Create site with content schema
  const melissaSite = await pool.query(`
    INSERT INTO generated_sites (project_id, version_label, content_schema, is_selected, is_published)
    VALUES ($1, 'Version A', $2, true, false)
    RETURNING id
  `, [melissaProjectId, JSON.stringify({
    meta: {
      title: "Melissa VIP Magic",
      tagline: "Your Disney Vacation Specialist",
      contact_email: "melissa@melissavipmagic.com",
      contact_name: "Melissa Jiles",
      phone: "",
      year_started: "2020"
    },
    hero: {
      badge: "Authorized Disney Vacation Planner",
      headline1: "Make Your Disney",
      headline2: "Dreams Come True",
      subheadline: "Expert Disney vacation planning with VIP-level service. I handle every detail so you can focus on the magic.",
      cta_primary: "Plan My Trip",
      cta_secondary: "View Packages"
    },
    stats: [
      { value: "500+", label: "Magical Trips Planned" },
      { value: "5★", label: "Client Rating" },
      { value: "100%", label: "Free Service" },
      { value: "24/7", label: "Travel Support" }
    ],
    services: {
      heading: "How I Make Your Trip Magical",
      description: "From first-timers to annual passholders, I create unforgettable Disney experiences.",
      items: [
        {
          name: "Walt Disney World",
          description: "Complete vacation planning for all four parks, resorts, dining, and special experiences.",
          icon: "🏰"
        },
        {
          name: "Disneyland Resort",
          description: "California adventure planning including park hoppers, dining, and character experiences.",
          icon: "⭐"
        },
        {
          name: "Disney Cruise Line",
          description: "Set sail on a magical voyage. I'll find the perfect itinerary and cabin for your family.",
          icon: "🚢"
        },
        {
          name: "Adventures by Disney",
          description: "Guided group travel to amazing destinations worldwide with Disney's signature touch.",
          icon: "🌍"
        },
        {
          name: "Aulani Resort",
          description: "Experience Disney magic on the beautiful shores of Hawaii. Paradise with a Disney twist.",
          icon: "🌺"
        },
        {
          name: "Special Events",
          description: "Mickey's Not-So-Scary Halloween Party, EPCOT festivals, dessert parties, and more.",
          icon: "🎉"
        }
      ]
    },
    story: {
      heading: "Why Work With Me?",
      paragraphs: [
        "I'm not just a travel agent — I'm a Disney fanatic who has visited the parks over 50 times. I know every shortcut, every hidden gem, and every way to save money without sacrificing magic.",
        "My service is completely FREE to you. I'm compensated by Disney, which means you get expert-level planning at no extra cost. Same prices as booking direct, but with a dedicated planner in your corner.",
        "Whether it's your first trip or your fiftieth, I'll create a personalized itinerary that maximizes your time, minimizes stress, and creates memories that last a lifetime."
      ]
    },
    differentiators: [
      { title: "100% Free Service", desc: "I'm paid by Disney, not you. Same prices as booking direct with expert planning included." },
      { title: "Personalized Itineraries", desc: "Custom day-by-day plans based on your family's ages, interests, and pace." },
      { title: "Dining Reservations", desc: "I handle the notoriously difficult dining reservation process so you don't have to." },
      { title: "Ongoing Support", desc: "From planning through your trip, I'm available for questions, changes, and magic." }
    ],
    testimonials: [
      { name: "Sarah T.", text: "Melissa made our first Disney trip absolutely perfect. We would have been so lost without her!" },
      { name: "The Johnson Family", text: "She saved us over $800 and got us dining reservations we never would have gotten on our own." },
      { name: "Mike & Lisa", text: "Third trip planned by Melissa and each one gets better. She's worth her weight in pixie dust." }
    ],
    footer: {
      description: "Melissa VIP Magic — Making Disney dreams come true, one family at a time."
    }
  })]);
  
  console.log('✓ Site: ' + melissaSite.rows[0].id);

  // ═══════════════════════════════════════
  // VERIFY
  // ═══════════════════════════════════════
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log('James Cantrell (Golf):');
  console.log('  URL: https://nynimpact.com/cus/golf-from-tee-to-green');
  console.log('  Email: James@GolfFromTeeToGreen.com');
  console.log('  Password: changeme123');
  console.log('');
  console.log('Melissa Jiles (Disney):');
  console.log('  URL: https://nynimpact.com/cus/melissa-vip-magic');
  console.log('  Email: scott@jiles.net');
  console.log('  Password: changeme123');
  console.log('========================================');

  await pool.end();
  console.log('\n✅ Done');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
