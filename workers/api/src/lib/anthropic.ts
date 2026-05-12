// LLM call helpers — Anthropic direct + OpenRouter wrapper.
//
// Extracted from src/index.ts as Phase B step 3 of the route-module split
// (see WORKER_SPLIT_PLAN.md). Pure functions, no Env access — callers pass
// the API key directly. That means these can be unit-tested without a
// Cloudflare runtime.

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
}): Promise<{ text: string; usage: any }> {
  const { apiKey, model, systemPrompt, cachedPrefix, prompt, temperature, maxTokens, responseFormat } = opts;

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
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
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
