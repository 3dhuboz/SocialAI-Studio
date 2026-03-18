/**
 * Cloudflare Pages Function — AI text generation via OpenRouter
 * Available at: /api/ai/generate
 * Body: { prompt, systemPrompt?, temperature?, maxTokens?, responseFormat? }
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-001';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({ error: 'OpenRouter API key not configured.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const {
    prompt,
    systemPrompt,
    temperature = 0.8,
    maxTokens = 2048,
    responseFormat = 'text',
  } = body;

  if (!prompt) {
    return json({ error: 'prompt is required.' }, 400);
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const orBody = {
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
  };

  try {
    const res = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://socialaistudio.au',
        'X-Title': 'SocialAI Studio',
      },
      body: JSON.stringify(orBody),
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok) {
      const errMsg = data?.error?.message || data?.message || `OpenRouter HTTP ${res.status}`;
      return json({ error: errMsg }, res.status);
    }

    if (data?.error) {
      return json({ error: data.error.message || 'OpenRouter returned an error.' }, 500);
    }

    const text = data?.choices?.[0]?.message?.content || '';
    return json({ text });
  } catch (err) {
    return json({ error: err.message || 'AI generation failed.' }, 500);
  }
}
