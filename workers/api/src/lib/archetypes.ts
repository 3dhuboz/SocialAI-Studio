// Archetype resolution + classification helpers.
//
// Extracted from src/index.ts as Phase B step 6 of the route-module split
// (see WORKER_SPLIT_PLAN.md). Three concerns grouped here:
//
//   1. resolveArchetypeSlug — given (userId, clientId), return the
//      correct archetype slug. Prefers clients.archetype_slug when set
//      (schema v9 — per-client archetype for agency users), falls back
//      to users.archetype_slug otherwise.
//
//   2. classifyArchetypeFromFingerprint — three-layer classifier
//      (keyword → Vectorize → Haiku 4.5). Used by both /api/classify-
//      business and /api/clients/:id/classify-business as their shared
//      core. Returns either a verdict or a forward-able error.
//
//   3. classifyViaVectorize — Layer 0.5 of the classifier. Embeds the
//      business fingerprint with bge-base-en-v1.5 and queries the
//      archetypes index. Returns null if bindings aren't configured.
//
// Plus the ArchetypeRow type for the business_archetypes table.

import type { Env } from '../env';

export interface ArchetypeRow {
  slug: string;
  name: string;
  description: string;
  keywords: string;
  image_examples: string;
  image_avoid_notes: string | null;
  voice_cues: string | null;
  content_pillars: string;
  banned_trope_extras: string | null;
}

// Resolve the archetype slug for a post given its (userId, clientId).
// Schema v9 adds clients.archetype_slug so agency users running multiple
// client workspaces get the RIGHT archetype per post — previously a
// tech-saas-agency owner running a food client's account had tech
// guardrails applied to food posts.
//
// Resolution order:
//   1. If clientId set AND clients.archetype_slug populated → that wins
//   2. Otherwise fall back to users.archetype_slug
//
// One DB read per call (two when clientId set and the lookup misses).
// Safe to call from cron hot paths.
export async function resolveArchetypeSlug(
  env: Env,
  userId: string,
  clientId: string | null,
): Promise<string | null> {
  if (clientId) {
    try {
      const clientRow = await env.DB.prepare(
        `SELECT archetype_slug FROM clients WHERE id = ? AND user_id = ?`
      ).bind(clientId, userId).first<{ archetype_slug: string | null }>();
      if (clientRow?.archetype_slug) return clientRow.archetype_slug;
    } catch (e) {
      console.warn(`[archetype] client lookup failed for client=${clientId}:`, e);
      // fall through to user-level lookup
    }
  }
  try {
    const userRow = await env.DB.prepare(
      `SELECT archetype_slug FROM users WHERE id = ?`
    ).bind(userId).first<{ archetype_slug: string | null }>();
    return userRow?.archetype_slug || null;
  } catch (e) {
    console.warn(`[archetype] user lookup failed for user=${userId}:`, e);
    return null;
  }
}

// ── Classifier core helper ───────────────────────────────────────────────
// Three-layer classifier (keyword → Vectorize → Haiku) that both user-level
// and client-level classify-business endpoints share. Returns either:
//   { chosen, archetypePayload }    — success
//   { error, status, valid_slugs? } — failure that caller forwards as JSON
// Pure-ish: no DB writes, no auth, no per-caller state. Caller decides
// where to persist (users vs clients table).
export async function classifyArchetypeFromFingerprint(
  env: Env,
  fingerprint: string,
): Promise<
  | { chosen: { slug: string; confidence: number; reasoning: string }; archetypePayload: any }
  | { error: string; status: number; valid_slugs?: string[] }
> {
  const archetypeRows = await env.DB.prepare(
    `SELECT slug, name, description, keywords, image_examples, image_avoid_notes, voice_cues, content_pillars, banned_trope_extras FROM business_archetypes ORDER BY slug`
  ).all<ArchetypeRow>();
  const archetypes = (archetypeRows.results || []) as ArchetypeRow[];
  if (archetypes.length === 0) {
    return { error: 'business_archetypes table is empty — run seed_v7_archetypes.sql', status: 500 };
  }

  // ── Layer 0 — keyword match ──
  const fingerprintLower = fingerprint.toLowerCase();
  const scores: Array<{ slug: string; hits: number }> = archetypes.map(a => ({
    slug: a.slug,
    hits: (JSON.parse(a.keywords) as string[]).filter(kw => fingerprintLower.includes(kw.toLowerCase())).length,
  }));
  scores.sort((a, b) => b.hits - a.hits);
  const top = scores[0];
  const second = scores[1];
  let chosen: { slug: string; confidence: number; reasoning: string } | null = null;
  if (top && top.hits >= 2 && (!second || top.hits - second.hits >= 2)) {
    chosen = {
      slug: top.slug,
      confidence: 0.9,
      reasoning: `Keyword match: ${top.hits} keywords matched, beating runner-up by ${top.hits - (second?.hits ?? 0)}. Skipped LLM classifier.`,
    };
  }

  // ── Layer 0.5 — Cloudflare Vectorize semantic match ──
  if (!chosen && env.ARCHETYPE_VEC && env.AI) {
    try {
      const vec = await classifyViaVectorize(env, fingerprint);
      if (vec && vec.confidence >= 0.78) {
        chosen = {
          slug: vec.slug,
          confidence: vec.confidence,
          reasoning: `Vectorize match: cosine similarity ${vec.confidence.toFixed(3)} to "${vec.slug}". Skipped LLM classifier.`,
        };
      }
    } catch (e: any) {
      console.warn(`[classify] Vectorize layer failed, falling through to LLM:`, e?.message);
    }
  }

  // ── Layer 1 — Haiku 4.5 zero-shot classifier ──
  if (!chosen) {
    if (!env.OPENROUTER_API_KEY) return { error: 'OPENROUTER_API_KEY not configured', status: 500 };
    const archetypeListing = archetypes.map(a => `• ${a.slug} — ${a.name}: ${a.description}`).join('\n');
    const systemPrompt = `You are a business-archetype classifier for a social-media SaaS. You will be given a description of a business. You MUST classify it into exactly ONE of the archetypes below.

The archetypes:

${archetypeListing}

Rules:
1. Choose the archetype whose description most closely matches the business. The goal is to pick the BEST IMAGERY + VOICE template for this business.
2. If the business is a bricks-and-mortar food venue (cafe, bakery, restaurant), prefer "food-restaurant" over "retail-ecommerce".
3. If the business is a digital/marketing/SaaS service (no physical venue, sells software or services online), use "tech-saas-agency" — NOT "professional-services". professional-services is for accountants/lawyers/architects with regulated credentials.
4. If the business is a specialist sub-type with a dedicated archetype (e.g. BBQ pitmaster, butcher shop, breathwork coach), prefer the specialist over the general parent.
5. confidence: return 0.95 if you're sure, 0.75 if you had to choose between two close candidates, 0.5 if you genuinely don't know. Be honest.
6. reasoning: ONE sentence explaining the choice. Mention the specific words from the input that drove the decision.

Respond ONLY with valid JSON matching this exact shape:
{
  "archetype_slug": "<one of the slugs above>",
  "confidence": <number between 0 and 1>,
  "reasoning": "<one sentence>"
}`;

    const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://socialaistudio.au',
        'X-Title': 'SocialAI Studio — Business Classifier',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fingerprint },
        ],
        temperature: 0.1, max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!orResponse.ok) {
      const errText = await orResponse.text().catch(() => '');
      return { error: `Haiku classifier call failed: ${orResponse.status} ${errText.slice(0, 200)}`, status: 502 };
    }
    const orJson = await orResponse.json() as any;
    const raw = orJson.choices?.[0]?.message?.content || '';
    let parsed: { archetype_slug?: string; confidence?: number; reasoning?: string };
    try { parsed = JSON.parse(raw); }
    catch { return { error: 'Haiku returned malformed JSON', status: 502 }; }
    const validSlug = archetypes.find(a => a.slug === parsed.archetype_slug);
    if (!validSlug) {
      return { error: `Haiku returned unknown slug "${parsed.archetype_slug}"`, status: 502, valid_slugs: archetypes.map(a => a.slug) };
    }
    chosen = {
      slug: parsed.archetype_slug!,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
      reasoning: (parsed.reasoning || 'Haiku classifier verdict').slice(0, 400),
    };
  }

  const matched = archetypes.find(a => a.slug === chosen!.slug)!;
  return {
    chosen,
    archetypePayload: {
      slug: matched.slug,
      name: matched.name,
      description: matched.description,
      image_examples: JSON.parse(matched.image_examples),
      image_avoid_notes: matched.image_avoid_notes,
      voice_cues: matched.voice_cues,
      content_pillars: JSON.parse(matched.content_pillars),
      banned_trope_extras: matched.banned_trope_extras ? JSON.parse(matched.banned_trope_extras) : null,
    },
  };
}

// ── Vectorize semantic classifier (Phase 2) ──────────────────────────────
//
// Embeds the business fingerprint with @cf/baai/bge-base-en-v1.5 (768-dim,
// English-optimised) and queries the archetypes index for the closest match
// by cosine similarity. Returns null if bindings aren't configured or the
// index is empty (caller falls through to Haiku).
//
// Confidence interpretation:
//   ≥ 0.85 — strong match, archetype is the right one
//   0.78 to 0.85 — good match, skip LLM
//   0.65 to 0.78 — uncertain, let LLM decide
//   < 0.65 — poor match, definitely needs LLM
export async function classifyViaVectorize(
  env: Env,
  fingerprint: string,
): Promise<{ slug: string; confidence: number } | null> {
  if (!env.ARCHETYPE_VEC || !env.AI) return null;

  // Embed the fingerprint with bge-base-en-v1.5. Output is a 768-dim vector.
  const embedResult: any = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: fingerprint });
  const vector = embedResult?.data?.[0] || embedResult?.embedding || embedResult?.vector;
  if (!Array.isArray(vector) || vector.length !== 768) {
    console.warn(`[vectorize] bge-base returned unexpected shape:`, typeof vector, Array.isArray(vector) ? vector.length : 'not array');
    return null;
  }

  const result = await env.ARCHETYPE_VEC.query(vector, { topK: 1, returnMetadata: 'indexed' });
  const match = result.matches?.[0];
  if (!match) return null;

  // Vectorize cosine scores are in [-1, 1] but for embedding similarity they
  // always come out in [0, 1] in practice. Treat the score as the confidence
  // directly — bge-base on normalised English text is well-calibrated.
  return { slug: match.id, confidence: match.score };
}
