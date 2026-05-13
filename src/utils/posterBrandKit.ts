/**
 * SocialAI Studio — Poster Maker brand-kit module.
 *
 * Originally built as a white-label 3-file drop-in for hughesysque
 * (posterBrandKit + posterComposer + PosterManager). The hughesysque
 * version was single-tenant — `ACTIVE_BRAND_KIT` was a module-load
 * constant that merged the compiled defaults with a localStorage blob.
 *
 * Here in SocialAi Studio the brand kit is **per-workspace** (Agency-plan
 * multi-client) — Steve might be editing Pickle Nick's brand kit one
 * moment and Street Meats' the next. That means:
 *
 *   1. No module-load `ACTIVE_BRAND_KIT` const. Brand kit is fetched
 *      from the Worker per workspace and provided via a React Context
 *      (see `contexts/BrandKitContext.tsx`).
 *   2. No localStorage read/write. Overrides live in D1 keyed by
 *      (user_id, client_id) so they travel devices and stay scoped
 *      to the workspace they belong to.
 *   3. The base kit is *derived* from the active `client.config.ts`
 *      (accent colour, brand name) — see `buildBaseBrandKit` — so each
 *      white-label SocialAi deploy gets sensible defaults without
 *      hand-authoring a kit per tenant. The admin then customises
 *      via the in-app Brand Kit Editor (Phase 2 — see PosterManager).
 *
 * The compositor (`posterComposer.ts`) and the prompt builders below
 * are brand-agnostic — they take a `PosterBrandKit` as input. So the
 * "per-workspace" change is purely about WHERE the kit comes from at
 * the call site, not how it's structured.
 */

import { CLIENT } from '../client.config';

// ── Types (mirror hughesysque verbatim — the shapes are the contract
//    between composer + prompt builders + editor). ──────────────────────────

export interface PosterBrandKit {
  /** Display name — used in download filenames and AI copy. */
  brandName: string;
  /** Short handle — used in the logo monogram fallback. */
  shortHandle: string;
  /** Hex colour tokens. Every value MUST be in `#rrggbb` format. */
  palette: {
    primary: string;
    primaryDark: string;
    accent: string;
    background: string;
    backgroundDark: string;
    surface: string;
    text: string;
    textMuted: string;
    emberHot: string;
    emberWarm: string;
    emberGlow: string;
  };
  /** Font families — MUST already be loaded by the host app. */
  fonts: {
    display: string;
    body: string;
  };
  /** Logo URL — absolute path or full URL. */
  logoUrl: string;
  /** Smart defaults for the per-poster form. */
  defaults: {
    headline: string;
    subhead: string;
    pickupTime: string;
    hashtags: string[];
    heroPrompt: string;
    qrCodeUrl: string;
    qrCodeLabel: string;
  };
  /** Brand voice — consumed by the LLM caption / brief-expand routes. */
  voice?: {
    register: string;
    signaturePhrases: string[];
    bannedPhrases: string[];
  };
  /** Quick-start chip templates the admin can author per workspace. */
  presets?: PosterPreset[];
}

export interface PosterPreset {
  id: string;
  label: string;
  description: string;
  copy: {
    headline?: string;
    subhead?: string;
    pickupTime?: string;
    body?: string;
    hashtags?: string[];
    heroPrompt?: string;
    qrLabel?: string;
  };
}

/**
 * The override blob shape stored in D1 keyed by (user_id, client_id).
 * Presets are total-replace, not deep-merge — same rationale as the
 * hughesysque origin: the editor needs to be able to DELETE an entry,
 * which a merge can't express.
 */
export type BrandKitOverrides = Partial<{
  palette: Partial<PosterBrandKit['palette']>;
  voice:   Partial<NonNullable<PosterBrandKit['voice']>>;
  defaults: Partial<Pick<PosterBrandKit['defaults'], 'qrCodeUrl' | 'qrCodeLabel'>>;
  presets: PosterPreset[];
}>;

// ── Base kit derivation ────────────────────────────────────────────────────
//
// Each white-label SocialAi deploy has its own `client.config.ts` with
// accentColor + brand metadata. The base poster brand kit is derived from
// that so a brand-new workspace gets sensible defaults without anyone
// hand-authoring a poster kit per tenant. The admin then customises via the
// Brand Kit Editor — overrides land in D1 and persist per-workspace.

/**
 * Shade a hex colour toward black (amount > 0) or white (amount < 0). Used
 * to derive primaryDark from primary without dragging in a colour lib.
 */
function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Default poster brand kit for the current white-label deploy. Reads the
 * active `client.config.ts` so each SocialAi Studio instance gets a kit
 * tuned to its accent colour and brand name. The admin in-app editor
 * adds workspace-scoped overrides on top via `applyBrandKitOverrides`.
 */
export const BASE_BRAND_KIT: PosterBrandKit = {
  brandName: CLIENT.defaultBusinessName || CLIENT.appName,
  shortHandle: (CLIENT.defaultBusinessName || CLIENT.appName)
    .split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase() || 'SAI',
  palette: {
    primary:        CLIENT.accentColor || '#f59e0b',
    primaryDark:    shadeHex(CLIENT.accentColor || '#f59e0b', -60),
    accent:         '#fbbf24',
    background:     '#0a0a0a',
    backgroundDark: '#0f0f0f',
    surface:        '#1f1f1f',
    text:           '#ffffff',
    textMuted:      '#9ca3af',
    emberHot:       '#ff3c00',
    emberWarm:      '#ff6a1a',
    emberGlow:      '#ff8c28',
  },
  fonts: {
    display: 'Inter',
    body:    'Inter',
  },
  logoUrl: '/logo.png',
  defaults: {
    headline:   'NEW ANNOUNCEMENT',
    subhead:    'COMING UP',
    pickupTime: '',
    hashtags: ['#localBusiness', '#australia', '#supportLocal'],
    heroPrompt:
      'A phone snapshot of the business in action — natural daylight, real working mess in the background, candid hand-held framing, slight motion blur. No styling, no filter, no garnish.',
    qrCodeUrl:   CLIENT.salesUrl || '',
    qrCodeLabel: 'SCAN TO LEARN MORE',
  },
  voice: {
    register: CLIENT.defaultTone || 'Friendly and professional',
    signaturePhrases: [],
    bannedPhrases: ['delicious', 'tasty', 'yummy', 'elevate', 'curate', 'artisanal'],
  },
  presets: [
    // Three generic small-business presets seed the chip row. The admin can
    // customise per workspace — different industries want different shapes.
    {
      id: 'announcement',
      label: 'Announcement',
      description: 'General news, opening hours, updates.',
      copy: {
        headline: 'WHAT\'S NEW',
        subhead:  'OPEN NOW',
        body:     'Drop the latest update here — one or two sentences in your voice.',
        qrLabel:  'LEARN MORE',
      },
    },
    {
      id: 'promo',
      label: 'Promo / Sale',
      description: 'Limited-time deal, sale, or special offer.',
      copy: {
        headline: 'LIMITED TIME',
        subhead:  'THIS WEEK ONLY',
        body:     'Quick line about the deal — what\'s included, who it\'s for.',
        qrLabel:  'GRAB THE DEAL',
      },
    },
    {
      id: 'event',
      label: 'Event',
      description: 'In-person event, popup, or launch.',
      copy: {
        headline: 'JOIN US',
        subhead:  'SAVE THE DATE',
        body:     'When + where + what to expect. Bring a mate.',
        qrLabel:  'GET TICKETS',
      },
    },
  ],
};

// ── Merge logic ────────────────────────────────────────────────────────────

/**
 * Deep-merge an override blob onto a base brand kit. Only the fields present
 * in the override survive; everything else keeps the base value. Returns a
 * new kit — does NOT mutate the input.
 *
 * `presets` is total-replace, not deep-merge (see BrandKitOverrides docstring).
 * An empty array IS a valid override (means "no presets at all"); `undefined`
 * means "fall back to base.presets".
 */
export function applyBrandKitOverrides(
  base: PosterBrandKit,
  overrides: BrandKitOverrides,
): PosterBrandKit {
  return {
    ...base,
    palette: { ...base.palette, ...(overrides.palette || {}) },
    voice: overrides.voice && base.voice
      ? { ...base.voice, ...overrides.voice }
      : (overrides.voice as PosterBrandKit['voice']) ?? base.voice,
    defaults: { ...base.defaults, ...(overrides.defaults || {}) },
    presets: overrides.presets !== undefined ? overrides.presets : base.presets,
  };
}

// ── LLM prompt builders ────────────────────────────────────────────────────
//
// Same as hughesysque-origin — take a kit, return a tuned system prompt for
// each of the three poster-side AI tasks. Called by `services/posterAi.ts`
// which then pipes them through `/api/ai/generate` on the Worker.

/**
 * Turn a casual admin brief into structured poster fields.
 */
export function buildPosterCopySystemPrompt(kit: PosterBrandKit): string {
  const v = kit.voice;
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return `You are the in-house copywriter for ${kit.brandName}. Your job is to take the admin's casual, possibly-fragmentary brief and expand it into structured poster copy in their voice.

TODAY IS: ${today}
USE THIS to resolve relative dates ("tomorrow", "Saturday", "this weekend") to concrete dates.

${v ? `BRAND VOICE
- Register: ${v.register}
- Signature phrases (use sparingly, max 1 per poster): ${v.signaturePhrases.map(s => `"${s}"`).join(', ')}
- BANNED phrases (NEVER produce these): ${v.bannedPhrases.map(s => `"${s}"`).join(', ')}` : ''}

OUTPUT — STRICT JSON, NO PROSE, NO MARKDOWN FENCES, NO COMMENTARY.
Use exactly these keys; omit keys you can't fill rather than guess:
{
  "headline":   string,    // ALL-CAPS, 2-5 words, max 28 characters.
  "subhead":   string,     // ALL-CAPS, 2-4 words, max 22 characters.
  "venue":     string,     // Proper case.
  "date":      string,     // Format "DAY DDD MMM" ALL-CAPS, e.g. "SAT 17 MAY".
  "pickupTime": string,    // ALL-CAPS, e.g. "8AM-8PM".
  "body":      string,     // Sentence case. 1-3 sentences max 320 chars. AU spelling.
  "hashtags":  string[],   // 8-15 lowercase tags, no # prefix.
  "heroPrompt": string     // AI-image prompt. Phone-snapshot vibe.
}

RULES
- AU spelling always (flavour not flavor, centre not center).
- Headline + subhead + date + pickupTime always uppercase.
- If the brief mentions a date/venue/time, USE IT verbatim — don't paraphrase.
- Don't invent specifics the brief doesn't supply.
- Don't ask for clarification — produce your best guess.
- The brief follows on the next message.`;
}

/**
 * Build the LLM system prompt that turns finished poster fields into a
 * ready-to-paste Instagram / Facebook caption in the brand's voice.
 */
export function buildCaptionSystemPrompt(kit: PosterBrandKit): string {
  const v = kit.voice;
  return `You are the social-media writer for ${kit.brandName}. The admin has finished making a poster and is about to post it to Instagram and Facebook. Your job is to write the CAPTION that goes alongside the poster image.

The image already shows the headline, the date, the venue, the QR code. The caption shouldn't repeat them word-for-word — it should COMPLEMENT the image with the human, conversational layer.

${v ? `BRAND VOICE
- Register: ${v.register}
- Signature phrases (use sparingly, max 1 per caption): ${v.signaturePhrases.map(s => `"${s}"`).join(', ')}
- BANNED phrases (NEVER produce these): ${v.bannedPhrases.map(s => `"${s}"`).join(', ')}` : ''}

CAPTION RULES
- Sentence case throughout. NOT all-caps — that's for the poster, not the caption.
- AU spelling always (flavour, centre, savoury, organisation, neighbourhood).
- Open with a hook in the brand's voice. One short line.
- Then 1-3 short paragraphs that translate the poster's energy into conversational tone. Mention venue, date and pickup window in natural language.
- If a QR / order URL is supplied, mention it as the way to take action ("Link in bio" for Insta or a direct URL for FB).
- End with the hashtag stack on its own line, space-separated, all lowercase, no commas.
- Total length: 80-220 words.
- Use line breaks between paragraphs for readability — captions are read on phones.
- Don't restate the headline verbatim. Don't repeat the date or venue more than once.
- Plain text only — no markdown, no asterisks, no fences.

OUTPUT — A SINGLE STRING ready for the admin to paste. No JSON wrapping. No commentary.

The poster details follow on the next message.`;
}

/**
 * Suggest WHEN to post the finished poster, using AU food-business heuristics.
 */
export function buildPostTimeSystemPrompt(kit: PosterBrandKit): string {
  const v = kit.voice;
  const now = new Date();
  const today = now.toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const currentTime = now.toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  return `You are the social-media strategist for ${kit.brandName}. Your job is to suggest the BEST TIME to post a finished poster on Instagram and Facebook.

TODAY: ${today}
CURRENT TIME: ${currentTime}

${v ? `BRAND VOICE for the reasoning line:
- Register: ${v.register}
- Banned phrases (NEVER use): ${v.bannedPhrases.map(s => `"${s}"`).join(', ')}` : ''}

POSTING HEURISTICS (Australian small business audience)
- Same-day announcements: post 4-6 hours BEFORE the event so people factor it into their day.
- Lunch-time events: post 2-3h before (limited lead time).
- Weekend events (Sat/Sun): announce FRIDAY MORNING (8-10am).
- Catering / B2B pitches: post Tuesday or Wednesday 10am.
- Australian Instagram engagement peaks: 7am, 12pm, 5pm, 9pm weekdays. Weekend: 9am, 1pm, 7pm.
- AVOID: Sunday night 8pm-11pm. Monday before 9am.

RULES
- Suggest ONE specific time slot. Times in AU local 12-hour format with day name.
- Don't suggest a time in the past unless explicitly necessary.
- The reasoning is ONE sentence (max 18 words) in the brand voice.

OUTPUT — STRICT JSON, NO PROSE, NO MARKDOWN FENCES, NO COMMENTARY:
{
  "time":      string,
  "reasoning": string
}

The poster details follow on the next message.`;
}
