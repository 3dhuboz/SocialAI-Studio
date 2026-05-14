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

// Whether each plan tier includes Poster Maker access at all (vs. just a
// monthly count). Today every paid plan does, but trial users (plan IS NULL
// in D1) and any unrecognised plan are blocked. Frontend mirrors this with
// CLIENT.plans[].includes.posters in src/client.config.ts — keep them in
// sync. Used by routes/posters.ts to 403 before any work happens.
export const PLAN_INCLUDES_POSTERS: ReadonlySet<string> = new Set(
  Object.keys(POSTER_QUOTA_PER_MONTH),
);
