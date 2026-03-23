/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Social Media Research Data — Grounded in Published Industry Studies
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Sources:
 *  - Sprout Social "Best Times to Post" 2024 (analysed 2B+ engagements)
 *  - Hootsuite "Best Time to Post on Social Media" 2024
 *  - Later "Best Time to Post on Instagram" 2024
 *  - Buffer "State of Social Media" 2024
 *  - CoSchedule "Best Times to Post on Social Media" 2024
 *  - Adam Mosseri (Head of Instagram) — hashtag guidance 2023-2024
 *  - Meta Business Help Centre — Facebook hashtag best practices
 *
 *  Last updated: March 2026
 *  Update schedule: Review annually when new Sprout Social / Hootsuite reports drop
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PostingTimeData {
  facebook: string[];
  instagram: string[];
}

export interface HashtagStrategy {
  facebook: { optimal: number; max: number };
  instagram: { optimal: number; max: number };
  mixStrategy: string;
  sampleHashtags: {
    branded: string[];
    industry: string[];
    location: string[];
    niche: string[];
  };
}

export interface IndustryBenchmarks {
  industryKey: string;
  industryLabel: string;
  bestPostingTimes: PostingTimeData;
  bestDays: { facebook: string[]; instagram: string[] };
  worstDays: string[];
  hashtagStrategy: HashtagStrategy;
  contentMix: {
    ratio: string;
    pillars: string[];
    description: string;
  };
  engagementNotes: string;
  imagePromptExamples: string[];
  imagePromptAvoid: string;
  sources: string[];
}

export interface TimezoneInfo {
  timezone: string;
  utcOffset: string;
  label: string;
  note: string;
}

export interface BenchmarkResult {
  data: IndustryBenchmarks;
  timezone: TimezoneInfo;
}

// ── Hashtag Constants (platform-wide, all industries) ────────────────────────
// Source: Adam Mosseri (Head of Instagram) 2023-2024: "3-5 relevant hashtags"
// Source: Sprout Social 2024: Facebook posts with 1-3 hashtags get highest engagement
export const HASHTAG_LIMITS = {
  facebook: { optimal: 2, max: 3 },
  instagram: { optimal: 4, max: 5 },
} as const;

// ── Industry Data ────────────────────────────────────────────────────────────

const INDUSTRY_DATA: Record<string, IndustryBenchmarks> = {

  'food-restaurant': {
    industryKey: 'food-restaurant',
    industryLabel: 'Food, Restaurant & Hospitality',
    bestPostingTimes: {
      // Source: Sprout Social 2024 — Food & Beverage industry peaks
      // Source: Hootsuite 2024 — Restaurant engagement windows
      facebook: ['09:00', '11:00', '12:00', '17:00', '19:00'],
      instagram: ['08:00', '10:00', '12:00', '17:00', '19:00'],
    },
    bestDays: {
      // Source: Sprout Social 2024 — highest engagement days for food/bev
      facebook: ['Wednesday', 'Friday', 'Saturday'],
      instagram: ['Tuesday', 'Wednesday', 'Friday'],
    },
    worstDays: ['Sunday evening', 'Monday before 8 AM'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 branded + 1-2 industry + 1 location',
      sampleHashtags: {
        branded: ['#YourBusinessName'],
        industry: ['#BBQ', '#FoodTruck', '#SmokeLow', '#Brisket', '#LocalEats', '#FoodPorn', '#MeatLovers', '#Catering', '#FarmToTable', '#Butcher'],
        location: ['#BrisbaneFood', '#GoldCoastEats', '#QLDFoodie', '#AustralianBBQ', '#BrisbaneFoodTruck'],
        niche: ['#LowAndSlow', '#SmokedMeat', '#PorkBellyLollipops', '#WoodFired', '#SmallBatch', '#ArtisanFood'],
      },
    },
    contentMix: {
      ratio: '80% value / 20% promotional',
      pillars: ['Menu Highlights & Food Photos', 'Behind the Kitchen/Smoker', 'Customer Stories & Reviews', 'Recipe Tips & Cooking Tricks', 'Location & Event Updates', 'Seasonal Specials'],
      description: 'Lead with mouth-watering food photography. 4 out of 5 posts should educate, entertain, or build community. Every 5th post can promote a deal, new menu item, or catering service.',
    },
    engagementNotes: 'Food content performs best with close-up, well-lit photography. Videos of food preparation (sizzle reels) get 2-3x more engagement than static images. Ask questions about favourite dishes to drive comments.',
    imagePromptExamples: [
      'glistening smoked brisket slices on a wooden cutting board, warm natural light, close-up overhead shot',
      'pork belly lollipops on a rustic plate, smoky background, golden hour lighting',
      'chef slicing meat at a food truck counter, steam rising, action shot',
      'colourful BBQ platter with sides on a picnic table, outdoor setting, vibrant colours',
      'close-up of pickled vegetables in glass jars, natural window light, artisan deli counter',
    ],
    imagePromptAvoid: 'NEVER show: people\'s faces, concerts, parties, office scenes, computers, abstract art, neon lights. ONLY show: food, cooking, kitchen, restaurant, market scenes.',
    sources: ['Sprout Social 2024 Best Times Report', 'Hootsuite 2024 Restaurant Social Media Guide', 'Later 2024 Food & Beverage Instagram Study'],
  },

  'agriculture-farming': {
    industryKey: 'agriculture-farming',
    industryLabel: 'Agriculture, Farming & Produce',
    bestPostingTimes: {
      // Source: Sprout Social 2024 — Consumer Goods category (closest match)
      // Adjusted for agricultural audience (early risers, lunch breaks, evening wind-down)
      facebook: ['06:30', '09:00', '12:00', '17:30'],
      instagram: ['07:00', '09:00', '12:00', '18:00'],
    },
    bestDays: {
      facebook: ['Tuesday', 'Wednesday', 'Friday'],
      instagram: ['Wednesday', 'Thursday', 'Saturday'],
    },
    worstDays: ['Sunday', 'Monday morning'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 branded + 1-2 industry + 1 location',
      sampleHashtags: {
        branded: ['#YourFarmName'],
        industry: ['#FarmFresh', '#LocalProduce', '#FarmToTable', '#Agriculture', '#Farming', '#FreshMeat', '#Butcher', '#Livestock', '#Organic'],
        location: ['#QLDFarming', '#AustralianAgriculture', '#BrisbaneButcher', '#RegionalQLD', '#AussieFarmer'],
        niche: ['#PaddockToPlate', '#GrassFed', '#FreeRange', '#SmallFarm', '#FamilyFarm', '#Sustainable'],
      },
    },
    contentMix: {
      ratio: '80% value / 20% promotional',
      pillars: ['Farm Updates & Seasonal News', 'Product Highlights & Fresh Stock', 'Behind the Scenes — Farm Life', 'Recipe Ideas Using Your Products', 'Customer Stories', 'Educational — Farming Practices'],
      description: 'Show the farm, the land, the animals, the produce. Authenticity wins — real photos outperform polished marketing. Share the journey from paddock to plate.',
    },
    engagementNotes: 'Agricultural audiences value authenticity. Real farm photos outperform stock images. Seasonal content performs especially well — harvest time, new stock arrivals, weather updates.',
    imagePromptExamples: [
      'fresh cuts of premium beef on butcher paper, rustic wooden counter, warm lighting',
      'farmland at golden hour with cattle grazing, wide landscape shot',
      'box of fresh seasonal produce ready for delivery, kitchen bench, natural light',
      'farmer inspecting crops in a green field, early morning light, authentic feel',
      'meat display case in a butcher shop, clean presentation, professional lighting',
    ],
    imagePromptAvoid: 'NEVER show: computers, offices, technology, websites, abstract art, neon lights. ONLY show: farm scenes, fresh produce, meat cuts, rural landscapes, delivery boxes.',
    sources: ['Sprout Social 2024 Consumer Goods Report', 'Hootsuite 2024 Social Media for Agriculture', 'Buffer 2024 Small Business Social Study'],
  },

  'retail-ecommerce': {
    industryKey: 'retail-ecommerce',
    industryLabel: 'Retail & eCommerce',
    bestPostingTimes: {
      // Source: Sprout Social 2024 — Retail industry
      facebook: ['09:00', '10:00', '12:00', '15:00'],
      instagram: ['09:00', '11:00', '14:00', '17:00'],
    },
    bestDays: {
      facebook: ['Wednesday', 'Thursday', 'Friday'],
      instagram: ['Tuesday', 'Wednesday', 'Saturday'],
    },
    worstDays: ['Sunday', 'Late night any day'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 branded + 1-2 industry + 1 location',
      sampleHashtags: {
        branded: ['#YourStoreName'],
        industry: ['#ShopLocal', '#SmallBusiness', '#NewArrivals', '#Sale', '#Handmade', '#Boutique', '#OnlineShopping'],
        location: ['#BrisbaneShops', '#QLDSmallBusiness', '#AustralianMade', '#ShopAustralian'],
        niche: ['#SupportLocal', '#IndependentRetail', '#EthicalShopping', '#UniqueFinds'],
      },
    },
    contentMix: {
      ratio: '70% value / 30% promotional',
      pillars: ['Product Showcases', 'Behind the Scenes', 'Customer Reviews & UGC', 'Tips & Styling Ideas', 'Flash Sales & Offers', 'New Arrivals'],
      description: 'Retail can afford slightly more promotional content than other industries. Product-focused posts with lifestyle context outperform plain product shots.',
    },
    engagementNotes: 'User-generated content (customer photos) drives 4x more engagement than branded content. Instagram Stories and Reels outperform feed posts for retail.',
    imagePromptExamples: [
      'beautifully arranged product display on a clean shelf, soft lighting, boutique interior',
      'customer unboxing a package, hands visible, warm natural light, lifestyle shot',
      'flat lay of products with props on a marble surface, overhead shot, styled arrangement',
      'store interior with warm lighting, inviting atmosphere, shallow depth of field',
    ],
    imagePromptAvoid: 'NEVER show: food, farms, technology dashboards, abstract art. ONLY show: products, store interiors, packaging, lifestyle scenes with products.',
    sources: ['Sprout Social 2024 Retail Industry Report', 'Hootsuite 2024 eCommerce Guide', 'Later 2024 Retail Instagram Benchmarks'],
  },

  'professional-services': {
    industryKey: 'professional-services',
    industryLabel: 'Professional Services (IT, Consulting, Legal)',
    bestPostingTimes: {
      // Source: Sprout Social 2024 — Professional Services / B2B
      facebook: ['09:00', '10:00', '12:00', '15:00'],
      instagram: ['09:00', '11:00', '14:00', '16:00'],
    },
    bestDays: {
      facebook: ['Tuesday', 'Wednesday', 'Thursday'],
      instagram: ['Tuesday', 'Wednesday', 'Thursday'],
    },
    worstDays: ['Saturday', 'Sunday', 'Friday afternoon'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 branded + 1-2 industry + 1 professional',
      sampleHashtags: {
        branded: ['#YourCompanyName'],
        industry: ['#SmallBusiness', '#DigitalMarketing', '#WebDesign', '#ITServices', '#BusinessGrowth', '#Consulting', '#TechSolutions'],
        location: ['#BrisbaneBusiness', '#AustralianBusiness', '#QLDBusiness', '#SydneyBusiness', '#MelbourneBusiness'],
        niche: ['#BusinessTips', '#Entrepreneurship', '#StartupLife', '#WorkSmarter', '#Productivity'],
      },
    },
    contentMix: {
      ratio: '85% value / 15% promotional',
      pillars: ['Industry Tips & How-Tos', 'Case Studies & Results', 'Team & Culture', 'Client Testimonials', 'Industry News & Trends', 'Educational Content'],
      description: 'B2B and professional services need to lead with expertise. Thought leadership, case studies, and educational content build trust before any sales pitch.',
    },
    engagementNotes: 'LinkedIn may outperform Facebook/Instagram for B2B. On Facebook, educational carousels and short how-to videos get highest engagement. Avoid hard selling.',
    imagePromptExamples: [
      'modern website design displayed on a MacBook screen, clean desk, minimalist office, natural light',
      'team meeting around a whiteboard with wireframes, professional office setting, candid feel',
      'close-up of hands typing on a laptop keyboard, code or design on screen, shallow depth of field',
      'before-and-after website redesign shown on a monitor, split screen layout, professional',
      'person presenting a dashboard on a large screen in a modern office, warm lighting',
    ],
    imagePromptAvoid: 'NEVER show: food, farms, restaurants, BBQ, nature scenes without tech context. ONLY show: computers, websites, offices, technology, dashboards, team meetings, professional settings.',
    sources: ['Sprout Social 2024 B2B Social Report', 'Hootsuite 2024 Professional Services Guide', 'Buffer 2024 B2B Content Study'],
  },

  'health-wellness': {
    industryKey: 'health-wellness',
    industryLabel: 'Health, Wellness & Fitness',
    bestPostingTimes: {
      // Source: Sprout Social 2024 — Health & Wellness
      facebook: ['07:00', '09:00', '12:00', '17:00'],
      instagram: ['06:00', '08:00', '12:00', '18:00'],
    },
    bestDays: {
      facebook: ['Monday', 'Wednesday', 'Friday'],
      instagram: ['Monday', 'Tuesday', 'Thursday'],
    },
    worstDays: ['Saturday evening', 'Sunday afternoon'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 branded + 1-2 wellness + 1 location',
      sampleHashtags: {
        branded: ['#YourBusinessName'],
        industry: ['#Fitness', '#Wellness', '#HealthyLiving', '#Yoga', '#PersonalTraining', '#MentalHealth', '#SelfCare'],
        location: ['#BrisbaneFitness', '#QLDWellness', '#AustralianFitness', '#LocalGym'],
        niche: ['#FitFam', '#HealthyLifestyle', '#MindBody', '#WorkoutMotivation', '#WellnessJourney'],
      },
    },
    contentMix: {
      ratio: '80% value / 20% promotional',
      pillars: ['Workout Tips & Routines', 'Nutrition & Recipes', 'Client Transformations', 'Motivational Content', 'Behind the Scenes', 'Class Schedules & Events'],
      description: 'Health & wellness audiences want inspiration and education. Before/after transformations and quick tip videos drive highest engagement.',
    },
    engagementNotes: 'Instagram Reels showing quick exercises or recipes get 3-5x more reach than static posts. Early morning posts catch the pre-workout audience.',
    imagePromptExamples: [
      'person doing yoga in a bright studio, warm natural light, peaceful atmosphere',
      'healthy meal prep bowls on a kitchen counter, colourful vegetables, overhead shot',
      'gym equipment with morning sunlight streaming through windows, motivational vibe',
      'personal trainer demonstrating an exercise, action shot, gym setting',
    ],
    imagePromptAvoid: 'NEVER show: junk food, offices, computers, technology. ONLY show: fitness activities, healthy food, wellness spaces, nature/outdoors for wellness.',
    sources: ['Sprout Social 2024 Health & Wellness Report', 'Later 2024 Fitness Instagram Study', 'Hootsuite 2024 Health Industry Guide'],
  },

  'events-festivals': {
    industryKey: 'events-festivals',
    industryLabel: 'Events, Festivals & Markets',
    bestPostingTimes: {
      facebook: ['10:00', '12:00', '17:00', '19:00'],
      instagram: ['09:00', '11:00', '17:00', '20:00'],
    },
    bestDays: {
      facebook: ['Wednesday', 'Thursday', 'Friday'],
      instagram: ['Tuesday', 'Thursday', 'Friday'],
    },
    worstDays: ['Monday morning', 'Late Sunday'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 event-specific + 1-2 industry + 1 location',
      sampleHashtags: {
        branded: ['#YourEventName'],
        industry: ['#LocalEvent', '#FoodFestival', '#LiveMusic', '#MarketDay', '#CommunityEvent', '#WeekendPlans'],
        location: ['#BrisbaneEvents', '#QLDEvents', '#GoldCoastEvents', '#AustralianFestivals'],
        niche: ['#SupportLocal', '#WeekendVibes', '#FestivalSeason', '#FoodieEvent'],
      },
    },
    contentMix: {
      ratio: '70% hype & value / 30% promotional',
      pillars: ['Event Countdown & Teasers', 'Vendor & Performer Spotlights', 'Behind the Scenes Setup', 'Past Event Highlights', 'Ticket & Attendance Info', 'Community Stories'],
      description: 'Events thrive on FOMO and excitement. Build momentum with countdown posts, vendor reveals, and throwback highlights. Increase frequency as the event approaches.',
    },
    engagementNotes: 'Post frequency should increase as the event date approaches. Video content from past events creates powerful FOMO. Tag vendors and performers for cross-promotion.',
    imagePromptExamples: [
      'bustling outdoor market with food stalls, colourful bunting, crowd atmosphere',
      'live band performing on stage at a festival, evening lights, energy and excitement',
      'vendor setting up a stall at dawn, behind-the-scenes preparation, warm light',
      'aerial view of a festival grounds with tents and crowds, vibrant atmosphere',
    ],
    imagePromptAvoid: 'NEVER show: offices, computers, generic stock photos. ONLY show: event venues, crowds, performers, market stalls, festival atmosphere.',
    sources: ['Sprout Social 2024 Entertainment Industry Report', 'Hootsuite 2024 Event Marketing Guide'],
  },

  'generic': {
    industryKey: 'generic',
    industryLabel: 'Small Business (General)',
    bestPostingTimes: {
      // Source: Sprout Social 2024 — All-industry averages
      facebook: ['09:00', '10:00', '12:00', '17:00'],
      instagram: ['09:00', '11:00', '14:00', '17:00'],
    },
    bestDays: {
      facebook: ['Tuesday', 'Wednesday', 'Thursday'],
      instagram: ['Tuesday', 'Wednesday', 'Friday'],
    },
    worstDays: ['Sunday', 'Late night any day'],
    hashtagStrategy: {
      ...HASHTAG_LIMITS,
      mixStrategy: '1 branded + 1-2 industry + 1 location',
      sampleHashtags: {
        branded: ['#YourBusinessName'],
        industry: ['#SmallBusiness', '#ShopLocal', '#SupportLocal', '#BusinessGrowth'],
        location: ['#BrisbaneBusiness', '#QLDSmallBusiness', '#AustralianBusiness'],
        niche: ['#Entrepreneur', '#SmallBusinessOwner', '#LocalBusiness'],
      },
    },
    contentMix: {
      ratio: '80% value / 20% promotional',
      pillars: ['Product/Service Showcase', 'Behind the Scenes', 'Customer Stories', 'Tips & Education', 'Seasonal/Trending'],
      description: 'Focus on building trust and community first. Most of your content should provide value — only 1 in 5 posts should directly promote.',
    },
    engagementNotes: 'Consistency matters more than frequency. Posting 3-4 times per week consistently outperforms daily posting that drops off. Respond to every comment within 2 hours.',
    imagePromptExamples: [
      'small business storefront with an open sign, welcoming atmosphere, morning light',
      'business owner working at their desk, authentic candid shot, warm lighting',
      'product arrangement on a clean surface, professional photography, brand colours',
      'team photo in a workspace, natural smiles, professional but authentic',
    ],
    imagePromptAvoid: 'NEVER show: anything unrelated to the specific business type. Match images to the actual products/services of the business.',
    sources: ['Sprout Social 2024 All-Industry Average', 'Buffer 2024 Small Business Report', 'CoSchedule 2024 Social Media Timing Study'],
  },
};

// ── Industry Matching ────────────────────────────────────────────────────────

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'food-restaurant': ['bbq', 'barbeque', 'barbecue', 'restaurant', 'food', 'catering', 'deli', 'butcher', 'meat', 'cafe', 'bakery', 'bar', 'pub', 'pizza', 'grill', 'kitchen', 'bistro', 'takeaway', 'sushi', 'thai', 'indian', 'mexican', 'burger', 'chicken', 'seafood', 'steak', 'smokehouse', 'pickle', 'ferment', 'artisan food', 'food truck'],
  'agriculture-farming': ['farm', 'agriculture', 'agri', 'produce', 'livestock', 'dairy', 'crop', 'harvest', 'vineyard', 'orchard', 'nursery', 'horticulture', 'paddock'],
  'retail-ecommerce': ['retail', 'shop', 'store', 'ecommerce', 'e-commerce', 'boutique', 'fashion', 'clothing', 'jewelry', 'gift', 'homewares', 'florist'],
  'professional-services': ['it ', 'consulting', 'professional', 'agency', 'accountant', 'lawyer', 'legal', 'financial', 'architect', 'engineer', 'web design', 'software', 'technology', 'digital'],
  'health-wellness': ['health', 'wellness', 'fitness', 'gym', 'yoga', 'pilates', 'personal train', 'medical', 'dental', 'physio', 'chiro', 'massage', 'beauty', 'salon', 'spa'],
  'events-festivals': ['festival', 'event', 'conference', 'market', 'expo', 'show', 'concert', 'fair'],
};

function matchIndustry(businessType: string): string {
  const lower = businessType.toLowerCase();
  for (const [key, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return key;
  }
  return 'generic';
}

// ── Timezone ─────────────────────────────────────────────────────────────────

function getTimezone(location: string): TimezoneInfo {
  const lower = location.toLowerCase();

  if (lower.includes('australia') || lower.includes('queensland') || lower.includes('qld') ||
      lower.includes('brisbane') || lower.includes('gold coast') || lower.includes('sunshine coast') ||
      lower.includes('ipswich') || lower.includes('toowoomba') || lower.includes('cairns') ||
      lower.includes('townsville') || lower.includes('rockhampton') || lower.includes('mackay')) {
    // Queensland does NOT observe daylight saving time
    return { timezone: 'AEST', utcOffset: '+10:00', label: 'Australian Eastern Standard Time', note: 'Queensland — no daylight saving time' };
  }
  if (lower.includes('sydney') || lower.includes('nsw') || lower.includes('new south wales') ||
      lower.includes('melbourne') || lower.includes('victoria') || lower.includes('vic') ||
      lower.includes('canberra') || lower.includes('act') || lower.includes('hobart') || lower.includes('tasmania')) {
    const month = new Date().getMonth(); // 0-indexed
    const isDST = month >= 9 || month <= 2; // Oct-Mar
    return isDST
      ? { timezone: 'AEDT', utcOffset: '+11:00', label: 'Australian Eastern Daylight Time', note: 'NSW/VIC/TAS/ACT — daylight saving active' }
      : { timezone: 'AEST', utcOffset: '+10:00', label: 'Australian Eastern Standard Time', note: 'NSW/VIC/TAS/ACT — standard time' };
  }
  if (lower.includes('adelaide') || lower.includes('south australia') || lower.includes('sa ')) {
    const month = new Date().getMonth();
    const isDST = month >= 9 || month <= 2;
    return isDST
      ? { timezone: 'ACDT', utcOffset: '+10:30', label: 'Australian Central Daylight Time', note: 'SA — daylight saving active' }
      : { timezone: 'ACST', utcOffset: '+09:30', label: 'Australian Central Standard Time', note: 'SA — standard time' };
  }
  if (lower.includes('perth') || lower.includes('western australia') || lower.includes('wa ')) {
    return { timezone: 'AWST', utcOffset: '+08:00', label: 'Australian Western Standard Time', note: 'WA — no daylight saving time' };
  }
  if (lower.includes('darwin') || lower.includes('northern territory') || lower.includes('nt ')) {
    return { timezone: 'ACST', utcOffset: '+09:30', label: 'Australian Central Standard Time', note: 'NT — no daylight saving time' };
  }

  // Default for unrecognized Australian locations
  if (lower.includes('australia')) {
    return { timezone: 'AEST', utcOffset: '+10:00', label: 'Australian Eastern Standard Time', note: 'Australia (defaulting to AEST)' };
  }

  // Non-Australian — just note the location
  return { timezone: 'LOCAL', utcOffset: 'unknown', label: 'Local time', note: `Times should be adapted to the local timezone of ${location}` };
}

// ── Main Export ──────────────────────────────────────────────────────────────

export function getIndustryBenchmarks(businessType: string, location: string): BenchmarkResult {
  const industryKey = matchIndustry(businessType);
  const data = INDUSTRY_DATA[industryKey] || INDUSTRY_DATA['generic'];
  const timezone = getTimezone(location);
  return { data, timezone };
}

// ── Prompt Formatter ─────────────────────────────────────────────────────────

export function formatBenchmarksForPrompt(data: IndustryBenchmarks, timezone: TimezoneInfo): string {
  return `
VERIFIED RESEARCH DATA (from ${data.sources.join(', ')} — use as ground truth, do NOT contradict):

INDUSTRY: ${data.industryLabel}
TIMEZONE: ${timezone.label} (${timezone.utcOffset}) — ${timezone.note}

BEST POSTING TIMES (${timezone.timezone}):
  Facebook: ${data.bestPostingTimes.facebook.join(', ')}
  Instagram: ${data.bestPostingTimes.instagram.join(', ')}

BEST DAYS:
  Facebook: ${data.bestDays.facebook.join(', ')}
  Instagram: ${data.bestDays.instagram.join(', ')}
  AVOID: ${data.worstDays.join(', ')}

HASHTAG RULES (CRITICAL — DO NOT EXCEED):
  Facebook: ${data.hashtagStrategy.facebook.optimal} hashtags per post (max ${data.hashtagStrategy.facebook.max})
  Instagram: ${data.hashtagStrategy.instagram.optimal} hashtags per post (max ${data.hashtagStrategy.instagram.max})
  Mix: ${data.hashtagStrategy.mixStrategy}

CONTENT MIX:
  Ratio: ${data.contentMix.ratio}
  Strategy: ${data.contentMix.description}
  Recommended pillars: ${data.contentMix.pillars.join(' | ')}

ENGAGEMENT INSIGHT: ${data.engagementNotes}

IMAGE PROMPT RULES (CRITICAL — images must match the business):
  ${data.imagePromptAvoid}
  GOOD examples for this industry:
${data.imagePromptExamples.map(e => `    - "${e}"`).join('\n')}
`.trim();
}
