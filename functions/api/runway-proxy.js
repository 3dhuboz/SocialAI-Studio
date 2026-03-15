/**
 * Cloudflare Pages Function — Runway ML API proxy
 * Available at: /api/runway-proxy
 */

const RUNWAY_BASE = 'https://api.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Runway-Key',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });

  const clientKey = request.headers.get('x-runway-key') || request.headers.get('X-Runway-Key');
  const API_KEY = clientKey || env.RUNWAY_API_KEY;

  if (!API_KEY) return json({ error: 'Runway ML API key not configured. Add your key in Settings → AI Video.' }, 500);

  const authHeader = {
    Authorization: `Bearer ${API_KEY}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': 'application/json',
  };

  const url = new URL(request.url);
  const qs = url.searchParams;
  const action = qs.get('action');

  try {
    if (action === 'generate-video' && request.method === 'POST') {
      const { promptText, promptImage, duration = 5 } = await request.json();
      if (!promptImage) return json({ error: 'promptImage is required (base64 data URL or HTTPS URL)' }, 400);

      const body = {
        model: 'gen3a_turbo',
        promptImage,
        promptText: promptText || 'cinematic, smooth motion, professional quality, marketing video',
        duration,
        ratio: '768:1280',
        watermark: false,
      };

      const res = await fetch(`${RUNWAY_BASE}/image_to_video`, { method: 'POST', headers: authHeader, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) return json({ error: data?.message || data?.error || `Runway API HTTP ${res.status}` }, res.status);
      return json({ taskId: data.id });
    }

    if (action === 'task-status' && request.method === 'GET') {
      const taskId = qs.get('taskId');
      if (!taskId) return json({ error: 'taskId required' }, 400);
      const res = await fetch(`${RUNWAY_BASE}/tasks/${encodeURIComponent(taskId)}`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
