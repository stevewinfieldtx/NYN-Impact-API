// Database setup — creates tables if they don't exist
// Called from startup.ts on every deploy (safe to re-run via CREATE TABLE IF NOT EXISTS)

import { pool } from './index';

const schema = `
-- ── Customers ──
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Projects (one per website build) ──
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  business_url TEXT,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'lead' CHECK (status IN ('lead','interview','processing','choosing','editing','active','archived')),
  interview_conversation_id TEXT,
  transcript TEXT,
  autopsy_data JSONB,
  competitor_research JSONB,
  industry_insights JSONB,
  github_repo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Generated Sites (2 per project initially) ──
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

-- ── Edit History ──
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

-- ── Site Images ──
CREATE TABLE IF NOT EXISTS site_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES generated_sites(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_key TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Template Gallery (reusable designs) ──
CREATE TABLE IF NOT EXISTS site_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  industry TEXT,
  description TEXT,
  template_code TEXT NOT NULL,
  thumbnail_url TEXT,
  tags TEXT[] DEFAULT '{}',
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_sites_project ON generated_sites(project_id);
CREATE INDEX IF NOT EXISTS idx_sites_published ON generated_sites(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_edits_site ON edit_history(site_id);
CREATE INDEX IF NOT EXISTS idx_edits_created ON edit_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_site ON site_images(site_id);
`;

export async function setup() {
  console.log('Setting up NYN Impact database...');
  await pool.query(schema);
  console.log('✓ All tables created successfully');

  // ── Migrations (safe to re-run) ──
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS interview_messages JSONB DEFAULT '[]'::jsonb
  `);

  // ── AI Self-Correct columns on generated_sites ──
  await pool.query(`ALTER TABLE generated_sites ADD COLUMN IF NOT EXISTS ai_selfcorrect_enabled BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE generated_sites ADD COLUMN IF NOT EXISTS vercel_project_id TEXT`);
  await pool.query(`ALTER TABLE generated_sites ADD COLUMN IF NOT EXISTS client_email TEXT`);
  await pool.query(`ALTER TABLE generated_sites ADD COLUMN IF NOT EXISTS last_scan_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE generated_sites ADD COLUMN IF NOT EXISTS scan_status TEXT DEFAULT 'pending'`);

  // ── site_issues table ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_issues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id UUID REFERENCES generated_sites(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('auto_scan','client_submitted','content_request')),
      status TEXT DEFAULT 'open' CHECK (status IN ('open','diagnosed','fix_ready','applied','dismissed')),
      severity TEXT CHECK (severity IN ('critical','warning','info')),
      issue_description TEXT,
      ai_diagnosis TEXT,
      ai_fix_recommendation TEXT,
      client_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  // ── site_content_snapshots table ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_content_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id UUID REFERENCES generated_sites(id) ON DELETE CASCADE,
      page_path TEXT,
      content_html TEXT,
      ai_rewrite_suggestion TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','suggested','approved','deployed')),
      requested_by TEXT,
      request_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── AI Self-Correct indexes ──
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_site_issues_site_id ON site_issues(site_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_site_issues_status ON site_issues(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_content_snapshots_site_id ON site_content_snapshots(site_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sites_client_email ON generated_sites(client_email)`);

  console.log('✓ Migrations applied');

  // Verify
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log('Tables:', tables.rows.map((r: { table_name: string }) => r.table_name).join(', '));
}
