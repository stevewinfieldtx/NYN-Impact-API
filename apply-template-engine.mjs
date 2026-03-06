// Run this to create/update all the template engine files
// Usage: node apply-template-engine.mjs
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

function writeFile(path, content) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`✓ ${path}`);
}

// ═══════════════════════════════════════════════
// 1. src/lib/renderer.ts — Template engine
// ═══════════════════════════════════════════════
writeFile('src/lib/renderer.ts', `// Template Renderer — merges Kimi design templates with JSON content schemas
// Templates use Mustache-like syntax: {{field.path}}, {{#each items}}, {{#if field}}

export function renderTemplate(template: string, content: Record<string, unknown>): string {
  let html = template;
  html = processEachBlocks(html, content);
  html = processIfBlocks(html, content);
  html = replaceVariables(html, content);
  html = html.replace(/\\{\\{[^}]+\\}\\}/g, '');
  return html;
}

function processEachBlocks(html: string, data: Record<string, unknown>): string {
  const eachRegex = /\\{\\{#each\\s+([\\w.[\\]]+)\\}\\}([\\s\\S]*?)\\{\\{\\/each\\}\\}/g;
  return html.replace(eachRegex, (_match, path: string, inner: string) => {
    const items = getNestedValue(data, path);
    if (!Array.isArray(items) || items.length === 0) return '';
    return items.map((item, index) => {
      let rendered = inner;
      rendered = rendered.replace(/\\{\\{@index\\}\\}/g, String(index));
      if (typeof item !== 'object' || item === null) {
        rendered = rendered.replace(/\\{\\{this\\}\\}/g, String(item));
        return rendered;
      }
      rendered = processEachBlocks(rendered, item as Record<string, unknown>);
      rendered = processIfBlocks(rendered, item as Record<string, unknown>);
      rendered = rendered.replace(/\\{\\{(\\w[\\w.]*)\\}\\}/g, (_m: string, key: string) => {
        const val = getNestedValue(item as Record<string, unknown>, key);
        if (val !== undefined && val !== null) return String(val);
        const rootVal = getNestedValue(data, key);
        if (rootVal !== undefined && rootVal !== null) return String(rootVal);
        return '';
      });
      return rendered;
    }).join('\\n');
  });
}

function processIfBlocks(html: string, data: Record<string, unknown>): string {
  const ifRegex = /\\{\\{#if\\s+([\\w.[\\]]+)\\}\\}([\\s\\S]*?)(?:\\{\\{else\\}\\}([\\s\\S]*?))?\\{\\{\\/if\\}\\}/g;
  return html.replace(ifRegex, (_match, path: string, truthy: string, falsy: string = '') => {
    const value = getNestedValue(data, path);
    const isTruthy = value !== undefined && value !== null && value !== '' && value !== false &&
      !(Array.isArray(value) && value.length === 0);
    return isTruthy ? truthy : falsy;
  });
}

function replaceVariables(html: string, data: Record<string, unknown>): string {
  return html.replace(/\\{\\{([\\w.[\\]]+)\\}\\}/g, (_match, path: string) => {
    const value = getNestedValue(data, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/\\[(\\d+)\\]/g, '.\$1').split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function generateStaticSite(template: string, content: Record<string, unknown>): string {
  return renderTemplate(template, content);
}
`);

// ═══════════════════════════════════════════════
// 2. src/routes/render.ts — Serve live preview
// ═══════════════════════════════════════════════
writeFile('src/routes/render.ts', `import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';

const router = Router();

router.get('/:siteId', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{
      template_code: string | null;
      content_schema: Record<string, unknown>;
    }>('SELECT template_code, content_schema FROM generated_sites WHERE id = \$1', [siteId]);

    if (!site) { res.status(404).send('Site not found'); return; }
    if (!site.template_code) { res.status(404).send('No template generated yet.'); return; }

    const html = renderTemplate(site.template_code, site.content_schema);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err: any) {
    console.error('Render error:', err);
    res.status(500).send('Failed to render site');
  }
});

router.get('/:siteId/json', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{ content_schema: Record<string, unknown> }>(
      'SELECT content_schema FROM generated_sites WHERE id = \$1', [siteId]
    );
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    res.json(site.content_schema);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

export default router;
`);

// ═══════════════════════════════════════════════
// 3. src/routes/generate.ts — Call Kimi to create template
// ═══════════════════════════════════════════════
writeFile('src/routes/generate.ts', `import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const WEBSITE_MODEL = process.env.OPENROUTER_WEBSITE_MODEL || 'moonshotai/kimi-k2';

router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }

    const site = await queryOne<{ content_schema: Record<string, unknown>; project_id: string }>(
      'SELECT content_schema, project_id FROM generated_sites WHERE id = \$1', [siteId]
    );
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }

    const project = await queryOne<{ business_name: string }>(
      'SELECT business_name FROM projects WHERE id = \$1', [site.project_id]
    );

    console.log('Generating template for ' + (project?.business_name || 'unknown') + ' via ' + WEBSITE_MODEL);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: WEBSITE_MODEL,
        messages: [
          { role: 'system', content: DESIGN_SYSTEM_PROMPT },
          { role: 'user', content: 'Generate a stunning website template for: ' + (project?.business_name || 'Unknown') + '\\n\\nCONTENT SCHEMA:\\n' + JSON.stringify(site.content_schema, null, 2) + '\\n\\nUse {{template.syntax}} for ALL content. Output ONLY HTML.' },
        ],
        max_tokens: 16000,
        temperature: 0.7,
      }),
    });

    const data: any = await response.json();
    let templateHtml = data.choices?.[0]?.message?.content || '';
    templateHtml = templateHtml.replace(/^\\\`\\\`\\\`html?\\s*/i, '').replace(/\\\`\\\`\\\`\\s*$/i, '').trim();

    if (!templateHtml || templateHtml.length < 200) {
      res.status(500).json({ error: 'AI returned insufficient template' });
      return;
    }

    await execute('UPDATE generated_sites SET template_code = \$1 WHERE id = \$2', [templateHtml, siteId]);
    console.log('Template generated: ' + templateHtml.length + ' chars');

    res.json({ success: true, message: 'Template generated (' + templateHtml.length + ' chars)', previewUrl: '/api/render/' + siteId });
  } catch (err: any) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

const DESIGN_SYSTEM_PROMPT = \`You are a world-class web designer who outputs production-ready HTML templates.

## TEMPLATE SYNTAX
- {{field.path}} for values
- {{#each array.path}}...{{/each}} for loops
- {{#if field.path}}...{{/if}} for conditionals  
- {{@index}} for loop index, {{this}} for primitive items

## RULES
- ONE complete HTML file. All CSS in <style>, all JS in <script>.
- Google Fonts via <link> are the ONLY external resource.
- NEVER hardcode business content. Use {{template.syntax}} for ALL text from the schema.
- Modern typography, rich colors, gradients, generous whitespace.
- Scroll animations (Intersection Observer), hover effects, animated counters.
- Sticky nav with background on scroll. Mobile hamburger menu.
- Fully responsive. Phone as tel: links. Email as mailto: links.
- No external JS libraries. Pure vanilla JS.
- Adapt design to business type (restaurant=warm, law=dark, sports=premium, tech=clean).
- Make it look like a \\\$20,000 custom site.
- Output ONLY HTML. No markdown, no explanation.\`;

export default router;
`);

// ═══════════════════════════════════════════════
// 4. src/server.ts — Updated with new routes
// ═══════════════════════════════════════════════
writeFile('src/server.ts', `import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat';
import contentRoutes from './routes/content';
import leadRoutes from './routes/lead';
import customerRoutes from './routes/customer';
import deployRoutes from './routes/deploy';
import renderRoutes from './routes/render';
import generateRoutes from './routes/generate';
import interviewRoutes from './routes/interview';
import projectRoutes from './routes/project';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

const allowedOrigins = process.env.FRONTEND_URL?.split(',').map(u => u.trim()) || ['http://localhost:3000'];
console.log('CORS allowed origins:', allowedOrigins);
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nyn-impact-api', timestamp: new Date().toISOString() });
});

app.use('/api/chat', chatRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/lead', leadRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/render', renderRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/project', projectRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log('NYN Impact API running on port ' + PORT);
});
`);

// ═══════════════════════════════════════════════
// 5. src/routes/deploy.ts — Updated with template rendering
// ═══════════════════════════════════════════════
writeFile('src/routes/deploy.ts', `import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';

const router = Router();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not configured' }); return; }

    const site = await queryOne<{ content_schema: Record<string, unknown>; template_code: string | null }>(
      'SELECT content_schema, template_code FROM generated_sites WHERE id = \$1', [siteId]
    );
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }

    const project = await queryOne<{ business_name: string; github_repo: string | null }>(
      'SELECT p.business_name, p.github_repo FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = \$1', [siteId]
    );
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    let staticHtml: string;
    if (site.template_code) {
      staticHtml = renderTemplate(site.template_code, site.content_schema);
    } else {
      staticHtml = '<!DOCTYPE html><html><head><title>' + project.business_name + '</title></head><body><h1>' + project.business_name + '</h1><p>Template generating...</p></body></html>';
    }

    const repo = project.github_repo;
    const htmlContent = Buffer.from(staticHtml).toString('base64');
    const jsonContent = Buffer.from(JSON.stringify(site.content_schema, null, 2)).toString('base64');

    const htmlSha = await getFileSha(repo, 'index.html');
    const jsonSha = await getFileSha(repo, 'siteContent.json');

    const htmlRes = await pushToGitHub(repo, 'index.html', htmlContent, 'Update site — ' + project.business_name, htmlSha);
    if (!htmlRes.ok) {
      const err: any = await htmlRes.json();
      res.status(500).json({ error: 'GitHub push failed', details: err.message });
      return;
    }
    await pushToGitHub(repo, 'siteContent.json', jsonContent, 'Update content — ' + project.business_name, jsonSha);

    const htmlData: any = await htmlRes.json();
    res.json({ success: true, message: 'Published! Vercel will deploy in ~30 seconds.', commit: htmlData.commit?.sha?.substring(0, 7), repo });
  } catch (err: any) {
    console.error('Deploy error:', err);
    res.status(500).json({ error: err.message || 'Deploy failed' });
  }
});

async function getFileSha(repo: string, filePath: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://api.github.com/repos/' + repo + '/contents/' + filePath, {
      headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (res.ok) { const data: any = await res.json(); return data.sha; }
  } catch {}
  return undefined;
}

async function pushToGitHub(repo: string, filePath: string, content: string, message: string, sha?: string) {
  return fetch('https://api.github.com/repos/' + repo + '/contents/' + filePath, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
    body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
  });
}

export default router;
`);

// ═══════════════════════════════════════════════
// 6. src/routes/customer.ts — With password auth
// ═══════════════════════════════════════════════
writeFile('src/routes/customer.ts', `import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { query, queryOne } from '../db';

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex');
}

const router = Router();

router.post('/:slug/verify', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email and password are required' }); return; }

    const customer = await queryOne<{ id: string; name: string; email: string; password_hash: string | null }>(
      'SELECT c.id, c.name, c.email, c.password_hash FROM customers c JOIN projects p ON p.customer_id = c.id WHERE p.slug = \$1 AND LOWER(c.email) = LOWER(\$2)',
      [slug, email.trim()]
    );
    if (!customer) { res.status(401).json({ error: 'Invalid email or password' }); return; }

    const inputHash = hashPassword(password);
    if (customer.password_hash !== inputHash) { res.status(401).json({ error: 'Invalid email or password' }); return; }

    res.json({ verified: true, customer: { id: customer.id, name: customer.name } });
  } catch (err: any) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.get('/:slug/sites', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const sites = await query<any>(
      'SELECT gs.id, gs.version_label, gs.vercel_url, gs.is_published, gs.is_selected, gs.content_schema, p.id as project_id, p.business_name, p.business_url, p.status, gs.created_at FROM generated_sites gs JOIN projects p ON gs.project_id = p.id JOIN customers c ON p.customer_id = c.id WHERE p.slug = \$1 ORDER BY gs.created_at DESC',
      [slug]
    );

    const sitesWithEdits = await Promise.all(sites.map(async (site: any) => {
      const editResult = await queryOne<{ count: string; last_edited: string | null }>(
        'SELECT COUNT(*) as count, MAX(created_at) as last_edited FROM edit_history WHERE site_id = \$1', [site.id]
      );
      return {
        id: site.id, version_label: site.version_label, vercel_url: site.vercel_url,
        is_published: site.is_published, content_schema: site.content_schema,
        project: { business_name: site.business_name, status: site.status },
        edit_count: parseInt(editResult?.count || '0'),
        last_edited: editResult?.last_edited || null,
      };
    }));

    res.json({ sites: sitesWithEdits });
  } catch (err: any) {
    console.error('Customer sites error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch sites' });
  }
});

export default router;
`);

console.log('\n✅ All files created. Now run:');
console.log('  git add -A');
console.log('  git commit -m "Add template engine, Kimi generate, render preview, password auth"');
console.log('  git push origin main');
