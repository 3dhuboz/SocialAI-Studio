/**
 * Cloudflare Pages Function — OpenRouter live stats
 * Available at: /api/ai/stats
 * Returns key usage, credit balance, rate limits from OpenRouter.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

  try {
    const [keyRes, creditsRes] = await Promise.allSettled([
      fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    ]);

    let keyData = null;
    if (keyRes.status === 'fulfilled' && keyRes.value.ok) {
      try { keyData = await keyRes.value.json(); } catch {}
    }

    let creditsData = null;
    if (creditsRes.status === 'fulfilled' && creditsRes.value.ok) {
      try { creditsData = await creditsRes.value.json(); } catch {}
    }

    const usage = keyData?.data?.usage ?? null;
    const limit = keyData?.data?.limit ?? null;
    const limitRemaining = keyData?.data?.limit_remaining ?? null;
    const rateLimit = keyData?.data?.rate_limit ?? null;
    const label = keyData?.data?.label ?? null;
    const isFreeTier = keyData?.data?.is_free_tier ?? false;

    const totalCredits = creditsData?.data?.total_credits ?? null;
    const totalUsage = creditsData?.data?.total_usage ?? null;

    return json({
      ok: true,
      label,
      isFreeTier,
      usage,            // credits used (float, USD)
      limit,            // credit limit (null = unlimited)
      limitRemaining,   // credits remaining (null = unlimited)
      rateLimit,        // { requests, interval }
      totalCredits,     // all-time purchased credits
      totalUsage,       // all-time usage
      model: 'google/gemini-2.0-flash-001',
      provider: 'OpenRouter',
    });
  } catch (err) {
    return json({ error: err.message || 'Failed to fetch OpenRouter stats' }, 500);
  }
}
