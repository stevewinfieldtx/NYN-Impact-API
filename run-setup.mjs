// Standalone DB setup — no local imports needed
// Usage: node run-setup.mjs
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const schema = `
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  business_url TEXT,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'lead',
  interview_conversation_id TEXT,
  transcript TEXT,
  autopsy_data JSONB,
  competitor_research JSONB,
  industry_insights JSONB,
  github_repo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS generated_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL DEFAULT 'Version A',
  content_schema JSONB NOT NULL DEFAULT '{}',
  template_code TEXT,
  vercel_url TEXT,
  is_selected BOOLEAN DEFAULT FALSE,
  is_published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES generated_sites(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  ai_prompt TEXT,
  edit_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS site_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES generated_sites(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_key TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const seedSQL = `
-- Insert demo customer
INSERT INTO customers (id, name, email, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Golf Demo', 'demo@golfteetogreen.com', '555-0100')
ON CONFLICT (email) DO NOTHING;

-- Insert demo project
INSERT INTO projects (id, customer_id, business_name, business_url, slug, status, github_repo)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Golf From Tee to Green',
  'https://golffromteetogreen.com',
  'golf-from-tee-to-green',
  'editing',
  'stevewinfieldtx/golf-from-tee-to-green'
)
ON CONFLICT (slug) DO NOTHING;

-- Insert demo generated site
INSERT INTO generated_sites (id, project_id, version_label, content_schema, is_selected, is_published)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'Version A',
  '{
    "meta": {
      "title": "Golf From Tee to Green",
      "tagline": "Premium Golf Experiences in Vietnam",
      "contact_email": "info@golfteetogreen.com",
      "contact_name": "Steve Winfield",
      "phone": "+84 123 456 789",
      "year_started": "2024"
    },
    "hero": {
      "badge": "Vietnam''s Premier Golf Experience",
      "headline1": "Golf From",
      "headline2": "Tee to Green",
      "subheadline": "Luxury golf tourism across Vietnam''s most stunning courses. Three tiers of unforgettable experiences.",
      "cta_primary": "Book Your Experience",
      "cta_secondary": "View Packages"
    },
    "stats": [
      { "value": "15+", "label": "Premier Courses" },
      { "value": "3", "label": "Experience Tiers" },
      { "value": "500+", "label": "Happy Golfers" },
      { "value": "5★", "label": "Average Rating" }
    ],
    "membership": {
      "heading": "Choose Your Experience",
      "description": "From signature rounds to exclusive multi-day golf journeys",
      "tiers": [
        {
          "name": "Signature",
          "price": "$299",
          "original": "$399",
          "note": "per round",
          "badge": "Most Popular",
          "features": ["Premium course access", "Caddie included", "Golf cart", "Lunch at clubhouse", "Equipment rental available"]
        },
        {
          "name": "Preferred",
          "price": "$799",
          "original": "$999",
          "note": "per package",
          "badge": "Best Value",
          "features": ["3 rounds at top courses", "Luxury transport", "5-star hotel stay", "All meals included", "Spa access", "Personal concierge"]
        },
        {
          "name": "The Eight",
          "price": "$2,499",
          "original": "$3,299",
          "note": "per journey",
          "badge": "Ultimate",
          "features": ["8 rounds across Vietnam", "Private helicopter transfers", "Presidential suites", "Michelin dining", "Custom club fitting", "24/7 concierge", "Exclusive course access"]
        }
      ]
    },
    "story": {
      "heading": "Both Sides of the Coin",
      "paragraphs": [
        "Golf From Tee to Green was born from a simple belief: the best golf experiences happen when you see both sides of the coin.",
        "We show you the championship courses AND the hidden local gems. The five-star clubhouses AND the street food stalls where caddies eat. The manicured fairways AND the raw beauty of Vietnam''s coastline.",
        "Founded by a golfer who has played in 48 US states and 100+ countries, we bring a global perspective to every round."
      ]
    },
    "differentiators": [
      { "title": "Local Expertise", "desc": "Our team lives in Da Nang and knows every course, every caddie, every hidden gem." },
      { "title": "Both Sides Philosophy", "desc": "We don''t just show you the tourist version. You get the real Vietnam golf experience." },
      { "title": "Concierge Service", "desc": "From airport pickup to your last putt, every detail is handled." },
      { "title": "Flexible Packages", "desc": "Mix and match experiences. Add extra rounds. Bring non-golfers. We make it work." }
    ],
    "footer": {
      "description": "Premium golf experiences across Vietnam. Three tiers. Infinite memories."
    }
  }'::jsonb,
  true,
  false
)
ON CONFLICT (id) DO NOTHING;
`;

async function run() {
  console.log('Creating tables...');
  await pool.query(schema);
  console.log('✓ Tables created');

  console.log('Seeding demo data...');
  await pool.query(seedSQL);
  console.log('✓ Demo data seeded');

  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
  console.log('Tables:', tables.rows.map(r => r.table_name).join(', '));

  const customers = await pool.query(`SELECT id, name, email FROM customers`);
  console.log('Customers:', customers.rows);

  const sites = await pool.query(`SELECT id, version_label FROM generated_sites`);
  console.log('Sites:', sites.rows);

  await pool.end();
  console.log('\n✅ Done! Your site ID is: 33333333-3333-3333-3333-333333333333');
  console.log('Test portal at: /cus/golf-from-tee-to-green');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
