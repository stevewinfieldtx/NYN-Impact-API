// Content Manager — AI Self-Edit core
// Handles content schema CRUD and AI intent parsing via raw Postgres

import { query, queryOne, execute } from '../db';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID || 'anthropic/claude-sonnet-4-20250514';

// ── Read content ──

export async function getSiteContent(siteId: string) {
  const site = await queryOne<{
    content_schema: Record<string, unknown>;
    template_code: string;
    vercel_url: string | null;
    version_label: string;
  }>(
    'SELECT content_schema, template_code, vercel_url, version_label FROM generated_sites WHERE id = $1',
    [siteId]
  );
  if (!site) throw new Error('Site not found');
  return site;
}

// ── Update content field ──

export async function updateContentField(
  siteId: string,
  fieldPath: string,
  newValue: string,
  aiPrompt: string
) {
  // Get current content
  const site = await queryOne<{ content_schema: Record<string, unknown> }>(
    'SELECT content_schema FROM generated_sites WHERE id = $1',
    [siteId]
  );

  if (!site) throw new Error('Site not found');

  const schema = site.content_schema;
  const oldValue = getNestedValue(schema, fieldPath);

  // Update the value in the schema
  setNestedValue(schema, fieldPath, newValue);

  // Save updated schema
  await execute(
    'UPDATE generated_sites SET content_schema = $1 WHERE id = $2',
    [JSON.stringify(schema), siteId]
  );

  // Get current edit count
  const countResult = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM edit_history WHERE site_id = $1',
    [siteId]
  );
  const editNumber = parseInt(countResult?.count || '0') + 1;

  // Log the edit
  await execute(
    `INSERT INTO edit_history (site_id, field_path, old_value, new_value, ai_prompt, edit_number)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [siteId, fieldPath, JSON.stringify(oldValue), JSON.stringify(newValue), aiPrompt, editNumber]
  );

  return { success: true, fieldPath, oldValue, newValue };
}

// ── AI Intent Parser ──

export async function parseEditIntent(
  userMessage: string,
  contentSchema: Record<string, unknown>
) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_ID,
      messages: [
        {
          role: 'system',
          content: `You are a website content editing assistant. The user wants to edit their website.
Here is their current content schema:
${JSON.stringify(contentSchema, null, 2)}

When the user asks to make a change, respond with a JSON object:
{
  "action": "update" | "add_list_item" | "remove_list_item" | "get_value" | "clarify",
  "field_path": "the.dotted.path.to.the.field",
  "new_value": "the new value (for update/add)",
  "item_index": 0 (for remove_list_item),
  "message": "A friendly confirmation message to show the user",
  "clarification": "If action is clarify, what you need to know"
}

Rules:
- Match the user's intent to the closest field in the schema
- For text changes, use action "update" with the field_path and new_value
- For adding items to lists, use action "add_list_item"
- If unsure what field they mean, use action "clarify"
- Always include a friendly message confirming what you're about to do
- Respond ONLY with valid JSON, no markdown`
        },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  try {
    return JSON.parse(text.replace(/```json?\s*/g, '').replace(/```/g, '').trim());
  } catch {
    return {
      action: 'clarify',
      message: "I'm not sure what you'd like to change. Could you be more specific?",
      clarification: text,
    };
  }
}

// ── Helpers ──

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
