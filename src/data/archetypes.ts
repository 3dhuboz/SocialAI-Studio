/**
 * Business Archetype Library
 *
 * Single source of truth for the 12 archetypes used by the AI generation
 * pipeline. Replaces the hardcoded `if`-cascade in `gemini.ts`
 * (getImagePromptExamples) and `socialMediaResearch.ts` (INDUSTRY_KEYWORDS)
 * which both used incompatible taxonomies and missed unknown businesses.
 *
 * **Two consumers:**
 *
 * 1. The worker seeds `business_archetypes` D1 table from this data on
 *    first boot (idempotent INSERT OR IGNORE). The Haiku classifier
 *    `POST /api/classify-business` reads from the table at runtime.
 *
 * 2. The client uses these as a synchronous fallback when the user's
 *    cached archetype hasn't been fetched yet (e.g. right after onboarding,
 *    before the classifier returns) — so the keyword switch still works
 *    instantly, just routed through this data instead of inline branches.
 *
 * **Why 12?**  The original code had 11 hardcoded image-prompt branches and
 * 6 industry-research branches with overlapping coverage. This unifies them
 * into 12 archetypes that span the full SMB landscape with no gaps for
 * agency/SaaS/digital businesses (which previously fell through to food
 * defaults — see the 2026-05 user screenshots).
 *
 * **Adding a new archetype:** edit this file + add a seed row. No code
 * changes elsewhere. Schema migration only if you need new columns.
 */

export interface Archetype {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  imageExamples: string[];
  imageAvoidNotes: string;
  voiceCues: string;
  contentPillars: string[];
  bannedTropeExtras?: string[];
}

export const ARCHETYPES: Archetype[] = [
  {
    slug: 'food-restaurant',
    name: 'Food, Café & Restaurant',
    description: 'Bricks-and-mortar food businesses — cafés, bakeries, restaurants, takeaways, delis, food trucks, butchers. Customers physically visit or order for pickup/delivery. Imagery is the product itself plus the venue atmosphere. Voice is warm, sensory, locally rooted.',
    keywords: ['restaurant', 'cafe', 'café', 'bakery', 'deli', 'food truck', 'takeaway', 'pizza', 'grill', 'kitchen', 'bistro', 'sushi', 'burger', 'chicken', 'seafood', 'steak', 'pickle', 'ferment', 'artisan food', 'breakfast', 'brunch', 'lunch', 'catering'],
    imageExamples: [
      'sourdough loaf cross-section on marble counter, morning window light',
      'flat white coffee with latte art on rustic wooden table, top-down',
      'croissants stacked in wicker basket, soft golden bakery light',
      'overhead flatlay of breakfast spread: coffee, pastries, jam, butter',
      'pastry display case interior, warm lighting, bakery atmosphere',
      'cross-section of kimchi in a glass jar showing texture, side angle',
      'sandwich loaded with deli meat and pickles, overhead on butcher paper',
      'cafe storefront at golden hour, candid streetscape, no customers visible',
    ],
    imageAvoidNotes: 'NEVER include people, faces, hands, owners, customers, or staff. NEVER render menus, price boards, or text overlays. Focus on the food itself, the venue interior, or candid empty-table moments.',
    voiceCues: 'Warm, sensory, locally rooted. Name specific dishes and ingredients. Call out opening hours, pickup-only / delivery-area facts. Use Aussie casual contractions where appropriate.',
    contentPillars: ['Product Showcase', 'Behind the Bake', 'Customer Favourites', 'Tips & Pairings', 'Seasonal Specials'],
  },
  {
    slug: 'bbq-smokehouse',
    name: 'BBQ, Smokehouse & Grill',
    description: 'Specialty BBQ / smokehouse / grill businesses — competition pitmasters, BBQ catering, smokehouse restaurants, food trucks specialising in smoked meats. Distinct from generic restaurants because the craft (smoke, slow-cooking) IS the marketing.',
    keywords: ['bbq', 'barbeque', 'barbecue', 'smokehouse', 'pitmaster', 'smoked meats', 'low and slow', 'brisket', 'pulled pork', 'ribs'],
    imageExamples: [
      'sliced smoked brisket fanned on butcher paper, golden hour light',
      'pulled pork burger with coleslaw and pickles, close-up macro',
      'BBQ ribs glistening with glaze on cedar plank, smoke wisps in background',
      'food truck exterior at dusk with warm window light and queue area (empty)',
      'overhead flatlay: brisket, slaw, beans, white bread on red checkered paper',
      'smoker opened showing meat in atmospheric smoke, late afternoon sun, no person visible',
      'wood pile next to the smoker, golden hour, candid working-yard texture',
    ],
    imageAvoidNotes: 'NEVER include people, pitmasters, or customers. NEVER render menu boards or text overlays. Focus on the meat, smoke, fire, and the rig.',
    voiceCues: 'Confident, no-frills, Aussie smoker culture. Name cuts, woods, cook times. References competition circuit or low-and-slow philosophy land well.',
    contentPillars: ['Cook of the Day', 'Smoke Science', 'Competition / Event Run', 'Customer Favourites', 'Behind the Pit'],
  },
  {
    slug: 'butcher-meat',
    name: 'Butcher & Specialty Meat',
    description: 'Butcher shops, specialty meat retailers, dry-age operations, charcuterie makers. Sells raw / prepared meats by weight or piece. Customer base is home cooks and chefs.',
    keywords: ['butcher', 'meat', 'charcuterie', 'dry age', 'dry-age', 'salumi', 'biltong', 'jerky', 'sausages'],
    imageExamples: [
      'raw beef ribeye steak on dark wooden cutting board, warm lighting, overhead shot',
      'rack of lamb on butcher paper with rosemary sprigs, natural side light',
      'glass display case of fresh sausages and cuts, shop interior, soft daylight',
      'aged dry-rubbed brisket close-up showing bark texture, dramatic lighting',
      "butcher's marble counter with herbs and twine, overhead flatlay",
      'cast iron pan with thick pork chop and garlic, moody warm light, no person',
      'hanging charcuterie in a dim curing room, atmospheric still life',
    ],
    imageAvoidNotes: 'NEVER include people, hands handling meat, or staff. NEVER render hygiene-rule text or weights/prices. Focus on cuts, marbling, the venue.',
    voiceCues: 'Knowledgeable, direct, ingredient-led. Name breeds, cuts, ageing periods. Speak to home cooks who care about provenance.',
    contentPillars: ['Cut of the Week', 'Provenance Story', 'Cooking Tips', 'Order Window', 'Seasonal Specials'],
  },
  {
    slug: 'agriculture-farming',
    name: 'Agriculture & Farming',
    description: 'Farms, vineyards, orchards, nurseries, livestock producers. Sells produce direct or wholesale. Imagery is land, animals, harvest. Voice is rooted in seasons and weather.',
    keywords: ['farm', 'agriculture', 'agri', 'livestock', 'dairy', 'crop', 'harvest', 'vineyard', 'orchard', 'nursery', 'horticulture', 'paddock', 'pastured', 'organic farm'],
    imageExamples: [
      'rolling green paddock at golden hour with scattered trees, wide landscape',
      'overhead flatlay of seasonal produce on a wooden crate with hessian',
      'rows of grapevines in early morning fog, atmospheric vineyard shot',
      'close-up macro of a fresh tomato cluster on the vine, water droplets',
      'farm shed at dusk with warm window light, candid working-property texture',
      'tractor in a freshly ploughed field, golden hour, no driver visible',
      'overhead aerial of crop rows with shadow lines, abstract composition',
    ],
    imageAvoidNotes: 'NEVER include farmers, workers, or staff. NEVER render machinery brand logos. Focus on land, animals, produce, and weather.',
    voiceCues: 'Seasonal, weather-aware, grounded. Reference paddock rotation, harvest timing, breed/variety names. Plain-spoken; assume the reader respects the work.',
    contentPillars: ['Harvest Update', 'Animal of the Week', 'Behind the Gate', 'Seasonal Tips', 'Direct-Sale Window'],
  },
  {
    slug: 'tech-saas-agency',
    name: 'Tech, SaaS & Marketing Agency',
    description: 'Software products, marketing/social/creative agencies, IT consultancies, web designers, automation services, AI tools. Sells digital services or subscriptions. NO physical venue. Risk: AI defaults to SaaS-marketing tropes ("Ready to automate?", "Scale without scaling"); voice and imagery need active anchoring to the specific tool/service.',
    keywords: ['saas', 'software', 'tech', 'agency', 'marketing agency', 'social media agency', 'social media studio', 'creative studio', 'creative agency', 'web design', 'web designer', 'digital agency', 'consultancy', 'consulting', 'automation', 'it services', 'i.t.', 'ai tools', 'platform'],
    imageExamples: [
      'matte black smartphone face-down on marble surface beside espresso cup, top-down, morning light',
      'mechanical keyboard with backlit keys on a dark moody desk, candid close-up, no person',
      'rack of glowing server hardware, abstract tech atmosphere, neon accents',
      'aerial view of clean desk with notebook, pen, plant and closed laptop, beige aesthetic',
      'coffee shop counter scene with laptop, latte and notebook, warm afternoon light, no person',
      'creative wall of post-it notes in a bright office, daylight from window, candid texture',
      'multi-screen agency desk with calendar view glowing softly, late evening, no person',
      'whiteboard wall with kanban sticky-notes, daylight, creative studio atmosphere',
      'abstract close-up of glowing fibre cables in dark room, blue+orange contrast',
      'home office windowsill with plant, mug and a closed notebook at sunrise',
    ],
    imageAvoidNotes: 'NEVER render UI mockups, dashboards, pricing tables, app screenshots, wireframes, or marketing graphics — these defeat the entire point of using FLUX (use real screenshots if you need UI). NEVER include people typing or "founders at whiteboard" — even hands break the aesthetic.',
    voiceCues: 'Specific. Name the actual tool, the actual integration, the actual feature. Resist the urge to say "transform your business" — say what your tool does in the next 30 seconds. Pricing should be concrete, not "from competitive rates".',
    contentPillars: ['Feature Showcase', 'Workflow Tutorial', 'Customer Story (verified)', 'Behind the Build', 'Industry Take'],
    // SaaS-genre tropes that the global BANNED_PATTERNS already covers, but
    // worth being extra-aggressive about for this archetype specifically
    bannedTropeExtras: [
      'thought leadership', 'paradigm shift', 'mission-critical', 'enterprise-grade', 'best-in-class', 'world-class', 'cutting-edge', 'turnkey', 'end-to-end', 'frictionless', 'seamless integration', 'value proposition',
    ],
  },
  {
    slug: 'professional-services',
    name: 'Professional Services',
    description: 'Accountants, lawyers, financial advisors, architects, engineers, consultants. Client-by-client trust-based service businesses with formal credentials. Distinct from tech-agency: regulated, slower-moving, conservative.',
    keywords: ['accountant', 'accounting', 'lawyer', 'legal', 'solicitor', 'barrister', 'financial advisor', 'financial planner', 'architect', 'engineer', 'engineering firm', 'tax', 'audit', 'mortgage broker'],
    imageExamples: [
      'leather-bound desk diary and fountain pen on a wooden desk, professional atmosphere',
      'shelf of legal books with reading light, library-style interior',
      'aerial view of meeting table with notepads and coffee cups, no people',
      'architectural blueprint on a desk with scale ruler, drafting close-up',
      'professional building exterior at golden hour, candid streetscape',
      'window office at twilight with city lights visible, calm atmosphere',
    ],
    imageAvoidNotes: 'NEVER include people, suits, or handshakes — the cliché stock-photo aesthetic. Focus on tools-of-trade, considered interiors, and material details.',
    voiceCues: 'Considered, precise, jargon-aware. Cite frameworks, regulatory bodies, and case-specific advice without crossing into general guidance. Plain-language explanations land best.',
    contentPillars: ['Regulatory Update', 'Client FAQ', 'Case Study (anonymised)', 'Tax/Compliance Calendar', 'Industry Commentary'],
  },
  {
    slug: 'retail-ecommerce',
    name: 'Retail & E-commerce',
    description: 'Bricks-and-mortar retail, e-commerce stores, boutiques, fashion, gift shops, florists, homewares. Sells products by the unit. Imagery is the product on display, often styled flatlay.',
    keywords: ['retail', 'shop', 'store', 'boutique', 'ecommerce', 'e-commerce', 'fashion', 'clothing', 'gift', 'homewares', 'florist', 'flowers', 'lifestyle store'],
    imageExamples: [
      'overhead flatlay of products on linen with herbs and props, magazine styling',
      'boutique storefront with window display, warm interior light, candid streetscape',
      'single hero product on textured background, soft directional lighting',
      'open shelving styled with the product range, retail interior',
      'gift-wrapped product on a textured surface with ribbon detail, close-up',
      'floral arrangement on a marble counter, soft natural light',
    ],
    imageAvoidNotes: 'NEVER include people, hands modelling products, or shop assistants. NEVER render price tags or sale signs. Focus on the product itself, styled.',
    voiceCues: 'Style-led, specific (call out colourway, size, materials). Reference current collection, limited run, sourcing story. Cash-and-collect / shipping facts important.',
    contentPillars: ['New Arrival', 'Styled Outfit / Display', 'Behind the Source', 'Customer Wears (no faces)', 'Sale / Limited Run'],
  },
  {
    slug: 'health-wellness',
    name: 'Health & Wellness',
    description: 'Gyms, yoga studios, pilates, beauty salons, spas, massage therapists, physios, chiros. Service-based, body-focused, often subscription/booking model. Imagery is space + tools, NEVER bodies.',
    keywords: ['gym', 'fitness', 'pilates', 'yoga', 'yoga studio', 'personal trainer', 'beauty', 'salon', 'spa', 'massage', 'physio', 'chiro', 'wellness', 'health', 'dental', 'medical', 'osteo'],
    imageExamples: [
      'meditation cushion in sunlit room with linen curtains, calm atmosphere',
      'overhead flatlay of journal, herbal tea, and dried flowers, wellness aesthetic',
      'rolled yoga mat on polished wood floor, soft window light',
      'minimal treatment room interior with linen and timber, peaceful atmosphere',
      'fitness equipment in modern gym at dawn, candid empty space',
      'close-up of hands holding warm ceramic mug, cozy lighting (hands acceptable for tea/treatment shots)',
    ],
    imageAvoidNotes: 'NEVER include people exercising, in treatment, or in poses. NEVER render before/after comparison shots. Focus on calm space, ritual tools, daylight.',
    voiceCues: 'Grounded, body-respectful, non-prescriptive. Avoid medical claims unless registered. Reference movement, breath, recovery rituals.',
    contentPillars: ['Move of the Week', 'Recovery Tips', 'Class Schedule', 'Member Story (anonymised)', 'Studio Update'],
  },
  {
    slug: 'wellness-mindfulness',
    name: 'Mindfulness & Breathwork',
    description: 'Specialty wellness practices — meditation teachers, breathwork facilitators, sound healing, holistic coaching. Distinct from gyms/spas because the offering is contemplative practice, not physical training.',
    keywords: ['meditation', 'mindful', 'mindfulness', 'breathwork', 'sound healing', 'holistic', 'reiki', 'energy work', 'yoga teacher'],
    imageExamples: [
      'serene candle on stone with soft window light, minimal composition',
      'misty forest path at dawn, atmospheric grounding nature shot',
      'overhead flatlay of crystals, journal, and dried sage, intentional arrangement',
      'sound bowl on linen at golden hour, close-up macro',
      'meditation cushion stack in a sunlit room, peaceful empty space',
      'forest floor close-up with moss and fern, grounding texture',
    ],
    imageAvoidNotes: 'NEVER include people in poses or in session. Focus on space, light, and contemplative objects.',
    voiceCues: 'Reflective, unhurried, somatic vocabulary. Avoid "transformation" cliché. Reference specific practices and their effects.',
    contentPillars: ['Practice Invitation', 'Reflection / Quote', 'Workshop Announcement', 'Behind the Practice', 'Seasonal Ritual'],
  },
  {
    slug: 'automotive-mechanic',
    name: 'Automotive & Mechanic',
    description: 'Mechanic workshops, auto detailers, restorers, panel beaters, tyre shops, performance / custom builders. Hands-on craft business with workshop aesthetic.',
    keywords: ['mechanic', 'garage', 'auto', 'automotive', 'workshop', 'panel beater', 'tyre', 'tire', 'detailer', 'restoration', 'performance', 'car repair'],
    imageExamples: [
      'classic car in garage bay under work lights, atmospheric',
      "mechanic's tool wall with organised wrenches, industrial light",
      'engine bay close-up with chrome detail, shallow focus',
      'oil-stained workbench with vintage tools, candid texture',
      'detailed leather steering wheel close-up after restoration',
      'workshop exterior with vintage signage, golden hour',
      'rolling tool chest in a clean workshop bay, side light',
    ],
    imageAvoidNotes: 'NEVER include mechanics, hands on the spanner, or customer cars with plates visible. Focus on the cars, the tools, the workshop atmosphere.',
    voiceCues: 'Practical, no-nonsense, model-specific. Call out make/model/year. Reference parts, services, turnaround times. Aussie tradie-aware.',
    contentPillars: ['Job of the Week', 'Restoration Progress', 'Workshop Tips', 'Customer Build', 'Service Reminder'],
  },
  {
    slug: 'outdoor-sports',
    name: 'Outdoor & Sports',
    description: 'Surf shops, climbing gyms, dive operators, outdoor gear retailers, sports schools. Lifestyle-driven, environmentally aware, gear-focused.',
    keywords: ['surf', 'surf shop', 'dive', 'diving', 'climb', 'climbing', 'outdoor', 'adventure', 'sports', 'gear', 'hiking', 'camping', 'fishing', 'kayak'],
    imageExamples: [
      'surfboard standing upright in sand with ocean background, golden hour',
      'row of surfboards in shop rack, natural daylight from window',
      'wave breaking with empty horizon, dramatic backlight',
      'overhead flatlay of beach gear: board wax, sunscreen, towel, sandals',
      'aerial shot of empty surf break at dawn, dramatic clouds',
      'wetsuit hanging on weathered wooden fence, salty atmosphere',
      'climbing chalk bag and shoes on rock, candid gear shot',
    ],
    imageAvoidNotes: 'NEVER include athletes, surfers, or customers using the gear. Focus on the gear itself, the environment, and conditions.',
    voiceCues: 'Conditions-aware (swell, wind, tide, weather). Gear-specific (model, size, fit). Aussie-coastal where applicable.',
    contentPillars: ['Conditions Report', 'Gear Pick', 'Trip Recap (no faces)', 'Tip / Skill', 'Local Spot Profile'],
  },
  {
    slug: 'creative-arts',
    name: 'Creative Arts & Handmade',
    description: 'Jewellers, ceramicists, leatherworkers, makers, illustrators, painters selling original work. Distinct from retail because the craft IS the product story.',
    keywords: ['jewel', 'jewellery', 'jewelry', 'ceramicist', 'pottery', 'leather', 'maker', 'handmade', 'artist', 'illustrator', 'painter', 'craftsperson', 'artisan'],
    imageExamples: [
      'single ring on velvet pad with soft directional lighting',
      'overhead flatlay of necklaces fanned on linen background',
      'close-up macro of gemstone showing facets and light play',
      'workbench with tools and an in-progress piece, atmospheric warm light',
      'jewellery in display case with reflections, boutique interior',
      'open jewellery box with multiple pieces, overhead, soft shadows',
      'potters wheel with clay form, candid studio shot, no hands visible',
    ],
    imageAvoidNotes: 'NEVER include the maker, hands at work, or customers wearing pieces. Focus on the work itself, the workshop, the materials.',
    voiceCues: 'Material-led, process-aware. Reference the actual materials, the technique, the time investment. Custom-order language welcomed.',
    contentPillars: ['Piece of the Week', 'In-Progress (no hands)', 'Material Story', 'Custom Commission Window', 'Studio Update'],
  },
  {
    slug: 'events-festivals',
    name: 'Events & Festivals',
    description: 'Festival organisers, event venues, conferences, markets, expos, weddings. Time-bounded events with a build-up cadence (announcement → countdown → on-day → recap).',
    keywords: ['festival', 'event', 'conference', 'market', 'expo', 'show', 'concert', 'fair', 'wedding', 'venue'],
    imageExamples: [
      'outdoor festival ground at dusk with festoon lights and empty stage, atmospheric',
      'competition trophies and ribbons on draped table, dramatic spotlight',
      'overhead aerial of festival grounds with marquees, no crowds',
      'festival entrance gate with banners, golden hour, anticipation feel',
      'venue interior set for an event with empty chairs and stage, warm light',
      'flatlay of event programme, lanyard, and pen on wood, behind-the-scenes',
    ],
    imageAvoidNotes: 'NEVER include attendees, performers, or crowds — privacy + photo-release issues at scale. Focus on the venue, the set-up, the lead-up details.',
    voiceCues: 'Countdown-aware. Practical (dates, gates, tickets, weather). Build anticipation without hype. Aftermath recaps focus on numbers + thanks, not "epic vibes".',
    contentPillars: ['Save the Date', 'Programme Reveal', 'Behind the Build', 'Day-of Logistics', 'Recap & Thanks'],
  },
];

/**
 * Synchronous keyword-based archetype match (Layer 0 fallback).
 *
 * This is used:
 *   - On the client BEFORE the cached archetype from the server has loaded
 *   - As a server-side fast path when keywords match unambiguously
 *
 * Returns `null` when no archetype clearly matches — caller should then
 * fall through to the Haiku classifier (the GOOD layer) or to a generic
 * default. Returning null is intentional — we don't want this layer to
 * silently shoehorn ambiguous businesses into a wrong category.
 */
export function matchArchetypeByKeyword(input: string): Archetype | null {
  const lower = input.toLowerCase();
  let bestMatch: { archetype: Archetype; matchCount: number } | null = null;
  for (const archetype of ARCHETYPES) {
    const matchCount = archetype.keywords.filter(kw => lower.includes(kw.toLowerCase())).length;
    if (matchCount === 0) continue;
    if (!bestMatch || matchCount > bestMatch.matchCount) {
      bestMatch = { archetype, matchCount };
    }
  }
  return bestMatch?.archetype ?? null;
}

/** Lookup an archetype by slug — O(1) for the small archetype list. */
export function getArchetypeBySlug(slug: string): Archetype | undefined {
  return ARCHETYPES.find(a => a.slug === slug);
}

/** Default archetype slug when classification fails entirely. */
export const DEFAULT_ARCHETYPE_SLUG = 'professional-services';
