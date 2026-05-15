// Image-prompt safety + archetype guardrails for the FLUX call.
//
// Extracted from src/index.ts as Phase B step 4 of the route-module split
// (see WORKER_SPLIT_PLAN.md). All pure functions / pure data — no Env, no
// DB, no fetch. Callers (cron prewarm, JIT publish, manual backfill,
// fal-proxy) supply the raw prompt + optional archetype slug and get back
// a sanitised { prompt, negativePrompt } pair ready for fal.ai.
//
// FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX, PEOPLE_REGEX, and isAbstractUIPrompt
// live in shared/flux-prompts.ts so the frontend (gemini.ts) and worker share
// a single source of truth. Re-exported here so existing import paths keep
// working without churn.
//
// The archetype resolver (resolveArchetypeSlug) lives in index.ts because
// it needs Env to query the DB — keeping this module pure makes it
// trivially testable.

import {
  FLUX_NEGATIVE_PROMPT,
  FLUX_STYLE_SUFFIX,
  PEOPLE_REGEX,
  isAbstractUIPrompt,
} from '../../../../shared/flux-prompts';

export { FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX, isAbstractUIPrompt };

// ── Neutral-scene fallback bank ──────────────────────────────────────────
// Used when isAbstractUIPrompt matches and we need to swap a UI/dashboard/
// screenshot prompt for something photographable. Previously a single
// fallback ('calm tidy desk with morning daylight…') made every cron-
// regenerated promo post look identical AND was a poor match for non-tech
// businesses. This bank gives the cron a randomised, varied set of
// candid-looking scenes that work across most SMB industries (cafes, IT,
// salons, real estate, etc.) without committing to a specific subject.
export const SAFE_FALLBACK_SCENES = [
  'calm tidy desk with morning daylight, plant and open notebook beside closed laptop, real-world wear and texture',
  'overhead flatlay of an open notebook, ceramic mug and pen on a linen runner, soft daylight',
  'minimal home office windowsill with potted plant and warm sunrise light through a window',
  'matte black smartphone face-down on a marble surface beside an espresso cup, top-down, morning light',
  'close-up of a leather-bound journal and brass pen on a wooden desk, golden hour shadows',
  'aerial view of a beige aesthetic workspace with notebook, pen, plant and closed laptop',
  'abstract texture of warm afternoon sunlight casting shadows across a textured wall',
  'cosy reading corner with stacked books, mug and a folded throw blanket, candid composition',
];

// isAbstractUIPrompt, FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX are imported
// + re-exported from shared/flux-prompts.ts at the top of this file.

// ── Archetype-aware image guardrails (2026-05-11 cross-domain bleed fix) ──
//
// Bug history: posts for SocialAI Studio (a SaaS/agency business) kept being
// generated with restaurant/candlelit-food imagery. Root cause: the frontend's
// archetype classifier influences the CAPTION prompt only — the resulting
// `image_prompt` it stores can still drift to food/agriculture/etc. when the
// LLM hallucinates a scene. The image-gen pipeline was archetype-blind: it
// just took whatever `image_prompt` was stored and shipped it.
//
// This map adds a per-archetype safety net. When generateImageWithBrandRefs
// detects the stored prompt contains subjects forbidden for that archetype,
// it swaps the prompt for a neutral archetype-appropriate fallback scene and
// extends the FLUX negative_prompt with the archetype's avoid-list.
//
// Keep `forbidden` patterns tight — false positives swap a perfectly good
// prompt for a generic fallback, which makes posts look samey. Tune by
// running the smoke tests and reviewing the archetype regression suite.
export const ARCHETYPE_IMAGE_GUARDRAILS: Record<string, {
  forbidden: RegExp;
  extraNegatives: string;
  fallbackScenes: string[];
}> = {
  'tech-saas-agency': {
    forbidden: /\b(?:food|restaurant|plated|plating|dining|kitchen|meal|breakfast|lunch|dinner|cuisine|cocktail|wine|pastry|pastries|loaf|loaves|sourdough|farm|paddock|livestock|cattle|sheep|tractor|crops|harvest|bbq|brisket|smoker|smoked|grill|grilled|charcoal|gym|treadmill|barbell|dumbbell|massage|salon|spa|garage|engine|axle|wrench)\b/i,
    extraNegatives: 'food, plate, plated, restaurant, dining, kitchen, meal, beverage, candlelit, rustic wood board, bbq, smoker, grill, agriculture, farm, livestock, gym, yoga mat, automotive, garage',
    fallbackScenes: [
      // Generic workspace — neutral fallback
      'modern co-working studio with closed laptop on a clean desk, soft abstract blue and purple gradient on the wall behind, geometric paper shapes scattered, morning daylight',
      'overhead flatlay of an open notebook, smartphone face-down, ceramic mug and pen on a matte white desk, soft natural daylight',
      'minimal home office windowsill with a small potted plant, closed laptop and geometric wall art, sunrise light through window',
      'sleek desk corner with brushed metal lamp, leather notebook and brass pen, golden hour shadows across the surface',
      // Pain Points / time-pressure / problem posts — chaos, urgency, overwhelm
      'close-up of an analogue wall clock face against a white background, stark bright daylight, minimal composition',
      'overhead flatlay of a desk buried in overlapping sticky notes in multiple colours, pens scattered, bright overhead light',
      'crammed weekly planner open flat with every time slot filled in pencil, corner slightly crumpled, soft daylight',
      'stack of unread manila folders and dog-eared notebooks teetering on a white desk corner, bright natural light',
      // Solution / success / clarity posts — order, calm, resolution
      'single open bullet-journal planner with neatly written tasks, only two items, clean white desk, morning soft light',
      'empty clean desk with only a single sharpened pencil centred on the surface, bright airy daylight, minimalist',
      'before-and-after composition: left half cluttered with sticky notes and folders, right half clean with one notebook, split overhead shot',
      // Educational / tips / process posts — concept in action
      'close-up of a stopwatch lying flat on a wooden desk, hands at the 12, sharp detail, bright neutral light',
      'a printed checklist on a clipboard with alternating ticked and unticked boxes, macro close-up on the ticks, crisp daylight',
      'calendar page pinned to a corkboard with certain dates circled in red marker, bright overhead light, shallow depth of field',
    ],
  },
  'professional-services': {
    forbidden: /\b(?:food|plated|plating|kitchen|meal|cuisine|farm|livestock|paddock|bbq|smoker|brisket|grill|gym|yoga\s+mat|salon|spa|garage|engine|wrench|tractor)\b/i,
    extraNegatives: 'food, plate, restaurant, kitchen, bbq, gym, farm, garage',
    fallbackScenes: [
      'modern office desk with closed laptop, leather portfolio and fountain pen, soft daylight from a window',
      'overhead flatlay of a contract, calculator, glasses and a takeaway coffee on a wooden table',
      'minimalist reception lobby with clean lines, a single armchair and floor-to-ceiling window, neutral palette',
      'close-up of a leather-bound planner and brushed-metal pen on a marble desk, warm afternoon light',
    ],
  },
  'food-restaurant': {
    forbidden: /\b(?:dashboard|laptop\s+screen|spreadsheet|infographic|app\s+screen|gym|treadmill|barbell|garage|engine|wrench|tractor|paddock|livestock\s+(?:in|on)\s+a\s+paddock)\b/i,
    extraNegatives: 'dashboard, laptop screen, UI, app screen, gym, garage, office cubicle',
    fallbackScenes: [
      // Signature dish / food hero
      'overhead shot of a beautifully plated main course on a linen-draped table, warm pendant restaurant light',
      'close-up macro of seasonal pasta with sauce sheen and herb garnish, shallow focus, warm side light',
      'rustic wood board with house-made bread, olive oil dipping bowl and fresh herbs, natural daylight',
      // Venue / atmosphere
      'cosy restaurant corner with two set tables, soft candle glow and warm wooden accents, no people',
      'bar counter with wine glasses, a single flower stem and soft golden backlight, moody atmosphere',
      // Process / kitchen (no people)
      'kitchen pass at golden hour — fresh herbs, colourful seasonal vegetables on a marble board, warm pendant light',
      'overhead flatlay of mise en place: chopped vegetables in ceramic bowls on a dark stone counter, chef overhead lighting',
    ],
  },
  'bbq-smokehouse': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|gym|treadmill|salon|spa)\b/i,
    extraNegatives: 'dashboard, laptop, UI, office, gym, salon',
    fallbackScenes: [
      // Hero meat shots
      'close-up of slow-smoked brisket bark resting on a butcher board, wisp of smoke, warm afternoon light',
      'pulled pork mound piled high on butcher paper with house-made slaw and pickles, candid cookout light',
      'rack of glazed BBQ ribs stacked on a cedar plank, glistening sauce, golden hour warm light',
      // Pit / venue atmosphere
      'offset smoker outside a brick smokehouse with thin blue smoke drifting against a clear afternoon sky',
      'BBQ pit interior with glowing embers and hanging hooks, atmospheric moody side light, no people',
      // Flatlay / spread
      'overhead flatlay: sliced brisket, white bread, house pickles and jalapeños on red checkered paper',
    ],
  },
  'butcher-meat': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|gym|treadmill|salon|spa)\b/i,
    extraNegatives: 'dashboard, laptop, UI, office',
    fallbackScenes: [
      'aged ribeye steaks arranged on a butcher block with rosemary sprigs and coarse salt, warm shop lighting',
      'butcher counter display of marbled cuts with handwritten chalk labels, neutral daylight',
    ],
  },
  'agriculture-farming': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|gym|salon|spa|restaurant\s+interior|cocktail)\b/i,
    extraNegatives: 'dashboard, laptop, UI, office, gym, restaurant',
    fallbackScenes: [
      'wide paddock view at golden hour with low fence line and distant gum trees',
      'tractor at the edge of a freshly ploughed paddock under a soft cloudy sky',
      'close-up of fresh produce on a hay bale with morning dew, warm rural light',
    ],
  },
  'retail-ecommerce': {
    forbidden: /\b(?:dashboard|laptop\s+screen|app\s+screen|gym|treadmill|salon|spa|garage|engine|wrench|tractor|paddock|livestock)\b/i,
    extraNegatives: 'dashboard, UI, gym, garage, farm',
    fallbackScenes: [
      'product flatlay on a clean linen background with soft daylight and minimal styling',
      'boutique shop interior corner with curated shelves, warm pendant lights and a single bouquet on the counter',
    ],
  },
  'health-wellness': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|food|plated|restaurant|kitchen|meal|cuisine|bbq|smoker|brisket|grill|farm|livestock|garage|engine|wrench|tractor)\b/i,
    extraNegatives: 'dashboard, UI, food, restaurant, bbq, farm, garage',
    fallbackScenes: [
      'rolled yoga mat, water bottle and a folded towel on a clean studio floor with warm morning light',
      'gym corner with kettlebells and dumbbells arranged neatly, large window with daylight',
      'studio interior with hardwood floor, ballet barre and mirror, soft daylight from one side',
    ],
  },
  'wellness-mindfulness': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|gym|treadmill|barbell|food|plated|restaurant|kitchen|meal|bbq|smoker|grill|farm|livestock|garage|engine|wrench)\b/i,
    extraNegatives: 'dashboard, UI, gym, food, restaurant, bbq, farm, garage',
    fallbackScenes: [
      'lit candle, ceramic bowl and folded linen on a low wooden table, warm soft daylight',
      'meditation cushion on a hardwood floor near a window with a small potted plant, golden hour light',
      'cup of steaming herbal tea on a stone coaster beside an open notebook, soft morning light',
    ],
  },
  'automotive-mechanic': {
    forbidden: /\b(?:dashboard|laptop\s+screen|app\s+screen|food|plated|restaurant|kitchen|meal|gym|treadmill|barbell|salon|spa|farm|livestock|paddock)\b/i,
    extraNegatives: 'UI, food, restaurant, gym, salon, farm',
    fallbackScenes: [
      'workshop bay with a single vehicle on a hoist, neatly arranged tools on a pegboard wall, soft overhead light',
      'mechanic toolbox open on a workbench with sockets and torque wrenches, warm garage lighting',
      'detailing bay with a polished car bonnet reflecting overhead lights, soft natural light through bay door',
    ],
  },
  'outdoor-sports': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|food|plated|restaurant|kitchen|meal|cuisine|salon|spa|garage|engine|wrench)\b/i,
    extraNegatives: 'dashboard, UI, food, restaurant, salon, garage',
    fallbackScenes: [
      'trail head with hiking boots, daypack and a folded map on a wooden bench, morning light through trees',
      'kayak pulled up onto a riverbank with paddle leaning against it, calm water and overhanging gum trees',
      'mountain bike resting against a fence on a rural trail at golden hour, distant ridge line behind',
    ],
  },
  'creative-arts': {
    forbidden: /\b(?:dashboard|laptop\s+screen|spreadsheet|app\s+screen|food|plated|restaurant|kitchen|bbq|smoker|grill|gym|treadmill|garage|engine|wrench|tractor|paddock|livestock)\b/i,
    extraNegatives: 'dashboard, UI, food, restaurant, gym, garage, farm',
    fallbackScenes: [
      'artist studio corner with an easel, canvas-in-progress, jars of brushes and natural daylight from a window',
      'overhead flatlay of paint tubes, palette and a sketchbook on a paint-stained wooden table',
      'pottery studio shelf with finished hand-thrown ceramics and a single dried wildflower in a small vase',
    ],
  },
  'events-festivals': {
    forbidden: /\b(?:dashboard|laptop\s+screen|spreadsheet|app\s+screen|gym|treadmill|barbell|salon|spa|garage|engine|wrench|farm|livestock\s+(?:in|on)\s+a\s+paddock)\b/i,
    extraNegatives: 'dashboard, UI, gym, garage',
    fallbackScenes: [
      'outdoor event setup at dusk with string lights, wooden ceremony arch and rows of folded chairs in a paddock',
      'festival stage under a clear evening sky with warm overhead lighting and bunting flags',
      'long banquet table dressed with linen runners, candles and seasonal flowers, golden hour outdoor light',
    ],
  },
};

// Apply archetype guardrails to a built safe-prompt pair. If the prompt
// contains subjects forbidden for the archetype, swap in a random
// archetype-appropriate fallback scene. Always extend negative_prompt with
// the archetype's avoid-list. Returns the updated pair + a debug flag for
// logging whether a fallback was used.
export function applyArchetypeGuardrails(
  safe: { prompt: string; negativePrompt: string },
  archetypeSlug: string | null,
): { prompt: string; negativePrompt: string; swappedForFallback: boolean } {
  if (!archetypeSlug) return { ...safe, swappedForFallback: false };
  const guardrails = ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug];
  if (!guardrails) return { ...safe, swappedForFallback: false };

  const negative = `${safe.negativePrompt}, ${guardrails.extraNegatives}`;

  if (guardrails.forbidden.test(safe.prompt)) {
    const fallback = guardrails.fallbackScenes[Math.floor(Math.random() * guardrails.fallbackScenes.length)];
    return {
      prompt: `${fallback}, ${FLUX_STYLE_SUFFIX}`,
      negativePrompt: negative,
      swappedForFallback: true,
    };
  }

  return { prompt: safe.prompt, negativePrompt: negative, swappedForFallback: false };
}

// Last-resort archetype detection from the post caption itself.
//
// The full archetype defense (guardrail-prompt-rewrite + critique-retry +
// forced-fallback) all no-ops when `users.archetype_slug` is NULL — a
// workspace that never ran /api/classify-business. This is exactly how
// food-on-SaaS slipped through for SocialAI Studio's own posts (Penny Wise
// I.T workspace was never classified, so the cron prewarm ran with
// archetypeSlug=null and the guardrails did nothing).
//
// This function does cheap keyword matching on the post caption to infer
// an archetype. Used by image-gen.ts (when DB returns null) so guardrails
// fire even for un-classified workspaces. Returns null if no clear
// archetype emerges — that's still safer than a guess, because the
// downstream code already handles null gracefully (just doesn't apply
// guardrails).
//
// Threshold: ≥2 keyword hits and a >=1 hit margin over the runner-up.
// Same shape as classifyArchetypeFromFingerprint's keyword layer in
// lib/archetypes.ts — keep them roughly aligned.
const CAPTION_ARCHETYPE_KEYWORDS: Record<string, string[]> = {
  'tech-saas-agency': [
    'saas', 'software', 'platform', 'ai content', 'ai tool', 'ai-powered',
    'autopilot', 'automation', 'dashboard', 'analytics', 'workflow',
    'multi-client', 'whitelabel', 'agency dashboard', 'agency tools',
    'social media tip', 'social media owner', 'cms', 'crm',
    'subscription', 'app', 'tech company', 'i.t.',
    // 2026-05 widening — real SaaS marketing copy doesn't always use the
    // technical terms above. These catch posts that describe the FEATURES
    // and OUTCOMES customers buy (scheduling, engagement, publishing) so
    // a post about "Smart Scheduling + engagement data" classifies even
    // when the brand name doesn't contain 'saas'/'platform' verbatim.
    'smart scheduling', 'engagement data', 'publishes automatically',
    'auto-publish', 'auto publish', 'pre-publish', 'content calendar',
    'post scheduling', 'social media management', 'content strategy',
    'marketing automation', 'ai content', 'ai-generated', 'pennywise',
    'socialai', 'social ai studio',
  ],
  'food-restaurant': ['menu', 'dish', 'recipe', 'cuisine', 'restaurant', 'cafe', 'eatery', 'dining', 'plated', 'meal'],
  'bbq-smokehouse': ['brisket', 'smoker', 'low and slow', 'pulled pork', 'ribs', 'bbq', 'smokehouse'],
  'butcher-meat': ['butcher', 'steak', 'ribeye', 'aged beef', 'cuts of meat', 'wagyu'],
  'agriculture-farming': ['paddock', 'cattle', 'livestock', 'crops', 'harvest', 'tractor', 'agronomy', 'farm-to-table'],
  'health-wellness': ['gym', 'workout', 'fitness', 'personal trainer', 'pilates', 'crossfit'],
  'wellness-mindfulness': ['meditation', 'mindfulness', 'breathwork', 'yoga class'],
  'automotive-mechanic': ['mechanic', 'tyres', 'logbook service', 'workshop bay', 'oil change'],
  'retail-ecommerce': ['boutique', 'collection drops', 'in-store', 'new arrival', 'shop online'],
  'professional-services': ['accountant', 'tax return', 'compliance', 'legal advice', 'invoice', 'bookkeeping'],
  'creative-arts': ['commission', 'canvas', 'gallery opening', 'artwork', 'sculpture'],
  'outdoor-sports': ['trail', 'hiking gear', 'kayak', 'campsite', 'gravel ride'],
  'events-festivals': ['festival lineup', 'ticket release', 'ceremony', 'wedding venue'],
};

export function sniffArchetypeFromCaption(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const lc = caption.toLowerCase();
  const scored: Array<{ slug: string; hits: number }> = [];
  for (const [slug, kws] of Object.entries(CAPTION_ARCHETYPE_KEYWORDS)) {
    let hits = 0;
    for (const kw of kws) if (lc.includes(kw)) hits++;
    if (hits > 0) scored.push({ slug, hits });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.hits - a.hits);
  const top = scored[0];
  const second = scored[1] ?? { hits: 0 };
  // Require ≥2 hits AND a ≥1 hit margin so a borderline match doesn't
  // misroute. If two archetypes tie, return null (caller falls through
  // to the safe-base prompt unchanged).
  if (top.hits >= 2 && top.hits - second.hits >= 1) return top.slug;
  return null;
}

// Returns { prompt, negativePrompt } pair, or null if the prompt is too
// short / invalid to seed a sensible image (caller should skip image gen
// and let the post publish text-only).
export function buildSafeImagePrompt(rawPrompt: string | null | undefined): { prompt: string; negativePrompt: string } | null {
  const prompt = (rawPrompt || '').trim();
  if (!prompt || prompt.length < 5) return null;

  // If the AI's prompt is primarily describing a digital interface, chart,
  // or comparison grid, FLUX will render a blurry pricing-table mockup that
  // sells nothing. Swap to a randomised neutral real-world scene from the
  // fallback bank above so cron-regenerated posts stop looking identical.
  const safeBase = isAbstractUIPrompt(prompt)
    ? SAFE_FALLBACK_SCENES[Math.floor(Math.random() * SAFE_FALLBACK_SCENES.length)]
    : prompt;

  // Strip people-mentions from the POSITIVE prompt — defense-in-depth.
  // The real enforcement is FLUX_NEGATIVE_PROMPT below.
  const cleaned = safeBase
    .replace(PEOPLE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    prompt: `${cleaned || safeBase}, ${FLUX_STYLE_SUFFIX}`,
    negativePrompt: FLUX_NEGATIVE_PROMPT,
  };
}
