// LLM call helpers — Anthropic direct + OpenRouter wrapper.
//
// Extracted from src/index.ts as Phase B step 3 of the route-module split
// (see WORKER_SPLIT_PLAN.md). Pure functions, no Env access — callers pass
// the API key directly. That means these can be unit-tested without a
// Cloudflare runtime.
//
// 2026-05-16 cost-attribution update: each helper now accepts an optional
// `metering` arg carrying `env` + (userId, clientId, postId, operation).
// When set, the helper fires a fire-and-forget ai_usage row recording
// model + token usage + estimated cost against the workspace. The arg is
// optional so existing callers (post-quality, ai, campaign-research,
// weekly-review) keep compiling unchanged; opt in by passing { env, ... }.
// Logging is wrapped in try/catch so a D1 failure never propagates.

import type { Env } from '../env';
import { logAiUsage, type AiUsageRow } from './ai-usage';

// Per-model cost coefficients (USD per 1M tokens). Haiku 4.5 is the
// default vision/text model; the Sonnet/Opus paths in lib/campaign-research
// pay more — callers override via the `metering.estCostUsd` field when
// they want to record an explicit number instead of trusting the lookup.
const ANTHROPIC_PRICING_USD_PER_M: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
};

function estimateAnthropicCost(model: string, usage: any): number {
  const p = ANTHROPIC_PRICING_USD_PER_M[model] || ANTHROPIC_PRICING_USD_PER_M['claude-haiku-4-5'];
  const tokensIn = Number(usage?.input_tokens ?? 0)
    + Number(usage?.cache_creation_input_tokens ?? 0)
    + Number(usage?.cache_read_input_tokens ?? 0) * 0.1; // cache reads are 10% list
  const tokensOut = Number(usage?.output_tokens ?? 0);
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

/** Optional metering context for Anthropic helper calls. Callers that pass
 *  this object get an ai_usage row written automatically on success/failure.
 *  Pass-through only — the helper does not interpret beyond logging. */
export type AnthropicMetering = {
  env: Env;
  userId?: string | null;
  clientId?: string | null;
  postId?: string | null;
  /** What this call is for — 'caption', 'campaign-research', 'score-post',
   *  etc. Recorded as ai_usage.operation. */
  operation: string;
  /** Override the per-model price lookup. Useful for paths with known
   *  fixed-cost ceilings (e.g. critique fixed at $0.003) where the token
   *  arithmetic isn't worth the noise. */
  estCostUsdOverride?: number;
};

async function logAnthropicCall(
  metering: AnthropicMetering | undefined,
  model: string,
  usage: any,
  ok: boolean,
): Promise<void> {
  if (!metering) return;
  try {
    const row: AiUsageRow = {
      userId: metering.userId ?? null,
      clientId: metering.clientId ?? null,
      postId: metering.postId ?? null,
      provider: 'anthropic',
      model,
      operation: metering.operation,
      tokensIn: usage?.input_tokens != null
        ? Number(usage.input_tokens)
          + Number(usage?.cache_creation_input_tokens ?? 0)
          + Number(usage?.cache_read_input_tokens ?? 0)
        : undefined,
      tokensOut: usage?.output_tokens != null ? Number(usage.output_tokens) : undefined,
      estCostUsd: metering.estCostUsdOverride ?? estimateAnthropicCost(model, usage ?? {}),
      ok,
    };
    await logAiUsage(metering.env, row);
  } catch (e: any) {
    console.warn(`[anthropic-meter] log failed: ${e?.message || e}`);
  }
}

// ── Anthropic direct call helper (2026-05 stack upgrade) ─────────────────
//
// Translates the OpenRouter-style request format into Anthropic's native
// Messages API format, with 1-hour prompt cache TTL via the
// extended-cache-ttl-2025-04-11 beta header.
//
// Why direct vs OpenRouter:
//   - 1-hour cache TTL needs the beta header which OpenRouter doesn't pass
//   - Native usage telemetry includes cache_creation_input_tokens and
//     cache_read_input_tokens so we can measure cache hit rate
//   - JSON-mode output is reliable on Haiku 4.5 with temp 0-0.2 even
//     without strict structured outputs
//
// Cost shape on a 5k-token brand-context prefix repeated 14× (Smart Schedule):
//   - OpenRouter no cache:        14 × 5k tokens × $1/M = $0.07 input
//   - Direct with 5-min cache:    1 × 5k × $1.25/M + 13 × 5k × $0.10/M = $0.013 input
//   - Direct with 1-hour cache:   1 × 5k × $2.00/M + 13 × 5k × $0.10/M = $0.0165 input
// Net at scale across many tenants/hours: 70-85% reduction in input cost.
export async function callAnthropicDirect(opts: {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  cachedPrefix?: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  responseFormat: 'json' | 'text';
  /** Optional metering context. When set, the call is recorded in
   *  ai_usage with provider='anthropic' + the supplied operation name.
   *  Existing callers can omit this and get the pre-2026-05-16 behaviour. */
  metering?: AnthropicMetering;
}): Promise<{ text: string; usage: any }> {
  const { apiKey, model, systemPrompt, cachedPrefix, prompt, temperature, maxTokens, responseFormat, metering } = opts;

  // Build messages array — Anthropic format puts system as a top-level field,
  // not a message. Cached prefix lives in a content block on the user message
  // with cache_control that pins it to the 1-hour cache.
  const messages: any[] = [];
  if (cachedPrefix) {
    messages.push({
      role: 'user',
      content: [
        // 1-hour TTL via extended-cache-ttl beta. Falls back to 5-min cache
        // if the model doesn't recognise the ttl field (legacy paths).
        { type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: prompt },
      ],
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  // For JSON mode: append a small instruction to the system prompt rather
  // than relying on a separate response_format field. Haiku 4.5 honours this
  // reliably at temp ≤ 0.2. Anthropic's native structured outputs (Nov 2025)
  // would be even tighter but require the structured-outputs-2025-11-13 beta
  // header and a JSON schema — saving that for a follow-up commit.
  const sys = responseFormat === 'json'
    ? `${systemPrompt || ''}\n\nReturn ONLY valid JSON, no prose, no markdown code fences.`.trim()
    : systemPrompt;

  const body: any = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (sys) body.system = sys;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      // 1-hour cache TTL beta header. Without this, the ttl: '1h' field is
      // silently ignored and you get the default 5-min TTL.
      'anthropic-beta': 'extended-cache-ttl-2025-04-11',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // Log the failure before throwing so cost-attribution still captures
    // upstream errors (rate limits, auth, 5xx) that we want to track but
    // can't bill for.
    await logAnthropicCall(metering, model, {}, false);
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  await logAnthropicCall(metering, model, data?.usage, true);
  return { text, usage: data?.usage || {} };
}

// Anthropic direct vision call — image + text in, JSON-mode out.
//
// Used by lib/critique.ts as the preferred path when ANTHROPIC_API_KEY is
// set (falls back to OpenRouter on missing key or network failure). Same
// reliability + telemetry benefits as callAnthropicDirect plus:
//   - Vision content blocks are native (no OpenRouter translation layer)
//   - When run during prewarm cron, eliminates one upstream that can fail
//     independently of Anthropic itself
//
// Anthropic vision uses `{ type: 'image', source: { type: 'url', url } }`
// content blocks — different shape from OpenRouter's `image_url` blocks.
// Caller passes the URL; we wrap it server-side.
export async function callAnthropicVision(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  imageUrl: string;
  temperature: number;
  maxTokens: number;
  responseFormat: 'json' | 'text';
  /** Optional metering context. When set, the call is recorded in
   *  ai_usage with provider='anthropic' + operation. Critique callers
   *  (lib/critique) do their own logging at a higher level to capture the
   *  OpenRouter fallback path too, so they leave this undefined. */
  metering?: AnthropicMetering;
}): Promise<{ text: string; usage: any }> {
  const { apiKey, model, systemPrompt, prompt, imageUrl, temperature, maxTokens, responseFormat, metering } = opts;

  // For JSON mode: same instruction-append idiom as callAnthropicDirect.
  // Haiku 4.5 honours this reliably at temp ≤ 0.2.
  const sys = responseFormat === 'json'
    ? `${systemPrompt}\n\nReturn ONLY valid JSON, no prose, no markdown code fences.`.trim()
    : systemPrompt;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: sys,
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    await logAnthropicCall(metering, model, {}, false);
    throw new Error(`Anthropic vision ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  await logAnthropicCall(metering, model, data?.usage, true);
  return { text, usage: data?.usage || {} };
}

// Thin OpenRouter wrapper for endpoints that don't need the full
// /api/ai/generate ceremony (auth, rate limit, etc — those are at the
// endpoint level). Used by /api/score-post as the OpenRouter fallback when
// ANTHROPIC_API_KEY isn't configured.
export async function callOpenRouter(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<{ text: string }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://socialaistudio.au',
      'X-Title': 'SocialAI Studio',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  return { text: data.choices?.[0]?.message?.content || '' };
}
