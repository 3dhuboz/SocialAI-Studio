/**
 * Cloudflare Pages Function — fal.ai video/image generation proxy
 * Available at: /api/fal-proxy
 */

const FAL_BASE = 'https://queue.fal.run';
const MODEL = 'fal-ai/kling-video/v1.6/standard/image-to-video';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Fal-Key',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });

  const clientKey = request.headers.get('x-fal-key') || request.headers.get('X-Fal-Key');
  const API_KEY = clientKey || env.FAL_API_KEY;

  if (!API_KEY) return json({ error: 'fal.ai API key not configured. Add your key in Settings → AI Video.' }, 500);

  const authHeader = { Authorization: `Key ${API_KEY}`, 'Content-Type': 'application/json' };
  const url = new URL(request.url);
  const qs = url.searchParams;
  const action = qs.get('action');

  try {
    if (action === 'get-credits' && request.method === 'GET') {
      const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${API_KEY}` } });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) return json({ error: data?.message || `HTTP ${res.status}` }, res.status);
      return json({ balance: data?.balance ?? data?.credits ?? data?.account?.balance ?? null });
    }

    if (action === 'generate-image' && request.method === 'POST') {
      const { prompt } = await request.json();
      if (!prompt) return json({ error: 'prompt is required' }, 400);

      // FLUX Dev: higher quality, more realistic than Schnell (25 steps vs 4)
      const res = await fetch('https://fal.run/fal-ai/flux/dev', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ prompt, image_size: 'square_hd', num_inference_steps: 25, num_images: 1, enable_safety_checker: true, guidance_scale: 3.5 }),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) return json({ error: data?.detail || data?.message || data?.error || `fal.ai HTTP ${res.status}` }, res.status);
      return json({ imageUrl: data?.images?.[0]?.url || null });
    }

    if (action === 'generate-video' && request.method === 'POST') {
      const { promptText, promptImage, duration = 5 } = await request.json();
      if (!promptImage) return json({ error: 'promptImage is required' }, 400);

      const body = {
        prompt: promptText || 'cinematic, smooth motion, professional quality, marketing video',
        image_url: promptImage,
        duration: String(duration),
        aspect_ratio: '9:16',
      };

      const res = await fetch(`${FAL_BASE}/${MODEL}`, { method: 'POST', headers: authHeader, body: JSON.stringify(body) });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) return json({ error: data?.detail || data?.message || data?.error || `fal.ai HTTP ${res.status}` }, res.status);

      return json({ requestId: data.request_id, statusUrl: data.status_url || null, responseUrl: data.response_url || null });
    }

    if (action === 'task-status' && request.method === 'GET') {
      const requestId = qs.get('requestId');
      const statusUrl = qs.get('statusUrl');
      const responseUrl = qs.get('responseUrl');
      if (!requestId) return json({ error: 'requestId required' }, 400);

      const pollUrl = statusUrl || `${FAL_BASE}/${MODEL}/requests/${requestId}/status`;
      let statusRes = await fetch(pollUrl, { headers: authHeader });
      if (!statusRes.ok && (statusRes.status === 405 || statusRes.status === 404)) {
        statusRes = await fetch(`${FAL_BASE}/requests/${requestId}/status`, { headers: authHeader });
      }

      let statusData;
      try { statusData = await statusRes.json(); } catch { statusData = {}; }

      if (!statusRes.ok) {
        return json({ status: 'FAILED', failure: statusData?.detail || statusData?.message || `fal.ai status HTTP ${statusRes.status}` });
      }

      if (statusData.status === 'COMPLETED') {
        const extractUrl = (obj) =>
          obj?.video?.url || obj?.videos?.[0]?.url || obj?.data?.video?.url ||
          obj?.output?.video?.url || obj?.output?.[0]?.url || obj?.output?.url;

        let videoUrl = extractUrl(statusData);
        if (!videoUrl) {
          const resultEndpoint = responseUrl || `${FAL_BASE}/${MODEL}/requests/${requestId}`;
          let resultRes = await fetch(resultEndpoint, { headers: authHeader });
          if (!resultRes.ok) resultRes = await fetch(`${FAL_BASE}/requests/${requestId}`, { headers: authHeader });
          const result = await resultRes.json();
          videoUrl = extractUrl(result);
        }
        return json({ status: 'SUCCEEDED', output: videoUrl ? [videoUrl] : [] });
      }

      if (statusData.status === 'FAILED') {
        return json({ status: 'FAILED', failure: statusData.error || statusData.detail || 'Generation failed' });
      }

      const qPos = typeof statusData.queue_position === 'number' ? statusData.queue_position : null;
      return json({ status: statusData.status || 'IN_PROGRESS', queuePosition: qPos });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
