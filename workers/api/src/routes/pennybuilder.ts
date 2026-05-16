// PennyBuilder bridge — two endpoints that wire SocialAI Studio into
// PennyBuilder's "📱 Social" add-on.
//
// PennyBuilder offers SocialAI Studio Starter as a $29/mo Stripe add-on.
// When a buyer checks out, PennyBuilder's Stripe webhook hits
// POST /api/admin/provision-from-pennybuilder with the buyer's email +
// Stripe subscription id. We:
//   1. Find or create the Clerk user for that email (via Clerk admin API)
//   2. Mirror them into our users table with plan + billing_cycle set,
//      tagging paypal_subscription_id with a 'pb:' prefix so the source
//      is auditable in the DB
//   3. Drop a pending_activations row that the existing PayPal-flow
//      consumer activates on first sign-in (single source of truth for
//      plans, no parallel activation path)
//   4. Mint a 7-day Clerk sign-in token + return a magic-link URL the
//      buyer can use to land directly in their dashboard
//
// GET /embed?token=...
//   The iframe in PennyBuilder's Builder loads this URL. We verify the
//   HMAC-signed (5-minute TTL) token, mint a 60-second Clerk sign-in
//   token for the user, and 302 redirect to /sign-in with __clerk_ticket
//   so Clerk's React SDK signs them in transparently on the dashboard.
//   Response carries `Content-Security-Policy: frame-ancestors 'self'
//   https://*.workers.dev https://*.pennywiseit.com.au` so the parent
//   frame on pennybuilder.* can render us.
//
// Both endpoints are authenticated with the shared PENNYBUILDER_PROVISION_SECRET
// environment variable. Contract documented in pennybuilder/docs/socialai-integration.md.
//
// Extracted from src/index.ts as part of the route-module split.

import type { Hono, Context } from 'hono';
import type { Env } from '../env';
// HMAC-SHA256 embed token helpers — extracted into a shared lib so the
// verifier can be unit-tested against its own minter and so PennyBuilder's
// signing side can later import the same canonical shape.
import { verifyEmbedToken } from '../lib/embed-token';

// ── Auth helper — Bearer token timing-safe compare ───────────────────────────
function authPennybuilder(c: Context<{ Bindings: Env }>): Response | null {
  const expected = c.env.PENNYBUILDER_PROVISION_SECRET;
  if (!expected) return c.json({ error: 'PennyBuilder bridge not configured' }, 503);
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const provided = auth.slice('Bearer '.length);
  // Timing-safe compare to avoid leaking secret length via response timing.
  if (provided.length !== expected.length) return c.json({ error: 'Forbidden' }, 403);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return c.json({ error: 'Forbidden' }, 403);
  return null;
}

export function registerPennybuildRoutes(app: Hono<{ Bindings: Env }>): void {
  /**
   * POST /api/admin/provision-from-pennybuilder
   * Called by PennyBuilder's Stripe webhook on checkout.session.completed.
   * Authenticated with the shared PENNYBUILDER_PROVISION_SECRET.
   */
  app.post('/api/admin/provision-from-pennybuilder', async (c) => {
    const guard = authPennybuilder(c);
    if (guard) return guard;

    type Body = {
      email?: string;
      name?: string | null;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      tier?: 'starter' | 'growth' | 'pro' | 'agency';
      source?: string;
    };
    let body: Body;
    try { body = await c.req.json<Body>(); }
    catch { return c.json({ error: 'bad json' }, 400); }

    const email = (body.email ?? '').trim().toLowerCase();
    const tier = body.tier ?? 'starter';
    const stripeSubscriptionId = body.stripeSubscriptionId ?? '';
    if (!email || !stripeSubscriptionId) {
      return c.json({ error: 'email + stripeSubscriptionId required' }, 400);
    }

    // ── 1. Find or create the Clerk user ─────────────────────────────────────
    let clerkUserId: string;
    try {
      const lookup = await fetch(
        `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}` } },
      );
      if (!lookup.ok) throw new Error(`Clerk lookup ${lookup.status}: ${(await lookup.text()).slice(0, 200)}`);
      const existing = (await lookup.json()) as Array<{ id: string }>;
      if (existing.length > 0) {
        clerkUserId = existing[0].id;
      } else {
        const nameParts = (body.name ?? '').trim().split(/\s+/);
        const first = nameParts[0] || null;
        const last = nameParts.slice(1).join(' ') || null;
        const create = await fetch('https://api.clerk.com/v1/users', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email_address: [email],
            first_name: first,
            last_name: last,
            skip_password_requirement: true,
            skip_password_checks: true,
            public_metadata: { source: 'pennybuilder', tier },
          }),
        });
        if (!create.ok) {
          const text = await create.text();
          return c.json({ error: 'Clerk create failed', detail: text.slice(0, 300) }, 502);
        }
        const created = (await create.json()) as { id: string };
        clerkUserId = created.id;
      }
    } catch (e: any) {
      return c.json({ error: 'Clerk error', detail: e.message ?? String(e) }, 502);
    }

    // ── 2. Mirror into our users table (idempotent) ───────────────────────────
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, plan, billing_cycle, paypal_subscription_id)
       VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         plan = excluded.plan,
         billing_cycle = excluded.billing_cycle,
         paypal_subscription_id = excluded.paypal_subscription_id`
    ).bind(
      clerkUserId, email, tier, 'monthly',
      `pb:${stripeSubscriptionId}`,
    ).run();

    // ── 3. Drop a pending_activations row so the existing consumer flow
    //       activates on the buyer's first sign-in. The 'pb:' prefix on
    //       paypal_subscription_id makes PennyBuilder-sourced rows auditable.
    await c.env.DB.prepare(
      `INSERT INTO pending_activations
         (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
       VALUES (?,?,?,?,?,?,0)`
    ).bind(
      crypto.randomUUID(), tier, email,
      `pb:${stripeSubscriptionId}`,
      body.stripeCustomerId ?? null,
      new Date().toISOString(),
    ).run();

    // ── 4. Mint a 7-day Clerk sign-in token and build the magic-link URL
    //       that PennyBuilder will email to the buyer.
    let magicLink: string;
    try {
      const tokRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: clerkUserId,
          expires_in_seconds: 7 * 24 * 60 * 60,
        }),
      });
      if (!tokRes.ok) {
        const text = await tokRes.text();
        return c.json({ error: 'sign_in_tokens failed', detail: text.slice(0, 300) }, 502);
      }
      const tok = (await tokRes.json()) as { token: string; url?: string };
      magicLink =
        tok.url ??
        `https://socialaistudio.au/sign-in?__clerk_ticket=${encodeURIComponent(tok.token)}&redirect_url=${encodeURIComponent('/?welcome=1')}`;
    } catch (e: any) {
      return c.json({ error: 'magic-link mint failed', detail: e.message ?? String(e) }, 502);
    }

    return c.json({
      ok: true,
      externalAccountId: clerkUserId,
      magicSignInLink: magicLink,
    });
  });

  /**
   * GET /embed?token=...
   * Verifies a HMAC-signed embed token (5-min TTL), mints a 60-second
   * Clerk sign-in ticket, and 302 redirects to the dashboard so the
   * PennyBuilder iframe signs the user in transparently.
   */
  app.get('/embed', async (c) => {
    const secret = c.env.PENNYBUILDER_PROVISION_SECRET;
    if (!secret) return c.text('embed not configured', 503);

    const token = c.req.query('token');
    if (!token) return c.text('missing token', 400);

    const claims = await verifyEmbedToken(secret, token);
    if (!claims) return c.text('invalid or expired token', 401);

    let ticket: string;
    try {
      const tokRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: claims.sub, expires_in_seconds: 60 }),
      });
      if (!tokRes.ok) return c.text('clerk ticket failed', 502);
      const tok = (await tokRes.json()) as { token: string };
      ticket = tok.token;
    } catch {
      return c.text('clerk ticket error', 502);
    }

    const target =
      `https://socialaistudio.au/sign-in` +
      `?__clerk_ticket=${encodeURIComponent(ticket)}` +
      `&redirect_url=${encodeURIComponent('/?embedded=1')}`;

    // Assert frame-ancestors so the parent frame on pennybuilder.* can render us.
    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        'Content-Security-Policy':
          "frame-ancestors 'self' https://*.workers.dev https://*.pennywiseit.com.au",
        'X-Robots-Tag': 'noindex',
      },
    });
  });
}
