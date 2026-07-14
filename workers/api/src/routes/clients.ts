// Clients CRUD — `clients` table.
//
// Agency-mode workspaces. Each client is a separate posting context owned
// by a user (the agency owner). 5 endpoints, all Clerk-authenticated.
//
// GET    /api/db/clients       — list owned clients
// GET    /api/db/clients/:id   — single client (ownership-checked)
// POST   /api/db/clients       — create
// PUT    /api/db/clients/:id   — patch via fieldMap (JSON blobs auto-stringified)
// DELETE /api/db/clients/:id   — cascade: deletes the client's posts first
//                                then the client row itself (manual since D1
//                                doesn't enforce FK cascade by default)
//
// DELETE intentionally pre-deletes posts to avoid orphan rows that would
// keep showing up in the user's main calendar view. Tradeoff: not atomic
// (no transaction). Acceptable because both queries are user-scoped and
// the worst case on a partial failure is "client deleted but posts
// linger" — the next DELETE retry cleans up.
//
// Extracted from src/index.ts as Phase B step 18 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { deleteLearningWorkspaceData } from '../lib/learning/deletion';
import { deleteReachWorkspaceData } from '../lib/reach/deletion';
import { requireAuth } from '../middleware/auth';

const uuid = () => crypto.randomUUID();

export function registerClientsRoutes(app: Hono<{ Bindings: Env }>): void {
  // Gate every /api/db/clients endpoint behind requireAuth — the previous
  // version inlined getAuthUserId(...) in each of the 5 handlers. Wildcard
  // pattern covers the bare path AND the :id variants in one declaration.
  app.use('/api/db/clients', requireAuth);
  app.use('/api/db/clients/*', requireAuth);

  app.get('/api/db/clients', async (c) => {
    const uid = c.get('uid');
    const { results } = await c.env.DB.prepare('SELECT * FROM clients WHERE user_id = ?').bind(uid).all();
    const clients = results.map((r: Record<string, unknown>) => ({
      ...r,
      profile: r.profile ? JSON.parse(r.profile as string) : {},
      stats: r.stats ? JSON.parse(r.stats as string) : {},
      insightReport: r.insight_report ? JSON.parse(r.insight_report as string) : null,
      lateConnectedPlatforms: r.late_connected_platforms ? JSON.parse(r.late_connected_platforms as string) : [],
      lateAccountIds: r.late_account_ids ? JSON.parse(r.late_account_ids as string) : {},
    }));
    return c.json({ clients });
  });

  app.get('/api/db/clients/:id', async (c) => {
    const uid = c.get('uid');
    const clientId = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<Record<string, unknown>>();
    if (!row) return c.json({ client: null });
    return c.json({
      client: {
        ...row,
        profile: row.profile ? JSON.parse(row.profile as string) : {},
        stats: row.stats ? JSON.parse(row.stats as string) : {},
        insightReport: row.insight_report ? JSON.parse(row.insight_report as string) : null,
        lateConnectedPlatforms: row.late_connected_platforms ? JSON.parse(row.late_connected_platforms as string) : [],
        lateAccountIds: row.late_account_ids ? JSON.parse(row.late_account_ids as string) : {},
      }
    });
  });

  app.post('/api/db/clients', async (c) => {
    const uid = c.get('uid');

    // ── Agency client-count gate ───────────────────────────────────────────
    // Only Agency-plan users may create client workspaces. Admins get a
    // higher ceiling (matches the isAdminMode ? 10 : 5 logic in App.tsx).
    const [userRow, countRow] = await Promise.all([
      c.env.DB.prepare('SELECT plan, is_admin FROM users WHERE id = ?')
        .bind(uid).first<{ plan: string | null; is_admin: number | null }>(),
      c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients WHERE user_id = ?')
        .bind(uid).first<{ cnt: number }>(),
    ]);
    const plan = userRow?.plan ?? null;
    const isAdmin = !!userRow?.is_admin;
    if (plan !== 'agency' && !isAdmin) {
      return c.json({ error: 'Multi-client workspaces require the Agency plan.' }, 403);
    }
    const limit = isAdmin ? 10 : 5;
    if ((countRow?.cnt ?? 0) >= limit) {
      return c.json({
        error: `Client limit reached (${limit} clients on the ${plan ?? 'agency'} plan).`,
        code: 'CLIENT_LIMIT_REACHED',
        limit,
      }, 429);
    }

    const body = await c.req.json<Record<string, unknown>>();
    const id = uuid();
    await c.env.DB.prepare(
      'INSERT INTO clients (id, user_id, name, business_type, created_at, plan) VALUES (?,?,?,?,?,?)'
    ).bind(id, uid, body.name ?? '', body.businessType ?? null, body.createdAt ?? new Date().toISOString(), body.plan ?? null).run();
    return c.json({ id });
  });

  app.put('/api/db/clients/:id', async (c) => {
    const uid = c.get('uid');
    const clientId = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    const colMap: Record<string, string> = {
      name: 'name', businessType: 'business_type', plan: 'plan',
      profile: 'profile', stats: 'stats', insightReport: 'insight_report',
      lateProfileId: 'late_profile_id', lateConnectedPlatforms: 'late_connected_platforms',
      lateAccountIds: 'late_account_ids', clientSlug: 'client_slug',
      // reelCredits intentionally removed from this map (audit P0-3, 2026-05-22):
      // it was the race vector — two tabs would both read 10, both compute
      // newBalance=8, both PUT 8 (one debit's worth lost). Use the
      // POST /api/db/reel-credits/debit endpoint below for atomic
      // workspace decrement, or admin-actions for absolute-set / grants.
    };
    const jsonFields = new Set(['profile', 'stats', 'insightReport', 'lateConnectedPlatforms', 'lateAccountIds']);
    for (const [k, col] of Object.entries(colMap)) {
      if (!(k in body)) continue;
      sets.push(`${col} = ?`);
      vals.push(jsonFields.has(k) && body[k] != null ? JSON.stringify(body[k]) : body[k] ?? null);
    }
    if (sets.length) {
      vals.push(clientId, uid);
      await c.env.DB.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals).run();
    }
    return c.json({ ok: true });
  });

  app.delete('/api/db/clients/:id', async (c) => {
    const uid = c.get('uid');
    const clientId = c.req.param('id');

    // Audit P0-5 (2026-05-22): D1 cascades don't fire (PRAGMA off), so
    // child rows under a deleted client used to orphan and — if the
    // client UUID was ever reused — re-attach to the wrong owner.
    // Mirrors the user-delete pattern in routes/user.ts.
    await deleteLearningWorkspaceData(c.env.DB, uid, clientId);
    await deleteReachWorkspaceData(c.env.DB, uid, clientId);

    const purges: Array<{ name: string; sql: string; binds: unknown[] }> = [
      { name: 'posts',               sql: `DELETE FROM posts WHERE user_id = ? AND client_id = ?`,               binds: [uid, clientId] },
      { name: 'campaigns',           sql: `DELETE FROM campaigns WHERE user_id = ? AND client_id = ?`,           binds: [uid, clientId] },
      { name: 'client_facts',        sql: `DELETE FROM client_facts WHERE user_id = ? AND client_id = ?`,        binds: [uid, clientId] },
      { name: 'posters',             sql: `DELETE FROM posters WHERE user_id = ? AND client_id = ?`,             binds: [uid, clientId] },
      { name: 'poster_brand_kit',    sql: `DELETE FROM poster_brand_kit WHERE user_id = ? AND client_id = ?`,    binds: [uid, clientId] },
      { name: 'postproxy_profiles',  sql: `DELETE FROM postproxy_profiles WHERE user_id = ? AND client_id = ?`,  binds: [uid, clientId] },
    ];
    for (const p of purges) {
      try {
        await c.env.DB.prepare(p.sql).bind(...p.binds).run();
      } catch (e: any) {
        console.warn(`[client-delete] ${p.name} purge skipped: ${e?.message || e}`);
      }
    }
    await c.env.DB.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).run();
    return c.json({ ok: true });
  });

  // POST /api/db/reel-credits/debit (audit P0-3, 2026-05-22)
  //   Body: { clientId?: string | null, count: number }
  //   Returns: 200 { ok: true, balance } | 402 INSUFFICIENT_CREDITS | 400 bad input
  //
  // Atomic decrement — replaces App.tsx's read-modify-write that two
  // concurrent tabs would both stomp (double-spend or, when Math.max(0, ...)
  // clamped, free reels). Also fixes the own-workspace silent no-op: the
  // 2026-05 security hardening removed `reelCredits` from PUT /api/db/user's
  // field map, so `db.upsertUser({ reelCredits: newBalance })` was silently
  // dropped for users with no activeClientId — they got unlimited free
  // reels until this endpoint went in.
  //
  // Conditional UPDATE: only decrements if the row already has enough,
  // so meta.changes=0 signals insufficient-credits (or wrong ownership)
  // without an explicit SELECT-then-UPDATE race window.
  app.post('/api/db/reel-credits/debit', async (c) => {
    const uid = c.get('uid');
    const body = await c.req.json<{ clientId?: string | null; count?: number }>().catch(() => null);
    const count = Math.floor(Number(body?.count) || 0);
    if (!body || count <= 0) {
      return c.json({ error: 'count must be a positive integer' }, 400);
    }
    const clientId = body.clientId ?? null;

    const result = clientId
      ? await c.env.DB.prepare(
          `UPDATE clients SET reel_credits = reel_credits - ?
           WHERE id = ? AND user_id = ? AND COALESCE(reel_credits, 0) >= ?`
        ).bind(count, clientId, uid, count).run()
      : await c.env.DB.prepare(
          `UPDATE users SET reel_credits = reel_credits - ?
           WHERE id = ? AND COALESCE(reel_credits, 0) >= ?`
        ).bind(count, uid, count).run();

    if ((result.meta?.changes ?? 0) === 0) {
      return c.json({ error: 'Insufficient reel credits', code: 'INSUFFICIENT_CREDITS' }, 402);
    }

    const balanceRow = clientId
      ? await c.env.DB.prepare(`SELECT reel_credits FROM clients WHERE id = ? AND user_id = ?`)
          .bind(clientId, uid).first<{ reel_credits: number | null }>()
      : await c.env.DB.prepare(`SELECT reel_credits FROM users WHERE id = ?`)
          .bind(uid).first<{ reel_credits: number | null }>();
    return c.json({ ok: true, balance: Number(balanceRow?.reel_credits ?? 0) });
  });
}
