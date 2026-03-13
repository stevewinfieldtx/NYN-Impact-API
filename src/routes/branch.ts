import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BRANCH_NAME = 'nyn-preview';

async function ghApi(path: string, options: RequestInit = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

router.post('/create', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }

    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    const repo = project.github_repo;
    const mainRef = await ghApi(`/repos/${repo}/git/ref/heads/main`);
    if (!mainRef.ok) { res.status(500).json({ error: 'Cannot read main branch' }); return; }
    const mainData: any = await mainRef.json();
    const mainSha = mainData.object.sha;

    const existing = await ghApi(`/repos/${repo}/git/ref/heads/${BRANCH_NAME}`);
    if (existing.ok) {
      await ghApi(`/repos/${repo}/git/refs/heads/${BRANCH_NAME}`, {
        method: 'PATCH', body: JSON.stringify({ sha: mainSha, force: true }),
      });
      console.log(`Reset preview branch for ${project.business_name}`);
    } else {
      await ghApi(`/repos/${repo}/git/refs`, {
        method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH_NAME}`, sha: mainSha }),
      });
      console.log(`Created preview branch for ${project.business_name}`);
    }

    const repoName = repo.split('/')[1];
    const previewUrl = `https://${repoName}-git-${BRANCH_NAME}-wintech-projcts.vercel.app`;
    await execute('UPDATE generated_sites SET preview_url = $1 WHERE id = $2', [previewUrl, siteId]);

    res.json({ success: true, branch: BRANCH_NAME, previewUrl, repo });
  } catch (err: any) { console.error('Branch create error:', err); res.status(500).json({ error: err.message || 'Failed' }); }
});

router.post('/edit', async (req: Request, res: Response) => {
  try {
    const { siteId, filePath, content, commitMessage } = req.body;
    if (!siteId || !filePath || content === undefined) { res.status(400).json({ error: 'Missing siteId, filePath, or content' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }

    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    const repo = project.github_repo;
    const b64 = Buffer.from(content).toString('base64');

    let sha: string | undefined;
    const fileRes = await ghApi(`/repos/${repo}/contents/${filePath}?ref=${BRANCH_NAME}`);
    if (fileRes.ok) { const fd: any = await fileRes.json(); sha = fd.sha; }

    const pushRes = await ghApi(`/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({ message: commitMessage || `Edit ${filePath}`, content: b64, branch: BRANCH_NAME, ...(sha ? { sha } : {}) }),
    });

    if (!pushRes.ok) { const err: any = await pushRes.json(); res.status(500).json({ error: 'Push failed', details: err.message }); return; }
    const pushData: any = await pushRes.json();

    res.json({ success: true, message: 'Edit pushed to preview. Vercel rebuilds in ~30s.', commit: pushData.commit?.sha?.substring(0, 7), branch: BRANCH_NAME });
  } catch (err: any) { console.error('Branch edit error:', err); res.status(500).json({ error: err.message || 'Failed' }); }
});

router.post('/merge', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }

    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    const repo = project.github_repo;
    const mergeRes = await ghApi(`/repos/${repo}/merges`, {
      method: 'POST',
      body: JSON.stringify({ base: 'main', head: BRANCH_NAME, commit_message: `Publish — ${project.business_name} via NYN Impact` }),
    });

    if (!mergeRes.ok) {
      if (mergeRes.status === 409) { res.json({ success: true, message: 'Already up to date.' }); return; }
      const err: any = await mergeRes.json();
      res.status(500).json({ error: 'Merge failed', details: err.message }); return;
    }

    const mergeData: any = await mergeRes.json();
    res.json({ success: true, message: 'Published! Live in ~30 seconds.', commit: mergeData.sha?.substring(0, 7), repo });
  } catch (err: any) { console.error('Branch merge error:', err); res.status(500).json({ error: err.message || 'Failed' }); }
});

router.get('/preview-url/:siteId', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{ preview_url: string | null }>('SELECT preview_url FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    res.json({ previewUrl: site.preview_url });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Failed' }); }
});

export default router;
