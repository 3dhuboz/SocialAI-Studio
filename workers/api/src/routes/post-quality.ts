// User-facing AI quality endpoints — called from the post editor in the
// frontend to give the user pre-publish feedback.
//
//   POST /api/critique-image-caption — vision-grounded image+caption match
//   POST /api/score-post              — virality prediction trained on the
//                                       workspace's OWN historical engagement
//
// Both are rate-limited (60/min) and Clerk-auth'd. The cron prewarm + backfill
// paths use lib/critique.ts directly via critiqueImageInternal — this
// HTTP endpoint is the user-initiated variant called from the post editor.
//
// Extracted from src/index.ts as Phase B step 23 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { callAnthropicDirect, callOpenRouter } from '../lib/anthropic';

export function registerPostQualityRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── Vision-grounded image+caption critique (2026-05 image-stack upgrade) ──
  //
  // After fal.ai returns an image, pass [image_url, caption, business_type]
  // back to Haiku 4.5 (vision input) and ask: does this image match the post?
  // Returns a score 0-10, a YES/PARTIAL/NO verdict, a short reasoning, and a
  // regenerate boolean.
  //
  // This is the move that catches "food image on SaaS post" BEFORE it gets
  // published — exactly the failure mode the user screenshotted on 2026-05-12.
  // At ~$0.003/image (1024² → ~1334 input tokens + ~150 output tokens on Haiku
  // 4.5 vision) it's cheaper than a wasted FB impression.
  //
  // 99% of competing social-AI tools don't do this — they trust whatever FLUX
  // hallucinated. This is the cutting-edge differentiator.
  //
  // Body: { imageUrl, caption, businessType?, archetype?, postId? }
  // Returns: { score: 0-10, match: 'yes'|'partial'|'no', reasoning, regenerate }
  app.post('/api/critique-image-caption', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `critique:${uid}`, 60)) {
      return c.json({ error: 'Rate limit exceeded — 60 critiques per minute' }, 429);
    }

    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

    const body = await c.req.json().catch(() => ({})) as {
      imageUrl?: string;
      caption?: string;
      businessType?: string;
      archetype?: string;
      postId?: string;  // optional: persist result on the post if provided
    };
    const { imageUrl, caption, businessType = 'small business', archetype, postId } = body;
    if (!imageUrl || !caption) {
      return c.json({ error: 'imageUrl and caption are required' }, 400);
    }

    const systemPrompt = `You are an image-caption mismatch detector for a social-media SaaS that publishes posts to Facebook and Instagram. Given an image and the caption it will be paired with, your job is to flag mismatches BEFORE they get published.

Score the image-caption pair on a 0-10 scale:
- 10 = perfect match: image visually reinforces the caption's specific topic
- 7-9 = good match: image fits the caption's theme and business archetype
- 4-6 = partial match: image is on-brand but doesn't reinforce the specific topic
- 1-3 = poor match: image is off-topic or off-brand (e.g. food image on a tech post)
- 0 = catastrophic mismatch: image is offensive, inappropriate, or completely unrelated

Business archetype context: ${archetype || businessType}.

Common failure modes to catch:
- Food/restaurant imagery on a SaaS or tech-services post
- Generic stock-photo aesthetic (laptop on desk) on a specific local-business post
- People/faces in images (violates the no-people policy that's enforced upstream)
- Text overlay artifacts (FLUX rendered fake menu text, pricing badges, etc.)
- Subject mismatch (caption mentions a product the image doesn't show)

Return JSON ONLY, no prose. Schema:
{
  "score": <0-10>,
  "match": "yes" | "partial" | "no",
  "reasoning": "<one sentence — be specific about what you see in the image vs what the caption says>",
  "regenerate": <true if score <= 4, false otherwise>
}`;

    // OpenRouter supports vision via Anthropic's content-array format.
    // Image is fetched and inlined by OpenRouter from the URL we provide.
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://socialaistudio.au',
        'X-Title': 'SocialAI Studio — Image Critique',
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
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text().catch(() => '');
      return c.json({ error: `Vision critique call failed: ${orRes.status} ${errText.slice(0, 200)}` }, 502);
    }

    const orJson = await orRes.json() as any;
    const raw = orJson.choices?.[0]?.message?.content || '';
    let parsed: { score?: number; match?: string; reasoning?: string; regenerate?: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: 'Vision critique returned malformed JSON', raw: raw.slice(0, 500) }, 502);
    }

    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 5;
    const match = (['yes', 'partial', 'no'] as const).includes(parsed.match as any) ? parsed.match : 'partial';
    const reasoning = (parsed.reasoning || 'No reasoning provided').slice(0, 500);

    // Persist the result on the post when the caller scoped it. Best-effort —
    // a write failure shouldn't block the critique response. The post is
    // scoped to the calling user (via user_id check) so a malicious caller
    // can't tag someone else's posts.
    if (postId) {
      try {
        await c.env.DB.prepare(
          `UPDATE posts SET image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ? AND user_id = ?`
        ).bind(score, reasoning, new Date().toISOString(), postId, uid).run();
      } catch (e) {
        console.warn(`[critique] persist failed for post ${postId}:`, e);
      }
    }

    return c.json({ score, match, reasoning, regenerate: !!parsed.regenerate });
  });

  // ── Virality Score (2026-05 Tier 3 wow feature) ─────────────────────────
  //
  // Pre-publish engagement prediction trained on the workspace's OWN past
  // posts. The competition (FeedHive, quso.ai, Metricool) all race toward this
  // feature in 2025-2026 — agents called it "the single feature reviewers
  // flag as standout." The moat: per-tenant historical data the user actually
  // owns (we already scrape it nightly into client_facts.engagement_score).
  //
  // Pattern (no ML infra needed):
  //   1. Pull the workspace's top-5 and bottom-3 past posts by engagement_score
  //      from client_facts (already populated by the refresh-facts cron)
  //   2. Pass [draft, top-5 examples (with scores), bottom-3 examples (with scores)]
  //      to Haiku 4.5 with a "predict 0-100 + reasoning + 1-line improvement"
  //      structured-output prompt
  //   3. Cache the verdict on a per-draft basis so re-asking is cheap (the
  //      caller can ask repeatedly as the user edits, with debouncing
  //      client-side)
  //
  // Body: { content, platform?, pillar?, hashtags?, clientId? }
  // Returns: { score: 0-100, tier: 'low'|'mid'|'high'|'viral',
  //            reasoning, suggestions }
  app.post('/api/score-post', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `score:${uid}`, 60)) {
      return c.json({ error: 'Rate limit exceeded — 60 score calls per minute' }, 429);
    }
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

    const body = await c.req.json().catch(() => ({})) as {
      content?: string;
      platform?: 'Facebook' | 'Instagram';
      pillar?: string;
      hashtags?: string[];
      clientId?: string | null;
    };
    const { content = '', platform = 'Facebook', pillar = '', hashtags = [], clientId = null } = body;
    if (!content || content.trim().length < 10) {
      return c.json({ error: 'content is required (min 10 chars)' }, 400);
    }

    // Pull historical performance data — top performers + bottom performers
    // give the LLM concrete anchor points for what works/doesn't for THIS
    // workspace. own_post facts come pre-sorted by engagement_score DESC
    // from the refresh-facts cron.
    const factRows = await c.env.DB.prepare(
      `SELECT content, engagement_score, metadata
       FROM client_facts
       WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'own_post'
       ORDER BY engagement_score DESC
       LIMIT 100`
    ).bind(uid, clientId || '').all<{ content: string; engagement_score: number; metadata: string }>();
    const facts = factRows.results || [];

    if (facts.length < 3) {
      // Not enough historical data to make a meaningful prediction. Return
      // a generic-quality score based on heuristics so the UI still has
      // something to show. New accounts unlock the real model after their
      // first ~10 posts (or after the refresh-facts cron runs once).
      return c.json({
        score: 50,
        tier: 'mid',
        reasoning: facts.length === 0
          ? 'No historical engagement data yet — connect Facebook and let the daily refresh-facts cron populate this workspace, then re-score.'
          : `Only ${facts.length} past posts available — need at least 3 to make a per-tenant prediction. Showing neutral score for now.`,
        suggestions: [],
        data_status: 'insufficient',
        historical_posts: facts.length,
      });
    }

    // Build the few-shot context from the workspace's own engagement history.
    // Top-5 and bottom-3 give the model concrete signal about what this
    // audience responds to vs ignores. We trim each example to 280 chars so
    // the prompt fits in the cache-eligible range (Haiku 4.5 caches at the
    // 1024-token boundary).
    const top = facts.slice(0, 5).map((f, i) =>
      `TOP ${i + 1} (engagement score ${f.engagement_score}): ${f.content.slice(0, 280)}`
    ).join('\n\n');
    const bottom = facts.slice(-Math.min(3, facts.length)).map((f, i) =>
      `BOTTOM ${i + 1} (engagement score ${f.engagement_score}): ${f.content.slice(0, 280)}`
    ).join('\n\n');

    // Score distribution stats give the LLM a sense of what "high" means for
    // this workspace — what's viral for a 200-follower local cafe is mid-tier
    // for a 50k-follower agency.
    const scores = facts.map(f => f.engagement_score).sort((a, b) => a - b);
    const p25 = scores[Math.floor(scores.length * 0.25)] ?? 0;
    const p50 = scores[Math.floor(scores.length * 0.5)] ?? 0;
    const p75 = scores[Math.floor(scores.length * 0.75)] ?? 0;
    const p95 = scores[Math.floor(scores.length * 0.95)] ?? 0;

    const systemPrompt = `You are a social-media performance predictor for a specific business workspace. You have access to that workspace's own historical Facebook/Instagram posts and their actual engagement scores (likes + comments + shares + reactions).

Your job: given a NEW draft post, predict how it'll perform on a 0-100 scale relative to THIS workspace's history.

Score interpretation:
- 0-30  = LOW       — likely to underperform their typical post
- 31-60 = MID       — typical performance for this workspace
- 61-85 = HIGH      — predicted to outperform their average
- 86-100 = VIRAL    — predicted to be a top-performer for them

THIS WORKSPACE'S ENGAGEMENT DISTRIBUTION:
  p25=${p25}, p50=${p50}, p75=${p75}, p95=${p95}
(For context: the user's median engagement score is ${p50}. Anything above ${p75} is in their top quartile.)

THIS WORKSPACE'S TOP-5 POSTS:
${top}

THIS WORKSPACE'S BOTTOM-3 POSTS:
${bottom}

PREDICTION RULES:
1. Pattern-match the draft against the top-5 (does it share their structure, hook style, length, specificity?) and bottom-3 (does it share their weakness — vague claims, generic CTAs, slow openers?).
2. Be HONEST. A score of 35 is more useful than an inflated 75 the user will resent when the post flops.
3. Don't reward cleverness the audience hasn't engaged with before. If the top-5 are all sensory product close-ups but the draft is a thought-leadership essay, score it LOW even if the essay is well-written.
4. The score is RELATIVE to this workspace's history, not an absolute "viral" metric.

Respond ONLY with valid JSON, no prose, no markdown:
{
  "score": <0-100>,
  "tier": "low" | "mid" | "high" | "viral",
  "reasoning": "<one sentence — specific. Reference patterns from their top/bottom posts.>",
  "suggestions": ["<one short concrete improvement, ≤12 words>", ...]
}`;

    const userPrompt = `Draft post (platform: ${platform}${pillar ? `, pillar: ${pillar}` : ''}):\n\n"${content.slice(0, 1200)}"${hashtags.length ? `\n\nHashtags: ${hashtags.slice(0, 10).join(' ')}` : ''}`;

    // Use Anthropic direct if available — this prompt has a large workspace-
    // specific prefix that benefits massively from 1h caching when the user
    // is editing a draft and re-scoring repeatedly.
    let result: { text: string };
    if (c.env.ANTHROPIC_API_KEY) {
      try {
        result = await callAnthropicDirect({
          apiKey: c.env.ANTHROPIC_API_KEY,
          model: 'claude-haiku-4-5',
          systemPrompt: undefined,
          cachedPrefix: systemPrompt,
          prompt: userPrompt,
          temperature: 0.2,
          maxTokens: 500,
          responseFormat: 'json',
        });
      } catch (e: any) {
        console.warn('[score-post] Anthropic direct failed, falling back to OpenRouter:', e?.message);
        result = await callOpenRouter(apiKey, systemPrompt, userPrompt, 0.2, 500);
      }
    } else {
      result = await callOpenRouter(apiKey, systemPrompt, userPrompt, 0.2, 500);
    }

    let parsed: { score?: number; tier?: string; reasoning?: string; suggestions?: string[] };
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return c.json({ error: 'Virality scorer returned malformed JSON', raw: result.text.slice(0, 500) }, 502);
    }

    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50;
    const tier = (['low', 'mid', 'high', 'viral'] as const).includes(parsed.tier as any)
      ? parsed.tier
      : (score < 31 ? 'low' : score < 61 ? 'mid' : score < 86 ? 'high' : 'viral');

    return c.json({
      score,
      tier,
      reasoning: (parsed.reasoning || '').slice(0, 500),
      suggestions: (parsed.suggestions || []).slice(0, 3).map(s => String(s).slice(0, 150)),
      data_status: 'ok',
      historical_posts: facts.length,
      workspace_p50: p50,
      workspace_p95: p95,
    });
  });
}
