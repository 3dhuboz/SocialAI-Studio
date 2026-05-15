// Plan price source-of-truth (KEEP IN SYNC WITH src/client.config.ts).
//
// MRR computation needs to know the monthly price per plan. Mirror the
// frontend's CLIENT.plans[].price values here. If you change a plan price
// in the frontend, also change it here.
//
// Shared by:
//   - routes/admin-stats.ts (/api/admin/stats — MRR sum)
//   - routes/billing.ts     (/api/billing — show user's plan price)
//
// Extracted from src/index.ts as Phase B step 20 of the route-module split.

export const PLAN_PRICE_AUD: Record<string, number> = {
  starter: 29,
  growth: 49,
  pro: 79,
  agency: 149,
};

// Poster Maker monthly quota per plan. Shared across all client workspaces
// on Agency. Enforced in routes/posters.ts on POST + reported via
// /api/db/posters-usage so the UI can show "X of Y this month" + an
// upgrade CTA when at cap. Mirror these in src/client.config.ts plans[]
// features[] strings.
export const POSTER_QUOTA_PER_MONTH: Record<string, number> = {
  starter: 3,
  growth: 10,
  pro: 30,
  agency: 100,
};

// Weekly post-creation quota per plan. Enforced server-side in
// routes/posts.ts (POST /api/db/posts, non-Draft posts only). Mirrors the
// postsPerWeek limits in src/client.config.ts — keep them in sync.
// null plan (trial) falls back to starter quota (7/week).
export const POSTS_PER_WEEK: Record<string, number> = {
  starter: 7,
  growth: 14,
  pro: 21,
  agency: 21,
};

// Whether each plan tier includes Poster Maker access at all (vs. just a
// monthly count). Today every paid plan does, but trial users (plan IS NULL
// in D1) and any unrecognised plan are blocked. Frontend mirrors this with
// CLIENT.plans[].includes.posters in src/client.config.ts — keep them in
// sync. Used by routes/posters.ts to 403 before any work happens.
export const PLAN_INCLUDES_POSTERS: ReadonlySet<string> = new Set(
  Object.keys(POSTER_QUOTA_PER_MONTH),
);

// Subscription lifecycle status values written by the PayPal webhook
// (lib/paypal.ts) and read by the AI generation gate (routes/ai.ts).
// Centralised here so a typo can't create a silent mismatch between writer
// and reader — both import this constant instead of hardcoding the string.
export const SUBSCRIPTION_STATUS = {
  PAST_DUE: 'past_due',
} as const;

// ── Per-user feature & credit overrides (schema_v13) ──────────────────────
//
// Lets Steve override what an individual user has access to (vs. the plan
// tier default) and grant one-shot credits on top of the monthly plan quota.
// Use cases: Street Meatz on Starter + 5 admin-gifted poster credits;
// gifting reel credits as goodwill; ad-hoc beta access to a feature their
// plan doesn't include.

/** Feature names the addon system can override. Keep in sync with the
 *  CLIENT.plans[].includes.* keys on the frontend. */
export type AddonFeature = 'posters' | 'reels';

/** Shape of users.addon_features JSON.
 *    true  = explicit grant (overrides plan default)
 *    false = explicit revoke (overrides plan default)
 *    missing = fall through to plan tier default
 *  Stored as a JSON object so future addons can be added without a schema
 *  migration each time. */
export type AddonFeaturesBlob = Partial<Record<AddonFeature, boolean>>;

/** Safely parse the addon_features JSON column. Tolerant of NULL / corrupt
 *  rows — never throws. */
export function parseAddonFeatures(raw: string | null | undefined): AddonFeaturesBlob {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return {};
}

/** Resolve whether a user has a given feature, considering both their plan
 *  tier default AND any per-user override.
 *
 *  Resolution order:
 *    1. addons.<feature> === true  → GRANTED
 *    2. addons.<feature> === false → REVOKED
 *    3. else → plan tier default (PLAN_INCLUDES_POSTERS for posters)
 *
 *  Why explicit false vs. missing: lets admin REVOKE a feature for a
 *  problematic user without downgrading their whole plan. Missing key is
 *  the common case (no override) and falls through to plan defaults.
 */
export function userHasFeature(
  feature: AddonFeature,
  plan: string | null | undefined,
  addonsRaw: string | null | undefined,
): boolean {
  const addons = parseAddonFeatures(addonsRaw);
  if (feature in addons) return addons[feature] === true;
  // Plan defaults — extend as new addon-eligible features appear.
  if (feature === 'posters') return !!plan && PLAN_INCLUDES_POSTERS.has(plan);
  // 'reels' currently has no plan-tier gate (all paid plans get reel
  // credits via the existing `reel_credits` column). If we add one later,
  // the plan-default branch goes here.
  return !!plan;
}
