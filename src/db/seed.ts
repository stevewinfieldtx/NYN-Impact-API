// Database seed — inserts initial demo data
// Called from startup.ts on every deploy (safe to re-run via ON CONFLICT DO UPDATE)

import { pool } from './index';

const GOLF_CONTENT_SCHEMA = {
  meta: {
    title: "Golf From Tee to Green",
    tagline: "Online Golf Instruction Since 1986",
    contact_email: "James@GolfFromTeeToGreen.com",
    contact_name: "James Cantrell",
    phone: "",
    year_started: "1986"
  },
  hero: {
    badge: "Early Access Available",
    headline1: "Learn the Golf Swing",
    headline2: "the Right Way",
    subheadline: "Simple, clear instruction built on fundamentals — from a coach teaching since 1986. Train anywhere. Improve faster.",
    cta_primary: "Explore Membership",
    cta_secondary: "Book a Lesson"
  },
  stats: [
    { value: "37+", label: "Years Teaching" },
    { value: "∞", label: "Decades of Coaching" },
    { value: "📚", label: "Growing Video Library" },
    { value: "🎯", label: "Step-by-step Skill Building" }
  ],
  membership: {
    heading: "Membership Options",
    description: "Choose the option that fits how you learn.",
    tiers: [
      {
        name: "Full Access",
        price: "$497",
        original: "$1,997",
        note: "one-time",
        badge: "Best Value",
        features: [
          "Full access to all video content",
          "New lessons added over time",
          "Optional coaching add-on",
          "Structured learning path",
          "One-time payment"
        ]
      },
      {
        name: "Annual",
        price: "$197/year",
        original: "$297/year",
        note: "/year",
        badge: "Most Popular",
        features: [
          "Full video library access",
          "Structured learning path",
          "Cancel anytime"
        ]
      },
      {
        name: "Monthly",
        price: "$29/month",
        original: "$49/month",
        note: "/month",
        badge: "Flexible",
        features: [
          "Full video library access",
          "Cancel anytime",
          "7-day free trial"
        ]
      }
    ]
  },
  story: {
    heading: "From the Range to the World",
    paragraphs: [
      "I started giving golf lessons in 1986. For 37 years, I've been on the range, in the studio, and on the course.",
      "I've seen every fad, every gimmick come and go. And through it all, I've stuck to one simple principle: tell the truth about the swing mechanics.",
      "At 63, I was given an opportunity to take everything I've learned and share it with golfers everywhere.",
      "My mission now is simple: help thousands of golfers play better by understanding what actually works."
    ]
  },
  differentiators: [
    { title: "Clear Mechanics", desc: "Understand exactly what your body should be doing at every point in the swing." },
    { title: "No Secrets", desc: "I share everything I know. No holding back the 'pro secrets' — you get it all." },
    { title: "Real Progress", desc: "Trackable improvement with clear drills and practice plans that actually work." }
  ],
  footer: {
    description: "37 years of golf instruction, now available online. Learn the truth about your swing from anywhere in the world."
  }
};

export async function seed() {
  console.log('Seeding NYN Impact database...');
  // Create customer
  const customer = await pool.query(`
    INSERT INTO customers (name, email, phone)
    VALUES ('James Cantrell', 'James@GolfFromTeeToGreen.com', '')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const customerId = customer.rows[0].id;
  console.log('✓ Customer:', customerId);

  // Create project
  const project = await pool.query(`
    INSERT INTO projects (customer_id, business_name, business_url, slug, status, github_repo)
    VALUES ($1, 'Golf From Tee to Green', 'https://ws-golf-from-tee-to-green-v2.vercel.app', 'golf-from-tee-to-green', 'active', 'stevewinfieldtx/ws-GolfFromTeeToGreen-v2')
    ON CONFLICT (slug) DO UPDATE SET 
      business_name = EXCLUDED.business_name,
      github_repo = EXCLUDED.github_repo,
      status = EXCLUDED.status
    RETURNING id
  `, [customerId]);
  const projectId = project.rows[0].id;
  console.log('✓ Project:', projectId);

  // Only insert a generated site if none exists for this project yet
  const existingSite = await pool.query(
    `SELECT id FROM generated_sites WHERE project_id = $1 LIMIT 1`,
    [projectId]
  );

  if (existingSite.rows.length === 0) {
    const site = await pool.query(`
      INSERT INTO generated_sites (project_id, version_label, content_schema, vercel_url, is_selected, is_published)
      VALUES ($1, 'Version A', $2, 'https://ws-golf-from-tee-to-green-v2.vercel.app', true, true)
      RETURNING id
    `, [projectId, JSON.stringify(GOLF_CONTENT_SCHEMA)]);
    const siteId = site.rows[0].id;
    console.log('✓ Generated site:', siteId);
    console.log('\n🎯 Site ID for testing:', siteId);
    console.log('📍 Customer portal URL: /cus/golf-from-tee-to-green');
    console.log('✏️  Edit URL: /cus/golf-from-tee-to-green/edit?site=' + siteId);
  } else {
    console.log('✓ Generated site already exists, skipped insert.');
  }
}
