// Site Generator — turns interview transcript into complete, beautiful HTML websites
// Uses OpenRouter to create two distinct, production-quality single-page sites

import { query, queryOne, execute } from '../db';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID!;

// ────────────────────────────────────────────────────────────
// The master prompt that produces real, beautiful websites
// ────────────────────────────────────────────────────────────
const SITE_GENERATION_PROMPT = `You are an elite web designer who builds stunning, modern single-page websites.
Given a business interview transcript, you will produce a COMPLETE, self-contained HTML file with embedded CSS.

DESIGN REQUIREMENTS — THE SITE MUST LOOK PREMIUM:

1. DARK THEME — deep navy/charcoal background (#080E1F or #0a0a12 range), with a vibrant accent color
2. TYPOGRAPHY — Use Google Fonts. Pair a serif display font (like 'DM Serif Display', 'Playfair Display', or 'Fraunces') for headlines with a clean sans-serif ('Outfit', 'Inter', or 'Plus Jakarta Sans') for body text. Use clamp() for fluid sizing.
3. HERO SECTION — Full viewport height. Compelling headline with the accent color on key words. Subheadline. Two CTA buttons (one solid with accent color, one outline). Optional badge/ribbon.
4. NAVIGATION — Fixed top nav with logo text (serif font), horizontal links, and a colored CTA button. Add backdrop-filter blur on scroll (via JS).
5. STATS BAR — 3-4 impressive numbers/stats in a horizontal row below the hero.
6. SERVICES/FEATURES — Cards with subtle borders, hover lift effects, and icons (use unicode or simple SVG icons).
7. ABOUT/STORY — Warm, personal section with the business owner's story.
8. TESTIMONIALS — Quote cards with attribution (create realistic example testimonials).
9. CTA SECTION — Final call-to-action before footer.
10. FOOTER — Business name, description, contact info, copyright.

VISUAL POLISH:
- Radial gradient backgrounds (subtle glowing orbs behind sections)
- Cards with glass-morphism (rgba backgrounds, subtle borders, backdrop blur)
- Smooth hover animations (translateY, box-shadow changes)
- Sections separated by subtle gradients, not hard lines
- Scroll-triggered fade-in animations using IntersectionObserver
- At least one decorative element (gradient circle, floating shape)
- Stats numbers should use gradient text (background-clip: text)

CSS REQUIREMENTS:
- All CSS must be in a <style> tag in the <head>
- Use CSS custom properties (variables) for colors
- Mobile responsive (single column below 768px)
- Smooth scrolling (scroll-behavior: smooth)
- Clean spacing: sections should have 5-7rem vertical padding
- Max content width: 1200px, centered

JAVASCRIPT:
- Minimal JS at bottom of body:
  - Scroll-triggered nav background change
  - IntersectionObserver for fade-in animations
  - Smooth scroll for anchor links

CONTENT RULES:
- Use ONLY information from the interview transcript for business facts
- Write compelling, professional marketing copy — don't just restate what they said
- Headlines should be attention-grabbing and specific to this business
- If the transcript mentions pricing, include it. If not, use CTAs instead.
- Testimonials should feel real but be clearly example content

OUTPUT RULES:
- Return ONLY the complete HTML file, starting with <!DOCTYPE html>
- No markdown fences, no explanation, no commentary
- The HTML must be valid and self-contained
- Include Google Fonts via <link> in the <head>
- The page must look incredible — this is what the customer sees first`;


// ────────────────────────────────────────────────────────────
// Generate two site options from a project transcript
// ────────────────────────────────────────────────────────────
export async function generateSiteOptions(projectId: string): Promise<{
  siteA: string;
  siteB: string;
}> {
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

  // Two different design directions
  const designA = {
    label: 'Option A — Bold & Dynamic',
    colors: 'Use a bold accent color like electric blue (#4A7BF7) or vibrant purple (#7c3aed). The design should feel energetic, modern, and tech-forward. Use sharp geometric shapes and strong contrast.',
    fonts: "Use 'Outfit' for body and 'DM Serif Display' for headlines.",
  };

  const designB = {
    label: 'Option B — Warm & Premium',
    colors: 'Use a warm accent color like gold (#F0C75E), coral (#FF7170), or warm amber (#f59e0b). The design should feel trustworthy, premium, and established. Use rounded shapes and warm tones.',
    fonts: "Use 'Plus Jakarta Sans' for body and 'Playfair Display' for headlines.",
  };

  // Generate both in parallel
  const [htmlA, htmlB] = await Promise.all([
    callGenerateAI(project.transcript, project.business_name, designA),
    callGenerateAI(project.transcript, project.business_name, designB),
  ]);

  // Also generate content schemas from the HTML for the editing system
  const schemaA = extractBasicSchema(htmlA, project.business_name);
  const schemaB = extractBasicSchema(htmlB, project.business_name);

  // Insert both as generated_sites (template_code stores the full HTML)
  const siteAResult = await queryOne<{ id: string }>(
    `INSERT INTO generated_sites (project_id, version_label, content_schema, template_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [projectId, designA.label, JSON.stringify(schemaA), htmlA]
  );

  const siteBResult = await queryOne<{ id: string }>(
    `INSERT INTO generated_sites (project_id, version_label, content_schema, template_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [projectId, designB.label, JSON.stringify(schemaB), htmlB]
  );

  if (!siteAResult || !siteBResult) throw new Error('Failed to save generated sites');

  // Update project status to 'choosing'
  await execute(
    `UPDATE projects SET status = 'choosing' WHERE id = $1`,
    [projectId]
  );

  console.log(`✓ Generated 2 HTML sites for ${project.business_name}: ${siteAResult.id}, ${siteBResult.id}`);

  return {
    siteA: siteAResult.id,
    siteB: siteBResult.id,
  };
}


// ────────────────────────────────────────────────────────────
// Get generated sites for a project
// ────────────────────────────────────────────────────────────
export async function getProjectSites(projectId: string) {
  const sites = await query<{
    id: string;
    version_label: string;
    content_schema: Record<string, unknown>;
    template_code: string | null;
    is_selected: boolean;
  }>(
    `SELECT id, version_label, content_schema, template_code, is_selected
     FROM generated_sites WHERE project_id = $1 ORDER BY created_at`,
    [projectId]
  );

  return sites;
}


// ────────────────────────────────────────────────────────────
// Get a single site's HTML for iframe rendering
// ────────────────────────────────────────────────────────────
export async function getSiteHTML(siteId: string): Promise<string | null> {
  const site = await queryOne<{ template_code: string | null }>(
    `SELECT template_code FROM generated_sites WHERE id = $1`,
    [siteId]
  );
  return site?.template_code || null;
}


// ────────────────────────────────────────────────────────────
// Select a site option
// ────────────────────────────────────────────────────────────
export async function selectSiteOption(projectId: string, siteId: string) {
  await execute(
    `UPDATE generated_sites SET is_selected = FALSE WHERE project_id = $1`,
    [projectId]
  );

  await execute(
    `UPDATE generated_sites SET is_selected = TRUE WHERE id = $1 AND project_id = $2`,
    [siteId, projectId]
  );

  await execute(
    `UPDATE projects SET status = 'editing' WHERE id = $1`,
    [projectId]
  );

  const project = await queryOne<{ slug: string }>(
    `SELECT slug FROM projects WHERE id = $1`,
    [projectId]
  );

  return { success: true, slug: project?.slug };
}


// ────────────────────────────────────────────────────────────
// Call OpenRouter to generate a full HTML website
// ────────────────────────────────────────────────────────────
async function callGenerateAI(
  transcript: string,
  businessName: string,
  design: { label: string; colors: string; fonts: string }
): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error('AI service not configured — missing OPENROUTER_API_KEY');
  if (!OPENROUTER_MODEL_ID) throw new Error('AI service not configured — missing OPENROUTER_MODEL_ID');

  const userPrompt = `BUSINESS NAME: ${businessName}

DESIGN DIRECTION: ${design.label}
COLOR PALETTE: ${design.colors}
TYPOGRAPHY: ${design.fonts}

INTERVIEW TRANSCRIPT:
${transcript}

Generate a complete, stunning single-page HTML website for this business. The site must look like it was designed by a top agency. Remember: output ONLY the HTML file, starting with <!DOCTYPE html>.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_ID,
      messages: [
        { role: 'system', content: SITE_GENERATION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 16000,
    }),
  });

  const data: any = await response.json();

  if (!response.ok) {
    console.error(`OpenRouter generate error (${design.label}):`, response.status, JSON.stringify(data).substring(0, 500));
    throw new Error(`AI generation failed (${response.status}): ${data.error?.message || 'Unknown error'}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`AI returned empty content for ${design.label}`);

  // Clean up — strip markdown fences if the AI wrapped it
  let html = content.trim();
  if (html.startsWith('```')) {
    html = html.replace(/^```html?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Validate it starts with <!DOCTYPE or <html
  if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
    // Try to find the HTML start
    const docIndex = html.toLowerCase().indexOf('<!doctype');
    const htmlIndex = html.toLowerCase().indexOf('<html');
    const startIndex = docIndex >= 0 ? docIndex : htmlIndex;
    if (startIndex > 0) {
      html = html.substring(startIndex);
    } else {
      console.error('Generated content does not appear to be HTML:', html.substring(0, 200));
      throw new Error('AI did not return valid HTML — please try again');
    }
  }

  return html;
}


// ────────────────────────────────────────────────────────────
// Extract a basic content schema from the generated HTML
// (for the editing system — not the primary display)
// ────────────────────────────────────────────────────────────
function extractBasicSchema(html: string, businessName: string): Record<string, unknown> {
  // Simple extraction — we can enhance this later
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return {
    meta: {
      title: titleMatch?.[1] || businessName,
      business_name: businessName,
    },
    _source: 'html_generated',
    _note: 'Full site is in template_code column',
  };
}
