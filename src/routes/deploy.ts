import { Router, Request, Response } from 'express';
import { queryOne } from '../db';
import { renderTemplate } from '../lib/renderer';

const router = Router();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// POST /api/deploy — render template + content into static HTML, push to GitHub
router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;

    if (!siteId) {
      res.status(400).json({ error: 'Missing siteId' });
      return;
    }

    if (!GITHUB_TOKEN) {
      res.status(500).json({ error: 'GITHUB_TOKEN not configured on server' });
      return;
    }

    const site = await queryOne<{
      content_schema: Record<string, unknown>;
      template_code: string | null;
      vercel_url: string | null;
    }>(
      'SELECT content_schema, template_code, vercel_url FROM generated_sites WHERE id = $1',
      [siteId]
    );

    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const project = await queryOne<{
      business_name: string;
      github_repo: string | null;
    }>(`
      SELECT p.business_name, p.github_repo
      FROM projects p
      JOIN generated_sites gs ON gs.project_id = p.id
      WHERE gs.id = $1
    `, [siteId]);

    if (!project?.github_repo) {
      res.status(400).json({ error: 'No GitHub repo linked to this project' });
      return;
    }

    // Generate the static HTML
    let staticHtml: string;
    if (site.template_code) {
      // Template exists — render it with current content
      staticHtml = renderTemplate(site.template_code, site.content_schema);
    } else {
      // No template yet — push raw content JSON as fallback
      staticHtml = `<!DOCTYPE html><html><head><title>${project.business_name}</title></head><body><h1>${project.business_name}</h1><p>Site template is being generated...</p></body></html>`;
    }

    const repo = project.github_repo;

    // Push index.html to the repo
    const filePath = 'index.html';
    const content = Buffer.from(staticHtml).toString('base64');

    // Also push siteContent.json for API consumers
    const jsonContent = Buffer.from(JSON.stringify(site.content_schema, null, 2)).toString('base64');

    // Check if files exist (need SHA to update)
    const htmlSha = await getFileSha(repo, filePath);
    const jsonSha = await getFileSha(repo, 'siteContent.json');

    // Push index.html
    const htmlRes = await pushToGitHub(repo, filePath, content, `Update site — ${project.business_name}`, htmlSha);
    if (!htmlRes.ok) {
      const err: any = await htmlRes.json();
      res.status(500).json({ error: 'GitHub push failed', details: err.message });
      return;
    }

    // Push siteContent.json
    await pushToGitHub(repo, 'siteContent.json', jsonContent, `Update content — ${project.business_name}`, jsonSha);

    const htmlData: any = await htmlRes.json();

    res.json({
      success: true,
      message: `Published! Site deployed to GitHub. Vercel will go live in ~30 seconds.`,
      commit: htmlData.commit?.sha?.substring(0, 7),
      repo,
    });
  } catch (err: any) {
    console.error('Deploy error:', err);
    res.status(500).json({ error: err.message || 'Deploy failed' });
  }
});

async function getFileSha(repo: string, filePath: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (res.ok) {
      const data: any = await res.json();
      return data.sha;
    }
  } catch { /* file doesn't exist */ }
  return undefined;
}

async function pushToGitHub(repo: string, filePath: string, content: string, message: string, sha?: string) {
  return fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      message,
      content,
      ...(sha ? { sha } : {}),
    }),
  });
}

export default router;
