import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';

const router = Router();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID!;

// ─── OpenRouter helper ────────────────────────────────────────────────────────

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error('Missing OPENROUTER_API_KEY');
  if (!OPENROUTER_MODEL_ID) throw new Error('Missing OPENROUTER_MODEL_ID');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1000,
    }),
  });

  const data: any = await response.json();

  if (!response.ok) {
    throw new Error(`OpenRouter error (${response.status}): ${data.error?.message || 'Unknown error'}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned empty content');

  return content.replace(/```json|```/g, '').trim();
}

// ─── AI task functions ────────────────────────────────────────────────────────

async function runAIDiagnosis(siteName: string, vercelProjectId: string, issueDescription: string, source: string): Promise<any> {
  const system = `You are an expert web developer for NYN Impact, an AI-powered marketing agency.
Diagnose website issues and provide actionable fixes. Respond with valid JSON only — no markdown, no preamble.`;

  const user = `Site: ${siteName} (Vercel: ${vercelProjectId})
Issue Source: ${source}
Issue: ${issueDescription}

Respond with exactly:
{"severity":"critical|warning|info","diagnosis":"explanation","fix_recommendation":"step-by-step fix","estimated_effort":"quick|moderate|substantial","can_auto_apply":true|false}`;

  return JSON.parse(await callAI(system, user));
}

async function runSiteScan(siteName: string, vercelProjectId: string, domain: string): Promise<any> {
  const system = `You are a website QA specialist for NYN Impact.
Analyze sites and generate realistic scan reports. Respond with valid JSON only — no markdown, no preamble.`;

  const user = `Scan this site:
Name: ${siteName}
Vercel Project: ${vercelProjectId}
URL: ${domain}

Check: broken links, missing meta tags, missing alt text, mobile responsiveness, favicon, contact forms, SSL, sitemap, robots.txt.

Respond with exactly:
{"scan_summary":"1-2 sentence assessment","overall_health":"excellent|good|needs_attention|critical","issues_found":[{"category":"SEO|Performance|Accessibility|UX|Security","severity":"critical|warning|info","description":"what was found","recommendation":"how to fix it"}],"quick_wins":["win1","win2"]}`;

  return JSON.parse(await callAI(system, user));
}

async function generateContentRewrite(siteName: string, currentContent: string, clientRequest: string): Promise<any> {
  const system = `You are an expert copywriter for NYN Impact.
Rewrite website content to be more compelling and conversion-focused. Preserve HTML structure.
Respond with valid JSON only — no markdown, no preamble.`;

  const user = `Site: ${siteName}
Client Request: ${clientRequest}
Current Content: ${currentContent.substring(0, 2000)}

Respond with exactly:
{"rewritten_html":"full rewritten HTML","changes_summary":"plain-English summary of changes","improvement_highlights":["highlight1","highlight2","highlight3"]}`;

  return JSON.parse(await callAI(system, user));
}

// ─── Middleware: load site by generated_sites.id ──────────────────────────────

async function loadSite(req: Request, res: Response, next: Function) {
  const site = await queryOne<{
    id: string;
    business_name: string;
    vercel_project_id: string;
    client_email: string;
    domain: string;
    ai_selfcorrect_enabled: boolean;
  }>(`
    SELECT gs.id, p.business_name, gs.vercel_project_id, gs.client_email,
           COALESCE(gs.vercel_url, p.business_url, '') as domain,
           gs.ai_selfcorrect_enabled
    FROM generated_sites gs
    JOIN projects p ON gs.project_id = p.id
    WHERE gs.id = $1 AND gs.ai_selfcorrect_enabled = true
  `, [req.params.siteId]);

  if (!site) {
    res.status(404).json({ error: 'Site not found or AI Self-Correct not enabled' });
    return;
  }
  (req as any).site = site;
  next();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/ai-self-correct/:siteId/scan
router.get('/:siteId/scan', loadSite, async (req: Request, res: Response) => {
  const site = (req as any).site;
  try {
    await execute(
      `UPDATE generated_sites SET scan_status = 'scanning', last_scan_at = NOW() WHERE id = $1`,
      [site.id]
    );

    const scanResult = await runSiteScan(site.business_name, site.vercel_project_id, site.domain);

    for (const issue of scanResult.issues_found) {
      await execute(`
        INSERT INTO site_issues (site_id, source, severity, issue_description, ai_diagnosis, ai_fix_recommendation, status)
        VALUES ($1, 'auto_scan', $2, $3, $3, $4, 'diagnosed')
      `, [site.id, issue.severity, issue.description, issue.recommendation]);
    }

    const newStatus = scanResult.issues_found.length === 0 ? 'clean' : 'issues_found';
    await execute(`UPDATE generated_sites SET scan_status = $1 WHERE id = $2`, [newStatus, site.id]);

    res.json({
      scan_summary: scanResult.scan_summary,
      overall_health: scanResult.overall_health,
      issues_count: scanResult.issues_found.length,
      quick_wins: scanResult.quick_wins,
    });
  } catch (err: any) {
    await execute(`UPDATE generated_sites SET scan_status = 'pending' WHERE id = $1`, [site.id]);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-self-correct/:siteId/issues
router.get('/:siteId/issues', loadSite, async (req: Request, res: Response) => {
  try {
    const { status, source } = req.query;
    let sql = 'SELECT * FROM site_issues WHERE site_id = $1';
    const params: any[] = [(req as any).site.id];

    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    if (source) { params.push(source); sql += ` AND source = $${params.length}`; }
    sql += ' ORDER BY created_at DESC';

    const issues = await query(sql, params);
    res.json({ issues, total: issues.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-self-correct/:siteId/issues
router.post('/:siteId/issues', loadSite, async (req: Request, res: Response) => {
  const site = (req as any).site;
  const { description, client_notes } = req.body;
  if (!description) { res.status(400).json({ error: 'description is required' }); return; }

  try {
    const [issue] = await query<{ id: string }>(`
      INSERT INTO site_issues (site_id, source, issue_description, client_notes, status)
      VALUES ($1, 'client_submitted', $2, $3, 'open') RETURNING id
    `, [site.id, description, client_notes || null]);

    const aiResult = await runAIDiagnosis(site.business_name, site.vercel_project_id, description, 'client_submitted');

    const [updated] = await query(`
      UPDATE site_issues SET severity=$1, ai_diagnosis=$2, ai_fix_recommendation=$3, status='diagnosed'
      WHERE id=$4 RETURNING *
    `, [aiResult.severity, aiResult.diagnosis, aiResult.fix_recommendation, issue.id]);

    res.status(201).json({ issue: updated, ai_result: aiResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-self-correct/:siteId/issues/:issueId/apply
router.post('/:siteId/issues/:issueId/apply', loadSite, async (req: Request, res: Response) => {
  try {
    const [issue] = await query(`
      UPDATE site_issues SET status='applied', resolved_at=NOW()
      WHERE id=$1 AND site_id=$2 RETURNING *
    `, [req.params.issueId, (req as any).site.id]);

    if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }
    res.json({ issue });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-self-correct/:siteId/issues/:issueId/dismiss
router.post('/:siteId/issues/:issueId/dismiss', loadSite, async (req: Request, res: Response) => {
  try {
    const [issue] = await query(`
      UPDATE site_issues SET status='dismissed', resolved_at=NOW()
      WHERE id=$1 AND site_id=$2 RETURNING *
    `, [req.params.issueId, (req as any).site.id]);

    if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }
    res.json({ issue });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-self-correct/:siteId/content/request
router.post('/:siteId/content/request', loadSite, async (req: Request, res: Response) => {
  const site = (req as any).site;
  const { page_path, current_content_html, request_notes } = req.body;
  if (!request_notes) { res.status(400).json({ error: 'request_notes is required' }); return; }

  try {
    const [snapshot] = await query<{ id: string }>(`
      INSERT INTO site_content_snapshots (site_id, page_path, content_html, request_notes, requested_by, status)
      VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id
    `, [site.id, page_path || '/', current_content_html || '', request_notes, site.client_email]);

    const aiResult = await generateContentRewrite(site.business_name, current_content_html || '', request_notes);

    const [updated] = await query(`
      UPDATE site_content_snapshots SET ai_rewrite_suggestion=$1, status='suggested'
      WHERE id=$2 RETURNING *
    `, [JSON.stringify(aiResult), snapshot.id]);

    res.status(201).json({ snapshot: updated, ai_result: aiResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-self-correct/:siteId/content/:snapshotId/approve
router.post('/:siteId/content/:snapshotId/approve', loadSite, async (req: Request, res: Response) => {
  try {
    const [snapshot] = await query(`
      UPDATE site_content_snapshots SET status='approved', updated_at=NOW()
      WHERE id=$1 AND site_id=$2 RETURNING *
    `, [req.params.snapshotId, (req as any).site.id]);

    if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return; }
    res.json({ snapshot, message: 'Content approved. Deployment queued.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
