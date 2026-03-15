/**
 * Netlify serverless function — Anthropic Claude proxy
 * API key is passed via X-Claude-Key header (set from localStorage by the client).
 * Falls back to ANTHROPIC_API_KEY env var if no header provided.
 *
 * Supported actions (passed as ?action= query param):
 *   generate   POST  { prompt, systemPrompt?, responseFormat?, temperature?, maxTokens? }
 */

const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Claude-Key',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    event.headers?.['x-claude-key'] ||
    event.headers?.['X-Claude-Key'] ||
    '';

  if (!apiKey) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'No Claude API key configured. Add one in Settings.' }),
    };
  }

  const qs = event.queryStringParameters || {};
  const action = qs.action;

  const authHeaders = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  try {
    // ── Generate text ────────────────────────────────────────────────────
    if (action === 'generate' && event.httpMethod === 'POST') {
      const {
        prompt,
        systemPrompt,
        responseFormat,
        temperature = 0.8,
        maxTokens = 1024,
      } = JSON.parse(event.body || '{}');

      if (!prompt) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt is required' }) };
      }

      const messages = [{ role: 'user', content: prompt }];
      const body = {
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages,
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
        const errMsg =
          data?.error?.message || data?.message || `Claude HTTP ${res.status}`;
        return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg }) };
      }

      const text = data?.content?.[0]?.text || '';
      return { statusCode: 200, headers, body: JSON.stringify({ text }) };
    }

    // ── Health check ──────────────────────────────────────────────────
    if (action === 'health') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          hasKey: !!apiKey,
          keySource: process.env.ANTHROPIC_API_KEY ? 'env' : (event.headers?.['x-claude-key'] ? 'header' : 'none'),
          keyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'N/A',
          model: DEFAULT_MODEL,
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
