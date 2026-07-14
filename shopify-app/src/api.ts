// Authenticated fetch helper for the embedded Shopify app.
//
// Every API call out of the embedded app must carry a session token in the
// Authorization header so the worker can verify the request originated from
// inside the Shopify admin iframe. App Bridge mints these tokens on demand
// via `shopify.idToken()`; we wrap the fetch so individual components don't
// have to know about it.
//
// API_BASE is the worker URL — pinned at build time via VITE_API_BASE_URL
// so dev points at the staging worker without changing code.

declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
      config: { apiKey: string; host: string; shop?: string; locale?: string };
      // App Bridge v4 runtime exposes redirectTo for top-level navigation
      // out of the admin iframe. Not yet declared on the official
      // ShopifyGlobal type in @shopify/app-bridge-types 0.7, so we narrow
      // it locally here.
      redirectTo?: (url: string, opts?: { newContext?: 'top' | 'self' }) => void;
    };
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?? 'https://socialai-api.steve-700.workers.dev';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (!window.shopify) {
    throw new ApiError(0, 'App Bridge not loaded — is this page inside the Shopify admin?');
  }

  const token = await window.shopify.idToken();
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  // AbortSignal is forwarded from `init` so callers can cancel in-flight
  // requests on unmount. fetch() honours the signal natively — passing
  // `undefined` is a no-op.
  const res = await fetch(url, {
    ...init,
    signal: init?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  // Try to parse JSON either way — the worker returns structured errors.
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }

  if (!res.ok) {
    const msg = (parsed as any)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, parsed);
  }

  return parsed as T;
}

// ── Domain endpoints ───────────────────────────────────────────────────

// Organic reach setup. The worker derives the shop exclusively from the
// signed App Bridge session; these payloads intentionally contain no shop,
// user, client, or owner identifiers.
export type ShopifyReachPlatform = 'facebook' | 'instagram';

export interface ShopifyReachProfile {
  id: string;
  version: number;
  confirmationStatus: 'proposed' | 'confirmed';
  timezone: string;
  baseLocation: { country: string; region: string; locality: string };
  serviceArea: { radiusKm: number | null; included: string[] };
  excludedLocations: string[];
  platforms: ShopifyReachPlatform[];
  cadence?: Record<string, unknown>;
  confirmedAt?: string | null;
}

export interface ShopifyReachProfileDraft {
  timezone: string;
  baseLocation: ShopifyReachProfile['baseLocation'];
  serviceArea: ShopifyReachProfile['serviceArea'];
  excludedLocations?: string[];
  platforms?: ShopifyReachPlatform[];
  cadence?: Record<string, unknown>;
}

export interface ShopifyReachAudienceSegment {
  id: string;
  label: string;
  needs: string[];
  messageAngles: string[];
  suitableOffers: string[];
  evidence: string[];
  confidence: number;
  status: 'predicted' | 'confirmed' | 'disabled';
}

export interface ShopifyReachTimingWindow {
  weekday: number;
  startHour: number;
  endHour: number;
  platform: ShopifyReachPlatform;
  mediaType: string;
  expectedScore: number;
  confidence: number;
  sampleSize: number;
  source: 'account' | 'archetype';
}

export interface ShopifyReachPlan {
  id: string;
  postId: string;
  reachProfileId: string | null;
  reachProfileVersion: number | null;
  objective: string | null;
  audienceSegmentId: string | null;
  status: 'shadow' | 'selected' | 'invalidated';
  createdAt: string | null;
  geographicFocus: string[];
  audience: { label: string; needs: string[] } | null;
  platformPlan: Partial<Record<ShopifyReachPlatform, {
    caption?: string;
    hashtags?: string[];
  }>>;
  timing: ShopifyReachTimingWindow[];
  hashtags: {
    localKeywords?: string[];
    facebookTags?: string[];
    instagramTags?: string[];
    evidence?: string[];
  };
  media: Partial<Record<ShopifyReachPlatform, {
    source?: 'approved_asset' | 'generated';
    assetId?: string | null;
    format?: string;
    generate?: boolean;
  }>> & { generatedUrl?: string | null };
}

export async function getShopifyReachProfile(signal?: AbortSignal) {
  return apiFetch<{
    profile: ShopifyReachProfile | null;
    segments: ShopifyReachAudienceSegment[];
  }>('/api/shopify/reach/profile', { signal });
}

export async function proposeShopifyReachProfile(
  draft: ShopifyReachProfileDraft,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ profile: ShopifyReachProfile }>(
    '/api/shopify/reach/profile/propose',
    { method: 'POST', body: JSON.stringify(draft), signal },
  );
  return result.profile;
}

export async function confirmShopifyReachProfile(
  profileId: string,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ profile: ShopifyReachProfile }>(
    '/api/shopify/reach/profile/confirm',
    { method: 'PUT', body: JSON.stringify({ profileId }), signal },
  );
  return result.profile;
}

export async function proposeShopifyReachSegments(signal?: AbortSignal) {
  const result = await apiFetch<{ segments: ShopifyReachAudienceSegment[] }>(
    '/api/shopify/reach/segments/propose',
    { method: 'POST', body: '{}', signal },
  );
  return result.segments ?? [];
}

export async function confirmShopifyReachSegment(
  segmentId: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiFetch('/api/shopify/reach/segments/confirm', {
    method: 'PUT',
    body: JSON.stringify({ segmentId }),
    signal,
  });
}

export async function getShopifyReachPlans(
  postId: string,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ plans: ShopifyReachPlan[] }>(
    `/api/shopify/reach/plans/${encodeURIComponent(postId)}`,
    { signal },
  );
  return result.plans ?? [];
}

// Customer learning is always scoped from the signed shop session on the
// worker. None of these payloads accept shop, user, client, or owner ids.
export type ShopifyLearningMode = 'off' | 'shadow' | 'approval' | 'protected_autopilot';

export interface ShopifyLearningProfile {
  version: number;
  approved: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface ShopifyLearningSignal {
  variableKey: string;
  variableValue: string;
  objective: string;
  sampleCount: number;
  effect: number;
  confidence: number;
  freshnessAt: string;
  status: string;
  evidenceKind: 'association' | 'experiment';
}

export interface ShopifyLearningOutcome {
  id: string;
  postId: string;
  platform: string;
  postType: string | null;
  content: string | null;
  windowHours: number;
  rawSignals: Record<string, unknown>;
  normalizedScore: number | null;
  completeness: string;
  sourceStatus: string;
  publishedAt: string;
  measuredAt: string;
}

export interface ShopifyLearningSummary {
  profile: ShopifyLearningProfile | null;
  signals: ShopifyLearningSignal[];
  outcomes: ShopifyLearningOutcome[];
}

export interface ShopifyLearningSettings {
  mode: ShopifyLearningMode;
  autopublishConsentAt: string | null;
  autopublishPolicyVersion: string | null;
  experimentRate: number;
  monthlyAiBudgetUsdCents: number | null;
  disabledReason: string | null;
  exists: boolean;
}

export interface ShopifyLearningSettingsResponse {
  settings: ShopifyLearningSettings;
  effectiveMode: ShopifyLearningMode;
}

export interface ShopifyLearningReadiness {
  policyVersion: string;
  ready: boolean;
  stale: boolean;
  effectiveMode: ShopifyLearningMode;
  evaluatedAt: string | null;
  checks: Record<string, boolean | Record<string, boolean>>;
  metrics: Record<string, number | boolean>;
  cost: {
    monthlyAiSpendUsdCents: number | null;
    telemetryCount: number;
    monthlyAiBudgetUsdCents: number | null;
    withinBudget: boolean;
  };
  globalSwitches: {
    learningBrain: boolean;
    releaseEnforcement: boolean;
    protectedAutopilot: boolean;
  };
}

export interface ShopifyLearningCriticVerdict {
  id: string;
  critic_kind: string;
  verdict: 'pass' | 'warn_repairable' | 'block' | 'unavailable';
  severity: 'advisory' | 'release_critical';
  confidence: number;
  evidence: string[];
  repairs: string[];
}

export interface ShopifyLearningDecision {
  id: string;
  post_id: string;
  mode: ShopifyLearningMode;
  stage: 'snapshot' | 'text_preflight' | 'media_preflight' | 'release';
  release_state: 'pending' | 'pass_green' | 'hold_amber' | 'block_red' | 'shadow_only';
  summary: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  verdicts: ShopifyLearningCriticVerdict[];
}

export interface ShopifyConversionFeedback {
  calls?: number;
  messages?: number;
  leads?: number;
  bookings?: number;
  sales?: number;
  orderValueCents?: number;
}

export async function getShopifyLearningSummary(signal?: AbortSignal) {
  return apiFetch<ShopifyLearningSummary>('/api/shopify/learning/profile', { signal });
}

export async function getShopifyLearningSettings(signal?: AbortSignal) {
  return apiFetch<ShopifyLearningSettingsResponse>(
    '/api/shopify/learning/settings',
    { signal },
  );
}

export async function getShopifyLearningReadiness(signal?: AbortSignal) {
  return apiFetch<ShopifyLearningReadiness>(
    '/api/shopify/learning/readiness',
    { signal },
  );
}

export async function updateShopifyLearningSettings(
  input: {
    mode: 'approval' | 'protected_autopilot';
    consent?: boolean;
    experimentRate?: number;
    monthlyAiBudgetUsdCents?: number | null;
  },
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = { mode: input.mode };
  if (input.consent !== undefined) body.consent = input.consent;
  if (input.experimentRate !== undefined) body.experimentRate = input.experimentRate;
  if (input.monthlyAiBudgetUsdCents !== undefined) {
    body.monthlyAiBudgetUsdCents = input.monthlyAiBudgetUsdCents;
  }
  return apiFetch<ShopifyLearningSettingsResponse>(
    '/api/shopify/learning/settings',
    { method: 'PUT', body: JSON.stringify(body), signal },
  );
}

export async function getShopifyLearningDecisions(
  postId: string,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ decisions: ShopifyLearningDecision[] }>(
    `/api/shopify/learning/decisions/${encodeURIComponent(postId)}`,
    { signal },
  );
  return result.decisions ?? [];
}

export async function recordShopifyConversionFeedback(
  postId: string,
  input: ShopifyConversionFeedback,
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = {};
  const fields = [
    'calls', 'messages', 'leads', 'bookings', 'sales', 'orderValueCents',
  ] as const;
  for (const field of fields) {
    if (input[field] !== undefined) body[field] = input[field];
  }
  return apiFetch<{ feedbackId: string }>(
    `/api/shopify/learning/outcomes/${encodeURIComponent(postId)}/feedback`,
    { method: 'POST', body: JSON.stringify(body), signal },
  );
}

export interface ShopInfo {
  shop: string;
  shop_name: string | null;
  shop_email: string | null;
  country_code: string | null;
  currency: string | null;
  plan_name: string | null;
  scopes: string;
  installed_at: string;
  subscription_id: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface SetupSubscriptionResult {
  already: boolean;
  subscription_id?: string;
  subscription_status?: string;
  confirmation_url?: string;
  is_test?: boolean;
}

/** First call after embedded app mount. Exchanges the App Bridge session
 *  token for an expiring offline access token + refreshes shop info in D1. */
export async function tokenExchange(signal?: AbortSignal) {
  return apiFetch<{ shop: string; shop_name: string | null; plan_name: string | null; scope: string }>(
    '/api/shopify/token-exchange',
    { method: 'POST', signal },
  );
}

export async function fetchMe(signal?: AbortSignal) {
  return apiFetch<ShopInfo>('/api/shopify/me', { signal });
}

export async function setupSubscription(signal?: AbortSignal) {
  return apiFetch<SetupSubscriptionResult>(
    '/api/shopify/setup-subscription',
    { method: 'POST', signal },
  );
}

// ── Product catalog + AI composer ──────────────────────────────────────
//
// These endpoints back the Products browse page and the AI Compose page.
// Products are pulled once from the Shopify Admin GraphQL API on demand
// (sync) and cached in D1; the merchant can refresh whenever they add new
// SKUs upstream. The compose endpoint hands the picked product to the
// SocialAI generation pipeline and returns a caption + product-aware
// image for the merchant to edit before saving.

export interface Product {
  id: string;            // gid://shopify/Product/12345
  title: string;
  handle: string;
  description: string;
  product_type: string | null;
  vendor: string | null;
  tags: string | null;   // comma-separated
  price: string | null;
  currency: string | null;
  image_url: string | null;
  status: string | null;
}

export interface ProductsResponse {
  products: Product[];
  last_synced_at: string | null;
}

export interface ComposeResponse {
  caption: string;
  image_url: string;
  model_used: string;
  product: { id: string; title: string; price: string | null };
}

export async function listProducts(signal?: AbortSignal) {
  return apiFetch<ProductsResponse>('/api/shopify/products', { signal });
}

export async function syncProducts(signal?: AbortSignal) {
  return apiFetch<{ synced: number; total_pages: number }>(
    '/api/shopify/products/sync',
    { method: 'POST', signal },
  );
}

export async function composePost(
  input: { product_id: string; platform?: 'facebook' | 'instagram' | 'both'; tone?: string },
  signal?: AbortSignal,
) {
  return apiFetch<ComposeResponse>(
    '/api/shopify/compose',
    { method: 'POST', body: JSON.stringify(input), signal },
  );
}

export async function createPost(
  input: { content: string; image_url?: string; platform: 'facebook' | 'instagram' | 'both'; product_id?: string },
  signal?: AbortSignal,
) {
  return apiFetch<{ id: string; status: string }>(
    '/api/shopify/posts',
    { method: 'POST', body: JSON.stringify(input), signal },
  );
}

/** Top-level redirect out of the Shopify Admin iframe. Used to send the
 *  merchant to the billing-approval URL on shopify.com.
 *
 *  App Bridge v4 documents `shopify.redirectTo(url, { newContext: 'top' })`
 *  as the canonical way to break out of the admin iframe. Fall back to a
 *  plain `window.top.location` assignment if the runtime hasn't exposed
 *  redirectTo yet — only happens in stale CDN caches. */
export function topLevelRedirect(url: string): void {
  if (window.shopify?.redirectTo) {
    window.shopify.redirectTo(url, { newContext: 'top' });
    return;
  }
  // Fallback: replace the top-level location directly. This is allowed
  // because shopify.com and the embedded app share the same allowlisted
  // navigation surface.
  if (window.top) {
    window.top.location.href = url;
  } else {
    window.location.href = url;
  }
}

// ── Posts (Calendar) ───────────────────────────────────────────────────
//
// The Calendar page lists every post the shop has ever created — drafts,
// scheduled, posted, and missed. Status comes back as one of four discrete
// states; scheduled_for is only meaningful for Scheduled/Posted. The patch
// endpoint accepts the same union so the merchant can reschedule a post or
// flip a draft into Scheduled inline. publish-now is the fast path: skip the
// cron and trigger the FB/IG publish pipeline immediately.

export interface Post {
  id: string;
  content: string;
  image_url: string | null;
  platform: 'facebook' | 'instagram' | 'both';
  status: 'Draft' | 'Scheduled' | 'Posted' | 'Missed';
  scheduled_for: string | null;
  created_at: string;
  // Reel fields — autopilot can schedule video posts. The Calendar uses
  // post_type to render a Reel chip indicator + video_status to render a
  // "rendering" pill while the prewarm-videos cron processes the post.
  post_type?: 'image' | 'video' | 'reel' | null;
  video_url?: string | null;
  video_status?: 'pending' | 'ready' | 'failed' | null;
  // AI image-vs-caption quality score (0-10), populated by the critique
  // cron + the Compose page's manual critique. Shown as a small badge on
  // calendar tiles so merchants can spot low-quality posts pre-publish.
  image_critique_score?: number | null;
  image_critique_reasoning?: string | null;
}

export async function listPosts(params?: { status?: string }, signal?: AbortSignal) {
  const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return apiFetch<{ posts: Post[] }>(`/api/shopify/posts${qs}`, { signal });
}

export async function updatePost(
  id: string,
  patch: Partial<Pick<Post, 'content' | 'image_url' | 'status' | 'scheduled_for'>>,
  signal?: AbortSignal,
) {
  return apiFetch<{ ok: boolean }>(
    `/api/shopify/posts/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal },
  );
}

export async function deletePost(id: string, signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>(
    `/api/shopify/posts/${encodeURIComponent(id)}`,
    { method: 'DELETE', signal },
  );
}

export async function publishPostNow(id: string, signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>(
    `/api/shopify/posts/${encodeURIComponent(id)}/publish-now`,
    { method: 'POST', signal },
  );
}

// ── Social connect (Settings) ──────────────────────────────────────────
//
// Settings page surfaces the Facebook/Instagram connection state for the
// current shop. Connect happens via FB JS SDK on the client (TODO Phase 2)
// and gets posted to the worker; disconnect revokes the stored token.

export interface SocialStatus {
  connected: boolean;
  facebookPageName: string | null;
  instagramConnected: boolean;
  connectedAt: string | null;
}

// Returned by the worker's POST /api/shopify/social/facebook-exchange-token.
// `pages` is the FB-Graph response flattened with instagramBusinessAccountId
// surfaced (so the page-picker UI doesn't have to dig into nested shapes).
export interface FacebookPageOption {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  picture?: { data: { url: string } };
  instagramBusinessAccountId?: string | null;
}

export interface FacebookExchangeResult {
  longLivedUserToken: string;
  expiresInSeconds: number;
  pages: FacebookPageOption[];
  pageTokensNeverExpire: boolean;
}

export async function getSocialStatus(signal?: AbortSignal) {
  return apiFetch<SocialStatus>('/api/shopify/social/status', { signal });
}

export async function disconnectSocial(signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>(
    '/api/shopify/social/disconnect',
    { method: 'POST', signal },
  );
}

/** Trade a short-lived FB user token for a long-lived one + the merchant's
 *  manageable pages with IG biz IDs flattened on. No DB writes — the caller
 *  shows a page picker, then POSTs the chosen page to connectSocial(). */
export async function exchangeFacebookToken(accessToken: string, signal?: AbortSignal) {
  return apiFetch<FacebookExchangeResult>(
    '/api/shopify/social/facebook-exchange-token',
    { method: 'POST', body: JSON.stringify({ access_token: accessToken }), signal },
  );
}

/** Persist the merchant's chosen FB Page + (optional) linked Instagram Business
 *  Account into shopify_stores.social_tokens. After this resolves, the publish
 *  cron has everything it needs to ship Scheduled posts to FB/IG. */
export async function connectSocial(
  body: {
    facebookUserToken?: string;
    facebookPageId: string;
    facebookPageAccessToken: string;
    facebookPageName?: string;
    instagramBusinessAccountId?: string | null;
  },
  signal?: AbortSignal,
) {
  return apiFetch<{ ok: boolean; page_name: string | null; connected_at: string }>(
    '/api/shopify/social/connect',
    { method: 'POST', body: JSON.stringify(body), signal },
  );
}

// ── Insights ──────────────────────────────────────────────────────────────
//
// Returns a combined snapshot for the Insights tab:
//   * connection      — connected/page name/IG flag (so the page can render
//                       a "Connect Facebook" CTA when not yet wired up)
//   * liveStats       — pulled from FB Graph by the worker (null when not
//                       connected). Source = 'insights' when read_insights
//                       was available, 'posts' when we fell back to post
//                       interactions (the publish scopes we already have
//                       are enough for the fallback path).
//   * posts           — D1-derived counts of the shop's drafts/scheduled/
//                       posted/missed posts + platform split
//   * fetchedAt       — server timestamp for "last updated" display

export interface ShopifyInsightsResponse {
  connection: {
    connected: boolean;
    pageName: string | null;
    instagramConnected: boolean;
  };
  liveStats: {
    fanCount: number;
    followersCount: number;
    reach28d: number;
    engagedUsers28d: number;
    interactions28d: number;
    engagementRate: number;
    source: 'insights' | 'posts';
  } | null;
  posts: {
    total: number;
    drafts: number;
    scheduled: number;
    posted: number;
    missed: number;
    thisWeek: number;
    byPlatform: {
      facebook: number;
      instagram: number;
      both: number;
    };
  };
  fetchedAt: string;
}

export async function getInsights(signal?: AbortSignal) {
  return apiFetch<ShopifyInsightsResponse>('/api/shopify/insights', { signal });
}

// ── Post quality (vision critique) ────────────────────────────────────────
//
// Called right after compose lands so the merchant gets an instant
// "is this image relevant to this caption?" signal before publishing.
// Score is 0-10; `regenerate: true` (score ≤ 4) is the worker's hint to
// recommend trying again rather than tweaking the caption.

export interface CritiqueResponse {
  score: number;       // 0–10
  match: 'yes' | 'partial' | 'no';
  reasoning: string;
  regenerate: boolean;
}

export async function critiqueImageCaption(
  input: { imageUrl: string; caption: string; postId?: string; businessType?: string; archetype?: string },
  signal?: AbortSignal,
) {
  return apiFetch<CritiqueResponse>(
    '/api/shopify/critique-image-caption',
    { method: 'POST', body: JSON.stringify(input), signal },
  );
}

// ── Posters ───────────────────────────────────────────────────────────────
//
// Shop-scoped AI poster gallery. The worker generates the image via
// OpenRouter, persists it to R2, and surfaces a streaming URL — but the
// streaming URL is session-token gated, so the frontend can't drop it
// straight into `<img src>`. fetchAuthImageBlob() handles that.

export interface ShopifyPoster {
  id: string;
  prompt: string;
  aspectRatio: '1:1' | '9:16' | '16:9';
  imageUrl: string;       // worker-relative path (needs auth via header)
  createdAt: string;
}

export async function listPosters(signal?: AbortSignal) {
  return apiFetch<{ items: ShopifyPoster[] }>('/api/shopify/posters', { signal });
}

export async function generatePoster(
  input: { prompt: string; aspectRatio?: '1:1' | '9:16' | '16:9' },
  signal?: AbortSignal,
) {
  return apiFetch<ShopifyPoster>(
    '/api/shopify/posters',
    { method: 'POST', body: JSON.stringify(input), signal },
  );
}

export async function deletePoster(id: string, signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>(
    `/api/shopify/posters/${encodeURIComponent(id)}`,
    { method: 'DELETE', signal },
  );
}

// ── Autopilot ─────────────────────────────────────────────────────────────
//
// Bulk content-calendar generator. The frontend plans the schedule
// (vibe → timestamps in local time, product round-robin), then calls
// generate-one for each slot with concurrency-3 to fill in parallel.

export interface AutopilotGeneratedPost {
  /** UUID. When status==='Preview' this is a client-side identity, not a posts row. */
  id: string;
  /** 'Preview' is returned by the dryRun path; 'Scheduled' by the legacy save-on-generate path. */
  status: 'Scheduled' | 'Preview';
  caption: string;
  image_url: string;
  platform: 'facebook' | 'instagram' | 'both';
  scheduled_for: string;
  product: { id: string; title: string; price: string | null; currency: string | null };
  campaign_used: boolean;
  post_type: 'image' | 'video';
  video_status: 'pending' | null;
  /** Echoed back by the dryRun response so save-batch can replay the same Kling motion. */
  motion_prompt?: string | null;
}

export interface AutopilotBatchSaveResult {
  saved: string[];
  failed: Array<{ idx: number; error: string }>;
}

// ── FB Facts (Autopilot grounding) ────────────────────────────────────────

export interface FactsStatus {
  total: number;
  by_type: Record<string, number>;
  last_verified_at: string | null;
  page_connected: boolean;
}

export async function getFactsStatus(signal?: AbortSignal) {
  return apiFetch<FactsStatus>('/api/shopify/facts/status', { signal });
}

export async function refreshFacts(signal?: AbortSignal) {
  return apiFetch<{ inserted: number; errors: string[] }>(
    '/api/shopify/facts/refresh',
    { method: 'POST', signal },
  );
}

// ── Campaigns ─────────────────────────────────────────────────────────────
//
// Date-ranged marketing campaigns (Black Friday, Summer Sale, etc) that
// feed into Autopilot caption generation. The "active" campaign is the
// one whose start_at <= now <= end_at.

export interface ShopifyCampaign {
  id: string;
  name: string;
  goal: string | null;
  theme: string | null;
  startAt: string;
  endAt: string | null;
  createdAt: string;
  isActive: boolean;
}

export async function listCampaigns(signal?: AbortSignal) {
  return apiFetch<{ items: ShopifyCampaign[] }>('/api/shopify/campaigns', { signal });
}

export async function getActiveCampaign(signal?: AbortSignal) {
  return apiFetch<{ active: ShopifyCampaign | null }>('/api/shopify/campaigns/active', { signal });
}

export async function createCampaign(
  body: { name: string; goal?: string | null; theme?: string | null; startAt: string; endAt?: string | null },
  signal?: AbortSignal,
) {
  return apiFetch<ShopifyCampaign>(
    '/api/shopify/campaigns',
    { method: 'POST', body: JSON.stringify(body), signal },
  );
}

export async function updateCampaign(
  id: string,
  body: Partial<{ name: string; goal: string | null; theme: string | null; startAt: string; endAt: string | null }>,
  signal?: AbortSignal,
) {
  return apiFetch<ShopifyCampaign>(
    `/api/shopify/campaigns/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body), signal },
  );
}

export async function deleteCampaign(id: string, signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>(
    `/api/shopify/campaigns/${encodeURIComponent(id)}`,
    { method: 'DELETE', signal },
  );
}

export async function generateAutopilotPost(
  input: {
    productId: string;
    platform: 'facebook' | 'instagram' | 'both';
    scheduledFor: string;
    tone?: 'friendly' | 'professional' | 'playful';
    postType?: 'image' | 'video';
    motionPrompt?: string;
    /** When true, server composes but does NOT persist — used by the preview flow. */
    dryRun?: boolean;
  },
  signal?: AbortSignal,
) {
  return apiFetch<AutopilotGeneratedPost>(
    '/api/shopify/autopilot/generate-one',
    { method: 'POST', body: JSON.stringify(input), signal },
  );
}

/**
 * Save a batch of merchant-approved (preview) posts to the scheduling queue.
 * Use after the user clicks "Accept All" on the Autopilot review screen.
 * Each post inserts independently — partial failures are reported in `failed`.
 */
export async function saveAutopilotBatch(
  posts: Array<{
    caption: string;
    imageUrl: string;
    platform: 'facebook' | 'instagram' | 'both';
    scheduledFor: string;
    postType?: 'image' | 'video';
    motionPrompt?: string | null;
  }>,
  signal?: AbortSignal,
) {
  return apiFetch<AutopilotBatchSaveResult>(
    '/api/shopify/autopilot/save-batch',
    { method: 'POST', body: JSON.stringify({ posts }), signal },
  );
}

/** Fetch a session-token-gated image as a Blob so the UI can wrap it in
 *  a URL.createObjectURL() for use in `<img src>`. The Authorization
 *  header that apiFetch() injects is necessary; an unauthenticated
 *  `<img>` request would 401. */
export async function fetchAuthImageBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  if (!window.shopify) {
    throw new ApiError(0, 'App Bridge not loaded');
  }
  const token = await window.shopify.idToken();
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || `HTTP ${res.status}`);
  }
  return res.blob();
}

// ── Brand safety / denylist (schema_v25 shopify_stores.profile) ─────────
// Surfaces the forbidden-subjects list the worker's content-safety pipeline
// scans against (lib/profile-guards.ts → loadForbiddenSubjectsForShop).
// PUT normalises (trim, lowercase, dedupe) before persisting; the response
// echoes the canonical form so the UI can render exactly what the pipeline
// will see at compose/critique/poster time.

export interface DenylistResponse {
  forbiddenSubjects: string[];
}

export async function getDenylist(signal?: AbortSignal) {
  return apiFetch<DenylistResponse>('/api/shopify/profile/denylist', { method: 'GET', signal });
}

export async function updateDenylist(forbiddenSubjects: string[], signal?: AbortSignal) {
  return apiFetch<DenylistResponse>('/api/shopify/profile/denylist', {
    method: 'PUT',
    body: JSON.stringify({ forbiddenSubjects }),
    signal,
  });
}
