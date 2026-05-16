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
import { logAiUsage } from './ai-usage';

// Rough per-call cost estimate for ai_usage logging — refined when the
// Anthropic / OpenRouter invoice settles. Critique runs on Haiku 4.5
// vision at temp 0.1, 250 max tokens, with a ~1.5KB system prompt — so
// most calls land in the $0.002–$0.004 range.
const CRITIQUE_COST_USD = 0.003;

// Shared system prompt for vision-grounded image+caption critique. Exported
// so direct-path callers (e.g. lib/backfill.ts runBacklogCritique, which
// inlines its own Anthropic/OpenRouter calls to capture per-post error
// strings) can't drift from the canonical HARD RULES gate.
//
// archetypeSlug=null tells the vision model to infer business type from the
// caption itself rather than falling back to a generic "small business"
// default — without this clause, food-on-SaaS critiques scored at 6-8 because
// Haiku had no anchor to flag cross-domain mismatches.
/**
 * Build the system prompt for the vision-grounded image-caption mismatch
 * detector.
 *
 * Inputs:
 *   - archetypeSlug      — classified business archetype, or null when
 *                          unclassified (model infers from caption then).
 *   - forbiddenSubjects  — owner-declared denylist (e.g. ["pork","chicken"]
 *                          for a brisket-only BBQ). When non-empty, an
 *                          INTRA-DOMAIN HARD RULE is injected so the vision
 *                          model fails any image showing a banned subject
 *                          even when the caption + archetype "fit". This is
 *                          the safety net for the Seamus failure mode.
 */
export function buildCritiqueSystemPrompt(
  archetypeSlug: string | null,
  forbiddenSubjects: string[] = [],
): string {
  const archetypeLine = archetypeSlug
    ? `Business archetype context: ${archetypeSlug}.`
    : `Business archetype: UNCLASSIFIED. Infer the actual business type from the caption itself before scoring — read the caption carefully for product mentions, industry verbs, and audience signals. A caption mentioning "AI Content Autopilot", "SaaS", "agency dashboard", "marketing automation", "platform" is a tech/SaaS business, NOT a food business, regardless of any other context.`;

  // Layered HARD RULE — only injected when the business actually has a
  // denylist. Empty owners skip this entire block so the system prompt
  // stays compact for the 99% of cases where no denylist is configured.
  const denylistRule = forbiddenSubjects.length > 0
    ? `

INTRA-DOMAIN HARD RULE — owner-declared exclusions for this business:
  Forbidden subjects: ${forbiddenSubjects.join(', ')}.
  If the image visibly contains ANY of these subjects (as the main subject,
  as a side element, or even in the background), score 1-2 with match="no"
  and reasoning that names the specific forbidden subject. This rule fires
  REGARDLESS of whether the caption "matches" — the owner has explicitly
  told us they do not sell these and never want them depicted, full stop.`
    : '';

  return `You are an image-caption mismatch detector for a social-media SaaS that publishes posts to Facebook and Instagram. Given an image and the caption it will be paired with, your job is to flag mismatches BEFORE they get published.

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
  score 1-2.${denylistRule}

TOPIC-MISMATCH RULE — score 3-4 when:
- Caption is specifically about a PAIN POINT, problem, or wasted time (e.g. "how many hours do you spend…", "still doing this manually", "drowning in notifications", "never enough time") AND the image shows a completely neutral, generic workspace scene that communicates NOTHING about frustration or time pressure (e.g. a keyboard, a plain laptop, an abstract gradient) → score 3-4.
- Caption is specifically about a SUCCESS, outcome, or transformation AND the image shows a chaotic cluttered scene unrelated to resolution → score 3-4.
- Caption mentions a SPECIFIC named product or feature AND the image shows a completely different unrelated scene from the same business category → score 3-4.
In all these cases: match="partial", and reasoning must explain the topic-vs-image mismatch.

Other failure modes (typically score 2-4 depending on severity):
- Generic stock-photo aesthetic (laptop on desk) on a specific local-business post
- People/faces in images (violates the no-people policy enforced upstream)
- Text overlay artifacts (FLUX rendered fake menu text, pricing badges, etc.)
- Subject mismatch (caption mentions a product the image doesn't show)

Return JSON ONLY, no prose. Schema:
{"score": <0-10>, "match": "yes"|"partial"|"no", "reasoning": "<one sentence>"}`;
}

export async function critiqueImageInternal(
  env: Env,
  params: {
    imageUrl: string;
    caption: string;
    archetypeSlug: string | null;
    businessType?: string;
    /** Owner-declared "never depict" subjects from BusinessProfile.forbiddenSubjects.
     *  Passed through to buildCritiqueSystemPrompt as the intra-domain HARD
     *  RULE that fails any image visibly containing a banned subject. */
    forbiddenSubjects?: string[];
    /** Optional metering context. When set, the ai_usage log row attributes
     *  spend to this workspace/post. All optional — omitting them still
     *  records the call against the (provider, model, operation) bucket
     *  but without per-tenant attribution. */
    userId?: string | null;
    clientId?: string | null;
    postId?: string | null;
  },
): Promise<{ score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null> {
  // Need at least one provider key — Anthropic direct preferred, OpenRouter
  // as fallback. Return null if neither is set so the caller ships the
  // image untouched instead of blocking the publish pipeline.
  if (!env.ANTHROPIC_API_KEY && !env.OPENROUTER_API_KEY) return null;
  const { imageUrl, caption, archetypeSlug, forbiddenSubjects, userId, clientId, postId } = params;
  // businessType param kept on the type for backward compat with HTTP callers
  // but no longer used — when archetypeSlug is null the system prompt
  // instructs the vision model to derive business type from the caption
  // itself, which is a stronger signal than a stored default.

  const systemPrompt = buildCritiqueSystemPrompt(archetypeSlug, forbiddenSubjects ?? []);

  const userPrompt = `Caption that will be published with this image:\n\n"${caption}"\n\nDoes the image match?`;
  let raw = '';
  // Which provider we ultimately consumed credits from — used for the
  // ai_usage row at the end. 'anthropic' wins if Anthropic direct returned
  // a non-empty body; 'openrouter' wins if we fell through; null means
  // both upstreams failed and we'll log with ok=false.
  let providerUsed: 'anthropic' | 'openrouter' | null = null;

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
      if (raw) providerUsed = 'anthropic';
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
      try {
        await logAiUsage(env, {
          userId, clientId, postId,
          provider: 'openrouter',
          model: 'anthropic/claude-haiku-4.5',
          operation: 'critique',
          estCostUsd: 0,
          ok: false,
        });
      } catch { /* never let logging break critique */ }
      return null;
    }
    const orJson = await orRes.json() as any;
    raw = orJson.choices?.[0]?.message?.content || '';
    if (raw) providerUsed = 'openrouter';
  } catch (e: any) {
    console.warn(`[critique] OpenRouter call failed: ${e?.message}`);
    try {
      await logAiUsage(env, {
        userId, clientId, postId,
        provider: 'openrouter',
        model: 'anthropic/claude-haiku-4.5',
        operation: 'critique',
        estCostUsd: 0,
        ok: false,
      });
    } catch { /* never let logging break critique */ }
    return null;
  }

  if (!raw) {
    // Both upstreams returned empty. Already logged failures above where
    // they happened; nothing more to record here.
    return null;
  }

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
    // STRICT validation (2026-05 hardening): every field must be present
    // and well-typed. Previously a partial JSON like {"reasoning":"…"} would
    // get score=5 + match='partial' synthesized as defaults, producing a
    // "5/10 partial — …" critique that lied about having been done. The
    // publish cron's quality gate only blocks score ≤ 3, so a fake 5
    // sailed straight through. Now any malformed shape returns null and the
    // caller treats it as "no critique data" — which is the truth.
    const score = parsed.score;
    const match = parsed.match;
    const reasoning = (parsed.reasoning || '').toString().trim();
    if (typeof score !== 'number' || !isFinite(score)) {
      console.warn(`[critique] response missing/non-numeric score — treating as no critique: ${stripped.slice(0, 200)}`);
      return null;
    }
    if (score < 0 || score > 10) {
      console.warn(`[critique] score ${score} out of 0-10 range — treating as no critique`);
      return null;
    }
    if (!(['yes', 'partial', 'no'] as const).includes(match)) {
      console.warn(`[critique] response has invalid match='${match}' — treating as no critique: ${stripped.slice(0, 200)}`);
      return null;
    }
    if (!reasoning) {
      console.warn(`[critique] response missing reasoning — treating as no critique: ${stripped.slice(0, 200)}`);
      return null;
    }
    // Successful critique — record the call against the provider that
    // actually answered. providerUsed=null shouldn't reach here because
    // an empty raw returns null above; defensive `?? 'anthropic'` keeps
    // the type system happy.
    try {
      await logAiUsage(env, {
        userId, clientId, postId,
        provider: providerUsed ?? 'anthropic',
        model: providerUsed === 'openrouter' ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5',
        operation: 'critique',
        estCostUsd: CRITIQUE_COST_USD,
        ok: true,
      });
    } catch { /* never let logging break critique */ }
    return {
      score: Math.max(0, Math.min(10, score)),
      match,
      reasoning: reasoning.slice(0, 300),
    };
  } catch (e: any) {
    console.warn(`[critique] failed to parse: ${e?.message || e} — raw: ${stripped.slice(0, 200)}`);
    try {
      await logAiUsage(env, {
        userId, clientId, postId,
        provider: providerUsed ?? 'anthropic',
        model: providerUsed === 'openrouter' ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5',
        operation: 'critique',
        // Cost was incurred even though we couldn't parse the response —
        // record full cost with ok=false so the spend tally is honest.
        estCostUsd: CRITIQUE_COST_USD,
        ok: false,
      });
    } catch { /* never let logging break critique */ }
    return null;
  }
}
