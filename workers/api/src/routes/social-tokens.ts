// Social-platform OAuth tokens — GET/PUT pair.
//
// Stored in a dedicated `social_tokens` column on users (or clients for
// agency-managed workspaces) — never mixed into the profile JSON blob,
// never cached client-side. The frontend reads them on login and uses
// them to drive direct FB/IG publish + the Token Health badge in
// Settings. The full Facebook token-refresh flow happens server-side
// (see cron/refresh-tokens.ts) so even an evicted localStorage doesn't
// brick a user — they just see a brief "reconnecting…" before the next
// cron tick rehydrates the page tokens.
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.
//
// At-rest encryption (FB Platform Terms compliance): the column is
// AES-GCM-encrypted when MASTER_ENCRYPTION_KEY is set on the worker. See
// lib/social-tokens.ts for the helpers — they handle plaintext-legacy
// rows transparently, so existing connected workspaces stay working
// through the rollout. The GET path also opportunistically re-encrypts
// any plaintext rows it reads via ctx.waitUntil.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import {
  decryptSocialTokensJson,
  encryptSocialTokensJson,
  scheduleSocialTokensReencrypt,
} from '../lib/social-tokens';

export function registerSocialTokensRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/db/social-tokens', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB, c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') ?? null;
    const raw = clientId
      ? await c.env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<{ social_tokens: string | null }>()
      : await c.env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(uid).first<{ social_tokens: string | null }>();
    const tokens = (await decryptSocialTokensJson(c.env, raw?.social_tokens)) ?? {};
    // Lazy migration — if the row was legacy plaintext, re-write it as
    // ciphertext in the background. No-op when MASTER_ENCRYPTION_KEY is
    // unset or the value is already encrypted.
    scheduleSocialTokensReencrypt(
      c.env,
      c.executionCtx,
      clientId ? { scope: 'clients', id: clientId } : { scope: 'users', id: uid },
      raw?.social_tokens,
    );
    return c.json({ tokens });
  });

  app.put('/api/db/social-tokens', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB, c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') ?? null;
    const body = await c.req.json<Record<string, unknown>>();
    const stored = await encryptSocialTokensJson(c.env, body);
    if (clientId) {
      await c.env.DB.prepare('UPDATE clients SET social_tokens = ? WHERE id = ? AND user_id = ?').bind(stored, clientId, uid).run();
    } else {
      await c.env.DB.prepare('UPDATE users SET social_tokens = ? WHERE id = ?').bind(stored, uid).run();
    }
    return c.json({ ok: true });
  });
}
