import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const WEBSITE_MODEL = process.env.OPENROUTER_WEBSITE_MODEL || 'moonshotai/kimi-k2';

// POST /api/generate — generate a website template from content schema using Kimi
router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;

    if (!siteId) {
      res.status(400).json({ error: 'Missing siteId' });
      return;
    }

    const site = await queryOne<{
      content_schema: Record<string, unknown>;
      project_id: string;
    }>(
      'SELECT content_schema, project_id FROM generated_sites WHERE id = $1',
      [siteId]
    );

    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const project = await queryOne<{ business_name: string }>(
      'SELECT business_name FROM projects WHERE id = $1',
      [site.project_id]
    );

    console.log(`Generating template for ${project?.business_name || 'unknown'} via ${WEBSITE_MODEL}...`);

    const systemPrompt = buildDesignPrompt();
    const userPrompt = `Generate a stunning, production-quality website template for this business.

BUSINESS: ${project?.business_name || 'Unknown Business'}

CONTENT SCHEMA (this is the data your template must render):
${JSON.stringify(site.content_schema, null, 2)}

Remember:
- Use {{field.path}} syntax for all content from the schema
- Use {{#each array.path}}...{{/each}} for lists
- Use {{#if field.path}}...{{/if}} for optional sections
- ALL CSS and JS must be inline in the single HTML file
- Google Fonts via <link> are the ONLY allowed external resources
- Make it extraordinary — this should look like a $20,000 custom site
- Fully responsive, animated, interactive
- Output ONLY the HTML — no explanation, no markdown fences`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: WEBSITE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 16000,
        temperature: 0.7,
      }),
    });

    const data: any = await response.json();
    let templateHtml = data.choices?.[0]?.message?.content || '';

    // Clean up — remove markdown fences if present
    templateHtml = templateHtml
      .replace(/^```html?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    if (!templateHtml || templateHtml.length < 200) {
      res.status(500).json({ error: 'AI returned insufficient template', raw: templateHtml.substring(0, 500) });
      return;
    }

    // Save the template
    await execute(
      'UPDATE generated_sites SET template_code = $1 WHERE id = $2',
      [templateHtml, siteId]
    );

    console.log(`Template generated: ${templateHtml.length} chars for ${project?.business_name}`);

    res.json({
      success: true,
      message: `Template generated (${templateHtml.length} chars)`,
      previewUrl: `/api/render/${siteId}`,
    });
  } catch (err: any) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

export default router;

function buildDesignPrompt(): string {
  return `You are a world-class web designer who outputs production-ready HTML. You generate website TEMPLATES that use a data-binding syntax so content can be dynamically injected.

## TEMPLATE SYNTAX

Use these patterns to bind content from a JSON schema:

### Variables
{{meta.title}} — inserts the value at that path in the JSON

### Loops
{{#each stats}}
  <div>{{value}} — {{label}}</div>
{{/each}}

{{#each menu.categories}}
  <h3>{{name}}</h3>
  {{#each items}}
    <p>{{name}} — {{price}}: {{description}}</p>
  {{/each}}
{{/each}}

### Conditionals
{{#if hours}}
  <section>...</section>
{{/if}}

### Inside loops
Use {{@index}} for the current index.
Use {{this}} for primitive array items (like strings in an array).

## DESIGN STANDARDS

- Output ONE complete HTML file. All CSS in <style>, all JS in <script>. No external files except Google Fonts via <link>.
- Modern, sophisticated typography. Pick Google Fonts that match the business personality.
- Rich color palettes. Gradients, accent colors, tinted backgrounds. NOT generic black/white.
- Generous whitespace. Premium feel.
- Scroll-triggered fade/slide animations using Intersection Observer.
- Hover effects on cards and buttons.
- Animated stat counters that trigger on scroll.
- Sticky navigation that gets a background on scroll.
- Mobile hamburger menu with smooth animation.
- Responsive — must look perfect on mobile, tablet, desktop.
- Phone numbers as clickable tel: links. Emails as mailto: links.
- No external JS libraries. Pure vanilla JS.
- Under 50KB total.
- Proper meta tags, Open Graph tags.
- Every field in the schema must appear somewhere on the page.
- If a field is empty or missing, gracefully skip it.

## BUSINESS TYPE ADAPTATION

Infer the business type from the content and adapt:
- Restaurant/Cafe → Warm tones, food-oriented layout, menu cards
- Professional Services → Dark, authoritative, trust-building
- Sports/Golf → Green accents, premium luxury feel
- Tech/SaaS → Clean, minimal, blue/purple
- Trades/Construction → Bold, strong, industrial
- Retail → Trendy, visual, lifestyle

## QUALITY BAR

Think Stripe.com polish, Linear.app sophistication, Apple.com typography. Small business owners should look at this and feel like they got a $20,000 site. Every site is a portfolio piece.

Output ONLY valid HTML. No markdown, no explanation, no code fences.`;
}
