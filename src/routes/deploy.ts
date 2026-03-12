import { Router, Request, Response } from 'express';
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
      'SELECT content_schema, template_code FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    const project = await queryOne<{ business_name: string; github_repo: string | null }>(
      'SELECT p.business_name, p.github_repo FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1', [siteId]);
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
