// Shopify Admin GraphQL — thin shared client.
//
// Why this exists:
//   Phase 1 (lib/shopify-billing.ts) already speaks Admin GraphQL but does so
//   inline, because there was only one mutation in flight. Phase 2 (product
//   sync, post composer, future product webhooks) needs several queries +
//   mutations against the same surface, all sharing the same failure modes:
//
//     * network timeouts / DNS / TLS errors  → `stage: 'network'`
//     * non-2xx HTTP responses (401, 429, 5xx, etc.)  → `stage: 'http'`
//     * GraphQL `errors` array on a 200 response       → `stage: 'graphql'`
//
//   Centralizing these into one helper keeps every caller's error-handling
//   shape identical AND ensures we apply the same defensive coercion to
//   Shopify's quirky error encodings (Cloudflare reverse-proxy + Shopify
//   middlebox sometimes return `errors` as a single object or a bare string
//   rather than the spec-compliant array).
//
// Design notes:
//   * 15s AbortSignal — matches lib/shopify-billing.ts. Workers' fetch is
//     also subject to subrequest CPU/wall-time caps, so a per-call timeout
//     prevents one slow GraphQL call from starving sibling work on the same
//     invocation.
//   * Discriminated union — callers narrow on `ok` and never have to guess
//     whether `.data` is populated.
//   * No retries here — retry policy is a caller concern (sync vs single
//     compose call have different needs). This helper is one-shot.
//   * No structured-output narrowing — the generic `T` is the caller's
//     expectation of `body.data`. We do not validate shape; that's the
//     caller's job, since each query has its own schema.

const SHOPIFY_API_VERSION = '2025-01';

export type ShopifyGraphQLResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      stage: 'network' | 'http' | 'graphql';
      status?: number;
      message: string;
      raw?: unknown;
    };

/**
 * POST a GraphQL query/mutation to a shop's Admin API.
 *
 * `shopDomain` MUST be the sanitized form (e.g. "acme.myshopify.com") —
 * callers should pass the value returned by sanitizeShopDomain() in
 * lib/shopify-auth.ts. We do not re-validate here; passing an unvalidated
 * string would let a malformed value escape into an outbound URL.
 *
 * `accessToken` is the plaintext offline token (callers must decrypt the
 * stored ciphertext via lib/crypto.ts before calling us).
 */
export async function shopifyGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<ShopifyGraphQLResult<T>> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: unknown) {
    // AbortSignal.timeout surfaces as a DOMException with name 'TimeoutError'.
    // Distinguish it so callers + log scrapers don't conflate timeouts with
    // DNS/TLS errors.
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return {
        ok: false,
        stage: 'network',
        message: 'Shopify Admin API timed out after 15s',
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, stage: 'network', message: `Network error: ${message}` };
  }

  // Try to parse the body once. Both success and error paths consume it.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      stage: 'http',
      status: res.status,
      message: `Non-JSON response (HTTP ${res.status})`,
    };
  }

  // Non-2xx — return the parsed body so callers can surface auth/scope/rate
  // errors with useful context. Shopify returns rich error envelopes here.
  if (!res.ok) {
    const msg = coerceErrorsMessage(body) ?? `HTTP ${res.status}`;
    return {
      ok: false,
      stage: 'http',
      status: res.status,
      message: msg,
      raw: body,
    };
  }

  // 200 OK — check for GraphQL-level `errors` on the body. Per spec this is
  // an array, but Shopify (and Cloudflare layers in front of Shopify) have
  // been observed returning a single object or a bare string. Coerce
  // defensively before stringifying.
  const errs = (body as { errors?: unknown })?.errors;
  if (errs !== undefined && errs !== null) {
    return {
      ok: false,
      stage: 'graphql',
      status: res.status,
      message: coerceErrorsMessage(body) ?? 'GraphQL errors (no message)',
      raw: body,
    };
  }

  const data = (body as { data?: T })?.data;
  if (data === undefined) {
    // 200 with neither `errors` nor `data` is a malformed envelope. Treat
    // as a GraphQL-stage failure so callers can route it through the same
    // error UI / audit log as legit GraphQL errors.
    return {
      ok: false,
      stage: 'graphql',
      status: res.status,
      message: 'Response missing both `data` and `errors`',
      raw: body,
    };
  }

  return { ok: true, data };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Turn Shopify's wildly-shaped error envelope into a single human-readable
 * string. Handles:
 *   { errors: [{ message: "..." }, ...] }      ← spec
 *   { errors: { message: "..." } }              ← Shopify edge cases
 *   { errors: "Not found" }                     ← reverse-proxy 4xx bodies
 * Returns null when no `errors` is present.
 */
function coerceErrorsMessage(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as { errors?: unknown }).errors;
  if (raw === undefined || raw === null) return null;

  if (typeof raw === 'string') return raw;

  if (Array.isArray(raw)) {
    return raw
      .map((e) => extractMessage(e))
      .filter((s): s is string => !!s)
      .join('; ');
  }

  if (typeof raw === 'object') {
    return extractMessage(raw) ?? JSON.stringify(raw).slice(0, 500);
  }

  return String(raw);
}

function extractMessage(e: unknown): string | null {
  if (typeof e === 'string') return e;
  if (e === null || typeof e !== 'object') return null;
  const msg = (e as { message?: unknown }).message;
  if (typeof msg === 'string') return msg;
  return JSON.stringify(e).slice(0, 500);
}
