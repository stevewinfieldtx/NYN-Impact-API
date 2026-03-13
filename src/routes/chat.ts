// Code-aware chat editor — reads source, makes targeted edits, pushes to preview branch
import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID || 'anthropic/claude-sonnet-4-20250514';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BRANCH_NAME = 'nyn-preview';

// Fetch a file from the GitHub repo (preview branch)
async function getFileFromGitHub(repo: string, filePath: string): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${BRANCH_NAME}`, {
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

// Push a file to the preview branch
async function pushFileToGitHub(repo: string, filePath: string, content: string, sha: string, message: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: BRANCH_NAME, sha }),
  });
  return res;
}

// POST /api/chat — Code-aware AI editor
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, siteId } = req.body;
    if (!message || !siteId) { res.status(400).json({ error: 'Missing message or siteId' }); return; }

    // Get project info
    const project = await queryOne<{ github_repo: string; business_name: string }>(
      `SELECT p.github_repo, p.business_name FROM projects p JOIN generated_sites gs ON gs.project_id = p.id WHERE gs.id = $1`, [siteId]);
    if (!project?.github_repo) { res.json({ success: false, message: 'No repository linked to this site.' }); return; }

    const repo = project.github_repo;

    // Fetch the main source file from GitHub
    const file = await getFileFromGitHub(repo, 'src/App.tsx');
    if (!file) { res.json({ success: false, message: 'Could not read site source code.' }); return; }

    // Send the user's request + source code to the AI
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENROUTER_MODEL_ID,
        messages: [
          {
            role: 'system',
            content: `You are a website code editor for "${project.business_name}". The customer describes changes they want to their website in plain English. You make precise, targeted edits to the React/TypeScript source code.

RULES:
1. Make ONLY the change the customer asked for. Do NOT refactor, reformat, or change anything else.
2. Respond with a JSON object containing:
   - "action": "edit" if you can make the change, "clarify" if you need more info
   - "description": A friendly message describing what you changed (for "edit") or what you need to know (for "clarify")
   - "search": The EXACT string in the source code that needs to be replaced (for "edit"). Must be unique and match exactly.
   - "replace": The new string to replace it with (for "edit")
   - "file": The file being edited, always "src/App.tsx" unless specified
3. The search string must be an exact substring of the source code. Copy it character-for-character.
4. Keep changes minimal. If they say "change color to gold", only change the color value, not the surrounding code.
5. For Tailwind CSS changes: use Tailwind classes (text-yellow-500, bg-red-600, etc.) or inline style changes.
6. For text changes: just replace the text string.
7. Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.

Example responses:
{"action":"edit","description":"Changed 'Contact Melissa' text color to gold","search":"className=\\"flex items-center gap-2 hover:text-[#F5A623] transition-colors font-semibold\\"","replace":"className=\\"flex items-center gap-2 text-[#F5A623] transition-colors font-semibold\\""}
{"action":"clarify","description":"I see several headings on the page. Which one would you like me to change? The main hero title, the services heading, or something else?"}`
          },
          {
            role: 'user',
            content: `Here is the current source code of the website:\n\n${file.content}\n\n---\nCustomer request: "${message}"`
          }
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    const aiData: any = await aiResponse.json();
    const aiText: string = aiData.choices?.[0]?.message?.content || '';

    let intent;
    try {
      intent = JSON.parse(aiText.replace(/```json?\s*/g, '').replace(/```/g, '').trim());
    } catch {
      res.json({ success: false, message: "I couldn't understand that request. Try describing the change differently." });
      return;
    }

    if (intent.action === 'clarify') {
      res.json({ success: false, message: intent.description || "Could you be more specific?" });
      return;
    }

    if (intent.action === 'edit' && intent.search && intent.replace !== undefined) {
      // Verify the search string exists in the source
      if (!file.content.includes(intent.search)) {
        // Try a fuzzy match — the AI might have small differences
        console.log('Exact match not found, search string:', intent.search.substring(0, 100));
        res.json({ success: false, message: "I found the right section but couldn't make the exact edit. Could you try describing the change differently?" });
        return;
      }

      // Make the replacement
      const newContent = file.content.replace(intent.search, intent.replace);

      if (newContent === file.content) {
        res.json({ success: false, message: "The change would result in no difference. The content might already be what you requested." });
        return;
      }

      // Push to preview branch
      const pushRes = await pushFileToGitHub(repo, 'src/App.tsx', newContent, file.sha, `Edit: ${message}`);
      if (!pushRes.ok) {
        const err: any = await pushRes.json();
        console.error('Push failed:', err);
        res.json({ success: false, message: 'Failed to save the change. Please try again.' });
        return;
      }

      const pushData: any = await pushRes.json();

      // Log the edit in our database
      const countResult = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM edit_history WHERE site_id = $1', [siteId]);
      const editNumber = parseInt(countResult?.count || '0') + 1;
      await execute(
        'INSERT INTO edit_history (site_id, field_path, old_value, new_value, ai_prompt, edit_number) VALUES ($1, $2, $3, $4, $5, $6)',
        [siteId, intent.file || 'src/App.tsx', intent.search.substring(0, 500), intent.replace.substring(0, 500), message, editNumber]
      );

      res.json({
        success: true,
        message: (intent.description || 'Change applied!') + ' Preview will update in ~30 seconds.',
        edit: {
          fieldPath: intent.file || 'src/App.tsx',
          oldValue: intent.search.substring(0, 100),
          newValue: intent.replace.substring(0, 100),
        },
        commit: pushData.commit?.sha?.substring(0, 7),
      });
      return;
    }

    res.json({ success: false, message: "I'm not sure how to make that change. Try describing what text or color you'd like to change." });
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

export default router;
