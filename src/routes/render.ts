import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';
const router = Router();
router.get('/:siteId', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{ template_code: string | null; content_schema: Record<string, unknown> }>(
      'SELECT template_code, content_schema FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).send('Site not found'); return; }
    if (!site.template_code) { res.status(404).send('No template yet'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.send(renderTemplate(site.template_code, site.content_schema));
  } catch (err: any) { console.error('Render error:', err); res.status(500).send('Render failed'); }
});
router.get('/:siteId/json', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{ content_schema: Record<string, unknown> }>(
      'SELECT content_schema FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(site.content_schema);
  } catch (err: any) { res.status(500).json({ error: 'Failed' }); }
});
export default router;
