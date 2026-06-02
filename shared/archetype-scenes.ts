// Single source of truth for the archetype-aware scene/guardrail data.
//
// Imported by:
//   - workers/api/src/lib/image-safety.ts (worker — cron / proxy / JIT path)
//   - src/services/gemini.ts              (frontend — accept-now / accept-all)
//
// Previously these three structures (ARCHETYPE_IMAGE_GUARDRAILS,
// SAFE_FALLBACK_SCENES, CAPTION_ARCHETYPE_KEYWORDS) lived only on the worker
// side. The frontend's `getImagePromptExamples` / `pickExampleScene` had a
// parallel-but-different scene bank, so a frontend-side image swap could pick
// a scene that the worker-side guardrails wouldn't have considered safe for
// that archetype. Same drift bug class as FLUX_NEGATIVE_PROMPT (PR #86) and
// `parseForbiddenSubjects` — single source of truth closes the failure mode.
//
// Both tsconfigs already include `shared/` (see shared/flux-prompts.ts).
//
// NOTE — keep this module pure (no Env, no fetch, no DB). The archetype
// classifier itself (resolveArchetypeSlug) still lives on the worker side
// because it needs DB access.

// ── Deterministic scene-selection seed ───────────────────────────────────
//
// FNV-1a 32-bit hash so the same post ID always picks the same fallback
// scene (idempotent on cron retries), and a week of 7-14 posts spreads
// predictably across the scene bank instead of random-colliding. Used by
// both worker (image-gen.ts force-fallback path) and image-safety.ts
// (normal applyArchetypeGuardrails path) for consistent behaviour.
export function hashStringToSceneSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Neutral-scene fallback bank ──────────────────────────────────────────
//
// Used when isAbstractUIPrompt matches and the caller needs to swap a UI /
// dashboard / screenshot prompt for something photographable. Previously a
// single fallback made every cron-regenerated promo post look identical AND
// mismatched non-tech businesses. This bank gives a randomised, varied set
// of candid-looking scenes that work across most SMB industries (cafes, IT,
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

// ── Archetype-aware image guardrails (2026-05-11 cross-domain bleed fix) ──
//
// Bug history: posts for SocialAI Studio (a SaaS/agency business) kept being
// generated with restaurant/candlelit-food imagery. Root cause: the frontend's
// archetype classifier influences the CAPTION prompt only — the resulting
// `image_prompt` it stores can still drift to food/agriculture/etc. when the
// LLM hallucinates a scene. The image-gen pipeline was archetype-blind: it
// just took whatever `image_prompt` was stored and shipped it.
//
// This map adds a per-archetype safety net. When the caller (worker
// generateImageWithGuardrails / frontend buildSafeImagePromptClient + retry
// hook) detects the stored prompt contains subjects forbidden for that
// archetype, it swaps the prompt for a neutral archetype-appropriate
// fallback scene and extends the FLUX negative_prompt with the archetype's
// avoid-list.
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
    // 14 photographable scenes covering: workspaces, hands-on-objects,
    // regional Australian context, books/reading, founder/maker moments,
    // travel, pure objects. Wider variety so a week of bulk-generated SaaS
    // posts doesn't ship five flatlay-laptop shots in a row. Selection is
    // deterministic by post-id hash (see image-gen.ts) so the same week's
    // posts spread predictably across this bank instead of random-colliding.
    //
    // 2026-05-20: dropped the abstract gradient scene (was #15) — for SaaS
    // posts the gradient added no topical anchor and felt thin compared to
    // the 14 photographable scenes. All entries below render as actual
    // photographs of physical objects/places.
    fallbackScenes: [
      // Workspace settings (curated, varied lighting + angle)
      'modern co-working studio with closed laptop on a clean desk, soft abstract blue and purple gradient on the wall behind, geometric paper shapes scattered, morning daylight',
      'overhead flatlay of an open notebook, smartphone face-down, ceramic mug and pen on a matte white desk, soft natural daylight',
      'minimal home office windowsill with a small potted plant, closed laptop and geometric wall art, sunrise light through window',
      'sleek desk corner with brushed metal lamp, leather notebook and brass pen, golden hour shadows across the surface',
      // Hands-on / human-element close-ups
      'close-up of hands typing on a mechanical keyboard, warm desk lamp glow, blurred background of evening lights through a window, shallow depth of field',
      'a single hand holding a smartphone face-down on a wooden table, white ceramic latte cup nearby, candid morning daylight, shallow depth of field',
      'close-up of a fountain pen writing on lined notebook paper, soft morning light, blurred warm-toned background, shallow depth of field',
      // Regional Australian / local context
      'regional Australian main street at golden hour, weatherboard shopfronts and wide footpath, warm late-afternoon sun, no people in frame',
      'a single mug of black coffee on a windowsill beside dried eucalyptus leaves in a glass jar, sunrise light, suburban Australian backdrop softly blurred',
      'a smartphone face-down on a car dashboard, country highway view through the windshield at sunrise, no driver visible, soft golden light',
      // Founder / maker scenes (analog tools, slower mood)
      'leather-bound journal open to a page of handwritten notes, fountain pen resting on the spine, warm desk lamp light, calm evening mood',
      'overhead shot of a sketch pad with rough wireframe diagrams drawn in pencil, eraser and mechanical pencil beside it, natural daylight, no UI screens visible',
      'stack of business and design books on a side table, folded reading glasses on top, single linen armchair partially in frame, soft lamp light',
      // Pure-object stills (no humans, no UI) — versatile abstract context
      'two leather-bound notebooks stacked on a marble table, a brass pen and folded reading glasses beside them, single ceramic vase with native gum leaves, soft window light',
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
      'overhead shot of a plated dish on a rustic wooden table with linen napkin and water glass, warm restaurant ambient light',
      'cosy restaurant interior corner with set tables, soft candle light and warm wooden accents',
      'kitchen pass at golden hour with fresh herbs, a board of seasonal vegetables and warm pendant lights',
    ],
  },
  'bbq-smokehouse': {
    forbidden: /\b(?:dashboard|laptop|spreadsheet|app\s+screen|gym|treadmill|salon|spa)\b/i,
    extraNegatives: 'dashboard, laptop, UI, office, gym, salon, generic roast, bolar blade, chuck roast, top round, rump roast, pot roast, steak, raw meat, butcher-shop slab, incorrect beef cut, misleading meat cut',
    fallbackScenes: [
      'offset smoker with firebox and thin blue smoke, stacks of split hardwood beside it, no identifiable meat cuts visible, bright Queensland afternoon light',
      'close-up of split hardwood, firebox glow and clean smoke rolling from a BBQ pit smoker, no meat visible, bright natural daylight',
      'offset smoker outside a brick smokehouse with thin blue smoke against a clear sky, late afternoon',
      'BBQ serving tray with sauce cups, pickles, slaw, tongs and plain butcher paper, smokehouse prep scene, no identifiable meat cuts visible, no text, bright natural daylight',
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

// ── Positive-subject requirement per archetype ───────────────────────────
//
// Some archetypes have CONCRETE inventory (BBQ smoker, brisket, ribs) that
// must appear in any decent image prompt — but the LLM smart-schedule path
// regularly emits beautifully-written prompts about candlelit books, coffee
// cups, streetscapes, pastries… anything aesthetic but topically wrong.
//
// The `forbidden` regex in ARCHETYPE_IMAGE_GUARDRAILS catches OBVIOUSLY wrong
// subjects (dashboard for a butcher, gym for a smokehouse). It doesn't catch
// "aesthetically neutral but completely off-topic" — that's the failure mode
// behind 2026-05-22 Hugheseys-style preview screenshots.
//
// This map flips the check: instead of asking "is the prompt forbidden?",
// it asks "does the prompt contain at least one of the required subjects?".
// If not, image-gen.ts force-falls-back to the curated scene bank (same
// path tech-saas-agency takes unconditionally, just with a different
// trigger).
//
// Conservative inclusion — only add archetypes where the failure mode is
// well-evidenced. False positives here force a perfectly good prompt onto
// a generic fallback, which makes posts look samey.
// 2026-05-23 customer audit: replace the original tech-saas fallback bank
// at module-load time. The older list included several golden-hour travel
// and car-dashboard scenes, so SocialAI promo batches converged into the
// same sunset road/phone visual family. Keep this override deliberately
// physical, people-free, screen-free, and tied to scheduling/content work.
ARCHETYPE_IMAGE_GUARDRAILS['tech-saas-agency'].fallbackScenes = [
  'overhead flatlay of a weekly planner page with blank colored sticky notes arranged into posting slots, stopwatch and pencil beside it, bright morning daylight',
  'clean desk with three stacked index-card piles grouped by color, small analog clock and ceramic mug nearby, crisp side light',
  'minimal corkboard with blank color-coded cards pinned in a neat campaign grid, string line and push pins, daylight office wall',
  'close-up of a paper checklist on a clipboard beside a closed smartphone and timer, sharp focus, natural window light',
  'two inbox trays on a desk, one overflowing with loose blank notes and one neatly sorted with colored cards, bright daylight, no screen visible',
  'wide shot of a tidy studio desk with closed laptop, notebook, desk lamp and calendar pad, clean midday light, no screen visible',
  'macro photo of a mechanical keyboard beside a closed notebook and small hourglass, shallow depth of field, cool daylight',
  'overhead shot of a blank monthly wall calendar with colored magnets marking publishing days, white wall, even daylight',
  'single smartphone face-down on a matte desk beside a neat row of blank content cards and a small analog clock, top-down, bright natural light',
  'founder planning table with open notebook, pencil sketches of simple boxes and arrows, sticky tabs and coffee, no readable text, morning light',
  'side angle of a closed laptop beside neatly bundled envelopes and a calendar block, soft window light, uncluttered workspace',
  'close-up of a timer, pencil and blank notepad page with a single highlighted sticky note, minimal white desk, sharp focus',
  'overhead composition of three blank social-post cards represented by colored paper squares beside a camera lens cap and notebook, daylight',
  'desk corner with brass pen, closed leather journal and small stack of colored reminder cards, neutral background, soft afternoon light',
  'minimal shelf with stacked business books, folded reading glasses and a small card file box, soft lamp light, no people',
  'clean tabletop with a small paper calendar, row of binder clips, sticky notes and a closed phone, bright editorial product photography',
  'workbench-style desk with cable organizer, closed notebook, pencil, timer and neatly coiled charger, crisp daylight, practical small-business mood',
  'flatlay of a simple content batching kit: blank cards, pen, calendar pad, analog clock and coffee mug on a matte white desk, high-key daylight',
];

export const ARCHETYPE_POSITIVE_SUBJECTS: Record<string, RegExp> = {
  'bbq-smokehouse': /\b(?:bbq|barbecue|barbeque|brisket|smoker|smokehouse|smoked|smoking|pulled\s*pork|pork\s*belly|pit\b|ribs|sausage|grill(?:ed|ing)?|charcoal|wood\s*fire|cookout|low\s*and\s*slow|smoke\s*ring|burnt\s*end|bark|dry\s*rub|beef\s*rib|short\s*rib|coleslaw|baked\s*beans|smoke\s*trail|butcher\s*paper|meat)\b/i,
};

// ── Caption-based archetype sniffer keyword bank ─────────────────────────
//
// Last-resort archetype detection from the post caption itself. The full
// archetype defense (guardrail-prompt-rewrite + critique-retry + forced-
// fallback) all no-ops when `users.archetype_slug` is NULL — a workspace
// that never ran /api/classify-business. This is exactly how food-on-SaaS
// slipped through for SocialAI Studio's own posts (Penny Wise I.T workspace
// was never classified, so the cron prewarm ran with archetypeSlug=null and
// the guardrails did nothing).
//
// Cheap keyword matching infers an archetype from caption text. Returns null
// if no clear archetype emerges — that's still safer than a guess, because
// the downstream code already handles null gracefully.
//
// Threshold: ≥2 keyword hits and a ≥1 hit margin over the runner-up.
// Same shape as classifyArchetypeFromFingerprint's keyword layer in
// workers/api/src/lib/archetypes.ts — keep them roughly aligned.
export const CAPTION_ARCHETYPE_KEYWORDS: Record<string, string[]> = {
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
