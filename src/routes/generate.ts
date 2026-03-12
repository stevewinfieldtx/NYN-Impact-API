import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const WEBSITE_MODEL = process.env.OPENROUTER_WEBSITE_MODEL || 'moonshotai/kimi-k2';

const CONVERT_PROMPT = `You are a world-class web developer. You will receive the HTML source code of an existing website AND a JSON content schema.

Your job is to convert the HTML into a TEMPLATE by replacing all hardcoded business content with template variables that map to the JSON schema.

TEMPLATE SYNTAX:
- {{field.path}} for simple values (e.g., {{hero.headline1}}, {{meta.phone}})
- {{#each array.path}}...{{/each}} for arrays (e.g., {{#each stats}}{{value}}{{/each}})
- {{#if field.path}}...{{/if}} for optional sections
- {{@index}} for loop index, {{this}} for primitive array items

RULES:
1. PRESERVE the entire design — all CSS, JS, animations, layout, fonts, colors, hover effects, responsive breakpoints. Change NOTHING about the visual design.
2. ONLY replace the text/content values with template variables. The structure stays identical.
3. Map each piece of content to the correct path in the JSON schema.
4. If the HTML has content that doesn't exist in the schema, leave it hardcoded (like navigation labels, footer legal text, etc.)
5. Phone numbers should remain as clickable tel: links using {{meta.phone}}
6. Email should remain as clickable mailto: links using {{meta.contact_email}}
7. Remove any <base target="_blank"> tags
8. Output ONLY the complete HTML with template variables. No markdown fences, no explanation.`;

const DESIGN_FROM_SCRATCH_PROMPT = `You are a world-class web designer who outputs production-ready HTML templates.

TEMPLATE SYNTAX:
- {{field.path}} for values
- {{#each array.path}}...{{/each}} for loops
- {{#if field.path}}...{{/if}} for conditionals
- {{@index}} for loop index, {{this}} for primitive items

RULES:
- ONE complete HTML file. All CSS in <style>, all JS in <script>.
- Google Fonts via <link> are the ONLY external resource.
- NEVER hardcode business content. Use {{template.syntax}} for ALL text from the schema.
- Modern typography, rich colors, gradients, generous whitespace.
- Scroll animations (Intersection Observer), hover effects, animated counters.
- Sticky nav with background on scroll. Mobile hamburger menu.
- Fully responsive. Phone as tel: links. Email as mailto: links.
- No external JS libraries. Pure vanilla JS.
- Adapt design to business type.
- Output ONLY HTML. No markdown, no explanation.`;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }

    // Get site and project info
    const site = await queryOne<{ content_schema: Record<string, unknown>; project_id: string }>(
      'SELECT content_schema, project_id FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }

    const project = await queryOne<{ business_name: string; business_url: string | null }>(
      'SELECT business_name, business_url FROM projects WHERE id = $1', [site.project_id]);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const businessName = project.business_name || 'Unknown';
    const siteUrl = project.business_url;

    console.log('Generating template for ' + businessName + ' via ' + WEBSITE_MODEL);

    let existingHtml = '';

    // If there's a live site URL, fetch it (READ-ONLY — never modifies the original)
    if (siteUrl) {
      console.log('Fetching existing site: ' + siteUrl);
      try {
        const siteRes = await fetch(siteUrl, {
          headers: { 'User-Agent': 'NYNImpact-TemplateGenerator/1.0' }
        });
        if (siteRes.ok) {
          existingHtml = await siteRes.text();
          console.log('Fetched ' + existingHtml.length + ' chars from ' + siteUrl);
        } else {
          console.log('Failed to fetch site: ' + siteRes.status);
        }
      } catch (fetchErr: any) {
        console.log('Fetch error: ' + fetchErr.message);
      }
    }

    let userPrompt: string;
    let systemPrompt: string;

    if (existingHtml && existingHtml.length > 500) {
      // MODE 1: Convert existing site to template (preserves design)
      console.log('Converting existing site to template...');
      systemPrompt = CONVERT_PROMPT;
      userPrompt = 'Convert this existing website HTML into a template.\n\n'
        + 'BUSINESS: ' + businessName + '\n\n'
        + 'CONTENT SCHEMA (map the HTML content to these paths):\n'
        + JSON.stringify(site.content_schema, null, 2) + '\n\n'
        + 'EXISTING SITE HTML:\n'
        + existingHtml + '\n\n'
        + 'Convert ALL business content to {{template.syntax}} variables. Keep ALL design/CSS/JS identical. Output ONLY HTML.';
    } else {
      // MODE 2: Generate from scratch (no existing site)
      console.log('No existing site found, generating from scratch...');
      systemPrompt = DESIGN_FROM_SCRATCH_PROMPT;
      userPrompt = 'Generate a stunning website template for: ' + businessName + '\n\n'
        + 'CONTENT SCHEMA:\n'
        + JSON.stringify(site.content_schema, null, 2) + '\n\n'
        + 'Use {{template.syntax}} for ALL content. Output ONLY HTML.';
    }

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: WEBSITE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 32000,
        temperature: 0.3,
      }),
    });

    const data: any = await r.json();
    let html = (data.choices?.[0]?.message?.content || '')
      .replace(/^```html?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    if (!html || html.length < 200) {
      res.status(500).json({ error: 'AI returned insufficient template', raw: html?.substring(0, 500) });
      return;
    }

    // Store the template
    await execute('UPDATE generated_sites SET template_code = $1 WHERE id = $2', [html, siteId]);
    console.log('Template stored: ' + html.length + ' chars for ' + businessName);

    res.json({
      success: true,
      message: 'Template generated (' + html.length + ' chars)' + (existingHtml ? ' from existing site' : ' from scratch'),
      previewUrl: '/api/render/' + siteId,
      mode: existingHtml ? 'converted' : 'generated',
    });
  } catch (err: any) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

export default router;
