// Auth helpers — JWT/portal-token resolution + admin gate + rate limit.
//
// Extracted from src/index.ts as the second module of the route-module
// split (see WORKER_SPLIT_PLAN.md). Every route handler references at
// least one of these — keeping them out of the monolith lets each
// future route module import them without circular deps.

import type { Context } from 'hono';
import { verifyToken } from '@clerk/backend';
import type { Env } from './env';

// ── Auth helper — verifies Clerk JWT or Portal token and returns userId ──
export async function getAuthUserId(
  req: Request,
  secretKey: string,
  jwtKey?: string,
  db?: D1Database,
): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;

  // Portal token auth — used by white-label client portals (no Clerk needed)
  if (auth.startsWith('Portal ') && db) {
    const portalToken = auth.slice(7);
    try {
      const row = await db.prepare('SELECT user_id FROM portal WHERE portal_token = ?').bind(portalToken).first<{ user_id: string }>();
      return row?.user_id ?? null;
    } catch (e) {
      console.error('[auth] portal token lookup failed:', String(e));
      return null;
    }
  }

  // Clerk JWT auth — used by main socialaistudio.au site
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    const normalizedKey = jwtKey?.replace(/\\n/g, '\n');
    const opts: Record<string, string> = normalizedKey ? { jwtKey: normalizedKey, secretKey } : { secretKey };
    const payload = await verifyToken(token, opts as any);
    return (payload as any).sub ?? null;
  } catch (e) {
    console.error('[auth] verifyToken failed:', String(e));
    return null;
  }
}

// ── Admin gate ───────────────────────────────────────────────────────────
// Resolves the caller's Clerk uid, looks up users.is_admin, returns either
// { uid, email } or a 401/403 Response. Endpoints use:
//
//   const adminCheck = await requireAdmin(c);
//   if (adminCheck instanceof Response) return adminCheck;
//
// is_admin is set on the user row when their email matches CLIENT.adminEmails
// at sign-in time (see App.tsx line ~437), so this gate is consistent with the
// frontend's "admin mode" detection.
export async function requireAdmin(
  c: Context<{ Bindings: Env }>,
): Promise<{ uid: string; email: string | null } | Response> {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    'SELECT email, is_admin FROM users WHERE id = ?'
  ).bind(uid).first<{ email: string | null; is_admin: number }>();
  if (!row || !row.is_admin) return c.json({ error: 'Forbidden' }, 403);
  return { uid, email: row.email };
}

// ── Rate limiter (D1-backed sliding window) ──────────────────────────────
// Returns true if the caller is OVER the limit (i.e. the request should be
// blocked), false if the request is allowed.
export async function isRateLimited(
  db: D1Database,
  key: string,
  maxPerMinute: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - 60_000;
  await db.exec(
    `CREATE TABLE IF NOT EXISTS rate_limit_log (key TEXT NOT NULL, ts INTEGER NOT NULL)`
  );
  const row = await db.prepare(
    `SELECT COUNT(*) as cnt FROM rate_limit_log WHERE key = ? AND ts > ?`
  ).bind(key, windowStart).first<{ cnt: number }>();
  const count = row?.cnt ?? 0;
  if (count >= maxPerMinute) return true;
  await db.prepare(`INSERT INTO rate_limit_log (key, ts) VALUES (?,?)`).bind(key, now).run();
  // Opportunistic GC of old rows on ~1% of calls.
  if (Math.random() < 0.01) {
    await db.prepare(`DELETE FROM rate_limit_log WHERE ts < ?`).bind(now - 5 * 60_000).run();
  }
  return false;
}
