// Shopify embedded-app OAuth + mandatory webhooks.
//
// Phase 1 of the App Store path — the goal of this module is to prove the
// install loop end-to-end:
//
//   merchant clicks "Install" in App Store
//     → Shopify redirects to GET /api/shopify/auth?shop=<shop>.myshopify.com
//     → we redirect to Shopify's OAuth consent screen
//   merchant approves scopes
//     → Shopify redirects to GET /api/shopify/auth/callback?code=...&shop=...&hmac=...
//     → we verify HMAC, exchange code for access_token, store the shop
//     → we redirect to the embedded app URL with ?shop=<shop>&host=<host>
//
// Webhooks (mandatory for App Store approval — reviewers test these):
//   POST /api/shopify/webhooks/app/uninstalled         → mark store inactive
//   POST /api/shopify/webhooks/customers/data_request  → GDPR data export
//   POST /api/shopify/webhooks/customers/redact        → GDPR delete customer
//   POST /api/shopify/webhooks/shop/redact             → GDPR delete shop (fires 48h after uninstall)
//
// Embedded-app data endpoint (proves the session-token round-trip works):
//   GET  /api/shopify/me  → returns { shop, shop_name, scopes } if the
//                            session token validates, 401 otherwise.
//
// All webhook handlers MUST verify HMAC against the raw request body BEFORE
// JSON-parsing. Failing to verify = automatic App Store rejection.
//
// All handlers return 200 quickly. Heavy work (e.g. actually deleting all
// merchant data on shop/redact) is logged + queued; doing it synchronously
// would push us over the 5-second webhook timeout on a busy shop.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import {
  sanitizeShopDomain,
  verifyOauthHmac,
  verifyWebhookHmac,
  verifySessionToken,
  randomToken,
  type VerifiedSession,
} from '../lib/shopify-auth';
import { createAppSubscription, shouldForceTestMode, PLAN_INFO } from '../lib/shopify-billing';
import { exchangeSessionToken } from '../lib/shopify-token-exchange';
import { encryptToken, decryptToken } from '../lib/crypto';

// At-rest encryption helper. When MASTER_ENCRYPTION_KEY is set, returns the
// AES-GCM envelope (and the v1 format marker) for storage. When it's not set
// — e.g. local dev without the secret, or a misconfigured deploy — logs a
// warning and falls back to plaintext so installs never fail. A future
// cleanup cron can re-encrypt stragglers once the secret is wired up.
async function prepareAccessTokenForStorage(
  env: Env,
  plaintext: string,
): Promise<{ stored: string; format: 'v1' | 'plaintext' }> {
  const key = env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    console.warn('[shopify] MASTER_ENCRYPTION_KEY not set — storing access_token in plaintext');
    return { stored: plaintext, format: 'plaintext' };
  }
  try {
    const ciphertext = await encryptToken(key, plaintext);
    return { stored: ciphertext, format: 'v1' };
  } catch (e) {
    // Encryption should never fail with a valid 32-byte key, but if it does
    // (e.g. malformed secret) we'd rather complete the install with plaintext
    // than block the merchant. The error surfaces in logs for follow-up.
    console.error('[shopify] encryptToken failed, falling back to plaintext:', String(e));
    return { stored: plaintext, format: 'plaintext' };
  }
}

// Counterpart to prepareAccessTokenForStorage. When MASTER_ENCRYPTION_KEY is
// set, decrypts v1 envelopes; legacy plaintext rows pass through unchanged
// (decryptToken handles the detection internally). When the key is NOT set,
// we can only read plaintext rows — encrypted rows surface a hard error
// because we cannot serve a request without a usable token.
async function readAccessToken(env: Env, stored: string): Promise<string> {
  const key = env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    if (stored.startsWith('v1:')) {
      // We have ciphertext but lost the key — this is a misconfiguration
      // worth surfacing loudly rather than silently breaking calls.
      throw new Error('Stored access_token is encrypted but MASTER_ENCRYPTION_KEY is not set');
    }
    return stored;
  }
  return decryptToken(key, stored);
}

const DEFAULT_SCOPES = 'read_products';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SHOPIFY_API_VERSION = '2025-01';

// ── Helpers ────────────────────────────────────────────────────────────────

function requireShopifyConfig(env: Env): { key: string; secret: string; appUrl: string; scopes: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET || !env.SHOPIFY_APP_URL) return null;
  return {
    key: env.SHOPIFY_API_KEY,
    secret: env.SHOPIFY_API_SECRET,
    appUrl: env.SHOPIFY_APP_URL.replace(/\/$/, ''),
    scopes: env.SHOPIFY_APP_SCOPES || DEFAULT_SCOPES,
  };
}

async function requireSession(c: any): Promise<VerifiedSession | Response> {
  const cfg = requireShopifyConfig(c.env);
  if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(auth.slice(7), cfg.key, cfg.secret);
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

async function readRawBody(req: Request): Promise<string> {
  // Webhook HMAC must be checked against the raw bytes Shopify signed, so
  // we read once as text here and the handler is responsible for JSON-parsing
  // after verification passes. Cloning the Request would let us call .json()
  // later but then HMAC and parse would silently disagree on a malformed body.
  return await req.text();
}

// Atomically claim a webhook delivery — replaces the previous
// SELECT-then-INSERT pattern which had a TOCTOU race:
//
//   T1: SELECT 1 WHERE webhook_id=X  → not found
//   T2: SELECT 1 WHERE webhook_id=X  → not found  (T1 hasn't INSERTed yet)
//   T1: process side effects
//   T2: process side effects     ← duplicate work!
//   T1: INSERT (audit row)
//   T2: INSERT (no-op via UNIQUE)
//
// Shopify retries on a 5s schedule when our handler is slow, so two retries
// landing on different worker instances in the same ~100ms window is
// realistic. UPDATEs on shopify_stores are idempotent (last writer wins) but
// a double-DELETE on shop/redact or a double-INSERT of a billing event row
// would surface as duplicate audit rows or noisy logs.
//
// The fix: INSERT OR IGNORE FIRST. SQLite returns meta.changes === 1 when
// the row was new and 0 when the UNIQUE constraint fired — that single
// boolean IS the dedup signal, with no race window. Side effects gate on
// `isNew`.
//
// auditPayload semantics: most handlers pass `raw` so the full body is
// available for debugging. customers/redact passes a sentinel because the
// raw body contains the PII the merchant is asking us to delete. This
// helper is payload-agnostic — whatever the caller passes is what the
// audit row stores.
//
// webhookId === undefined: no dedup key available (Shopify always sends one
// in prod, but the test harness may not). We still write an audit row but
// can't dedup future deliveries — fall through to side effects, matching
// the old isDuplicateWebhook fail-open behaviour. Two NULL webhook_id rows
// can coexist; the UNIQUE index permits multiple NULLs.
//
// On D1 error: fail open ("new"). Running a side effect twice is less
// harmful than dropping it, and the alternative (skipping side effects on
// every DB hiccup) was the original pre-2026-04 behaviour we already fixed
// once.
async function claimWebhook(
  env: Env,
  shop: string,
  topic: string,
  webhookId: string | undefined,
  auditPayload: string,
): Promise<{ isNew: boolean }> {
  const truncated = auditPayload.length > 65_536 ? auditPayload.slice(0, 65_536) : auditPayload;
  const receivedAt = new Date().toISOString();

  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO shopify_webhooks_log (shop_domain, topic, payload, webhook_id, received_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(shop, topic, truncated, webhookId ?? null, receivedAt).run();

    // D1's .meta.changes reflects rows actually written. INSERT OR IGNORE
    // returns 0 when the UNIQUE(webhook_id) branch fires → that's our
    // dedup signal. With no webhook_id, the INSERT always succeeds (UNIQUE
    // allows multiple NULLs), so isNew is always true — matching the
    // fail-open semantics of the old code path.
    const changes = result?.meta?.changes ?? 0;
    return { isNew: changes >= 1 };
  } catch (e) {
    console.error('[shopify] claimWebhook insert failed (fail-open):', String(e));
    return { isNew: true };
  }
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerShopifyOauthRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── GET /api/shopify/auth ─────────────────────────────────────────────
  // Install entry point. Shopify sends merchants here when they click
  // "Install" in the App Store. We generate a one-shot state, stash it in
  // D1, and redirect to Shopify's OAuth consent screen.
  //
  // We do NOT verify HMAC here — the install URL Shopify sends DOES include
  // an hmac param, but the canonical pattern is to verify it on the
  // /callback. Verifying here would just duplicate work.
  app.get('/api/shopify/auth', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const rawShop = c.req.query('shop');
    const shop = sanitizeShopDomain(rawShop);
    if (!shop) return c.json({ error: 'Invalid shop domain' }, 400);

    const state = randomToken(24);
    await c.env.DB.prepare(
      `INSERT INTO shopify_oauth_state (state, shop, created_at) VALUES (?, ?, ?)`,
    ).bind(state, shop, Date.now()).run();

    // Opportunistic GC of expired state rows (~1% sample).
    if (Math.random() < 0.01) {
      const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
      await c.env.DB.prepare(`DELETE FROM shopify_oauth_state WHERE created_at < ?`).bind(cutoff).run();
    }

    // redirect_uri MUST land on the worker (not the embedded-app Pages host),
    // because /api/shopify/auth/callback only exists on the worker. We derive
    // it from the incoming request's origin — that way dev (localhost), the
    // workers.dev URL, and any future custom worker domain all work without
    // extra config. The callback URL MUST be listed in shopify.app.toml's
    // [auth].redirect_urls — both the workers.dev one and any custom domain.
    const callbackOrigin = new URL(c.req.url).origin;
    const redirectUri = `${callbackOrigin}/api/shopify/auth/callback`;
    const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', cfg.key);
    authorizeUrl.searchParams.set('scope', cfg.scopes);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    // grant_options[]=per-user would request online (per-merchant-user) tokens.
    // We want offline tokens for background publishing → omit the param.

    return c.redirect(authorizeUrl.toString(), 302);
  });

  // ── GET /api/shopify/auth/callback ────────────────────────────────────
  // OAuth redirect target. Verifies HMAC, validates state, exchanges code
  // for an offline access_token, persists the store, then redirects to the
  // embedded app entry URL.
  app.get('/api/shopify/auth/callback', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const url = new URL(c.req.url);
    const params = url.searchParams;
    const rawShop = params.get('shop');
    const code = params.get('code');
    const state = params.get('state');

    const shop = sanitizeShopDomain(rawShop);
    if (!shop || !code || !state) return c.json({ error: 'Missing required parameters' }, 400);

    // Verify HMAC against the RAW query string Shopify just sent us — never
    // re-emit decoded params, that loses encoding fidelity (`+`, `%20`, etc).
    const hmacOk = await verifyOauthHmac(url.search.slice(1), cfg.secret);
    if (!hmacOk) return c.json({ error: 'HMAC verification failed' }, 401);

    // Validate + consume state (one-shot, atomic). DELETE ... RETURNING in a
    // single statement closes the TOCTOU window where two concurrent callbacks
    // could both SELECT the same row before either DELETE landed. Only the
    // call whose DELETE actually removed the row gets the returned values;
    // the loser sees an empty result set and is rejected.
    const stateRow = await c.env.DB.prepare(
      `DELETE FROM shopify_oauth_state WHERE state = ? RETURNING shop, created_at`,
    ).bind(state).first<{ shop: string; created_at: number }>();
    if (!stateRow) return c.json({ error: 'Invalid or expired state' }, 401);

    if (stateRow.shop !== shop) return c.json({ error: 'State / shop mismatch' }, 401);
    if (Date.now() - stateRow.created_at > OAUTH_STATE_TTL_MS) {
      return c.json({ error: 'State expired — please retry the install' }, 401);
    }

    // Exchange code for offline access_token.
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: cfg.key, client_secret: cfg.secret, code }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => '');
      console.error('[shopify] token exchange failed:', tokenRes.status, text);
      return c.json({ error: 'Token exchange failed' }, 502);
    }
    const tokenData = await tokenRes.json() as { access_token: string; scope: string };
    if (!tokenData.access_token) return c.json({ error: 'Token exchange returned no token' }, 502);

    // Fetch shop info so we have a friendly name + email + locale on file.
    let shopName: string | null = null;
    let shopEmail: string | null = null;
    let countryCode: string | null = null;
    let currency: string | null = null;
    let planName: string | null = null;
    try {
      const shopRes = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
        headers: { 'X-Shopify-Access-Token': tokenData.access_token, Accept: 'application/json' },
      });
      if (shopRes.ok) {
        const shopData = await shopRes.json() as { shop: any };
        shopName = shopData.shop?.name ?? null;
        shopEmail = shopData.shop?.email ?? null;
        countryCode = shopData.shop?.country_code ?? null;
        currency = shopData.shop?.currency ?? null;
        planName = shopData.shop?.plan_name ?? null;
      }
    } catch (e) {
      console.warn('[shopify] shop.json fetch failed (non-fatal):', String(e));
    }

    // Upsert the store. On re-install (same shop, fresh consent), we replace
    // the access_token + scopes + clear uninstalled_at. The access_token is
    // envelope-encrypted (AES-GCM v1) when MASTER_ENCRYPTION_KEY is set;
    // access_token_format records which mode the row is in so the cleanup
    // cron can find plaintext stragglers later.
    const now = new Date().toISOString();
    const { stored: storedToken, format: tokenFormat } = await prepareAccessTokenForStorage(
      c.env,
      tokenData.access_token,
    );
    await c.env.DB.prepare(
      `INSERT INTO shopify_stores
         (shop_domain, access_token, access_token_format, scopes, installed_at, shop_name, shop_email, country_code, currency, plan_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shop_domain) DO UPDATE SET
         access_token = excluded.access_token,
         access_token_format = excluded.access_token_format,
         scopes = excluded.scopes,
         installed_at = excluded.installed_at,
         uninstalled_at = NULL,
         shop_name = COALESCE(excluded.shop_name, shopify_stores.shop_name),
         shop_email = COALESCE(excluded.shop_email, shopify_stores.shop_email),
         country_code = COALESCE(excluded.country_code, shopify_stores.country_code),
         currency = COALESCE(excluded.currency, shopify_stores.currency),
         plan_name = COALESCE(excluded.plan_name, shopify_stores.plan_name)`,
    ).bind(shop, storedToken, tokenFormat, tokenData.scope ?? cfg.scopes, now, shopName, shopEmail, countryCode, currency, planName).run();

    // ── Billing handoff ────────────────────────────────────────────────
    // Wrapped in try/catch so a billing failure NEVER blocks install. The
    // install must complete (token persisted) so the embedded app can at
    // least render a "subscribe to continue" banner. App Store reviewers
    // refuse to evaluate apps where install itself can fail.
    const host = params.get('host') || '';
    const embeddedReturn = new URL(cfg.appUrl);
    embeddedReturn.searchParams.set('shop', shop);
    if (host) embeddedReturn.searchParams.set('host', host);

    try {
      const isTest = shouldForceTestMode(shop, planName, c.env.SHOPIFY_FORCE_TEST_SHOPS);
      const subResult = await createAppSubscription(
        shop,
        tokenData.access_token,
        embeddedReturn.toString(),
        isTest,
      );

      if (!subResult.ok) {
        console.error('[shopify] subscription create failed:', subResult.stage, subResult.message);
        // Persist the raw response too — that's how we diagnose Shopify-side
        // issues (auth, scope, plan availability) without re-running the install.
        await c.env.DB.prepare(
          `INSERT INTO shopify_billing_events
             (shop_domain, event_type, status_from, status_to, payload, created_at)
           VALUES (?, 'subscription_create_failed', NULL, NULL, ?, ?)`,
        ).bind(
          shop,
          JSON.stringify({
            stage: subResult.stage,
            message: subResult.message,
            raw: subResult.raw,
          }).slice(0, 65536),
          now,
        ).run();
        return c.redirect(embeddedReturn.toString(), 302);
      }

      const trialEndsAt = new Date(Date.now() + PLAN_INFO.trialDays * 24 * 60 * 60 * 1000).toISOString();
      await c.env.DB.prepare(
        `UPDATE shopify_stores SET
           subscription_id = ?,
           subscription_status = 'PENDING',
           trial_ends_at = ?,
           price_amount = ?,
           price_currency = ?,
           is_test_subscription = ?
         WHERE shop_domain = ?`,
      ).bind(
        subResult.subscriptionId,
        trialEndsAt,
        PLAN_INFO.price.toFixed(2),
        PLAN_INFO.currency,
        isTest ? 1 : 0,
        shop,
      ).run();

      await c.env.DB.prepare(
        `INSERT INTO shopify_billing_events
           (shop_domain, event_type, subscription_id, status_from, status_to, payload, created_at)
         VALUES (?, 'subscription_created', ?, NULL, 'PENDING', ?, ?)`,
      ).bind(
        shop,
        subResult.subscriptionId,
        JSON.stringify({ price: PLAN_INFO.price, currency: PLAN_INFO.currency, trialDays: PLAN_INFO.trialDays, isTest }).slice(0, 65536),
        now,
      ).run();

      return c.redirect(subResult.confirmationUrl, 302);
    } catch (billingErr: any) {
      // Catch-all: log the exception trail to the billing-events table so we
      // can diagnose what failed (this is what surfaces in the admin dashboard).
      console.error('[shopify] callback billing exception:', String(billingErr?.stack ?? billingErr));
      try {
        await c.env.DB.prepare(
          `INSERT INTO shopify_billing_events
             (shop_domain, event_type, status_from, status_to, payload, created_at)
           VALUES (?, 'callback_exception', NULL, NULL, ?, ?)`,
        ).bind(
          shop,
          JSON.stringify({ message: String(billingErr?.message ?? billingErr), stack: String(billingErr?.stack ?? '').slice(0, 4000) }).slice(0, 65536),
          now,
        ).run();
      } catch { /* never fail callback on audit-log failure */ }
      // Even on billing exception, complete the install — merchant lands on
      // embedded app which can surface the issue.
      return c.redirect(embeddedReturn.toString(), 302);
    }
  });

  // ── GET /api/shopify/me ───────────────────────────────────────────────
  // Protected endpoint — validates the session token from App Bridge and
  // returns the shop record. The embedded app calls this on first mount
  // to prove the install loop completed end-to-end.
  app.get('/api/shopify/me', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;

    const row = await c.env.DB.prepare(
      `SELECT shop_domain, scopes, shop_name, shop_email, country_code, currency, plan_name, installed_at,
              subscription_id, subscription_status, trial_ends_at, current_period_end
       FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(sessionOrResp.shopDomain).first<any>();

    if (!row) return c.json({ error: 'Shop not installed' }, 404);
    return c.json({
      shop: row.shop_domain,
      shop_name: row.shop_name,
      shop_email: row.shop_email,
      country_code: row.country_code,
      currency: row.currency,
      plan_name: row.plan_name,
      scopes: row.scopes,
      installed_at: row.installed_at,
      subscription_id: row.subscription_id ?? null,
      subscription_status: row.subscription_status ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
      current_period_end: row.current_period_end ?? null,
    });
  });

  // ── POST /api/shopify/token-exchange ─────────────────────────────────
  // Embedded-app contract: on first mount, the embedded app POSTs its
  // session token here. We exchange it with Shopify for an EXPIRING offline
  // access token (the only token type Shopify now honors for Admin API),
  // refresh the access_token + scopes + shop info in shopify_stores, then
  // return the updated record.
  //
  // Auth: Bearer <session token from App Bridge> in Authorization header.
  // The same session token is BOTH the auth credential AND the subject
  // token we exchange — Shopify designed it this way for embedded apps.
  app.post('/api/shopify/token-exchange', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const auth = c.req.header('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return c.json({ error: 'Missing session token' }, 401);
    const sessionToken = auth.slice(7);

    // Validate the session token first so we know which shop is asking.
    const session = await verifySessionToken(sessionToken, cfg.key, cfg.secret);
    if (!session) return c.json({ error: 'Invalid session token' }, 401);
    const shop = session.shopDomain;

    // Rate-limit per-shop. Token exchange is a network round-trip to Shopify
    // + a D1 upsert; a malicious or buggy embedded-app loop could otherwise
    // hammer it. 10/min/shop is well above legit usage (the embedded app
    // only calls this on mount + token refresh).
    if (await isRateLimited(c.env.DB, `shopify-tex:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Exchange for an offline (long-lived but expiring) access token.
    const result = await exchangeSessionToken(shop, sessionToken, cfg.key, cfg.secret, 'offline');
    if (!result.ok) {
      console.error('[shopify] token exchange failed:', result.stage, result.message);
      return c.json({
        error: 'Token exchange failed',
        stage: result.stage,
        message: result.message,
      }, 502);
    }

    // Upsert the store row — this is also the moment a never-before-seen
    // shop appears in our DB (Managed Install installs go straight to the
    // embedded app without ever hitting our OAuth callback).
    const now = new Date().toISOString();
    let shopName: string | null = null;
    let shopEmail: string | null = null;
    let countryCode: string | null = null;
    let currency: string | null = null;
    let planName: string | null = null;
    try {
      const shopRes = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
        headers: { 'X-Shopify-Access-Token': result.accessToken, Accept: 'application/json' },
      });
      if (shopRes.ok) {
        const data = await shopRes.json() as { shop: any };
        shopName = data.shop?.name ?? null;
        shopEmail = data.shop?.email ?? null;
        countryCode = data.shop?.country_code ?? null;
        currency = data.shop?.currency ?? null;
        planName = data.shop?.plan_name ?? null;
      } else {
        const errText = await shopRes.text().catch(() => '');
        console.warn('[shopify] shop.json fetch failed:', shopRes.status, errText.slice(0, 200));
      }
    } catch (e) {
      console.warn('[shopify] shop.json fetch threw:', String(e));
    }

    // Same encryption pattern as the OAuth callback upsert — encrypt when
    // the secret is set, fall back to plaintext otherwise. access_token_format
    // is updated on the existing row so re-installs after key rollout get
    // upgraded from plaintext to v1.
    const { stored: storedToken, format: tokenFormat } = await prepareAccessTokenForStorage(
      c.env,
      result.accessToken,
    );
    await c.env.DB.prepare(
      `INSERT INTO shopify_stores
         (shop_domain, access_token, access_token_format, scopes, installed_at, shop_name, shop_email, country_code, currency, plan_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shop_domain) DO UPDATE SET
         access_token = excluded.access_token,
         access_token_format = excluded.access_token_format,
         scopes = excluded.scopes,
         uninstalled_at = NULL,
         shop_name = COALESCE(excluded.shop_name, shopify_stores.shop_name),
         shop_email = COALESCE(excluded.shop_email, shopify_stores.shop_email),
         country_code = COALESCE(excluded.country_code, shopify_stores.country_code),
         currency = COALESCE(excluded.currency, shopify_stores.currency),
         plan_name = COALESCE(excluded.plan_name, shopify_stores.plan_name)`,
    ).bind(shop, storedToken, tokenFormat, result.scope, now, shopName, shopEmail, countryCode, currency, planName).run();

    await c.env.DB.prepare(
      `INSERT INTO shopify_billing_events
         (shop_domain, event_type, payload, created_at)
       VALUES (?, 'token_exchange_success', ?, ?)`,
    ).bind(shop, JSON.stringify({ scope: result.scope, plan: planName }).slice(0, 65536), now).run();

    return c.json({
      shop,
      shop_name: shopName,
      plan_name: planName,
      scope: result.scope,
    });
  });

  // ── POST /api/shopify/setup-subscription ─────────────────────────────
  // Embedded-app contract: when the merchant clicks "Start trial" we hit
  // this endpoint to create the Shopify-side recurring app subscription
  // and return the confirmation URL. The embedded app uses App Bridge's
  // Redirect.Action.REMOTE to send the merchant out of the iframe to
  // Shopify's billing-approval flow.
  //
  // We require an already-stored expiring access token (from a prior
  // /token-exchange call), which is why /token-exchange MUST run first.
  // Idempotent: if a subscription_id is already stored and the status is
  // still PENDING or ACTIVE, we re-return that same confirmation URL
  // pattern (Shopify accepts re-approvals to the same charge).
  app.post('/api/shopify/setup-subscription', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    // Rate-limit per-shop. Creating a subscription is an authenticated
    // GraphQL mutation against Shopify + several D1 writes; we cap at 10/min
    // so an embedded-app retry loop or a hostile session can't spam either
    // Shopify or D1.
    if (await isRateLimited(c.env.DB, `shopify-sub:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const row = await c.env.DB.prepare(
      `SELECT access_token, plan_name, subscription_id, subscription_status
       FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(shop).first<{
      access_token: string;
      plan_name: string | null;
      subscription_id: string | null;
      subscription_status: string | null;
    }>();
    if (!row?.access_token) return c.json({ error: 'Shop not connected (run token-exchange first)' }, 409);

    // Already active or pending? Don't create a duplicate sub — return the
    // status so the embedded app can render the right banner.
    if (row.subscription_status === 'ACTIVE' || row.subscription_status === 'PENDING') {
      return c.json({
        already: true,
        subscription_id: row.subscription_id,
        subscription_status: row.subscription_status,
      });
    }

    // Decrypt the access_token. readAccessToken transparently passes
    // legacy plaintext rows through, so this works whether or not the
    // row has been migrated to v1 yet.
    let accessToken: string;
    try {
      accessToken = await readAccessToken(c.env, row.access_token);
    } catch (e) {
      console.error('[shopify] setup-subscription: failed to read access_token:', String(e));
      return c.json({ error: 'Stored credential unreadable — please reinstall' }, 500);
    }

    const embeddedReturn = `${cfg.appUrl}?shop=${encodeURIComponent(shop)}`;
    const isTest = shouldForceTestMode(shop, row.plan_name, c.env.SHOPIFY_FORCE_TEST_SHOPS);
    const result = await createAppSubscription(shop, accessToken, embeddedReturn, isTest);

    const now = new Date().toISOString();
    if (!result.ok) {
      await c.env.DB.prepare(
        `INSERT INTO shopify_billing_events
           (shop_domain, event_type, payload, created_at)
         VALUES (?, 'subscription_create_failed', ?, ?)`,
      ).bind(shop, JSON.stringify({ stage: result.stage, message: result.message, raw: result.raw }).slice(0, 65536), now).run();
      return c.json({ error: 'Billing API rejected the subscription', stage: result.stage, message: result.message }, 502);
    }

    const trialEndsAt = new Date(Date.now() + PLAN_INFO.trialDays * 24 * 60 * 60 * 1000).toISOString();
    await c.env.DB.prepare(
      `UPDATE shopify_stores SET
         subscription_id = ?,
         subscription_status = 'PENDING',
         trial_ends_at = ?,
         price_amount = ?,
         price_currency = ?,
         is_test_subscription = ?
       WHERE shop_domain = ?`,
    ).bind(
      result.subscriptionId,
      trialEndsAt,
      PLAN_INFO.price.toFixed(2),
      PLAN_INFO.currency,
      isTest ? 1 : 0,
      shop,
    ).run();

    await c.env.DB.prepare(
      `INSERT INTO shopify_billing_events
         (shop_domain, event_type, subscription_id, status_from, status_to, payload, created_at)
       VALUES (?, 'subscription_created', ?, NULL, 'PENDING', ?, ?)`,
    ).bind(
      shop,
      result.subscriptionId,
      JSON.stringify({ price: PLAN_INFO.price, currency: PLAN_INFO.currency, trialDays: PLAN_INFO.trialDays, isTest }).slice(0, 65536),
      now,
    ).run();

    return c.json({
      already: false,
      subscription_id: result.subscriptionId,
      confirmation_url: result.confirmationUrl,
      is_test: result.isTest,
    });
  });

  // ── Webhook: app/uninstalled ──────────────────────────────────────────
  // Fires when a merchant uninstalls. We mark the store as uninstalled
  // (preserves history); the actual data deletion happens 48 hours later
  // via the shop/redact webhook (per Shopify's GDPR contract).
  app.post('/api/shopify/webhooks/app/uninstalled', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const raw = await readRawBody(c.req.raw);
    const hmac = c.req.header('X-Shopify-Hmac-Sha256');
    if (!(await verifyWebhookHmac(raw, hmac ?? null, cfg.secret))) {
      return c.json({ error: 'Invalid HMAC' }, 401);
    }

    const shop = sanitizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
    if (!shop) return c.json({ error: 'Missing shop header' }, 400);

    const webhookId: string | undefined = c.req.header('X-Shopify-Webhook-Id');
    // Atomically claim + audit — see claimWebhook docblock for race-fix rationale.
    const claim = await claimWebhook(c.env, shop, 'app/uninstalled', webhookId, raw);
    if (!claim.isNew) return c.json({ ok: true, dedup: true }, 200);

    // CRITICAL side effect: mark store uninstalled. Stays sync so we know it
    // succeeded before acking.
    await c.env.DB.prepare(
      `UPDATE shopify_stores SET uninstalled_at = ? WHERE shop_domain = ?`,
    ).bind(new Date().toISOString(), shop).run();

    return c.body(null, 200);
  });

  // ── Webhook: customers/data_request (GDPR) ────────────────────────────
  // Fires when a customer asks the merchant for their data. We don't store
  // any customer data in Phase 1 (we deal in shop-level data only) — so
  // there's nothing to export. We MUST still acknowledge the webhook so
  // App Store review passes.
  //
  // When Phase 2 adds product-level data tied to specific customers (e.g.
  // post engagement keyed by customer_id), revisit this handler — it must
  // produce an exportable payload within 30 days per Shopify's policy.
  app.post('/api/shopify/webhooks/customers/data_request', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const raw = await readRawBody(c.req.raw);
    const hmac = c.req.header('X-Shopify-Hmac-Sha256');
    if (!(await verifyWebhookHmac(raw, hmac ?? null, cfg.secret))) {
      return c.json({ error: 'Invalid HMAC' }, 401);
    }

    const shop = sanitizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
    if (!shop) return c.json({ error: 'Missing shop header' }, 400);

    const webhookId: string | undefined = c.req.header('X-Shopify-Webhook-Id');
    // Atomic claim with SENTINEL payload, not raw — the data_request body
    // contains customer email/phone/id (the merchant is identifying which
    // customer the data is about), which is PII we should never persist.
    // Pre-2026-05 this handler logged raw despite the privacy-comment
    // saying otherwise; while atomicising the dedup we're fixing the
    // mismatch. The sentinel records receipt without leaking the customer
    // identifier.
    const claim = await claimWebhook(c.env, shop, 'customers/data_request', webhookId, '{"data_request":true}');
    if (!claim.isNew) return c.json({ ok: true, dedup: true }, 200);

    // No customer data stored → nothing to export. claim already wrote the
    // sentinel audit row.
    return c.body(null, 200);
  });

  // ── Webhook: customers/redact (GDPR) ──────────────────────────────────
  // Fires when a customer asks for their data to be deleted. Same logic as
  // data_request — no customer data stored, acknowledge.
  app.post('/api/shopify/webhooks/customers/redact', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const raw = await readRawBody(c.req.raw);
    const hmac = c.req.header('X-Shopify-Hmac-Sha256');
    if (!(await verifyWebhookHmac(raw, hmac ?? null, cfg.secret))) {
      return c.json({ error: 'Invalid HMAC' }, 401);
    }

    const shop = sanitizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
    if (!shop) return c.json({ error: 'Missing shop header' }, 400);

    const webhookId: string | undefined = c.req.header('X-Shopify-Webhook-Id');
    // Atomic claim — but with a SENTINEL payload, not the raw body. The
    // raw customers/redact payload contains the very PII the merchant is
    // asking us to delete (customer id / email / phone / address); storing
    // it in shopify_webhooks_log would defeat the redact request. The
    // sentinel records the FACT of receipt without leaking the data.
    const claim = await claimWebhook(c.env, shop, 'customers/redact', webhookId, '{"redacted":true}');
    if (!claim.isNew) return c.json({ ok: true, dedup: true }, 200);

    // GDPR posture:
    //   1. We don't request customer / order scopes — only read_products. So
    //      no customer PII is ever fetched from Shopify in normal operation.
    //   2. We don't persist the raw redact payload — it contains the PII
    //      (customer id / email / phone / address) the merchant is asking us
    //      to delete. We log the FACT of receipt with a sentinel only.
    //   3. We do NOT run a LIKE-substring purge against shopify_webhooks_log
    //      anymore. The previous implementation built patterns like
    //      `%"id":12345%` and `%email@x.com%`, which suffered from:
    //         - short id substring matches (id=7 matched "id":777, etc.)
    //         - SQL LIKE wildcards in attacker-controlled emails
    //         - no anchoring to a JSON path
    //      Risk: deleting unrelated rows for the same shop. Since the only
    //      table that could conceivably contain customer PII is
    //      shopify_webhooks_log, and we already scrub PII at logWebhook time
    //      (logs sentinels for data_request / redact), there is nothing to
    //      purge here. shop/redact (48h post-uninstall) does the full wipe.
    //   4. If a future scope expansion introduces customer data storage, the
    //      DELETE must be parameterized against an explicit customer_id
    //      column — never via LIKE on a JSON blob.

    // (Audit row already inserted at claim time above with the sentinel
    // payload — no separate logWebhook needed.)

    return c.body(null, 200);
  });

  // ── Webhook: shop/redact (GDPR) ───────────────────────────────────────
  // Fires 48 hours after uninstall. We MUST delete all data associated with
  // the shop. Shopify actively audits this — they install + uninstall on a
  // test store and verify the row disappears.
  app.post('/api/shopify/webhooks/shop/redact', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const raw = await readRawBody(c.req.raw);
    const hmac = c.req.header('X-Shopify-Hmac-Sha256');
    if (!(await verifyWebhookHmac(raw, hmac ?? null, cfg.secret))) {
      return c.json({ error: 'Invalid HMAC' }, 401);
    }

    const shop = sanitizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
    if (!shop) return c.json({ error: 'Missing shop header' }, 400);

    const webhookId: string | undefined = c.req.header('X-Shopify-Webhook-Id');
    // Atomic claim — see claimWebhook docblock. Subtle: the purge below
    // wipes shopify_webhooks_log for this shop, but we exclude
    // topic='shop/redact' from that DELETE so the audit row we just
    // inserted survives. Without that exclusion, the purge would erase
    // our dedup marker and a Shopify retry (they fire on a 5s schedule)
    // would re-run the full purge.
    const claim = await claimWebhook(c.env, shop, 'shop/redact', webhookId, raw);
    if (!claim.isNew) return c.json({ ok: true, dedup: true }, 200);

    // CRITICAL side effects: hard-delete every row referencing this shop.
    // Shopify auto-rejects apps that leave PII (customer emails, raw webhook
    // payloads, billing payloads, lingering OAuth state) behind. Stays sync
    // so we only ack 200 once everything is purged.
    //
    // Coverage as of schema_v25 — every Shopify-scoped table + shop-owned
    // rows in the shared `posts` table + R2 poster bytes + the sentinel
    // `users` row that satisfies the posts.user_id FK. If a future schema
    // adds another shop-scoped table, ADD A DELETE HERE. Shopify auditors
    // test by installing on a dev store, uploading data, then forcing a
    // shop/redact 48h post-uninstall; anything they can find afterwards is
    // grounds for delisting.

    // 1. Collect R2 keys for any posters this shop owns BEFORE deleting the
    //    D1 rows that point at them — otherwise we leak object-store data.
    const posterRows = await c.env.DB.prepare(
      `SELECT image_r2_key FROM shopify_posters WHERE shop_domain = ?`,
    ).bind(shop).all<{ image_r2_key: string | null }>();
    const posterKeys = (posterRows.results ?? [])
      .map((r) => r.image_r2_key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    // 2. D1 purge. Order doesn't matter — every constraint is shop-scoped or
    //    references shopify_stores with ON DELETE CASCADE.
    await c.env.DB.prepare(`DELETE FROM shopify_products WHERE shop_domain = ?`).bind(shop).run();
    // Preserve the shop/redact audit row we just inserted at claim time —
    // Shopify retries this webhook for ~24h after first delivery; without
    // the audit row, dedup would fail and we'd re-run the full purge on
    // every retry. Any historical shop/redact rows for the same shop are
    // also preserved (harmless — they contain no PII).
    await c.env.DB.prepare(
      `DELETE FROM shopify_webhooks_log WHERE shop_domain = ? AND topic != 'shop/redact'`,
    ).bind(shop).run();
    await c.env.DB.prepare(`DELETE FROM shopify_billing_events WHERE shop_domain = ?`).bind(shop).run();
    await c.env.DB.prepare(`DELETE FROM shopify_oauth_state WHERE shop = ?`).bind(shop).run();
    await c.env.DB.prepare(`DELETE FROM shopify_facts WHERE shop_domain = ?`).bind(shop).run();
    await c.env.DB.prepare(`DELETE FROM shopify_campaigns WHERE shop_domain = ?`).bind(shop).run();
    await c.env.DB.prepare(`DELETE FROM shopify_posters WHERE shop_domain = ?`).bind(shop).run();
    await c.env.DB.prepare(`DELETE FROM shopify_admin_audit WHERE shop_domain = ?`).bind(shop).run();
    // Shop-owned posts in the shared `posts` table — schema_v22 tenant abstraction.
    // owner_kind='shop' AND owner_id=<shop> is the canonical filter.
    await c.env.DB.prepare(
      `DELETE FROM posts WHERE owner_kind = 'shop' AND owner_id = ?`,
    ).bind(shop).run();
    // Sentinel users row (plan='shopify-shop'). Created by ensureShopSentinelUser
    // to satisfy the posts.user_id FK; carries no PII but exists ONLY to
    // support this shop. Remove on full redact.
    await c.env.DB.prepare(
      `DELETE FROM users WHERE id = ? AND plan = 'shopify-shop'`,
    ).bind(shop).run();
    // shopify_stores last — many of the above CASCADE from this, but explicit
    // deletes above protect against future schema changes that drop the
    // CASCADE.
    await c.env.DB.prepare(`DELETE FROM shopify_stores WHERE shop_domain = ?`).bind(shop).run();

    // 3. R2 purge — best-effort, after D1 (which is the source of truth).
    //    A failure here leaves orphaned bytes but the DB is consistent. We
    //    log + continue rather than re-throwing because shop/redact MUST
    //    return 200 to Shopify within 5s; a slow R2 chain could time out.
    if (c.env.POSTER_ASSETS && posterKeys.length > 0) {
      for (const key of posterKeys) {
        try {
          await c.env.POSTER_ASSETS.delete(key);
        } catch (e: any) {
          console.warn('[shopify] shop/redact R2 delete failed', key, e?.message);
        }
      }
    }

    // (Audit row was inserted at claim time at the top of this handler and
    // preserved by the topic != 'shop/redact' filter on the webhooks-log
    // DELETE above. No separate logWebhook needed.)

    return c.body(null, 200);
  });

  // ── Webhook: app/scopes_update ─────────────────────────────────────────
  // Fires when the granted access scopes for an installed app change. We
  // mirror the current scope set into shopify_stores.scopes so support and
  // review tooling can trust D1 instead of guessing from older install data.
  app.post('/api/shopify/webhooks/app/scopes_update', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const raw = await readRawBody(c.req.raw);
    const hmac = c.req.header('X-Shopify-Hmac-Sha256');
    if (!(await verifyWebhookHmac(raw, hmac ?? null, cfg.secret))) {
      return c.json({ error: 'Invalid HMAC' }, 401);
    }

    const shop = sanitizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
    if (!shop) return c.json({ error: 'Missing shop header' }, 400);

    const webhookId: string | undefined = c.req.header('X-Shopify-Webhook-Id');
    const claim = await claimWebhook(c.env, shop, 'app/scopes_update', webhookId, raw);
    if (!claim.isNew) return c.json({ ok: true, dedup: true }, 200);

    let payload: any;
    try { payload = JSON.parse(raw); } catch {
      console.warn('[shopify] app/scopes_update: invalid JSON');
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    const previous = Array.isArray(payload?.previous) ? payload.previous.map(String) : [];
    const current = Array.isArray(payload?.current) ? payload.current.map(String) : null;
    if (!current) {
      console.warn('[shopify] app/scopes_update: missing current scopes', payload);
      return c.json({ error: 'Missing current scopes' }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE shopify_stores
          SET scopes = ?,
              uninstalled_at = NULL
        WHERE shop_domain = ?`,
    ).bind(current.join(','), shop).run();

    const auditAt = payload?.updated_at || new Date().toISOString();
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO shopify_billing_events
           (shop_domain, event_type, payload, created_at)
         VALUES (?, 'webhook_app_scopes_update', ?, ?)`,
      ).bind(
        shop,
        JSON.stringify({ previous, current }).slice(0, 65536),
        auditAt,
      ).run().catch((e) => {
        console.error('[shopify] scopes-update audit write failed:', String(e));
      }),
    );

    return c.body(null, 200);
  });

  // ── Webhook: app_subscriptions/update (Billing API) ───────────────────
  // Fires every time the merchant's subscription status changes — approval,
  // decline, trial-to-paid conversion, cancellation, payment failure
  // (frozen). We reconcile shopify_stores.subscription_status with the
  // incoming payload and append an audit event.
  //
  // Payload shape (per Shopify docs):
  //   { app_subscription: {
  //       admin_graphql_api_id: "gid://shopify/AppSubscription/...",
  //       name, status, admin_graphql_api_shop_id, currency, capped_amount,
  //       created_at, updated_at, ...
  //     } }
  app.post('/api/shopify/webhooks/app_subscriptions/update', async (c) => {
    const cfg = requireShopifyConfig(c.env);
    if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);

    const raw = await readRawBody(c.req.raw);
    const hmac = c.req.header('X-Shopify-Hmac-Sha256');
    if (!(await verifyWebhookHmac(raw, hmac ?? null, cfg.secret))) {
      return c.json({ error: 'Invalid HMAC' }, 401);
    }

    const shop = sanitizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
    if (!shop) return c.json({ error: 'Missing shop header' }, 400);

    const webhookId: string | undefined = c.req.header('X-Shopify-Webhook-Id');
    // Atomic claim — see claimWebhook docblock. Note: app_subscriptions/update
    // payloads contain no PII (just subscription metadata: id, status,
    // currency, capped_amount, dates), so the raw body is safe to persist.
    const claim = await claimWebhook(c.env, shop, 'app_subscriptions/update', webhookId, raw);
    if (!claim.isNew) return c.json({ ok: true, dedup: true }, 200);

    let payload: any;
    try { payload = JSON.parse(raw); } catch {
      console.warn('[shopify] app_subscriptions/update: invalid JSON');
      // Return 400 (not 200) so Shopify retries. claim already wrote the
      // raw-payload audit row for debugging.
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    const sub = payload?.app_subscription ?? payload;
    const subId: string | undefined = sub?.admin_graphql_api_id ?? sub?.id;
    const newStatus: string | undefined = sub?.status;
    if (!subId || !newStatus) {
      console.warn('[shopify] app_subscriptions/update: missing id or status', payload);
      // Same rationale as above — bad payload, let Shopify retry.
      return c.json({ error: 'Missing subscription id or status' }, 400);
    }

    // Read current status for the status_from audit field.
    const existing = await c.env.DB.prepare(
      `SELECT subscription_status FROM shopify_stores WHERE shop_domain = ?`,
    ).bind(shop).first<{ subscription_status: string | null }>();
    const statusFrom = existing?.subscription_status ?? null;

    // current_period_end may be present on ACTIVE statuses; otherwise leave null.
    const periodEnd = sub?.current_period_end ?? null;
    const trialEndsAt = sub?.trial_ends_on ?? sub?.trial_ends_at ?? null;

    // CRITICAL: reconcile the subscription status. Stays sync.
    await c.env.DB.prepare(
      `UPDATE shopify_stores SET
         subscription_id = ?,
         subscription_status = ?,
         current_period_end = COALESCE(?, current_period_end),
         trial_ends_at = COALESCE(?, trial_ends_at)
       WHERE shop_domain = ?`,
    ).bind(subId, newStatus.toUpperCase(), periodEnd, trialEndsAt, shop).run();

    // Non-critical audit write — the billing event log can settle after
    // the response goes out. (The webhooks-log audit row was inserted at
    // claim time at the top of the handler.)
    const truncatedRaw = raw.length > 65536 ? raw.slice(0, 65536) : raw;
    const auditAt = new Date().toISOString();
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO shopify_billing_events
           (shop_domain, event_type, subscription_id, status_from, status_to, payload, created_at)
         VALUES (?, 'webhook_app_subscriptions_update', ?, ?, ?, ?, ?)`,
      ).bind(
        shop,
        subId,
        statusFrom,
        newStatus.toUpperCase(),
        truncatedRaw,
        auditAt,
      ).run().catch((e) => {
        console.error('[shopify] billing-event audit write failed:', String(e));
      }),
    );

    return c.body(null, 200);
  });
}
