// Single source of truth for FLUX prompt constants + abstract-UI detection.
//
// Imported by:
//   - src/services/gemini.ts                  (frontend)
//   - workers/api/src/lib/image-safety.ts     (worker / cron / proxy)
//
// Previously these constants were duplicated in both files behind a
// "KEEP IN SYNC" comment. The worker copy of FLUX_NEGATIVE_PROMPT drifted
// out of sync with the frontend for weeks (missing anti-dark tokens), which
// let every cron-generated image ship with no anti-dark defense. The bug
// was only caught visually after the fact.
//
// Sharing the module from a repo-root `shared/` directory removes the drift
// failure mode entirely. Both tsconfigs add `shared` to `include` so type
// checking works on both sides.

// FLUX negative-prompt — passed as a SEPARATE `negative_prompt` parameter
// to fal.ai, NOT appended onto the positive prompt. (Inline negations like
// "no hands" don't suppress concepts in diffusion models — they often pull
// the negated subject INTO the image because the noun becomes a strong
// contextual cue. fal.ai/flux/dev accepts top-level `negative_prompt` and
// respects it properly when guidance_scale ≥ 5.)
export const FLUX_NEGATIVE_PROMPT = 'people, faces, hands, fingers, person, portrait, smiling, posing, staff, customer, chef, owner, team, hand-held, holding, text, watermark, signature, UI, app screen, dashboard, chart, graph, table, infographic, diagram, pricing tier, comparison grid, landing page, marketing graphic, logo, illustration, drawing, cartoon, 3D render, studio lighting, glossy plastic, excessive steam, dark, underexposed, low-light, dim, shadowed, gloomy, harsh shadows, blown-out highlights, monotone scene, blurry, out of focus, motion blur, soft focus, low resolution, pixelated, grainy';

// Positive-prompt style suffix — appended to every safe-built prompt. The
// "candid iPhone" token is a worker tripwire (proxies.ts logs a warn when
// a prompt comes in without it). Anti-blur and anti-dark cues live in the
// dedicated negative_prompt above; this suffix biases toward bright daylight
// + sharp focus for default scrollable feed aesthetic.
export const FLUX_STYLE_SUFFIX = 'candid iPhone photo taken at the venue, BRIGHT natural daylight, well-exposed, sharp focus, crisp detail, airy, slightly imperfect framing, real-world wear and texture, 1:1 square format';

// People-mention regex — defense-in-depth scrub of positive prompts. The
// dedicated FLUX_NEGATIVE_PROMPT field is the real enforcement; this strip
// catches lingering subject words before they reach the diffusion model.
export const PEOPLE_REGEX = /\b(woman|women|man|men|person|people|portrait|face|faces|facial|smiling|smile|looking|standing|sitting|holding|posing|gazing|wearing|chef|farmer|barista|customer|owner|team|staff|employee|worker|girl|boy|lady|guy|couple|family|child|children|hand|hands|finger|fingers|happy|customers|interior shot)\b/gi;

// Test whether a prompt needs to be swapped for a fallback scene before
// being sent to FLUX. Returns true when the prompt is missing, too short to
// be descriptive, a single word, a literal "N/A" / "none", looks like a
// title rather than a scene description, uses overly vague generic terms,
// or is describing a digital UI (handled by isAbstractUIPrompt below).
//
// Callers pick the appropriate fallback (neutral SAFE_FALLBACK_SCENES on
// the worker side, archetype-aware pickExampleScene on the frontend side).
//
// This is the shared definition of "what's a bad prompt" — previously
// duplicated between buildSafeImagePromptClient (strict) and the worker's
// buildSafeImagePrompt (weak: only length < 5). The weaker worker check
// let abstract/title-case prompts ship to FLUX from the cron path.
export function needsSafeFallback(prompt: string): boolean {
  if (!prompt) return true;
  // Missing, too short, single word, or literal placeholder text
  if (prompt.length < 15 || !/\s/.test(prompt) || /^(N\/A|none|null|undefined)$/i.test(prompt)) return true;
  // "Coffee Shop" / "Bella's Bakery" — title-case ≤5 words is a business
  // NAME, not a scene description
  if (/^[A-Z][a-z]+ [A-Z&]/.test(prompt) && prompt.split(' ').length <= 5) return true;
  // Vague generic terms in a short prompt — these almost always come from
  // the LLM lazily wrapping the topic in non-specific nouns
  if (/\b(produce|items|products|goods|things|stuff|showcase|journey|tips|stories)\b/i.test(prompt) && prompt.split(' ').length < 8) return true;
  // Abstract UI / dashboard / infographic prompts
  if (isAbstractUIPrompt(prompt)) return true;
  return false;
}

// Test whether a prompt is describing a digital interface, chart, infographic,
// or comparison grid — situations where FLUX produces a blurry pricing-table
// mockup instead of a photographable scene.
//
// The regex requires a UI-context noun (pricing|comparison|feature|bar|pie|
// line|architecture…) before ambiguous words. Always-bad terms (dashboard,
// infographic, etc.) match bare. This shape avoids false positives on
// legitimate small-business phrases like "meal plan", "wine tier",
// "tea table", "fence grid", "centre column".
export function isAbstractUIPrompt(prompt: string): boolean {
  if (/\b(dashboard|infographic|wireframe|mockup|landing page|website screenshot|screenshot|logo design|3D render|marketing graphic|app screen|app screens|UI|UX|user interface)\b/i.test(prompt)) return true;
  if (/\b(pricing|comparison|feature)\s+(table|tier|grid|plan|chart|page|column|tiers|grids|plans|charts|pages|columns)\b/i.test(prompt)) return true;
  if (/\b(bar|pie|line|data|stat|stats)\s+(chart|graph|charts|graphs)\b/i.test(prompt)) return true;
  if (/\b(architecture|flow|org|system|workflow)\s+(diagram|diagrams)\b/i.test(prompt)) return true;
  if (/\b(an?\s+|the\s+)?(illustration|diagram|infographic)\s+(of|showing|depicting|with)\b/i.test(prompt)) return true;
  return false;
}

// ── Abstract-UI → photographable scene rewrite ───────────────────────────
//
// Background: SaaS posts that LITERALLY are about a dashboard / screenshot
// were previously detected by isAbstractUIPrompt() and nuked — replaced
// wholesale by a generic SAFE_FALLBACK_SCENES entry that has nothing to do
// with the post topic. The result was 3 recent posts where the caption was
// specific (multi-client agency dashboard / AI captions / behind-the-scenes
// app dev) but the image was a closed laptop on a white desk.
//
// Fix: instead of nuking, REWRITE the UI noun as a photographable scene
// anchored to physical context. FLUX renders a real iPhone photo of a phone
// screen instead of attempting (and failing) a vector UI mockup.
//
// Approach is deterministic string templates keyed off the UI noun. We
// always anchor to a physical surface (marble desk, hand-held, overhead
// daylight) so FLUX produces a photo, not a wireframe.
//
// Returns the rewritten prompt, or null if no rewrite applies (caller
// falls back to the SAFE_FALLBACK_SCENES path). The `caption` arg is
// reserved for future caption-aware rewrites; not used yet but kept on
// the signature so callers don't need to refactor when we add it.
export function rewriteAbstractUIAsPhotography(
  prompt: string,
  _caption?: string | null,
): string | null {
  if (!prompt) return null;
  const lc = prompt.toLowerCase();

  // Order matters: more specific patterns first. The first match wins so
  // a "comparison dashboard screenshot" gets the comparison treatment
  // rather than the generic dashboard rewrite.

  // ── Multi-item comparison (two/three/four ... side-by-side) ──
  if (/\b(comparison|side[\s-]by[\s-]side|two|three|four)\b/i.test(prompt)
      && /\b(dashboard|screenshot|app|screen|interface|pricing|table|column|tier|plan)\b/i.test(prompt)) {
    return 'two smartphones lying side-by-side on a marble desk, each displaying a colorful tile grid, soft overhead daylight, candid flatlay';
  }

  // ── Chart / graph / analytics / data visualisation ──
  if (/\b(bar|pie|line)\s+(chart|graph)\b/i.test(prompt)
      || /\b(chart|graph|analytics|data\s+vis|metric)\b/i.test(prompt)) {
    return 'smartphone resting on a marble desk displaying a colorful bar graph with bright accent bars, overhead daylight, candid flatlay';
  }

  // ── Pricing / feature table ──
  if (/\b(pricing|feature)\s+(table|tier|grid|plan|chart|page|column)/i.test(prompt)) {
    return 'smartphone on a marble desk displaying a three-column pricing card layout with subtle pastel accents, overhead daylight, candid flatlay';
  }

  // ── Architecture / flow / workflow diagram ──
  if (/\b(architecture|flow|workflow|org|system)\s+(diagram|map)\b/i.test(prompt)
      || /\bdiagram\s+(of|showing|depicting)/i.test(prompt)) {
    return 'open notebook on a wooden desk with a hand-drawn flow diagram in pen, ceramic mug beside it, overhead daylight';
  }

  // ── Infographic ──
  if (/\binfographic\b/i.test(prompt)) {
    return 'smartphone on a marble desk displaying a clean tile grid with colorful icons, overhead daylight, candid flatlay';
  }

  // ── Landing page / website screenshot ──
  if (/\b(landing\s+page|website\s+screenshot|webpage)\b/i.test(prompt)) {
    return 'laptop open on a wooden desk displaying a colorful website hero with a bold accent stripe, ceramic mug beside it, overhead daylight';
  }

  // ── App screen / mobile UI / interface ──
  if (/\b(app\s+screen|mobile\s+app|interface|UI|UX|user\s+interface)\b/i.test(prompt)) {
    return 'smartphone resting on a marble desk displaying a colorful app interface with bright tile cards, overhead daylight, candid flatlay';
  }

  // ── Dashboard (generic catchall) ──
  if (/\bdashboard\b/i.test(lc)) {
    return 'smartphone on a marble desk displaying a colorful tile grid with bright accent panels, overhead daylight, candid flatlay';
  }

  // ── Screenshot (generic catchall — used last so more specific patterns
  //    above get a chance to fire first) ──
  if (/\bscreenshot\b/i.test(prompt)) {
    return 'smartphone resting on a marble desk displaying a colorful app screen with bright tile cards, overhead daylight, candid flatlay';
  }

  // ── Wireframe / mockup ──
  if (/\b(wireframe|mockup)\b/i.test(prompt)) {
    return 'open notebook on a wooden desk with hand-drawn UI sketches in pen, smartphone beside it, overhead daylight';
  }

  // ── 3D render / marketing graphic / logo design ──
  if (/\b(3D\s+render|marketing\s+graphic|logo\s+design)\b/i.test(prompt)) {
    return 'open notebook on a wooden desk with colorful brand swatches and a brass pen, overhead daylight';
  }

  // No rewrite applied — caller should fall back to SAFE_FALLBACK_SCENES.
  return null;
}
