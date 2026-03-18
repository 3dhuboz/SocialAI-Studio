/**
 * Cloudflare Pages Function — DEPRECATED
 * Claude is no longer used. All AI generation is handled server-side via
 * OpenRouter at /api/ai/generate on the Cloudflare Worker.
 * This stub exists only to return a clean error for any stale clients.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({ error: 'Claude is no longer used. AI is handled by OpenRouter — no API key required.' }),
    { status: 410, headers: corsHeaders }
  );
}
