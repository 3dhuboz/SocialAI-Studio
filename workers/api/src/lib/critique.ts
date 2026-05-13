// Vision-critique helper for image/caption mismatch detection.
//
// Extracted from src/index.ts as Phase B step 5 of the route-module split
// (see WORKER_SPLIT_PLAN.md). Shared logic with the /api/critique-image-
// caption HTTP endpoint, lifted out so the prewarm cron, backfill, and
// JIT publish paths can call it without going through HTTP.
//
// Routing (2026-05-12 update):
//   - ANTHROPIC_API_KEY set → Anthropic direct vision (preferred). Skips
//     the OpenRouter markup + one upstream that can fail independently.
//   - Falls back to OpenRouter on missing Anthropic key OR direct-call
//     failure (network/auth glitch). The OpenRouter path is unchanged.
//
// Returns null on any failure (network, malformed JSON, missing API key)
// — caller treats null as "skip critique, ship the image" so a transient
// critique outage never blocks the publish pipeline.
//
// Cost: ~$0.003/call via Haiku 4.5 vision. Cron prewarm budget: 8 posts/
// tick × 12 ticks/hour worst-case = $0.29/hour at full queue, much lower
// in practice (most ticks have 0-2 posts to score). Anthropic direct
// saves the ~5.5% OpenRouter markup on top.

import type { Env } from '../env';
import { callAnthropicVision } from './anthropic';

export async function critiqueImageInternal(
  env: Env,
  params: { imageUrl: string; caption: string; archetypeSlug: string | null; businessType?: string },
): Promise<{ score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null> {
  // Need at least one provider key — Anthropic direct preferred, OpenRouter
  // as fallback. Return null if neither is set so the caller ships the
  // image untouched instead of blocking the publish pipeline.
  if (!env.ANTHROPIC_API_KEY && !env.OPENROUTER_API_KEY) return null;
  const { imageUrl, caption, archetypeSlug } = params;
  // businessType param kept on the type for backward compat with HTTP callers
  // but no longer used — when archetypeSlug is null we now instruct the
  // vision model to derive business type from the caption itself, which is
  // a stronger signal than a stored "small business" default.

  // If the workspace's archetype_slug is NULL (never classified), give the
  // vision model an explicit "infer it from the caption" instruction so it
  // doesn't fall back to scoring food-on-SaaS as "fine, it's a small
  // business". Without this clause, ${archetypeSlug || businessType}
  // resolves to "small business" and Haiku has no anchor to flag cross-
  // domain mismatches.
  const archetypeLine = archetypeSlug
    ? `Business archetype context: ${archetypeSlug}.`
    : `Business archetype: UNCLASSIFIED. Infer the actual business type from the caption itself before scoring — read the caption carefully for product mentions, industry verbs, and audience signals. A caption mentioning "AI Content Autopilot", "SaaS", "agency dashboard", "marketing automation", "platform" is a tech/SaaS business, NOT a food business, regardless of any other context.`;

  const systemPrompt = `You are an image-caption mismatch detector for a social-media SaaS that publishes posts to Facebook and Instagram. Given an image and the caption it will be paired with, your job is to flag mismatches BEFORE they get published.

Score the image-caption pair on a 0-10 scale:
- 10 = perfect match: image visually reinforces the caption's specific topic
- 7-9 = good match: image fits the caption's theme and business archetype
- 4-6 = partial match: image is on-brand but doesn't reinforce the specific topic
- 1-3 = poor match: image is off-topic or off-brand
- 0 = catastrophic mismatch: image is offensive, inappropriate, or completely unrelated

${archetypeLine}

HARD RULES — any of these conditions force a score of 1-2, no exceptions:
- Caption is about SaaS/software/AI/platform/agency tools/marketing automation
  AND the image shows food, plated meals, restaurant interiors, BBQ, brisket,
  smoked meats, kitchen scenes, beverages, livestock, paddocks, farms,
  tractors, gym equipment, workout gear, salons, spas, or auto-mechanic
  workshops → CROSS-DOMAIN BLEED. Score 1-2.
- Caption is about a restaurant/cafe/food truck/BBQ joint AND the image
  shows laptops, dashboards, app screens, or office settings → score 1-2.
- Caption is about a butcher, farm, BBQ joint, or any food-adjacent business
  AND the image shows gym equipment, yoga mats, dashboards, or office UI →
  score 1-2.

Other failure modes (typically score 2-4 depending on severity):
- Generic stock-photo aesthetic (laptop on desk) on a specific local-business post
- People/faces in images (violates the no-people policy enforced upstream)
- Text overlay artifacts (FLUX rendered fake menu text, pricing badges, etc.)
- Subject mismatch (caption mentions a product the image doesn't show)

Return JSON ONLY, no prose. Schema:
{"score": <0-10>, "match": "yes"|"partial"|"no", "reasoning": "<one sentence>"}`;

  const userPrompt = `Caption that will be published with this image:\n\n"${caption}"\n\nDoes the image match?`;
  let raw = '';

  // Path A — Anthropic direct (preferred when key is set). Same Haiku 4.5
  // model, native vision API, no OpenRouter intermediary.
  if (env.ANTHROPIC_API_KEY) {
    try {
      const { text } = await callAnthropicVision({
        apiKey: env.ANTHROPIC_API_KEY,
        model: 'claude-haiku-4-5',
        systemPrompt,
        prompt: userPrompt,
        imageUrl,
        temperature: 0.1,
        maxTokens: 250,
        responseFormat: 'json',
      });
      raw = text;
    } catch (e: any) {
      // Network/auth glitch on Anthropic — log and fall through to
      // OpenRouter so we don't lose the critique entirely. The OpenRouter
      // path is unchanged from the pre-direct era.
      console.warn(`[critique] Anthropic direct failed, falling back to OpenRouter: ${e?.message}`);
    }
  }

  // Path B — OpenRouter fallback (also used when Anthropic key is absent).
  if (!raw && env.OPENROUTER_API_KEY) try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://socialaistudio.au',
        'X-Title': 'SocialAI Studio — Cron Image Critique',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 250,
        response_format: { type: 'json_object' },
      }),
    });
    if (!orRes.ok) {
      console.warn(`[critique] OpenRouter HTTP ${orRes.status} — skipping`);
      return null;
    }
    const orJson = await orRes.json() as any;
    raw = orJson.choices?.[0]?.message?.content || '';
  } catch (e: any) {
    console.warn(`[critique] OpenRouter call failed: ${e?.message}`);
    return null;
  }

  if (!raw) return null;

  // Strip ```json / ``` fences — OpenRouter+Haiku occasionally wraps the
  // structured-output JSON in a markdown code block despite the
  // response_format=json_object hint. Without this strip every OpenRouter
  // critique returns null and falls through to "skip critique, ship the
  // image" which silently disables the quality gate. Anthropic direct
  // doesn't have this problem.
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 5;
    const match = (['yes', 'partial', 'no'] as const).includes(parsed.match) ? parsed.match : 'partial';
    const reasoning = (parsed.reasoning || '').toString().slice(0, 300);
    return { score, match, reasoning };
  } catch (e: any) {
    console.warn(`[critique] failed to parse: ${e?.message || e} — raw: ${stripped.slice(0, 200)}`);
    return null;
  }
}
