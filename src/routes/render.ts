import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';

const router = Router();

// GET /api/render/:siteId — serve the live rendered HTML for a site
// This merges the template_code with the current content_schema
router.get('/:siteId', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;

    const site = await queryOne<{
      template_code: string | null;
      content_schema: Record<string, unknown>;
      version_label: string;
    }>(
      'SELECT template_code, content_schema, version_label FROM generated_sites WHERE id = $1',
      [siteId]
    );

    if (!site) {
      res.status(404).send('Site not found');
      return;
    }

    if (!site.template_code) {
      res.status(404).send('No template has been generated for this site yet.');
      return;
    }

    // Render the template with current content
    const html = renderTemplate(site.template_code, site.content_schema);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err: any) {
    console.error('Render error:', err);
    res.status(500).send('Failed to render site');
  }
});

// GET /api/render/:siteId/json — return the raw content schema
router.get('/:siteId/json', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;

    const site = await queryOne<{ content_schema: Record<string, unknown> }>(
      'SELECT content_schema FROM generated_sites WHERE id = $1',
      [siteId]
    );

    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    res.json(site.content_schema);
  } catch (err: any) {
    console.error('Render JSON error:', err);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

export default router;
