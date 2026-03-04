import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { query, queryOne } from '../db';

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex');
}

const router = Router();

// POST /api/customer/:slug/verify — email gate login
router.post('/:slug/verify', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const customer = await queryOne<{ id: string; name: string; email: string; password_hash: string | null }>(`
      SELECT c.id, c.name, c.email, c.password_hash
      FROM customers c
      JOIN projects p ON p.customer_id = c.id
      WHERE p.slug = $1 AND LOWER(c.email) = LOWER($2)
    `, [slug, email.trim()]);

    if (!customer) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Check password
    const inputHash = hashPassword(password);
    if (customer.password_hash !== inputHash) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    res.json({ verified: true, customer: { id: customer.id, name: customer.name } });
  } catch (err: any) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /api/customer/:slug/sites — list all sites for a customer
router.get('/:slug/sites', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    // Find customer by slug (name slugified) or email
    // For now, slug is the project slug
    const sites = await query<{
      id: string;
      version_label: string;
      vercel_url: string | null;
      is_published: boolean;
      is_selected: boolean;
      content_schema: Record<string, unknown>;
      project_id: string;
      business_name: string;
      business_url: string | null;
      status: string;
      created_at: string;
    }>(`
      SELECT 
        gs.id, gs.version_label, gs.vercel_url, gs.is_published, gs.is_selected, gs.content_schema,
        p.id as project_id, p.business_name, p.business_url, p.status,
        gs.created_at
      FROM generated_sites gs
      JOIN projects p ON gs.project_id = p.id
      JOIN customers c ON p.customer_id = c.id
      WHERE p.slug = $1
      ORDER BY gs.created_at DESC
    `, [slug]);

    // Get edit counts for each site
    const sitesWithEdits = await Promise.all(sites.map(async (site) => {
      const editResult = await queryOne<{ count: string; last_edited: string | null }>(`
        SELECT COUNT(*) as count, MAX(created_at) as last_edited
        FROM edit_history WHERE site_id = $1
      `, [site.id]);

      return {
        id: site.id,
        version_label: site.version_label,
        vercel_url: site.vercel_url,
        is_published: site.is_published,
        content_schema: site.content_schema,
        project: {
          business_name: site.business_name,
          status: site.status,
        },
        edit_count: parseInt(editResult?.count || '0'),
        last_edited: editResult?.last_edited || null,
      };
    }));

    res.json({ sites: sitesWithEdits });
  } catch (err: any) {
    console.error('Customer sites error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch sites' });
  }
});

export default router;
