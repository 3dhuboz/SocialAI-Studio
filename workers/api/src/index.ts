import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { getAuthUserId, isRateLimited } from './auth';
import { callAnthropicDirect, callOpenRouter } from './lib/anthropic';
import { FLUX_NEGATIVE_PROMPT } from './lib/image-safety';
import {
  ArchetypeRow,
  classifyArchetypeFromFingerprint,
} from './lib/archetypes';
import { refreshFactsForUser } from './lib/facebook-facts';
import { cronRefreshTokens } from './cron/refresh-tokens';
import { cronCheckFalCredits } from './cron/check-fal-credits';
import { cronWeeklyReview } from './cron/weekly-review';
import { cronRefreshFacts } from './cron/refresh-facts';
import { cronPublishMissedPosts } from './cron/publish-missed';
import { cronPrewarmImages } from './cron/prewarm-images';
import { cronPrewarmVideos } from './cron/prewarm-videos';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerHealthRoutes } from './routes/health';
import { registerUserRoutes } from './routes/user';
import { registerSocialTokensRoutes } from './routes/social-tokens';
import { registerPortalRoutes } from './routes/portal';
import { registerActivationRoutes } from './routes/activations';
import { registerFactsRoutes } from './routes/facts';
import { registerPostsRoutes } from './routes/posts';
import { registerClientsRoutes } from './routes/clients';
import { registerArchetypeRoutes } from './routes/archetypes';
import { registerFacebookRoutes } from './routes/facebook';
import { registerAiRoutes } from './routes/ai';
import { registerPaypalRoutes } from './routes/paypal';
import { registerAdminStatsRoutes } from './routes/admin-stats';
import { registerAdminActionsRoutes } from './routes/admin-actions';
import { registerBillingRoutes } from './routes/billing';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return 'https://socialaistudio.au';
      const allowed = [
        'http://localhost:5173', 'http://localhost:5174',
        'https://socialaistudio.au',
        'https://social.picklenick.au', 'https://social.streetmeatzbbq.com.au',
        'https://social.hugheseysque.au', 'https://hugheseysque.au',
        // Additional whitelabel portal origins
        'https://social.gladstonebbq.com.au', 'https://social.blackcat.com.au',
        'https://social.jonesysgarage.com.au', 'https://social.jenniannesjewels.com.au',
        'https://littlestomp.com.au', 'https://www.littlestomp.com.au',
        'https://streetmeatzbbq.com.au', 'https://www.streetmeatzbbq.com.au',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow all *.pages.dev subdomains (CF Pages preview/prod deployments)
      if (origin.endsWith('.pages.dev')) return origin;
      return 'https://socialaistudio.au';
    },
    // X-Portal-Secret is sent by whitelabel portal frontends to authenticate
    // their slug-based portal lookup. Without this, browser preflight blocks
    // the request and the portal shows "Portal not configured".
    allowHeaders: ['Content-Type', 'Authorization', 'X-Portal-Secret', 'X-Bootstrap-Secret'],
    allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// Modular route registration — see routes/* for each group. Each
// registerXRoutes call mounts a handful of endpoints onto the shared app
// instance. Order doesn't matter unless two registrations share a path
// prefix (none currently do).
registerHealthRoutes(app);
registerAiRoutes(app);
registerUserRoutes(app);
registerPostsRoutes(app);
registerClientsRoutes(app);
registerSocialTokensRoutes(app);
registerPortalRoutes(app);
registerActivationRoutes(app);
registerCampaignRoutes(app);
registerFactsRoutes(app);
registerArchetypeRoutes(app);
registerFacebookRoutes(app);
registerPaypalRoutes(app);
registerAdminStatsRoutes(app);
registerAdminActionsRoutes(app);
registerBillingRoutes(app);


// ── Image prompt safety helpers live in lib/image-safety.ts ─────────────
// (Phase B step 4 of the route-module split; see WORKER_SPLIT_PLAN.md.)
// resolveArchetypeSlug lives in lib/archetypes.ts and is imported by the
// modules that need it (routes/admin-actions, the prewarm cron, etc.).



// Health, cron-health, post-schedule moved to routes/health.ts.



// ── DB: Campaigns — see routes/campaigns.ts ─────────────────────────────────




// ── Facebook Page Insights Scraper ─────────────────────────────────────────
// Pulls a connected Page's REAL data (own posts, comments, about, photos,
// events) into the client_facts table. The AI then writes from real ground
// truth instead of inventing testimonials and stats. See lib/facebook-facts +
// routes/facts.ts.


// ── 90-second Magic Onboarding (2026-05 Tier 3 wow feature) ──────────────
//
// The "subscribe NOW" moment. The user pastes their Facebook Page URL,
// and in ~90 seconds the system has:
//   1. Scraped the page (uses the existing FB refresh-facts endpoint)
//   2. Classified the business archetype from the scraped content
//   3. Identified the top 3 brand reference photos by engagement
//   4. Extracted the voice fingerprint (top 5 captions by engagement)
//   5. Surfaced the 5 most common content topics from their post history
//
// The frontend shows this as a "Brand DNA Card" so the user sees what the
// system learned about them, BEFORE typing a single word into a form. The
// killer demo moment competitors don't close.
//
// Returns everything needed for the wizard to display the brand card AND
// for downstream gens to use the new context immediately.
//
// Body: { force?: boolean — bypass cache, re-derive everything }
app.post('/api/onboarding-magic', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `onboard-magic:${uid}`, 5)) {
    return c.json({ error: 'Rate limit exceeded — 5 magic-onboard calls per minute' }, 429);
  }
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

  // 1. Pull the workspace's user row + Facebook tokens
  const userRow = await c.env.DB.prepare(
    'SELECT id, email, social_tokens, profile FROM users WHERE id = ?'
  ).bind(uid).first<{ id: string; email: string | null; social_tokens: string | null; profile: string | null }>();

  if (!userRow?.social_tokens) {
    return c.json({ error: 'Facebook not connected — connect a Page first, then call /api/onboarding-magic' }, 400);
  }
  const tokens = JSON.parse(userRow.social_tokens);
  if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
    return c.json({ error: 'Facebook Page ID + access token missing — reconnect Facebook' }, 400);
  }

  // 2. Trigger fresh fact scrape (re-uses existing logic; idempotent)
  try {
    await refreshFactsForUser(c.env, uid, tokens.facebookPageId, tokens.facebookPageAccessToken, null);
  } catch (e: any) {
    console.warn(`[onboarding-magic] facts refresh failed for ${uid}:`, e?.message);
    // Continue anyway — maybe we have stale facts from a previous scrape
  }

  // 3. Pull the freshly-scraped facts
  const facts = await c.env.DB.prepare(
    `SELECT fact_type, content, metadata, engagement_score
     FROM client_facts
     WHERE user_id = ? AND client_id IS NULL
     ORDER BY engagement_score DESC, verified_at DESC
     LIMIT 100`
  ).bind(uid).all<{ fact_type: string; content: string; metadata: string; engagement_score: number }>();
  const allFacts = facts.results || [];

  // 4. Bucket the facts by type
  const ownPosts = allFacts.filter(f => f.fact_type === 'own_post').slice(0, 5);
  const photos = allFacts.filter(f => f.fact_type === 'photo').slice(0, 3);
  const about = allFacts.find(f => f.fact_type === 'about');
  const photoUrls = photos.map(p => {
    try { return JSON.parse(p.metadata).url; } catch { return null; }
  }).filter(Boolean);

  // 5. Use the existing classifier on the scraped content
  const profile = userRow.profile ? JSON.parse(userRow.profile) : {};
  const businessTypeFromFB = about?.content?.slice(0, 200) || '';
  const fingerprint = [
    profile.type && `Business type: ${profile.type}`,
    profile.description && `Description: ${profile.description}`,
    businessTypeFromFB && `From FB page about: ${businessTypeFromFB}`,
    ownPosts.length > 0 && `Recent posts:\n${ownPosts.map(p => `- ${p.content.slice(0, 200)}`).join('\n')}`,
  ].filter(Boolean).join('\n');

  // Route through the shared 3-layer classifier (keyword → Vectorize →
  // Haiku) so /api/onboarding-magic and /api/classify-business agree on
  // the verdict. Falls back to 'professional-services' when the
  // fingerprint is empty or the classifier errors — we MUST persist a slug
  // here so the first post after onboarding doesn't ship with NULL
  // archetype.
  let archetypeSlug = 'professional-services';
  let archetypeConfidence = 0.5;
  let archetypeReasoning = 'default fallback';
  let archetypePayload: {
    slug: string;
    name: string;
    description: string;
    voice_cues: string | null;
    content_pillars: string[];
    image_examples?: string[];
    image_avoid_notes?: string | null;
    banned_trope_extras?: string[] | null;
  } | null = null;

  if (fingerprint.trim()) {
    const result = await classifyArchetypeFromFingerprint(c.env, fingerprint);
    if ('chosen' in result) {
      archetypeSlug = result.chosen.slug;
      archetypeConfidence = result.chosen.confidence;
      archetypeReasoning = result.chosen.reasoning.slice(0, 300);
      archetypePayload = result.archetypePayload;
    } else {
      console.warn(`[onboarding-magic] classifier failed: ${result.error} — falling back to ${archetypeSlug}`);
    }
  } else {
    console.warn(`[onboarding-magic] empty fingerprint — falling back to ${archetypeSlug}`);
  }

  // Fallback path (empty fingerprint OR classifier error): load the
  // fallback archetype's payload directly so the response shape is
  // consistent with the happy path.
  if (!archetypePayload) {
    const fallback = await c.env.DB.prepare(
      `SELECT slug, name, description, image_examples, image_avoid_notes, voice_cues, content_pillars, banned_trope_extras FROM business_archetypes WHERE slug = ?`
    ).bind(archetypeSlug).first<ArchetypeRow>();
    if (fallback) {
      archetypePayload = {
        slug: fallback.slug,
        name: fallback.name,
        description: fallback.description,
        image_examples: JSON.parse(fallback.image_examples),
        image_avoid_notes: fallback.image_avoid_notes,
        voice_cues: fallback.voice_cues,
        content_pillars: JSON.parse(fallback.content_pillars),
        banned_trope_extras: fallback.banned_trope_extras ? JSON.parse(fallback.banned_trope_extras) : null,
      };
    }
  }

  // 6. Persist classifier verdict
  await c.env.DB.prepare(
    `UPDATE users SET archetype_slug = ?, archetype_confidence = ?, archetype_reasoning = ?, archetype_classified_at = ? WHERE id = ?`
  ).bind(archetypeSlug, archetypeConfidence, archetypeReasoning, new Date().toISOString(), uid).run();

  // 7. Build the Brand DNA Card payload
  const topTopics = Array.from(new Set(
    ownPosts.flatMap(p => p.content.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
      .filter(w => !/the|and|with|that|this|from|have|will|your/.test(w))
  )).slice(0, 5);

  return c.json({
    ok: true,
    archetype: {
      slug: archetypePayload?.slug ?? archetypeSlug,
      name: archetypePayload?.name ?? archetypeSlug,
      confidence: archetypeConfidence,
      reasoning: archetypeReasoning,
      content_pillars: archetypePayload?.content_pillars ?? [],
      voice_cues: archetypePayload?.voice_cues ?? null,
    },
    brand_dna: {
      voice_samples: ownPosts.map(p => ({ content: p.content.slice(0, 240), engagement: p.engagement_score })),
      reference_photos: photoUrls,
      common_topics: topTopics,
      about: about?.content?.slice(0, 400) || null,
    },
    stats: {
      posts_scraped: ownPosts.length,
      photos_available: photoUrls.length,
      total_facts: allFacts.length,
    },
  });
});


// ── Vision-grounded image+caption critique (2026-05 image-stack upgrade) ──
//
// After fal.ai returns an image, pass [image_url, caption, business_type]
// back to Haiku 4.5 (vision input) and ask: does this image match the post?
// Returns a score 0-10, a YES/PARTIAL/NO verdict, a short reasoning, and a
// regenerate boolean.
//
// This is the move that catches "food image on SaaS post" BEFORE it gets
// published — exactly the failure mode the user screenshotted today. At
// ~$0.003/image (1024² → ~1334 input tokens + ~150 output tokens on Haiku
// 4.5 vision) it's cheaper than a wasted FB impression.
//
// 99% of competing social-AI tools don't do this — they trust whatever FLUX
// hallucinated. This is the cutting-edge differentiator.
//
// Body: { imageUrl, caption, businessType?, archetype? }
// Returns: { score: 0-10, match: 'yes'|'partial'|'no', reasoning: string, regenerate: boolean }
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
// Body: { content: string, platform?: 'Facebook'|'Instagram', pillar?: string,
//         hashtags?: string[], clientId?: string|null }
// Returns: { score: 0-100, tier: 'low'|'mid'|'high'|'viral',
//            reasoning: string, suggestions: string[] }
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

// ── fal.ai Proxy (query-param based — matches Pages Function pattern) ────────
app.all('/api/fal-proxy', async (c) => {
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 401);

  // AUTH GATE — fal.ai is paid per-image/video; never let it run anonymous.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  // RATE LIMIT — 20 fal.ai calls per minute per user (images are the dominant cost).
  if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

  const url = new URL(c.req.url);
  const action = url.searchParams.get('action');
  const authHeader = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };

  if (action === 'generate-image' && c.req.method === 'POST') {
    const { prompt, negativePrompt, clientId, forceModel } = await c.req.json() as {
      prompt?: string;
      negativePrompt?: string;
      clientId?: string | null;
      // forceModel: optional override for testing/UX. Acceptable values:
      //   'flux-dev'           — original cheap baseline (no brand refs)
      //   'flux-pro-kontext'   — brand-grounded ($0.04/img, max 4 refs)
      //   'nano-banana-pro'    — premium brand-grounded ($0.15/img, max 14 refs)
      forceModel?: 'flux-dev' | 'flux-pro-kontext' | 'nano-banana-pro';
    };
    if (!prompt) return c.json({ error: 'prompt is required' }, 400);
    if (!/candid iPhone/i.test(prompt)) {
      console.warn(`[fal-proxy] generate-image prompt missing safety marker — uid=${uid}, prompt prefix="${prompt.substring(0, 80)}"`);
    }

    // ── 2026-05 Brand-grounded image generation ──
    //
    // Pull the user's top scraped Facebook photos from client_facts as
    // reference images. FLUX Pro Kontext (and Nano Banana Pro on the
    // premium path) reads these to maintain BRAND consistency — the
    // generated image will share lighting, colour palette, and composition
    // style with their real existing photos, NOT generic stock aesthetic.
    //
    // Falls back to plain FLUX-dev if no photos are scraped yet — preserves
    // behaviour for fresh workspaces / agency clients without an FB
    // connection. This is the move that fixes "every customer's generated
    // image looks identical because every customer gets FLUX-dev defaults".
    let referenceImageUrls: string[] = [];
    try {
      const photoRows = await c.env.DB.prepare(
        `SELECT metadata FROM client_facts
         WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'photo'
         ORDER BY engagement_score DESC, verified_at DESC
         LIMIT 4`
      ).bind(uid, clientId || '').all<{ metadata: string }>();
      for (const row of photoRows.results || []) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          if (meta?.url && typeof meta.url === 'string') referenceImageUrls.push(meta.url);
        } catch { /* skip bad row */ }
      }
    } catch (e) {
      console.warn(`[fal-proxy] brand-ref fetch failed (continuing without refs):`, e);
    }

    // ── Route selection ──
    // Default routing — choose strategy based on what data we have AND
    // the optional forceModel override. Premium tier customers can flip
    // to nano-banana-pro by passing forceModel; the proxy gates that
    // path on plan but for now any auth'd user can request it.
    const model = forceModel
      ?? (referenceImageUrls.length > 0 ? 'flux-pro-kontext' : 'flux-dev');

    let res: Response;
    if (model === 'nano-banana-pro' && referenceImageUrls.length > 0) {
      // Premium path: Nano Banana Pro (Gemini 3 Pro Image) — up to 14 refs,
      // $0.15/image, best brand consistency + text rendering on the market
      // as of Q4 2025. Endpoint: fal-ai/gemini-3-pro-image-preview.
      res = await fetch('https://fal.run/fal-ai/gemini-3-pro-image-preview', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          prompt,
          image_urls: referenceImageUrls.slice(0, 14),
          aspect_ratio: '1:1',
          num_images: 1,
        }),
      });
    } else if (model === 'flux-pro-kontext' && referenceImageUrls.length > 0) {
      // Default brand-grounded path: FLUX Pro Kontext — up to 4 refs,
      // $0.04/image, drop-in brand consistency without LoRA training.
      res = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          prompt,
          image_urls: referenceImageUrls.slice(0, 4),
          aspect_ratio: '1:1',
          num_images: 1,
          guidance_scale: 3.5,
        }),
      });
    } else {
      // Baseline path: plain FLUX-dev (no references available). Preserves
      // existing behaviour for fresh workspaces. negative_prompt is the
      // canonical FLUX_NEGATIVE_PROMPT — guidance_scale 5 ensures it sticks.
      res = await fetch('https://fal.run/fal-ai/flux/dev', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt || FLUX_NEGATIVE_PROMPT,
          image_size: 'square_hd',
          num_inference_steps: 28,
          num_images: 1,
          enable_safety_checker: true,
          guidance_scale: 5.0,
        }),
      });
    }
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
    const imageUrl = data?.images?.[0]?.url || null;
    // Surface which strategy was actually used so the client can show a
    // "brand-grounded ✓" badge in the UI and admins can audit cost.
    return c.json({ imageUrl, model_used: model, references_used: referenceImageUrls.length });
  }
  if (action === 'generate-video' && c.req.method === 'POST') {
    const { promptText, promptImage, duration = 5 } = await c.req.json() as any;
    if (!promptImage) return c.json({ error: 'promptImage is required' }, 400);
    const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
      method: 'POST', headers: authHeader,
      body: JSON.stringify({ prompt: promptText || 'cinematic, smooth motion', image_url: promptImage, duration: String(duration), aspect_ratio: '9:16' }),
    });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
    return c.json({ requestId: data.request_id, statusUrl: data.status_url || null, responseUrl: data.response_url || null });
  }
  if (action === 'task-status') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    // Use the fal queue URL format returned by generate-video (without version/model path)
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'task-result') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'get-credits') {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    return c.json({ balance: data?.balance ?? data?.credits ?? null });
  }
  if (action === 'check-credits-alert') {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    const balance = data?.balance ?? data?.credits ?? null;
    const threshold = 5;
    const resendKey = c.env.RESEND_API_KEY;
    if (balance !== null && balance < threshold && resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'SocialAI Studio <noreply@socialaistudio.au>',
          to: 'steve@3dhub.au',
          subject: `fal.ai Credits Low — $${typeof balance === 'number' ? balance.toFixed(2) : balance} remaining`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out. Top up now to keep your posts looking great.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a><p style="color:#888;font-size:12px;margin-top:20px;">This alert triggers when balance drops below $${threshold}.</p></div>`,
        }),
      });
      return c.json({ balance, alert: 'sent', threshold });
    }
    return c.json({ balance, alert: balance !== null && balance < threshold ? 'no_resend_key' : 'not_needed', threshold });
  }
  return c.json({ error: `Unknown action: ${action}` }, 400);
});

// ── fal.ai Proxy (path-based passthrough) ───────────────────────────────────
app.all('/api/fal-proxy/*', async (c) => {
  // AUTH GATE — required to use the proxied fal.ai endpoint with our key.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

  const path = c.req.path.replace('/api/fal-proxy', '');
  const url = `https://api.fal.ai${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;

  // Server uses its own key; ignore client-supplied keys to prevent abuse.
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 500);

  const headers = { 
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return c.json(data as any, { status: res.status as any });
  }
  const text = await res.text();
  return c.body(text, { status: res.status as any });
});

// ── Runway Proxy ───────────────────────────────────────────────────────────────
app.all('/api/runway-proxy/*', async (c) => {
  const path = c.req.path.replace('/api/runway-proxy', '');
  const url = `https://api.runwayml.com/v1${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;
  
  // Get key from Authorization header or fallback to env var
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '') || c.env.RUNWAY_API_KEY;
  if (!apiKey) return c.json({ error: 'Runway API key required' }, 401);

  const headers = { 
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return c.json(data as any, { status: res.status as any });
  }
  const text = await res.text();
  return c.body(text, { status: res.status as any });
});


// ── Cron Triggers ────────────────────────────────────────────────────────────
// */5 * * * *  → missed post publisher (every 5 min)
// 0 3 * * *   → token refresh (daily at 3am UTC)
// 0 */6 * * * → fal.ai credit check (every 6 hours)

// Wrap a cron function with try/catch + duration tracking + cron_runs logging.
// Returns void; never throws (so a failure in one cron doesn't kill the worker).
async function trackCron(
  env: Env,
  cronType: string,
  fn: () => Promise<{ posts_processed?: number } | void>,
): Promise<void> {
  const start = Date.now();
  let success = 1;
  let posts = 0;
  let error: string | null = null;
  try {
    const result = await fn();
    posts = result?.posts_processed ?? 0;
  } catch (e: any) {
    success = 0;
    error = (e?.message || String(e)).slice(0, 1000);
    console.error(`[CRON ${cronType}] FAILED:`, error);
  }
  const duration = Date.now() - start;
  try {
    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms)
       VALUES (?,?,?,?,?)`
    ).bind(cronType, success, posts, error, duration).run();
  } catch (logErr: any) {
    console.error(`[CRON ${cronType}] Failed to log run:`, logErr?.message);
  }
}

// (cronWeeklyReview lives in ./cron/weekly-review.ts as of Phase B step 10)

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const cron = event.cron;
    if (cron === '*/5 * * * *') {
      await trackCron(env, 'prewarm_images', () => cronPrewarmImages(env));
      await trackCron(env, 'prewarm_videos', () => cronPrewarmVideos(env));
      await trackCron(env, 'publish', () => cronPublishMissedPosts(env));
      return;
    }
    if (cron === '0 3 * * *') {
      await trackCron(env, 'token_refresh', () => cronRefreshTokens(env));
      return;
    }
    if (cron === '0 4 * * *') {
      await trackCron(env, 'facts_refresh', () => cronRefreshFacts(env));
      return;
    }
    // Monday 7am AEST (Sunday 21:00 UTC) — Autonomous Weekly Review.
    // For each workspace with FB connected, analyse last 7 days' performance
    // and send a Monday recap email with a CTA to approve next week's posts.
    if (cron === '0 21 * * 0') {
      await trackCron(env, 'weekly_review', () => cronWeeklyReview(env));
      return;
    }
    // Fallback for 6-hourly credit check and any unmatched triggers
    await trackCron(env, 'prewarm_fallback', () => cronPrewarmImages(env));
    await trackCron(env, 'prewarm_videos_fallback', () => cronPrewarmVideos(env));
    await trackCron(env, 'publish_fallback', () => cronPublishMissedPosts(env));
    await trackCron(env, 'fal_credits', () => cronCheckFalCredits(env));
  },
};
