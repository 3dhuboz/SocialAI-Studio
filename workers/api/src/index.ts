import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyToken } from '@clerk/backend';

// ── D1 type shim (provided by Cloudflare runtime) ───────────────────────────
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<void>;
}

type Env = {
  OPENROUTER_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  DB: D1Database;
  LATE_API_KEY?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  FAL_API_KEY?: string;
  RUNWAY_API_KEY?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  RESEND_API_KEY?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return 'https://socialaistudio.au';
      const allowed = [
        'http://localhost:5173', 'http://localhost:5174',
        'https://socialaistudio.au',
        'https://social.picklenick.au', 'https://social.streetmeatzbbq.com.au',
        'https://social.hugheseysque.au', 'https://hugheseysque.au',
        'https://social.oconnoragriculture.com.au',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow all *.pages.dev subdomains (CF Pages preview/prod deployments)
      if (origin.endsWith('.pages.dev')) return origin;
      return 'https://socialaistudio.au';
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// ── Auth helper — verifies Clerk JWT or Portal token and returns userId ──────
async function getAuthUserId(req: Request, secretKey: string, jwtKey?: string, db?: D1Database): Promise<string | null> {
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

// ── UUID helper ──────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID();

app.get('/api/health', (c) => c.json({ ok: true, service: 'socialai-api' }));

// ── Facebook Graph API — direct publishing (replaces Late.dev) ───────────────
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

app.post('/api/facebook/publish', async (c) => {
  const { pageId, pageAccessToken, text, imageUrl, scheduledTime } = await c.req.json<{
    pageId: string; pageAccessToken: string; text: string;
    imageUrl?: string; scheduledTime?: number;
  }>();
  if (!pageId || !pageAccessToken || !text) return c.json({ error: 'pageId, pageAccessToken, and text required' }, 400);

  try {
    let fbUrl: string;
    const params: Record<string, string> = { access_token: pageAccessToken };

    if (imageUrl) {
      // Photo post — image URL + message
      fbUrl = `${FB_GRAPH}/${pageId}/photos`;
      params.url = imageUrl;
      params.message = text;
    } else {
      // Text-only post
      fbUrl = `${FB_GRAPH}/${pageId}/feed`;
      params.message = text;
    }

    if (scheduledTime) {
      params.scheduled_publish_time = String(scheduledTime);
      params.published = 'false';
    }

    const res = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) {
      return c.json({ error: data.error?.message || `Facebook API error (${res.status})` }, res.status as any);
    }
    return c.json({ id: data.id || data.post_id, success: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Facebook publish failed' }, 500);
  }
});

app.get('/api/facebook/posts', async (c) => {
  const pageId = c.req.query('pageId');
  const token = c.req.query('pageAccessToken');
  if (!pageId || !token) return c.json({ error: 'pageId and pageAccessToken required' }, 400);
  try {
    const res = await fetch(`${FB_GRAPH}/${pageId}/published_posts?fields=message,created_time,full_picture,permalink_url,likes.summary(true),comments.summary(true),shares&limit=30&access_token=${encodeURIComponent(token)}`);
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ posts: data.data || [] });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to fetch posts' }, 500);
  }
});

// ── Web Fetch — fetch a URL and return text content for AI research ──────────
app.post('/api/web-fetch', async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  if (!url || !url.startsWith('http')) return c.json({ error: 'Valid URL required' }, 400);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialAI-Research/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return c.json({ error: `HTTP ${res.status}` }, 502);
    const html = await res.text();
    // Strip HTML tags, scripts, styles — extract text content
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 8000); // Cap at 8K chars for AI context
    return c.json({ text, url });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to fetch URL' }, 502);
  }
});

/**
 * POST /api/ai/generate
 * Body: { prompt, systemPrompt?, temperature?, maxTokens?, responseFormat? }
 * responseFormat: 'json' | 'text' (default 'text')
 * Routes to OpenRouter — key never leaves the worker.
 */
app.post('/api/ai/generate', async (c) => {
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'OpenRouter API key not configured on worker.' }, 500);
  }

  let body: {
    prompt?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: 'json' | 'text';
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const {
    prompt,
    systemPrompt,
    temperature = 0.8,
    maxTokens = 2048,
    responseFormat = 'text',
  } = body;

  if (!prompt) {
    return c.json({ error: 'prompt is required.' }, 400);
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const orBody: Record<string, unknown> = {
    model: 'google/gemini-2.0-flash-001',
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseFormat === 'json') {
    orBody.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://socialai.studio',
      'X-Title': 'SocialAI Studio',
    },
    body: JSON.stringify(orBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('OpenRouter error:', response.status, errText);
    return c.json({ error: `OpenRouter error ${response.status}: ${errText}` }, response.status as 400 | 429 | 500);
  }

  const data = await response.json<{
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  }>();

  if (data.error) {
    return c.json({ error: data.error.message || 'OpenRouter returned an error.' }, 500);
  }

  const text = data.choices?.[0]?.message?.content ?? '';
  return c.json({ text });
});

// ── DB: User ─────────────────────────────────────────────────────────────────

app.get('/api/db/user', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
  return c.json({ user: row ?? null });
});

app.put('/api/db/user', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>();

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, plan, setup_status, is_admin, onboarding_done, intake_form_done,
        agency_billing_url, late_profile_id, late_connected_platforms, late_account_ids,
        fal_api_key, paypal_subscription_id, profile, stats, insight_report)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      uid,
      body.email ?? null, body.plan ?? null, body.setupStatus ?? null,
      body.isAdmin ? 1 : 0, body.onboardingDone ? 1 : 0, body.intakeFormDone ? 1 : 0,
      body.agencyBillingUrl ?? null, body.lateProfileId ?? null,
      JSON.stringify(body.lateConnectedPlatforms ?? []),
      JSON.stringify(body.lateAccountIds ?? {}),
      body.falApiKey ?? null, body.paypalSubscriptionId ?? null,
      JSON.stringify(body.profile ?? {}), JSON.stringify(body.stats ?? {}),
      body.insightReport ? JSON.stringify(body.insightReport) : null
    ).run();
  } else {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const fieldMap: Record<string, string> = {
      email: 'email', plan: 'plan', setupStatus: 'setup_status', isAdmin: 'is_admin',
      onboardingDone: 'onboarding_done', intakeFormDone: 'intake_form_done',
      agencyBillingUrl: 'agency_billing_url', lateProfileId: 'late_profile_id',
      lateConnectedPlatforms: 'late_connected_platforms', lateAccountIds: 'late_account_ids',
      falApiKey: 'fal_api_key', paypalSubscriptionId: 'paypal_subscription_id',
      profile: 'profile', stats: 'stats', insightReport: 'insight_report',
    };
    const jsonFields = new Set(['lateConnectedPlatforms', 'lateAccountIds', 'profile', 'stats', 'insightReport']);
    const boolFields = new Set(['isAdmin', 'onboardingDone', 'intakeFormDone']);
    for (const [k, col] of Object.entries(fieldMap)) {
      if (!(k in body)) continue;
      sets.push(`${col} = ?`);
      const v = body[k];
      if (jsonFields.has(k)) vals.push(v != null ? JSON.stringify(v) : null);
      else if (boolFields.has(k)) vals.push(v ? 1 : 0);
      else vals.push(v ?? null);
    }
    if (sets.length) {
      vals.push(uid);
      await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    }
  }
  return c.json({ ok: true });
});

app.delete('/api/db/user', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid).run();
  return c.json({ ok: true });
});

// ── DB: Posts ─────────────────────────────────────────────────────────────────

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
  await c.env.DB.prepare(
    `INSERT INTO posts (id, user_id, client_id, content, platform, status, scheduled_for, hashtags, image_url, topic, pillar, late_post_id, image_prompt, reasoning, post_type, video_script, video_shots, video_mood)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, uid, body.clientId ?? null,
    body.content ?? '', body.platform ?? null, body.status ?? null,
    body.scheduledFor ?? null, JSON.stringify(body.hashtags ?? []),
    body.imageUrl ?? null, body.topic ?? null, body.pillar ?? null,
    body.latePostId ?? null, body.imagePrompt ?? null, body.reasoning ?? null,
    body.postType ?? null,
    typeof body.videoScript === 'string' ? body.videoScript : (body.videoScript ? JSON.stringify(body.videoScript) : null),
    typeof body.videoShots === 'string' ? body.videoShots : (body.videoShots ? JSON.stringify(body.videoShots) : null),
    body.videoMood ?? null
  ).run();
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

// ── DB: Clients ───────────────────────────────────────────────────────────────

app.get('/api/db/clients', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
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
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
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
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>();
  const id = uuid();
  await c.env.DB.prepare(
    'INSERT INTO clients (id, user_id, name, business_type, created_at, plan) VALUES (?,?,?,?,?,?)'
  ).bind(id, uid, body.name ?? '', body.businessType ?? null, body.createdAt ?? new Date().toISOString(), body.plan ?? null).run();
  return c.json({ id });
});

app.put('/api/db/clients/:id', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const colMap: Record<string, string> = {
    name: 'name', businessType: 'business_type', plan: 'plan',
    profile: 'profile', stats: 'stats', insightReport: 'insight_report',
    lateProfileId: 'late_profile_id', lateConnectedPlatforms: 'late_connected_platforms',
    lateAccountIds: 'late_account_ids', clientSlug: 'client_slug',
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
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM posts WHERE user_id = ? AND client_id = ?').bind(uid, clientId).run();
  await c.env.DB.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).run();
  return c.json({ ok: true });
});

// ── DB: Social Tokens ─────────────────────────────────────────────────────────
// Stored in dedicated column — never mixed into profile blob, never cached client-side

app.get('/api/db/social-tokens', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.query('clientId') ?? null;
  const raw = clientId
    ? await c.env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<{ social_tokens: string | null }>()
    : await c.env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(uid).first<{ social_tokens: string | null }>();
  const tokens = raw?.social_tokens ? JSON.parse(raw.social_tokens) : {};
  return c.json({ tokens });
});

app.put('/api/db/social-tokens', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.query('clientId') ?? null;
  const body = await c.req.json<Record<string, unknown>>();
  const json = JSON.stringify(body);
  if (clientId) {
    await c.env.DB.prepare('UPDATE clients SET social_tokens = ? WHERE id = ? AND user_id = ?').bind(json, clientId, uid).run();
  } else {
    await c.env.DB.prepare('UPDATE users SET social_tokens = ? WHERE id = ?').bind(json, uid).run();
  }
  return c.json({ ok: true });
});

// ── DB: Portal ────────────────────────────────────────────────────────────────

// Public — returns portal token for client-mode auth (no Clerk needed).
// password intentionally excluded — only portal_token is needed for API auth.
app.get('/api/db/portal/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  const row = await c.env.DB.prepare(
    'SELECT email, portal_token, user_id, client_id FROM portal WHERE slug = ?'
  ).bind(slug).first<{ email: string; portal_token: string | null; user_id: string | null; client_id: string | null }>();
  return c.json({ portal: row ?? null });
});

app.put('/api/db/portal/:slug', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const slug = c.req.param('slug').toLowerCase();
  const body = await c.req.json<{ email: string; password: string; client_id?: string }>();
  const portalToken = crypto.randomUUID() + '-' + crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO portal (slug, email, password, portal_token, user_id, client_id)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(slug) DO UPDATE SET email=excluded.email, password=excluded.password,
       portal_token=excluded.portal_token, user_id=excluded.user_id, client_id=excluded.client_id`
  ).bind(slug, body.email, body.password, portalToken, uid, body.client_id ?? null).run();
  return c.json({ ok: true, portalToken });
});

// ── DB: Activations / Cancellations ──────────────────────────────────────────

app.get('/api/db/activations', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const email = c.req.query('email') ?? null;
  const byUid = await c.env.DB.prepare('SELECT * FROM pending_activations WHERE id = ? AND consumed = 0').bind(uid).first();
  const byEmail = email ? await c.env.DB.prepare('SELECT * FROM pending_activations WHERE email = ? AND consumed = 0').bind(email).first() : null;
  const row = byUid ?? byEmail ?? null;
  return c.json({ activation: row });
});

app.put('/api/db/activations/:id/consume', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE pending_activations SET consumed = 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.get('/api/db/cancellations', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const email = c.req.query('email') ?? null;
  const byUid = await c.env.DB.prepare('SELECT * FROM pending_cancellations WHERE id = ? AND consumed = 0').bind(uid).first();
  const byEmail = email ? await c.env.DB.prepare('SELECT * FROM pending_cancellations WHERE email = ? AND consumed = 0').bind(email).first() : null;
  const row = byUid ?? byEmail ?? null;
  return c.json({ cancellation: row });
});

app.put('/api/db/cancellations/:id/consume', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE pending_cancellations SET consumed = 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ── Internal: Create pending activation (called from Pages Function PayPal webhook) ──
// No Clerk auth — protected by the fact it only creates "pending" rows,
// which require a valid authenticated user to consume.
app.post('/api/internal/activation', async (c) => {
  const { plan, email, paypalSubscriptionId, paypalCustomerId, activatedAt } = await c.req.json<Record<string, string>>();
  if (!plan || !email) return c.json({ error: 'plan and email required' }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
     VALUES (?,?,?,?,?,?,0)`
  ).bind(id, plan, email, paypalSubscriptionId ?? null, paypalCustomerId ?? null, activatedAt ?? new Date().toISOString()).run();
  return c.json({ ok: true, id });
});

app.post('/api/internal/cancellation', async (c) => {
  const { email, paypalSubscriptionId, cancelledAt } = await c.req.json<Record<string, string>>();
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO pending_cancellations (id, email, paypal_subscription_id, cancelled_at, consumed)
     VALUES (?,?,?,?,0)`
  ).bind(id, email ?? null, paypalSubscriptionId ?? null, cancelledAt ?? new Date().toISOString()).run();
  return c.json({ ok: true, id });
});

// ── OpenRouter Stats ──────────────────────────────────────────────────────────
app.get('/api/ai/stats', async (c) => {
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);
  try {
    const [keyRes, creditsRes] = await Promise.allSettled([
      fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${apiKey}` } }),
      fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${apiKey}` } }),
    ]);
    let keyData: any = null;
    if (keyRes.status === 'fulfilled' && keyRes.value.ok) { try { keyData = await keyRes.value.json(); } catch {} }
    let creditsData: any = null;
    if (creditsRes.status === 'fulfilled' && creditsRes.value.ok) { try { creditsData = await creditsRes.value.json(); } catch {} }
    return c.json({
      ok: true,
      label: keyData?.data?.label ?? null,
      isFreeTier: keyData?.data?.is_free_tier ?? false,
      usage: keyData?.data?.usage ?? null,
      limit: keyData?.data?.limit ?? null,
      limitRemaining: keyData?.data?.limit_remaining ?? null,
      rateLimit: keyData?.data?.rate_limit ?? null,
      totalCredits: creditsData?.data?.total_credits ?? null,
      totalUsage: creditsData?.data?.total_usage ?? null,
      model: 'google/gemini-2.0-flash-001',
      provider: 'OpenRouter',
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch OpenRouter stats' }, 500);
  }
});

// ── Late API Proxy ─────────────────────────────────────────────────────────────
// Match both /api/late-proxy (query-param based) and /api/late-proxy/* (path based)
app.all('/api/late-proxy', async (c) => {
  // Forward to the Pages Function logic — query-param based actions
  // This handler exists so portal builds (which route through the worker) can reach Late
  const apiKey = c.env.LATE_API_KEY;
  if (!apiKey) return c.json({ error: 'LATE_API_KEY not configured' }, 500);
  const url = new URL(c.req.url);
  const action = url.searchParams.get('action');
  if (!action) return c.json({ error: 'action query param required' }, 400);

  const LATE_BASE = 'https://getlate.dev/api/v1';
  const authHeader = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const getBody = async () => { try { return await c.req.json(); } catch { return {}; } };

  if (action === 'connect-url') {
    const profileId = url.searchParams.get('profileId');
    const platform = url.searchParams.get('platform') || 'facebook';
    const redirectUrl = url.searchParams.get('redirectUrl') || '';
    if (!profileId) return c.json({ error: 'profileId required' }, 400);
    const params = new URLSearchParams({ profileId, redirect_url: redirectUrl });
    const res = await fetch(`${LATE_BASE}/connect/${platform}?${params}`, { headers: authHeader });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'create-profile') {
    const { title } = await getBody() as any;
    const res = await fetch(`${LATE_BASE}/profiles`, { method: 'POST', headers: authHeader, body: JSON.stringify({ name: title || 'SocialAI Client' }) });
    const data = await res.json() as any;
    if (data.profile) data.id = data.profile._id;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'list-profiles') {
    const res = await fetch(`${LATE_BASE}/profiles`, { headers: authHeader });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'list-accounts' || action === 'get-accounts') {
    const profileId = url.searchParams.get('profileId');
    const accountsUrl = profileId ? `${LATE_BASE}/accounts?profileId=${encodeURIComponent(profileId)}` : `${LATE_BASE}/accounts`;
    const res = await fetch(accountsUrl, { headers: authHeader });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'list-pages') {
    const connectToken = url.searchParams.get('connectToken');
    if (!connectToken) return c.json({ error: 'connectToken required' }, 400);
    const res = await fetch(`${LATE_BASE}/connect/facebook/pages`, { headers: { ...authHeader, 'X-Connect-Token': connectToken } });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'select-page') {
    const { connectToken, pageId } = await getBody() as any;
    if (!connectToken || !pageId) return c.json({ error: 'connectToken and pageId required' }, 400);
    const res = await fetch(`${LATE_BASE}/connect/facebook/select-page`, { method: 'POST', headers: { ...authHeader, 'X-Connect-Token': connectToken }, body: JSON.stringify({ pageId }) });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'post') {
    const body = await getBody() as any;
    const { profileId, platforms, text, mediaUrls, scheduleDate, mediaItems, accountIds } = body;
    if (!platforms?.length || !text) return c.json({ error: 'platforms and text are required' }, 400);
    const requestedPlatforms = platforms.map((p: string) => p.toLowerCase());
    let platformObjs: any[] = [];
    if (accountIds && typeof accountIds === 'object') {
      platformObjs = requestedPlatforms.filter((p: string) => accountIds[p]).map((p: string) => ({ platform: p, accountId: accountIds[p] }));
    }
    if (platformObjs.length === 0 && profileId) {
      try {
        const filteredRes = await fetch(`${LATE_BASE}/accounts?profileId=${profileId}`, { headers: authHeader });
        if (filteredRes.ok) {
          const filteredData = await filteredRes.json() as any;
          const filteredAccounts = filteredData.accounts || filteredData || [];
          if (Array.isArray(filteredAccounts) && filteredAccounts.length > 0) {
            platformObjs = requestedPlatforms.map((p: string) => {
              const acc = filteredAccounts.find((a: any) => (a.platform || '').toLowerCase() === p);
              const accId = acc?._id || acc?.id || acc?.accountId;
              return acc && accId ? { platform: p, accountId: accId } : null;
            }).filter(Boolean);
          }
        }
      } catch {}
    }
    if (platformObjs.length === 0) return c.json({ error: 'Could not determine which page to post to.' }, 422);
    const postBody = {
      content: text, platforms: platformObjs,
      ...(profileId ? { profileId } : {}),
      ...(scheduleDate ? { scheduledFor: scheduleDate, timezone: 'UTC' } : { publishNow: true }),
      ...(mediaItems?.length ? { mediaItems } : mediaUrls?.length ? { mediaUrls } : {}),
    };
    const res = await fetch(`${LATE_BASE}/posts`, { method: 'POST', headers: authHeader, body: JSON.stringify(postBody) });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || data?.error || `Late API HTTP ${res.status}` }, res.status as any);
    return c.json(data, { status: res.status as any });
  }
  if (action === 'profile-info') {
    const profileId = url.searchParams.get('profileId');
    if (!profileId) return c.json({ error: 'profileId required' }, 400);
    const res = await fetch(`${LATE_BASE}/profiles/${profileId}`, { headers: authHeader });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'analytics') {
    const profileId = url.searchParams.get('profileId');
    if (!profileId) return c.json({ error: 'profileId required' }, 400);
    const res = await fetch(`${LATE_BASE}/analytics?profileId=${profileId}`, { headers: authHeader });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'media-presign') {
    const { fileName, fileType } = await getBody() as any;
    if (!fileName || !fileType) return c.json({ error: 'fileName and fileType required' }, 400);
    // Late.dev API expects 'filename' (lowercase) and 'contentType' (not 'fileType')
    const res = await fetch(`${LATE_BASE}/media/presign`, { method: 'POST', headers: authHeader, body: JSON.stringify({ filename: fileName, contentType: fileType }) });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'list-posts') {
    const profileId = url.searchParams.get('profileId');
    const limit = url.searchParams.get('limit') || '30';
    if (!profileId) return c.json({ error: 'profileId required' }, 400);
    const res = await fetch(`${LATE_BASE}/profiles/${profileId}/posts?limit=${limit}&status=published`, { headers: authHeader });
    return c.json(await res.json() as any, { status: res.status as any });
  }
  if (action === 'get-credits') {
    const res = await fetch(`${LATE_BASE}/user/me`, { headers: authHeader });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    return c.json({ credits: data?.credits ?? null, plan: data?.plan ?? null, raw: data });
  }
  return c.json({ error: `Unknown action: ${action}` }, 400);
});

app.all('/api/late-proxy/*', async (c) => {
  const apiKey = c.env.LATE_API_KEY;
  if (!apiKey) return c.json({ error: 'LATE_API_KEY not configured' }, 500);

  const path = c.req.path.replace('/api/late-proxy', '');
  const url = `https://getlate.dev/api/v1${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const res = await fetch(url, { method, headers, body });
  const data = await res.json();
  return c.json(data, { status: res.status as any });
});

// ── Facebook Token Exchange ───────────────────────────────────────────────────────
app.post('/api/facebook-exchange-token', async (c) => {
  const appId = c.env.FACEBOOK_APP_ID;
  const appSecret = c.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return c.json({ error: 'Facebook app credentials not configured' }, 500);

  const { access_token } = await c.req.json();
  if (!access_token) return c.json({ error: 'access_token is required' }, 400);

  // Exchange short-lived token for long-lived token
  const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${access_token}`;
  const exchangeRes = await fetch(exchangeUrl);
  const exchangeData = await exchangeRes.json() as any;
  if (!exchangeData.access_token) return c.json({ error: 'Failed to exchange token' }, 400);

  // Get page access tokens
  const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?access_token=${exchangeData.access_token}`;
  const pagesRes = await fetch(pagesUrl);
  const pagesData = await pagesRes.json() as any;

  return c.json({
    longLivedUserToken: exchangeData.access_token,
    expiresInSeconds: exchangeData.expires_in,
    pages: pagesData.data || [],
  });
});

// ── fal.ai Proxy (query-param based — matches Pages Function pattern) ────────
app.all('/api/fal-proxy', async (c) => {
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 401);
  const url = new URL(c.req.url);
  const action = url.searchParams.get('action');
  const authHeader = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };

  if (action === 'generate-image' && c.req.method === 'POST') {
    const { prompt } = await c.req.json() as any;
    if (!prompt) return c.json({ error: 'prompt is required' }, 400);
    const res = await fetch('https://fal.run/fal-ai/flux/dev', {
      method: 'POST', headers: authHeader,
      body: JSON.stringify({ prompt, image_size: 'square_hd', num_inference_steps: 25, num_images: 1, enable_safety_checker: true, guidance_scale: 3.5 }),
    });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
    return c.json({ imageUrl: data?.images?.[0]?.url || null });
  }
  if (action === 'generate-video' && c.req.method === 'POST') {
    const { promptText, promptImage, duration = 5 } = await c.req.json() as any;
    if (!promptImage) return c.json({ error: 'promptImage is required' }, 400);
    const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
      method: 'POST', headers: authHeader,
      body: JSON.stringify({ prompt: promptText || 'cinematic, smooth motion', image_url: promptImage, duration: String(duration), aspect_ratio: '9:16' }),
    });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
    return c.json({ requestId: data.request_id, statusUrl: data.status_url || null, responseUrl: data.response_url || null });
  }
  if (action === 'task-status') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/${requestId}/status`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'task-result') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/${requestId}`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'get-credits') {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    return c.json({ balance: data?.balance ?? data?.credits ?? null });
  }
  if (action === 'check-credits-alert') {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    const balance = data?.balance ?? data?.credits ?? null;
    const threshold = 5;
    const resendKey = c.env.RESEND_API_KEY;
    if (balance !== null && balance < threshold && resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'SocialAI Studio <noreply@socialaistudio.au>',
          to: 'steve@3dhub.au',
          subject: `fal.ai Credits Low — $${typeof balance === 'number' ? balance.toFixed(2) : balance} remaining`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out. Top up now to keep your posts looking great.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a><p style="color:#888;font-size:12px;margin-top:20px;">This alert triggers when balance drops below $${threshold}.</p></div>`,
        }),
      });
      return c.json({ balance, alert: 'sent', threshold });
    }
    return c.json({ balance, alert: balance !== null && balance < threshold ? 'no_resend_key' : 'not_needed', threshold });
  }
  return c.json({ error: `Unknown action: ${action}` }, 400);
});

// ── fal.ai Proxy (path-based passthrough) ───────────────────────────────────
app.all('/api/fal-proxy/*', async (c) => {
  const path = c.req.path.replace('/api/fal-proxy', '');
  const url = `https://api.fal.ai${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;
  
  // Get key from Authorization header or fallback to env var
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '') || c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key required' }, 401);

  const headers = { 
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return c.json(data as any, { status: res.status as any });
  }
  const text = await res.text();
  return c.body(text, { status: res.status as any });
});

// ── Runway Proxy ───────────────────────────────────────────────────────────────
app.all('/api/runway-proxy/*', async (c) => {
  const path = c.req.path.replace('/api/runway-proxy', '');
  const url = `https://api.runwayml.com/v1${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;
  
  // Get key from Authorization header or fallback to env var
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '') || c.env.RUNWAY_API_KEY;
  if (!apiKey) return c.json({ error: 'Runway API key required' }, 401);

  const headers = { 
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return c.json(data as any, { status: res.status as any });
  }
  const text = await res.text();
  return c.body(text, { status: res.status as any });
});

// ── PayPal Verify ───────────────────────────────────────────────────────────────
// Called by the frontend after PayPal checkout completes.
// Verifies with PayPal that the subscription is active, then stores a pending
// activation record. Uses INSERT OR IGNORE so a webhook-created record wins.
app.post('/api/paypal-verify', async (c) => {
  const clientId = c.env.PAYPAL_CLIENT_ID;
  const clientSecret = c.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: 'PayPal credentials not configured' }, 500);

  const { subscriptionId, uid, planId } = await c.req.json();
  if (!subscriptionId || !planId) return c.json({ error: 'Missing subscriptionId or planId' }, 400);

  // Get PayPal access token
  const creds = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) return c.json({ error: 'Failed to get PayPal token' }, 500);

  // Get subscription details from PayPal
  const subRes = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!subRes.ok) return c.json({ error: 'Failed to fetch subscription from PayPal' }, 500);
  const subscription = await subRes.json() as any;

  if (subscription.status !== 'ACTIVE') {
    return c.json({
      error: `Subscription not yet active (status: ${subscription.status}). Please wait a moment and try again.`,
    }, 400);
  }

  // Warn if the claimed planId doesn't match the PayPal subscription's actual plan.
  // We can't fully validate here without the plan ID mapping, but we log the discrepancy.
  const paypalPlanId = subscription.plan_id;
  if (paypalPlanId) {
    console.log(`PayPal verify: claimed planId=${planId}, subscription plan_id=${paypalPlanId}`);
  }

  const customerEmail = subscription.subscriber?.email_address || '';
  const payerId = subscription.subscriber?.payer_id || '';
  const docId = uid || customerEmail || subscriptionId;

  // INSERT OR IGNORE: webhook may have already inserted the authoritative record.
  // Do not overwrite it — the webhook-set plan is trusted over the client-claimed planId.
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO pending_activations
    (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    docId,
    planId,
    customerEmail,
    subscriptionId,
    payerId,
    new Date().toISOString(),
    0
  ).run();

  console.log(`PayPal activation stored for ${docId} → plan: ${planId}`);
  return c.json({ success: true, plan: planId });
});

// NOTE: PayPal webhook is handled by the Cloudflare Pages Function at
// functions/api/paypal-webhook.js — do not duplicate it here.

// ── Cron Trigger: Check fal.ai credits every 6 hours ────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const apiKey = env.FAL_API_KEY;
    const resendKey = env.RESEND_API_KEY;
    if (!apiKey || !resendKey) { console.log('[CRON] Missing FAL_API_KEY or RESEND_API_KEY'); return; }

    try {
      const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
      const data = await res.json() as any;
      const balance = data?.balance ?? data?.credits ?? null;
      console.log(`[CRON] fal.ai balance: $${balance}`);

      const threshold = 5;
      if (balance !== null && balance < threshold) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'SocialAI Studio <noreply@socialaistudio.au>',
            to: 'steve@3dhub.au',
            subject: `fal.ai Credits Low — $${typeof balance === 'number' ? balance.toFixed(2) : balance} remaining`,
            html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out. Top up now to keep your posts looking great.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a><p style="color:#888;font-size:12px;margin-top:20px;">This alert triggers when balance drops below $${threshold}. Checked every 6 hours.</p></div>`,
          }),
        });
        console.log(`[CRON] Low balance alert sent to steve@3dhub.au ($${balance})`);
      }
    } catch (e: any) {
      console.error('[CRON] Credit check failed:', e.message);
    }
  },
};
