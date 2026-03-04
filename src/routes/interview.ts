import { Router, Request, Response } from 'express';
import { startInterview, handleMessage, getInterview } from '../lib/interview';

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
    res.status(500).json({ success: false, error: 'Failed to start interview' });
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
    res.status(500).json({ success: false, error: 'Failed to process message' });
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
