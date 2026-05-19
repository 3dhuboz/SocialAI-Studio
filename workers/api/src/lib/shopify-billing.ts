// Shopify Billing API client — creates + manages recurring app subscriptions.
//
// Phase 1b: wired into the OAuth callback so every install kicks off a
// $29/mo USD subscription with a 14-day trial. On approval Shopify fires
// app_subscriptions/update which routes/shopify-oauth.ts catches and
// reconciles into shopify_stores.subscription_status.
//
// All Billing operations go through GraphQL (the REST RecurringApplicationCharge
// endpoint is the older API and is deprecated for new apps). One mutation
// matters in Phase 1b: appSubscriptionCreate.
//
// Test mode: development stores can NEVER be charged. If a store's
// plan_name comes back as one of the dev-store sentinels, we set
// test: true on the subscription — Shopify simulates the entire flow but
// no money moves. Detection happens at call sites; this module just
// exposes the flag.

const SHOPIFY_API_VERSION = '2025-01';
const PLAN_NAME = 'SocialAI Studio Monthly';
const PLAN_PRICE_USD = 29.00;
const TRIAL_DAYS = 14;
const PLAN_INTERVAL = 'EVERY_30_DAYS';

// Dev store plan_name values that force test: true. Real merchant plans are
// "basic", "shopify", "advanced", "shopify_plus" — anything else (including
// "partner_test", "affiliate", "staff_business") is a non-billable shop.
const DEV_STORE_PLAN_NAMES = new Set([
  'partner_test',
  'affiliate',
  'staff_business',
  'staff',
  'dev',
  'plus_partner_sandbox',
]);

export interface SubscriptionResult {
  ok: true;
  subscriptionId: string;        // GID, e.g. "gid://shopify/AppSubscription/123"
  confirmationUrl: string;       // where to redirect merchant browser
  isTest: boolean;
}

export interface SubscriptionError {
  ok: false;
  stage: 'graphql' | 'network' | 'response';
  message: string;
  raw?: unknown;
}

/** True for Shopify-defined dev/test stores that can never be charged. */
export function isTestStore(planName: string | null | undefined): boolean {
  if (!planName) return false;
  return DEV_STORE_PLAN_NAMES.has(planName.toLowerCase());
}

/** True if the shop should force `test: true` on Shopify Billing API charges.
 *  Two-step check:
 *   1. Shop's plan_name is a known dev/test plan (partner_test, affiliate, ...)
 *   2. Shop's domain appears in SHOPIFY_FORCE_TEST_SHOPS — escape hatch for
 *      dev stores whose plan_name reports as a real paid plan ("basic",
 *      "shopify", etc.) but where we know billing must stay simulated.
 *  Comma-separated list, exact match on shop_domain. */
export function shouldForceTestMode(
  shopDomain: string,
  planName: string | null | undefined,
  forceTestShopsCsv: string | null | undefined,
): boolean {
  if (isTestStore(planName)) return true;
  if (!forceTestShopsCsv) return false;
  const forced = new Set(forceTestShopsCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return forced.has(shopDomain.toLowerCase());
}

/**
 * Create a $29/mo USD recurring app subscription with a 14-day trial.
 *
 * `returnUrl` is where Shopify sends the merchant browser after they
 * approve/decline the charge. Typically `${cfg.appUrl}/?shop=...&host=...`
 * so the merchant lands back inside our embedded app.
 *
 * `isTest` MUST be true for dev stores — Shopify rejects real-money charges
 * on partner_test plans with a generic "an error has occurred" response.
 */
export async function createAppSubscription(
  shopDomain: string,
  accessToken: string,
  returnUrl: string,
  isTest: boolean,
): Promise<SubscriptionResult | SubscriptionError> {
  const mutation = `
    mutation AppSubscriptionCreate(
      $name: String!,
      $price: Decimal!,
      $returnUrl: URL!,
      $trialDays: Int!,
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        trialDays: $trialDays,
        test: $test,
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $price, currencyCode: USD },
              interval: ${PLAN_INTERVAL}
            }
          }
        }]
      ) {
        appSubscription { id status }
        confirmationUrl
        userErrors { field message }
      }
    }
  `;

  const variables = {
    name: PLAN_NAME,
    price: PLAN_PRICE_USD.toFixed(2),
    returnUrl,
    trialDays: TRIAL_DAYS,
    test: isTest,
  };

  let res: Response;
  try {
    res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: mutation, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    // AbortSignal.timeout fires a DOMException with name 'TimeoutError'.
    // Surface a specific message so callers + audit logs make sense without
    // having to know about DOMException internals.
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return { ok: false, stage: 'network', message: 'Shopify API timed out after 15s' };
    }
    return { ok: false, stage: 'network', message: `Network error: ${e?.message ?? String(e)}` };
  }

  let body: any;
  try { body = await res.json(); }
  catch { return { ok: false, stage: 'response', message: `Non-JSON response (HTTP ${res.status})` }; }

  // Defensive: `errors` is *supposed* to be an array per the GraphQL spec,
  // but Shopify (and reverse proxies in front of it) sometimes return it as
  // a single object or string when auth fails, scope is wrong, or the
  // query is malformed. Coerce to array before mapping.
  if (body.errors) {
    const errs = Array.isArray(body.errors) ? body.errors : [body.errors];
    const message = errs
      .map((e: any) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e))))
      .join('; ');
    return { ok: false, stage: 'graphql', message, raw: body };
  }

  const data = body.data?.appSubscriptionCreate;
  if (!data) {
    return {
      ok: false,
      stage: 'response',
      message: `Missing appSubscriptionCreate in response. Raw: ${JSON.stringify(body).slice(0, 500)}`,
      raw: body,
    };
  }

  if (data.userErrors?.length) {
    const userErrs = Array.isArray(data.userErrors) ? data.userErrors : [data.userErrors];
    return {
      ok: false,
      stage: 'graphql',
      message: userErrs.map((e: any) => `${e?.field?.join?.('.') ?? ''}: ${e?.message ?? JSON.stringify(e)}`).join('; '),
      raw: userErrs,
    };
  }

  if (!data.appSubscription?.id || !data.confirmationUrl) {
    return { ok: false, stage: 'response', message: 'Missing subscription id or confirmation URL', raw: data };
  }

  return {
    ok: true,
    subscriptionId: data.appSubscription.id,
    confirmationUrl: data.confirmationUrl,
    isTest,
  };
}

/** Plan metadata, exposed so the admin tab can render "what we charge". */
export const PLAN_INFO = {
  name: PLAN_NAME,
  price: PLAN_PRICE_USD,
  currency: 'USD',
  trialDays: TRIAL_DAYS,
  interval: PLAN_INTERVAL,
} as const;
