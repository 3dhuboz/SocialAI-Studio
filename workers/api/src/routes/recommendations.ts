// Smart Recommendations — Auto-fix engine.
//
// Exposes one route:
//   POST /api/recommendations/auto-fix-checklist
//     Body:    { items: string[], clientId?: string|null }
//     Returns: { results: AutoFixResult[] }
//
// For every checklist item the AI handed back as a `view-checklist` rec, we:
//   1. Classify the item via ONE LLM call (single round-trip for the whole
//      batch — never one call per item, that would burn cache and budget).
//   2. Dispatch to a per-kind handler that EITHER audits state and reports
//      findings (read-only) OR applies a SAFE auto-fix in D1 (e.g. shift
//      scheduled posts into the recommended window).
//   3. Collect a structured result row per item.
//
// Five handler kinds (see CHECKLIST_KIND below):
//   AUDIT_FB_PAGE      — needs FB Graph (visibility, description, follower trend)
//   AUDIT_DB           — needs only our D1 (posting times, recent engagement)
//   AUTO_FIX_SCHEDULE  — adjust scheduled post times into working-hours window
//   SUGGEST_REWRITE    — propose new page description / CTA (no write to FB)
//   MANUAL_ONLY        — needs money / human judgement / write-perms we lack
//
// Design decisions:
//   - Suggested rewrites are NEVER pushed to Facebook automatically. The user
//     reviews the diff and applies manually — same philosophy as the rest of
//     the platform's "AI suggests, owner approves" pattern.
//   - Schedule auto-fix only nudges posts INSIDE the recommended window
//     (default Mon-Fri 9am-5pm AEST). If a post is already inside it, we
//     leave it. We never widen the gap between posts — only narrow it.
//   - LLM classification falls back to a keyword sniffer if no provider key
//     is configured, so the route degrades gracefully in local dev.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { callAnthropicDirect, callOpenRouter } from '../lib/anthropic';
import { backfillImagesForPastDrafts } from '../lib/backfill';

// ── Types ────────────────────────────────────────────────────────────────

/** One of five per-item handler kinds the classifier picks. The fallback
 *  keyword sniffer also maps into this union, so a missing LLM key still
 *  produces sensible buckets. */
type ChecklistKind =
  | 'AUDIT_FB_PAGE'
  | 'AUDIT_DB'
  | 'AUTO_FIX_SCHEDULE'
  | 'SUGGEST_REWRITE'
  | 'REGEN_DRAFT_IMAGES'
  | 'MANUAL_ONLY';

/** Shape returned to the frontend per item. `payload` carries kind-specific
 *  extras (current/proposed text for SUGGEST_REWRITE, shifted-count for
 *  AUTO_FIX_SCHEDULE, etc.). Kept loose so adding a new kind doesn't
 *  require frontend schema gymnastics. */
interface AutoFixResult {
  item: string;
  kind: 'audit' | 'auto_fix' | 'suggest' | 'manual';
  status: 'ok' | 'finding' | 'fixed' | 'suggested' | 'failed';
  details: string;
  payload?: Record<string, unknown>;
}

/** Recommended posting-time window. Hardcoded to Mon-Fri 9am-5pm in the
 *  workspace's timezone (defaults to Australia/Brisbane — Central QLD is the
 *  modal customer). Future iteration: pull from the workspace profile. */
const WINDOW = {
  startHour: 9,
  endHour: 17,
  // Weekdays only: Mon=1 ... Fri=5. (Date.prototype.getUTCDay returns 0=Sun.)
  weekdaysOnly: true,
};

// ── Classifier ───────────────────────────────────────────────────────────

/** Classify a list of items into ChecklistKinds via one LLM call. Returns an
 *  array parallel to `items`. Falls back to a keyword sniffer when no LLM
 *  provider key is configured (local dev / test). */
async function classifyItems(env: Env, items: string[]): Promise<ChecklistKind[]> {
  if (items.length === 0) return [];

  // No LLM key → degrade to keyword sniffer. Keeps the route working in
  // tests and during local dev without ANTHROPIC_API_KEY plumbed through.
  if (!env.ANTHROPIC_API_KEY && !env.OPENROUTER_API_KEY) {
    return items.map(sniffKind);
  }

  const systemPrompt = `You classify checklist items from a social-media audit into one of five handler kinds. Each item is one short instruction the user could act on. Pick the kind that BEST matches what would need to happen to resolve the item.

KINDS:
- AUDIT_FB_PAGE: needs Facebook Page data (visibility settings, description, follower trend, post-hidden state, scope checks). Examples: "Check page visibility settings", "Review follower growth trend", "Verify page is public".
- AUDIT_DB: needs only our internal database (posting times, scheduled posts count, recent engagement scores). Examples: "Audit posting times", "Check if any posts are scheduled outside business hours".
- AUTO_FIX_SCHEDULE: needs to adjust scheduled post times. Examples: "Move posts from weekends to weekdays", "Reschedule posts into business hours", "Verify posting times align with [...] business hours".
- SUGGEST_REWRITE: page description, CTA, or copy needs improvement. Examples: "Audit page description and CTA", "Rewrite page bio for clarity", "Update CTA to mention App Development".
- REGEN_DRAFT_IMAGES: regenerate missing or low-quality images for past-dated Draft posts (the prewarm cron skips Drafts on purpose, so the user has to ask). Examples: "Generate images for unscheduled draft posts", "Fix missing images on backlog posts", "Regenerate poor-quality post images".
- MANUAL_ONLY: requires money, human judgement, or write-perms we don't have. Examples: "Boost a post with $5-10 budget", "Reach out to past customers", "Contact Meta support".

Return ONLY valid JSON, no markdown, no prose:
{ "kinds": ["KIND_1", "KIND_2", ...] }

The "kinds" array MUST have exactly ${items.length} entries, in the same order as the input items.`;

  const userPrompt = `Classify these ${items.length} items:\n\n${items.map((it, i) => `${i + 1}. ${it}`).join('\n')}`;

  let text: string;
  try {
    if (env.ANTHROPIC_API_KEY) {
      const res = await callAnthropicDirect({
        apiKey: env.ANTHROPIC_API_KEY,
        model: 'claude-haiku-4-5',
        cachedPrefix: systemPrompt,
        prompt: userPrompt,
        temperature: 0,
        maxTokens: 400,
        responseFormat: 'json',
      });
      text = res.text;
    } else {
      const res = await callOpenRouter(env.OPENROUTER_API_KEY!, systemPrompt, userPrompt, 0, 400);
      text = res.text;
    }
  } catch (e: any) {
    console.warn('[auto-fix] classifier failed, falling back to sniffer:', e?.message);
    return items.map(sniffKind);
  }

  try {
    const parsed = JSON.parse(text);
    const kinds: unknown = parsed?.kinds;
    if (!Array.isArray(kinds) || kinds.length !== items.length) {
      console.warn('[auto-fix] classifier returned wrong shape, falling back to sniffer');
      return items.map(sniffKind);
    }
    return kinds.map((k, i) => normaliseKind(String(k), items[i]));
  } catch {
    console.warn('[auto-fix] classifier returned malformed JSON, falling back to sniffer');
    return items.map(sniffKind);
  }
}

/** Coerce an LLM-returned string to a valid ChecklistKind, falling back to
 *  the keyword sniffer when the LLM returns garbage. */
function normaliseKind(raw: string, item: string): ChecklistKind {
  const up = raw.toUpperCase().trim();
  if (up === 'AUDIT_FB_PAGE' || up === 'AUDIT_DB' || up === 'AUTO_FIX_SCHEDULE'
    || up === 'SUGGEST_REWRITE' || up === 'REGEN_DRAFT_IMAGES' || up === 'MANUAL_ONLY') {
    return up;
  }
  return sniffKind(item);
}

/** Cheap keyword fallback. Loose on purpose — the real classifier is the
 *  LLM. This exists so the route degrades gracefully without a provider
 *  key, and so tests don't need to mock fetch. Word-boundary anchors on
 *  the short tokens (`age`, `cta`, etc.) prevent matches inside longer
 *  words like "engagement" or "vacate". */
function sniffKind(item: string): ChecklistKind {
  const s = item.toLowerCase();
  if (/(\bboost\b|\bpaid\b|\bbudget\b|\bspend\b|\$\d|\bcontact\b|reach out|customer support|meta support|\bcall\b|email customer)/.test(s)) {
    return 'MANUAL_ONLY';
  }
  if (/(\bdescription\b|\bcta\b|call.?to.?action|\bbio\b|\btagline\b|\brewrite\b|\bcopy\b)/.test(s)) {
    return 'SUGGEST_REWRITE';
  }
  // Image-quality items take priority over the schedule sniffer because
  // "regenerate" and "image" tokens are more specific than "schedule".
  if (/(missing image|no image|regenerate.*image|image.*regenerate|generate.*image|image.*draft|draft.*image|image.*quality|poor.*image|fix.*image)/.test(s)) {
    return 'REGEN_DRAFT_IMAGES';
  }
  if (/(posting time|\bschedule\b|business hours|move post|\breschedule\b|time slot)/.test(s)) {
    return 'AUTO_FIX_SCHEDULE';
  }
  if (/(\bvisibility\b|\bpublic\b|\brestricted\b|\bregion\b|\bage\b|page setting|\bfollower|spam filter|\bhidden\b|\bgraph\b)/.test(s)) {
    return 'AUDIT_FB_PAGE';
  }
  return 'AUDIT_DB';
}

// ── Handlers ─────────────────────────────────────────────────────────────

/** Manual-only items — no read, no write. We just pass through a one-line
 *  reason so the UI can show "Requires your action: [reason]". */
function handleManual(item: string): AutoFixResult {
  const reason = inferManualReason(item);
  return {
    item,
    kind: 'manual',
    status: 'ok',
    details: `Requires your action: ${reason}`,
  };
}

function inferManualReason(item: string): string {
  const s = item.toLowerCase();
  if (/\$|budget|boost|paid|spend/.test(s)) return 'this step costs money — only you can authorise the spend';
  if (/contact|reach out|customer|support/.test(s)) return 'this needs a human conversation';
  return 'this needs your judgement — auto-fix can\'t safely take this action';
}

/** AUDIT_DB — read-only inspection of our own D1. Surface the workspace's
 *  scheduled-post distribution + recent engagement so the UI can show "we
 *  looked at X and found Y" without making an external call. */
async function handleAuditDb(
  env: Env,
  uid: string,
  clientId: string | null,
  item: string,
): Promise<AutoFixResult> {
  const scheduled = await env.DB.prepare(
    `SELECT scheduled_for FROM posts
     WHERE user_id = ? AND COALESCE(client_id, '') = ?
       AND status = 'Scheduled' AND scheduled_for IS NOT NULL`
  ).bind(uid, clientId || '').all<{ scheduled_for: string }>();
  const rows = scheduled.results || [];
  const outsideWindow = rows.filter((r) => !isInsideWindow(r.scheduled_for));

  const factsRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt, AVG(engagement_score) as avg_score
     FROM client_facts
     WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'own_post'`
  ).bind(uid, clientId || '').first<{ cnt: number; avg_score: number | null }>();

  const lines: string[] = [];
  if (rows.length === 0) {
    lines.push('No scheduled posts to audit.');
  } else {
    lines.push(`${rows.length} post(s) scheduled — ${outsideWindow.length} fall outside Mon-Fri 9am-5pm.`);
  }
  if (factsRow && factsRow.cnt > 0) {
    const avg = Math.round(factsRow.avg_score ?? 0);
    lines.push(`Recent engagement: ${factsRow.cnt} historical posts, avg engagement score ${avg}.`);
  } else {
    lines.push('No historical engagement data — connect Facebook + wait for the nightly refresh.');
  }

  return {
    item,
    kind: 'audit',
    status: outsideWindow.length > 0 ? 'finding' : 'ok',
    details: lines.join(' '),
    payload: {
      scheduled_count: rows.length,
      outside_window_count: outsideWindow.length,
      historical_posts: factsRow?.cnt ?? 0,
      avg_engagement_score: factsRow?.avg_score ?? null,
    },
  };
}

/** AUDIT_FB_PAGE — read-only FB Graph inspection. Pulls the Page's name,
 *  about/description, link, fan_count and is_published. Surface anomalies
 *  as findings — e.g. is_published=false is a hard "page is hidden". */
async function handleAuditFbPage(
  env: Env,
  uid: string,
  clientId: string | null,
  item: string,
): Promise<AutoFixResult> {
  const tokens = await loadTokens(env, uid, clientId);
  if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
    return {
      item,
      kind: 'audit',
      status: 'failed',
      details: 'No Facebook page connected. Open Settings → Connected Accounts → Connect Facebook.',
    };
  }
  const pageId = tokens.facebookPageId as string;
  const token = tokens.facebookPageAccessToken as string;
  const fields = 'name,about,description,link,fan_count,is_published,category';
  const url = `https://graph.facebook.com/v21.0/${pageId}?fields=${fields}&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    const data = await res.json() as any;
    if (!res.ok || data?.error) {
      return {
        item,
        kind: 'audit',
        status: 'failed',
        details: `Facebook rejected the lookup: ${data?.error?.message || `HTTP ${res.status}`}`,
      };
    }

    const findings: string[] = [];
    if (data.is_published === false) {
      findings.push('Page is unpublished — invisible to non-admins. Republish in Page Settings.');
    }
    const aboutLen = (data.about || data.description || '').length;
    if (aboutLen < 30) {
      findings.push('Page description is very short — under 30 chars limits search visibility.');
    }
    if (typeof data.fan_count === 'number' && data.fan_count < 50) {
      findings.push(`Only ${data.fan_count} followers — organic reach will be tiny until you grow this.`);
    }

    return {
      item,
      kind: 'audit',
      status: findings.length > 0 ? 'finding' : 'ok',
      details: findings.length > 0
        ? `${data.name}: ${findings.join(' ')}`
        : `${data.name}: page looks healthy (published, ${data.fan_count ?? 0} followers, ${aboutLen} chars in description).`,
      payload: {
        page_name: data.name,
        is_published: data.is_published,
        fan_count: data.fan_count,
        about_length: aboutLen,
        category: data.category,
      },
    };
  } catch (e: any) {
    return {
      item,
      kind: 'audit',
      status: 'failed',
      details: `Could not reach Facebook: ${e?.message || 'unknown'}.`,
    };
  }
}

/** AUTO_FIX_SCHEDULE — shift Scheduled posts whose scheduled_for falls
 *  outside Mon-Fri 9am-5pm into the next slot inside the window. Honours
 *  `preview` to support a dry-run mode in future without changing the call
 *  shape. */
async function handleAutoFixSchedule(
  env: Env,
  uid: string,
  clientId: string | null,
  item: string,
  opts: { preview: boolean } = { preview: false },
): Promise<AutoFixResult> {
  const rows = await env.DB.prepare(
    `SELECT id, scheduled_for FROM posts
     WHERE user_id = ? AND COALESCE(client_id, '') = ?
       AND status = 'Scheduled' AND scheduled_for IS NOT NULL`
  ).bind(uid, clientId || '').all<{ id: string; scheduled_for: string }>();
  const all = rows.results || [];
  const offenders = all.filter((r) => !isInsideWindow(r.scheduled_for));

  if (offenders.length === 0) {
    return {
      item,
      kind: 'auto_fix',
      status: 'ok',
      details: `All ${all.length} scheduled posts already fall inside Mon-Fri 9am-5pm. Nothing to shift.`,
      payload: { shifted: 0, total: all.length },
    };
  }

  const shifts: Array<{ id: string; from: string; to: string }> = [];
  for (const p of offenders) {
    const next = nextWindowSlot(p.scheduled_for);
    shifts.push({ id: p.id, from: p.scheduled_for, to: next });
  }

  if (!opts.preview) {
    // Apply shifts one row at a time — D1 doesn't have native multi-row
    // update with per-row values, and the per-row count is small (worst-case
    // ~50 across a Smart Schedule batch).
    for (const s of shifts) {
      await env.DB.prepare(
        `UPDATE posts SET scheduled_for = ? WHERE id = ? AND user_id = ?`
      ).bind(s.to, s.id, uid).run();
    }
  }

  return {
    item,
    kind: 'auto_fix',
    status: opts.preview ? 'suggested' : 'fixed',
    details: opts.preview
      ? `Would shift ${shifts.length} post(s) to land inside Mon-Fri 9am-5pm.`
      : `Shifted ${shifts.length} post(s) into Mon-Fri 9am-5pm.`,
    payload: {
      shifted: shifts.length,
      total: all.length,
      shifts: shifts.slice(0, 10), // cap to keep the payload bounded
    },
  };
}

/** SUGGEST_REWRITE — propose a new page description / CTA. Reads the
 *  current description from FB Graph, asks the LLM for a tighter version,
 *  returns both. Does NOT push to FB Graph — that's a meaningful change
 *  the owner reviews and applies manually. */
async function handleSuggestRewrite(
  env: Env,
  uid: string,
  clientId: string | null,
  item: string,
): Promise<AutoFixResult> {
  const tokens = await loadTokens(env, uid, clientId);
  if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
    return {
      item,
      kind: 'suggest',
      status: 'failed',
      details: 'No Facebook page connected — can\'t read current description.',
    };
  }
  const pageId = tokens.facebookPageId as string;
  const token = tokens.facebookPageAccessToken as string;
  const url = `https://graph.facebook.com/v21.0/${pageId}?fields=name,about,description,category&access_token=${encodeURIComponent(token)}`;

  let current: { name?: string; about?: string; description?: string; category?: string };
  try {
    const res = await fetch(url);
    const data = await res.json() as any;
    if (!res.ok || data?.error) {
      return {
        item,
        kind: 'suggest',
        status: 'failed',
        details: `Facebook rejected the lookup: ${data?.error?.message || `HTTP ${res.status}`}`,
      };
    }
    current = data;
  } catch (e: any) {
    return {
      item,
      kind: 'suggest',
      status: 'failed',
      details: `Could not reach Facebook: ${e?.message || 'unknown'}.`,
    };
  }

  const currentText = current.about || current.description || '';
  if (!env.ANTHROPIC_API_KEY && !env.OPENROUTER_API_KEY) {
    return {
      item,
      kind: 'suggest',
      status: 'failed',
      details: 'No LLM provider configured — can\'t draft a rewrite suggestion.',
      payload: { current: currentText },
    };
  }

  // Profile context — pull the business profile so the rewrite reflects
  // what the user actually does, not whatever FB's bio claims.
  const userRow = await env.DB.prepare('SELECT profile FROM users WHERE id = ?')
    .bind(uid).first<{ profile: string | null }>();
  let profileText = '';
  try {
    const profile = userRow?.profile ? JSON.parse(userRow.profile) : {};
    profileText = [
      profile.name && `Business: ${profile.name}`,
      profile.type && `Type: ${profile.type}`,
      profile.description && `Description: ${profile.description}`,
      profile.location && `Location: ${profile.location}`,
      profile.uniqueValue && `Unique value: ${profile.uniqueValue}`,
    ].filter(Boolean).join('\n');
  } catch { /* tolerate malformed profile JSON */ }

  const systemPrompt = `You rewrite Facebook Page descriptions for small businesses. Output must be ONE single paragraph, 200-400 chars, that:
- Clearly states what the business does (no vague claims)
- Mentions location if relevant
- Ends with a concrete call-to-action (link, phone, "DM us", etc.)
- Sounds like a human wrote it, not a marketing template

Return ONLY valid JSON, no markdown, no prose:
{ "proposed": "<the rewritten description>" }`;

  const userPrompt = `BUSINESS CONTEXT:
${profileText || '(no internal profile available)'}

CURRENT FACEBOOK PAGE DESCRIPTION:
"${currentText || '(empty)'}"

Rewrite the description to be clearer, more specific, and end with a real CTA.`;

  let proposed = '';
  try {
    const llmRes = env.ANTHROPIC_API_KEY
      ? await callAnthropicDirect({
        apiKey: env.ANTHROPIC_API_KEY,
        model: 'claude-haiku-4-5',
        systemPrompt,
        prompt: userPrompt,
        temperature: 0.4,
        maxTokens: 400,
        responseFormat: 'json',
      })
      : await callOpenRouter(env.OPENROUTER_API_KEY!, systemPrompt, userPrompt, 0.4, 400);
    const parsed = JSON.parse(llmRes.text);
    proposed = String(parsed?.proposed || '').trim();
  } catch (e: any) {
    return {
      item,
      kind: 'suggest',
      status: 'failed',
      details: `LLM call failed: ${e?.message || 'unknown'}.`,
      payload: { current: currentText },
    };
  }
  if (!proposed) {
    return {
      item,
      kind: 'suggest',
      status: 'failed',
      details: 'LLM returned empty rewrite.',
      payload: { current: currentText },
    };
  }

  return {
    item,
    kind: 'suggest',
    status: 'suggested',
    details: 'Drafted a tighter description — review and apply in Facebook Page Settings.',
    payload: {
      field: 'description',
      current: currentText,
      proposed,
      page_name: current.name,
    },
  };
}

/** Regenerate images for past-dated or unscheduled Draft posts. Wraps the
 *  shared `backfillImagesForPastDrafts` lib helper with a tighter per-call
 *  cap (5 vs the route default of 10) — auto-fix may chain multiple checklist
 *  items in one request, and a 5-cap per item keeps a worst-case
 *  20-item-checklist bounded at ~$4.50 in image-gen spend. */
async function handleRegenDraftImages(
  env: Env,
  uid: string,
  clientId: string | null,
  item: string,
): Promise<AutoFixResult> {
  try {
    const result = await backfillImagesForPastDrafts(env, uid, { clientId, limit: 5 });
    if ((result as any).error) {
      return {
        item,
        kind: 'auto_fix',
        status: 'failed',
        details: String((result as any).error),
      };
    }
    const found = (result.found ?? 0) as number;
    const succeeded = (result.succeeded ?? 0) as number;
    const failed = (result.failed ?? 0) as number;
    if (found === 0) {
      return {
        item,
        kind: 'auto_fix',
        status: 'ok',
        details: 'No past-Draft posts needed image generation — your backlog is already covered.',
        payload: { found, succeeded, failed },
      };
    }
    return {
      item,
      kind: 'auto_fix',
      status: succeeded > 0 ? 'fixed' : 'failed',
      details: succeeded === found
        ? `Generated images for ${succeeded} Draft post${succeeded === 1 ? '' : 's'}.`
        : `Generated ${succeeded}/${found} (${failed} failed — see Calendar for details).`,
      payload: {
        found,
        succeeded,
        failed,
        critique_retries: (result as any).critique_retries ?? 0,
      },
    };
  } catch (e: any) {
    return {
      item,
      kind: 'auto_fix',
      status: 'failed',
      details: `Image regen crashed: ${e?.message || 'unknown'}.`,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Load the social_tokens JSON blob for a workspace tuple. Returns null
 *  if the row isn't found OR the tokens JSON is malformed. */
async function loadTokens(
  env: Env,
  uid: string,
  clientId: string | null,
): Promise<Record<string, unknown> | null> {
  const row = clientId
    ? await env.DB.prepare(
      `SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?`
    ).bind(clientId, uid).first<{ social_tokens: string | null }>()
    : await env.DB.prepare(
      `SELECT social_tokens FROM users WHERE id = ?`
    ).bind(uid).first<{ social_tokens: string | null }>();
  if (!row?.social_tokens) return null;
  try { return JSON.parse(row.social_tokens); } catch { return null; }
}

/** Is `iso` inside Mon-Fri 9am-5pm? We work in UTC here because that's
 *  what's stored in D1 — the AEST window translates to UTC 23:00 prev day
 *  through 07:00 current day. To keep this dependency-free we approximate
 *  in UTC: many AU customers schedule from BNE/SYD time anyway, so the
 *  practical case is "an hour passed UTC midnight" which we accept. A
 *  future iteration can pull the workspace timezone from the profile. */
export function isInsideWindow(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  if (WINDOW.weekdaysOnly && (day === 0 || day === 6)) return false;
  return hour >= WINDOW.startHour && hour < WINDOW.endHour;
}

/** Next valid window slot after `iso`. If `iso` is on a weekend, jump to
 *  Monday 9am. If after 5pm, jump to next weekday 9am. Returns ISO string. */
export function nextWindowSlot(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return new Date().toISOString();

  // Walk forward in 1-hour steps until we land in the window. Cap at 14d
  // so a malformed input can't loop forever — that's the longest a Smart
  // Schedule batch ever runs.
  for (let i = 0; i < 14 * 24; i++) {
    const candidate = new Date(d.getTime() + i * 60 * 60 * 1000);
    if (isInsideCandidate(candidate)) return candidate.toISOString();
  }
  return d.toISOString();
}

function isInsideCandidate(d: Date): boolean {
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  if (WINDOW.weekdaysOnly && (day === 0 || day === 6)) return false;
  return hour >= WINDOW.startHour && hour < WINDOW.endHour;
}

// ── Route registration ───────────────────────────────────────────────────

export function registerRecommendationsRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/recommendations/auto-fix-checklist', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `autofix:${uid}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — 10 auto-fix runs per minute' }, 429);
    }

    const body = await c.req.json().catch(() => ({})) as {
      items?: unknown;
      clientId?: string | null;
    };
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const items: string[] = itemsRaw
      .map((x) => (typeof x === 'string' ? x : String(x)))
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 20); // hard cap — checklists rarely exceed 7
    const clientId = body.clientId ?? null;

    if (items.length === 0) {
      return c.json({ error: 'items array is required and must be non-empty' }, 400);
    }

    // Agency tenant guard — if clientId is set, verify it belongs to the
    // calling user. Without this, a malicious caller could pass another
    // user's clientId and trigger reads/writes against their workspace.
    if (clientId) {
      const owned = await c.env.DB.prepare(
        `SELECT id FROM clients WHERE id = ? AND user_id = ?`
      ).bind(clientId, uid).first<{ id: string }>();
      if (!owned) return c.json({ error: 'clientId not found or not owned by caller' }, 403);
    }

    const kinds = await classifyItems(c.env, items);
    const results: AutoFixResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const kind = kinds[i];
      try {
        switch (kind) {
          case 'AUDIT_FB_PAGE':
            results.push(await handleAuditFbPage(c.env, uid, clientId, item));
            break;
          case 'AUDIT_DB':
            results.push(await handleAuditDb(c.env, uid, clientId, item));
            break;
          case 'AUTO_FIX_SCHEDULE':
            results.push(await handleAutoFixSchedule(c.env, uid, clientId, item));
            break;
          case 'SUGGEST_REWRITE':
            results.push(await handleSuggestRewrite(c.env, uid, clientId, item));
            break;
          case 'REGEN_DRAFT_IMAGES':
            results.push(await handleRegenDraftImages(c.env, uid, clientId, item));
            break;
          case 'MANUAL_ONLY':
          default:
            results.push(handleManual(item));
        }
      } catch (e: any) {
        results.push({
          item,
          kind: 'audit',
          status: 'failed',
          details: `Handler crashed: ${e?.message || 'unknown'}.`,
        });
      }
    }

    return c.json({ results });
  });
}
