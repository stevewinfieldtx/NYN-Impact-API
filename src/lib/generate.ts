// Site Generator — turns interview transcript into two content schema options
// Uses OpenRouter to create two distinct website content versions

import { query, queryOne, execute } from '../db';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID!;

const GENERATE_SYSTEM_PROMPT = `You are an expert website content strategist. Given an interview transcript with a business owner, generate a complete website content schema.

The schema should include:
- meta: { title, tagline, contact_email, contact_name, phone, year_started }
- hero: { badge, headline1, headline2, subheadline, cta_primary, cta_secondary }
- stats: [ { value, label } ] (3-4 items)
- services: { heading, description, items: [ { name, description, price? } ] }
- story: { heading, paragraphs: [ strings ] }
- differentiators: [ { title, desc } ] (3 items)
- testimonials: [ { quote, author, role } ] (2-3 items — make these realistic but clearly indicated as examples)
- footer: { description }

RULES:
- Use ONLY information from the interview transcript
- Write compelling, professional copy — not just restating what they said
- The headline should be attention-grabbing and unique to this business
- The subheadline should clearly explain the value proposition
- Stats should be real numbers from the interview or reasonable estimates
- Services should be detailed and clear
- The story should be warm and authentic, based on what the owner shared
- Differentiators should highlight what makes them genuinely unique
- Respond with ONLY valid JSON, no markdown fences, no explanation`;

// Generate two site options from a project transcript
export async function generateSiteOptions(projectId: string): Promise<{
  siteA: string;
  siteB: string;
}> {
  // Get project transcript
  const project = await queryOne<{
    transcript: string;
    status: string;
    business_name: string;
    customer_id: string;
  }>(
    `SELECT transcript, status, business_name, customer_id FROM projects WHERE id = $1`,
    [projectId]
  );

  if (!project) throw new Error('Project not found');
  if (!project.transcript) throw new Error('No transcript available — interview may not be complete');

  console.log(`Generating sites for project ${projectId} (${project.business_name})`);

  // Generate two versions in parallel
  const [versionA, versionB] = await Promise.all([
    callGenerateAI(project.transcript, 'A', 'bold, modern, and energetic'),
    callGenerateAI(project.transcript, 'B', 'warm, trustworthy, and professional'),
  ]);

  // Parse the content schemas
  const schemaA = parseJSON(versionA);
  const schemaB = parseJSON(versionB);

  // Insert both as generated_sites
  const siteAResult = await queryOne<{ id: string }>(
    `INSERT INTO generated_sites (project_id, version_label, content_schema)
     VALUES ($1, 'Option A — Bold & Modern', $2)
     RETURNING id`,
    [projectId, JSON.stringify(schemaA)]
  );

  const siteBResult = await queryOne<{ id: string }>(
    `INSERT INTO generated_sites (project_id, version_label, content_schema)
     VALUES ($1, 'Option B — Warm & Professional', $2)
     RETURNING id`,
    [projectId, JSON.stringify(schemaB)]
  );

  if (!siteAResult || !siteBResult) throw new Error('Failed to save generated sites');

  // Update project status to 'choosing'
  await execute(
    `UPDATE projects SET status = 'choosing' WHERE id = $1`,
    [projectId]
  );

  console.log(`✓ Generated 2 site options for ${project.business_name}: ${siteAResult.id}, ${siteBResult.id}`);

  return {
    siteA: siteAResult.id,
    siteB: siteBResult.id,
  };
}

// Get generated sites for a project
export async function getProjectSites(projectId: string) {
  const sites = await query<{
    id: string;
    version_label: string;
    content_schema: Record<string, unknown>;
    is_selected: boolean;
  }>(
    `SELECT id, version_label, content_schema, is_selected FROM generated_sites WHERE project_id = $1 ORDER BY created_at`,
    [projectId]
  );

  return sites;
}

// Select a site option
export async function selectSiteOption(projectId: string, siteId: string) {
  // Deselect all sites for this project
  await execute(
    `UPDATE generated_sites SET is_selected = FALSE WHERE project_id = $1`,
    [projectId]
  );

  // Select the chosen one
  await execute(
    `UPDATE generated_sites SET is_selected = TRUE WHERE id = $1 AND project_id = $2`,
    [siteId, projectId]
  );

  // Update project status to 'editing'
  await execute(
    `UPDATE projects SET status = 'editing' WHERE id = $1`,
    [projectId]
  );

  // Get the project slug for redirect
  const project = await queryOne<{ slug: string }>(
    `SELECT slug FROM projects WHERE id = $1`,
    [projectId]
  );

  return { success: true, slug: project?.slug };
}

// Call OpenRouter to generate a content schema
async function callGenerateAI(transcript: string, version: string, style: string): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error('AI service not configured — missing OPENROUTER_API_KEY');
  if (!OPENROUTER_MODEL_ID) throw new Error('AI service not configured — missing OPENROUTER_MODEL_ID');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_ID,
      messages: [
        { role: 'system', content: GENERATE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Here is the interview transcript:\n\n${transcript}\n\nGenerate Version ${version} of the website content. The overall tone and style should be: ${style}. Remember to respond with ONLY valid JSON.`
        },
      ],
      temperature: 0.8,
    }),
  });

  const data: any = await response.json();

  if (!response.ok) {
    console.error(`OpenRouter generate error (Version ${version}):`, response.status, JSON.stringify(data));
    throw new Error(`AI generation failed (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`AI returned empty content for Version ${version}`);

  return content;
}

function parseJSON(text: string): Record<string, unknown> {
  // Strip markdown fences if present
  const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse AI JSON response:', cleaned.substring(0, 200));
    throw new Error('AI returned invalid JSON — please try again');
  }
}
