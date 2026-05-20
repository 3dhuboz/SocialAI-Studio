// Shopify tenant bookkeeping helpers.
//
// Why this exists — the FK problem
// =================================
// `posts.user_id` carries a `FOREIGN KEY (user_id) REFERENCES users(id)
// ON DELETE CASCADE` constraint inherited from the original SocialAI Studio
// (where every post belongs to a Clerk user). D1 enforces this constraint.
//
// When the Shopify embedded app writes a post, it uses the tenant abstraction
// from schema_v22:
//   - owner_kind='shop', owner_id=<shop_domain>
//   - user_id=<shop_domain> as a sentinel so the NOT NULL column is satisfied
//   - client_id=NULL
//
// But the FK still wants `users(id) = <shop_domain>` to exist. Without a
// sentinel row, every shop-write fails with:
//   D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY
//
// The sentinel row carries `email=NULL` and `plan='shopify-shop'` so admin
// queries can distinguish shop sentinels from real Clerk users — `WHERE
// plan = 'shopify-shop'` is the canonical filter. All other columns use
// table defaults.
//
// Idempotency
// ===========
// `INSERT OR IGNORE` is a no-op when the sentinel already exists, so callers
// can fire-and-forget — call it at the top of any shop-write route without
// a pre-check. The cost is one D1 round-trip (~1ms) which is negligible
// compared to the LLM + image-gen latency in the routes that use it.

import type { Env } from '../env';

/**
 * Ensure a sentinel row exists in `users` for the given shop, so the FK
 * constraint on `posts.user_id` (and any other table that references
 * users.id) is satisfied when the Shopify embedded app writes shop-owned
 * rows with `user_id=<shop_domain>`.
 *
 * Safe to call repeatedly — `INSERT OR IGNORE` makes this a no-op when the
 * sentinel already exists.
 */
export async function ensureShopSentinelUser(env: Env, shop: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, plan, profile, stats)
     VALUES (?, NULL, 'shopify-shop', '{}', '{}')`,
  ).bind(shop).run();
}
