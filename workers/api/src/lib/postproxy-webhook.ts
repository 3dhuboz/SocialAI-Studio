// Postproxy webhook validation + event-to-DB-action mapping.
//
// Pure functions (no Env, no DB calls) so the routes/postproxy.ts handler
// stays a thin wrapper and these can be exhaustively unit-tested with no
// mocking gymnastics.
//
// Two responsibilities:
//   1. verifyWebhookSignature — constant-time HMAC-SHA256 check against
//      the shared POSTPROXY_WEBHOOK_SECRET. The route falls back to a
//      query-string shared secret when HMAC verification is unavailable
//      (Postproxy hasn't shipped HMAC publicly yet at time of writing).
//   2. planWebhookAction — given a parsed event, decide what the DB
//      should look like after. Returns a WebhookDbAction { kind: ... }
//      that the route maps to UPDATE statements + notify calls.
//
// Why pure: webhook payloads are the most error-prone code in a publishing
// system. Keeping the decision logic free of side effects means we can hit
// every branch in tests without standing up a fake D1.

import { timingSafeEqualStr } from './timing-safe';

// ── Event payload shape ──────────────────────────────────────────────────
// Postproxy webhook contract (per spike notes). `data.platforms` is only
// present on platform-scoped events (published/failed); post.processed
// carries only the parent post.id + status.

export interface PostproxyWebhookPlatform {
  platform: string;
  status: string;
  permalink?: string;
  error?: string;
}

export interface PostproxyWebhookPayload {
  event_id: string;
  event_type: 'post.processed' | 'platform_post.published' | 'platform_post.failed';
  data: {
    /** Postproxy post id — matches posts.postproxy_post_id in our DB. */
    id: string;
    status: string;
    platforms?: PostproxyWebhookPlatform[];
  };
}

// ── HMAC verification ────────────────────────────────────────────────────

/** Verify a Postproxy webhook signature header against the raw body.
 *
 *  Returns false (NOT throws) for any failure mode — missing secret,
 *  missing header, malformed hex, length mismatch — so the route can
 *  cleanly fall back to the query-string shared-secret check without
 *  branching on exception type.
 *
 *  Format accepted: bare hex digest OR `sha256=<hex>` prefix (the
 *  GitHub-style scheme Postproxy is most likely to adopt). Subtle.timingSafeEqual
 *  isn't available in Workers — we use timingSafeEqualStr from lib/timing-safe.ts. */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return false;
  if (!signatureHeader) return false;
  // Strip a leading "sha256=" if present (GitHub convention).
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqualStr(expected, provided.toLowerCase());
}

// ── Event parsing ────────────────────────────────────────────────────────

/** Parse the raw request body into a typed payload. Returns null when
 *  the body is unparseable or missing required fields — the caller MUST
 *  treat null as "ignore this webhook" (return 200 anyway so Postproxy
 *  doesn't retry; we don't want bogus payloads consuming retry budget). */
export function parseWebhookEvent(rawBody: string): PostproxyWebhookPayload | null {
  if (!rawBody) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const eventId = obj.event_id;
  const eventType = obj.event_type;
  const data = obj.data as Record<string, unknown> | undefined;
  if (typeof eventId !== 'string' || typeof eventType !== 'string' || !data) return null;
  if (typeof data.id !== 'string') return null;
  // Narrow event_type — anything else falls through to "log_only" via planWebhookAction.
  const allowed = ['post.processed', 'platform_post.published', 'platform_post.failed'];
  if (!allowed.includes(eventType)) {
    // Still parse it — planWebhookAction maps unknown types to log_only.
    // But we coerce so the typed payload doesn't lie to consumers.
  }
  return {
    event_id: eventId,
    event_type: eventType as PostproxyWebhookPayload['event_type'],
    data: {
      id: data.id,
      status: typeof data.status === 'string' ? data.status : '',
      platforms: Array.isArray(data.platforms)
        ? (data.platforms as PostproxyWebhookPlatform[])
        : undefined,
    },
  };
}

// ── Action planning ──────────────────────────────────────────────────────

export interface WebhookDbAction {
  /** What the route should do with this event:
   *  - mark_published: flip the post to Posted + persist permalink
   *  - mark_failed:    flip to Missed + notify owner
   *  - log_only:       insert into postproxy_webhook_events but don't mutate posts
   */
  kind: 'mark_published' | 'mark_failed' | 'log_only';
  /** Postproxy post id — used to SELECT the row in posts.postproxy_post_id. */
  postproxyPostId: string;
  /** Set on mark_published. */
  permalink?: string;
  /** Set on mark_failed. */
  errorMessage?: string;
}

/** Given a parsed webhook event, decide what the DB action should be.
 *  Pure function — no side effects. */
export function planWebhookAction(event: PostproxyWebhookPayload): WebhookDbAction {
  const id = event.data.id;
  // Prefer the platform sub-event when present (the spike showed FB events
  // come through as platform_post.* with a platforms[] payload). For
  // post.processed, status lives on data.status itself.
  const fbPlatform = event.data.platforms?.find((p) => p.platform === 'facebook');

  if (event.event_type === 'platform_post.published') {
    return {
      kind: 'mark_published',
      postproxyPostId: id,
      permalink: fbPlatform?.permalink,
    };
  }
  if (event.event_type === 'platform_post.failed') {
    const msg = fbPlatform?.error
      ?? `Postproxy reported failure (status=${fbPlatform?.status ?? event.data.status ?? 'unknown'})`;
    return {
      kind: 'mark_failed',
      postproxyPostId: id,
      errorMessage: msg.slice(0, 400),
    };
  }
  // post.processed and anything unrecognised → no DB mutation, just log.
  return { kind: 'log_only', postproxyPostId: id };
}
