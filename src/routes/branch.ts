import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BRANCH_NAME = 'nyn-preview';

// Helper: GitHub API call
async function ghApi(path: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

// POST /api/branch/create — create preview branch from main
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }

    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p
       JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    const repo = project.github_repo;

    // Get main branch SHA
    const mainRef = await ghApi(`/repos/${repo}/git/ref/heads/main`);
    if (!mainRef.ok) { res.status(500).json({ error: 'Cannot read main branch' }); return; }
    const mainData: any = await mainRef.json();
    const mainSha = mainData.object.sha;

    // Check if preview branch already exists
    const existing = await ghApi(`/repos/${repo}/git/ref/heads/${BRANCH_NAME}`);
    if (existing.ok) {
      // Update it to match main (reset preview to current production)
      const updateRes = await ghApi(`/repos/${repo}/git/refs/heads/${BRANCH_NAME}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: mainSha, force: true }),
      });
      if (!updateRes.ok) {
        const err: any = await updateRes.json();
        res.status(500).json({ error: 'Failed to reset preview branch', details: err.message }); return;
      }
      console.log(`Reset preview branch to main (${mainSha.substring(0, 7)}) for ${project.business_name}`);
    } else {
      // Create the branch
      const createRes = await ghApi(`/repos/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${BRANCH_NAME}`, sha: mainSha }),
      });
      if (!createRes.ok) {
        const err: any = await createRes.json();
        res.status(500).json({ error: 'Failed to create preview branch', details: err.message }); return;
      }
      console.log(`Created preview branch from main (${mainSha.substring(0, 7)}) for ${project.business_name}`);
    }

    // The Vercel preview URL pattern
    const repoName = repo.split('/')[1];
    const previewUrl = `https://${repoName}-git-${BRANCH_NAME}-wintech-projcts.vercel.app`;
    await execute('UPDATE generated_sites SET preview_url = $1 WHERE id = $2', [previewUrl, siteId]);

    res.json({
      success: true,
      message: `Preview branch ready for ${project.business_name}`,
      branch: BRANCH_NAME,
      previewUrl,
      repo,
    });
  } catch (err: any) {
    console.error('Branch create error:', err);
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// POST /api/branch/edit — push a file change to the preview branch
router.post('/edit', async (req: Request, res: Response) => {
  try {
    const { siteId, filePath, content, commitMessage } = req.body;
    if (!siteId || !filePath || content === undefined) {
      res.status(400).json({ error: 'Missing siteId, filePath, or content' }); return;
    }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }

    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p
       JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    const repo = project.github_repo;
    const b64Content = Buffer.from(content).toString('base64');

    // Get current file SHA on preview branch (needed to update)
    let sha: string | undefined;
    const fileRes = await ghApi(`/repos/${repo}/contents/${filePath}?ref=${BRANCH_NAME}`);
    if (fileRes.ok) {
      const fileData: any = await fileRes.json();
      sha = fileData.sha;
    }

    // Push the file to the preview branch
    const pushRes = await ghApi(`/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: commitMessage || `Edit ${filePath} — ${project.business_name}`,
        content: b64Content,
        branch: BRANCH_NAME,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!pushRes.ok) {
      const err: any = await pushRes.json();
      res.status(500).json({ error: 'Push failed', details: err.message }); return;
    }

    const pushData: any = await pushRes.json();
    console.log(`Pushed ${filePath} to ${BRANCH_NAME} for ${project.business_name}`);

    res.json({
      success: true,
      message: `Edit pushed to preview. Vercel will rebuild in ~30s.`,
      commit: pushData.commit?.sha?.substring(0, 7),
      branch: BRANCH_NAME,
    });
  } catch (err: any) {
    console.error('Branch edit error:', err);
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// POST /api/branch/merge — merge preview into main (= publish to production)
router.post('/merge', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    if (!siteId) { res.status(400).json({ error: 'Missing siteId' }); return; }
    if (!GITHUB_TOKEN) { res.status(500).json({ error: 'GITHUB_TOKEN not set' }); return; }

    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p
       JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.status(400).json({ error: 'No GitHub repo linked' }); return; }

    const repo = project.github_repo;

    // Merge preview into main
    const mergeRes = await ghApi(`/repos/${repo}/merges`, {
      method: 'POST',
      body: JSON.stringify({
        base: 'main',
        head: BRANCH_NAME,
        commit_message: `Publish updates — ${project.business_name} via NYN Impact`,
      }),
    });

    if (!mergeRes.ok) {
      const err: any = await mergeRes.json();
      if (mergeRes.status === 409) {
        res.json({ success: true, message: 'Already up to date. No changes to publish.' });
        return;
      }
      res.status(500).json({ error: 'Merge failed', details: err.message }); return;
    }

    const mergeData: any = await mergeRes.json();
    console.log(`Merged preview → main for ${project.business_name}: ${mergeData.sha?.substring(0, 7)}`);

    res.json({
      success: true,
      message: 'Published! Your changes are live in ~30 seconds.',
      commit: mergeData.sha?.substring(0, 7),
      repo,
    });
  } catch (err: any) {
    console.error('Branch merge error:', err);
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// GET /api/branch/preview-url/:siteId — get the preview URL for a site
router.get('/preview-url/:siteId', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const site = await queryOne<{ preview_url: string | null }>(
      'SELECT preview_url FROM generated_sites WHERE id = $1', [siteId]);
    if (!site) { res.status(404).json({ error: 'Site not found' }); return; }
    res.json({ previewUrl: site.preview_url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

export default router;
