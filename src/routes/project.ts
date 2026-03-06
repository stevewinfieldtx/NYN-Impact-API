import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { generateSiteOptions, getProjectSites, selectSiteOption, getSiteHTML } from '../lib/generate';

const router = Router();

// GET /api/project/:projectId — Get project status and basic info
router.get('/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const project = await queryOne<{
      id: string;
      business_name: string;
      status: string;
      slug: string;
    }>(
      `SELECT id, business_name, status, slug FROM projects WHERE id = $1`,
      [projectId]
    );

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ success: true, project });
  } catch (err) {
    console.error('Project fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// POST /api/project/:projectId/generate — Generate two site options from transcript
router.post('/:projectId/generate', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Check if sites already exist for this project
    const existing = await getProjectSites(projectId);
    if (existing.length > 0) {
      res.json({
        success: true,
        message: 'Sites already generated',
        sites: existing,
      });
      return;
    }

    const result = await generateSiteOptions(projectId);

    // Fetch the newly created sites to return full data
    const sites = await getProjectSites(projectId);

    res.json({
      success: true,
      siteA: result.siteA,
      siteB: result.siteB,
      sites,
    });
  } catch (err) {
    console.error('Generate error:', err);
    const message = err instanceof Error ? err.message : 'Failed to generate sites';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/project/:projectId/sites — Get generated site options
router.get('/:projectId/sites', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const sites = await getProjectSites(projectId);
    res.json({ success: true, sites });
  } catch (err) {
    console.error('Sites fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

// POST /api/project/:projectId/select — Choose a site option
router.post('/:projectId/select', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { siteId } = req.body;

    if (!siteId) {
      res.status(400).json({ error: 'Missing siteId' });
      return;
    }

    const result = await selectSiteOption(projectId, siteId);

    // Also return customer info so the frontend can auto-session them
    // without requiring them to log in again
    const { queryOne } = await import('../db');
    const customer = await queryOne<{ id: string; name: string }>(`
      SELECT c.id, c.name
      FROM customers c
      JOIN projects p ON p.customer_id = c.id
      WHERE p.id = $1
    `, [projectId]);

    res.json({ ...result, customer });
  } catch (err) {
    console.error('Select error:', err);
    const message = err instanceof Error ? err.message : 'Failed to select site';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/project/site/:siteId/html — Serve the raw HTML for iframe rendering
router.get('/site/:siteId/html', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const html = await getSiteHTML(siteId);

    if (!html) {
      res.status(404).send('<html><body><h1>Site not found</h1></body></html>');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Site HTML fetch error:', err);
    res.status(500).send('<html><body><h1>Error loading site</h1></body></html>');
  }
});

export default router;
