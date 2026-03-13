/**
 * Netlify serverless function — Runway ML API proxy
 * Keeps the Runway API key off the client.
 * Client passes its own key via X-Runway-Key header (stored in localStorage).
 * Falls back to RUNWAY_API_KEY env var if no client key supplied.
 *
 * Actions:
 *   generate-video  POST  { promptText, promptImage, duration? }
 *   task-status     GET   ?taskId=
 */

const RUNWAY_BASE = 'https://api.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Runway-Key',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const clientKey = event.headers['x-runway-key'] || event.headers['X-Runway-Key'];
  const API_KEY = clientKey || process.env.RUNWAY_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Runway ML API key not configured. Add your key in Settings → AI Video.' }),
    };
  }

  const qs = event.queryStringParameters || {};
  const action = qs.action;
  const authHeader = {
    Authorization: `Bearer ${API_KEY}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': 'application/json',
  };

  try {
    // ── Generate video from image + text prompt ──────────────────────────
    if (action === 'generate-video' && event.httpMethod === 'POST') {
      const { promptText, promptImage, duration = 5 } = JSON.parse(event.body || '{}');
      if (!promptImage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'promptImage is required (base64 data URL or HTTPS URL)' }) };
      }

      const body = {
        model: 'gen3a_turbo',
        promptImage,
        promptText: promptText || 'cinematic, smooth motion, professional quality, marketing video',
        duration,
        ratio: '768:1280',
        watermark: false,
      };

      const res = await fetch(`${RUNWAY_BASE}/image_to_video`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data?.message || data?.error || `Runway API HTTP ${res.status}`;
        return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ taskId: data.id }) };
    }

    // ── Poll task status ─────────────────────────────────────────────────
    if (action === 'task-status' && event.httpMethod === 'GET') {
      const { taskId } = qs;
      if (!taskId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'taskId required' }) };

      const res = await fetch(`${RUNWAY_BASE}/tasks/${encodeURIComponent(taskId)}`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
