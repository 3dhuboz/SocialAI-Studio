# Tier 2 Stack Migration Plans

Three infrastructure migrations recommended by the 2026-05 strategic review.
Each is **independent** — execute in any order. None require code rewrites
beyond what's documented here.

These are the moves that the agents identified as "definitely worth it but
require your account-level setup." Code paths are ready to support each one;
flipping the switch is a matter of provisioning + updating env vars.

---

## Migration A — D1 → Neon Postgres

**Why:** D1 has a 10GB-per-database hard cap. At ~5K rows/customer (posts +
facts + campaigns), that's ~2K customers max. Neon Postgres also unlocks
**pgvector** for Phase 2 of the Business Archetype redesign (semantic
similarity search on business descriptions, replacing the keyword fallback).

**Cost:** Neon Launch tier is **$19/mo** (3GB storage, 0.25 compute units).
At 100 customers, you're on the free tier. At 1000, you're on Launch.

**Effort:** ~1-2 days. Drizzle ORM makes the driver swap a one-line change.

### Steps

1. **Create Neon project** at https://console.neon.tech/. Note the connection string (looks like `postgres://USER:PASS@HOST/DBNAME?sslmode=require`).

2. **Add Hyperdrive binding** to `wrangler.toml` so the Worker connects via Cloudflare's connection pooler (mandatory for Workers — direct PG connections from edge are blocked):
   ```toml
   [[hyperdrive]]
   binding = "HYPERDRIVE"
   id = "<your-hyperdrive-id>"
   ```
   Create the Hyperdrive resource: `npx wrangler hyperdrive create socialai-pg --connection-string="$NEON_DATABASE_URL"`

3. **Install Drizzle** in `workers/api/`:
   ```sh
   cd workers/api && npm install drizzle-orm postgres && npm install -D drizzle-kit
   ```

4. **Translate schema.sql + schema_v2-7.sql to a single Drizzle baseline** at `workers/api/src/db/schema.ts` (the audit identified that 7 sequential ALTER files are a maintenance burden). Drizzle supports `drizzle-kit generate` to derive migrations from schema diffs going forward.

5. **Replace D1 prepare/bind calls with Drizzle queries**. The codebase has ~204 prepare() sites — most are simple SELECT/INSERT/UPDATE. Search-and-replace pattern:
   ```ts
   // Before:
   await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
   // After:
   await db.select().from(users).where(eq(users.id, uid)).limit(1);
   ```

6. **Migrate data** with `pg_dump` / a one-off ETL Worker. D1 has no native pg dump — write a single-file script that paginates through each table and inserts into Neon.

7. **Update wrangler.toml** to drop the `[[d1_databases]]` block once everything's verified.

8. **Verify**: existing tests must pass, plus add a new `pg-baseline.test.ts` that exercises every previously-D1 query against Neon.

### Risk profile

- LOW. The data is 100% relational with no D1-specific features.
- Cutover: do during a quiet window, point Workers to Neon, monitor for 1h, roll back to D1 if issues (D1 stays as the source of truth until you delete the binding).

---

## Migration B — Clerk → Better Auth

**Why:** Clerk free tier covers up to 10K MAU. After that, $25/mo + $0.02/MAU.
At 5K paying customers (call it 15K MAU), you're paying $325/mo to Clerk.
Better Auth is open-source, runs on your existing Postgres (or D1), and
ships in a few hours of work.

**Cost:** Free.

**Effort:** ~1 day.

### Steps

1. **Install Better Auth**:
   ```sh
   npm install better-auth
   cd workers/api && npm install better-auth
   ```

2. **Create the auth schema** in your DB (Better Auth provides a CLI: `npx @better-auth/cli generate`). Tables: `user`, `session`, `account`, `verification`. ~5 columns each, standard.

3. **Create `src/auth.ts`** at the worker root:
   ```ts
   import { betterAuth } from 'better-auth';
   export const auth = betterAuth({
     database: { provider: 'sqlite', url: env.DB_URL }, // or postgres after Migration A
     emailAndPassword: { enabled: true },
     socialProviders: {
       google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
       facebook: { clientId: env.FB_APP_ID, clientSecret: env.FB_APP_SECRET },
     },
   });
   ```

4. **Replace the `/api/*` Clerk middleware** with Better Auth's session resolver. The current pattern:
   ```ts
   const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
   ```
   becomes:
   ```ts
   const session = await auth.api.getSession({ headers: c.req.raw.headers });
   const uid = session?.user?.id;
   ```

5. **Replace Clerk's React provider in `src/main.tsx`**. Better Auth ships React hooks: `useSession()`, `useUser()`, `signIn()`, `signOut()`. Swap usage one-by-one.

6. **Migrate users**: write a script that reads from Clerk's API (export users + emails) and inserts into Better Auth's `user` table. Send a "set your password" email via Resend so existing users can log in.

7. **Update Settings → Account UI** to use Better Auth's `<UpdateProfile>` and `<DeleteAccount>` components (or roll your own — they're 50 lines each).

### Risk profile

- MEDIUM. Auth migration always has an "uh oh some users can't log in" tail. Mitigate: keep Clerk live for 30 days post-cutover so worst case is "oops, log in via the old route."
- Most painful part is the OAuth re-consent flow if users had connected via Google/Facebook through Clerk.

---

## Migration C — PayPal → Stripe

**Why:** PayPal subscription webhooks are infamously broken (see `functions/api/paypal-webhook.js` — that file has a comment about the third PayPal-specific quirk it's working around). Stripe has been the industry standard for 10 years for a reason. Stripe Tax handles AU GST automatically (0.5% per transaction surcharge).

**Cost:**
- Stripe: 2.9% + 30¢/tx (1.75% + 30¢ for AU domestic). PayPal is 2.6% + 30¢. Net cost similar.
- Stripe Tax: +0.5%/tx — automatic GST registration tracking, AU$75K threshold detection, monthly returns ready to file.

**Effort:** ~2 days. Existing PayPal subscribers stay on PayPal until they cancel — only NEW signups go through Stripe.

### Steps

1. **Create Stripe account** at https://dashboard.stripe.com/register. Activate AU as your country. Enable Stripe Tax in dashboard → Tax settings.

2. **Create products + prices** in Stripe dashboard matching your current PayPal plans:
   - $29/mo Starter
   - $59/mo Growth
   - $99/mo Pro
   - One-off credit packs ($9.99 / $24.99 / $49.99)

3. **Install Stripe SDK**:
   ```sh
   cd workers/api && npm install stripe
   ```

4. **Add `/api/stripe/checkout-session` worker endpoint** that creates a Checkout Session and returns the URL. Frontend opens this in a new tab.

5. **Add `/api/stripe/webhook` endpoint** to handle:
   - `checkout.session.completed` → grant subscription / credits
   - `customer.subscription.updated` → update plan tier
   - `customer.subscription.deleted` → revoke access on period end
   - `invoice.payment_failed` → email the user
   The current PayPal webhook in `functions/api/paypal-webhook.js` is a good reference for which events you need to handle.

6. **Wire `subscribe` button** on the pricing page to call `/api/stripe/checkout-session` instead of opening PayPal.

7. **Migration of existing subscribers**: leave them on PayPal. New signups go to Stripe. Over 12-24 months, PayPal subscribers naturally churn off (or you can offer them a one-time "switch to Stripe for the same price" email campaign).

### Risk profile

- LOW. Adding a parallel payment path doesn't break PayPal. Worst case: Stripe doesn't work, you remove the button and stay on PayPal.
- The webhook is the load-bearing piece. Test against Stripe CLI's `stripe listen --forward-to localhost:8787/api/stripe/webhook` before cutover.

---

## Recommended order

1. **Stripe first.** Lowest risk, immediate quality-of-life win on debugging.
2. **Better Auth second.** Drops the recurring auth bill, simpler than D1→Neon.
3. **D1 → Neon last.** Highest infra lift but unlocks pgvector for Phase 2 of the archetype work.

Each migration is its own PR. None blocks the cutting-edge AI work in Tier 1.
