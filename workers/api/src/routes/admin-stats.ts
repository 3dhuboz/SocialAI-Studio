// Read-only admin endpoints — the four queries that power the Customers
// dashboard. All gated by requireAdmin (Clerk JWT → users.is_admin=1).
//
// GET /api/admin/stats              — top-line hero strip (MRR, signups,
//                                      churn, revenue 30d)
// GET /api/admin/customers          — paginated user list with derived
//                                      metrics (post count, last post,
//                                      total paid, refunds)
// GET /api/admin/payments           — recent payment events feed
// GET /api/admin/scan-flagged-posts — post-content scanner for AI tropes,
//                                      invented stats, fake testimonials
//
// The trope scanner (FAB_PATTERNS + scanContentForTropes) is colocated as
// private helpers since they're cron-only — no other caller. If a future
// /api/score-post or similar wants the same patterns, lift them to
// lib/content-quality.ts at that point.
//
// Action endpoints (backfill, regen, provision, bootstrap) stay in
// index.ts for now — they share helpers (backfillImagesForUser,
// tryCreateClerkUser, tryCreateCFPagesProject, refreshFactsForUser) that
// haven't been extracted yet.
//
// Extracted from src/index.ts as Phase B step 20 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { requireAdmin } from '../auth';
import { PLAN_PRICE_AUD } from '../lib/pricing';

// FAB_PATTERNS: regex bank covering the most common AI-tropes that get
// past the frontend scrubber. Used by /api/admin/scan-flagged-posts to
// surface scheduled posts that need editing BEFORE they publish.
const FAB_PATTERNS: Array<[RegExp, string]> = [
  // Fake customer testimonials
  [/\b(?:a\s+)?(?:local|nearby|happy|recent)\s+(?:cafe|restaurant|business|client|customer|owner|food\s+truck|shop|store)\s+(?:in|from|at|near)?\s*[A-Z][a-z]+/i, 'invented customer testimonial'],
  [/\b(?:one\s+of\s+our|another)\s+(?:happy\s+)?(?:client|customer|user)/i, 'invented customer story'],
  [/\b(?:says|told\s+us|reported|shared|raved)\s*[:,]?\s*["']/i, 'invented quote'],
  [/\b[A-Z][a-z]+\s+[A-Z]\.?\s*,\s*(?:from\s+)?[A-Z][a-z]+/i, 'fake testimonial signature'],
  // Fake statistics
  [/\b\d{1,3}(?:\.\d+)?%\s+(?:increase|boost|growth|improvement|more|less|reduction|saving|higher|lower|faster)/i, 'invented percentage statistic'],
  [/\b(?:by|of|up\s+to|reach(?:ing|ed)?|gain(?:ing|ed)?|boost(?:ing|ed)?\s+\w+\s+by)\s+\d{1,3}(?:\.\d+)?%/i, 'invented percentage statistic ("by X%" form)'],
  [/\bsaved\s+(?:them\s+)?\d+\s+(?:hours?|days?|weeks?|minutes?)/i, 'invented time-saving claim'],
  [/\b\d+x\s+(?:more|better|faster|increase|growth)/i, 'invented multiplier claim'],
  [/\b(?:over|more\s+than)\s+\d{2,}\s+(?:clients?|customers?|users?|businesses)/i, 'invented user count'],
  [/\b(?:already\s+)?posting\s+\d+(?:[-–]\d+)?\s+times?\s+(?:per|a)\s+(?:day|week|month)/i, 'invented posting-frequency claim'],
  [/\b(?:already\s+)?(?:get|gets|getting|generating|generated)\s+\d+(?:[-–]\d+)?\s+(?:more\s+)?(?:leads?|sales?|customers?|comments?|likes?|shares?|views?)/i, 'invented engagement-stat claim'],
  [/\bHow\s+many\s+(?:hours?|days?|customers?|sales?|leads?)\s+could\s+you\s+(?:reclaim|save|gain|earn|get|win)/i, 'leading question with implied invented stat'],
  // Fake urgency
  [/\b(?:today\s+only|this\s+weekend\s+only|limited\s+(?:time|spots)|hurry|act\s+now|don'?t\s+miss\s+out)/i, 'fake urgency'],
  [/\b(?:countdown|just\s+\d+\s+(?:hours?|days?)\s+left|ends\s+(?:tomorrow|tonight|soon))/i, 'invented countdown'],
  // Structural AI tropes
  [/\bYour\s+(?:best|top|favourite|favorite)\s+\w+\s+goes\s+live\s+at\s+\d/i, 'AI-tutorial opener'],
  [/\bNobody\s+sees\s+(it|them)[.!?]\s*Timing\s+is\s+everything/i, 'three-beat AI rhythm'],
  [/\bNo more (staring at a blank screen|wondering what to (write|post|say)|guessing)/i, 'AI cliché ("No more X-ing at a Y")'],
  [/(?:\bEvery\s+\S+(?:\s+\S+){0,3}[.!]\s*){2,}/i, '"Every X. Every Y." anaphora'],
  [/\b(?:channell?ed|leveraged|elevated)\s+(?:significant|considerable|substantial|incredible)/i, 'buzzword soup ("channelled significant…")'],
  [/\bbespoke\s+(digital\s+platforms?|ai\s+(?:tools?|solutions?|platforms?))/i, 'agency-speak ("bespoke digital platforms")'],
  [/\bSmall business owners (often|usually|typically|always|never|rarely)/i, 'generalising opener ("Small business owners often…")'],
  [/\b(Timing|Consistency|Authenticity|Quality|Strategy)\s+is\s+everything[.!?]/i, 'empty epigram ("Timing is everything")'],
  [/\bThat'?s\s+the\s+gap\s+we\s+close/i, '"That\'s the gap we close"'],
  [/\bMaking\s+(real|a\s+real)\s+difference/i, '"Making real differences"'],
];

function scanContentForTropes(content: string): string[] {
  const reasons: string[] = [];
  for (const [pattern, reason] of FAB_PATTERNS) {
    if (pattern.test(content)) reasons.push(reason);
  }
  // Cadence detector — 3+ consecutive ≤6-word declaratives
  const sentences = content.split(/[.!?]\s+/).filter(s => s.trim().length > 0);
  let consecutiveShort = 0;
  let maxRun = 0;
  for (const s of sentences) {
    if (s.trim().split(/\s+/).length <= 6) {
      consecutiveShort++;
      if (consecutiveShort > maxRun) maxRun = consecutiveShort;
    } else {
      consecutiveShort = 0;
    }
  }
  if (maxRun >= 3) reasons.push(`AI cadence — ${maxRun} consecutive short sentences`);
  return reasons;
}

export function registerAdminStatsRoutes(app: Hono<{ Bindings: Env }>): void {
  /**
   * GET /api/admin/stats
   * Top-line numbers for the Customers dashboard hero strip.
   *   signups_total      — every row in users
   *   signups_7d / 30d   — created_at within window
   *   active_subs        — distinct paid users with a paypal_subscription_id
   *   mrr_cents          — sum of monthly plan price across active subs
   *   revenue_30d_cents  — sum of completed payments in last 30d (refunds subtract)
   *   churn_30d          — cancellation events in last 30d
   *   trial_users        — users with no plan set
   */
  app.get('/api/admin/stats', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    const now = Date.now();
    const ago7  = new Date(now - 7  * 86_400_000).toISOString();
    const ago30 = new Date(now - 30 * 86_400_000).toISOString();

    const [
      signupsTotal, signups7d, signups30d,
      paidByPlan, trialCount, churn30d, revenue30d,
    ] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').bind(ago7).first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').bind(ago30).first<{ c: number }>(),
      c.env.DB.prepare(
        `SELECT plan, COUNT(*) as c FROM users
          WHERE plan IS NOT NULL AND plan != ''
            AND paypal_subscription_id IS NOT NULL
          GROUP BY plan`
      ).all(),
      c.env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE plan IS NULL OR plan = ''`).first<{ c: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM payments WHERE event_type = ? AND created_at >= ?`
      ).bind('BILLING.SUBSCRIPTION.CANCELLED', ago30).first<{ c: number }>(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount_cents),0) as s FROM payments WHERE created_at >= ?
           AND status IN ('completed','refunded')`
      ).bind(ago30).first<{ s: number }>(),
    ]);

    let mrrCents = 0;
    let activeSubs = 0;
    for (const row of (paidByPlan.results || []) as { plan: string; c: number }[]) {
      const price = PLAN_PRICE_AUD[row.plan] || 0;
      mrrCents += price * 100 * row.c;
      activeSubs += row.c;
    }

    return c.json({
      signups_total: signupsTotal?.c || 0,
      signups_7d:    signups7d?.c    || 0,
      signups_30d:   signups30d?.c   || 0,
      active_subs:   activeSubs,
      mrr_cents:     mrrCents,
      revenue_30d_cents: revenue30d?.s || 0,
      churn_30d:     churn30d?.c      || 0,
      trial_users:   trialCount?.c    || 0,
    });
  });

  /**
   * GET /api/admin/customers?filter=all|trial|paid|cancelled&limit=50&offset=0
   * Paginated list of users for the Customers table. Each row includes
   * derived metrics so the table can render without N+1 round-trips.
   */
  app.get('/api/admin/customers', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    const filter = (c.req.query('filter') || 'all').toLowerCase();
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));

    // Build the WHERE clause based on filter — all branches use static SQL,
    // no string interpolation of user input.
    let where = '1=1';
    if (filter === 'trial') {
      where = `(u.plan IS NULL OR u.plan = '')`;
    } else if (filter === 'paid') {
      where = `u.plan IS NOT NULL AND u.plan != '' AND u.paypal_subscription_id IS NOT NULL`;
    } else if (filter === 'cancelled') {
      where = `u.id IN (SELECT user_id FROM payments
                         WHERE event_type = 'BILLING.SUBSCRIPTION.CANCELLED'
                           AND user_id IS NOT NULL)`;
    }

    const rows = await c.env.DB.prepare(
      `SELECT
          u.id,
          u.email,
          u.plan,
          u.setup_status,
          u.is_admin,
          u.paypal_subscription_id,
          u.created_at,
          u.onboarding_done,
          (SELECT MAX(created_at) FROM posts WHERE user_id = u.id)            AS last_post_at,
          (SELECT COUNT(*)        FROM posts WHERE user_id = u.id)            AS post_count,
          (SELECT COALESCE(SUM(amount_cents),0)
             FROM payments
            WHERE (user_id = u.id OR (email IS NOT NULL AND email = u.email))
              AND status = 'completed')                                       AS total_paid_cents,
          (SELECT COALESCE(SUM(amount_cents),0)
             FROM payments
            WHERE (user_id = u.id OR (email IS NOT NULL AND email = u.email))
              AND status = 'refunded')                                        AS total_refunded_cents
         FROM users u
         WHERE ${where}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    const totalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM users u WHERE ${where}`
    ).first<{ c: number }>();

    return c.json({
      customers: rows.results || [],
      total: totalRow?.c || 0,
      limit, offset, filter,
    });
  });

  /**
   * GET /api/admin/payments?email=...&limit=20
   * Recent payment events. Without `email`, returns the latest events
   * across all customers (used for an admin "all activity" feed).
   * With `email`, returns just that customer's events.
   */
  app.get('/api/admin/payments', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    const email = c.req.query('email');
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));

    let result;
    if (email) {
      result = await c.env.DB.prepare(
        `SELECT id, email, event_type, amount_cents, currency, status, plan,
                paypal_subscription_id, paypal_capture_id, created_at
           FROM payments
          WHERE email = ? OR user_id IN (SELECT id FROM users WHERE email = ?)
          ORDER BY created_at DESC
          LIMIT ?`
      ).bind(email, email, limit).all();
    } else {
      result = await c.env.DB.prepare(
        `SELECT id, email, event_type, amount_cents, currency, status, plan,
                paypal_subscription_id, paypal_capture_id, created_at
           FROM payments
          ORDER BY created_at DESC
          LIMIT ?`
      ).bind(limit).all();
    }

    return c.json({ payments: result.results || [] });
  });

  /**
   * GET /api/admin/scan-flagged-posts?limit=500&status=Scheduled
   * Scans recent post content for AI-trope patterns, invented stats, and
   * fake testimonials so the admin can fix them before they publish.
   * Returns the matching posts with the reason each one was flagged.
   */
  app.get('/api/admin/scan-flagged-posts', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    const limit = Math.min(parseInt(c.req.query('limit') || '500', 10), 2000);
    const status = c.req.query('status') || 'Scheduled';
    const rows = await c.env.DB.prepare(
      `SELECT id, scheduled_for, platform, content,
              substr(COALESCE(image_prompt,''),1,200) as image_prompt_preview,
              COALESCE(client_id,'_self') as workspace
       FROM posts
       WHERE status = ? AND content IS NOT NULL AND content != ''
       ORDER BY scheduled_for ASC
       LIMIT ?`,
    ).bind(status, limit).all();

    const posts = (rows.results || []) as any[];
    const flagged: any[] = [];
    for (const p of posts) {
      const reasons = scanContentForTropes(String(p.content || ''));
      if (reasons.length > 0) {
        flagged.push({
          id: p.id,
          scheduled_for: p.scheduled_for,
          platform: p.platform,
          workspace: p.workspace,
          content_preview: String(p.content || '').slice(0, 240),
          image_prompt_preview: p.image_prompt_preview || null,
          reasons,
        });
      }
    }

    return c.json({
      scanned: posts.length,
      flagged,
    });
  });
}
