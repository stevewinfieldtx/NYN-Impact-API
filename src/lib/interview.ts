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

// Skip interview — generate fake data for testing, jump straight to 'processing'
export async function skipInterview(customerId: string, industry: string): Promise<{ projectId: string }> {
  const fakeBusinesses: Record<string, { name: string; owner: string; story: string; audience: string; differentiators: string[]; services: string[]; tagline: string; email: string; phone: string }> = {
    golf: {
      name: 'Lone Star Golf Academy',
      owner: 'Mike Richardson',
      story: "I've been teaching golf for 25 years in the DFW area. Started on the range at a municipal course and worked my way up. I believe every golfer can break 80 if they understand the fundamentals.",
      audience: 'Weekend golfers aged 35-65 who want to improve their game without gimmicks',
      differentiators: ['Video analysis included with every lesson', 'On-course playing lessons, not just range work', '25 years of teaching experience'],
      services: ['Private lessons ($125/hr)', 'Group clinics ($45/person)', 'Junior golf camps ($299/week)', 'Online video review ($49/month)'],
      tagline: 'Real instruction. Real improvement.',
      email: 'mike@lonestargolfacademy.com',
      phone: '(817) 555-0147',
    },
    plumbing: {
      name: 'FlowRight Plumbing Co.',
      owner: 'Carlos Mendez',
      story: "Third-generation plumber. My grandfather started the business in 1978. We've always believed in fixing it right the first time, no shortcuts. We serve the entire Dallas-Fort Worth metroplex.",
      audience: 'Homeowners and small businesses needing reliable, honest plumbing service',
      differentiators: ['Same-day emergency service', 'Upfront pricing with no surprises', 'Licensed and insured since 1978'],
      services: ['Emergency repairs', 'Water heater installation', 'Drain cleaning', 'Bathroom & kitchen remodels', 'Commercial plumbing'],
      tagline: 'Three generations of doing it right.',
      email: 'carlos@flowrightplumbing.com',
      phone: '(214) 555-0382',
    },
    restaurant: {
      name: 'Salt & Smoke BBQ',
      owner: 'Dwayne Peters',
      story: "I quit my corporate job at 42 to chase my dream. Been smoking brisket since I was 16 — learned from my uncle in East Texas. We opened our first location in 2019 and survived COVID by pivoting to catering.",
      audience: 'BBQ lovers, families, and corporate catering clients in the Arlington area',
      differentiators: ['All wood-fired, no gas assist', 'Homemade sides from family recipes', 'Full catering service for events'],
      services: ['Dine-in', 'Takeout', 'Catering (50-500 people)', 'Meat by the pound', 'Weekly specials'],
      tagline: 'Low. Slow. Worth the wait.',
      email: 'dwayne@saltandsmoke.com',
      phone: '(817) 555-0291',
    },
    fitness: {
      name: 'IronWill Training Studio',
      owner: 'Jessica Torres',
      story: "After losing 80 pounds myself, I became a certified trainer to help others transform their lives. I opened IronWill because I wanted a gym that felt welcoming, not intimidating.",
      audience: 'Adults 30-55 who are starting or restarting their fitness journey',
      differentiators: ['Personalized programming for every member', 'Small group classes (max 8 people)', 'Nutrition coaching included'],
      services: ['Personal training ($85/session)', 'Small group classes ($149/month)', 'Nutrition coaching ($99/month)', '12-week transformation program ($997)'],
      tagline: 'Your comeback starts here.',
      email: 'jessica@ironwillstudio.com',
      phone: '(972) 555-0418',
    },
    realestate: {
      name: 'Keystone Realty Group',
      owner: 'Patricia Wallace',
      story: "20 years selling homes in North Texas. I've helped over 500 families find their perfect home. I treat every client like family because buying a home is the biggest decision most people ever make.",
      audience: 'First-time homebuyers and families relocating to the DFW area',
      differentiators: ['Hyper-local market expertise', 'Full relocation assistance', 'Available 7 days a week'],
      services: ['Buyer representation', 'Seller listing services', 'Relocation packages', 'Investment property consulting', 'Free home valuations'],
      tagline: 'Finding your key to home.',
      email: 'patricia@keystonerealtygroup.com',
      phone: '(469) 555-0563',
    },
  };

  // Pick matching industry or use a generic one
  const key = industry.toLowerCase().replace(/\s+/g, '');
  const biz = fakeBusinesses[key] || fakeBusinesses[Object.keys(fakeBusinesses).find(k => key.includes(k)) || 'golf']!;

  const fakeTranscript = `Interviewer: Hi there! Tell me about your business.
Client: My business is called ${biz.name}. ${biz.story}

Interviewer: Who is your ideal customer?
Client: ${biz.audience}

Interviewer: What makes you different from competitors?
Client: ${biz.differentiators.join('. ')}

Interviewer: What services do you offer?
Client: ${biz.services.join(', ')}

Interviewer: Do you have a tagline or message you want on the site?
Client: ${biz.tagline}

Interviewer: What's the best way for customers to reach you?
Client: Email me at ${biz.email} or call ${biz.phone}.

Interviewer: What's your main goal for the website?
Client: I want to generate leads and build credibility. People should land on my site and immediately trust that I know what I'm doing.`;

  const slug = 'test-' + Date.now();
  const result = await queryOne<{ id: string }>(
    `INSERT INTO projects (customer_id, business_name, slug, status, transcript, interview_messages)
     VALUES ($1, $2, $3, 'processing', $4, '[]'::jsonb)
     RETURNING id`,
    [customerId, biz.name, slug, fakeTranscript]
  );

  if (!result) throw new Error('Failed to create test project');

  console.log(`✓ Test project created: ${result.id} (${biz.name}, industry: ${industry})`);
  return { projectId: result.id };
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
