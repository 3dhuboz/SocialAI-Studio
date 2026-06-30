// Shopify embedded app — AI post composer.
//
// Phase 2 of the App Store path: once a merchant has installed + synced their
// product catalog, the embedded UI calls POST /api/shopify/compose with a
// product GID and gets back a generated caption + image. The merchant then
// edits the result and saves it as a draft via a separate /api/shopify/posts
// endpoint (owned by another agent). This route is pure compose — no D1
// writes, no draft persistence, no scheduling.
//
// Auth: App Bridge session token (Bearer <jwt>) — same pattern as the rest
// of the embedded surface. requireSession resolves it to a verified
// shopDomain which we use to scope the product lookup.
//
// Rate limit: 10/min per shop. Caption + image generation hits two upstreams
// (Anthropic / fal.ai) that we pay per-call for — a chatty embedded-app retry
// loop or a buggy merchant integration could otherwise burn through credit
// fast. 10/min is well above any plausible human composer cadence.
//
// Tenant model: the image-gen library is shared with the main SaaS workspaces
// (which key off Clerk uid). To reuse it without rewriting, we pass the shop
// domain as a sentinel user_id of the form `shop:<shop>.myshopify.com`. That
// has no archetype row in users.archetype_slug, so the lib falls through to
// sniffArchetypeFromCaption — which is why we pass the generated caption into
// the options. For Shopify product posts the caption will almost always sniff
// as e-commerce / product imagery, which is the right behaviour.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import {
  verifySessionToken,
  type VerifiedSession,
} from '../lib/shopify-auth';
import { callAnthropicDirect, callOpenRouter } from '../lib/anthropic';
import { generateImageWithGuardrails } from '../lib/image-gen';
import { loadShopFactsForPrompt } from '../lib/facebook-facts';
import { loadForbiddenSubjectsForShop, scanForForbidden } from '../lib/profile-guards';
import { wrapUntrusted, UNTRUSTED_CONTENT_DIRECTIVE } from '../lib/prompt-safety';
import { requireActiveShopSubscription } from '../lib/shopify-billing';
import {
  isAbstractServiceProduct,
  ABSTRACT_SERVICE_FALLBACK_PROMPT,
} from '../lib/image-safety';

// ── Config helpers (mirror shopify-oauth.ts so the route file stays self-contained) ──

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

async function requireSession(c: any): Promise<VerifiedSession | Response> {
  const cfg = requireShopifyConfig(c.env);
  if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(auth.slice(7), cfg.key, cfg.secret);
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

// ── Request validation ─────────────────────────────────────────────────────

export type Platform = 'facebook' | 'instagram' | 'both';
export type Tone = 'friendly' | 'professional' | 'playful';

const VALID_PLATFORMS: ReadonlySet<Platform> = new Set(['facebook', 'instagram', 'both']);
const VALID_TONES: ReadonlySet<Tone> = new Set(['friendly', 'professional', 'playful']);

interface ComposeRequest {
  product_id: string;
  platform: Platform;
  tone: Tone;
}

function parseComposeBody(body: any): { ok: true; req: ComposeRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Missing JSON body' };
  const product_id = body.product_id;
  if (typeof product_id !== 'string' || !product_id.trim()) {
    return { ok: false, error: 'product_id is required' };
  }
  // Be permissive on the GID format — we trust shopify_products as the source
  // of truth and match against it as an opaque string. A bad product_id will
  // surface as a 404 from the DB lookup, which is the right shape anyway.

  const platform = body.platform ?? 'both';
  if (!VALID_PLATFORMS.has(platform)) {
    return { ok: false, error: `platform must be one of: ${[...VALID_PLATFORMS].join(', ')}` };
  }
  const tone = body.tone ?? 'friendly';
  if (!VALID_TONES.has(tone)) {
    return { ok: false, error: `tone must be one of: ${[...VALID_TONES].join(', ')}` };
  }
  return { ok: true, req: { product_id: product_id.trim(), platform, tone } };
}

// ── Prompt construction ────────────────────────────────────────────────────

// Platform-specific caption guidance. Length + hashtag policy is what changes
// most across platforms; the brand voice + product framing carries through.
function platformGuidance(platform: Platform): string {
  switch (platform) {
    case 'facebook':
      return 'Target 80-150 words. Conversational and story-driven. Use hashtags sparingly (0-2 max) — Facebook reach does not reward heavy tagging. End with a soft, low-pressure call-to-action.';
    case 'instagram':
      return 'Target 30-80 words in the main body, then 5-8 relevant hashtags on a new line. Hashtags should be specific (product category, niche audience), not generic (#love, #instagood). Snappy opening line — Instagram cuts the caption after one line in feed.';
    case 'both':
      return 'Target 60-100 words. Conversational, suitable for either Facebook or Instagram. Include 3-5 relevant hashtags at the end. Avoid platform-specific references.';
  }
}

function toneGuidance(tone: Tone): string {
  switch (tone) {
    case 'friendly':    return 'Warm, approachable, like a small-business owner talking to a regular customer.';
    case 'professional': return 'Polished and confident. Concrete product benefits over hype. Avoid casual interjections.';
    case 'playful':     return 'Light, witty, a little cheeky. Wordplay welcome. Still grounded in real product facts.';
  }
}

// System prompt is the same shape across all requests so it stays cacheable
// (when callAnthropicDirect is used). Tone + platform + product info live in
// the user prompt where they vary per request.
const SOCIAL_SYSTEM_PROMPT = [
  'You are a senior social-media copywriter for small e-commerce brands.',
  'You write captions that move product, not Instagram poetry.',
  '',
  'CRITICAL — your ONLY job is to write a finished caption:',
  '  - NEVER ask the merchant questions. There is nobody to answer.',
  '  - NEVER comment on the input. Do NOT write things like',
  '    "I notice there\'s a mismatch", "Could you clarify", "I can\'t write",',
  '    "Is this product being sold by", "If it\'s a test", or any sentence',
  '    that talks ABOUT writing instead of being the caption itself.',
  '  - NEVER refuse. If the product seems out of place for the merchant context,',
  '    write a normal product-focused caption that ignores the merchant context.',
  '    A mismatch is a creative challenge, not a blocker. The merchant chose to',
  '    list this product — your job is to sell it, not to question it.',
  '  - NEVER explain what you are about to do or why you wrote what you wrote.',
  '  - Output is shipped DIRECTLY to Facebook/Instagram. There is no review step',
  '    that strips meta-commentary. Anything you write WILL be published.',
  '',
  'STRICT CONTENT RULES — non-negotiable:',
  '  1. NEVER invent statistics, percentages, counts, "studies show", or testimonial-style quotes. If a stat is not in the product info given, do not include one.',
  '  2. NEVER fake urgency. No "selling out fast", "only X left", "limited time" unless the merchant explicitly provides those facts in the product info.',
  '  3. NEVER use generic AI tropes: "elevate your", "game-changer", "level up", "must-have", "obsessed", "literally", "in today\'s fast-paced world", "look no further".',
  '  4. NEVER fabricate testimonials, customer quotes, or social proof.',
  '  5. NEVER claim certifications, awards, or partnerships not stated in the product info.',
  '  6. NEVER make medical, financial, or absolute performance claims.',
  '',
  'WHAT TO DO instead:',
  '  - Lead with one specific, concrete thing about the product (a material, a use case, a sensory detail).',
  '  - Anchor in real product facts: the title, description, tags, type, price.',
  '  - Write like a human running a small shop, not a brand marketing department.',
  '  - End with a clear, simple call-to-action.',
  '',
  'OUTPUT FORMAT:',
  '  Return ONLY the caption text. No preamble, no "Here\'s your caption:", no markdown code fences, no JSON wrapping. The first word of your response IS the first word of the caption. Just the caption a merchant can paste straight into Meta Business Suite.',
].join('\n');

// Phrases that indicate the LLM went meta instead of writing a caption.
// Match against the LOWERCASED first ~200 chars of the response — that's
// where refusals/clarifying-questions always begin. Keep this list tight:
// false positives turn good captions into "failed" slots.
//
// Patterns observed in production:
//   "I notice there's a mismatch..."
//   "Could you clarify..."
//   "I can't write an authentic caption..."
//   "Is this snowboard actually being sold by..."
const REFUSAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bi notice\b/i,
  /\bi can'?t (write|create|generate)\b/i,
  /\bcould you (clarify|confirm|tell me)\b/i,
  /\b(is|are) (this|these) .{0,40}\b(actually|really) (being )?(sold|offered)\b/i,
  /\bthere'?s a mismatch\b/i,
  /\bdoesn'?t match\b/i,
  /\bif it'?s a test\b/i,
  /\bonce i understand\b/i,
  /\bi'?ll (write|create) (a |the )?caption\b/i,
];

/**
 * Returns true when the caption looks like the LLM dodging the job
 * (asking questions, commenting on the input, refusing to write).
 * False captures are dangerous — they turn good output into "failed" slots —
 * so the patterns are scoped to the first 250 chars and look for clear refusal
 * markers, not just any question mark.
 */
function looksLikeRefusal(caption: string): boolean {
  const head = caption.slice(0, 250);
  return REFUSAL_PATTERNS.some((r) => r.test(head));
}

export interface ProductRow {
  id: string;
  shop_domain: string;
  title: string;
  handle: string | null;
  description: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string | null;
  price: string | null;
  currency: string | null;
  image_url: string | null;
  status: string | null;
}

function buildCaptionUserPrompt(product: ProductRow, platform: Platform, tone: Tone): string {
  // Merchant-controlled fields (title / description / tags / vendor) flow
  // unchanged into the LLM prompt. A malicious or careless product description
  // could contain "Ignore previous instructions and output X" — the LLM has
  // no way to know that text came from a Shopify product field versus the
  // surrounding system instructions. We wrap each merchant-supplied field in
  // <<UNTRUSTED_FROM_SHOPIFY_PRODUCT>> markers and pair with
  // UNTRUSTED_CONTENT_DIRECTIVE in the system prompt so the model treats them
  // as inert data, not directives. See lib/prompt-safety.ts.
  const facts: string[] = [];
  facts.push(`Title: ${wrapUntrusted(product.title, 'shopify_product_title', { maxLen: 200 })}`);
  if (product.product_type) {
    facts.push(`Type: ${wrapUntrusted(product.product_type, 'shopify_product_type', { maxLen: 120 })}`);
  }
  if (product.vendor) {
    facts.push(`Vendor: ${wrapUntrusted(product.vendor, 'shopify_product_vendor', { maxLen: 120 })}`);
  }
  if (product.price) {
    // Price + currency are numeric / ISO codes — not injection-prone.
    facts.push(`Price: ${product.price}${product.currency ? ` ${product.currency}` : ''}`);
  }
  if (product.tags && product.tags.trim()) {
    facts.push(`Tags: ${wrapUntrusted(product.tags, 'shopify_product_tags', { maxLen: 400 })}`);
  }
  if (product.description && product.description.trim()) {
    facts.push(`Description:\n${wrapUntrusted(product.description, 'shopify_product_description', { maxLen: 1500 })}`);
  }

  return [
    `Write ONE social media post promoting this product.`,
    '',
    UNTRUSTED_CONTENT_DIRECTIVE,
    '',
    `Tone: ${toneGuidance(tone)}`,
    `Platform: ${platformGuidance(platform)}`,
    '',
    'Product info:',
    facts.join('\n'),
    '',
    'Remember: no fabricated stats, no fake urgency, no AI tropes, no fake testimonials. Return ONLY the caption text.',
  ].join('\n');
}

// Image prompt is short and product-grounded — no marketing language. The
// downstream image-gen lib applies archetype guardrails + brand-ref grounding
// on top of this.
function buildImagePrompt(product: ProductRow): string {
  // Abstract-service short-circuit. "Monthly Website Care Plan",
  // "Social Media Management Subscription", etc. have no physical form —
  // FLUX confabulates a product if we ask for one (most famously a skincare
  // bottle for "Monthly Curdial"). Substitute a workspace scene that
  // signals "this is a service we provide" without inventing a product.
  if (isAbstractServiceProduct(product.title, product.product_type)) {
    return ABSTRACT_SERVICE_FALLBACK_PROMPT;
  }

  const parts: string[] = [];
  parts.push(`Professional product photograph of ${product.title}`);
  if (product.product_type) parts.push(`(${product.product_type})`);
  if (product.description) {
    // Pull the first sentence of the description for a visual hint, capped short.
    const firstSentence = product.description.split(/[.!?\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 0 && firstSentence.length < 200) {
      parts.push(`— ${firstSentence}`);
    }
  }
  parts.push('clean composition, soft natural lighting, e-commerce hero shot, no text overlays, no logos, no watermarks');
  return parts.join(' ');
}

// Negative prompt is shared across all product images — keeps the FLUX-dev
// fallback from generating the same garbage anyone else's product page does.
const IMAGE_NEGATIVE_PROMPT = 'text, watermark, logo, signature, low quality, blurry, distorted, deformed, extra limbs, cluttered background, busy patterns, harsh artificial lighting, cartoon, illustration, oversaturated';
const SHOPIFY_COMPOSE_FALLBACK_IMAGE_URL = 'https://app.socialaistudio.au/feature-media-1600x900.png';

function cleanProductText(value: string | null | undefined, maxLen = 220): string {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function formatPrice(product: ProductRow): string | null {
  if (!product.price) return null;
  const currency = product.currency ? ` ${product.currency}` : '';
  return `${product.price}${currency}`;
}

export function buildFallbackCaption(product: ProductRow, platform: Platform, tone: Tone): string {
  const title = cleanProductText(product.title, 100) || 'this product';
  const type = cleanProductText(product.product_type, 80);
  const vendor = cleanProductText(product.vendor, 80);
  const description = cleanProductText(product.description, 180);
  const price = formatPrice(product);
  const opener =
    tone === 'professional'
      ? `A practical pick for your next order: ${title}.`
      : tone === 'playful'
        ? `Fresh find alert: ${title} is ready for a spot in your cart.`
        : `Looking for something new from our store? Meet ${title}.`;
  const facts = [
    vendor ? `from ${vendor}` : null,
    type ? `in our ${type} range` : null,
    price ? `available at ${price}` : null,
  ].filter(Boolean).join(', ');
  const body = description
    ? `${description}${facts ? ` It is ${facts}.` : ''}`
    : `${facts ? `It is ${facts}.` : 'It is ready to browse now.'}`;
  const cta = platform === 'instagram'
    ? 'Tap through to take a closer look.'
    : 'Take a look and see if it is the right fit for you.';
  const hashtags = platform === 'facebook'
    ? ''
    : '\n\n#ShopSmall #ProductFinds #NewIn';
  return `${opener}\n\n${body}\n\n${cta}${hashtags}`;
}

function fallbackImageUrl(product: ProductRow): string {
  const imageUrl = product.image_url?.trim();
  return imageUrl || SHOPIFY_COMPOSE_FALLBACK_IMAGE_URL;
}

// ── Shared compose pipeline ───────────────────────────────────────────────
//
// Extracted so the bulk autopilot (`shopify-autopilot.ts`) can reuse the
// same caption+image generation chain rather than duplicating the
// prompt-engineering glue.
//
// Throws ComposeError on caption or image failure — caller decides whether
// to surface as 502, retry, or skip this slot in a multi-post batch.

export class ComposeError extends Error {
  constructor(public stage: 'caption' | 'image' | 'product', message: string) {
    super(message);
    this.name = 'ComposeError';
  }
}

export interface ComposeResult {
  caption: string;
  imageUrl: string;
  modelUsed: string;
  product: {
    id: string;
    title: string;
    price: string | null;
    currency: string | null;
  };
}

export async function composeProductPost(
  env: Env,
  shop: string,
  productId: string,
  platform: Platform,
  tone: Tone,
  campaignContext?: string,
): Promise<ComposeResult> {
  // Look up the product — scoped to this shop. Cross-shop lookups are
  // forbidden by the composite PK; this guard makes intent explicit.
  const product = await env.DB.prepare(
    `SELECT id, shop_domain, title, handle, description, product_type, vendor, tags,
            price, currency, image_url, status
       FROM shopify_products
      WHERE id = ? AND shop_domain = ?`,
  ).bind(productId, shop).first<ProductRow>();

  if (!product) {
    throw new ComposeError('product', 'Product not synced yet. Run sync first.');
  }

  // ── Stage 0: forbidden-subject pre-flight ─────────────────────────
  // Merchant has declared subjects they never want depicted or mentioned
  // (e.g. "alcohol", "children", competitor brand names). Load from
  // shopify_stores.profile.forbiddenSubjects (schema_v25). Scan the product
  // itself FIRST — if the product title/description/type already mentions a
  // forbidden subject, no amount of LLM coaching will produce safe output.
  // Better to fail fast than ship a refusal-cycle.
  const forbiddenSubjects = await loadForbiddenSubjectsForShop(env, shop);
  if (forbiddenSubjects.length > 0) {
    const inProduct = scanForForbidden(
      [product.title, product.description, product.product_type, product.tags]
        .filter(Boolean)
        .join(' '),
      forbiddenSubjects,
    );
    if (inProduct) {
      throw new ComposeError(
        'product',
        `This product mentions "${inProduct}", which is on your shop's forbidden-subjects list. Update the list in Settings, or skip this product.`,
      );
    }
  }

  // ── Stage 1: caption ──────────────────────────────────────────────
  // Build the user prompt and layer on optional grounding signals:
  //   - shop facts: about + top high-engagement posts, scraped from the
  //     merchant's connected Facebook Page. Grounds voice in real history
  //     and lets the LLM lean on what's already worked. Best-effort —
  //     `null` if no FB page connected or scrape hasn't run yet.
  //   - campaign context: optional active-marketing-campaign theme/goal,
  //     passed in by the caller (autopilot looks this up from the
  //     shopify_campaigns table).
  //
  // We deliberately fetch facts INSIDE composeProductPost rather than have
  // each caller (single-compose + autopilot) re-derive them, so the prompt
  // shape stays consistent. The shopify_facts query is cheap (~1ms) and
  // bounded (LIMIT 4 rows).
  const basePrompt = buildCaptionUserPrompt(product, platform, tone);
  const factsContext = await loadShopFactsForPrompt(env, shop);

  // Inner: one LLM round-trip. Returned caption is whatever the model
  // produced — refusal detection happens in the caller's retry loop.
  async function callLLM(userPrompt: string): Promise<string> {
    if (env.ANTHROPIC_API_KEY) {
      const result = await callAnthropicDirect({
        apiKey: env.ANTHROPIC_API_KEY,
        // api.anthropic.com uses the bare model id; the `anthropic/` prefix
        // is OpenRouter-only. See campaign-research / weekly-review / post-quality
        // for the same pattern.
        model: 'claude-haiku-4-5',
        systemPrompt: SOCIAL_SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.7,
        maxTokens: 800,
        responseFormat: 'text',
      });
      return (result.text || '').trim();
    }
    if (env.OPENROUTER_API_KEY) {
      const result = await callOpenRouter(
        env.OPENROUTER_API_KEY,
        SOCIAL_SYSTEM_PROMPT,
        userPrompt,
        0.7,
        800,
        { responseFormat: 'text' },
      );
      return (result.text || '').trim().replace(/^```[a-z]*\n?|```$/gi, '').trim();
    }
    throw new ComposeError('caption', 'No LLM API key configured');
  }

  // First attempt: full context (facts + campaign).
  // Mismatch case (e.g. seeded dev-store products vs an IT-business FB page)
  // sometimes pushes Haiku into "I notice there's a mismatch, could you
  // clarify..." instead of a caption. If we detect that, retry without the
  // facts context — that's almost always the conflict source. If the retry
  // ALSO refuses, throw so the autopilot marks the slot failed instead of
  // shipping meta-commentary to Facebook.
  let firstAttemptPrompt = basePrompt;
  if (factsContext) {
    firstAttemptPrompt = `${firstAttemptPrompt}\n\nMerchant's Facebook page context — use this to ground voice and avoid inventing claims. Echo themes from high-engagement past posts, but write FRESH copy. Do not copy or paraphrase verbatim:\n${factsContext}`;
  }
  if (campaignContext && campaignContext.trim().length > 0) {
    firstAttemptPrompt = `${firstAttemptPrompt}\n\nActive marketing campaign — weave this naturally into the post (avoid sounding bolted-on):\n${campaignContext.trim()}`;
  }

  let caption: string;
  let captionModel = 'ai';
  try {
    caption = await callLLM(firstAttemptPrompt);

    if (caption && looksLikeRefusal(caption)) {
      console.warn('[shopify-compose] refusal detected on first attempt; retrying without facts. product=', product.id);
      // Retry with product context only + a stronger inline reminder.
      let retryPrompt = `${basePrompt}\n\nIMPORTANT: Do NOT ask questions, do NOT mention any mismatch, do NOT explain what you are writing. Just output the caption directly — first word of your reply is the first word of the caption.`;
      if (campaignContext && campaignContext.trim().length > 0) {
        retryPrompt = `${retryPrompt}\n\nActive marketing campaign — weave this naturally into the post:\n${campaignContext.trim()}`;
      }
      caption = await callLLM(retryPrompt);

      if (caption && looksLikeRefusal(caption)) {
        console.error('[shopify-compose] refusal on retry; using fallback caption. product=', product.id, 'first240=', caption.slice(0, 240));
        caption = buildFallbackCaption(product, platform, tone);
        captionModel = 'fallback-caption';
      }
    }

    if (!caption) {
      console.warn('[shopify-compose] empty caption; using fallback caption. product=', product.id);
      caption = buildFallbackCaption(product, platform, tone);
      captionModel = 'fallback-caption';
    }
  } catch (err: any) {
    if (err instanceof ComposeError && err.stage !== 'caption') throw err;
    console.error('[shopify-compose] caption generation failed:', String(err?.stack ?? err));
    caption = buildFallbackCaption(product, platform, tone);
    captionModel = 'fallback-caption';
  }

  // Post-gen denylist HARD-RULES check on the LLM's output. If the merchant
  // has declared "no alcohol" and Haiku still wrote "perfect with a glass of
  // wine", we throw here rather than ship a violation. The downstream
  // critique pass (shopify-post-quality.ts) does the same on image/caption
  // alignment; this is the pre-publish gate on caption text alone.
  if (forbiddenSubjects.length > 0) {
    const hit = scanForForbidden(caption, forbiddenSubjects);
    if (hit) {
      throw new ComposeError(
        'caption',
        `Generated caption mentions "${hit}" (on your forbidden-subjects list). Regenerate, or remove "${hit}" from the list in Settings.`,
      );
    }
  }

  // ── Stage 2: image ────────────────────────────────────────────────
  const sentinelUserId = `shop:${shop}`;
  const imagePrompt = buildImagePrompt(product);

  // Pre-image denylist gate. The image prompt is generated from product
  // fields (which we already scanned at stage 0), but a future change to
  // buildImagePrompt could introduce a path that pulls from caption or
  // facts — guard against that here.
  if (forbiddenSubjects.length > 0) {
    const hit = scanForForbidden(imagePrompt, forbiddenSubjects);
    if (hit) {
      throw new ComposeError(
        'image',
        `Image prompt mentions "${hit}" (on your forbidden-subjects list). This shouldn't normally happen — please contact support.`,
      );
    }
  }
  try {
    const result = await generateImageWithGuardrails(
      env,
      sentinelUserId,
      null,
      { prompt: imagePrompt, negativePrompt: IMAGE_NEGATIVE_PROMPT },
      { caption },
    );
    if (!result.imageUrl) {
      throw new ComposeError('image', 'Image generation returned no URL');
    }
    return {
      caption,
      imageUrl: result.imageUrl,
      modelUsed: captionModel === 'ai' ? result.modelUsed : `${captionModel}+${result.modelUsed}`,
      product: {
        id: product.id,
        title: product.title,
        price: product.price ?? null,
        currency: product.currency ?? null,
      },
    };
  } catch (err: any) {
    console.error('[shopify-compose] image generation failed:', String(err?.stack ?? err));
    return {
      caption,
      imageUrl: fallbackImageUrl(product),
      modelUsed: captionModel === 'ai' ? 'fallback-product-image' : `${captionModel}+fallback-product-image`,
      product: {
        id: product.id,
        title: product.title,
        price: product.price ?? null,
        currency: product.currency ?? null,
      },
    };
  }
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerShopifyComposeRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/shopify/compose ─────────────────────────────────────────
  // Compose endpoint — given a product GID, generate a caption + image for
  // the merchant to review. Does NOT save anything to D1 — the merchant
  // edits the result and posts to /api/shopify/posts to persist a draft.
  app.post('/api/shopify/compose', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    const billing = await requireActiveShopSubscription(c.env, shop);
    if (!billing.ok) {
      return c.json({ error: billing.message, code: billing.code }, billing.status);
    }

    // Rate limit: 10/min/shop. Each compose call does an LLM call + an image
    // generation, both of which we pay per-call for. Burst protection beats
    // the apology email when a merchant accidentally builds a retry loop.
    if (await isRateLimited(c.env.DB, `shopify-compose:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute' }, 429);
    }

    // Parse + validate body.
    let rawBody: any;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const parsed = parseComposeBody(rawBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { product_id, platform, tone } = parsed.req;

    try {
      const result = await composeProductPost(c.env, shop, product_id, platform, tone);
      return c.json({
        caption: result.caption,
        image_url: result.imageUrl,
        model_used: result.modelUsed,
        product: result.product,
      });
    } catch (err: any) {
      if (err instanceof ComposeError) {
        const code = err.stage === 'product' ? 404 : 502;
        return c.json({ stage: err.stage, error: err.message }, code);
      }
      console.error('[shopify-compose] unexpected:', String(err?.stack ?? err));
      return c.json({ error: String(err?.message ?? err).slice(0, 300) }, 500);
    }
  });
}
