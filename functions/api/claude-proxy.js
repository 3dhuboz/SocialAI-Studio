/**
 * Cloudflare Pages Function — Anthropic Claude proxy
 * Available at: /api/claude-proxy
 */

const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Claude-Key',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });

  const apiKey =
    env.ANTHROPIC_API_KEY ||
    request.headers.get('x-claude-key') ||
    request.headers.get('X-Claude-Key') ||
    '';

  if (!apiKey) return json({ error: 'No Claude API key configured. Add one in Settings.' }, 401);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  const authHeaders = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  try {
    if (action === 'generate' && request.method === 'POST') {
      const { prompt, systemPrompt, responseFormat, temperature = 0.8, maxTokens = 1024 } = await request.json();
      if (!prompt) return json({ error: 'prompt is required' }, 400);

      const body = {
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
        ...(systemPrompt ? { system: systemPrompt } : {}),
      };

      const res = await fetch(`${CLAUDE_BASE}/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok) {
        return json({ error: data?.error?.message || data?.message || `Claude HTTP ${res.status}` }, res.status);
      }

      return json({ text: data?.content?.[0]?.text || '' });
    }

    if (action === 'health') {
      return json({
        ok: true,
        hasKey: !!apiKey,
        keySource: env.ANTHROPIC_API_KEY ? 'env' : (request.headers.get('x-claude-key') ? 'header' : 'none'),
        keyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'N/A',
        model: DEFAULT_MODEL,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
