// Vision-critique helper for image/caption mismatch detection.
//
// Extracted from src/index.ts as Phase B step 5 of the route-module split
// (see WORKER_SPLIT_PLAN.md). Shared logic with the /api/critique-image-
// caption HTTP endpoint, lifted out so the prewarm cron, backfill, and
// JIT publish paths can call it without going through HTTP.
//
// Returns null on any failure (network, malformed JSON, missing API key)
// — caller treats null as "skip critique, ship the image" so a transient
// critique outage never blocks the publish pipeline.
//
// Cost: ~$0.003/call via Haiku 4.5 vision over OpenRouter. Cron prewarm
// budget: 8 posts/tick × 12 ticks/hour worst-case = $0.29/hour at full
// queue, much lower in practice (most ticks have 0-2 posts to score).

import type { Env } from '../env';

export async function critiqueImageInternal(
  env: Env,
  params: { imageUrl: string; caption: string; archetypeSlug: string | null; businessType?: string },
): Promise<{ score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null> {
  if (!env.OPENROUTER_API_KEY) return null;
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

  try {
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
              { type: 'text', text: `Caption that will be published with this image:\n\n"${caption}"\n\nDoes the image match?` },
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
      console.warn(`[critique] HTTP ${orRes.status} — skipping`);
      return null;
    }
    const orJson = await orRes.json() as any;
    const raw = orJson.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw);
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 5;
    const match = (['yes', 'partial', 'no'] as const).includes(parsed.match) ? parsed.match : 'partial';
    const reasoning = (parsed.reasoning || '').toString().slice(0, 300);
    return { score, match, reasoning };
  } catch (e: any) {
    console.warn(`[critique] failed: ${e?.message || e}`);
    return null;
  }
}
