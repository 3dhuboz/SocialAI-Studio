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
