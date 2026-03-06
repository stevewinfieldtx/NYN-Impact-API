import { Router, Request, Response } from 'express';
import { startInterview, handleMessage, getInterview, skipInterview } from '../lib/interview';

const router = Router();

// POST /api/interview/start — Begin a new text interview
// Body: { customerId }
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.body;

    if (!customerId) {
      res.status(400).json({ error: 'Missing customerId' });
      return;
    }

    const result = await startInterview(customerId);
    res.json({
      success: true,
      projectId: result.projectId,
      message: result.message,
    });
  } catch (err) {
    console.error('Interview start error:', err);
    const message = err instanceof Error ? err.message : 'Failed to start interview';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/interview/message — Send a message in the interview
// Body: { projectId, message }
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { projectId, message } = req.body;

    if (!projectId || !message) {
      res.status(400).json({ error: 'Missing projectId or message' });
      return;
    }

    const result = await handleMessage(projectId, message);
    res.json({
      success: true,
      message: result.message,
      complete: result.complete,
    });
  } catch (err: any) {
    console.error('Interview message error:', err);
    if (err.message === 'Interview already completed') {
      res.status(400).json({ success: false, error: 'Interview already completed' });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to process message';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/interview/skip — Test mode: generate fake interview data from an industry
// Body: { customerId, industry }
router.post('/skip', async (req: Request, res: Response) => {
  try {
    const { customerId, industry } = req.body;

    if (!customerId || !industry) {
      res.status(400).json({ error: 'Missing customerId or industry' });
      return;
    }

    const result = await skipInterview(customerId, industry);
    res.json({
      success: true,
      projectId: result.projectId,
    });
  } catch (err) {
    console.error('Interview skip error:', err);
    const message = err instanceof Error ? err.message : 'Failed to skip interview';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/interview/start-research — kick off background research while interview runs
router.post('/start-research', async (req: Request, res: Response) => {
  try {
    const { businessName, businessUrl, customerId } = req.body;
    if (!customerId) { res.status(400).json({ error: 'Missing customerId' }); return; }

    // Update the in-progress project with business info
    await import('../db').then(({ execute }) =>
      execute(
        `UPDATE projects SET business_name = $1, business_url = $2 WHERE customer_id = $3 AND status = 'interview' ORDER BY created_at DESC LIMIT 1`,
        [businessName || 'TBD', businessUrl || null, customerId]
      )
    );

    // Get the project id to return
    const { queryOne } = await import('../db');
    const project = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE customer_id = $1 AND status = 'interview' ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );

    res.json({ success: true, projectId: project?.id });
  } catch (err) {
    console.error('Start research error:', err);
    res.status(500).json({ success: false, error: 'Research start failed' });
  }
});

// GET /api/interview/:projectId — Get interview state (for resuming)
router.get('/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const result = await getInterview(projectId);
    res.json({
      success: true,
      messages: result.messages,
      status: result.status,
    });
  } catch (err) {
    console.error('Interview fetch error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch interview' });
  }
});

export default router;
