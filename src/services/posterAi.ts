/**
 * SocialAI Studio — Poster Maker AI helpers.
 *
 * Wraps the Worker's `/api/ai/generate` (text) and `/api/ai/poster-image`
 * (image) endpoints with the poster-specific system prompts. Auth is
 * handled the same way as `services/db.ts` / `services/posters.ts` —
 * pass a Clerk getToken and the calls attach Bearer headers.
 *
 * The OpenRouter key never leaves the Worker. This file is purely a
 * client-side shape converter — the model + temperature live server-side.
 */

const BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

type GetToken = () => Promise<string | null>;
type AuthMode = 'clerk' | 'portal';

async function callAi(
  getToken: GetToken,
  authMode: AuthMode,
  body: {
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: 'text' | 'json';
  },
): Promise<string> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = authMode === 'portal' ? `Portal ${token}` : `Bearer ${token}`;

  const res = await fetch(`${BASE}/api/ai/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`AI ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json() as { text?: string };
  return data.text || '';
}

// ── Helpers (the response-parsing layer from the hughesysque origin) ───

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]);
}

// ── Public API ─────────────────────────────────────────────────────────

export interface ExpandedPosterFields {
  headline?: string;
  subhead?: string;
  venue?: string;
  date?: string;
  pickupTime?: string;
  body?: string;
  hashtags?: string[];
  heroPrompt?: string;
}

export interface CaptionInputs {
  brandName: string;
  headline: string;
  subhead?: string;
  venue: string;
  date: string;
  pickupTime?: string;
  body?: string;
  hashtags?: string[];
  qrUrl?: string;
}

export interface PostTimeInputs {
  brandName: string;
  headline: string;
  subhead?: string;
  venue: string;
  date: string;
  pickupTime?: string;
  body?: string;
}

export interface PostTimeSuggestion {
  time: string;
  reasoning: string;
}

/**
 * Turn an admin's casual brief into structured poster fields. Returns
 * null on empty input; throws on AI/transport failure so the caller can
 * show a graceful error and let the admin fill the form manually.
 */
export async function expandPosterBrief(
  getToken: GetToken,
  brief: string,
  systemPrompt: string,
  authMode: AuthMode = 'clerk',
): Promise<ExpandedPosterFields | null> {
  if (!brief.trim()) return null;

  const raw = await callAi(getToken, authMode, {
    prompt: `Brief:\n${brief}`,
    systemPrompt,
    responseFormat: 'json',
    temperature: 0.7,
  });

  let parsed: any;
  try { parsed = extractJson(raw); }
  catch {
    throw new Error('AI returned an unparseable response — try rewording your brief.');
  }

  // Coerce + clamp to the documented contract.
  const out: ExpandedPosterFields = {};
  const str = (v: any, max: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

  if (str(parsed.headline, 40))   out.headline   = str(parsed.headline, 40)!.toUpperCase();
  if (str(parsed.subhead, 30))    out.subhead    = str(parsed.subhead, 30)!.toUpperCase();
  if (str(parsed.venue, 80))      out.venue      = str(parsed.venue, 80)!;
  if (str(parsed.date, 20))       out.date       = str(parsed.date, 20)!.toUpperCase();
  if (str(parsed.pickupTime, 60)) out.pickupTime = str(parsed.pickupTime, 60)!.toUpperCase();
  if (str(parsed.body, 320))      out.body       = str(parsed.body, 320)!;
  if (str(parsed.heroPrompt, 1000)) out.heroPrompt = str(parsed.heroPrompt, 1000)!;
  if (Array.isArray(parsed.hashtags)) {
    out.hashtags = parsed.hashtags
      .filter((t: any) => typeof t === 'string' && t.trim())
      .map((t: string) => t.trim().replace(/^#+/, ''))
      .slice(0, 15);
  }

  return out;
}

/**
 * Turn finished poster fields into a ready-to-paste IG/FB caption.
 */
export async function generateSocialCaption(
  getToken: GetToken,
  inputs: CaptionInputs,
  systemPrompt: string,
  authMode: AuthMode = 'clerk',
): Promise<string | null> {
  if (!inputs.headline?.trim() || !inputs.venue?.trim() || !inputs.date?.trim()) {
    throw new Error('Headline, venue and date are required to write a caption.');
  }

  const lines: string[] = [];
  lines.push(`Brand: ${inputs.brandName}`);
  lines.push(`Headline on the image: ${inputs.headline}`);
  if (inputs.subhead?.trim())    lines.push(`Subhead on the image: ${inputs.subhead}`);
  lines.push(`Venue: ${inputs.venue}`);
  lines.push(`Date: ${inputs.date}`);
  if (inputs.pickupTime?.trim()) lines.push(`Hours: ${inputs.pickupTime}`);
  if (inputs.body?.trim())       lines.push(`Body copy on the image: ${inputs.body}`);
  if (inputs.qrUrl?.trim())      lines.push(`Order URL (QR target): ${inputs.qrUrl}`);
  if (inputs.hashtags?.length) {
    const tags = inputs.hashtags
      .map(t => t.trim()).filter(Boolean)
      .map(t => (t.startsWith('#') ? t : `#${t}`))
      .join(' ');
    if (tags) lines.push(`Hashtags to use: ${tags}`);
  }

  const raw = await callAi(getToken, authMode, {
    prompt: `Poster details:\n${lines.join('\n')}`,
    systemPrompt,
    temperature: 0.85,
  });

  if (!raw?.trim()) return null;

  // Strip ``` fences and any "Here's the caption:" preamble the model can leak.
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  cleaned = cleaned.replace(/^(here(?:'s| is) (?:the )?caption[:\-]?|caption[:\-]?)\s*\n?/i, '').trim();
  return cleaned || null;
}

/**
 * Suggest WHEN to post the poster — short structured object.
 */
export async function suggestPostTime(
  getToken: GetToken,
  inputs: PostTimeInputs,
  systemPrompt: string,
  authMode: AuthMode = 'clerk',
): Promise<PostTimeSuggestion | null> {
  if (!inputs.headline?.trim() || !inputs.venue?.trim() || !inputs.date?.trim()) {
    throw new Error('Headline, venue and date are required to suggest a post time.');
  }

  const lines: string[] = [];
  lines.push(`Brand: ${inputs.brandName}`);
  lines.push(`Headline on the poster: ${inputs.headline}`);
  if (inputs.subhead?.trim())    lines.push(`Subhead: ${inputs.subhead}`);
  lines.push(`Cook day date: ${inputs.date}`);
  lines.push(`Venue: ${inputs.venue}`);
  if (inputs.pickupTime?.trim()) lines.push(`Pickup / trading hours: ${inputs.pickupTime}`);
  if (inputs.body?.trim())       lines.push(`Body copy: ${inputs.body}`);

  const raw = await callAi(getToken, authMode, {
    prompt: `Poster details:\n${lines.join('\n')}`,
    systemPrompt,
    responseFormat: 'json',
    temperature: 0.6,
  });

  let parsed: any;
  try { parsed = extractJson(raw); }
  catch { throw new Error('AI returned an unparseable response — try again.'); }

  const time      = typeof parsed.time      === 'string' ? parsed.time.trim()      : '';
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
  if (!time) return null;
  return { time: time.slice(0, 60), reasoning: reasoning.slice(0, 200) };
}

/**
 * Generate a hero image via the Worker's image endpoint. The Worker proxies
 * OpenRouter so no API key ships to the browser. Returns null on hard
 * failure; throws on auth/transport errors so the caller can show the
 * proper "AI service offline" notice vs the "fell back to upload" notice.
 */
export async function generatePosterArt(
  getToken: GetToken,
  prompt: string,
  aspectRatio: '1:1' | '9:16' | '16:9' = '1:1',
  authMode: AuthMode = 'clerk',
): Promise<string | null> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = authMode === 'portal' ? `Portal ${token}` : `Bearer ${token}`;

  const res = await fetch(`${BASE}/api/ai/poster-image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, aspectRatio }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Image gen ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json() as { dataUrl?: string };
  return data.dataUrl || null;
}
