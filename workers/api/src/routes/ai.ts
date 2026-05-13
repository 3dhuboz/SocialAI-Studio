// AI inference + provider stats.
//
// POST /api/ai/generate — text generation chokepoint for the frontend.
//   Anthropic direct preferred when ANTHROPIC_API_KEY is set (1-hour cache
//   TTL beta + native telemetry + ~5.5% saved on OpenRouter markup), falls
//   back to OpenRouter otherwise. Auth + rate-limited (30/min/user) to
//   prevent anonymous abuse of provider credits.
//
// GET  /api/ai/stats — OpenRouter key/credit telemetry, used by the
//   admin AI-Stats page. Public-ish (no auth) but contains no secrets —
//   just remaining limit / usage counters.
//
// Extracted from src/index.ts as Phase B step 18 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { callAnthropicDirect } from '../lib/anthropic';

export function registerAiRoutes(app: Hono<{ Bindings: Env }>): void {
  /**
   * POST /api/ai/generate
   * Body: { prompt, systemPrompt?, temperature?, maxTokens?, responseFormat? }
   * responseFormat: 'json' | 'text' (default 'text')
   * Routes to OpenRouter — key never leaves the worker.
   */
  app.post('/api/ai/generate', async (c) => {
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'OpenRouter API key not configured on worker.' }, 500);
    }

    // AUTH GATE — require Clerk JWT or Portal token. Stops anonymous abuse of OpenRouter credits.
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    // RATE LIMIT — 30 generations per minute per user.
    if (await isRateLimited(c.env.DB, `ai:${uid}`, 30)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }

    let body: {
      prompt?: string;
      systemPrompt?: string;
      /** Optional static prefix to send with cache_control (Anthropic prompt caching).
       * If supplied AND the model is an Anthropic one AND the prefix is large enough
       * (~1024+ tokens), Anthropic caches the block for 5 min and bills the rest at
       * a 90% discount on cache hits. Use for the GOLDEN RULES + ground-truth blocks
       * that repeat across every Smart Schedule call. */
      cachedPrefix?: string;
      temperature?: number;
      maxTokens?: number;
      responseFormat?: 'json' | 'text';
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body.' }, 400);
    }

    const {
      prompt,
      systemPrompt,
      cachedPrefix,
      temperature = 0.8,
      maxTokens = 2048,
      responseFormat = 'text',
    } = body;

    if (!prompt) {
      return c.json({ error: 'prompt is required.' }, 400);
    }

    const requestedModel = (body as any).model as string | undefined;
    const effectiveModel = requestedModel || 'anthropic/claude-haiku-4.5';
    const isAnthropic = effectiveModel.startsWith('anthropic/') || effectiveModel.startsWith('claude-');

    // ── Anthropic direct routing (2026-05 stack upgrade) ──
    // When ANTHROPIC_API_KEY is configured AND the requested model is an
    // Anthropic one, route direct instead of through OpenRouter. This unlocks:
    //   - 1-hour prompt cache TTL via the extended-cache-ttl beta header
    //     (vs OpenRouter's 5-min default — production teams report 70-90%
    //     cost reduction at warm cache on long brand-context prefixes)
    //   - Native usage telemetry (cache_creation_input_tokens,
    //     cache_read_input_tokens) so we can measure cache hit rate
    //   - ~5.5% saved on OpenRouter's markup
    //   - ~25-40ms saved on routing latency
    // Falls back to OpenRouter when ANTHROPIC_API_KEY is absent — zero-config
    // rollout, just `wrangler secret put ANTHROPIC_API_KEY` to enable.
    if (isAnthropic && c.env.ANTHROPIC_API_KEY) {
      try {
        const result = await callAnthropicDirect({
          apiKey: c.env.ANTHROPIC_API_KEY,
          model: effectiveModel.replace(/^anthropic\//, ''),
          systemPrompt,
          cachedPrefix,
          prompt,
          temperature,
          maxTokens,
          responseFormat,
        });
        return c.json({ text: result.text, _meta: { route: 'anthropic-direct', usage: result.usage } });
      } catch (e: any) {
        // If Anthropic direct fails (network blip, key invalid), fall through
        // to OpenRouter as a hot failover. Log so we can spot config issues.
        console.warn('[ai/generate] Anthropic direct failed, falling back to OpenRouter:', e?.message);
      }
    }

    // ── OpenRouter path (original — used as default before Anthropic key set,
    //                     and as failover when direct call fails) ──
    const useAnthropicCaching = !!cachedPrefix && isAnthropic;

    const messages: Array<{ role: string; content: any }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    if (useAnthropicCaching) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prompt },
        ],
      });
    } else {
      const combined = cachedPrefix ? `${cachedPrefix}\n\n${prompt}` : prompt;
      messages.push({ role: 'user', content: combined });
    }

    const orBody: Record<string, unknown> = {
      model: effectiveModel,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    if (responseFormat === 'json') {
      orBody.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://socialai.studio',
        'X-Title': 'SocialAI Studio',
      },
      body: JSON.stringify(orBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenRouter error:', response.status, errText);
      return c.json({ error: `OpenRouter error ${response.status}: ${errText}` }, response.status as 400 | 429 | 500);
    }

    const data = await response.json<{
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    }>();

    if (data.error) {
      return c.json({ error: data.error.message || 'OpenRouter returned an error.' }, 500);
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    return c.json({ text, _meta: { route: 'openrouter' } });
  });

  // OpenRouter key + credit telemetry for the admin AI-Stats panel. Read-only
  // and contains no secrets — just remaining limit / usage counters.
  app.get('/api/ai/stats', async (c) => {
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);
    try {
      const [keyRes, creditsRes] = await Promise.allSettled([
        fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${apiKey}` } }),
        fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${apiKey}` } }),
      ]);
      let keyData: any = null;
      if (keyRes.status === 'fulfilled' && keyRes.value.ok) { try { keyData = await keyRes.value.json(); } catch {} }
      let creditsData: any = null;
      if (creditsRes.status === 'fulfilled' && creditsRes.value.ok) { try { creditsData = await creditsRes.value.json(); } catch {} }
      return c.json({
        ok: true,
        label: keyData?.data?.label ?? null,
        isFreeTier: keyData?.data?.is_free_tier ?? false,
        usage: keyData?.data?.usage ?? null,
        limit: keyData?.data?.limit ?? null,
        limitRemaining: keyData?.data?.limit_remaining ?? null,
        rateLimit: keyData?.data?.rate_limit ?? null,
        totalCredits: creditsData?.data?.total_credits ?? null,
        totalUsage: creditsData?.data?.total_usage ?? null,
        model: 'google/gemini-2.0-flash-001',
        provider: 'OpenRouter',
      });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to fetch OpenRouter stats' }, 500);
    }
  });
}
