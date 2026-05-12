// Posts CRUD — the `posts` table.
//
// 8 endpoints. All authenticated via Clerk. The biggest single route group
// in the file but mechanically simple — direct DB operations with no
// shared business logic. The complexity lives in the field map (camelCase
// frontend ↔ snake_case D1) and the v5+ video columns appended to the
// INSERT in a backwards-compatible order.
//
// GET    /api/db/posts                — list (scoped to user + optional client)
// POST   /api/db/posts                — insert with full v5 column shape
// PUT    /api/db/posts/:id            — patch via fieldMap
// DELETE /api/db/posts/:id            — single row
// DELETE /api/db/posts                — bulk: workspace or client scope
// POST   /api/db/posts/delete-all     — POST fallback for clients that can't DELETE w/o body
// POST   /api/db/posts/bulk-status    — flip status on N ids in one query
// GET    /api/db/posts/client-health  — last 50 rows for a client, status check
//
// Extracted from src/index.ts as Phase B step 18 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import { classifyArchetypeFromFingerprint } from '../lib/archetypes';

const uuid = () => crypto.randomUUID();

// Safety-net classifier: kicked off in the background when an own-workspace
// post is created and users.archetype_slug is still NULL. Onboarding-magic
// and the App.tsx useEffect are the primary paths that populate the slug;
// this catches the workspaces that skip both (signed up without connecting
// FB, or whose profile text was too short when the useEffect ran).
//
// No-op when:
//   - archetype_slug already set (already classified)
//   - profile has < 30 chars in description AND productsServices (not enough
//     signal; the 3-layer classifier would just guess from businessType)
//
// Errors are swallowed — image-gen has a caption-based sniffer fallback for
// the NULL case, so post creation always succeeds even if classification
// fails. The UPDATE re-asserts `archetype_slug IS NULL` to swallow the rare
// race where two concurrent posts both kick off classification.
async function maybeAutoClassifyUserArchetype(env: Env, uid: string): Promise<void> {
  try {
    const row = await env.DB.prepare(
      `SELECT archetype_slug, profile FROM users WHERE id = ?`
    ).bind(uid).first<{ archetype_slug: string | null; profile: string | null }>();
    if (!row || row.archetype_slug) return;

    const profile: any = row.profile ? JSON.parse(row.profile) : {};
    const businessType = String(profile.type || '').trim();
    const description = String(profile.description || '').trim();
    const productsServices = String(profile.productsServices || '').trim();
    const contentTopics = String(profile.contentTopics || '').trim();

    if (description.length < 30 && productsServices.length < 30) {
      console.log(`[auto-classify] skipped for user=${uid} — profile too thin (desc=${description.length}, ps=${productsServices.length})`);
      return;
    }

    const fingerprint = [
      businessType && `Business type: ${businessType}`,
      description && `Description: ${description}`,
      productsServices && `Products/services: ${productsServices}`,
      contentTopics && `Content topics: ${contentTopics}`,
    ].filter(Boolean).join('\n');

    const result = await classifyArchetypeFromFingerprint(env, fingerprint);
    if ('error' in result) {
      console.warn(`[auto-classify] classifier failed for user=${uid}: ${result.error}`);
      return;
    }

    await env.DB.prepare(
      `UPDATE users SET archetype_slug = ?, archetype_confidence = ?, archetype_reasoning = ?, archetype_classified_at = ?
       WHERE id = ? AND archetype_slug IS NULL`
    ).bind(
      result.chosen.slug,
      result.chosen.confidence,
      `[auto on post-create] ${result.chosen.reasoning}`.slice(0, 400),
      new Date().toISOString(),
      uid,
    ).run();
    console.log(`[auto-classify] user=${uid} → "${result.chosen.slug}" (conf ${result.chosen.confidence.toFixed(2)})`);
  } catch (e: any) {
    console.warn(`[auto-classify] error for user=${uid}:`, e?.message || e);
  }
}

export function registerPostsRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/db/posts', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') ?? null;
    const { results } = clientId
      ? await c.env.DB.prepare('SELECT * FROM posts WHERE user_id = ? AND client_id = ? ORDER BY scheduled_for ASC').bind(uid, clientId).all()
      : await c.env.DB.prepare('SELECT * FROM posts WHERE user_id = ? AND client_id IS NULL ORDER BY scheduled_for ASC').bind(uid).all();
    const posts = results.map((r: Record<string, unknown>) => ({
      ...r,
      hashtags: r.hashtags ? JSON.parse(r.hashtags as string) : [],
    }));
    return c.json({ posts });
  });

  app.post('/api/db/posts', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json<Record<string, unknown>>();
    const id = uuid();
    // v5 columns (video_url, video_status, video_request_id, video_started_at,
    // video_error, r2_video_key, audio_mixed_url) added at the end so existing
    // rows + the bind order stay compatible. Frontend sends videoStatus='pending'
    // for video posts so the prewarm cron picks them up; everything else NULL.
    await c.env.DB.prepare(
      `INSERT INTO posts (id, user_id, client_id, content, platform, status, scheduled_for, hashtags, image_url, topic, pillar, late_post_id, image_prompt, reasoning, post_type, video_script, video_shots, video_mood, video_url, video_status, video_request_id, video_started_at, video_error, r2_video_key, audio_mixed_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, uid, body.clientId ?? null,
      body.content ?? '', body.platform ?? null, body.status ?? null,
      body.scheduledFor ?? null, JSON.stringify(body.hashtags ?? []),
      body.imageUrl ?? null, body.topic ?? null, body.pillar ?? null,
      body.latePostId ?? null, body.imagePrompt ?? null, body.reasoning ?? null,
      body.postType ?? null,
      typeof body.videoScript === 'string' ? body.videoScript : (body.videoScript ? JSON.stringify(body.videoScript) : null),
      typeof body.videoShots === 'string' ? body.videoShots : (body.videoShots ? JSON.stringify(body.videoShots) : null),
      body.videoMood ?? null,
      body.videoUrl ?? null, body.videoStatus ?? null, body.videoRequestId ?? null,
      body.videoStartedAt ?? null, body.videoError ?? null, body.r2VideoKey ?? null,
      body.audioMixedUrl ?? null
    ).run();

    // Own-workspace post + user has no archetype yet → fire a background
    // classification so the next post + the prewarm/publish crons see the
    // right archetype. Doesn't block the response. Skipped for client
    // posts; those are handled by /api/clients/:id/classify-business.
    if (!body.clientId) {
      c.executionCtx.waitUntil(maybeAutoClassifyUserArchetype(c.env, uid));
    }

    return c.json({ id });
  });

  app.put('/api/db/posts/:id', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const postId = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    const colMap: Record<string, string> = {
      content: 'content', platform: 'platform', status: 'status',
      scheduledFor: 'scheduled_for', hashtags: 'hashtags',
      imageUrl: 'image_url', topic: 'topic', pillar: 'pillar',
      latePostId: 'late_post_id', imagePrompt: 'image_prompt', reasoning: 'reasoning',
      postType: 'post_type', videoScript: 'video_script', videoShots: 'video_shots', videoMood: 'video_mood',
      // v5 — scheduled reels pipeline. videoUrl is populated by the prewarm cron;
      // the rest track lifecycle state so polling resumes across cron ticks.
      videoUrl: 'video_url', videoStatus: 'video_status', videoRequestId: 'video_request_id',
      videoStartedAt: 'video_started_at', videoError: 'video_error', r2VideoKey: 'r2_video_key',
      audioMixedUrl: 'audio_mixed_url',
    };
    for (const [k, col] of Object.entries(colMap)) {
      if (!(k in body)) continue;
      sets.push(`${col} = ?`);
      const v = body[k];
      if (k === 'hashtags') { vals.push(JSON.stringify(v ?? [])); }
      else if ((k === 'videoScript' || k === 'videoShots') && v && typeof v !== 'string') { vals.push(JSON.stringify(v)); }
      else { vals.push(v ?? null); }
    }
    if (sets.length) {
      vals.push(postId, uid);
      await c.env.DB.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals).run();
    }
    return c.json({ ok: true });
  });

  app.delete('/api/db/posts/:id', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const postId = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(postId, uid).run();
    return c.json({ ok: true });
  });

  // Delete all posts for the authenticated user (optionally scoped to a client)
  app.delete('/api/db/posts', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId');
    if (clientId) {
      await c.env.DB.prepare('DELETE FROM posts WHERE user_id = ? AND client_id = ?').bind(uid, clientId).run();
    } else {
      // Delete all posts for own workspace (no client_id) — match both NULL and empty string
      await c.env.DB.prepare('DELETE FROM posts WHERE user_id = ? AND (client_id IS NULL OR client_id = ?)').bind(uid, '').run();
    }
    return c.json({ ok: true });
  });

  // POST-based bulk delete (fallback for clients that don't support DELETE with no path param)
  app.post('/api/db/posts/delete-all', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const { clientId } = await c.req.json<{ clientId?: string | null }>();
    if (clientId) {
      await c.env.DB.prepare('DELETE FROM posts WHERE user_id = ? AND client_id = ?').bind(uid, clientId).run();
    } else {
      await c.env.DB.prepare('DELETE FROM posts WHERE user_id = ? AND (client_id IS NULL OR client_id = ?)').bind(uid, '').run();
    }
    return c.json({ ok: true });
  });

  // Bulk-update posts status (e.g. mark overdue as Missed)
  app.post('/api/db/posts/bulk-status', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const { ids, status } = await c.req.json<{ ids: string[]; status: string }>();
    if (!ids?.length) return c.json({ ok: true });
    const placeholders = ids.map(() => '?').join(', ');
    await c.env.DB.prepare(`UPDATE posts SET status = ? WHERE user_id = ? AND id IN (${placeholders})`).bind(status, uid, ...ids).run();
    return c.json({ ok: true });
  });

  // Client posts (limited, for health check)
  app.get('/api/db/posts/client-health', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId');
    if (!clientId) return c.json({ error: 'clientId required' }, 400);
    const { results } = await c.env.DB.prepare(
      'SELECT id, scheduled_for, status FROM posts WHERE user_id = ? AND client_id = ? ORDER BY scheduled_for DESC LIMIT 50'
    ).bind(uid, clientId).all();
    return c.json({ posts: results });
  });
}
