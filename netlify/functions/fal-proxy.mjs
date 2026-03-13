/**
 * Netlify serverless function — fal.ai video generation proxy
 * Passes X-Fal-Key header from client (stored in localStorage).
 * Falls back to FAL_API_KEY env var if no client key supplied.
 *
 * Actions:
 *   generate-video  POST  { promptText, promptImage, duration? }
 *   task-status     GET   ?requestId=
 */

const FAL_BASE = 'https://queue.fal.run';
const MODEL = 'fal-ai/kling-video/v1.6/standard/image-to-video';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Fal-Key',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const clientKey = event.headers['x-fal-key'] || event.headers['X-Fal-Key'];
  const API_KEY = clientKey || process.env.FAL_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'fal.ai API key not configured. Add your key in Settings → AI Video.' }),
    };
  }

  const authHeader = {
    Authorization: `Key ${API_KEY}`,
    'Content-Type': 'application/json',
  };

  const qs = event.queryStringParameters || {};
  const action = qs.action;

  try {
    // ── Submit video generation job ──────────────────────────────────────
    if (action === 'generate-video' && event.httpMethod === 'POST') {
      const { promptText, promptImage, duration = 5 } = JSON.parse(event.body || '{}');
      if (!promptImage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'promptImage is required' }) };
      }

      const body = {
        prompt: promptText || 'cinematic, smooth motion, professional quality, marketing video',
        image_url: promptImage,
        duration: String(duration),
        aspect_ratio: '9:16',
      };

      const res = await fetch(`${FAL_BASE}/${MODEL}`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(body),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok) {
        const errMsg = data?.detail || data?.message || data?.error || `fal.ai HTTP ${res.status}`;
        return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ requestId: data.request_id }) };
    }

    // ── Poll task status ──────────────────────────────────────────────────
    if (action === 'task-status' && event.httpMethod === 'GET') {
      const { requestId } = qs;
      if (!requestId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'requestId required' }) };

      const statusRes = await fetch(
        `${FAL_BASE}/${MODEL}/requests/${encodeURIComponent(requestId)}/status`,
        { headers: authHeader },
      );
      const statusData = await statusRes.json();

      // If COMPLETED, fetch the actual result
      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(
          `${FAL_BASE}/${MODEL}/requests/${encodeURIComponent(requestId)}`,
          { headers: authHeader },
        );
        const result = await resultRes.json();
        const videoUrl = result?.video?.url || result?.videos?.[0]?.url;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: 'SUCCEEDED', output: videoUrl ? [videoUrl] : [] }),
        };
      }

      if (statusData.status === 'FAILED') {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: 'FAILED', failure: statusData.error || 'Generation failed' }),
        };
      }

      // IN_QUEUE or IN_PROGRESS
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'IN_PROGRESS', progress: statusData.queue_position ? 0.1 : 0.5 }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
