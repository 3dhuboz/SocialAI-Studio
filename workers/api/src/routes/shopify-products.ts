// Shopify product sync + listing for the embedded app (Phase 2).
//
// Two endpoints, both session-token gated (App Bridge JWT in
// Authorization: Bearer <token>, same shape as /api/shopify/me):
//
//   POST /api/shopify/products/sync
//     Walks the shop's product catalog via Admin GraphQL (first=100, paginated
//     via cursors, capped at 500 to bound a single sync). Upserts each product
//     into shopify_products and stamps shopify_stores.last_products_synced_at.
//     Returns { synced, total_pages }.
//
//   GET /api/shopify/products
//     Returns the cached catalog for the calling shop (LIMIT 250, newest sync
//     first) plus the last_synced_at timestamp. No outbound Shopify call.
//
// Rate limits (D1 sliding window, see isRateLimited in ../auth):
//   * shopify-prodsync:<shop>  → 5/min   (outbound GraphQL is expensive)
//   * shopify-prodlist:<shop>  → 60/min  (read-only D1 select)
//
// Why the 500-product cap:
//   A single sync runs inside one Workers invocation (CPU + wall-time caps).
//   500 products × 1 second worst-case = 5 paginations of 100, plus N D1
//   upserts. Above ~500 we should switch to a queue / scheduled job; until
//   then, we surface a hard cap and stop walking the cursor. The vast
//   majority of installed shops have < 200 products.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { decryptToken } from '../lib/crypto';
import { shopifyGraphQL } from '../lib/shopify-admin-api';

// ── Config ─────────────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id handle title descriptionHtml vendor productType tags status
          featuredImage { url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          createdAt updatedAt
        }
      }
    }
  }
`;

const PAGE_SIZE = 100;
const MAX_PRODUCTS = 500;
const MAX_PAGES = Math.ceil(MAX_PRODUCTS / PAGE_SIZE); // 5

// ── Shopify response shapes (defensive — every field is treated as unknown
// at boundary, normalized below). The interface is the OPTIMISTIC shape we
// hope to receive; the normalizer falls back to null/empty for anything
// missing or wrong-typed.
interface ProductsQueryData {
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    edges?: Array<{ node?: ProductNode }>;
  };
}

interface ProductNode {
  id?: string;
  handle?: string | null;
  title?: string | null;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  status?: string | null;
  featuredImage?: { url?: string | null; altText?: string | null } | null;
  priceRangeV2?: {
    minVariantPrice?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

// Session-token auth, same pattern as the requireSession in shopify-oauth.ts.
// Returns either a VerifiedSession or a Response that the handler should
// return verbatim. Typed loosely on the Hono context because Hono's generics
// add no value here — every caller has the same Env binding.
async function requireSession(c: any): Promise<VerifiedSession | Response> {
  const cfg = requireShopifyConfig(c.env);
  if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(auth.slice(7), cfg.key, cfg.secret);
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

// Read the stored access_token. Encrypted rows go through decryptToken; legacy
// plaintext rows are passed through unchanged by decryptToken's own prefix
// check. When the secret is unavailable we still tolerate plaintext rows
// (mirrors the OAuth handler's readAccessToken).
async function readAccessToken(env: Env, stored: string): Promise<string> {
  const key = env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    if (stored.startsWith('v1:')) {
      throw new Error('Stored access_token is encrypted but MASTER_ENCRYPTION_KEY is not set');
    }
    return stored;
  }
  return decryptToken(key, stored);
}

// Strip HTML tags from descriptionHtml. Cheap regex — good enough for
// search/display previews. We intentionally do NOT decode entities (&amp;)
// here; the frontend will render the text raw and we want to keep the
// transformation symmetric/reversible-ish. Trim whitespace runs.
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

// Coerce a possibly-malformed product node into a row for D1. Every field is
// defensively narrowed — Shopify is meant to return a stable shape but we
// never trust upstream input.
interface ProductRow {
  id: string;
  shop_domain: string;
  title: string;
  handle: string | null;
  description: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string | null;
  price: string | null;
  currency: string | null;
  image_url: string | null;
  status: string | null;
  synced_at: string;
  raw: string;
}

function normalizeProduct(
  node: ProductNode,
  shopDomain: string,
  syncedAt: string,
): ProductRow | null {
  // id + title are the only fields we hard-require. A product with no id is
  // nonsense; a product with no title cannot be sensibly persisted (NOT NULL).
  const id = typeof node.id === 'string' ? node.id : null;
  const title = typeof node.title === 'string' && node.title.length > 0 ? node.title : null;
  if (!id || !title) return null;

  const tagsArr = Array.isArray(node.tags) ? node.tags.filter((t): t is string => typeof t === 'string') : [];

  const minPrice = node.priceRangeV2?.minVariantPrice;
  const price = typeof minPrice?.amount === 'string' ? minPrice.amount : null;
  const currency = typeof minPrice?.currencyCode === 'string' ? minPrice.currencyCode : null;

  const imageUrl = typeof node.featuredImage?.url === 'string' ? node.featuredImage.url : null;

  // raw JSON cap — D1 row size best-practice + protects against pathological
  // descriptionHtml blowing up the table. 32 KB is generous for one product.
  const rawJson = JSON.stringify(node);
  const raw = rawJson.length > 32_768 ? rawJson.slice(0, 32_768) : rawJson;

  return {
    id,
    shop_domain: shopDomain,
    title,
    handle: typeof node.handle === 'string' ? node.handle : null,
    description: stripHtml(node.descriptionHtml ?? null),
    product_type: typeof node.productType === 'string' ? node.productType : null,
    vendor: typeof node.vendor === 'string' ? node.vendor : null,
    tags: tagsArr.length > 0 ? tagsArr.join(',') : null,
    price,
    currency,
    image_url: imageUrl,
    status: typeof node.status === 'string' ? node.status : null,
    synced_at: syncedAt,
    raw,
  };
}

// Upsert one product row. PRIMARY KEY is (id, shop_domain) per schema_v17, so
// a re-sync overwrites the previous snapshot for the same product. We refresh
// every field including synced_at so the GET endpoint can sort newest-first.
async function upsertProduct(db: D1Database, row: ProductRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shopify_products
         (id, shop_domain, title, handle, description, product_type, vendor, tags,
          price, currency, image_url, status, synced_at, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, shop_domain) DO UPDATE SET
         title = excluded.title,
         handle = excluded.handle,
         description = excluded.description,
         product_type = excluded.product_type,
         vendor = excluded.vendor,
         tags = excluded.tags,
         price = excluded.price,
         currency = excluded.currency,
         image_url = excluded.image_url,
         status = excluded.status,
         synced_at = excluded.synced_at,
         raw = excluded.raw`,
    )
    .bind(
      row.id,
      row.shop_domain,
      row.title,
      row.handle,
      row.description,
      row.product_type,
      row.vendor,
      row.tags,
      row.price,
      row.currency,
      row.image_url,
      row.status,
      row.synced_at,
      row.raw,
    )
    .run();
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerShopifyProductsRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/shopify/products/sync ───────────────────────────────────
  // Walk the shop's product catalog and refresh the local mirror. Bounded
  // to MAX_PAGES × PAGE_SIZE = 500 products per call. Idempotent — running
  // it twice in succession is safe (just updates synced_at).
  app.post('/api/shopify/products/sync', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    // Per-shop rate limit. 5/min is well above any legit "merchant clicks
    // Sync" usage but tight enough that a runaway loop in the embedded app
    // can't exhaust Shopify's GraphQL cost budget for the shop.
    if (await isRateLimited(c.env.DB, `shopify-prodsync:${shop}`, 5)) {
      return c.json({ error: 'Rate limit exceeded — please retry in a minute' }, 429);
    }

    // Look up the shop's stored credentials. We treat an uninstalled shop as
    // a 404 — the embedded app shouldn't be calling us in that state.
    const row = await c.env.DB.prepare(
      `SELECT access_token, access_token_format
       FROM shopify_stores
       WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    )
      .bind(shop)
      .first<{ access_token: string; access_token_format: string | null }>();

    if (!row?.access_token) {
      return c.json({ error: 'Shop not installed or token missing' }, 404);
    }

    let accessToken: string;
    try {
      accessToken = await readAccessToken(c.env, row.access_token);
    } catch (e) {
      console.error('[shopify-products] failed to read access_token:', String(e));
      return c.json({ error: 'Stored credential unreadable — please reinstall' }, 500);
    }

    // Paginate. We allocate a list outside the loop to track the count for
    // the response and apply the hard cap.
    const syncedAt = new Date().toISOString();
    let cursor: string | null = null;
    let pages = 0;
    let syncedCount = 0;
    let hardCapHit = false;

    try {
      for (let i = 0; i < MAX_PAGES; i++) {
        const variables: Record<string, unknown> = { first: PAGE_SIZE };
        if (cursor) variables.after = cursor;

        const result = await shopifyGraphQL<ProductsQueryData>(
          shop,
          accessToken,
          PRODUCTS_QUERY,
          variables,
        );

        if (!result.ok) {
          // Distinguish HTTP failures (likely 401 = revoked token, 402 =
          // billing not active, 429 = rate-limited) from network and graphql.
          // Surface the upstream stage + status so the embedded app can
          // render a useful error and decide whether to retry.
          console.error(
            '[shopify-products] sync failed:',
            result.stage,
            result.status ?? '',
            result.message,
          );
          const status = result.stage === 'network' ? 504 : 502;
          return c.json(
            {
              error: 'Shopify Admin API error',
              stage: result.stage,
              shopify_status: result.status ?? null,
              message: result.message,
              synced_so_far: syncedCount,
            },
            status,
          );
        }

        pages++;
        const productsRoot = result.data.products;
        const edges = Array.isArray(productsRoot?.edges) ? productsRoot.edges : [];

        for (const edge of edges) {
          const node = edge?.node;
          if (!node) continue;
          const rowToWrite = normalizeProduct(node, shop, syncedAt);
          if (!rowToWrite) continue;
          // Sequential upserts — D1 prepare/bind isn't safely concurrent
          // inside a single Worker invocation, and the cap (500) is small
          // enough that the latency is acceptable.
          await upsertProduct(c.env.DB, rowToWrite);
          syncedCount++;
          if (syncedCount >= MAX_PRODUCTS) {
            hardCapHit = true;
            break;
          }
        }

        if (hardCapHit) break;

        const hasNext = productsRoot?.pageInfo?.hasNextPage === true;
        const nextCursor = productsRoot?.pageInfo?.endCursor;
        if (!hasNext) break;
        cursor = typeof nextCursor === 'string' && nextCursor.length > 0 ? nextCursor : null;
        // Defensive — if Shopify says hasNextPage=true but doesn't give us a
        // cursor, stop walking rather than re-fetching the same page forever.
        if (!cursor) break;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[shopify-products] unexpected sync error:', message);
      return c.json(
        { error: 'Sync failed', message, synced_so_far: syncedCount },
        500,
      );
    }

    // Purge products that disappeared from Shopify (merchant deleted them, or
    // they're now in a state Shopify's GraphQL excludes). Every product seen
    // in this sync was UPSERTed with synced_at=syncedAt — anything older is
    // a row Shopify no longer returns and should not show up in the cached
    // catalog. Skipped when hardCapHit is true: a capped sync only saw the
    // first 500 products, so we can't infer the remainder are deleted.
    let purgedCount = 0;
    if (!hardCapHit) {
      try {
        const purgeResult = await c.env.DB.prepare(
          `DELETE FROM shopify_products WHERE shop_domain = ? AND synced_at < ?`,
        )
          .bind(shop, syncedAt)
          .run();
        // D1 exposes meta.changes — defensive coalesce in case the binding
        // ever shifts.
        purgedCount = (purgeResult.meta?.changes as number | undefined) ?? 0;
      } catch (e) {
        // Non-fatal — leaving stale rows is a UX bug, not a data-integrity
        // one. Log and continue so the sync as a whole still returns 200.
        console.error('[shopify-products] purge failed:', String(e));
      }
    }

    // Stamp the shop. Even on partial syncs (hit MAX_PRODUCTS or an early
    // hasNextPage=false), the timestamp reflects "we successfully talked to
    // Shopify". The GET endpoint surfaces this so the UI can render
    // "Last synced: 5 minutes ago".
    try {
      await c.env.DB.prepare(
        `UPDATE shopify_stores SET last_products_synced_at = ? WHERE shop_domain = ?`,
      )
        .bind(syncedAt, shop)
        .run();
    } catch (e) {
      // Non-fatal — the products themselves are written. The next sync will
      // overwrite the timestamp. Log so we can spot a missing schema_v22.
      console.error('[shopify-products] timestamp update failed:', String(e));
    }

    return c.json({
      synced: syncedCount,
      purged: purgedCount,
      total_pages: pages,
      hard_cap_hit: hardCapHit,
      last_synced_at: syncedAt,
    });
  });

  // ── GET /api/shopify/products ─────────────────────────────────────────
  // Cached catalog for the calling shop. No outbound Shopify call — the
  // frontend should trigger /sync explicitly when it wants fresh data.
  // LIMIT 250 caps the response so we don't push huge JSON bodies through
  // the worker.
  app.get('/api/shopify/products', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    // Per-shop list rate limit. 60/min is generous (1/sec) — the list is
    // a single D1 SELECT and cheap, but we still want a ceiling so a buggy
    // useEffect loop can't hammer it.
    if (await isRateLimited(c.env.DB, `shopify-prodlist:${shop}`, 60)) {
      return c.json({ error: 'Rate limit exceeded — please retry in a minute' }, 429);
    }

    const productsRes = await c.env.DB.prepare(
      `SELECT id, shop_domain, title, handle, description, product_type, vendor,
              tags, price, currency, image_url, status, synced_at
       FROM shopify_products
       WHERE shop_domain = ?
       ORDER BY synced_at DESC
       LIMIT 250`,
    )
      .bind(shop)
      .all<{
        id: string;
        shop_domain: string;
        title: string;
        handle: string | null;
        description: string | null;
        product_type: string | null;
        vendor: string | null;
        tags: string | null;
        price: string | null;
        currency: string | null;
        image_url: string | null;
        status: string | null;
        synced_at: string;
      }>();

    // last_products_synced_at lives on shopify_stores. If the column isn't
    // there yet (schema_v22 not applied), the row read still succeeds — D1
    // just won't return the field. Coerce missing/undefined to null.
    let lastSyncedAt: string | null = null;
    try {
      const storeRow = await c.env.DB.prepare(
        `SELECT last_products_synced_at FROM shopify_stores WHERE shop_domain = ?`,
      )
        .bind(shop)
        .first<{ last_products_synced_at: string | null }>();
      lastSyncedAt = storeRow?.last_products_synced_at ?? null;
    } catch (e) {
      // Column missing (pre-v22) or other read failure — non-fatal, the
      // products list is still useful without the timestamp.
      console.warn('[shopify-products] last_synced_at lookup failed:', String(e));
    }

    return c.json({
      products: productsRes.results ?? [],
      last_synced_at: lastSyncedAt,
    });
  });
}
