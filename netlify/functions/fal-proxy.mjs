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

      return { statusCode: 200, headers, body: JSON.stringify({
        requestId: data.request_id,
        statusUrl: data.status_url || null,
        responseUrl: data.response_url || null,
      }) };
    }

    // ── Poll task status ──────────────────────────────────────────────────
    if (action === 'task-status' && event.httpMethod === 'GET') {
      const { requestId, statusUrl, responseUrl } = qs;
      if (!requestId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'requestId required' }) };

      // Prefer the status_url returned by fal.ai at submit time (avoids URL construction issues)
      const pollUrl = statusUrl
        ? statusUrl
        : `${FAL_BASE}/${MODEL}/requests/${requestId}/status`;

      let statusRes = await fetch(pollUrl, { headers: authHeader });
      // Fallback: model-free status endpoint
      if (!statusRes.ok && (statusRes.status === 405 || statusRes.status === 404)) {
        statusRes = await fetch(`${FAL_BASE}/requests/${requestId}/status`, { headers: authHeader });
      }

      let statusData;
      try { statusData = await statusRes.json(); } catch { statusData = {}; }

      // Surface HTTP errors (e.g. 401, 422) immediately
      if (!statusRes.ok) {
        const errMsg = statusData?.detail || statusData?.message || statusData?.error || `fal.ai status HTTP ${statusRes.status}`;
        return { statusCode: 200, headers, body: JSON.stringify({ status: 'FAILED', failure: errMsg }) };
      }

      // If COMPLETED, extract video URL — check inline first, then fetch result URL
      if (statusData.status === 'COMPLETED') {
        const extractUrl = (obj) =>
          obj?.video?.url ||
          obj?.videos?.[0]?.url ||
          obj?.data?.video?.url ||
          obj?.output?.video?.url ||
          obj?.output?.[0]?.url ||
          obj?.output?.url;

        // Result may be embedded directly in status response
        let videoUrl = extractUrl(statusData);

        if (!videoUrl) {
          // Use responseUrl if provided, otherwise construct
          const resultEndpoint = responseUrl
            ? responseUrl
            : `${FAL_BASE}/${MODEL}/requests/${requestId}`;
          let resultRes = await fetch(resultEndpoint, { headers: authHeader });
          if (!resultRes.ok) {
            resultRes = await fetch(`${FAL_BASE}/requests/${requestId}`, { headers: authHeader });
          }
          const result = await resultRes.json();
          videoUrl = extractUrl(result);
        }

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
          body: JSON.stringify({ status: 'FAILED', failure: statusData.error || statusData.detail || 'Generation failed' }),
        };
      }

      // IN_QUEUE or IN_PROGRESS — pass raw status so client can track time-based progress
      const qPos = typeof statusData.queue_position === 'number' ? statusData.queue_position : null;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: statusData.status || 'IN_PROGRESS', queuePosition: qPos }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
