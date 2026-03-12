import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { query, queryOne } from '../db';
function hashPw(pw: string): string { return createHash('sha256').update(pw).digest('hex'); }
const router = Router();

// POST /api/customer/lookup — universal login: email + password → customer info + all projects
router.post('/lookup', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }

    const c = await queryOne<{ id: string; name: string; password_hash: string | null }>(
      'SELECT id, name, password_hash FROM customers WHERE LOWER(email) = LOWER($1)', [email.trim()]);

    if (!c) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    if (c.password_hash !== hashPw(password)) { res.status(401).json({ error: 'Invalid email or password' }); return; }

    // Get ALL projects for this customer
    const projects = await query<{ slug: string; business_name: string; status: string }>( 
      'SELECT slug, business_name, status FROM projects WHERE customer_id = $1 ORDER BY created_at DESC', [c.id]);

    // Filter out test projects (slugs starting with "test-")
    const realProjects = projects.filter((p: any) => !p.slug.startsWith('test-'));

    res.json({
      verified: true,
      customer: { id: c.id, name: c.name },
      projects: realProjects,
      // For backwards compat, return the first real project's slug
      slug: realProjects.length > 0 ? realProjects[0].slug : (projects.length > 0 ? projects[0].slug : null),
    });
  } catch (err: any) { console.error('Lookup error:', err); res.status(500).json({ error: 'Login failed' }); }
});

// POST /api/customer/:slug/verify — slug-specific login
router.post('/:slug/verify', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }
    const c = await queryOne<{ id: string; name: string; password_hash: string | null }>(
      'SELECT c.id, c.name, c.password_hash FROM customers c JOIN projects p ON p.customer_id = c.id WHERE p.slug = $1 AND LOWER(c.email) = LOWER($2)', [slug, email.trim()]);
    if (!c) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    if (c.password_hash !== hashPw(password)) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    res.json({ verified: true, customer: { id: c.id, name: c.name } });
  } catch (err: any) { console.error('Verify error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/customer/:slug/sites — list sites for a specific project
router.get('/:slug/sites', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const sites = await query<any>(
      'SELECT gs.id, gs.version_label, gs.vercel_url, gs.is_published, gs.content_schema, p.business_name, p.status, gs.created_at FROM generated_sites gs JOIN projects p ON gs.project_id = p.id JOIN customers c ON p.customer_id = c.id WHERE p.slug = $1 ORDER BY gs.created_at DESC', [slug]);
    const result = await Promise.all(sites.map(async (s: any) => {
      const e = await queryOne<{ count: string; last_edited: string | null }>('SELECT COUNT(*) as count, MAX(created_at) as last_edited FROM edit_history WHERE site_id = $1', [s.id]);
      return { id: s.id, version_label: s.version_label, vercel_url: s.vercel_url, is_published: s.is_published, content_schema: s.content_schema,
        project: { business_name: s.business_name, status: s.status }, edit_count: parseInt(e?.count || '0'), last_edited: e?.last_edited || null };
    }));
    res.json({ sites: result });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Failed' }); }
});

// GET /api/customer/by-id/:customerId/projects — get all projects for a customer
router.get('/by-id/:customerId/projects', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const projects = await query<any>(
      `SELECT p.slug, p.business_name, p.status, p.created_at,
        (SELECT COUNT(*) FROM generated_sites gs WHERE gs.project_id = p.id) as site_count
       FROM projects p WHERE p.customer_id = $1 AND p.slug NOT LIKE 'test-%'
       ORDER BY p.created_at DESC`, [customerId]);
    res.json({ projects });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Failed' }); }
});

export default router;
