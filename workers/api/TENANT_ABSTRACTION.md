# Tenant Abstraction

Multi-tenant ownership for `posts`, `social_tokens`, `campaigns`. Introduced in `schema_v20.sql`.

## Tri-tenant model

Every row is owned by `(owner_kind, owner_id)`:

| `owner_kind` | `owner_id` references         | When to use                                                  |
|--------------|-------------------------------|--------------------------------------------------------------|
| `'user'`     | `users.id` (Clerk uid)        | Agency owner's own workspace, or solo SaaS subscriber.       |
| `'client'`   | `clients.id`                  | Agency-plan workspace managed for a third-party client.      |
| `'shop'`     | `shopify_stores.shop_domain`  | Shopify App Store merchant — no Clerk account needed.        |

## Contract for new code

### Inserts — write BOTH old AND new columns
New inserts MUST populate legacy AND new columns until deprecation lands:

```ts
// Clerk-user post
db.prepare(
  `INSERT INTO posts (id, user_id, client_id, owner_kind, owner_id, content)
   VALUES (?, ?, NULL, 'user', ?, ?)`
).bind(postId, uid, uid, content).run();

// Shopify-merchant post
db.prepare(
  `INSERT INTO posts (id, user_id, client_id, owner_kind, owner_id, content)
   VALUES (?, ?, NULL, 'shop', ?, ?)`
).bind(postId, shopDomain, shopDomain, content).run();
```

`user_id` is `NOT NULL` today — pass the shop domain as a sentinel for `'shop'` rows until deprecation relaxes the constraint.

### Reads — prefer the new shape
```sql
-- New: SELECT ... WHERE owner_kind = ? AND owner_id = ?
-- Old: SELECT ... WHERE user_id = ? AND client_id IS NULL
```

Index `idx_<table>_owner(owner_kind, owner_id)` covers the new shape.

## Deprecation path

A future `schema_vN` will drop `user_id` + `client_id` once every read/write path has been migrated. Until then this is strictly additive — no destructive changes.
