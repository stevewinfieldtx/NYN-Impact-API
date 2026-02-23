import { Router, Request, Response } from 'express';
import { getSiteContent, updateContentField, parseEditIntent } from '../lib/content';

const router = Router();

// POST /api/chat — AI Self-Edit conversation
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, siteId } = req.body;

    if (!message || !siteId) {
      res.status(400).json({ error: 'Missing message or siteId' });
      return;
    }

    // Get current content schema
    const site = await getSiteContent(siteId);
    const schema = site.content_schema;

    // Parse the user's intent using AI
    const intent = await parseEditIntent(message, schema);

    if (intent.action === 'clarify') {
      res.json({
        success: false,
        message: intent.message || intent.clarification || "Could you be more specific about what you'd like to change?",
      });
      return;
    }

    if (intent.action === 'get_value') {
      res.json({ success: true, message: intent.message });
      return;
    }

    if (intent.action === 'update') {
      const result = await updateContentField(siteId, intent.field_path, intent.new_value, message);
      res.json({
        success: true,
        message: intent.message || `Updated ${intent.field_path}`,
        edit: result,
      });
      return;
    }

    if (intent.action === 'add_list_item') {
      const result = await updateContentField(siteId, intent.field_path, intent.new_value, message);
      res.json({
        success: true,
        message: intent.message || 'Item added!',
        edit: result,
      });
      return;
    }

    if (intent.action === 'remove_list_item') {
      res.json({
        success: false,
        message: 'Removing items is coming soon. For now, you can update the item to something else.',
      });
      return;
    }

    res.json({
      success: false,
      message: "I'm not sure how to handle that. Try 'Change the headline to...' or 'Update the phone number to...'",
    });
  } catch (err) {
    console.error('Chat API error:', err);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

export default router;
