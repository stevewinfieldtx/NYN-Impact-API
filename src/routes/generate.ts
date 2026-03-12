import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';
const router = Router();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const WEBSITE_MODEL = process.env.OPENROUTER_WEBSITE_MODEL || 'moonshotai/kimi-k2';
const DESIGN_PROMPT = 'You are a world-class web designer. Output a single HTML file template using {{field.path}} for content, {{#each array}}...{{/each}} for loops, {{#if field}}...{{/if}} for conditionals. All CSS/JS inline. Google Fonts only external resource. Make it stunning - scroll animations, hover effects, responsive, animated counters. Adapt design to business type. Output ONLY HTML.';
router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    const site = await queryOne<{ content_schema: Record<string, unknown>; project_id: string }>(
      'SELECT content_schema, project_id FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    const project = await queryOne<{ business_name: string }>('SELECT business_name FROM projects WHERE id = $1', [site.project_id]);
    console.log('Generating template for ' + (project?.business_name || '?') + ' via ' + WEBSITE_MODEL);
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: WEBSITE_MODEL, messages: [
        { role: 'system', content: DESIGN_PROMPT },
        { role: 'user', content: 'Generate template for: ' + (project?.business_name || '?') + '\nSchema:\n' + JSON.stringify(site.content_schema, null, 2) + '\nOutput ONLY HTML.' }
      ], max_tokens: 16000, temperature: 0.7 })
    });
    const data: any = await r.json();
    let html = (data.choices?.[0]?.message?.content || '').replace(/^\`\`\`html?\s*/i, '').replace(/\`\`\`\s*$/i, '').trim();
    if (!html || html.length < 200) { res.status(500).json({ error: 'Insufficient template' }); return; }
    await execute('UPDATE generated_sites SET template_code = $1 WHERE id = $2', [html, siteId]);
    res.json({ success: true, message: 'Template generated (' + html.length + ' chars)', previewUrl: '/api/render/' + siteId });
  } catch (err: any) { console.error('Generate error:', err); res.status(500).json({ error: err.message || 'Failed' }); }
});
export default router;
