import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';
import { getSiteContent, updateContentField } from '../lib/content';

const router = Router();

// GET /api/content?siteId=xxx — fetch site content schema
router.get('/', async (req: Request, res: Response) => {
  const siteId = req.query.siteId as string;
  if (!siteId) {
    res.status(400).json({ error: 'Missing siteId' });
    return;
  }

  try {
    const content = await getSiteContent(siteId);
    res.json(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch content' });
  }
});

// PATCH /api/content — update a specific content field
router.patch('/', async (req: Request, res: Response) => {
  try {
    const { siteId, fieldPath, newValue, aiPrompt } = req.body;

    if (!siteId || !fieldPath) {
      res.status(400).json({ error: 'Missing siteId or fieldPath' });
      return;
    }

    const result = await updateContentField(siteId, fieldPath, newValue, aiPrompt || '');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Update failed' });
  }
});

// GET /api/content/history?siteId=xxx — edit history
router.get('/history', async (req: Request, res: Response) => {
  const siteId = req.query.siteId as string;
  if (!siteId) {
    res.status(400).json({ error: 'Missing siteId' });
    return;
  }

  const history = await query(
    'SELECT * FROM edit_history WHERE site_id = $1 ORDER BY created_at DESC LIMIT 50',
    [siteId]
  );

  res.json({ history });
});

// POST /api/content/undo — revert last edit
router.post('/undo', async (req: Request, res: Response) => {
  try {
    const { siteId, editId } = req.body;

    // Get the edit record
    const edit = await queryOne<{
      id: string;
      field_path: string;
      old_value: string;
    }>('SELECT id, field_path, old_value FROM edit_history WHERE id = $1', [editId]);

    if (!edit) {
      res.status(404).json({ error: 'Edit not found' });
      return;
    }

    // Get current content schema
    const site = await queryOne<{ content_schema: Record<string, unknown> }>(
      'SELECT content_schema FROM generated_sites WHERE id = $1',
      [siteId]
    );

    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    // Revert the field to old value
    const schema = site.content_schema;
    const keys = edit.field_path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current: Record<string, unknown> = schema;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = JSON.parse(edit.old_value);

    // Save reverted schema
    await execute(
      'UPDATE generated_sites SET content_schema = $1 WHERE id = $2',
      [JSON.stringify(schema), siteId]
    );

    // Delete the edit record
    await execute('DELETE FROM edit_history WHERE id = $1', [editId]);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Undo failed' });
  }
});

export default router;
