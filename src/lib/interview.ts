// Interview Engine — AI-driven text-based business discovery
// Uses OpenRouter (same as content.ts) to conduct a conversational interview

import { query, queryOne, execute } from '../db';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID!;

export interface InterviewMessage {
  role: 'assistant' | 'user';
  content: string;
}

const INTERVIEW_SYSTEM_PROMPT = `You are a friendly, professional business consultant conducting a discovery interview to build a website for a new client. Your job is to learn everything needed to create a compelling website.

TOPICS TO COVER (ask about each, one at a time):
1. Business name and what they do
2. How long they've been in business / their origin story
3. Who their ideal customer is (target audience)
4. What makes them different from competitors (differentiators)
5. Their key services or products (with pricing if available)
6. Their credentials, experience, or trust signals (years in business, certifications, testimonials)
7. Their business goals for the website (generate leads, sell products, build credibility, etc.)
8. Contact information (email, phone, location)
9. Any specific messaging, tagline, or tone they want
10. Anything else they want visitors to know

RULES:
- Ask ONE question at a time
- Be conversational and warm — not robotic
- Follow up on interesting answers before moving to the next topic
- If they give short answers, gently probe for more detail
- Keep your responses concise (2-3 sentences max)
- When you've covered all topics sufficiently, respond with EXACTLY this JSON on its own line at the end of your message:
  {"interview_complete": true}
- Do NOT include that JSON until you've thoroughly covered all topics
- Start by greeting them and asking about their business`;

// Start a new interview — creates project, returns first AI message
export async function startInterview(customerId: string): Promise<{
  projectId: string;
  message: string;
}> {
  // Create a project in 'interview' status
  const slug = 'interview-' + Date.now();
  const result = await queryOne<{ id: string }>(
    `INSERT INTO projects (customer_id, business_name, slug, status, interview_messages)
     VALUES ($1, 'TBD', $2, 'interview', '[]'::jsonb)
     RETURNING id`,
    [customerId, slug]
  );

  if (!result) throw new Error('Failed to create project');
  const projectId = result.id;

  // Get the first AI message (greeting + first question)
  const aiResponse = await callAI([]);

  // Save the first message
  const messages: InterviewMessage[] = [
    { role: 'assistant', content: aiResponse }
  ];

  await execute(
    `UPDATE projects SET interview_messages = $1 WHERE id = $2`,
    [JSON.stringify(messages), projectId]
  );

  return { projectId, message: aiResponse };
}

// Handle a user message — returns AI's next response
export async function handleMessage(projectId: string, userMessage: string): Promise<{
  message: string;
  complete: boolean;
}> {
  // Get current conversation
  const project = await queryOne<{
    interview_messages: InterviewMessage[];
    status: string;
  }>(
    `SELECT interview_messages, status FROM projects WHERE id = $1`,
    [projectId]
  );

  if (!project) throw new Error('Project not found');
  if (project.status !== 'interview') throw new Error('Interview already completed');

  const messages: InterviewMessage[] = project.interview_messages || [];

  // Add user message
  messages.push({ role: 'user', content: userMessage });

  // Get AI response
  const aiResponse = await callAI(messages);

  // Check if interview is complete
  const complete = aiResponse.includes('"interview_complete": true') ||
                   aiResponse.includes('"interview_complete":true');

  // Clean the completion marker from the displayed message
  const cleanMessage = aiResponse
    .replace(/\{[\s]*"interview_complete"[\s]*:[\s]*true[\s]*\}/g, '')
    .trim();

  // Add AI response
  messages.push({ role: 'assistant', content: cleanMessage });

  // Save conversation
  await execute(
    `UPDATE projects SET interview_messages = $1 WHERE id = $2`,
    [JSON.stringify(messages), projectId]
  );

  // If complete, compile transcript and update status
  if (complete) {
    const transcript = messages
      .map(m => `${m.role === 'assistant' ? 'Interviewer' : 'Client'}: ${m.content}`)
      .join('\n\n');

    await execute(
      `UPDATE projects SET transcript = $1, status = 'processing' WHERE id = $2`,
      [transcript, projectId]
    );
  }

  return { message: cleanMessage, complete };
}

// Get current interview state (for resuming)
export async function getInterview(projectId: string): Promise<{
  messages: InterviewMessage[];
  status: string;
}> {
  const project = await queryOne<{
    interview_messages: InterviewMessage[];
    status: string;
  }>(
    `SELECT interview_messages, status FROM projects WHERE id = $1`,
    [projectId]
  );

  if (!project) throw new Error('Project not found');

  return {
    messages: project.interview_messages || [],
    status: project.status,
  };
}

// Call OpenRouter AI
async function callAI(messages: InterviewMessage[]): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set!');
    throw new Error('AI service not configured — missing OPENROUTER_API_KEY');
  }
  if (!OPENROUTER_MODEL_ID) {
    console.error('OPENROUTER_MODEL_ID is not set!');
    throw new Error('AI service not configured — missing OPENROUTER_MODEL_ID');
  }

  const apiMessages = [
    { role: 'system', content: INTERVIEW_SYSTEM_PROMPT },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  console.log(`Calling OpenRouter: model=${OPENROUTER_MODEL_ID}, messages=${apiMessages.length}`);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_ID,
      messages: apiMessages,
      temperature: 0.7,
    }),
  });

  const data: any = await response.json();

  if (!response.ok) {
    console.error('OpenRouter error:', response.status, JSON.stringify(data));
    throw new Error(`AI request failed (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.error('OpenRouter returned empty content:', JSON.stringify(data));
    throw new Error('AI returned an empty response');
  }

  return content;
}
