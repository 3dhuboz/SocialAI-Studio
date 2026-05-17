// Per-reseller brand resolution.
//
// SocialAI Studio is white-labelable in the UI today (each reseller deploys
// their own CF Pages project with their own client.config.ts), but the
// worker still emits emails / alerts / OAuth callbacks branded as the
// parent platform. This module is the single source of truth for the
// per-user brand identity that every callsite should pull from instead of
// hardcoding "SocialAI Studio" / "#f59e0b" / "socialaistudio.au" /
// "steve@pennywiseit.com.au".
//
// Lookup model:
//   1. users.brand_id → brands row (the user-visible identity).
//   2. NULL brand_id → the row with is_default=1 (seeded as 'socialai-studio'
//      from schema_v17). That row holds the original hardcodes so existing
//      users keep seeing the platform brand without any migration.
//   3. NULL credentials on the brands row (facebook_app_id/secret, paypal
//      plan IDs) fall back to the worker env. This lets resellers either
//      bring-their-own PayPal/FB app OR share the platform's app — the
//      brand row encodes that choice per reseller.
//
// Returns a fully-resolved Brand object — every field is non-null after
// the env fallback. Callers don't need to know whether a value came from
// the row or from env.

import type { Env } from '../env';

export interface Brand {
  id: string;
  appName: string;
  domain: string;
  accentColor: string;
  bgColor: string;
  supportEmail: string;
  adminNotifyEmail: string;
  fromEmail: string;
  facebookAppId: string | null;
  facebookAppSecret: string | null;
  paypal: {
    starter: string | null;
    pro: string | null;
    agency: string | null;
  };
}

interface BrandRow {
  id: string;
  app_name: string;
  domain: string;
  accent_color: string;
  bg_color: string;
  support_email: string;
  admin_notify_email: string;
  from_email: string;
  facebook_app_id: string | null;
  facebook_app_secret: string | null;
  paypal_plan_starter: string | null;
  paypal_plan_pro: string | null;
  paypal_plan_agency: string | null;
  is_default: number;
}

// Hardcoded fallback used when the brands table hasn't been migrated yet
// (e.g. the v17 SQL hasn't been applied to the remote D1 instance). This is
// a belt-and-braces safety net so the worker keeps running during a deploy
// window where the code has shipped but the migration hasn't. Once v17 is
// applied and the row is seeded, this is never reached.
const FALLBACK_DEFAULT: Brand = {
  id: 'socialai-studio',
  appName: 'SocialAI Studio',
  domain: 'socialaistudio.au',
  accentColor: '#f59e0b',
  bgColor: '#0a0a0f',
  supportEmail: 'support@socialaistudio.au',
  adminNotifyEmail: 'steve@pennywiseit.com.au',
  fromEmail: 'hello@socialaistudio.au',
  facebookAppId: null,
  facebookAppSecret: null,
  paypal: { starter: null, pro: null, agency: null },
};

function resolveRow(row: BrandRow, env: Env): Brand {
  return {
    id: row.id,
    appName: row.app_name,
    domain: row.domain,
    accentColor: row.accent_color,
    bgColor: row.bg_color,
    supportEmail: row.support_email,
    adminNotifyEmail: row.admin_notify_email,
    fromEmail: row.from_email,
    // NULL on the row → fall back to env. Either may still be null/undefined
    // if the env binding isn't set in this deploy; the caller has to handle
    // a missing FB app (today most do — see facebook.ts).
    facebookAppId: row.facebook_app_id ?? env.FACEBOOK_APP_ID ?? null,
    facebookAppSecret: row.facebook_app_secret ?? env.FACEBOOK_APP_SECRET ?? null,
    paypal: {
      // No env vars for PayPal plan IDs today (they're hardcoded in
      // lib/paypal.ts PAYPAL_PLAN_TIER); a NULL here means "use the
      // platform default tier-map at the callsite". The brand object
      // carries null through so the caller knows to fall back.
      starter: row.paypal_plan_starter ?? null,
      pro: row.paypal_plan_pro ?? null,
      agency: row.paypal_plan_agency ?? null,
    },
  };
}

// Load the default brand (is_default = 1). Used when:
//   - The user has no brand_id set (legacy users predating v17).
//   - We're sending an admin-side email that isn't tied to a specific user
//     (e.g. a cron summary).
// Returns the hardcoded fallback if the brands table is empty or missing
// entirely — keeps the worker functional during the deploy gap before the
// v17 migration is applied.
export async function loadDefaultBrand(env: Env): Promise<Brand> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, app_name, domain, accent_color, bg_color, support_email,
              admin_notify_email, from_email, facebook_app_id, facebook_app_secret,
              paypal_plan_starter, paypal_plan_pro, paypal_plan_agency, is_default
         FROM brands
        WHERE is_default = 1
        LIMIT 1`
    ).first<BrandRow>();
    if (row) return resolveRow(row, env);
  } catch (e: any) {
    // Table missing (pre-v17) — fall through to the hardcoded default.
    console.warn(`[brand] loadDefaultBrand fell back to hardcoded default: ${e?.message || e}`);
  }
  return FALLBACK_DEFAULT;
}

// Webhook-style lookup: find the brand that owns a PayPal subscriber when
// we have no authenticated user_id, only the subscription_id and/or email
// from the webhook payload. Falls back to the default brand if no match —
// the email still goes out, just with platform branding.
//
// Order matches recordPaymentEvent's enrichment logic in lib/paypal.ts:
// subscription_id is the primary key (only one user owns each sub), email
// is a secondary fallback (a user can have multiple subs but unique email).
export async function loadBrandBySubscriptionOrEmail(
  env: Env,
  subscriptionId: string | null | undefined,
  email: string | null | undefined,
): Promise<Brand> {
  try {
    if (subscriptionId) {
      const u = await env.DB.prepare(
        `SELECT id FROM users WHERE paypal_subscription_id = ? LIMIT 1`
      ).bind(subscriptionId).first<{ id: string }>();
      if (u) return loadBrandForUser(env, u.id);
    }
    if (email) {
      const u = await env.DB.prepare(
        `SELECT id FROM users WHERE email = ? LIMIT 1`
      ).bind(email).first<{ id: string }>();
      if (u) return loadBrandForUser(env, u.id);
    }
  } catch (e: any) {
    console.warn(`[brand] loadBrandBySubscriptionOrEmail fell back to default: ${e?.message || e}`);
  }
  return loadDefaultBrand(env);
}

// Load the brand for a given user. Resolves:
//   user.brand_id IS NOT NULL → that row
//   user.brand_id IS NULL     → is_default row
//   anything missing          → hardcoded default
//
// The two-query shape (users → brands) is intentional: it keeps the brands
// table free of users.* dependencies so it can be queried independently
// from cron jobs and admin tools.
export async function loadBrandForUser(env: Env, userId: string): Promise<Brand> {
  try {
    const user = await env.DB.prepare(
      `SELECT brand_id FROM users WHERE id = ? LIMIT 1`
    ).bind(userId).first<{ brand_id: string | null }>();

    // No row for this user (deleted? bad id?) — fall back to default.
    if (!user) return loadDefaultBrand(env);

    // brand_id NULL → default brand path. Spend one query instead of two.
    if (!user.brand_id) return loadDefaultBrand(env);

    const row = await env.DB.prepare(
      `SELECT id, app_name, domain, accent_color, bg_color, support_email,
              admin_notify_email, from_email, facebook_app_id, facebook_app_secret,
              paypal_plan_starter, paypal_plan_pro, paypal_plan_agency, is_default
         FROM brands
        WHERE id = ?
        LIMIT 1`
    ).bind(user.brand_id).first<BrandRow>();

    // brand_id pointed at a row that doesn't exist (manual DB edit?) —
    // safest to fall back rather than blow up the email send.
    if (!row) return loadDefaultBrand(env);

    return resolveRow(row, env);
  } catch (e: any) {
    console.warn(`[brand] loadBrandForUser(${userId}) fell back to hardcoded default: ${e?.message || e}`);
    return FALLBACK_DEFAULT;
  }
}
