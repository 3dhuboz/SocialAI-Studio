// Shopify Token Exchange — converts a session token (from App Bridge) into
// an expiring offline access token usable for Admin API + Billing.
//
// Why this exists: as of 2025, Shopify refuses to honor the "non-expiring
// offline tokens" we'd previously get from the OAuth code-grant flow for
// any Admin API call. The only way to get a working token now is to exchange
// a fresh session token (which App Bridge mints on every embedded-app load)
// for an *expiring* offline token.
//
// Reference:
//   https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/exchange-tokens
//
// Token Exchange request shape:
//   POST https://{shop}/admin/oauth/access_token
//   Content-Type: application/json
//   {
//     "client_id":            "<our public client id>",
//     "client_secret":        "<our client secret>",
//     "grant_type":           "urn:ietf:params:oauth:grant-type:token-exchange",
//     "subject_token":        "<session token from App Bridge>",
//     "subject_token_type":   "urn:ietf:params:oauth:token-type:id_token",
//     "requested_token_type": "urn:shopify:params:oauth:token-type:offline-access-token"
//   }
//
// Response:
//   { "access_token": "shpat_…", "scope": "read_products" }   // expiring
//
// The returned token DOES eventually expire (Shopify doesn't publish the
// exact lifetime; treat as opaque). When it returns 401 on an Admin API
// call, the embedded app should re-exchange.

const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const SESSION_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';
const OFFLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token';
const ONLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:online-access-token';

export type RequestedTokenKind = 'offline' | 'online';

export interface ExchangeSuccess {
  ok: true;
  accessToken: string;
  scope: string;
  /** Online tokens only — Shopify returns expires_in + associated_user info.
   *  Offline tokens omit these. */
  expiresIn?: number;
  associatedUser?: unknown;
}

export interface ExchangeError {
  ok: false;
  stage: 'network' | 'response' | 'shopify';
  status?: number;
  message: string;
  raw?: unknown;
}

export async function exchangeSessionToken(
  shopDomain: string,
  sessionToken: string,
  clientId: string,
  clientSecret: string,
  kind: RequestedTokenKind = 'offline',
): Promise<ExchangeSuccess | ExchangeError> {
  const requestedTokenType = kind === 'offline' ? OFFLINE_TOKEN_TYPE : ONLINE_TOKEN_TYPE;

  let res: Response;
  try {
    // `expiring=1` is the magic flag — without it, Shopify returns the
    // legacy "non-expiring" token type which is rejected by all Admin API
    // endpoints as of late 2025. Documented at:
    //   https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
    // The migration to expiring tokens is one-way per app/shop.
    res = await fetch(`https://${shopDomain}/admin/oauth/access_token?expiring=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        subject_token: sessionToken,
        subject_token_type: SESSION_TOKEN_TYPE,
        requested_token_type: requestedTokenType,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return { ok: false, stage: 'network', message: 'Shopify API timed out after 15s' };
    }
    return { ok: false, stage: 'network', message: `Network error: ${e?.message ?? String(e)}` };
  }

  let body: any;
  try { body = await res.json(); }
  catch { return { ok: false, stage: 'response', status: res.status, message: `Non-JSON response (HTTP ${res.status})` }; }

  if (!res.ok) {
    return {
      ok: false,
      stage: 'shopify',
      status: res.status,
      message: typeof body?.error_description === 'string'
        ? body.error_description
        : typeof body?.error === 'string' ? body.error
        : `Shopify returned HTTP ${res.status}`,
      raw: body,
    };
  }

  if (!body?.access_token || !body?.scope) {
    return { ok: false, stage: 'response', status: res.status, message: 'Missing access_token or scope', raw: body };
  }

  return {
    ok: true,
    accessToken: body.access_token,
    scope: body.scope,
    expiresIn: body.expires_in,
    associatedUser: body.associated_user,
  };
}
