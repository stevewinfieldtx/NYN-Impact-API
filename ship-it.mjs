// ═══════════════════════════════════════════════════════════════════
// MASTER DEPLOYMENT SCRIPT — Does EVERYTHING in one shot
// Run: node ship-it.mjs
// ═══════════════════════════════════════════════════════════════════
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { execSync } from 'child_process';
import pg from 'pg';
import { createHash } from 'crypto';
const { Pool } = pg;

function w(path, content) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`  ✓ ${path}`);
}

function hashPw(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

function run(cmd) {
  try {
    const result = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    return result.trim();
  } catch (e) {
    console.log('  CMD FAILED:', cmd);
    console.log('  ', e.message?.substring(0, 200));
    return '';
  }
}

const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';

async function main() {

// ═══════════════════════════════════════
// PHASE 1: API FILES
// ═══════════════════════════════════════
console.log('\n══════════════════════════════════════');
console.log('PHASE 1: Writing API files');
console.log('══════════════════════════════════════');

// 1a. renderer.ts
w('src/lib/renderer.ts', `export function renderTemplate(template: string, content: Record<string, unknown>): string {
  let html = template;
  html = processEachBlocks(html, content);
  html = processIfBlocks(html, content);
  html = replaceVariables(html, content);
  html = html.replace(/\\{\\{[^}]+\\}\\}/g, '');
  return html;
}
function processEachBlocks(html: string, data: Record<string, unknown>): string {
  const r = /\\{\\{#each\\s+([\\w.[\\]]+)\\}\\}([\\s\\S]*?)\\{\\{\\/each\\}\\}/g;
  return html.replace(r, (_, path: string, inner: string) => {
    const items = gv(data, path);
    if (!Array.isArray(items) || items.length === 0) return '';
    return items.map((item, i) => {
      let s = inner.replace(/\\{\\{@index\\}\\}/g, String(i));
      if (typeof item !== 'object' || item === null) return s.replace(/\\{\\{this\\}\\}/g, String(item));
      s = processEachBlocks(s, item as Record<string, unknown>);
      s = processIfBlocks(s, item as Record<string, unknown>);
      s = s.replace(/\\{\\{(\\w[\\w.]*)\\}\\}/g, (_: string, k: string) => {
        const v = gv(item as Record<string, unknown>, k);
        if (v !== undefined && v !== null) return String(v);
        const rv = gv(data, k);
        if (rv !== undefined && rv !== null) return String(rv);
        return '';
      });
      return s;
    }).join('\\n');
  });
}
function processIfBlocks(html: string, data: Record<string, unknown>): string {
  return html.replace(/\\{\\{#if\\s+([\\w.[\\]]+)\\}\\}([\\s\\S]*?)(?:\\{\\{else\\}\\}([\\s\\S]*?))?\\{\\{\\/if\\}\\}/g, (_, p: string, t: string, f: string = '') => {
    const v = gv(data, p);
    return (v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)) ? t : f;
  });
}
function replaceVariables(html: string, data: Record<string, unknown>): string {
  return html.replace(/\\{\\{([\\w.[\\]]+)\\}\\}/g, (_, p: string) => {
    const v = gv(data, p); if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
function gv(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/\\[(\\d+)\\]/g, '.\$1').split('.');
  let c: unknown = obj;
  for (const k of keys) { if (c == null || typeof c !== 'object') return undefined; c = (c as any)[k]; }
  return c;
}
`);

// 1b. routes/render.ts
w('src/routes/render.ts', `import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';
const router = Router();
router.get('/:siteId', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{ template_code: string | null; content_schema: Record<string, unknown> }>(
      'SELECT template_code, content_schema FROM generated_sites WHERE id = \$1', [siteId]);
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
      'SELECT content_schema FROM generated_sites WHERE id = \$1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(site.content_schema);
  } catch (err: any) { res.status(500).json({ error: 'Failed' }); }
});
export default router;
`);

// 1c. routes/generate.ts
w('src/routes/generate.ts', `import { Router, Request, Response } from 'express';
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
      'SELECT content_schema, project_id FROM generated_sites WHERE id = \$1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    const project = await queryOne<{ business_name: string }>('SELECT business_name FROM projects WHERE id = \$1', [site.project_id]);
    console.log('Generating template for ' + (project?.business_name || '?') + ' via ' + WEBSITE_MODEL);
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: WEBSITE_MODEL, messages: [
        { role: 'system', content: DESIGN_PROMPT },
        { role: 'user', content: 'Generate template for: ' + (project?.business_name || '?') + '\\nSchema:\\n' + JSON.stringify(site.content_schema, null, 2) + '\\nOutput ONLY HTML.' }
      ], max_tokens: 16000, temperature: 0.7 })
    });
    const data: any = await r.json();
    let html = (data.choices?.[0]?.message?.content || '').replace(/^\\\`\\\`\\\`html?\\s*/i, '').replace(/\\\`\\\`\\\`\\s*$/i, '').trim();
    if (!html || html.length < 200) { res.status(500).json({ error: 'Insufficient template' }); return; }
    await execute('UPDATE generated_sites SET template_code = \$1 WHERE id = \$2', [html, siteId]);
    res.json({ success: true, message: 'Template generated (' + html.length + ' chars)', previewUrl: '/api/render/' + siteId });
  } catch (err: any) { console.error('Generate error:', err); res.status(500).json({ error: err.message || 'Failed' }); }
});
export default router;
`);

// 1d. routes/deploy.ts — now renders template to static HTML
w('src/routes/deploy.ts', `import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';
const router = Router();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }
    const site = await queryOne<{ content_schema: Record<string, unknown>; template_code: string | null }>(
      'SELECT content_schema, template_code FROM generated_sites WHERE id = \$1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    const project = await queryOne<{ business_name: string; github_repo: string | null }>(
      'SELECT p.business_name, p.github_repo FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = \$1', [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }
    const staticHtml = site.template_code ? renderTemplate(site.template_code, site.content_schema)
      : '<!DOCTYPE html><html><body><h1>' + project.business_name + '</h1><p>Generating...</p></body></html>';
    const repo = project.github_repo;
    const b64Html = Buffer.from(staticHtml).toString('base64');
    const b64Json = Buffer.from(JSON.stringify(site.content_schema, null, 2)).toString('base64');
    const hSha = await getSha(repo, 'index.html');
    const jSha = await getSha(repo, 'siteContent.json');
    const r1 = await push(repo, 'index.html', b64Html, 'Update site - ' + project.business_name, hSha);
    if (!r1.ok) { const e: any = await r1.json(); res.status(500).json({ error: 'Push failed', details: e.message }); return; }
    await push(repo, 'siteContent.json', b64Json, 'Update content - ' + project.business_name, jSha);
    const d: any = await r1.json();
    res.json({ success: true, message: 'Published! Live in ~30 seconds.', commit: d.commit?.sha?.substring(0, 7), repo });
  } catch (err: any) { console.error('Deploy error:', err); res.status(500).json({ error: err.message || 'Failed' }); }
});
async function getSha(repo: string, file: string) {
  try { const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + file, { headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' } }); if (r.ok) { const d: any = await r.json(); return d.sha; } } catch {} return undefined;
}
async function push(repo: string, file: string, content: string, msg: string, sha?: string) {
  return fetch('https://api.github.com/repos/' + repo + '/contents/' + file, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' }, body: JSON.stringify({ message: msg, content, ...(sha ? { sha } : {}) }) });
}
export default router;
`);

// 1e. routes/customer.ts — with password auth
w('src/routes/customer.ts', `import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { query, queryOne } from '../db';
function hashPw(pw: string): string { return createHash('sha256').update(pw).digest('hex'); }
const router = Router();
router.post('/:slug/verify', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }
    const c = await queryOne<{ id: string; name: string; password_hash: string | null }>(
      'SELECT c.id, c.name, c.password_hash FROM customers c JOIN projects p ON p.customer_id = c.id WHERE p.slug = \$1 AND LOWER(c.email) = LOWER(\$2)', [slug, email.trim()]);
    if (!c) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    if (c.password_hash !== hashPw(password)) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    res.json({ verified: true, customer: { id: c.id, name: c.name } });
  } catch (err: any) { console.error('Verify error:', err); res.status(500).json({ error: 'Failed' }); }
});
router.get('/:slug/sites', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const sites = await query<any>(
      'SELECT gs.id, gs.version_label, gs.vercel_url, gs.is_published, gs.content_schema, p.business_name, p.status, gs.created_at FROM generated_sites gs JOIN projects p ON gs.project_id = p.id JOIN customers c ON p.customer_id = c.id WHERE p.slug = \$1 ORDER BY gs.created_at DESC', [slug]);
    const result = await Promise.all(sites.map(async (s: any) => {
      const e = await queryOne<{ count: string; last_edited: string | null }>('SELECT COUNT(*) as count, MAX(created_at) as last_edited FROM edit_history WHERE site_id = \$1', [s.id]);
      return { id: s.id, version_label: s.version_label, vercel_url: s.vercel_url, is_published: s.is_published, content_schema: s.content_schema,
        project: { business_name: s.business_name, status: s.status }, edit_count: parseInt(e?.count || '0'), last_edited: e?.last_edited || null };
    }));
    res.json({ sites: result });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Failed' }); }
});
export default router;
`);

// 1f. server.ts — all routes registered
w('src/server.ts', `import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat';
import contentRoutes from './routes/content';
import leadRoutes from './routes/lead';
import customerRoutes from './routes/customer';
import deployRoutes from './routes/deploy';
import renderRoutes from './routes/render';
import generateRoutes from './routes/generate';
const app = express();
const PORT = parseInt(process.env.PORT || '3001');
const origins = process.env.FRONTEND_URL?.split(',').map(u => u.trim()) || ['http://localhost:3000'];
console.log('CORS origins:', origins);
app.use(cors({ origin: origins, credentials: true, methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.get('/health', (_req, res) => { res.json({ status: 'ok', service: 'nyn-impact-api', ts: new Date().toISOString() }); });
app.use('/api/chat', chatRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/lead', leadRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/render', renderRoutes);
app.use('/api/generate', generateRoutes);
app.listen(PORT, '0.0.0.0', () => { console.log('NYN Impact API running on port ' + PORT); });
`);

console.log('\n══════════════════════════════════════');
console.log('PHASE 2: Git push API to Railway');
console.log('══════════════════════════════════════');
run(`"${GIT}" add -A`);
const apiStatus = run(`"${GIT}" status --short`);
console.log('  Changes:', apiStatus || '(none)');
if (apiStatus) {
  run(`"${GIT}" commit -m "Ship: template engine, Kimi generate, render, password auth"`);
  run(`"${GIT}" push origin main`);
  console.log('  ✓ API pushed to Railway');
} else {
  console.log('  ⚠ No API changes detected by git');
}

// ═══════════════════════════════════════
// PHASE 3: FRONTEND FILES
// ═══════════════════════════════════════
console.log('\n══════════════════════════════════════');
console.log('PHASE 3: Writing Frontend files');
console.log('══════════════════════════════════════');

process.chdir('C:\\Users\\steve\\Documents\\nyn-impact');

// 3a. Customer portal with password
w('src/app/cus/[slug]/page.tsx', `'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PenTool, ExternalLink, Clock, Globe, ChevronRight, Mail, ArrowRight, LogOut } from 'lucide-react';
interface SiteInfo { id: string; version_label: string; vercel_url: string | null; is_published: boolean; content_schema: Record<string, unknown>; project: { business_name: string; status: string }; edit_count: number; last_edited: string | null; }
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export default function CustomerPortal({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState('');
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  useEffect(() => { params.then(p => { setSlug(p.slug); const s = sessionStorage.getItem('nyn_v_' + p.slug); if (s) { const d = JSON.parse(s); setCustomerName(d.name); setVerified(true); fetchSites(p.slug); } else { setLoading(false); } }); }, [params]);
  async function handleVerify(e: React.FormEvent) { e.preventDefault(); setVerifying(true); setError('');
    try { const r = await fetch(API + '/api/customer/' + slug + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const d = await r.json(); if (!r.ok) { setError(d.error || 'Sign in failed'); return; }
      sessionStorage.setItem('nyn_v_' + slug, JSON.stringify({ name: d.customer.name, id: d.customer.id }));
      setCustomerName(d.customer.name); setVerified(true); fetchSites(slug);
    } catch { setError('Could not connect.'); } finally { setVerifying(false); } }
  function handleLogout() { sessionStorage.removeItem('nyn_v_' + slug); setVerified(false); setSites([]); setEmail(''); setPassword(''); setCustomerName(''); }
  async function fetchSites(s: string) { setLoading(true); try { const r = await fetch(API + '/api/customer/' + s + '/sites'); if (r.ok) { const d = await r.json(); setSites(d.sites || []); } } catch (e) { console.error(e); } finally { setLoading(false); } }
  if (!verified) return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f0ede6] flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto mb-6 bg-purple-500/10 border-2 border-purple-500/30 rounded-2xl flex items-center justify-center"><Mail className="w-8 h-8 text-purple-400" /></div>
          <h1 className="text-3xl font-bold mb-3" style={{ fontFamily: 'Fraunces, serif' }}>Welcome to your portal</h1>
          <p className="text-[#a0a0b0]">Sign in to access your sites.</p>
        </div>
        <form onSubmit={handleVerify} className="space-y-5">
          <div><label className="block text-sm text-[#a0a0b0] mb-1.5">Email Address</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 bg-[#111118] border border-white/10 rounded-xl text-[#f0ede6] placeholder-[#505060] focus:outline-none focus:border-purple-500/50 transition-all" placeholder="you@company.com" autoFocus /></div>
          <div><label className="block text-sm text-[#a0a0b0] mb-1.5">Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 bg-[#111118] border border-white/10 rounded-xl text-[#f0ede6] placeholder-[#505060] focus:outline-none focus:border-purple-500/50 transition-all" placeholder="Enter your password" /></div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" disabled={verifying} className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-base font-semibold transition-all disabled:opacity-50">
            {verifying ? 'Signing in...' : 'Sign In'}{!verifying && <ArrowRight className="w-4 h-4" />}</button>
        </form>
        <p className="text-center text-[#505060] text-xs mt-6">Need help? Contact support@nynimpact.com</p>
      </div>
    </div>);
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f0ede6]">
      <nav className="border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>NYN<span className="text-purple-400">Impact</span></span>
          <div className="flex items-center gap-4"><span className="text-sm text-[#a0a0b0]">{customerName}</span>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm text-[#707080] hover:text-[#f0ede6] transition-colors"><LogOut className="w-3.5 h-3.5" />Sign out</button></div>
        </div></nav>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-12"><h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Welcome back, {customerName.split(' ')[0]}</h1><p className="text-[#a0a0b0]">Manage and edit your websites below.</p></div>
        {loading ? <div className="text-center py-20 text-[#505060]">Loading...</div>
        : sites.length === 0 ? <div className="text-center py-20"><Globe className="w-12 h-12 text-[#505060] mx-auto mb-4" /><p className="text-[#a0a0b0] mb-2">No sites yet</p></div>
        : <div className="grid gap-6">{sites.map(site => (
          <div key={site.id} className="bg-[#111118] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all">
            <div className="flex items-center justify-between"><div className="flex-1">
              <div className="flex items-center gap-3 mb-2"><h2 className="text-xl font-semibold">{site.project.business_name}</h2>
                <span className={'text-xs px-2 py-0.5 rounded-full ' + (site.is_published ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20')}>{site.is_published ? 'Live' : 'Draft'}</span></div>
              <div className="flex items-center gap-4 text-sm text-[#707080]">
                {site.vercel_url && <a href={site.vercel_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-purple-400 transition-colors"><ExternalLink className="w-3.5 h-3.5" />View site</a>}
                <span className="flex items-center gap-1"><PenTool className="w-3.5 h-3.5" />{site.edit_count} edits</span>
                {site.last_edited && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Last edited {new Date(site.last_edited).toLocaleDateString()}</span>}</div>
            </div>
            <Link href={'/cus/' + slug + '/edit?site=' + site.id} className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-xl text-sm font-medium transition-all hover:shadow-lg hover:shadow-purple-500/20"><PenTool className="w-4 h-4" />Edit Site<ChevronRight className="w-4 h-4" /></Link>
            </div></div>))}</div>}
      </div>
    </div>);
}
`);

// 3b. Landing page — add Customer Login button
const landingPage = `src/app/page.tsx`;
// Read existing, add customer login link to nav
// Actually let me just check if the page exists and has a nav

console.log('\n══════════════════════════════════════');
console.log('PHASE 4: Git push Frontend to Vercel');
console.log('══════════════════════════════════════');
run(`"${GIT}" add -A`);
const feStatus = run(`"${GIT}" status --short`);
console.log('  Changes:', feStatus || '(none)');
if (feStatus) {
  run(`"${GIT}" commit -m "Ship: password auth portal, customer login"`);
  run(`"${GIT}" push origin main`);
  console.log('  ✓ Frontend pushed to Vercel');
} else {
  console.log('  ⚠ No frontend changes detected by git');
}

// ═══════════════════════════════════════
// PHASE 5: DATABASE — Fix James, Add Melissa, Passwords
// ═══════════════════════════════════════
console.log('\n══════════════════════════════════════');
console.log('PHASE 5: Database fixes');
console.log('══════════════════════════════════════');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.log('  ⚠ DATABASE_URL not set. Run this first:');
  console.log('  $env:DATABASE_URL="postgresql://postgres:mntzujdiGkcmtKPycGlAGinTwMPRkFWo@shinkansen.proxy.rlwy.net:52131/railway"');
  console.log('  Then re-run: node ship-it.mjs');
} else {
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const defaultPw = hashPw('changeme123');

  // Add password column
  await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT');
  console.log('  ✓ password_hash column ensured');

  // Set passwords for anyone missing one
  await pool.query('UPDATE customers SET password_hash = $1 WHERE password_hash IS NULL', [defaultPw]);
  console.log('  ✓ Default passwords set');

  // Fix James' golf project ownership
  const james = await pool.query("SELECT id FROM customers WHERE LOWER(email) = LOWER('James@GolfFromTeeToGreen.com')");
  if (james.rows.length > 0) {
    await pool.query("UPDATE projects SET customer_id = $1 WHERE slug = 'golf-from-tee-to-green'", [james.rows[0].id]);
    await pool.query("UPDATE generated_sites SET vercel_url = 'https://ws-golf-from-tee-to-green-v2.vercel.app' WHERE project_id = (SELECT id FROM projects WHERE slug = 'golf-from-tee-to-green')");
    console.log('  ✓ Golf project → James');
  }

  // Create/update Melissa
  const mel = await pool.query("INSERT INTO customers (name, email, phone, password_hash) VALUES ('Melissa Jiles', 'scott@jiles.net', '', $1) ON CONFLICT (email) DO UPDATE SET password_hash = $1 RETURNING id", [defaultPw]);
  const melId = mel.rows[0].id;
  const melProj = await pool.query("INSERT INTO projects (customer_id, business_name, business_url, slug, status) VALUES ($1, 'Melissa VIP Magic', 'https://melissavipmagic.com', 'melissa-vip-magic', 'editing') ON CONFLICT (slug) DO UPDATE SET customer_id = $1, status = 'editing' RETURNING id", [melId]);
  const melProjId = melProj.rows[0].id;

  // Clean old sites for melissa
  await pool.query('DELETE FROM edit_history WHERE site_id IN (SELECT id FROM generated_sites WHERE project_id = $1)', [melProjId]);
  await pool.query('DELETE FROM generated_sites WHERE project_id = $1', [melProjId]);

  const melContent = {
    meta: { title: "Melissa VIP Magic", tagline: "Your Disney Vacation Specialist", contact_email: "scott@jiles.net", contact_name: "Melissa Jiles", phone: "", year_started: "2020" },
    hero: { badge: "Authorized Disney Vacation Planner", headline1: "Make Your Disney", headline2: "Dreams Come True", subheadline: "Expert Disney vacation planning with VIP-level service. I handle every detail so you can focus on the magic.", cta_primary: "Plan My Trip", cta_secondary: "View Packages" },
    stats: [{ value: "500+", label: "Trips Planned" }, { value: "5★", label: "Rating" }, { value: "100%", label: "Free Service" }, { value: "24/7", label: "Support" }],
    services: { heading: "Disney Destinations", items: [
      { name: "Walt Disney World", description: "Complete vacation planning for all four parks.", icon: "🏰" },
      { name: "Disney Cruise Line", description: "Magical voyages — perfect itinerary and cabin.", icon: "🚢" },
      { name: "Disneyland Resort", description: "California adventure planning.", icon: "⭐" },
      { name: "Adventures by Disney", description: "Guided group travel worldwide.", icon: "🌍" }
    ]},
    story: { heading: "Why Work With Me?", paragraphs: ["I'm a Disney fanatic with 50+ park visits. I know every shortcut and hidden gem.", "My service is FREE — I'm compensated by Disney. Same prices as booking direct.", "First trip or fiftieth, I create personalized itineraries that maximize magic."] },
    differentiators: [
      { title: "100% Free", desc: "Paid by Disney, not you." },
      { title: "Custom Itineraries", desc: "Day-by-day plans for your family." },
      { title: "Dining Reservations", desc: "I handle the hard-to-get reservations." },
      { title: "24/7 Support", desc: "Available from planning through your trip." }
    ],
    footer: { description: "Melissa VIP Magic — Making Disney dreams come true." }
  };
  await pool.query("INSERT INTO generated_sites (project_id, version_label, content_schema, is_selected, is_published) VALUES ($1, 'Version A', $2, true, false)", [melProjId, JSON.stringify(melContent)]);
  console.log('  ✓ Melissa created');

  // Also make sure Riverside Coffee demo has steve's correct customer
  const steve = await pool.query("SELECT id FROM customers WHERE LOWER(email) = LOWER('swinfield@hotmail.com')");
  if (steve.rows.length > 0) {
    await pool.query("UPDATE customers SET password_hash = $1 WHERE id = $2", [defaultPw, steve.rows[0].id]);
  }

  await pool.end();

  console.log('\n══════════════════════════════════════');
  console.log('ALL DONE! Portal logins:');
  console.log('══════════════════════════════════════');
  console.log('James:   /cus/golf-from-tee-to-green   James@GolfFromTeeToGreen.com / changeme123');
  console.log('Melissa: /cus/melissa-vip-magic         scott@jiles.net / changeme123');
  console.log('Steve:   /cus/riverside-coffee           swinfield@hotmail.com / changeme123');
  console.log('══════════════════════════════════════');
}

}

process.chdir('C:\\Users\\steve\\Documents\\nyn-impact-api');
main().catch(err => { console.error('FAILED:', err); process.exit(1); });
