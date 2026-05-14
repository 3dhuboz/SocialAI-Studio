// Campaign research agent — turns a free-form campaign rule ("promote my
// website example.com — focus on the new AI tools page") into a structured
// research brief that the post-writer reuses across every scheduled post in
// the campaign window.
//
// Flow:
//   1. Pull URLs out of the user's text (extractUrls)
//   2. Fetch each URL's readable text in parallel (fetchUrlText, ≤3 URLs)
//   3. Send everything (business context + user text + scraped pages) to
//      Haiku in JSON mode. Single call returns { brief, summary, angles }.
//   4. Caller persists the result on the campaigns row.
//
// Why JSON-mode in one call:
//   - Lower latency than running brief + summary as separate calls.
//   - Atomically consistent — the summary is guaranteed to describe the
//     brief that's saved, no risk of mismatched pairs.
//   - Anthropic Haiku 4.5 honours the JSON-mode instruction reliably at
//     temp 0.3, with the OpenRouter response_format: json_object as fallback.
//
// Cost shape (typical): 1 web fetch (~5k tokens of text) + ~2k tokens of
// business context + ~1k tokens of output ≈ $0.005 per research run on
// Haiku 4.5. Cheap enough to run on every campaign create/update.
//
// NOT a generic agent — specifically scoped to "make this campaign
// smarter". A future general agent loop would add tool-use, multi-turn,
// memory, etc. This is the simplest possible thing that makes the UX
// feel intelligent.

import { callAnthropicDirect } from './anthropic';
import { fetchUrlText, extractUrls, type WebFetchResult } from './web-fetch';

export interface CampaignResearchInput {
  /** The user's raw campaign rules text — what they typed in the UI. */
  campaignText: string;
  /** Optional campaign name (e.g. "Mother's Day push"). Helps the AI frame angles. */
  campaignName?: string;
  /** Date window — useful for the AI to pace urgency ("3 days before launch"). */
  startDate?: string;
  endDate?: string;
  /** Business context — the AI uses this as the lens for the brief. */
  businessName: string;
  businessType: string;
  businessDescription?: string;
  productsServices?: string;
  location?: string;
  tone?: string;
}

export interface CampaignResearchResult {
  status: 'ready' | 'failed';
  /** Multi-section brief: product summary, features, pricing, audience,
   *  competitor comparison, post angles. Markdown. ~1-2k chars. */
  brief: string;
  /** 1-2 sentence "I checked example.com and found 3 features…" line for
   *  the UI's confirmation reply. ≤ 200 chars. */
  summary: string;
  /** URLs we actually fetched + whether each succeeded. UI shows this so the
   *  user can see what the agent looked at. */
  sources: Array<{ url: string; ok: boolean; title?: string; status?: number; error?: string }>;
  /** When status='failed', why. Stable strings the UI can branch on:
   *  'no-business-context' | 'ai-call-failed' | 'no-data-to-research' */
  failureReason?: string;
}

const RESEARCH_SYSTEM_PROMPT = `You are a senior B2B copywriter researching a marketing campaign for a small business. Your job is to turn the business owner's loose description and (when supplied) the actual content of their website into a structured brief that another AI will use to write 14 social-media posts over the next 1–4 weeks.

Hard rules:
- Use ONLY information present in the BUSINESS CONTEXT or WEB CONTENT blocks. Never invent features, prices, or guarantees.
- If a fact isn't in the materials, OMIT it — do not hedge ("possibly", "perhaps", "may include").
- Specific > generic. "AI Content Autopilot writes 14 posts/week from a 30-min onboarding" beats "AI-powered content creation".
- Australian small-business voice. No corporate fluff. No "in today's fast-paced world".
- The summary line must read like a person speaking — "Checked your homepage and the AI Tools page — here's the angle…" — not a status report.
- Output STRICT JSON, no prose, no code fences.`;

function buildResearchPrompt(input: CampaignResearchInput, fetched: WebFetchResult[]): string {
  const window = input.startDate && input.endDate
    ? `${input.startDate} → ${input.endDate}`
    : input.startDate
      ? `from ${input.startDate}`
      : input.endDate
        ? `until ${input.endDate}`
        : '(open-ended)';

  const webBlock = fetched.filter(f => f.ok).map(f =>
    `### ${f.title || f.finalUrl || f.url}\nSource: ${f.finalUrl || f.url}\n\n${f.text}\n`
  ).join('\n---\n\n');

  return `BUSINESS CONTEXT
────────────────
Name: ${input.businessName}
Type: ${input.businessType}
Location: ${input.location || 'Australia'}
Tone: ${input.tone || 'Friendly and professional'}
${input.businessDescription ? `Description: ${input.businessDescription}` : ''}
${input.productsServices ? `Products / Services: ${input.productsServices}` : ''}

CAMPAIGN
────────
${input.campaignName ? `Name: ${input.campaignName}` : ''}
Window: ${window}

User's brief (verbatim):
"""
${input.campaignText.trim()}
"""

${webBlock ? `WEB CONTENT (real text scraped from URLs the user mentioned)\n────────────\n${webBlock}` : 'WEB CONTENT\n────────────\n(no URLs fetched — work from BUSINESS CONTEXT + user brief only)'}

PRODUCE
───────
Return JSON in EXACTLY this shape:

{
  "summary": "One conversational sentence (≤180 chars) confirming what you checked and the angle you're taking. Address the user directly. Examples: 'Checked your homepage — the AI Tools page is your strongest hook, so I'll lead with it and weave the booking CTA into every third post.' or 'No URL to look at, so I'll lean on your description and run a 7-day countdown to the workshop with bookings as the primary CTA.'",
  "brief": "Markdown brief. ≤2000 chars. Sections in this order:\\n\\n## What we're promoting\\n2 sentences max — the specific thing.\\n\\n## Key facts to weave in\\nBulleted list. Each bullet = one specific feature, number, price, claim from the materials.\\n\\n## Audience + their pain\\nWho specifically + the #1 problem they have right now.\\n\\n## Tone for this campaign\\nOne paragraph. Match the business's overall tone but call out anything campaign-specific (urgent? nostalgic? celebratory?).\\n\\n## Post angles (6–10)\\nNumbered list. Each = a DIFFERENT angle the post-writer can pick up. Each angle is one sentence: '1. Feature spotlight — the [specific feature] solves [specific pain].' etc."
}`;
}

export async function researchCampaign(opts: {
  input: CampaignResearchInput;
  anthropicApiKey: string | undefined;
  openRouterApiKey: string;
}): Promise<CampaignResearchResult> {
  const { input, anthropicApiKey, openRouterApiKey } = opts;

  // Sanity check — if the user provided literally nothing actionable, don't
  // burn an AI call. The UI should never get here (it should require some
  // text before the request fires) but be defensive.
  if (!input.campaignText.trim() || !input.businessName.trim()) {
    return {
      status: 'failed',
      brief: '',
      summary: '',
      sources: [],
      failureReason: input.businessName.trim() ? 'no-data-to-research' : 'no-business-context',
    };
  }

  // Pull URLs out of the user's text and fetch them in parallel. Cap at 3
  // URLs so a paragraph full of links can't blow up the subrequest budget.
  const urls = extractUrls(input.campaignText, 3);
  const fetched: WebFetchResult[] = urls.length
    ? await Promise.all(urls.map(u => fetchUrlText(u)))
    : [];

  const prompt = buildResearchPrompt(input, fetched);

  // Try Anthropic direct first (cheaper + better JSON mode), fall back to
  // OpenRouter. Same pattern as routes/ai.ts uses.
  let raw = '';
  try {
    if (anthropicApiKey) {
      const { text } = await callAnthropicDirect({
        apiKey: anthropicApiKey,
        model: 'claude-haiku-4-5',
        systemPrompt: RESEARCH_SYSTEM_PROMPT,
        prompt,
        temperature: 0.3,
        maxTokens: 2400,
        responseFormat: 'json',
      });
      raw = text;
    } else {
      // OpenRouter fallback
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://socialaistudio.au',
          'X-Title': 'SocialAI Studio',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4.5',
          messages: [
            { role: 'system', content: `${RESEARCH_SYSTEM_PROMPT}\n\nReturn ONLY valid JSON, no prose, no markdown code fences.` },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2400,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
      const data: any = await res.json();
      raw = data?.choices?.[0]?.message?.content || '';
    }
  } catch (e: any) {
    console.warn('[campaign-research] AI call failed:', e?.message || e);
    return {
      status: 'failed',
      brief: '',
      summary: '',
      sources: fetched.map(f => ({
        url: f.url,
        ok: f.ok,
        title: f.title,
        status: f.status,
        error: f.error,
      })),
      failureReason: 'ai-call-failed',
    };
  }

  // JSON-mode output sometimes wraps in code fences despite instructions —
  // strip them defensively before parsing.
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  let parsed: { summary?: string; brief?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[campaign-research] JSON parse failed. Raw head:', cleaned.slice(0, 200));
    // Last-resort: use the raw text as the brief, with a generic summary.
    return {
      status: 'ready',
      brief: cleaned.slice(0, 4000),
      summary: 'Built a brief from your description.',
      sources: fetched.map(f => ({
        url: f.url,
        ok: f.ok,
        title: f.title,
        status: f.status,
        error: f.error,
      })),
    };
  }

  return {
    status: 'ready',
    brief: (parsed.brief || '').slice(0, 4000),
    summary: (parsed.summary || 'Built a brief from your description.').slice(0, 240),
    sources: fetched.map(f => ({
      url: f.url,
      ok: f.ok,
      title: f.title,
      status: f.status,
      error: f.error,
    })),
  };
}
