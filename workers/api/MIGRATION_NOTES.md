# D1 Migration Notes

Migrations live in `workers/api/` as `schema_v<N>.sql` files. Apply them with
`wrangler d1 execute` in version order. Every file uses `IF NOT EXISTS` where
practical so re-running is a no-op.

## Migration order

```
schema.sql               (base schema)
schema_v2.sql            (post fields, pending_* fields)
schema_v3.sql            (social_tokens)
schema_v4.sql            (payments table)
schema_v5.sql            (video_* columns + idx_posts_video_prewarm)
schema_v6.sql            (billing_cycle)
schema_v7.sql            (business_archetypes + claim_* columns)
schema_v8.sql            (per project history)
schema_v9.sql            (per project history)
schema_v10.sql           (per project history)
schema_v11.sql           (posters + poster_brand_kit)
schema_v12.sql           (ALTER campaigns: brief_* columns)
schema_v13.sql           (addon_features + poster_credits)
schema_v14.sql           (portal: expires_at/revoked_at/last_used_at)
schema_v15.sql           (client_facts + de-dup index)
schema_v16.sql           (users.subscription_status)
schema_v17.sql           (missing indexes + CREATE TABLE catch-up — this PR)
```

## Applying schema_v17_indexes_and_missing_tables.sql

This migration is **safe to re-apply** — every statement is `CREATE … IF NOT EXISTS`.
The CREATE TABLE statements for `campaigns`, `cron_runs`, and `rate_limit_log`
are catch-up records of tables already on prod (and currently runtime-created by
`auth.ts` in the `rate_limit_log` case).

### Pre-flight: diff the inferred schema against prod

Before applying to prod, sanity-check the inferred columns match what's actually
there. From `workers/api/`:

```bash
# Dump the prod schema for the tables we're catching up on
npx wrangler d1 execute socialai-db --remote --command \
  ".schema campaigns"

npx wrangler d1 execute socialai-db --remote --command \
  ".schema cron_runs"

npx wrangler d1 execute socialai-db --remote --command \
  ".schema rate_limit_log"
```

If any column in prod is **missing** from the CREATE statement in
`schema_v17_indexes_and_missing_tables.sql`, that's fine — the `IF NOT EXISTS`
means prod is left alone and the migration is only used as the canonical schema
for fresh DBs. If a column is **present in our CREATE but missing on prod**,
add an explicit ALTER in a follow-up migration so prod catches up.

### Apply to prod

```bash
cd workers/api
npx wrangler d1 execute socialai-db --remote \
  --file=schema_v17_indexes_and_missing_tables.sql
```

Cloudflare D1 returns per-statement timing. Expect one PASS line per statement
(13 statements total) and no errors. If an index already exists on a different
column, the IF NOT EXISTS short-circuits silently — that's intended.

### Apply to staging

Staging shares the same D1 binding (`database_id` in `wrangler.toml [env.staging]`
matches prod). If/when staging gets a separate DB, re-run with `--env=staging`:

```bash
npx wrangler d1 execute socialai-db --remote --env=staging \
  --file=schema_v17_indexes_and_missing_tables.sql
```

### Apply to local dev

```bash
npx wrangler d1 execute socialai-db --local \
  --file=schema_v17_indexes_and_missing_tables.sql
```

### Apply to CI / fresh databases

Run the full chain in order:

```bash
for f in schema.sql schema_v*.sql; do
  npx wrangler d1 execute socialai-db --local --file="$f"
done
```

(Replace `--local` with `--remote --env=...` for a fresh remote DB.)

## Verification after apply

```bash
# Confirm indexes exist
npx wrangler d1 execute socialai-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name IN (
     'idx_posts_status_sched',
     'idx_portal_token',
     'idx_clients_on_hold',
     'idx_rate_limit_log_key_ts',
     'idx_campaigns_owner',
     'idx_cron_runs_run_at',
     'idx_cron_runs_type_run_at',
     'idx_pending_activations_email',
     'idx_pending_cancellations_email'
   )"
```

Should return 9 rows.

## Follow-ups (NOT in this PR)

1. Strip the runtime `CREATE TABLE IF NOT EXISTS rate_limit_log` exec from
   `workers/api/src/auth.ts:120` once schema_v17 has been applied to prod.
2. Audit whether `clients.status` column should be added via a proper migration
   (it's currently set ad-hoc by an admin tool — schema.sql doesn't define it).
