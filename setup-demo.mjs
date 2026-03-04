// Create demo customer, project, and site for testing
import pg from 'pg';
import { createHash } from 'crypto';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

const DEMO_CONTENT = {
  meta: {
    title: "Riverside Coffee Co.",
    tagline: "Craft Coffee in the Heart of Downtown",
    contact_email: "hello@riversidecoffee.com",
    contact_name: "Sarah Mitchell",
    phone: "(512) 555-0188",
    year_started: "2019"
  },
  hero: {
    badge: "Now Open 7 Days a Week",
    headline1: "Life's Too Short",
    headline2: "for Bad Coffee",
    subheadline: "Locally roasted, ethically sourced, served with a smile. Visit our downtown location or order online.",
    cta_primary: "Order Online",
    cta_secondary: "View Our Menu"
  },
  stats: [
    { value: "12+", label: "Single Origins" },
    { value: "5★", label: "Google Rating" },
    { value: "2,000+", label: "Cups per Week" },
    { value: "100%", label: "Fair Trade" }
  ],
  menu: {
    heading: "Our Menu",
    description: "Something for every kind of coffee lover.",
    categories: [
      {
        name: "Espresso Drinks",
        items: [
          { name: "Americano", price: "$3.50", description: "Bold double shot with hot water" },
          { name: "Cappuccino", price: "$4.50", description: "Equal parts espresso, steamed milk, foam" },
          { name: "Oat Milk Latte", price: "$5.00", description: "Our most popular drink" },
          { name: "Mocha", price: "$5.50", description: "Espresso, chocolate, steamed milk, whipped cream" }
        ]
      },
      {
        name: "Cold Drinks",
        items: [
          { name: "Cold Brew", price: "$4.00", description: "Slow-steeped 18 hours" },
          { name: "Iced Matcha Latte", price: "$5.50", description: "Ceremonial grade matcha with oat milk" },
          { name: "Honey Lavender Latte", price: "$5.75", description: "Seasonal favorite — iced or hot" }
        ]
      },
      {
        name: "Food",
        items: [
          { name: "Avocado Toast", price: "$8.00", description: "Sourdough, smashed avo, everything seasoning" },
          { name: "Banana Bread", price: "$3.50", description: "Baked fresh daily" },
          { name: "Breakfast Burrito", price: "$9.00", description: "Eggs, cheese, black beans, salsa verde" }
        ]
      }
    ]
  },
  story: {
    heading: "Our Story",
    paragraphs: [
      "Riverside Coffee started in 2019 with a simple idea: great coffee doesn't have to be complicated.",
      "We source our beans directly from farms in Colombia, Ethiopia, and Guatemala. We roast in small batches right here in town.",
      "Whether you're grabbing a quick espresso or settling in with a book, we want Riverside to feel like your second living room."
    ]
  },
  hours: {
    heading: "Visit Us",
    schedule: [
      { days: "Monday – Friday", hours: "6:30 AM – 7:00 PM" },
      { days: "Saturday", hours: "7:00 AM – 8:00 PM" },
      { days: "Sunday", hours: "8:00 AM – 5:00 PM" }
    ],
    address: "412 Main Street, Downtown Austin, TX 78701"
  },
  differentiators: [
    { title: "Roasted Locally", desc: "Small-batch roasting every Tuesday and Friday at our Austin roastery." },
    { title: "Direct Trade", desc: "We pay above fair-trade prices and visit our partner farms annually." },
    { title: "Zero Waste Goal", desc: "Compostable cups, grounds recycling program, and no single-use plastic." },
    { title: "Community First", desc: "10% of weekend profits go to local schools and youth programs." }
  ],
  footer: {
    description: "Riverside Coffee Co. — Craft coffee, local community, zero pretension."
  }
};

async function run() {
  console.log('Setting up demo...');

  // Add password column if not exists
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT`);

  // Upsert demo customer
  const pwHash = hashPassword('changeme123');
  const customer = await pool.query(`
    INSERT INTO customers (name, email, phone, password_hash)
    VALUES ('Steve Winfield', 'swinfield@hotmail.com', '4257538897', $1)
    ON CONFLICT (email) DO UPDATE SET password_hash = $1
    RETURNING id
  `, [pwHash]);
  const customerId = customer.rows[0].id;
  console.log('✓ Customer:', customerId);

  // Upsert demo project
  const project = await pool.query(`
    INSERT INTO projects (customer_id, business_name, business_url, slug, status)
    VALUES ($1, 'Riverside Coffee Co.', 'https://riversidecoffee.com', 'riverside-coffee', 'editing')
    ON CONFLICT (slug) DO UPDATE SET customer_id = $1, status = 'editing'
    RETURNING id
  `, [customerId]);
  const projectId = project.rows[0].id;
  console.log('✓ Project:', projectId);

  // Delete old sites for this project (clean slate)
  await pool.query(`DELETE FROM edit_history WHERE site_id IN (SELECT id FROM generated_sites WHERE project_id = $1)`, [projectId]);
  await pool.query(`DELETE FROM generated_sites WHERE project_id = $1`, [projectId]);

  // Create demo site
  const site = await pool.query(`
    INSERT INTO generated_sites (project_id, version_label, content_schema, is_selected, is_published)
    VALUES ($1, 'Version A', $2, true, false)
    RETURNING id
  `, [projectId, JSON.stringify(DEMO_CONTENT)]);
  const siteId = site.rows[0].id;
  console.log('✓ Site:', siteId);

  console.log('\n========================================');
  console.log('DEMO READY');
  console.log('========================================');
  console.log('Portal URL:  /cus/riverside-coffee');
  console.log('Email:       swinfield@hotmail.com');
  console.log('Password:    changeme123');
  console.log('Site ID:     ' + siteId);
  console.log('Edit URL:    /cus/riverside-coffee/edit?site=' + siteId);
  console.log('========================================');
  console.log('\nThings to try in the chat editor:');
  console.log('  "Change the headline to Wake Up and Smell the Coffee"');
  console.log('  "Update the tagline to Premium Roasts Since 2019"');
  console.log('  "Change the Americano price to $4.00"');
  console.log('  "Update our hours — close at 6 PM on weekdays"');
  console.log('  "Change the badge to Grand Opening Special"');
  console.log('  "Update the story to mention we now have 3 locations"');

  await pool.end();
  console.log('\n✅ Done');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
