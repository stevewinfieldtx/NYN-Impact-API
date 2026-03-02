import { Router, Request, Response } from 'express';
import { queryOne } from '../db';

const router = Router();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// POST /api/deploy — push content_schema to GitHub repo as siteContent.json
// Triggers Vercel auto-deploy for permanent changes
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

    // Get site + project info (need the GitHub repo info)
    const site = await queryOne<{
      content_schema: Record<string, unknown>;
      vercel_url: string | null;
    }>(
      'SELECT content_schema, vercel_url FROM generated_sites WHERE id = $1',
      [siteId]
    );

    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    // Get the project's github_repo from the project record
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

    // Push siteContent.json to the repo via GitHub API
    const filePath = 'public/siteContent.json';
    const content = Buffer.from(JSON.stringify(site.content_schema, null, 2)).toString('base64');
    const repo = project.github_repo; // e.g. "stevewinfieldtx/ws-GolfFromTeeToGreen-v2"

    // Check if file exists (need SHA to update)
    let sha: string | undefined;
    try {
      const existingRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (existingRes.ok) {
        const existingData: any = await existingRes.json();
        sha = existingData.sha;
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    // Create or update the file
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({
        message: `Update site content — ${project.business_name}`,
        content,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const err: any = await putRes.json();
      res.status(500).json({ error: 'GitHub push failed', details: err.message });
      return;
    }

    const putData: any = await putRes.json();

    res.json({
      success: true,
      message: `Published! Changes pushed to GitHub. Vercel will deploy in ~30 seconds.`,
      commit: putData.commit?.sha?.substring(0, 7),
      repo,
    });
  } catch (err: any) {
    console.error('Deploy error:', err);
    res.status(500).json({ error: err.message || 'Deploy failed' });
  }
});

export default router;
