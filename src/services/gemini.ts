import { getIndustryBenchmarks, formatBenchmarksForPrompt, HASHTAG_LIMITS } from '../data/socialMediaResearch';

// Sanitise raw AI JSON output — fixes common issues that cause JSON.parse to fail
// IMPORTANT: Do NOT replace smart double quotes with straight quotes here — that breaks
// JSON parsing by prematurely ending string values. Smart double quotes (U+201C/201D)
// are valid Unicode inside JSON strings; only U+0022 is a JSON string delimiter.
const sanitizeJson = (raw: string): string => {
  let s = raw;
  // Strip BOM and zero-width characters
  s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');
  // Replace smart SINGLE quotes with straight apostrophe (safe — apostrophes don't delimit JSON strings)
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
  // Replace en-dash/em-dash with hyphen
  s = s.replace(/[\u2013\u2014]/g, '-');
  // Replace ellipsis character with three dots
  s = s.replace(/\u2026/g, '...');
  // Strip problematic control characters — but KEEP \n \r \t which are valid JSON whitespace
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001f\u007f]/g, '');
  return s;
};

// Extract valid JSON from a string that may contain markdown fences or extra text
const extractJson = (raw: string): string => {
  let s = raw.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // If it doesn't start with { or [, find the first one
  if (s && !s.startsWith('{') && !s.startsWith('[')) {
    const braceIdx = s.indexOf('{');
    const bracketIdx = s.indexOf('[');
    const idx = braceIdx >= 0 && bracketIdx >= 0 ? Math.min(braceIdx, bracketIdx) : braceIdx >= 0 ? braceIdx : bracketIdx;
    if (idx >= 0) s = s.slice(idx);
  }
  // Find matching closing brace/bracket
  if (s.startsWith('{') || s.startsWith('[')) {
    const open = s[0];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { s = s.slice(0, i + 1); break; } }
    }
  }
  return s;
};

// Escape literal newlines/tabs inside JSON string values AND fix invalid escape sequences
// AI models sometimes return JSON with unescaped newlines or JS-style escapes like \'
const escapeJsonStrings = (s: string): string => {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      // Fix invalid JSON escapes: \' is valid JS but NOT valid JSON — just output the char
      if (c === "'") { out += c; esc = false; continue; }
      // All other escapes (\n, \", \\, \t, \/, \b, \f, \r, \uXXXX) are valid — pass through
      out += c; esc = false; continue;
    }
    if (c === '\\' && inStr) { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
};

// Parse raw AI JSON response robustly — handles newlines, markdown fences, invalid escapes
const parseAiJson = (raw: string): any => {
  const cleaned = extractJson(raw);
  if (!cleaned) return null;
  const fixed = escapeJsonStrings(cleaned);
  try {
    return JSON.parse(sanitizeJson(fixed));
  } catch {
    // Second attempt: strip all backslash-escapes that aren't valid JSON
    try {
      const stripped = fixed.replace(/\\(?!["\\/bfnrtu])/g, '');
      return JSON.parse(sanitizeJson(stripped));
    } catch {
      // Third attempt: TRUNCATED OUTPUT recovery — model hit maxTokens mid-array.
      // Find the last fully-completed object inside "posts": [...], close the
      // array + brace, and try again. Better to return 12 valid posts than 0.
      return tryRecoverTruncated(cleaned);
    }
  }
};

// Recover from a truncated JSON response by trimming back to the last complete
// object inside the posts array. Returns null if recovery isn't possible.
function tryRecoverTruncated(raw: string): any {
  // Locate "posts": [ ... — find each complete object boundary and trim.
  const postsKey = raw.search(/"posts"\s*:\s*\[/);
  if (postsKey < 0) return null;
  const arrStart = raw.indexOf('[', postsKey);
  if (arrStart < 0) return null;

  // Walk through, tracking depth and string state, find the last closing }
  // that's at depth=1 (immediate child of the posts array).
  let depth = 0; let inStr = false; let esc = false;
  let lastClose = -1;
  for (let i = arrStart; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 1) lastClose = i;  // depth=1 means "this closing brace finishes a post object"
    }
  }
  if (lastClose < 0) return null;
  // Reconstruct: everything up to lastClose, then close the array + outer object.
  const reconstructed = raw.substring(0, lastClose + 1) + ']}';
  try {
    const parsed = JSON.parse(sanitizeJson(escapeJsonStrings(reconstructed)));
    if (parsed && Array.isArray(parsed.posts)) {
      console.warn(`[parseAiJson] truncation recovered: kept ${parsed.posts.length} complete posts`);
      return parsed;
    }
  } catch { /* fall through */ }
  return null;
}

// `import.meta.env` is Vite-only — defensively coerce so this module can also
// be imported by node-side smoke tests (scripts/audit-smoke-test.ts) without
// crashing at module-load.
const AI_WORKER = (((import.meta as any).env as Record<string, string> | undefined) || {}).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

// ── Business Archetype Library (2026-05 Phase 1) ──
//
// The bundled ARCHETYPES constant is the client-side source of truth for the
// keyword-based fast path. The server-side classifier endpoint reads the same
// data from D1 (seeded from this module). At generation time:
//
//   1. activeArchetypeSlug is set by App.tsx after fetching the user's cached
//      archetype from /api/business-archetype (set once per session)
//   2. getImagePromptExamples first looks up examples from the cached archetype
//   3. Falls back to the synchronous keyword match against ARCHETYPES
//   4. Falls back to the legacy hardcoded switch (kept for safety during the
//      transition — will be removed in a follow-up once we've confirmed the
//      archetype path is hit for >99% of generations)
//
// See src/data/archetypes.ts for the canonical archetype list and
// workers/api/src/index.ts for the /api/classify-business endpoint.
import { ARCHETYPES, matchArchetypeByKeyword, getArchetypeBySlug } from '../data/archetypes';

let activeArchetypeSlug: string | null = null;

/** Called by App.tsx once per session after fetching /api/business-archetype.
 *  Subsequent image-prompt lookups will prefer this archetype's example bank
 *  over the keyword-match fallback. Pass null to clear (e.g. workspace switch). */
export function setActiveArchetype(slug: string | null) {
  activeArchetypeSlug = slug;
}

/** Generate business-specific image prompt examples.
 *
 *  Resolution order:
 *    1. Cached archetype (set by setActiveArchetype after classifier run)
 *    2. Synchronous keyword match against ARCHETYPES (covers any business
 *       whose type/description hits a keyword — works instantly with no
 *       server call, even before the classifier runs)
 *    3. Legacy hardcoded keyword switch (the original 11-branch cascade,
 *       kept temporarily as a safety net)
 *
 *  Provides 6-10 DIFFERENT compositions per archetype so the AI doesn't fall
 *  back to the same template every post. Each call returns ALL examples
 *  OR-joined so the AI has variety. */
const getImagePromptExamples = (businessType: string): string => {
  // Layer 1: use the user's classified archetype if available
  if (activeArchetypeSlug) {
    const arch = getArchetypeBySlug(activeArchetypeSlug);
    if (arch) return arch.imageExamples.map(s => `'${s}'`).join(' OR ');
  }
  // Layer 2: synchronous keyword match (works during the brief window before
  // the classifier returns, or for businesses that haven't been classified yet)
  const kwMatch = matchArchetypeByKeyword(businessType);
  if (kwMatch) return kwMatch.imageExamples.map(s => `'${s}'`).join(' OR ');
  // Layer 3: fall through to legacy hardcoded switch below
  const t = businessType.toLowerCase();
  // Use word-boundary check for short tokens to avoid false matches (e.g. "it"
  // matching "kit", "fit", "with"). Long tokens use plain substring.
  const has = (...needles: string[]) => needles.some(n =>
    n.length <= 3 ? new RegExp(`\\b${n}\\b`).test(t) : t.includes(n)
  );

  if (has('butcher', 'meat', 'agriculture')) return [
    "'raw beef ribeye steak on dark wooden cutting board, warm lighting, overhead shot'",
    "'rack of lamb on butcher paper with rosemary sprigs, natural side light'",
    "'glass display case of fresh sausages and cuts, shop interior, soft daylight'",
    "'aged dry-rubbed brisket close-up showing bark texture, dramatic lighting'",
    "'butcher's marble counter with herbs and twine, overhead flatlay'",
    "'cast iron pan searing thick pork chops with garlic, moody warm light'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('bbq', 'barbeque', 'barbecue', 'food truck', 'smokehouse')) return [
    "'sliced smoked brisket fanned on butcher paper, golden hour light'",
    "'pulled pork burger with coleslaw and pickles, close-up macro'",
    "'BBQ ribs glistening with glaze on cedar plank, smoke wisps in background'",
    "'food truck exterior at dusk with warm window light and queue'",
    "'overhead flatlay: brisket, slaw, beans, white bread on red checkered paper'",
    "'pitmaster's smoker open showing meat, atmospheric smoke, late afternoon sun'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('bakery', 'café', 'cafe', 'coffee')) return [
    "'sourdough loaf cross-section on marble counter, morning window light'",
    "'flat white coffee with latte art on rustic wooden table, top-down'",
    "'croissants stacked in wicker basket, soft golden bakery light'",
    "'barista pouring milk in motion, espresso machine bokeh background'",
    "'pastry display case interior, warm lighting, bakery atmosphere'",
    "'overhead flatlay of breakfast spread: coffee, pastries, jam, butter'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('pickle', 'deli', 'ferment')) return [
    "'jar of bread and butter pickles next to fresh cucumbers, natural light'",
    "'wooden cheese board with artisan pickles, crackers, and grapes, overhead'",
    "'colourful row of fermentation jars on shelf, daylight from window'",
    "'cross-section of kimchi in a glass jar showing texture, side angle'",
    "'sandwich loaded with deli meat and pickles, overhead on butcher paper'",
    "'kraut being lifted with wooden tongs above jar, action shot'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  // Keywords expanded 2026-05 follow-up: SocialAI Studio's OWN agency posts
  // were generating food images because "Marketing Agency" / "Social Media
  // Studio" / "Creative Studio" didn't hit any branch and fell through to
  // the default. The reworked tech examples (laptop, keyboard, post-its,
  // home office) are equally appropriate for SaaS, marketing/social agency,
  // and creative-studio businesses — so they all share this branch.
  if (
    has('web', 'software', 'tech', 'digital', 'saas', 'agency', 'marketing', 'studio', 'creative', 'consultancy', 'consult', 'automation') ||
    /\bit\b/.test(t) || /\bi\.t\b/.test(t)
  ) return [
    // Reworked 2026-05 — original examples were UI-centric (phone screen
    // showing clean app UI, wireframe sketches, fingers typing) which both
    // (a) tripped the new isAbstractUI fallback regex when the AI quoted
    // them and (b) primed the AI to write UI-flavoured prompts even for
    // non-pricing topics. New examples lean into the "calm hands-off
    // automation" outcome — physical scenes, no UI mentions, no people.
    //
    // 2026-05 follow-up: removed the 3 inherently dark examples ("dark
    // moody desk", "server rack with neon", "fibre cables in dark room")
    // — they rendered as mostly-black thumbnails which look like generation
    // failures to the user. Replaced with brighter alternatives in the same
    // visual category (workspace / tech materials) so the pool stays varied
    // but every random pick produces a legible draft thumbnail.
    "'matte black smartphone face-down on marble surface beside espresso cup, top-down, morning light'",
    "'mechanical keyboard with white keycaps on a bright minimalist desk, candid close-up, no person'",
    "'rows of glossy server tower casings against a clean white wall, soft daylight, no person'",
    "'aerial view of clean desk with notebook, pen, plant and closed laptop, beige aesthetic'",
    "'coffee shop counter scene with laptop, latte and notebook, warm afternoon light, no person'",
    "'creative wall of post-it notes in a bright office, daylight from window, candid texture'",
    "'macro of fibre optic cables coiled on a white surface, sharp focus, bright top-down studio light'",
    "'home office windowsill with plant, mug and a closed notebook at sunrise'",
    "'multi-screen agency desk with calendar view, soft morning daylight through window, no person'",
    "'whiteboard wall with kanban sticky-notes, daylight, creative studio atmosphere'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('festival', 'event')) return [
    "'outdoor festival crowd from behind facing stage, golden sunset light'",
    "'competition trophies and ribbons on draped table, dramatic spotlight'",
    "'food truck row at dusk with festoon lights, atmospheric'",
    "'overhead aerial of festival grounds with marquees and crowds'",
    "'festival entrance gate with banners, golden hour, anticipation feel'",
    "'judges tasting at competition table, focused candid moment'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('surf', 'sport', 'outdoor')) return [
    "'surfboard standing upright in sand with ocean background, golden hour'",
    "'row of surfboards in shop rack, natural daylight from window'",
    "'wave breaking with surfer silhouette, dramatic backlight'",
    "'overhead flatlay of beach gear: board wax, sunscreen, towel, sandals'",
    "'aerial shot of empty surf break at dawn, dramatic clouds'",
    "'wetsuit hanging on weathered wooden fence, salty atmosphere'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('jewel', 'jewelry', 'jewellery')) return [
    "'single ring on velvet pad with soft directional lighting'",
    "'overhead flatlay of necklaces fanned on linen background'",
    "'close-up macro of gemstone showing facets and light play'",
    "'workbench with tools and an in-progress piece, atmospheric warm light'",
    "'jewellery in display case with reflections, boutique interior'",
    "'open jewellery box with multiple pieces, overhead, soft shadows'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('mechanic', 'garage', 'auto', 'workshop')) return [
    "'classic car in garage bay under work lights, atmospheric'",
    "'mechanic's tool wall with organised wrenches, industrial light'",
    "'engine bay close-up with chrome detail, shallow focus'",
    "'oil change action shot from below the lift, dramatic angle'",
    "'detailed leather steering wheel close-up after restoration'",
    "'workshop exterior with vintage signage, golden hour'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  if (has('breath', 'wellness', 'yoga', 'meditation', 'mindful')) return [
    "'serene candle on stone with soft window light, minimal composition'",
    "'meditation cushion in sunlit room with linen curtains'",
    "'overhead flatlay of journal, herbal tea, and dried flowers, calm aesthetic'",
    "'misty forest path at dawn, atmospheric grounding nature shot'",
    "'close-up of hands holding warm ceramic mug, cozy lighting'",
    "'studio interior with plants, soft daylight, peaceful empty space'",
  ].map(s => `'${s.slice(1, -1)}'`).join(' OR ');

  // Default fallback when no industry keyword matched. 2026-05 follow-up:
  // re-anchored on neutral compositional language (no food/product hints)
  // so FLUX doesn't default to cafe/restaurant scenes when given a vague
  // businessType. The downstream `pickExampleScene` picks ONE of these,
  // then it's combined with the post's own imagePrompt so the AI's topic
  // still drives the subject — the example only sets composition + lighting.
  return `'the main product/service of ${businessType} in its natural setting, professional lighting' OR 'a tight macro detail shot of one tool of the trade' OR 'a wide environmental shot of the workspace at golden hour' OR 'an overhead flatlay arrangement on a textured surface' OR 'an action shot mid-process with motion blur'`;
};

/**
 * Picks ONE example from the OR-joined string getImagePromptExamples returns.
 *
 * Bug history (2026-05): both generateMarketingImage callsites had a
 * regex like `.replace(SLASH ' or ' DOT-STAR SLASH, '')` that was supposed
 * to strip everything after the first example — but the joiner is uppercase
 * ` OR ` (see getImagePromptExamples line 161), so the regex matched nothing
 * and the ENTIRE 8-example concatenation was sent to FLUX as one prompt. FLUX then
 * blended scenes (e.g. a tech-business prompt rendered as a cafe because
 * "coffee shop counter scene with laptop" was one of the OR'd examples).
 *
 * This helper splits on the actual ` OR ` joiner, strips wrapping quotes,
 * and picks ONE example at random per call so accept-all generates varied
 * imagery instead of always defaulting to the first scene.
 */
function pickExampleScene(joinedExamples: string): string {
  const parts = joinedExamples
    .split(/\s+OR\s+/i)
    .map(s => s.replace(/^e\.g\.\s*/i, '').replace(/^['"]/, '').replace(/['"]$/, '').trim())
    .filter(Boolean);
  if (!parts.length) return joinedExamples;
  return parts[Math.floor(Math.random() * parts.length)];
}

/**
 * Test if a prompt is describing a digital interface, chart, infographic,
 * or comparison grid — situations where FLUX produces a blurry pricing-table
 * mockup instead of a photographable scene.
 *
 * Bug history (2026-05 audit): the previous regex used bare-word matches on
 * common nouns (`plan|tier|table|column|grid`) which false-positived on
 * legitimate small-business prompts:
 *   - "meal plan", "business plan", "floor plan"  → matched "plan"
 *   - "wine tier", "premium tier" (product line)  → matched "tier"
 *   - "tea table", "picnic table", "dinner table" → matched "table"
 *   - "fence grid", "rebar grid"                  → matched "grid"
 *   - "centre column" (architectural)             → matched "column"
 * Result: cafe/wellness posts that mentioned a meal plan or wine tier got
 * swapped for the abstract-UI fallback scene, defeating the whole point of
 * business-specific imagery.
 *
 * New regex requires a UI-context noun (pricing|comparison|feature|bar|pie|
 * line|architecture…) before the ambiguous word. Always-bad terms (dashboard,
 * infographic, etc.) still match bare. KEEP IN SYNC with the worker's copy
 * of this regex in workers/api/src/index.ts (buildSafeImagePrompt).
 */
export function isAbstractUIPrompt(prompt: string): boolean {
  // Tier 1 — terms that are ALWAYS bad regardless of context
  if (/\b(dashboard|infographic|wireframe|mockup|landing page|website screenshot|screenshot|logo design|3D render|marketing graphic|app screen|app screens|UI|UX|user interface)\b/i.test(prompt)) return true;
  // Tier 2 — context-dependent: only bad when paired with a UI-type noun
  if (/\b(pricing|comparison|feature)\s+(table|tier|grid|plan|chart|page|column|tiers|grids|plans|charts|pages|columns)\b/i.test(prompt)) return true;
  if (/\b(bar|pie|line|data|stat|stats)\s+(chart|graph|charts|graphs)\b/i.test(prompt)) return true;
  if (/\b(architecture|flow|org|system|workflow)\s+(diagram|diagrams)\b/i.test(prompt)) return true;
  // Tier 3 — explicit "illustration of" / "diagram of" — clear intent for
  // abstract art rather than photographic content
  if (/\b(an?\s+|the\s+)?(illustration|diagram|infographic)\s+(of|showing|depicting|with)\b/i.test(prompt)) return true;
  return false;
}

/**
 * Regional voice block — injected into Smart Schedule and single-post prompts
 * when the customer's location indicates Australia. Without this, Claude Haiku
 * defaults to its training-data prior (US/UK marketing-blog cadence) and
 * generates posts that read like Silicon Valley pitches even for a Rocky cafe.
 *
 * 2026-05 deep audit observation: Penny Wise IT (Rockhampton) was getting
 * posts opening with "Your best post goes live at 3 AM on a Tuesday. Nobody
 * sees it. Timing is everything." — textbook SV tech-blog rhythm. The fix is
 * an explicit regional voice lock keyed off location, plus structural-pattern
 * bans in BANNED_PATTERNS for the cadence itself.
 *
 * Returns "" if location doesn't look Australian so the prompt degrades
 * gracefully for international customers (when we have any).
 */
export function buildRegionalVoiceBlock(location: string): string {
  const loc = (location || '').toLowerCase();
  if (!loc) return '';
  const isAustralian = /\b(australia|australian|aussie|qld|queensland|nsw|new south wales|vic|victoria|sa\b|south australia|wa\b|western australia|nt\b|northern territory|tas|tasmania|act\b|brisbane|sydney|melbourne|perth|adelaide|darwin|hobart|canberra|gold coast|sunshine coast|rockhampton|rocky\b|townsville|cairns|toowoomba|ipswich|mackay|bundaberg|byron|newcastle|wollongong|geelong|launceston|fremantle|manly|bondi|surfers paradise)\b/i.test(loc);
  if (!isAustralian) return '';

  const isRegional = /\b(rockhampton|rocky\b|townsville|cairns|toowoomba|ipswich|mackay|bundaberg|regional|central queensland|north queensland|outback)\b/i.test(loc);

  return `
═══════════════════════════════════════════════════════════════════
🇦🇺 REGIONAL VOICE LOCK — this business is in ${isRegional ? 'regional Australia' : 'Australia'}.
═══════════════════════════════════════════════════════════════════
Write like an actual local, not like a Sydney agency or a US tech blog.
- USE: casual contractions ("we're", "you're", "it's", "gonna", "won't"); plain language; the way you'd talk at the pub or to a tradie mate
- USE (sparingly, never forced): "mate", "G'day", "the missus", "Rocky" (for Rockhampton), "yeah nah", "fair dinkum", "no worries", "arvo", "brekky", "smoko"
- AVOID like a press release: "elevate", "leverage", "synergy", "ecosystem", "thought leadership", "best-in-class", "world-class", "cutting-edge", "channell?ed creative energy", "bespoke digital platforms", "tailored solutions", "end-to-end", "value proposition"
- AVOID US tech-blog rhythm: short three-beat declarative sentences ("Nobody sees it. Timing is everything."), "No more X-ing at a Y", "Every X. Every Y. Every Z." anaphora, opening with a hypothetical hour ("Your best post goes live at 3 AM…")
- AVOID corporate openers: "In today's digital age", "As a business owner", "Exciting news!", "We're thrilled to announce"
- THE VOICE TEST: Would a tradie reading this think "this sounds like my mate" or "this sounds like a wanker"? Aim for mate. Every time.
═══════════════════════════════════════════════════════════════════
`;
}

// Canonical FLUX negative-prompt — passed as a SEPARATE parameter so the
// diffusion model actually suppresses these concepts at sampling time.
//
// 2026-05 deep audit: the previous design appended these tokens onto the
// POSITIVE prompt as "no people, no faces, no hands, …". FLUX-dev does not
// parse inline negations — those words become positive concepts. Worse, the
// negative tokens often pull semantically-related content INTO the image
// (saying "no hands" near "pizza" makes a hand more likely to appear, since
// the model sees "hands" as a strong contextual cue). Hence the steaming
// pizza with a hand in the screenshot. fal.ai/flux/dev accepts top-level
// `negative_prompt` and respects it properly when guidance_scale ≥ 5.
export const FLUX_NEGATIVE_PROMPT = 'people, faces, hands, fingers, person, portrait, smiling, posing, staff, customer, chef, owner, team, hand-held, holding, text, watermark, signature, UI, app screen, dashboard, chart, graph, table, infographic, diagram, pricing tier, comparison grid, landing page, marketing graphic, logo, illustration, drawing, cartoon, 3D render, studio lighting, glossy plastic, excessive steam, dark, underexposed, low-light, dim, shadowed, gloomy, harsh shadows, blown-out highlights, monotone scene';

// Canonical positive-prompt suffix — kept INTENTIONALLY trope-free now that
// negatives live in the dedicated field. The worker's tripwire still checks
// for "candid iPhone" so we keep that token; the rest is style direction.
//
// Lighting bias: defaults to BRIGHT natural daylight after a customer flagged
// outputs trending too dark/moody. AI-picked moody lighting is fine for tone-
// specific campaigns (countdown, scarcity) but the default pull should be
// bright + airy so feeds stay scrollable. The negative-prompt list also calls
// out "dark", "underexposed", "shadows" to push back at the diffusion bias.
export const FLUX_STYLE_SUFFIX = 'candid iPhone photo taken at the venue, BRIGHT natural daylight, well-exposed, airy, slightly imperfect framing, real-world wear and texture, 1:1 square format';

// People-mention regex — defense-in-depth scrub of positive prompts.
// The dedicated FLUX_NEGATIVE_PROMPT field is the real enforcement; this
// strip catches lingering subject words before they reach the diffusion model.
const PEOPLE_REGEX = /\b(woman|women|man|men|person|people|portrait|face|faces|facial|smiling|smile|looking|standing|sitting|holding|posing|gazing|wearing|chef|farmer|barista|customer|owner|team|staff|employee|worker|girl|boy|lady|guy|couple|family|child|children|hand|hands|finger|fingers|happy|customers|interior shot)\b/gi;

// Reused by generateVideoBrief — same intent, slightly broader vocab
// (talking head, no "looking/standing/sitting/wearing/happy" — those describe
// the camera shot rather than the subject and may legitimately appear in
// video-shot direction).
const PEOPLE_REGEX_VIDEO = /\b(woman|women|man|men|person|people|portrait|face|faces|facial|smiling|smile|gazing|chef|farmer|barista|customer|owner|team|staff|employee|worker|girl|boy|lady|guy|couple|family|child|children|hand|hands|finger|fingers|customers|talking head)\b/gi;

/**
 * Single source of truth for the client-side image-prompt safety pipeline.
 * Consolidates logic that was previously duplicated across:
 *   - generateMarketingImage          (base64 path used by accept-now flow)
 *   - generateMarketingImageUrl       (URL path used by accept-all-to-D1)
 *   - FalService.generateImage        (reel-modal seed-frame path — was
 *                                      bypassing all guards prior to audit)
 *
 * All three callers MUST go through this helper so they share the same
 * validation, scrubbing, and negative-prompt suffix.
 *
 * Pipeline:
 *   1. Reject obviously bad prompts (empty, "N/A", title-case names, vague nouns)
 *   2. Detect abstract-UI prompts via isAbstractUIPrompt
 *   3. If (1) OR (2): try industry-specific example (pickExampleScene); if
 *      businessType is generic and we'd otherwise pick a random scene that
 *      mismatches the post topic, RETURN NULL (fail-closed) — better to
 *      publish text-only than attach a pizza to a tech post (real Penny Wise
 *      regression observed 2026-05)
 *   4. Strip people-mentions from the positive prompt (defense-in-depth — the
 *      negative_prompt is the real enforcement)
 *
 * Returns { prompt, negativePrompt } — both passed to fal.ai as separate
 * parameters. Returns null when the safety pipeline can't produce a sensible
 * image and the post should publish text-only.
 */
export function buildSafeImagePromptClient(rawPrompt: string, businessType: string = 'small business'): { prompt: string; negativePrompt: string } | null {
  const prompt = (rawPrompt || '').trim();
  const isBadPrompt = !prompt || prompt.length < 15 || !/\s/.test(prompt) || /^(N\/A|none|null|undefined)$/i.test(prompt);
  const looksLikeTitle = /^[A-Z][a-z]+ [A-Z&]/.test(prompt) && prompt.split(' ').length <= 5;
  const tooVague = /\b(produce|items|products|goods|things|stuff|showcase|journey|tips|stories)\b/i.test(prompt) && prompt.split(' ').length < 8;
  const isAbstractUI = isAbstractUIPrompt(prompt);
  const needsFallback = isBadPrompt || looksLikeTitle || tooVague || isAbstractUI;

  // Fail-closed if we'd be picking a random scene against a generic business
  // type. This is the audit fix that stops "pizza on a tech post" — the old
  // code would happily pick a cafe scene from getImagePromptExamples for a
  // 'small business' fallback and FLUX would render food on a SaaS topic.
  const isGenericType = /^(small business|business|company|service provider|local business)$/i.test(businessType.trim());
  if (needsFallback && isGenericType) {
    console.warn(`[image-safety] fail-closed — abstract/missing prompt with generic businessType="${businessType}". Post will publish text-only.`);
    return null;
  }

  const effectivePrompt = needsFallback
    ? pickExampleScene(getImagePromptExamples(businessType))
    : prompt;

  // Strip people-mentions from the POSITIVE prompt — defense-in-depth.
  // The real enforcement is FLUX_NEGATIVE_PROMPT below.
  const cleanPrompt = effectivePrompt
    .replace(PEOPLE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    prompt: `${cleanPrompt || effectivePrompt}, ${FLUX_STYLE_SUFFIX}`,
    negativePrompt: FLUX_NEGATIVE_PROMPT,
  };
}

// ── Real-data ground-truth fetcher (FB-scraped facts) ──
// The AI used to invent testimonials and stats because it had nothing real.
// Now we pull a slice of the client_facts table (populated by the Worker
// scraping their connected FB Page) and inject only verified, real content
// into prompts. Falls back gracefully if the workspace has no facts yet.
export interface ClientFact {
  fact_type: 'about' | 'own_post' | 'comment' | 'photo' | 'event';
  content: string;
  metadata: any;
  engagement_score: number;
}
let _factsCache: { key: string; ts: number; facts: ClientFact[] } | null = null;
const FACTS_TTL_MS = 5 * 60 * 1000; // 5 min in-memory cache

export async function fetchClientFacts(clientId?: string | null): Promise<ClientFact[]> {
  const key = clientId || '_self';
  if (_factsCache && _factsCache.key === key && Date.now() - _factsCache.ts < FACTS_TTL_MS) {
    return _factsCache.facts;
  }
  const fetchOnce = async (): Promise<ClientFact[]> => {
    const headers = await aiAuthHeaders();
    const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
    const res = await fetch(`${AI_WORKER}/api/db/facts${qs}`, { headers });
    if (!res.ok) return [];
    const data = await res.json() as { facts?: any[] };
    return (data.facts || []).map((f: any) => ({
      fact_type: f.fact_type,
      content: f.content,
      metadata: typeof f.metadata === 'string' ? (() => { try { return JSON.parse(f.metadata); } catch { return {}; } })() : f.metadata,
      engagement_score: f.engagement_score || 0,
    }));
  };
  try {
    let facts = await fetchOnce();
    // Auto-bootstrap: if facts table is empty for this workspace, trigger a
    // refresh from Facebook ONCE before giving up. This means a brand-new
    // user runs Smart Schedule and gets real data without needing to click
    // the Refresh button first.
    if (facts.length === 0) {
      console.log('[gemini] no facts found — attempting one-time auto-refresh from Facebook');
      try {
        const headers = await aiAuthHeaders();
        const path = clientId ? `/api/db/refresh-facts/${encodeURIComponent(clientId)}` : '/api/db/refresh-facts';
        const refreshRes = await fetch(`${AI_WORKER}${path}`, { method: 'POST', headers });
        if (refreshRes.ok) {
          facts = await fetchOnce();
          console.log(`[gemini] auto-refresh populated ${facts.length} facts`);
        }
      } catch { /* fall through with empty facts */ }
    }
    _factsCache = { key, ts: Date.now(), facts };
    return facts;
  } catch {
    return [];
  }
}
export function clearFactsCache() { _factsCache = null; }

/** Build a ground-truth block to inject into AI prompts.
 * Returns "" if no facts available so the prompt degrades gracefully.
 * Engagement-feedback loop: top-2 past posts get STAR PERFORMER treatment so
 * the AI explicitly mimics what's already worked for THIS business. */
export function buildGroundTruthBlock(facts: ClientFact[]): string {
  if (!facts.length) return '';
  const about = facts.find(f => f.fact_type === 'about');
  // Posts come pre-sorted by engagement_score DESC from the API
  const allPosts = facts.filter(f => f.fact_type === 'own_post');
  const starPosts = allPosts.filter(p => p.engagement_score > 0).slice(0, 2);
  const restPosts = allPosts.filter(p => !starPosts.includes(p)).slice(0, 4);
  const comments = facts.filter(f => f.fact_type === 'comment').slice(0, 5);
  const events = facts.filter(f => f.fact_type === 'event').slice(0, 3);

  const sections: string[] = [];
  sections.push('═══════════════════════════════════════════════════════════════════');
  sections.push('VERIFIED FACTS — scraped from this business\'s real Facebook Page.');
  sections.push('These are the ONLY facts you may cite. Anything not below is invention.');
  sections.push('═══════════════════════════════════════════════════════════════════');
  if (about) sections.push(`\nPAGE INFO:\n${about.content}`);

  if (starPosts.length) {
    sections.push(`\n★ STAR PERFORMERS — these posts ALREADY worked for this business.`);
    sections.push(`THIS IS THE VOICE TEST. If your draft does not sound like ONE of these, you have failed and must rewrite.`);
    sections.push(`Match the rhythm, sentence length, hook style, energy, and vocabulary. Use the same level of formality, the same use of contractions ('we're' vs 'we are'), the same emoji frequency. Do NOT introduce phrases the business has never used. Do NOT use AI marketing tropes ("Nobody sees it. Timing is everything.", "No more staring at a blank screen", "Every X. Every Y. Every Z.", "channeled creative energy", "bespoke digital platforms") — those are immediate fails.`);
    starPosts.forEach((p, i) => {
      const meta = p.metadata || {};
      const stats = `${meta.likes || 0}❤️ ${meta.comments || 0}💬 ${meta.shares || 0}🔁`;
      sections.push(`★ ${i + 1}. [${stats}] ${p.content.substring(0, 320)}`);
    });
  }
  if (restPosts.length) {
    sections.push(`\nOTHER PAST POSTS (additional voice samples — match this rhythm too):`);
    restPosts.forEach((p, i) => sections.push(`${i + 1}. ${p.content.substring(0, 220)}`));
  }
  if (comments.length) {
    sections.push(`\nREAL CUSTOMER COMMENTS (real audience language; quote sparingly with attribution like "one customer wrote"):`);
    comments.forEach((c, i) => sections.push(`${i + 1}. ${c.content.substring(0, 200)}`));
  }
  if (events.length) {
    sections.push(`\nREAL UPCOMING EVENTS (only events you may reference):`);
    events.forEach(e => sections.push(`• ${e.content} (${e.metadata?.start_time || 'TBA'})`));
  }
  sections.push('═══════════════════════════════════════════════════════════════════\n');
  return sections.join('\n');
}

// Auth wiring — /api/ai/generate now requires Clerk JWT or Portal token.
// Each auth context calls setGeminiAuth() at startup so callAI can attach
// the right Authorization header.
type GeminiAuthMode = 'clerk' | 'portal';
let _getAiToken: (() => Promise<string | null>) | null = null;
let _aiAuthMode: GeminiAuthMode = 'clerk';
export function setGeminiAuth(getToken: () => Promise<string | null>, mode: GeminiAuthMode = 'clerk') {
  _getAiToken = getToken;
  _aiAuthMode = mode;
}
// Shared header builder — used by both /api/ai/generate and /api/fal-proxy callers.
// Both endpoints require auth (Clerk JWT or Portal token) since rate limiting was added.
export async function aiAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(extra || {}) };
  if (_getAiToken) {
    const tok = await _getAiToken();
    if (tok) headers['Authorization'] = _aiAuthMode === 'portal' ? `Portal ${tok}` : `Bearer ${tok}`;
  }
  return headers;
}

const callAI = async (
  prompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: 'json' | 'text';
    /** When supplied, sent with Anthropic prompt caching (cache_control: ephemeral).
     * Use for the large static block (GOLDEN RULES + verified facts + brand context)
     * that repeats across every Smart Schedule call. Cuts ~70% off cost on cache hits. */
    cachedPrefix?: string;
    /** Model override — defaults to Claude Haiku 4.5 in the worker */
    model?: string;
  }
): Promise<string> => {
  const headers = await aiAuthHeaders();
  const res = await fetch(`${AI_WORKER}/api/ai/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      cachedPrefix: options?.cachedPrefix,
      model: options?.model,
      temperature: options?.temperature ?? 0.8,
      maxTokens: options?.maxTokens ?? 2048,
      responseFormat: options?.responseFormat ?? 'text',
    }),
  });
  const data = await res.json() as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `AI request failed (${res.status})`);
  return data.text || '';
};

const compressImage = (base64Str: string, maxWidth = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => resolve(base64Str);
  });
};

export const generateSocialPost = async (
  topic: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string,
  profile?: {
    description?: string;
    targetAudience?: string;
    uniqueValue?: string;
    productsServices?: string;
    socialGoal?: string;
    location?: string;
    contentTopics?: string;
  },
  contentFormat?: string,
  /** When provided, AI is restricted to citing only these scraped FB facts. */
  clientId?: string | null,
): Promise<{ content: string; hashtags: string[]; imagePrompt?: string }> => {
  // Pull verified FB-scraped facts for this workspace (zero invention possible)
  const facts = await fetchClientFacts(clientId);
  const groundTruthBlock = buildGroundTruthBlock(facts);
  // Sanity check: detect corrupted profile data (e.g. agency profile leaked into client workspace)
  const isSinglePostProfileCorrupted = (() => {
    if (!profile) return false;
    const profileText = [profile.description, profile.contentTopics, profile.productsServices].filter(Boolean).join(' ').toLowerCase();
    const bizLower = businessType.toLowerCase();
    const foodKeywords = ['bbq', 'restaurant', 'food', 'catering', 'deli', 'pickle', 'butcher', 'meat', 'café', 'cafe', 'bakery', 'bar', 'pub'];
    const techKeywords = ['web design', 'website builder', 'ai technology', 'social ai studio', 'social media intergration', 'social media integration'];
    const isFood = foodKeywords.some(k => bizLower.includes(k));
    const hasTechContent = techKeywords.some(k => profileText.includes(k));
    if (isFood && hasTechContent) {
      console.warn(`[Profile Sanity] Corrupted profile for "${businessName}" (${businessType}) — ignoring stale profile data.`);
      return true;
    }
    return false;
  })();
  const safeProfile = isSinglePostProfileCorrupted ? undefined : profile;

  const profileContext = safeProfile ? [
    safeProfile.description && `About: ${safeProfile.description}`,
    safeProfile.targetAudience && `Target audience: ${safeProfile.targetAudience}`,
    safeProfile.uniqueValue && `Differentiator: ${safeProfile.uniqueValue}`,
    safeProfile.productsServices && `Products/services: ${safeProfile.productsServices}`,
    safeProfile.socialGoal && `Primary social goal: ${safeProfile.socialGoal}`,
    safeProfile.location && `Location: ${safeProfile.location}`,
    safeProfile.contentTopics && `Content topics & themes to focus on: ${safeProfile.contentTopics}`,
  ].filter(Boolean).join('\n') : '';

  // Pick a random content angle so repeated generations feel fresh
  const angles = [
    'Tell a micro-story or anecdote that connects emotionally',
    'Share a surprising fact, stat, or counterintuitive insight',
    'Ask a thought-provoking question that invites comments',
    'Give a quick actionable tip the audience can use today',
    'Show a behind-the-scenes moment or honest reflection',
    'Create urgency or FOMO around the topic',
    'Use a bold opinion or hot take to spark conversation',
    'Celebrate a win, milestone, or customer success',
  ];
  const angle = angles[Math.floor(Math.random() * angles.length)];

  // Content format instructions
  const formatGuide: Record<string, string> = {
    standard: '',
    question: 'FORMAT: Write as an engaging question post — pose a thought-provoking question to drive comments. The entire post should revolve around sparking a conversation.',
    tip: 'FORMAT: Write as a "Quick Tip" post — share one specific, actionable piece of advice. Start with a hook like "Pro tip:" or "Did you know?" and deliver real value.',
    story: 'FORMAT: Write as a micro-story — use a brief narrative arc (situation → tension → resolution). Make it personal and relatable. First-person preferred.',
    behindscenes: 'FORMAT: Write as a behind-the-scenes peek — show the human side of the business. Raw, authentic, not polished. Let the audience feel like an insider.',
    poll: 'FORMAT: Write as a poll/this-or-that post — present two options and ask the audience to vote in comments. Keep it fun and low-friction to respond to.',
    carousel: 'FORMAT: Write as a carousel/list post — structure content as a numbered list (3–5 points). Each point should be a standalone insight. Great for saves.',
    promotional: 'FORMAT: Write as a soft promotional post — highlight a product/service without being salesy. Lead with the problem it solves or the outcome it delivers. CTA at end.',
  };
  const formatInstr = formatGuide[contentFormat || 'standard'] || '';

  // Platform-specific rules (research-backed)
  const platformRules = platform === 'Facebook'
    ? `FACEBOOK POST RULES (2025/26 algorithm — follow strictly):
- Body: 80–150 characters is the engagement sweet spot. Max 300 for storytelling. NEVER exceed 400.
- Structure: attention-grabbing hook first line → 1–2 body lines → CTA last.
- Voice: conversational, human, first-person. Not a brand announcement. Write like a real person talking to a friend.
- Hashtags: EXACTLY 1–3 niche-relevant hashtags. More than 3 actively reduces reach on Facebook.
- Emojis: 2–4 placed naturally mid-sentence or at line breaks. Not at the end of every line.
- CTA: end with a comment-driving question OR a soft "DM us" / "tap the link". Never hard-sell.
- Line breaks: use short paragraphs (1–2 sentences each) with blank lines between them for readability.
- Avoid: pasting links in the post body (kills reach), all-caps words, "link in bio" on Facebook, generic filler, corporate jargon.`
    : `INSTAGRAM POST RULES (2025/26 Reels-first algorithm — follow strictly):
- Hook: the first 125 characters must stop the scroll — bold claim, intriguing question, or surprising fact.
- Body: 150–280 characters total. Reels-era captions are shorter; save-worthy value drives shares.
- Hashtags: EXACTLY 3–5 relevant hashtags. Mix: 1 branded/niche + 2-3 industry + 1 location. Do NOT use more than 5.
- Emojis: 3–5 used to break lines and add rhythm. Not filler.
- CTA: prioritise saves ("Save this ✓"), shares ("Tag someone"), or comments (open question).
- Avoid: hashtag dumps >10 (penalised), generic captions, posting without a scroll-stopping hook.`;

  const prompt = `═══════════════════════════════════════════════════════════════════
GOLDEN RULES — IF YOU BREAK THESE THE POST WILL BE REJECTED:
═══════════════════════════════════════════════════════════════════

1. NO INVENTED CUSTOMERS, REVIEWS, OR STORIES.
   You do NOT have real customer data. NEVER write phrases like:
     ✗ "A local cafe in [city] said..."
     ✗ "Rockhampton owner saw..."
     ✗ "One of our happy clients..."
     ✗ "A customer told us..."
     ✗ "Sarah J., Brisbane, says..."
   You have NO testimonials. Don't invent any. Period.

2. NO INVENTED STATISTICS OR PERCENTAGES.
   You do NOT have analytics data. NEVER write phrases like:
     ✗ "increased engagement by 30%"
     ✗ "saw a 45% boost"
     ✗ "saved them 10 hours a week"
     ✗ "generated 5x more leads"
   No numbers unless they appear verbatim in BRAND CONTEXT below.

3. NO INVENTED EVENTS, CAMPAIGNS, COUNTDOWNS, URLS.
   No "tomorrow!", no "this weekend only", no "limited spots left",
   no fake URLs, no fake hashtag campaigns. Only what's in BRAND CONTEXT.

4. EVERY POST MUST NAME A REAL THING from BRAND CONTEXT — an actual
   product, service, or location explicitly listed below. If you can't
   tie the post to something specific in BRAND CONTEXT, the post is wrong.

5. NEVER NAME UNDERLYING TECH, VENDORS, OR PROVIDERS.
   The customer doesn't need to know — and explicitly does not want to
   know — what powers the product behind the scenes. NEVER write phrases
   like:
     ✗ "powered by fal.ai FLUX"
     ✗ "(powered by Anthropic / OpenAI / Claude / GPT / Gemini)"
     ✗ "uses OpenRouter / Stable Diffusion / DALL-E / Midjourney"
     ✗ "built on Cloudflare Workers / D1 / R2"
     ✗ "our LLM / our model / our neural network"
   Even if the BRAND CONTEXT mentions an underlying vendor, STRIP it from
   the post. Speak about the FEATURE the customer experiences, not the
   plumbing under it.
     ✓ "AI image generation tailored to your caption" — fine
     ✗ "AI image generation (powered by fal.ai FLUX)" — forbidden
   Same rule for vendor parenthetical asides — drop them entirely.

═══════════════════════════════════════════════════════════════════

You are a senior social media strategist managing ${platform} for "${businessName}" (${businessType}).
Your writing voice: ${tone}. You write like a real human — never generic, never corporate, never AI-sounding.
${buildRegionalVoiceBlock(safeProfile?.location || '')}${groundTruthBlock}${profileContext ? `\nBRAND CONTEXT (the ONLY facts you may reference — anything else is fabrication):\n${profileContext}` : ''}

CREATIVE ANGLE FOR THIS POST: ${angle}
${formatInstr ? `\n${formatInstr}` : ''}

${platformRules}

STRICT ANTI-GENERIC RULES (forbidden tokens — DO NOT WRITE under any condition):
- FORBIDDEN openers: "Exciting news!", "We're thrilled to announce", "Big news!", "Have you heard?"
- FORBIDDEN filler: "In today's fast-paced world", "In today's digital age", "As a business owner", "Stay ahead of the competition", "Take your [X] to the next level", "Game-changer", "Revolutionise"
- FORBIDDEN CTAs: "Engage with your audience!", "Check out our website for more tips!", "Want to boost your [anything]?", "Visit our website to learn more!", "Let [product] handle the rest!", "Click the link in bio!"
- If you draft any forbidden phrase, STOP, delete it, and replace with a concrete specific detail.
- Every sentence must earn its place — if it could apply to any business, rewrite it.
- MUST reference specific details from the BRAND CONTEXT above — mention actual products, services, location, or audience by name.
- If content topics are provided above, the post MUST relate to one of those topics or themes.
- Do NOT invent events, campaigns, countdown language, or facts that aren't in the brand context — stay true to what the business actually does.
- Write like you're texting a smart friend, not writing a press release.

Write a ${platform} post about: "${topic}".
Return JSON: {"content": "post body text — NO hashtags in content", "hashtags": ["tag1", "tag2", ...], "imagePrompt": "Name ONE real, tangible, photographable scene from the physical world — pick from: ${getImagePromptExamples(businessType)}. NEVER say 'produce', 'items', 'food', 'goods', 'pricing', 'plans', 'features', 'comparison', 'tiers' — name the specific item. NO people, NO hands, NO faces. NO UI mockups, NO app screens, NO dashboards, NO charts, NO graphs, NO tables, NO infographics, NO diagrams, NO pricing tiers, NO comparison grids, NO landing pages, NO marketing graphics — even if the topic is about software, pricing, or subscriptions, the image MUST depict a real-world physical scene (an object, a place, a moment), NEVER a screen or chart."}
Content must respect the character limits above. No padding. No filler.`;

  const parseRaw = (raw: string) => {
    // Attempt 0: Direct JSON.parse — works if AI returns valid JSON (expected with responseFormat: 'json')
    try {
      const direct = JSON.parse(raw);
      if (direct?.content) return direct;
    } catch { /* not valid JSON as-is */ }

    // Attempt 1: parseAiJson — handles markdown fences, newlines in strings, invalid escapes
    try {
      const result = parseAiJson(raw);
      if (result?.content) return result;
    } catch { /* fall through */ }

    // Attempt 2: Pre-process newlines then parse — handles literal newlines in JSON string values
    try {
      const noNewlines = raw.replace(/\r?\n/g, '\\n');
      const result = JSON.parse(noNewlines);
      if (result?.content) {
        result.content = result.content.replace(/\\n/g, '\n');
        return result;
      }
    } catch { /* fall through */ }

    // Attempt 3: Manual character-by-character extraction
    try {
      const cIdx = raw.indexOf('"content"');
      if (cIdx >= 0) {
        const colonIdx = raw.indexOf(':', cIdx + 9);
        let valStart = -1;
        for (let i = colonIdx + 1; i < raw.length; i++) {
          if (raw[i] === '"') { valStart = i + 1; break; }
        }
        if (valStart > 0) {
          let valEnd = -1;
          let esc = false;
          for (let i = valStart; i < raw.length; i++) {
            if (esc) { esc = false; continue; }
            if (raw[i] === '\\') { esc = true; continue; }
            if (raw[i] === '"') { valEnd = i; break; }
          }
          if (valEnd > valStart) {
            const content = raw.substring(valStart, valEnd)
              .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\t/g, '\t');
            const hashMatch = raw.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
            const hashtags = hashMatch
              ? (hashMatch[1].match(/"([^"]+)"/g) || []).map(h => h.replace(/"/g, ''))
              : [];
            const imgMatch = raw.match(/"imagePrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            const imagePrompt = imgMatch ? imgMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : undefined;
            return { content, hashtags, imagePrompt };
          }
        }
      }
    } catch { /* fall through */ }
    // Last resort: strip JSON wrapper
    const stripped = raw
      .replace(/^\s*\{?\s*"content"\s*:\s*"?/i, '')
      .replace(/"?\s*,?\s*"hashtags"[\s\S]*$/i, '')
      .replace(/\\n/g, '\n').replace(/\\"/g, '"')
      .trim();
    return { content: stripped || 'Could not parse AI response.', hashtags: [] };
  };

  // Up to 3 attempts: generate → validate → reject if hallucinated → regenerate.
  // Lower temperature (0.5 not 0.8) to reduce invention without going stiff.
  let parsed: any;
  let attempt = 0;
  let lastReason = '';
  while (attempt < 3) {
    attempt++;
    const text = await callAI(prompt + (attempt > 1 ? `\n\nATTEMPT #${attempt} — your previous draft was rejected because: "${lastReason}". Do not repeat that mistake.` : ''), {
      temperature: attempt === 1 ? 0.5 : 0.35,
      maxTokens: 512,
      responseFormat: 'json',
    });
    parsed = parseRaw(text);
    if (typeof parsed.content !== 'string') break;
    // Layer A: regex detector (cheap, instant, catches known patterns)
    const regexViolation = detectFabrication(parsed.content, profileContext);
    if (regexViolation) { lastReason = regexViolation; console.warn(`[gemini] attempt ${attempt} rejected (regex): ${regexViolation}`); continue; }
    // Layer B: LLM judge (semantic — catches what regex misses). Only on attempts 1-2.
    if (attempt < 3) {
      const judgement = await judgePost(parsed.content, facts, profileContext || '');
      if (!judgement.pass) { lastReason = judgement.reason || 'judge flagged fabrication'; console.warn(`[gemini] attempt ${attempt} rejected (judge): ${lastReason}`); continue; }
    }
    break;
  }
  // Final scrub for anything that survived all attempts
  const limit = platform === 'Facebook' ? HASHTAG_LIMITS.facebook.optimal : HASHTAG_LIMITS.instagram.optimal;
  if (Array.isArray(parsed.hashtags) && parsed.hashtags.length > limit) {
    parsed.hashtags = parsed.hashtags.slice(0, limit);
  }
  if (typeof parsed.content === 'string') {
    parsed.content = scrubBannedPhrases(parsed.content);
  }
  return parsed;
};

// Detect fabricated content — fake testimonials, fake stats, fake events.
// Returns the offending phrase as a rejection reason, or null if clean.
// This is the LAST line of defence: prompt rules try to prevent these,
// retry logic gives the AI a second chance, and this catches everything else.
// LLM judge — semantic fabrication detection that the regex bank misses.
// Cheap (~$0.001 per call with Haiku at temp 0). Returns pass=true if the post
// is clean, or pass=false with a reason and an optional suggested rewrite.
// Defaults to PASS on any error so a flaky judge never blocks generation entirely.
async function judgePost(
  content: string,
  facts: ClientFact[],
  brandContext: string,
): Promise<{ pass: boolean; reason?: string }> {
  const factsText = facts.slice(0, 12)
    .map(f => `[${f.fact_type}] ${(f.content || '').substring(0, 180)}`)
    .join('\n') || '(no verified facts)';
  const prompt = `You are a strict editor. Reject any social media draft that invents specifics not in the verified data below. Reply with ONLY JSON.

DRAFT TO EVALUATE:
"""
${content}
"""

VERIFIED FACTS (the only allowed source for specific claims):
${factsText}

BRAND CONTEXT:
${(brandContext || '').substring(0, 1000)}

Score each rule 0 or 1:
- specifics_grounded: Every named customer/product/stat in the draft must appear in VERIFIED FACTS or BRAND CONTEXT. Generic phrases like "our customers" are OK; specific names/places/numbers must be sourced.
- no_invented_testimonials: NO fake customer quotes, names ("Sarah J", "a local cafe in Brisbane"), or made-up success stories.
- no_invented_stats: NO percentages, time-savings, multipliers, or counts unless they appear verbatim in BRAND CONTEXT or VERIFIED FACTS.
- no_fake_urgency: NO countdowns, "today only", "limited time", "ends tomorrow" unless a real event with date appears in VERIFIED FACTS.

Return: {"specifics_grounded":0|1,"no_invented_testimonials":0|1,"no_invented_stats":0|1,"no_fake_urgency":0|1,"reason":"one short sentence if any rule is 0, else empty"}`;
  try {
    // Hard timeout — one slow judge call must NEVER block the whole batch.
    // Promise.all of 21 judges blocked on a stalled fetch is what hung the
    // user's Saturation generation at 96% complete.
    const text = await Promise.race<string>([
      callAI(prompt, { temperature: 0, maxTokens: 300, responseFormat: 'json' }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('judge timeout 8s')), 8000)),
    ]);
    const result = JSON.parse(text);
    const allPass = result.specifics_grounded === 1
      && result.no_invented_testimonials === 1
      && result.no_invented_stats === 1
      && result.no_fake_urgency === 1;
    return { pass: allPass, reason: allPass ? undefined : (result.reason || 'judge flagged content') };
  } catch (e: any) {
    console.warn('[judge] failed (defaulting to pass):', e?.message);
    return { pass: true };
  }
}

// Module-scoped fabrication patterns. Hot path — called 1-2× per generated
// post (Smart Schedule batches up to 21 posts), so we don't want to recompile
// the array on every invocation. Each entry: [regex, human-readable reason].
const FAB_CHECKS: Array<[RegExp, string]> = [
  // Fake customer testimonials
  [/\b(?:a\s+)?(?:local|nearby|happy|recent)\s+(?:cafe|restaurant|business|client|customer|owner|food\s+truck|shop|store)\s+(?:in|from|at|near)?\s*[A-Z][a-z]+/i, 'invented customer testimonial'],
  [/\b(?:one\s+of\s+our|another)\s+(?:happy\s+)?(?:client|customer|user)/i, 'invented customer story'],
  // Invented quote: matches `<subject> says: "..."` but excludes rhetorical
  // anthropomorphizing like `It says: "..."`, `the stock photo says: "..."`
  // — those are figures of speech, not fake testimonials. Real fabrications
  // attribute to a human/customer/brand entity: `John says:`, `our customer
  // raved:`, `Sarah told us:`.
  [/\b(?<!\b(?:it|this|that|one|nothing|everything|message|photo|image|caption|post|content|feed|story|stock|generic|ad|advert|brand|tagline)\s)(?:says|told\s+us|reported|shared|raved)\s*[:,]?\s*["']/i, 'invented quote'],
  [/\b[A-Z][a-z]+\s+[A-Z]\.?\s*,\s*(?:from\s+)?[A-Z][a-z]+/i, 'fake testimonial signature (e.g. "Sarah J., Brisbane")'],
  // Fake statistics — match "45% increase" AND "by 45%" / "up to 45%" / "of 45%"
  // shapes. The "by" variant came up in real Penny Wise posts ("Boost
  // engagement by 45% with our new feature") and the original narrow regex
  // missed it.
  [/\b\d{1,3}(?:\.\d+)?%\s+(?:increase|boost|growth|improvement|more|less|reduction|saving|higher|lower|faster)/i, 'invented percentage statistic'],
  [/\b(?:by|of|up\s+to|reach(?:ing|ed)?|gain(?:ing|ed)?|boost(?:ing|ed)?\s+\w+\s+by)\s+\d{1,3}(?:\.\d+)?%/i, 'invented percentage statistic ("by X%" form)'],
  [/\bsaved\s+(?:them\s+)?\d+\s+(?:hours?|days?|weeks?|minutes?)/i, 'invented time-saving claim'],
  [/\b\d+x\s+(?:more|better|faster|increase|growth)/i, 'invented multiplier claim'],
  [/\b(?:over|more\s+than)\s+\d{2,}\s+(?:clients?|customers?|users?|businesses)/i, 'invented user count'],
  // 2026-05 audit additions: invented frequency/cadence claims (real Penny
  // Wise post: "Small business owners in Rockhampton are already posting
  // 7-14 times per week on autopilot")
  [/\b(?:already\s+)?posting\s+\d+(?:[-–]\d+)?\s+times?\s+(?:per|a)\s+(?:day|week|month)/i, 'invented posting-frequency claim'],
  [/\b(?:already\s+)?(?:get|gets|getting|generating|generated)\s+\d+(?:[-–]\d+)?\s+(?:more\s+)?(?:leads?|sales?|customers?|comments?|likes?|shares?|views?)/i, 'invented engagement-stat claim'],
  // 2026-05 SaaS follow-up: "generates 7-14 posts per week" / "writes 30
  // captions a month" — the marketing-claim verb form. Distinct from the
  // "posting NN times" shape above. The literal "7-14 posts/week" survives
  // (brand-guide preferred form) — only the verb-driven sentence form trips.
  [/\b(?:generates?|writes?|produces?|delivers?|creates?|cranks?\s+out)\s+\d+(?:[-–]\d+)?\s+(?:posts?|captions?|articles?|videos?|reels?)\s+(?:per|a|each)\s+(?:day|week|month)/i, 'invented content-generation cadence claim'],
  // 2026-05 audit additions: leading questions with implied stat (real Penny
  // Wise post: "How many hours could you reclaim this week?")
  [/\bHow\s+many\s+(?:hours?|days?|customers?|sales?|leads?)\s+could\s+you\s+(?:reclaim|save|gain|earn|get|win)/i, 'leading question with implied invented stat'],
  // Fake urgency / countdowns / events without source
  [/\b(?:today\s+only|this\s+weekend\s+only|limited\s+(?:time|spots)|hurry|act\s+now|don'?t\s+miss\s+out)/i, 'fake urgency'],
  [/\b(?:countdown|just\s+\d+\s+(?:hours?|days?)\s+left|ends\s+(?:tomorrow|tonight|soon))/i, 'invented countdown'],
];

export function detectFabrication(content: string, brandContext: string = ''): string | null {
  const ctxLower = brandContext.toLowerCase();
  for (const [pattern, reason] of FAB_CHECKS) {
    const match = content.match(pattern);
    if (!match) continue;
    // Brand-context whitelist: if the regex match is supported by the
    // user's provided brand context, it isn't fabrication — it's a real
    // product/business fact. Two checks:
    //   1. Full matched phrase appears verbatim in context (case-insensitive)
    //   2. Every numeric token in the match appears in context — handles
    //      paraphrasing like "generates 7-14 posts" vs context's "7-14 posts/week"
    if (ctxLower) {
      const matchLower = match[0].toLowerCase();
      if (ctxLower.includes(matchLower)) continue;
      const nums = match[0].match(/\d+(?:[-–]\d+)?/g);
      if (nums && nums.length > 0 && nums.every(n => ctxLower.includes(n))) continue;
    }
    return `${reason} ("${match[0]}")`;
  }
  // 2026-05 audit: structural cadence detector. Five or more consecutive
  // short declarative sentences (≤6 words each) is the AI rhythm signature.
  // Threshold was originally 3 but produced false positives on legitimate
  // 3-item feature lists ("AI writes your posts. Generates your images.
  // Publishes at the right time.") which are normal marketing copy. Bumped
  // to 5 so we only catch sustained AI rhythm, not natural punchy lists.
  // Semantic invention is still caught by the LLM judge (judgePost).
  const sentences = content.split(/[.!?]\s+/).filter(s => s.trim().length > 0);
  let consecutiveShort = 0;
  let maxRun = 0;
  for (const s of sentences) {
    const wordCount = s.trim().split(/\s+/).length;
    if (wordCount <= 6) {
      consecutiveShort++;
      if (consecutiveShort > maxRun) maxRun = consecutiveShort;
    } else {
      consecutiveShort = 0;
    }
  }
  if (maxRun >= 5) {
    return `AI cadence — ${maxRun} consecutive short sentences (≤6 words). Reads like a tech blog, not a small business.`;
  }
  return null;
}

// Catch banned phrases that slipped past the prompt. Replace with neutral
// alternatives or strip outright. Logs on every hit so quality can be tracked.
//
// 2026-05 deep audit: extended with patterns observed in real generated
// posts. The original list only caught explicit cliché phrases ("Want to
// boost your..."). The new patterns target the structural AI cadence —
// three-beat declarative rhythm, "No more X-ing at a Y" hypothetical,
// "Every X. Every Y. Every Z." anaphora, "Your best post goes live at 3 AM"
// AI-tutorial opener, and the buzzword soup ("channeled creative energy",
// "bespoke digital platforms"). These structural patterns are what makes
// posts read like AI even when no individual word is wrong.
const BANNED_PATTERNS: Array<[RegExp, string]> = [
  // ── Original list (explicit cliché phrases) ──
  [/\bWant to boost your [^?.!]+[?.!]/gi, ''],
  [/\bEngage with your audience!?/gi, ''],
  [/\bCheck out our website[^.!?]*[.!?]/gi, ''],
  [/\bVisit our website[^.!?]*[.!?]/gi, ''],
  [/\bLet [^.]+ handle the rest!?/gi, ''],
  [/\bIn today's (digital age|fast-paced world)[,.]?\s*/gi, ''],
  [/\bAs a business owner[,.]?\s*/gi, ''],
  [/\bStay ahead of the competition!?/gi, ''],
  [/\bTake your [^.!?]+ to the next level!?/gi, ''],
  [/\bExciting news!\s*/gi, ''],
  [/\bWe('?re| are) thrilled to announce[^.!?]*[.!?]\s*/gi, ''],
  // ── 2026-05 audit additions (structural AI cadence) ──
  // "Your best/top/favourite X goes live at 3 AM on a Tuesday. Nobody sees it."
  [/\bYour\s+(?:best|top|favourite|favorite)\s+\w+\s+goes\s+live\s+at\s+\d[^.!?]*[.!?]\s*(?:Nobody\s+sees\s+it[.!?]\s*)?/gi, ''],
  // "Nobody sees it. Timing is everything." — three-beat declarative rhythm
  [/\bNobody\s+sees\s+(it|them)[.!?]\s*Timing\s+is\s+everything[.!?]\s*/gi, ''],
  // "No more staring at a blank screen" / "No more wondering what to write"
  [/\bNo more (staring at a blank screen|wondering what to (write|post|say)|guessing|worrying about [^.!?]+)[^.!?]*[.!?]\s*/gi, ''],
  // "Every website coded. Every app custom-built. Every AI tool tailored." — anaphora.
  // Uses \S+ (any non-whitespace) so hyphenated words like "custom-built"
  // don't break the chain. \s* (zero-or-more) at the end so the trailing
  // sentence with no following space still gets stripped.
  [/(?:\bEvery\s+\S+(?:\s+\S+){0,3}[.!]\s*){2,}/gi, ''],
  // Buzzword soup: "channeled significant creative energy into bespoke digital platforms"
  [/\b(?:channell?ed|leveraged|elevated|curated|crafted)\s+(?:significant|considerable|substantial|incredible|powerful)\s+\w+(?:\s+\w+){0,2}\s+(?:into|to|towards)\s+(?:designing|building|creating|developing)\s+(?:bespoke|tailored|custom|cutting-edge|innovative)\s+\w+/gi, ''],
  // "bespoke digital platforms" / "bespoke AI solutions" — agency-pitch noun phrases
  [/\bbespoke\s+(digital\s+platforms?|ai\s+(?:tools?|solutions?|platforms?)|software\s+solutions?|web\s+experiences?)/gi, 'custom builds'],
  // "small business owners often/usually/post/struggle..." — generalising opener.
  // Widened 2026-05 follow-up: SocialAI's own self-promo posts used the bare
  // present-tense verb ("Small business owners post inconsistently because…")
  // which the older adverb-only regex missed. Sentence-anchored so it doesn't
  // chomp legitimate mid-sentence mentions like "we welcome small business owners".
  [/(?:^|[.!?]\s+)Small business owners\s+(?:often|usually|typically|always|never|rarely|post|struggle|find|don'?t|can'?t|miss|forget|wish|need|want|hate|love)\b[^.!?]+[.!?]\s*/gim, ''],
  // "Timing is everything." / "Consistency is everything." — empty epigram closers
  [/\b(Timing|Consistency|Authenticity|Quality|Strategy)\s+is\s+everything[.!?]\s*/gi, ''],
  // "X is the gap we close." / "That's the gap we close." — agency-speak
  [/\bThat'?s\s+the\s+gap\s+we\s+close[.!?]\s*/gi, ''],
  // "Making real differences." / "Making a real difference." — vague platitude
  [/\bMaking\s+(real|a\s+real)\s+difference[s]?[.!?]\s*/gi, ''],

  // ── 2026-05 SaaS-genre additions (observed in SocialAI Studio self-promo) ──
  // These target the agency-selling-SaaS marketing genre. Distinct from the
  // local-business cliches above. Brand-guide tension: $X/mo and 7-14
  // posts/week ARE legitimate brand facts — we strip only the trope
  // CONSTRUCTION around them, not the values themselves.

  // "Staring at a blank caption for 20 minutes?" — hyperbolic-stat opener
  [/\bStaring at (?:a|the|your) (?:blank|empty) \S+(?:\s+\S+){0,2} for \d+ (?:seconds?|minutes?|hours?)\b[^.!?]*[.!?]?\s*/gi, ''],
  // "Ready to reclaim those hours?" / "Ready to automate?" — rhetorical SaaS-CTA closer.
  // Closed verb list keeps legitimate openers like "Ready to order?" / "Ready to eat?"
  // safe. Sentence-anchored + case-sensitive `Ready` so mid-sentence lowercase
  // "are you ready to automate" doesn't false-positive — that smoke test bit me.
  [/(?:^|[.!?]\s+)Ready to (?:reclaim|automate|scale|simplify|streamline|transform|elevate|level\s+up|unlock|supercharge)\b[^.!?]*\?\s*/gm, ''],
  // "..., no lock-in" / "..., cancel anytime" — strips the SaaS pitch fragment
  // while preserving the price itself (which the brand guide tells the AI to use)
  [/\s*,\s*no\s+(?:lock-?in|contracts?|commitments?|credit\s+card\s+required|setup\s+fees?|hidden\s+fees?)\b[.!]?\s*/gi, ''],
  // "Your social media on autopilot" — abstract "X on autopilot" cliché.
  // Critical: the product is named "AI Content Autopilot" so we anchor on the
  // possessive "Your X on autopilot" shape, NOT bare "autopilot".
  // Optional leading "Ready to/Want to/Looking to <verb>" prefix so we strip
  // the whole rhetorical construction as one unit. Without this, a phrase
  // like "Ready to get your social media on autopilot?" left an orphan
  // "Ready to get?" CTA in the post after the trope was stripped.
  [/\b(?:(?:Ready|Want|Looking|Wondering)\s+to\s+\S+\s+)?your\s+(?:social\s+media|business|marketing|content|growth|sales)\s+on\s+autopilot\b[?.!]?\s*/gi, ''],
  // "Consistency without the burnout" / "Growth without the grind" — X-without-Y antipattern
  [/\b(?:Consistency|Growth|Scale|Success|Results|Quality|Productivity|Reach|Visibility)\s+without\s+(?:the\s+)?(?:burnout|chaos|stress|overwhelm|effort|work|grind|hassle|headache|complexity)\b[.!?]?\s*/gi, ''],
  // "Scale your agency without scaling your workload" — pun/wordplay marketing
  [/\b(?:Scale|Grow|Expand)\s+(?:your\s+\S+(?:\s+\S+){0,2}\s+)?without\s+scaling\b[^.!?]*[.!?]?\s*/gi, ''],
  // "That's not laziness—that's reality" — em-dash/hyphen parallel construction.
  // \S+ for hyphenated words; matches em-dash, en-dash, or plain hyphen.
  [/\bThat'?s\s+not\s+\S+(?:\s+\S+){0,3}\s*[—–-]\s*that'?s\s+\S+(?:\s+\S+){0,3}[.!?]\s*/gi, ''],
  // "Multi-client management, white-label client portals, centralized analytics" —
  // comma-separated SaaS feature list. Requires TWO of the list items to start
  // with a SaaS-flavour prefix so a normal "Monday, Wednesday, Friday" or
  // "burgers, salads, shakes" list can't accidentally trigger.
  [/\b(?:multi-?\S+|white-?label\s+\S+|centralised?\s+\S+|integrated\s+\S+|automated\s+\S+|streamlined\s+\S+|cross-?\S+|real-?time\s+\S+)\s+\S+,\s+(?:multi-?\S+|white-?label\s+\S+|centralised?\s+\S+|integrated\s+\S+|automated\s+\S+|streamlined\s+\S+|cross-?\S+|real-?time\s+\S+)\s+\S+,\s+(?:and\s+)?\S+/gi, ''],
  // "Managing multiple client social accounts?" — rhetorical opener with quantifier.
  // Requires a quantifier (multiple/several/all your/etc.) so we don't strip
  // legitimate sentences like "Managing your booking is easy."
  [/(?:^|[.!?]\s+)(?:Managing|Juggling|Handling|Running|Tracking|Wrangling)\s+(?:multiple|several|all\s+your|countless|too\s+many)\s+\S+(?:\s+\S+){0,3}\?\s*/gim, ''],
  // "Link in bio." / "Learn more—link in bio." — Facebook-inappropriate CTA
  // that's actually an Instagram cargo-culted phrase. Prompt-level guidance
  // already discourages this but doesn't always work; this is the safety net.
  [/\b(?:Learn\s+more\s*[—–-]\s*)?(?:Click\s+(?:the\s+)?)?link\s+in\s+bio\b[.!]?\s*(?=$|[.!?\s])/gim, ''],
];
export function scrubBannedPhrases(content: string): string {
  let out = content;
  for (const [pattern, replacement] of BANNED_PATTERNS) {
    // Single pass: replace() with a /g regex always scans from index 0, so we
    // skip the prior `test() then replace()` two-pass and just diff references
    // to know whether anything matched. Avoids both wasted work AND the
    // lastIndex-state footgun that comes with sharing /g regexes across
    // test()/replace() callsites.
    const next = out.replace(pattern, replacement);
    if (next !== out) {
      console.warn(`[gemini] scrubbing banned phrase: ${pattern}`);
      out = next;
    }
  }
  // Tidy double-spaces and stray punctuation left after deletions.
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

export const generateMarketingImage = async (prompt: string, businessType: string = 'small business'): Promise<string | null> => {
  // Helper: convert a remote image URL to a compressed data URL
  const urlToDataUrl = async (imageUrl: string): Promise<string | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(imageUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size < 1000 || !blob.type.startsWith('image')) return null;
      const dataUrl: string | null = await new Promise(r => {
        const reader = new FileReader();
        reader.onloadend = () => r(reader.result as string);
        reader.onerror = () => r(null);
        reader.readAsDataURL(blob);
      });
      return dataUrl ? await compressImage(dataUrl, 700, 0.65) : null;
    } catch { return null; }
  };

  // Single source of truth for the safety pipeline (validation + abstract-UI
  // detection + people-strip + canonical negative + fail-closed). Returns
  // null when the post should publish text-only.
  const safe = buildSafeImagePromptClient(prompt, businessType);
  if (!safe) return null;

  // ── 1. fal.ai FLUX Dev — primary, high-quality, photorealistic ────
  try {
    console.log('fal.ai FLUX →', prompt.substring(0, 80));
    const res = await fetch(`${AI_WORKER}/api/fal-proxy?action=generate-image`, {
      method: 'POST',
      headers: await aiAuthHeaders(),
      body: JSON.stringify({ prompt: safe.prompt, negativePrompt: safe.negativePrompt }),
    });
    const data = await res.json() as { imageUrl?: string; error?: string };
    if (res.ok && data.imageUrl) {
      console.log('fal.ai FLUX: success →', data.imageUrl.substring(0, 60));
      const img = await urlToDataUrl(data.imageUrl);
      if (img) return img;
    } else {
      console.warn('fal.ai FLUX failed:', data.error || res.status);
    }
  } catch (e: any) { console.warn('fal.ai FLUX error:', e?.message); }

  // ── 2. Pollinations.ai — free fallback ────────────────────────────
  const pollinationsFetch = async (shortPrompt: string): Promise<string | null> => {
    const encoded = encodeURIComponent(shortPrompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}&model=flux`;
    console.log('Pollinations.ai fallback →', shortPrompt.substring(0, 80));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await urlToDataUrl(url);
  };

  try {
    const shortPrompt = prompt.substring(0, 120).trim();
    const img = await pollinationsFetch(`${shortPrompt}, professional photography, sharp focus`);
    if (img) return img;
  } catch (e: any) { console.warn('Pollinations fallback:', e?.message); }

  return null;
};

/**
 * Same smart prompt logic as generateMarketingImage, but returns a public URL
 * instead of base64. Used by Accept All to persist images to D1.
 */
export const generateMarketingImageUrl = async (prompt: string, businessType: string = 'small business'): Promise<string | null> => {
  // Same shared safety pipeline as generateMarketingImage above — returns
  // null when the post should publish text-only (fail-closed).
  const safe = buildSafeImagePromptClient(prompt, businessType);
  if (!safe) return null;

  try {
    const res = await fetch(`${AI_WORKER}/api/fal-proxy?action=generate-image`, {
      method: 'POST',
      headers: await aiAuthHeaders(),
      body: JSON.stringify({ prompt: safe.prompt, negativePrompt: safe.negativePrompt }),
    });
    const data = await res.json() as { imageUrl?: string; error?: string };
    if (res.ok && data.imageUrl) return data.imageUrl;
  } catch { /* fall through */ }

  return null;
};

export interface VideoScript {
  script: string;
  shots: string[];
  mood: string;
  duration: string;
  hook: string;
  thumbnailPrompt: string;
  videoPrompt: string;
}

const DEFAULT_VIDEO_SCRIPT: VideoScript = { script: '', shots: [], mood: '', duration: '', hook: '', thumbnailPrompt: '', videoPrompt: '' };

export const generateVideoScript = async (
  topic: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string,
  caption: string,
  profile?: {
    description?: string;
    targetAudience?: string;
    uniqueValue?: string;
    productsServices?: string;
    socialGoal?: string;
    contentTopics?: string;
    location?: string;
  },
  hashtags?: string[],
  contentFormat?: string
): Promise<VideoScript> => {
  // Build rich business context
  const profileLines: string[] = [];
  if (profile?.description) profileLines.push(`Business description: ${profile.description}`);
  if (profile?.targetAudience) profileLines.push(`Target audience: ${profile.targetAudience}`);
  if (profile?.productsServices) profileLines.push(`Products/services: ${profile.productsServices}`);
  if (profile?.uniqueValue) profileLines.push(`Unique value: ${profile.uniqueValue}`);
  if (profile?.socialGoal) profileLines.push(`Social media goal: ${profile.socialGoal}`);
  if (profile?.location) profileLines.push(`Location: ${profile.location}`);
  if (profile?.contentTopics) profileLines.push(`Content topics & themes: ${profile.contentTopics}`);
  const profileContext = profileLines.length > 0 ? `\nBUSINESS CONTEXT:\n${profileLines.join('\n')}` : '';
  const hashtagContext = hashtags?.length ? `\nHashtags for this post: ${hashtags.join(', ')}` : '';
  const formatContext = contentFormat && contentFormat !== 'standard' ? `\nPost style: ${contentFormat} (match the video energy to this style)` : '';

  try {
    const prompt = `You are a senior video content strategist and creative director for "${businessName}", a ${businessType}.
Your job: create a COMPELLING short-form video brief for a ${platform} Reel that will stop the scroll and drive engagement.
${profileContext}

TOPIC: "${topic}"
ACCOMPANYING CAPTION: "${caption}"
TONE: ${tone}${hashtagContext}${formatContext}

DEEP THINKING REQUIRED:
- WHO is watching this? Consider the target audience and what visually grabs their attention
- WHAT action/scene would make this topic feel real, not abstract?
- WHERE should this video feel like it's set? (office, café, workshop, outdoors — pick something specific to this business)
- WHY would someone watch past the first 2 seconds? The hook must be irresistible
- Reference specific products, services, or scenarios from the business context above

ANTI-GENERIC RULES:
- NEVER include people, team members, staff, customers, or faces in any shot description — AI video of people looks terrible
- Focus on PRODUCTS, FOOD, SCREENS, TOOLS, ENVIRONMENTS — things that look good in AI video
- No stock-video-looking scenes. Every shot must feature a SPECIFIC product or item from this business
- The hook must provoke curiosity or emotion — not just state the topic
- Shots should show close-ups of products, smooth camera moves over scenes, timelapses, or screen recordings — NOT talking heads or people working
- ${getImagePromptExamples(businessType)} — use similar subjects for video shots

Return ONLY raw JSON, no markdown:
{
  "hook": "Opening 1-2 second hook — bold text overlay or dramatic visual that stops the scroll. Be specific.",
  "script": "Full spoken script / voiceover (30-60 seconds). Natural, conversational, matches the ${tone} tone. Reference specific products/services.",
  "shots": ["Shot 1: precise visual — camera angle, subject, action, setting, lighting", "Shot 2...", "Shot 3...", "Shot 4...", "Shot 5..."],
  "mood": "Music mood — specific genre + energy level, e.g. 'Lo-fi chill beats, medium tempo' or 'Upbeat indie pop, high energy'",
  "duration": "Recommended length, e.g. '30 seconds' or '45 seconds'",
  "thumbnailPrompt": "A 15-20 word vivid description of the perfect FIRST FRAME of this video. Must be visually striking, set the scene, and be specific to this business. Describe: subject, action, setting, lighting, colors, camera angle.",
  "videoPrompt": "A 20-30 word cinematic motion description for AI video generation. Describe: what moves, camera motion (pan/zoom/track), lighting changes, the key visual transition. Must match the first shot and be specific to this business topic."
}`;
    // 2026-05 audit: temp 0.85→0.55. Reels were drifting into invented
    // testimonials and oddly hot adjectives because of the high temp. 0.55
    // keeps creative variety without letting Claude fabricate stats/quotes.
    const raw = (await callAI(prompt, { temperature: 0.55, responseFormat: 'json' })).trim();
    const parsed = parseAiJson(raw);
    if (!parsed) return { ...DEFAULT_VIDEO_SCRIPT, script: 'Error generating brief.' };

    // Post-flight scrub: even with the ANTI-GENERIC RULES in the prompt, the
    // model occasionally smuggles people/hands/staff into shots and still
    // emits banned marketing tropes ("boost your brand!", "thrilled to
    // announce", etc.) into the spoken script. Run the same regex pass on
    // every text field of the brief so the downstream Kling i2v call doesn't
    // get a "person walking through café" prompt that produces an uncanny
    // human and so the spoken script doesn't read like a 2014 sales email.
    const stripPeople = (s: string) => s
      .replace(PEOPLE_REGEX_VIDEO, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .trim();

    const cleaned: VideoScript = {
      ...DEFAULT_VIDEO_SCRIPT,
      ...parsed,
      hook: scrubBannedPhrases(parsed.hook || ''),
      script: scrubBannedPhrases(parsed.script || ''),
      shots: Array.isArray(parsed.shots) ? parsed.shots.map((s: string) => stripPeople(scrubBannedPhrases(s || ''))) : [],
      thumbnailPrompt: stripPeople(parsed.thumbnailPrompt || ''),
      videoPrompt: stripPeople(parsed.videoPrompt || ''),
    };
    return cleaned;
  } catch (error: any) {
    return { ...DEFAULT_VIDEO_SCRIPT, script: `AI Error: ${error?.message?.substring(0, 100) || 'Unknown'}` };
  }
};

export const rewritePost = async (
  draft: string,
  instruction: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string
): Promise<{ content: string; hashtags: string[] }> => {
  try {
    const prompt = `You are an expert social media manager for "${businessName}", a ${businessType}. Tone: ${tone}.
The user wants to post on ${platform}.
Their draft or idea: "${draft}"
Instruction: ${instruction}
Rewrite or improve the post based on the instruction. Include relevant emojis and 5-10 relevant hashtags.
Return ONLY raw JSON with no markdown or code fences: {"content": "...", "hashtags": ["..."]}`;
    const raw = (await callAI(prompt, { temperature: 0.8, responseFormat: 'json' })).trim();
    const parsed = parseAiJson(raw) || { content: 'Error rewriting post.', hashtags: [] };
    // 2026-05 audit: the rewrite endpoint was unguarded — Smart Schedule's
    // generated posts go through scrubBannedPhrases (line 1802ish) but a
    // user-triggered Rewrite did not. Same banned-tropes pipeline now applies.
    if (parsed.content) parsed.content = scrubBannedPhrases(parsed.content);
    return parsed;
  } catch (error: any) {
    const msg = error?.message || String(error);
    return { content: `AI Error: ${msg.substring(0, 120)}`, hashtags: [] };
  }
};

export const analyzePostTimes = async (businessType: string, location: string) => {
  try {
    return await callAI(`What are the best times to post on Instagram and Facebook for a ${businessType} in ${location}? Give a concise bulleted list of 3 best time slots for the upcoming week.`);
  } catch {
    return "Could not analyze times.";
  }
};

export const generateRecommendations = async (businessName: string, businessType: string, stats: any) => {
  try {
    return (await callAI(`
        You are a social media strategist for "${businessName}", a ${businessType}.
        Stats: Followers: ${stats.followers}, Reach: ${stats.reach}, Engagement: ${stats.engagement}%, Posts: ${stats.postsLast30Days}.
        Provide 3 specific, high-impact recommendations. Format as a concise bulleted list.
      `)) || "No recommendations generated.";
  } catch {
    return "Unable to analyze stats at this time.";
  }
};

/** A 1-click action attached to a recommendation. The Insights UI renders a
 *  contextual button per action type and dispatches to the matching handler.
 *
 *  Action types (extend cautiously — frontend handler must exist):
 *    'generate-post'   — prefill Quick Post with topic + angle, take user there.
 *    'shift-pillars'   — propose a content-pillar update, save to profile, then
 *                        run a fresh Smart Schedule.
 *    'view-checklist'  — open an inline checklist modal (no AI). For non-AI
 *                        recs like "audit page visibility".
 *    'edit-profile'    — switch to Settings + scroll to a specific field.
 *    'generate-test'   — generate one experimental post in a different style
 *                        as a discrete A/B test, schedule for next slot.
 *
 *  payload shape varies per type — kept loose to avoid a versioning mess. */
export interface RecommendationAction {
  type: 'generate-post' | 'shift-pillars' | 'view-checklist' | 'edit-profile' | 'generate-test';
  label: string; // e.g. "Generate sample post" — drives the button label
  /** Loose payload. Examples per type:
   *    generate-post:   { topic: string, angle: string }
   *    shift-pillars:   { newPillars: string[], replacing?: string[] }
   *    view-checklist:  { items: string[] }
   *    edit-profile:    { field: 'description' | 'targetAudience' | 'productsServices' | 'tone', hint?: string }
   *    generate-test:   { topic: string, style: string } */
  payload?: Record<string, unknown>;
}

export interface InsightRecommendation {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  /** schema_v? — actionable 1-click. Optional for backward-compat with older
   *  insight reports persisted before the action field was added. */
  action?: RecommendationAction;
}

export interface InsightReport {
  summary: string;
  score: number;
  recommendations: InsightRecommendation[];
  bestTimes: Array<{ platform: string; slots: string[] }>;
  contentFocus: Array<{ topic: string; reason: string }>;
  quickWin: string;
  generatedAt: string;
}

const parseInsightJson = (raw: string): InsightReport => {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(sanitizeJson(match ? match[0] : trimmed)) as InsightReport;
  parsed.generatedAt = new Date().toISOString();
  return parsed;
};

export const generateInsightReport = async (
  businessName: string,
  businessType: string,
  location: string,
  stats: { followers: number; reach: number; engagement: number; postsLast30Days: number },
  recentTopics: string[]
): Promise<InsightReport | null> => {
  try {
    const prompt = `You are a senior social media strategist. Analyse this business and return a structured JSON insight report.

Business: "${businessName}" — ${businessType} based in ${location}.
Stats: ${stats.followers} followers, ${stats.reach} monthly reach, ${stats.engagement}% engagement rate, ${stats.postsLast30Days} posts last 30 days.
Recent post topics: ${recentTopics.length ? recentTopics.slice(0, 8).join(', ') : 'none yet'}.

Return ONLY this exact JSON structure, no markdown:
{
  "summary": "2-3 sentence plain-English overview of their current social media health and biggest opportunity",
  "score": <integer 1-100 representing overall social media health>,
  "recommendations": [
    {
      "title": "short action title",
      "detail": "1-2 sentence specific explanation",
      "priority": "high",
      "action": { /* see ACTION SCHEMA below — REQUIRED on every rec */ }
    }
  ],
  "bestTimes": [
    { "platform": "Facebook", "slots": ["Tuesday 12–1pm", "Thursday 7–8pm", "Sunday 9–10am"] },
    { "platform": "Instagram", "slots": ["Wednesday 11am–12pm", "Friday 5–6pm", "Saturday 8–9am"] }
  ],
  "contentFocus": [
    { "topic": "topic name", "reason": "why this will perform well for this business" }
  ],
  "quickWin": "One single action they can do TODAY to immediately improve engagement"
}

ACTION SCHEMA (every recommendation MUST include an "action" object — pick the type that best fits the recommendation):

  { "type": "generate-post",   "label": "Generate sample post", "payload": { "topic": "<one-line topic>", "angle": "<the specific reframe / hook the rec proposes>" } }
    Use when the rec is "write a post about X" or "shift content to Y angle".

  { "type": "shift-pillars",   "label": "Apply new content focus", "payload": { "newPillars": ["pillar 1", "pillar 2", "pillar 3"], "replacing": ["pillar A", "pillar B"] } }
    Use when the rec is structural (e.g. "stop posting about features, post about outcomes"). The button SAVES new pillars to the business profile.

  { "type": "view-checklist",  "label": "Open audit checklist", "payload": { "items": ["step 1 — concrete action", "step 2 — concrete action", "step 3"] } }
    Use when the rec needs the human to do something OFFLINE (audit page settings, contact a customer, set up a tool). 3-7 concrete steps.

  { "type": "edit-profile",    "label": "Update business description", "payload": { "field": "description" | "targetAudience" | "productsServices" | "tone", "hint": "<one-line suggested change>" } }
    Use when the rec is fundamentally a profile / positioning fix.

  { "type": "generate-test",   "label": "Schedule a test post", "payload": { "topic": "<topic>", "style": "<style descriptor: question, micro-story, behind-the-scenes, customer-pain, etc.>" } }
    Use when the rec is "try a different style" — generates one experimental post for A/B comparison.

Pick the action type that ACTUALLY MAKES THE REC ACTIONABLE — don't default to checklists. If the rec is "write more pain-point posts", use generate-post with a concrete topic/angle; don't use a checklist that says "think about pain points".`;

    const text = await callAI(prompt, { temperature: 0.4, maxTokens: 2000, responseFormat: 'json' });
    return parseInsightJson(text);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('generateInsightReport failed:', msg);
    throw new Error(msg);
  }
};

export const generateInsightReportFromPosts = async (
  businessName: string,
  businessType: string,
  location: string,
  posts: Array<{ message: string; created_time: string; likes: number; comments: number; shares: number }>
): Promise<InsightReport | null> => {
  try {
    const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
    const totalComments = posts.reduce((s, p) => s + p.comments, 0);
    const totalShares = posts.reduce((s, p) => s + p.shares, 0);
    const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
    const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
    const topPosts = [...posts].sort((a, b) => (b.likes + b.comments * 2 + b.shares * 3) - (a.likes + a.comments * 2 + a.shares * 3)).slice(0, 5);
    const worstPosts = [...posts].sort((a, b) => (a.likes + a.comments * 2 + a.shares * 3) - (b.likes + b.comments * 2 + b.shares * 3)).slice(0, 3);

    const postSummaries = topPosts.map(p => `"${p.message.substring(0, 120)}" — ${p.likes} likes, ${p.comments} comments, ${p.shares} shares`).join('\n');
    const worstSummaries = worstPosts.map(p => `"${p.message.substring(0, 80)}" — ${p.likes} likes, ${p.comments} comments`).join('\n');

    const prompt = `You are a senior social media analyst. You have been given REAL data from the Facebook page of "${businessName}" (${businessType} in ${location}).

ACTUAL PAGE DATA:
- Total posts analysed: ${posts.length}
- Average likes per post: ${avgLikes}
- Average comments per post: ${avgComments}
- Total shares: ${totalShares}
- Date range: ${posts[posts.length - 1]?.created_time?.split('T')[0] || 'unknown'} to ${posts[0]?.created_time?.split('T')[0] || 'unknown'}

TOP 5 PERFORMING POSTS (by engagement score):
${postSummaries}

3 LOWEST PERFORMING POSTS:
${worstSummaries}

Based on this REAL data, identify patterns: what content gets the most engagement, what falls flat, what topics resonate, and give specific actionable advice.

Return ONLY this exact JSON, no markdown:
{
  "summary": "2-3 sentence plain-English overview of their actual social media performance based on the real data, mentioning specific numbers",
  "score": <integer 1-100 representing overall social media health based on real engagement>,
  "recommendations": [
    {
      "title": "short action title based on real patterns found",
      "detail": "specific 1-2 sentence advice citing the actual data",
      "priority": "high",
      "action": { "type": "<one of: generate-post|shift-pillars|view-checklist|edit-profile|generate-test>", "label": "<button label>", "payload": { /* type-specific — see ACTION SCHEMA below */ } }
    }
  ],
  "bestTimes": [
    { "platform": "Facebook", "slots": ["inferred from post timestamps of top performing posts"] },
    { "platform": "Instagram", "slots": ["recommended times based on their audience patterns"] }
  ],
  "contentFocus": [
    { "topic": "topic pattern found in top posts", "reason": "why this is working for this business based on the data" }
  ],
  "quickWin": "One specific action based on the data patterns — e.g. replicate the approach of the top post"
}

ACTION SCHEMA (every recommendation MUST include an "action" object — pick the type that best fits):

  { "type": "generate-post",   "label": "Generate sample post", "payload": { "topic": "<one-line topic>", "angle": "<the specific reframe / hook the rec proposes>" } }
    Use when the rec is "write a post about X" or "shift content to Y angle".

  { "type": "shift-pillars",   "label": "Apply new content focus", "payload": { "newPillars": ["pillar 1", "pillar 2", "pillar 3"], "replacing": ["pillar A", "pillar B"] } }
    Use when the rec is structural (e.g. "stop posting about features, post about outcomes"). The button SAVES new pillars to the business profile.

  { "type": "view-checklist",  "label": "Open audit checklist", "payload": { "items": ["step 1 — concrete action", "step 2", "step 3"] } }
    Use when the rec needs the human to do something OFFLINE (audit page settings, contact a customer, etc.). 3-7 concrete steps.

  { "type": "edit-profile",    "label": "Update business description", "payload": { "field": "description" | "targetAudience" | "productsServices" | "tone", "hint": "<one-line suggested change>" } }
    Use when the rec is fundamentally a profile / positioning fix.

  { "type": "generate-test",   "label": "Schedule a test post", "payload": { "topic": "<topic>", "style": "<style descriptor>" } }
    Use when the rec is "try a different style" — generates one experimental post for A/B comparison.

Pick the type that ACTUALLY MAKES THE REC ACTIONABLE. If the rec is "write more pain-point posts", use generate-post with a concrete topic/angle; don't use a checklist.`;

    const text = await callAI(prompt, { temperature: 0.3, maxTokens: 2000, responseFormat: 'json' });
    return parseInsightJson(text);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('generateInsightReportFromPosts failed:', msg);
    throw new Error(msg);
  }
};

export const getPostingAdvice = async (platform: string) => {
  try {
    return await callAI(`Best times to post on ${platform} for a small business to maximize engagement. Keep it brief and return a short 1-sentence tip.`);
  } catch {
    return "Could not retrieve advice.";
  }
};

export const researchSocialTopic = async (query: string) => {
  try {
    return await callAI(`
        As a social media expert for a small business brand, research and provide specific advice on: "${query}".
        Provide 3 actionable bullet points.
        Keep the tone professional yet creative.
      `);
  } catch {
    return "Could not research topic.";
  }
};

export const analyzeSocialMetrics = async (metricName: string, value: string | number, businessType: string) => {
  try {
    return await callAI(`
        I run a ${businessType}. My social media page has a ${metricName} of ${value}.
        1. Is this good, average, or poor for this type of business?
        2. Give me 2 specific strategies to improve this number next week.
        Keep the answer concise and encouraging.
      `);
  } catch {
    return "Could not analyze metric.";
  }
};

export interface SmartScheduledPost {
  platform: 'Instagram' | 'Facebook';
  scheduledFor: string;
  topic: string;
  content: string;
  hashtags: string[];
  imagePrompt: string;
  reasoning: string;
  pillar: string;
  postType?: 'image' | 'video' | 'text';
  videoScript?: string;
  videoShots?: string;
  videoMood?: string;
  /** Set by the fabrication detector when a post contains content that survived
   * scrubbing (invented testimonials, fake stats, etc.). UI should highlight. */
  _needsReview?: boolean;
  _reviewReason?: string;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`AI response timed out after ${ms / 1000}s — try again or check your API key.`)), ms))]);

/**
 * Fetch a URL's text content via the Worker proxy for AI research.
 */
const fetchUrlContent = async (url: string): Promise<string> => {
  try {
    const res = await fetch(`${AI_WORKER}/api/web-fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json() as { text?: string; error?: string };
    if (data.text) return data.text;
    console.warn('[Web Fetch] Failed:', data.error);
    return '';
  } catch (e) {
    console.warn('[Web Fetch] Error:', e);
    return '';
  }
};

/**
 * Pre-research the campaign focus before generating posts.
 * If a URL is mentioned, actually fetches the page content and feeds it
 * to the AI so it can write posts based on real product data.
 */
const researchCampaignFocus = async (
  campaignFocus: string,
  businessName: string,
  businessType: string,
  profileDescription?: string,
  productsServices?: string,
): Promise<string> => {
  // Extract URLs from the campaign focus and fetch their content
  const urlMatch = campaignFocus.match(/https?:\/\/[^\s,]+|www\.[^\s,]+/gi);
  let websiteContent = '';
  if (urlMatch) {
    const urls = urlMatch.map(u => u.startsWith('www.') ? `https://${u}` : u);
    const fetched = await Promise.all(urls.slice(0, 2).map(fetchUrlContent));
    websiteContent = fetched.filter(Boolean).join('\n\n---\n\n');
    if (websiteContent) {
      console.log(`[Campaign Research] Fetched ${urls.length} URL(s), got ${websiteContent.length} chars`);
    }
  }

  const prompt = `You are a direct-response copywriter researching a campaign. NO fluff. NO vague marketing speak. Every sentence must contain a SPECIFIC fact, feature name, number, or concrete detail.

BUSINESS: "${businessName}" (${businessType})
${profileDescription ? `DESCRIPTION: ${profileDescription}` : ''}
${productsServices ? `PRODUCTS/SERVICES: ${productsServices}` : ''}

CAMPAIGN BRIEF FROM USER:
"${campaignFocus}"

${websiteContent ? `WEBSITE CONTENT (real data from the URL — use this as primary source):\n---\n${websiteContent}\n---\n` : ''}
RULES:
- Use ONLY facts from the business description, products/services, and website content above
- Name specific features (e.g. "AI Content Autopilot" not "our AI tool")
- Include specific numbers (e.g. "$29/mo" not "affordable pricing", "7-14 posts/week" not "regular posts")
- If the description mentions a URL, include it in CTAs
- NEVER write generic phrases like "boost your engagement", "take your business to the next level", "in today's digital world"

PRODUCE THIS BRIEF:

1. PRODUCT NAME & DESCRIPTION (2 sentences max — what is it, what does it do)
2. SPECIFIC FEATURES (list each by name with one-line description):
   - Feature 1: [name] — [what it does]
   - Feature 2: [name] — [what it does]
   - (list ALL features mentioned in the profile/website data)
3. PRICING: Exact prices and plan names if available
4. TARGET AUDIENCE: Who specifically + their #1 pain point
5. COMPETITOR COMPARISON: What's the alternative? (doing it manually, hiring a social media manager, etc.) How is this better?
6. POST ANGLES (7-10, each must spotlight a DIFFERENT specific feature):
   For each angle provide:
   - ANGLE NAME: e.g. "Feature: AI Content Autopilot"
   - HOOK (first line of the post): Must be a question or bold claim with a specific detail
   - KEY FACT to include in the post body
   - CTA: specific action (visit URL, sign up, try free, etc.)
   - IMAGE: describe a concrete visual — product screenshot, dashboard view, before/after, device mockup. NO people, NO stock photos.`;

  try {
    return await withTimeout(callAI(prompt, { temperature: 0.5, maxTokens: 3000 }), 45000);
  } catch (e) {
    console.warn('[Campaign Research] Failed:', e);
    return `Campaign focus: ${campaignFocus}`;
  }
};

export const generateSmartSchedule = async (
  businessName: string,
  businessType: string,
  tone: string,
  stats: any,
  postsToGenerate: number = 7,
  location: string = 'Australia',
  platforms: { facebook: boolean; instagram: boolean } = { facebook: true, instagram: true },
  saturationMode: boolean = false,
  richProfile?: {
    description?: string;
    targetAudience?: string;
    uniqueValue?: string;
    productsServices?: string;
    socialGoal?: string;
    contentTopics?: string;
  },
  includeVideos: boolean = false,
  scheduleMode: 'smart' | 'saturation' | 'quick24h' | 'highlights' = 'smart',
  onPhase?: (phase: 'researching' | 'writing') => void,
  campaignFocus?: string,
  activeCampaigns?: {
    name: string; type: string; startDate: string; endDate: string; rules: string; postsPerDay: number;
    // Persisted agentic-research brief (schema_v12). When present, the
    // post-writer uses this directly — skip the live researchCampaignFocus
    // call which was silently returning empty (worker route was missing).
    brief?: string; briefSummary?: string;
  }[],
  /** When provided, AI is restricted to citing only these scraped FB facts. */
  clientId?: string | null,
): Promise<{ posts: SmartScheduledPost[]; strategy: string }> => {
  // Pull verified FB-scraped facts up-front (cached for 5 min)
  const facts = await fetchClientFacts(clientId);
  const groundTruthBlock = buildGroundTruthBlock(facts);
  try {
    const now = new Date();
    const isQuick24h = scheduleMode === 'quick24h';
    const isHighlights = scheduleMode === 'highlights';
    const windowDays = saturationMode ? 7 : isQuick24h ? 1 : 14;
    const effectivePosts = isQuick24h ? Math.min(postsToGenerate, 5) : isHighlights ? Math.min(postsToGenerate, 5) : postsToGenerate;
    const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    // Sanity check: detect corrupted profile data (e.g. agency profile leaked into client workspace)
    // If the rich profile description/topics mention completely unrelated industries, discard it
    const isProfileCorrupted = (() => {
      if (!richProfile) return false;
      const profileText = [richProfile.description, richProfile.contentTopics, richProfile.productsServices].filter(Boolean).join(' ').toLowerCase();
      const bizLower = businessType.toLowerCase();
      // If the business is food/restaurant/catering but the profile talks about web design, AI, technology — it's corrupted
      const foodKeywords = ['bbq', 'restaurant', 'food', 'catering', 'deli', 'pickle', 'butcher', 'meat', 'café', 'cafe', 'bakery', 'bar', 'pub'];
      const techKeywords = ['web design', 'website builder', 'ai technology', 'social ai studio', 'social media intergration', 'social media integration'];
      const isFood = foodKeywords.some(k => bizLower.includes(k));
      const hasTechContent = techKeywords.some(k => profileText.includes(k));
      if (isFood && hasTechContent) {
        console.warn(`[Profile Sanity] Corrupted profile detected for "${businessName}" (${businessType}) — profile mentions tech/AI but business is food. Ignoring profile data.`);
        return true;
      }
      return false;
    })();
    const safeProfile = isProfileCorrupted ? undefined : richProfile;

    // Forward-declare campaignBrief so the prompt template can reference it
    let campaignBrief = '';

    // Build campaign injection block
    const campaignBlock = activeCampaigns?.length ? activeCampaigns.map(c => {
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      const daysToGo = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (86400000)));
      const daysIn = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (86400000)));
      const countdown = daysToGo <= 14 ? ` (${daysToGo} days to go!)` : daysIn <= 7 ? ` (just launched ${daysIn} days ago!)` : '';
      const imageLine = (c as any).imageNotes ? `\nCampaign image direction: ${(c as any).imageNotes}` : '';
      return `ACTIVE CAMPAIGN: "${c.name}" runs ${c.startDate} to ${c.endDate}${countdown}\nCampaign rules: ${c.rules}${imageLine}`;
    }).join('\n\n') : '';

    const profileBlock = [
      safeProfile?.description && `Business description: ${safeProfile.description}`,
      safeProfile?.targetAudience && `Target audience: ${safeProfile.targetAudience}`,
      safeProfile?.uniqueValue && `Unique value proposition: ${safeProfile.uniqueValue}`,
      safeProfile?.productsServices && `Products/services: ${safeProfile.productsServices}`,
      safeProfile?.socialGoal && `Social media goal: ${safeProfile.socialGoal}`,
      safeProfile?.contentTopics && `Preferred content topics: ${safeProfile.contentTopics}`,
      campaignBlock && `\n${campaignBlock}\nIMPORTANT: Weave the active campaign themes into your posts. Use countdown language where appropriate ("X days to go!", "Only X days left!", "Coming soon!"). At least 30% of posts should reference the campaign.`,
    ].filter(Boolean).join('\n');

    // Derive a more specific business type when the stored value is too generic (e.g. "small business")
    // Uses description and productsServices to infer the actual industry for better benchmark data and prompting.
    //
    // 2026-05 deep audit: removed the SaaS / "social media management" branch.
    // A customer USING our social-media tool will naturally type "we use a
    // social media management platform" in their description — the old branch
    // would silently rewrite their businessType to "SaaS & software", from
    // which the research call invented SaaS pillars ("Feature Showcase",
    // "Tips & Education for Small Business") and AI-marketing tropes. Real
    // SaaS companies should set businessType explicitly in onboarding.
    const effectiveBusinessType = (() => {
      const genericTerms = ['small business', 'business', 'company', 'service provider', 'local business'];
      if (!genericTerms.includes(businessType.toLowerCase().trim())) return businessType;
      const combined = ((safeProfile?.description || '') + ' ' + (safeProfile?.productsServices || '')).toLowerCase();
      // Customer-language guard: if the description talks about SERVING
      // customers, having a physical location, or trading hours, it's a
      // bricks-and-mortar SMB even if the description mentions software/AI
      // tools they use. Skip ALL inference branches in that case.
      const hasCustomerLanguage = /\b(our customers|we serve|drop in|come visit|trading hours|opening hours|in store|in-store|shopfront|located in|at our|find us|visit us|located at)\b/i.test(combined);
      if (hasCustomerLanguage) return businessType;
      // The PRODUCT-built branches stay — these only fire when the user is
      // ACTIVELY DESCRIBING what they sell, not what they use:
      if (combined.includes('web design') || combined.includes('web development') || combined.includes('website builder')) return 'web design & development';
      if (combined.includes('food') || combined.includes('restaurant') || combined.includes('cafe') || combined.includes('bbq') || combined.includes('catering')) return 'food & hospitality';
      if (combined.includes('fitness') || combined.includes('gym') || combined.includes('wellness') || combined.includes('health')) return 'health & wellness';
      if (combined.includes('law') || combined.includes('legal') || combined.includes('accounting') || combined.includes('bookkeep') || combined.includes('financial')) return 'professional services';
      if (combined.includes('trade') || combined.includes('plumb') || combined.includes('electric') || combined.includes('construct') || combined.includes('build')) return 'trades & construction';
      if (combined.includes('real estate') || combined.includes('property')) return 'real estate';
      if (combined.includes('retail') || combined.includes('shop') || combined.includes('store') || combined.includes('boutique')) return 'retail';
      // The OLD SaaS branch lived here. Removed per 2026-05 audit — the false
      // positives (customers being reclassified as SaaS because they
      // mentioned using a social-media tool) outweighed the rare correct
      // catch (an actual SaaS that left businessType=generic).
      return businessType;
    })();

    // ── Inject real research data ──
    const benchmarks = getIndustryBenchmarks(effectiveBusinessType, location);
    const benchmarkBlock = formatBenchmarksForPrompt(benchmarks.data, benchmarks.timezone);

    const researchPrompt = saturationMode ? `
You are a world-class social media growth strategist specialising in HIGH-FREQUENCY SATURATION posting for small businesses.

BUSINESS PROFILE:
- Name: "${businessName}" — ${businessType}
- Location: ${location}
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement rate, ${stats.reach} monthly reach
${profileBlock ? profileBlock : ''}

${benchmarkBlock}
${campaignFocus ? `\n🎯 CAMPAIGN FOCUS (HIGHEST PRIORITY — OVERRIDES ALL OTHER TOPIC RULES):\nThe user has explicitly requested ALL posts focus on: "${campaignFocus}"\n\n${campaignBrief ? `CAMPAIGN RESEARCH BRIEF (use this data to write specific, detailed posts):\n${campaignBrief}\n` : ''}\nRULES:\n- Every single post MUST be about "${campaignFocus}" — no exceptions\n- Use the CAMPAIGN RESEARCH BRIEF above as your primary source of facts, features, benefits, and angles\n- Each post must take a DIFFERENT angle from the brief (feature spotlight, success story, pain point, comparison, FAQ, behind-the-scenes, etc.)\n- Image prompts MUST show the product/service in action — screenshots, dashboards, devices showing the product, real scenarios. NOT generic stock photo people at desks\n- Hashtags must be relevant to "${campaignFocus}" specifically\n- DO NOT generate generic "visit our website" posts — each post must teach, show, or prove something specific\n- Include specific details, numbers, features — NOT vague marketing fluff\n` : `\nCRITICAL: ALL content pillars and topics MUST be about THIS ${businessType} business. NEVER suggest content about social media marketing, AI tools, web design, or technology. Every pillar must be something a ${businessType} business would actually post about.\n`}
YOUR TASK: Using the VERIFIED RESEARCH DATA above as your foundation, build a saturation campaign strategy for this specific ${businessType} business. You MUST use the researched posting times and days — do NOT invent different times. Adapt the content pillars and hashtags to this specific business while staying within the research guidelines.
1. Use the researched posting times from the data above — spread posts across those windows
2. CONTENT FATIGUE PREVENTION: How to post 3-5x/day without alienating followers
3. ALGORITHM MAXIMISATION: What content mix performs best for rapid reach growth
4. Hashtag counts: Facebook ${HASHTAG_LIMITS.facebook.optimal} (max ${HASHTAG_LIMITS.facebook.max}), Instagram ${HASHTAG_LIMITS.instagram.optimal} (max ${HASHTAG_LIMITS.instagram.max})
5. ENGAGEMENT HOOKS: What question formats and CTAs generate the most comments for this industry?

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "dailyPostingWindows": ["07:00", "10:00", "12:30", "16:00", "19:30"],
  "contentVarietyStrategy": "detailed strategy for varying content across 5 daily posts to prevent fatigue",
  "contentPillars": ["Pillar 1 (with description)", "Pillar 2", "Pillar 3", "Pillar 4", "Pillar 5", "Pillar 6", "Pillar 7"],
  "hashtagTiers": {
    "mega": ["#tag1", "#tag2"],
    "large": ["#tag1", "#tag2", "#tag3"],
    "medium": ["#tag1", "#tag2", "#tag3", "#tag4"],
    "niche": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
  },
  "imageStyle": "specific description of ideal image aesthetic for this business type and audience",
  "videoStyle": "description of ideal Reel/short video style if applicable",
  "platformSplit": { "facebook": 40, "instagram": 60 },
  "saturationTactics": "2-3 sentence tactical description specific to this business type",
  "bestContentMix": "exact ratio e.g. 30% promotional, 25% educational, 25% entertainment, 20% behind-the-scenes — with reasoning",
  "engagementHooks": ["hook1", "hook2", "hook3"],
  "localHashtags": ["#localTag1", "#localTag2", "#localTag3"]
}` : `
You are a world-class social media strategist and content researcher for small businesses.

BUSINESS PROFILE:
- Name: "${businessName}" — ${businessType}
- Location: ${location}
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement rate, ${stats.reach} monthly reach, ${stats.postsLast30Days} posts last 30 days
${profileBlock ? profileBlock : ''}

${benchmarkBlock}
${campaignFocus ? `\n🎯 CAMPAIGN FOCUS (HIGHEST PRIORITY — OVERRIDES ALL OTHER TOPIC RULES):\nThe user has explicitly requested ALL posts focus on: "${campaignFocus}"\n\nRULES:\n- Every single post MUST be about "${campaignFocus}" — no exceptions\n- Describe what "${campaignFocus}" is, its benefits, features, pricing, use cases, success stories, comparisons, how-to guides, testimonials\n- If you don't know details about "${campaignFocus}", use the business profile description and products/services above to fill in specifics\n- Image prompts MUST show the product/service in action — screenshots, dashboards, devices showing the product, happy customers using it. NOT generic stock photo people at desks\n- Hashtags must be relevant to "${campaignFocus}" specifically\n- DO NOT generate generic "visit our website" posts — each post must teach, show, or prove something specific about "${campaignFocus}"\n` : `\nCRITICAL: You are creating content for "${businessName}", which is a ${businessType}. ALL content pillars, topics, and posts MUST be about THIS business. NEVER generate content about social media marketing, AI tools, web design, or technology.\n`}
YOUR TASK: Using the VERIFIED RESEARCH DATA above as your foundation, refine the strategy for this specific ${businessType} business. You MUST use the researched posting times and best days — do NOT invent different times. Adapt content pillars to this specific business.

1. POSTING TIMES: Use the researched times from the data above. Do NOT change them unless you have a strong, specific reason for this exact business.
2. BEST DAYS: Use the researched days from the data above.
3. CONTENT PILLARS: Adapt the recommended pillars to this specific business — use their products, services, and audience.
4. Hashtag counts: Facebook ${HASHTAG_LIMITS.facebook.optimal} (max ${HASHTAG_LIMITS.facebook.max}), Instagram ${HASHTAG_LIMITS.instagram.optimal} (max ${HASHTAG_LIMITS.instagram.max}). Do NOT exceed these limits.

4. HASHTAG RESEARCH: Produce a 4-tier hashtag strategy (mega/large/medium/niche) tailored to ${businessType} in ${location}. Include local area hashtags. Research which hashtags are actively used by the target audience.

5. POST FORMAT MIX: What ratio of image posts vs text posts performs best for this business type on Facebook and Instagram currently?

6. CAPTION STYLE: What caption length, structure, and call-to-action format produces highest engagement for this industry? (e.g. question at end, story format, list format, etc.)

7. PLATFORM SPLIT: Based on where ${richProfile?.targetAudience || 'this audience'} is most active, what % of posts should go to Facebook vs Instagram?

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "bestPostingTimes": ["HH:MM", "HH:MM", "HH:MM", "HH:MM"],
  "bestDays": ["Day1", "Day2", "Day3", "Day4"],
  "worstDays": ["Day1", "Day2"],
  "contentPillars": [
    {"name": "Pillar Name", "description": "why this pillar works for this business", "postFrequency": "2x/week"},
    {"name": "Pillar Name", "description": "...", "postFrequency": "1x/week"}
  ],
  "hashtagTiers": {
    "mega": ["#tag1", "#tag2"],
    "large": ["#tag1", "#tag2", "#tag3"],
    "medium": ["#tag1", "#tag2", "#tag3", "#tag4"],
    "niche": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
    "local": ["#locationTag1", "#locationTag2", "#locationTag3"]
  },
  "imageStyle": "specific description of the ideal image aesthetic, lighting, composition for this business type",
  "videoStyle": "ideal Reel format, length, style, and hooks for this business type",
  "captionStyle": "optimal caption length, structure, CTA format for this industry",
  "platformSplit": { "facebook": 40, "instagram": 60 },
  "postFormatMix": { "image": 50, "video": 30, "text": 20 },
  "engagementTips": "the single most impactful engagement tactic proven for this business type",
  "localHashtags": ["#localTag1", "#localTag2", "#localTag3"],
  "contentTopicsToAvoid": ["topic1", "topic2"]
}`;

    // Fallbacks use REAL research data instead of arbitrary defaults
    const bd = benchmarks.data;
    const saturationFallback = {
      dailyPostingWindows: bd.bestPostingTimes.facebook,
      contentVarietyStrategy: bd.contentMix.description,
      contentPillars: bd.contentMix.pillars,
      hashtagThemes: bd.hashtagStrategy.sampleHashtags.industry.slice(0, 5),
      imageStyle: 'vibrant, clean background with natural lighting',
      platformSplit: { facebook: 40, instagram: 60 },
      saturationTactics: 'Post at every peak window daily, alternating content types so each post feels fresh.',
      bestContentMix: bd.contentMix.ratio
    };
    const normalFallback = {
      bestPostingTimes: bd.bestPostingTimes.facebook,
      bestDays: bd.bestDays.facebook,
      contentPillars: bd.contentMix.pillars,
      hashtagThemes: bd.hashtagStrategy.sampleHashtags.industry.slice(0, 5),
      imageStyle: 'vibrant, clean background with natural lighting',
      platformSplit: { facebook: 40, instagram: 60 },
      engagementTips: bd.engagementNotes
    };

    // ── Campaign Focus deep research (if provided) ──
    if (campaignFocus) {
      onPhase?.('researching');
      campaignBrief = await researchCampaignFocus(
        campaignFocus, businessName, businessType,
        safeProfile?.description, safeProfile?.productsServices
      );
      console.log('[Campaign Research] Brief generated:', campaignBrief.substring(0, 200));
    }

    // If activeCampaigns carry pre-computed briefs (agentic-campaigns
    // schema_v12), prefer those over the live researchCampaignFocus call.
    // Concatenate so multiple overlapping campaigns each contribute their
    // angles. This is the durable, deterministic path — the live call above
    // stays as a fallback for the legacy single-string `campaignFocus` arg.
    if (!campaignBrief && activeCampaigns?.length) {
      const persistedBriefs = activeCampaigns
        .filter(c => c.brief && c.brief.trim().length > 50)
        .map(c => `## Campaign: ${c.name}\n${c.briefSummary ? `> ${c.briefSummary}\n\n` : ''}${c.brief}`);
      if (persistedBriefs.length) {
        campaignBrief = persistedBriefs.join('\n\n────────\n\n');
        console.log('[Campaign Research] Using', persistedBriefs.length, 'persisted brief(s) — total chars:', campaignBrief.length);
      }
    }

    // ── Build structured campaign rules block (from Campaigns feature) ──
    let structuredCampaignBlock = '';
    if (activeCampaigns && activeCampaigns.length > 0) {
      const today = new Date();
      structuredCampaignBlock = '\n🎯 ACTIVE CAMPAIGNS (weave these into the content calendar):\n' +
        activeCampaigns.map(c => {
          const end = new Date(c.endDate);
          const daysLeft = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
          const countdownNote = c.type === 'countdown' ? ` — ${daysLeft} days to go! Include countdown language.` : '';
          return `• ${c.name} (${c.type}${countdownNote})\n  Dates: ${c.startDate} to ${c.endDate}\n  Rules: ${(c.rules || '').substring(0, 500)}\n  Target: ${c.postsPerDay} post(s) per day about this campaign`;
        }).join('\n') +
        '\nIMPORTANT: Campaign posts should feel natural alongside regular content — not every post needs to be about the campaign, but ' +
        `at least ${activeCampaigns.reduce((sum, c) => sum + c.postsPerDay, 0)} post(s) per day MUST reference active campaigns.\n`;
      console.log('[Campaigns] Injecting', activeCampaigns.length, 'active campaign(s) into prompt');
    }

    let research: any = {};
    onPhase?.('researching');
    try {
      const researchText = await withTimeout(callAI(researchPrompt, { temperature: 0.5, maxTokens: 4096, responseFormat: 'json' }), 90000);
      const researchParsed = parseAiJson(researchText);
      if (researchParsed) research = researchParsed;
    } catch {
      research = saturationMode ? saturationFallback : normalFallback;
    }

    let fbCount: number;
    let igCount: number;
    if (platforms.facebook && !platforms.instagram) {
      fbCount = effectivePosts; igCount = 0;
    } else if (platforms.instagram && !platforms.facebook) {
      igCount = effectivePosts; fbCount = 0;
    } else {
      igCount = Math.round(effectivePosts * (research.platformSplit?.instagram || 60) / 100);
      fbCount = effectivePosts - igCount;
    }

    const postsPerDay = saturationMode ? Math.ceil(effectivePosts / windowDays) : null;

    // Validate posting times — reject anything outside 6:00 AM – 9:30 PM
    const isReasonableTime = (t: string): boolean => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return false;
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const totalMins = h * 60 + min;
      return totalMins >= 360 && totalMins <= 1290; // 6:00 AM to 9:30 PM
    };
    const rawWindows = saturationMode
      ? (research.dailyPostingWindows || saturationFallback.dailyPostingWindows)
      : (research.bestPostingTimes || normalFallback.bestPostingTimes);
    const postingWindows = (rawWindows as string[]).filter(isReasonableTime);
    // If ALL researched times were unreasonable, use safe defaults
    if (postingWindows.length === 0) {
      postingWindows.push(...(saturationMode
        ? saturationFallback.dailyPostingWindows
        : normalFallback.bestPostingTimes));
    }

    const buildHashtagPool = (r: any) => {
      const tiers = r.hashtagTiers;
      if (!tiers) return (r.hashtagThemes || []).join(', ');
      return [
        tiers.mega?.join(' ') || '',
        tiers.large?.join(' ') || '',
        tiers.medium?.join(' ') || '',
        tiers.niche?.join(' ') || '',
        tiers.local?.join(' ') || '',
        (r.localHashtags || []).join(' '),
      ].filter(Boolean).join(' | ');
    };

    const hashtagPool = buildHashtagPool(research);
    const pillarsForPrompt = saturationMode
      ? (research.contentPillars || saturationFallback.contentPillars)
      : (research.contentPillars?.map((p: any) => typeof p === 'object' ? p.name : p) || normalFallback.contentPillars);

    const videoCount = includeVideos ? Math.max(1, Math.round(effectivePosts * 0.3)) : 0;
    const videoInstructions = includeVideos ? `
VIDEO POST RULES (${videoCount} posts should be "video" type Reels):
- Set "postType": "video" for these posts
- Provide "videoScript": a punchy 30-60 second spoken script with hook, body, CTA
- Provide "videoShots": numbered shot list (e.g. "1. Close-up of product being used, 3 seconds...")
- Provide "videoMood": music mood/genre recommendation (e.g. "Upbeat pop, 120BPM, energetic")
- Ideal Reel style: ${research.videoStyle || 'fast-paced, trending audio, product/service in action'}
- "imagePrompt" should describe the thumbnail/cover frame for the Reel
For image posts, set "postType": "image". For pure text posts, set "postType": "text".` : '';

    const nowTimeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    const quick24hExtra = isQuick24h ? `
MODE: QUICK 24HR BURST — Current time is ${nowTimeStr} on ${now.toISOString().split('T')[0]}. Schedule ALL posts at least 30 minutes from now, within the next 24 hours. Do NOT schedule anything at or before ${nowTimeStr} today — those times have already passed. Use only researched time slots that are still in the future. Generate punchy, high-engagement content designed for immediate interaction.` : '';
    const highlightsExtra = isHighlights ? `
MODE: HIGHLIGHTS ONLY — schedule posts ONLY at the absolute top 3 researched time slots across the 14-day window. Quality over quantity. Each post must be polished, pillar-defining, and perfectly timed. No filler — every post must be your single best recommendation for that pillar.` : '';

    const regionalVoiceBlock = buildRegionalVoiceBlock(location);

    const prompt = saturationMode ? `
You are an elite social media growth operator running a SATURATION CAMPAIGN for "${businessName}", a ${effectiveBusinessType}.
Tone: ${tone}. Location: ${location}. Current date/time: ${now.toISOString().split('T')[0]} ${nowTimeStr} — do NOT schedule any post before this time today.
Campaign window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]} (${windowDays} days).
Audience stats: ${stats.followers} followers, ${stats.engagement}% engagement, ${stats.reach} monthly reach.
${regionalVoiceBlock}${groundTruthBlock}${profileBlock ? `\nBUSINESS CONTEXT (use these specifics — do not invent details not listed here):\n${profileBlock}\n` : ''}${structuredCampaignBlock}
CRITICAL: ALL posts must feature SPECIFIC products, services, or outcomes from "${businessName}" as listed in the business context above. Use real product names, real features, real results. Do NOT invent campaigns, countdown language, or stats not in the business context.${!includeVideos ? '\nIMPORTANT: Do NOT generate any video/Reel posts. EVERY post MUST be postType="image" — never "text". Image posts get 2-3x more Facebook reach than text-only.' : ''}
SATURATION RESEARCH (apply precisely):
- Daily time windows: ${postingWindows.join(', ')} — use ALL of them, never repeat same time on same day
- Content variety strategy: ${research.contentVarietyStrategy || saturationFallback.contentVarietyStrategy}
- Content pillars — ROTATE ALL: ${pillarsForPrompt.join(' | ')}
- Hashtag pool (mix ALL tiers per post, Facebook: ${HASHTAG_LIMITS.facebook.optimal}, Instagram: ${HASHTAG_LIMITS.instagram.optimal}): ${hashtagPool || (saturationFallback as any).hashtagThemes?.join(', ')}
- Local hashtags to include: ${(research.localHashtags || []).join(', ')}
- Image aesthetic: ${research.imageStyle || saturationFallback.imageStyle}
- Saturation tactics: ${research.saturationTactics || saturationFallback.saturationTactics}
- Content mix: ${research.bestContentMix || saturationFallback.bestContentMix}
- Engagement hooks to use: ${(research.engagementHooks || []).join(' | ')}
- Platform split: ${fbCount} Facebook posts, ${igCount} Instagram posts
${videoInstructions}
ABSOLUTE RULES:
1. Exactly ${postsToGenerate} posts total (${fbCount} Facebook, ${igCount} Instagram${videoCount > 0 ? `, ${videoCount} Reels/Videos` : ''}).
2. Spread ~${postsPerDay} posts per day. Distribute evenly across all ${windowDays} days.
3. NEVER schedule two posts at the same time on the same day.
4. Each day: different pillars AND different post styles. Rotate through these styles across posts: question, quick-tip, micro-story, behind-the-scenes, poll/this-or-that, list/carousel, soft-promo, bold-opinion.
5. Every caption must use a strong hook in the FIRST LINE (question, bold statement, or shocking stat). NEVER start with "Exciting news!" or generic filler.
6. Hashtags: Facebook: ${HASHTAG_LIMITS.facebook.optimal}, Instagram: ${HASHTAG_LIMITS.instagram.optimal}, mix mega+large+medium+niche+local tiers. NO generic or repeated sets.
7. imagePrompt: MUST name the EXACT product from this post — pick from these compositions: ${getImagePromptExamples(effectiveBusinessType)}. Format: "[exact product name] on [specific surface], [lighting], [camera angle]". NEVER use vague words like "produce", "items", "products", "goods", "delicious food". NEVER include people, hands, faces. ${bd.imagePromptAvoid}
7b. VISUAL VARIETY MANDATE — across this batch of ${postsToGenerate} posts, NO TWO imagePrompts may share the same composition, subject framing, or setting. Rotate through DIFFERENT camera angles (overhead, side, macro, wide, action), DIFFERENT subjects (single item, group, environment, detail, abstract), and DIFFERENT lighting (DEFAULT to bright daylight; only pick golden hour / moody / soft window when the post tone explicitly calls for it). If you catch yourself reaching for the same fallback (notepad on a desk, laptop on a desk, coffee cup beside a planner, generic workspace flatlay) for ANY post in this batch, STOP and pick a totally different scene — outdoor, in-situ, in-action — from the examples above.
8. ANTI-GENERIC: Every sentence must earn its place. Reference specific products, location, or audience. Write like a human, not a press release.
9. SPECIFICITY MANDATE: Each post MUST contain at least ONE of: (a) a named product/service, (b) a specific measurable outcome, or (c) a location reference. Vague posts must be rewritten.
10. BANNED PHRASES — never use: "Engage with your audience!", "Check out our website!", "Want to boost your [anything]?", "Visit our website for more tips!", "Let [product] handle the rest!", "In today's digital age", "As a business owner", "Stay ahead of the competition". Rewrite with concrete specifics.
10b. NEVER NAME TECH VENDORS, MODELS, OR INFRASTRUCTURE the customer doesn't need to see. Forbidden: "fal.ai", "FLUX", "OpenAI", "GPT", "Claude", "Anthropic", "Gemini", "DALL-E", "Midjourney", "Stable Diffusion", "OpenRouter", "Cloudflare Workers", "D1", "R2", "our LLM", "our model", "powered by [vendor]". Even if the brand context mentions them, STRIP them from the post — speak about the FEATURE the customer experiences, not the plumbing. Vendor parentheticals like "(powered by …)" are forbidden in all forms.
11. NO FAKE URGENCY — Only use countdown language if a real ACTIVE CAMPAIGN with specific dates was listed above. Never invent campaigns or deadlines.

Respond with ONLY a valid JSON object — no markdown, no code fences:
{
  "strategy": "3-sentence saturation strategy summary citing specific research findings",
  "posts": [
    {
      "platform": "Facebook",
      "postType": "image",
      "scheduledFor": "${now.toISOString().split('T')[0]}T07:00:00",
      "topic": "short topic label",
      "content": "full post caption with hook, body, CTA, emojis",
      "hashtags": ["#mega", "#large", "#medium", "#niche", "#local"],
      "imagePrompt": "vivid, specific image description matching the aesthetic",
      "reasoning": "content pillar used + time window chosen + why this format at this time",
      "pillar": "exact content pillar name",
      "videoScript": "(only for video postType) 30-60 second spoken script with hook, body, CTA",
      "videoShots": "(only for video postType) numbered shot list e.g. 1. Close-up of product, 3s...",
      "videoMood": "(only for video postType) music mood/genre e.g. Upbeat pop, 120BPM"
    }
  ]
}` : `
You are an elite social media strategist writing a data-driven content calendar for "${businessName}", a ${effectiveBusinessType}.
Tone: ${tone}. Location: ${location}. Current date/time: ${now.toISOString().split('T')[0]} ${nowTimeStr} — do NOT schedule any post before this time today.
Schedule window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]}.
Audience stats: ${stats.followers} followers, ${stats.engagement}% engagement, ${stats.reach} monthly reach.
${regionalVoiceBlock}${groundTruthBlock}${profileBlock ? `\nBUSINESS CONTEXT (use these specifics — do not invent details not listed here):\n${profileBlock}\n` : ''}${structuredCampaignBlock}${quick24hExtra}${highlightsExtra}
CRITICAL: ALL posts must feature SPECIFIC products, services, or outcomes from "${businessName}" as listed in the business context above. Use real product names, real features, real results — never generic marketing advice that could apply to any business. Do NOT invent campaigns, countdown language, or stats that are not in the business context above.${!includeVideos ? '\nIMPORTANT: Do NOT generate any video/Reel posts. All posts must be "image" or "text" type only. Set "postType" to "image" or "text" — never "video".' : ''}
RESEARCH INSIGHTS — apply every finding precisely:
- Peak posting times: ${postingWindows.join(', ')} (researched for this business type + location)
- Best days: ${(research.bestDays || normalFallback.bestDays).join(', ')} | Avoid: ${(research.worstDays || []).join(', ')}
- Content pillars: ${pillarsForPrompt.join(' | ')}
- Caption style: ${research.captionStyle || 'conversational, question at end, 3-4 sentences max'}
- Image aesthetic: ${research.imageStyle || 'vibrant, natural lighting, authentic'} 
- Hashtag pool (mix ALL tiers, Facebook: ${HASHTAG_LIMITS.facebook.optimal}, Instagram: ${HASHTAG_LIMITS.instagram.optimal}): ${hashtagPool || (normalFallback as any).hashtagThemes?.join(', ')}
- Local hashtags to include: ${(research.localHashtags || []).join(', ')}
- Platform split: ${fbCount} Facebook, ${igCount} Instagram
- Post format mix: ${JSON.stringify(includeVideos ? (research.postFormatMix || { image: 70, video: 30 }) : { image: 100 })} — DEFAULT TO IMAGE POSTS. Only use postType="text" if a post genuinely cannot be illustrated (rare). Image posts get 2-3x more reach than text on Facebook in 2026.
- Key engagement tactic: ${research.engagementTips || 'Ask a question every post'}
${videoInstructions}
RULES:
1. Exactly ${effectivePosts} posts (${fbCount} Facebook, ${igCount} Instagram${videoCount > 0 ? `, ${videoCount} Reels` : ''}).
2. Schedule ONLY on the best days listed above, at the researched peak times.
3. Rotate through ALL content pillars — no pillar used more than twice in a row.
4. VARY POST STYLES: Rotate through these across the calendar: question, quick-tip, micro-story, behind-the-scenes, poll/this-or-that, list/carousel, soft-promo, bold-opinion. No two consecutive posts should use the same style.
5. Each caption: strong hook first line, body matching the caption style, specific CTA last line. NEVER start with "Exciting news!" or generic corporate filler.
6. Hashtags: Facebook posts get EXACTLY ${HASHTAG_LIMITS.facebook.optimal} hashtags (max ${HASHTAG_LIMITS.facebook.max}). Instagram posts get EXACTLY ${HASHTAG_LIMITS.instagram.optimal} hashtags (max ${HASHTAG_LIMITS.instagram.max}). DO NOT exceed these limits. Vary per post.
7. imagePrompt: MUST name the EXACT product from this post — pick from these compositions: ${getImagePromptExamples(effectiveBusinessType)}. Format: "[exact product name] on [specific surface], [lighting], [camera angle]". NEVER use vague words like "produce", "items", "products", "goods", "delicious food". NEVER include people, hands, faces. ${bd.imagePromptAvoid}
7b. VISUAL VARIETY MANDATE — across this batch of ${postsToGenerate} posts, NO TWO imagePrompts may share the same composition, subject framing, or setting. Rotate through DIFFERENT camera angles (overhead, side, macro, wide, action), DIFFERENT subjects (single item, group, environment, detail, abstract), and DIFFERENT lighting (DEFAULT to bright daylight; only pick golden hour / moody / soft window when the post tone explicitly calls for it). If you catch yourself reaching for the same fallback (notepad on a desk, laptop on a desk, coffee cup beside a planner, generic workspace flatlay) for ANY post in this batch, STOP and pick a totally different scene — outdoor, in-situ, in-action — from the examples above.
8. reasoning: cite the exact research finding that informed this post's time, day, pillar, and format choice.
9. ANTI-GENERIC: Every sentence must earn its place. Reference specific products, services, location details, or audience insights. Write like a real human talking to friends, not a corporate press release.
10. SPECIFICITY MANDATE: Each post MUST name a real product/service/feature from the business context above, OR reference the business's actual location. Generic sentences that could apply to any business must be rewritten or cut. DO NOT invent statistics — only cite numbers if they appear verbatim in the business context.
11. BANNED PHRASES — never use any of these: "Engage with your audience!", "Check out our website!", "Want to boost your [anything]?", "Visit our website for more tips!", "Let [product] handle the rest!", "In today's digital age", "As a business owner", "Stay ahead of the competition", "Take your [X] to the next level", "We're excited to announce". If you catch yourself writing these, stop and rewrite with a concrete specific detail instead.
11b. NEVER NAME TECH VENDORS, MODELS, OR INFRASTRUCTURE the customer doesn't need to see. Forbidden: "fal.ai", "FLUX", "OpenAI", "GPT", "Claude", "Anthropic", "Gemini", "DALL-E", "Midjourney", "Stable Diffusion", "OpenRouter", "Cloudflare Workers", "D1", "R2", "our LLM", "our model", "powered by [vendor]". Even if the brand context mentions them, STRIP them from the post — speak about the FEATURE the customer experiences, not the plumbing. Vendor parentheticals like "(powered by …)" are forbidden in all forms.
12. NO FAKE URGENCY — Only use countdown language ("Only X days left!", "X days to go!") if a real ACTIVE CAMPAIGN with specific start/end dates was listed in the business context above. Never invent campaigns, deadlines, or limited-time offers.
13. NO INVENTED CUSTOMERS — You have ZERO testimonials, reviews, or customer stories. NEVER write phrases like "A local cafe in [city] said...", "Rockhampton owner saw...", "One of our happy clients...", "A customer told us...", or any fake testimonial signature like "Sarah J., Brisbane". You don't have these — don't make them up.
14. NO INVENTED STATISTICS — You have ZERO analytics data. NEVER write "increased by X%", "saved X hours", "X% boost", "Xx more leads", "over X clients", or any other invented number. Every number you write must already appear in the business context above. When in doubt, write the qualitative benefit instead ("helps you post consistently" not "increases engagement by 30%").

Respond with ONLY a valid JSON object — no markdown, no code fences:
{
  "strategy": "3-sentence strategy summary citing the key research findings (times, pillars, hashtag approach)",
  "posts": [
    {
      "platform": "Facebook",
      "postType": "image",
      "scheduledFor": "${now.toISOString().split('T')[0]}T09:00:00",
      "topic": "short topic label",
      "content": "full post caption with hook, body, CTA, relevant emojis",
      "hashtags": ["#mega", "#large", "#medium", "#niche", "#local"],
      "imagePrompt": "vivid, specific, production-quality image description",
      "reasoning": "exact research insight that drove this: pillar + time + day + format choice",
      "pillar": "content pillar name from researched list",
      "videoScript": "(only for video postType) 30-60 second spoken script with hook, body, CTA",
      "videoShots": "(only for video postType) numbered shot list e.g. 1. Close-up of product, 3s...",
      "videoMood": "(only for video postType) music mood/genre e.g. Upbeat pop, 120BPM"
    }
  ]
}`;

    onPhase?.('writing');
    // Video posts with scripts/shots need much more output tokens than the default 2048
    // Each post in JSON form is ~600-800 tokens (content + hashtags + imagePrompt
    // + reasoning + pillar). Claude Haiku 4.5 is more verbose than Gemini Flash.
    // Allocate ~700/post + 1500 overhead, capped at Anthropic's 16k output limit.
    // (Was previously 6144 — caused mid-JSON truncation on Saturation 21-post runs.)
    const tokensPerPost = includeVideos ? 1100 : 750;
    const outputTokens = Math.min(16384, 1500 + effectivePosts * tokensPerPost);
    // Lowered temperature 0.75 → 0.55: enough creativity, less invention.
    const scheduleText = await withTimeout(callAI(prompt, { temperature: 0.55, maxTokens: outputTokens, responseFormat: 'json' }), 180000);
    const data = parseAiJson(scheduleText) || { posts: [], strategy: '' };
    let posts: SmartScheduledPost[] = Array.isArray(data.posts) ? data.posts : [];

    // ── Hallucination defence: regex scan + LLM judge per post.
    // Regex runs instantly. Judges fire in BATCHES OF 5 (not 21-at-once) so we
    // don't hit the worker's 30/min user rate limit and one stall doesn't block
    // all the rest. Each judge has an 8s timeout (see judgePost).
    //
    // Auto-recovery: when a post fails regex OR judge, regenerate it via
    // generateSocialPost (which has its own 3-attempt retry-with-feedback loop)
    // before falling back to _needsReview. Without this, bulk-generated posts
    // get exactly one shot — and any caught by the cadence/judge surface as
    // "Needs review" banners in the UI. With this, the user only sees that
    // banner for posts that survived 4 attempts total (1 bulk + 3 single).
    const processOne = async (p: any) => {
      if (typeof p.content !== 'string') return p;
      let flagReason: string | null = null;
      const regexViolation = detectFabrication(p.content, profileBlock);
      if (regexViolation) {
        p.content = scrubBannedPhrases(p.content);
        if (detectFabrication(p.content, profileBlock)) flagReason = regexViolation;
      } else {
        p.content = scrubBannedPhrases(p.content);
      }
      if (!flagReason) {
        try {
          const judgement = await judgePost(p.content, facts, profileBlock || '');
          if (!judgement.pass) flagReason = judgement.reason || 'judge flagged content';
        } catch { /* judge failure should never block */ }
      }
      if (!flagReason) return p;

      // Flagged — try one auto-recovery pass via the single-post generator,
      // which retries 3× internally with the rejection reason fed back to AI.
      console.warn(`[gemini] bulk post flagged ("${flagReason}") — auto-recovering via generateSocialPost`);
      try {
        const recovered = await generateSocialPost(
          p.topic || p.pillar || 'general',
          p.platform,
          businessName,
          effectiveBusinessType,
          tone,
          safeProfile,
          undefined,
          clientId,
        );
        if (recovered?.content && !detectFabrication(recovered.content, profileBlock)) {
          p.content = scrubBannedPhrases(recovered.content);
          if (Array.isArray(recovered.hashtags) && recovered.hashtags.length > 0) p.hashtags = recovered.hashtags;
          if (recovered.imagePrompt) p.imagePrompt = recovered.imagePrompt;
          // Reasoning was about the original (flagged) draft — clear so the
          // UI doesn't show stale commentary that no longer matches the body.
          p.reasoning = '';
          return p;
        }
      } catch (e) {
        console.warn('[gemini] auto-recovery failed:', e);
      }

      // Recovery also failed — surface for human review as last resort.
      p._needsReview = true;
      p._reviewReason = flagReason;
      return p;
    };
    // Concurrency-limited batching (5 at a time)
    const judged: any[] = [];
    const BATCH = 5;
    for (let i = 0; i < posts.length; i += BATCH) {
      const slice = posts.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(processOne));
      judged.push(...results);
    }
    posts = judged;

    // Format a Date as local time string (NOT UTC) — "YYYY-MM-DDTHH:MM:SS"
    const toLocalISO = (d: Date): string => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    // Ensure no post is scheduled in the past or at unreasonable hours.
    const thirtyMinsFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    posts = posts.map((post) => {
      if (!post.scheduledFor) return post;

      // Parse the scheduledFor — treat as local time (no Z suffix)
      const raw = post.scheduledFor.replace('Z', '');
      const t = new Date(raw);

      // Fix unreasonable hours (before 6 AM or after 9:30 PM) — move to nearest sensible time
      const h = t.getHours();
      const totalMins = h * 60 + t.getMinutes();
      if (totalMins < 360) { // before 6:00 AM → move to 9:00 AM same day
        t.setHours(9, 0, 0, 0);
      } else if (totalMins > 1290) { // after 9:30 PM → move to 9:00 AM next day
        t.setDate(t.getDate() + 1);
        t.setHours(9, 0, 0, 0);
      }

      if (t >= thirtyMinsFromNow) {
        return { ...post, scheduledFor: toLocalISO(t) };
      }
      // Keep the same HH:MM:SS but advance by whole days until it clears the threshold
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysToAdd = Math.ceil((thirtyMinsFromNow.getTime() - t.getTime()) / msPerDay);
      const bumped = new Date(t.getTime() + daysToAdd * msPerDay);
      return { ...post, scheduledFor: toLocalISO(bumped) };
    });

    // Reasoning ↔ scheduledFor consistency pass. The AI is instructed to
    // "cite the exact research finding that informed this post's day" — and
    // it tends to write boilerplate like "Friday is tier-1 best day" even
    // when the post is actually scheduled for Saturday (because Friday was
    // already taken, or the date range started after Friday, or it just
    // hallucinated). Rewriting that claim post-hoc keeps the reasoning
    // honest without throwing away the rest of the explanation (hook style,
    // body, CTA reasoning) that's usually still valuable.
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    posts = posts.map((post) => {
      if (!post.scheduledFor || typeof post.reasoning !== 'string' || !post.reasoning) return post;
      const t = new Date(post.scheduledFor.replace('Z', ''));
      if (isNaN(t.getTime())) return post;
      const actualDay = DAY_NAMES[t.getDay()];
      // Pattern matches "Friday is tier-1 best day", "Friday is the best day",
      // "Friday is tier 2 day", etc. — flexible enough to catch the usual
      // template variations without false-matching unrelated copy.
      const dayClaim = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+is\s+(?:the\s+)?(?:tier-?\s?\d\s+)?(?:best\s+)?day\b\.?/gi;
      const reasoning = post.reasoning.replace(dayClaim, (full, claimedDay: string) => {
        if (claimedDay.toLowerCase() === actualDay.toLowerCase()) return full;
        return `${actualDay} chosen for posting.`;
      });
      return reasoning === post.reasoning ? post : { ...post, reasoning };
    });

    return { posts, strategy: data.strategy || '' };
  } catch (error: any) {
    console.error("Smart Schedule Error:", error);
    return { posts: [], strategy: `Error: ${error?.message || 'Unknown'}` };
  }
};
