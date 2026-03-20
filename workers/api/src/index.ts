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
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://socialaistudio.au', 'https://*.pages.dev', 'https://social.picklenick.au', 'https://social.streetmeatzbbq.com.au', 'https://hugheseysque.au'],
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
    body.postType ?? null, body.videoScript ?? null, body.videoShots ?? null, body.videoMood ?? null
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
    vals.push(k === 'hashtags' ? JSON.stringify(body[k] ?? []) : body[k] ?? null);
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

// Public — returns portal token for client-mode auth (no Clerk needed)
app.get('/api/db/portal/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  const row = await c.env.DB.prepare(
    'SELECT email, password, portal_token, user_id, client_id FROM portal WHERE slug = ?'
  ).bind(slug).first<{ email: string; password: string; portal_token: string | null; user_id: string | null; client_id: string | null }>();
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
    `INSERT INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
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

// ── Late API Proxy ─────────────────────────────────────────────────────────────
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

// ── fal.ai Proxy ────────────────────────────────────────────────────────────────
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
  const data = res.headers.get('content-type')?.includes('application/json') 
    ? await res.json() 
    : await res.text();
  
  return c.body(String(data), { status: res.status as any });
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
  const data = res.headers.get('content-type')?.includes('application/json') 
    ? await res.json() 
    : await res.text();
  
  return c.body(String(data), { status: res.status as any });
});

// ── PayPal Verify ───────────────────────────────────────────────────────────────
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

  // Get subscription details
  const subRes = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  const subscription = await subRes.json() as any;

  if (subscription.status !== 'ACTIVE') {
    return c.json({
      error: `Subscription not yet active (status: ${subscription.status}). Please wait a moment and try again.`,
    }, 400);
  }

  const customerEmail = subscription.subscriber?.email_address || '';
  const payerId = subscription.subscriber?.payer_id || '';
  const docId = uid || customerEmail || subscriptionId;

  // Store in D1 pending_activations
  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO pending_activations 
    (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    docId,
    planId,
    customerEmail,
    subscriptionId,
    payerId,
    new Date().toISOString(),
    false
  ).run();

  console.log(`PayPal activation stored for ${docId} → plan: ${planId}`);
  return c.json({ success: true, plan: planId });
});

// ── PayPal Webhook ───────────────────────────────────────────────────────────────
app.post('/api/paypal-webhook', async (c) => {
  const clientId = c.env.PAYPAL_CLIENT_ID;
  const clientSecret = c.env.PAYPAL_CLIENT_SECRET;
  const webhookId = c.env.PAYPAL_WEBHOOK_ID;
  if (!clientId || !clientSecret || !webhookId) return c.json({ error: 'PayPal webhook not configured' }, 500);

  // Get PayPal token for webhook verification
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

  // Verify webhook signature
  const headers = c.req.raw.headers;
  const verifyBody = {
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: await c.req.json(),
  };

  const verifyRes = await fetch('https://api-m.paypal.com/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verifyBody),
  });
  const verifyData = await verifyRes.json() as any;

  if (verifyData.verification_status !== 'SUCCESS') {
    return c.json({ error: 'Webhook signature verification failed' }, 400);
  }

  const event = verifyBody.webhook_event;
  const eventType = event.event_type;

  // Handle subscription events
  if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscription = event.resource;
    const customerEmail = subscription.subscriber?.email_address || '';
    const subscriptionId = subscription.id;

    // Find matching pending activation by subscription ID or email
    const existing = await c.env.DB.prepare(`
      SELECT * FROM pending_activations 
      WHERE paypal_subscription_id = ? OR email = ?
    `).bind(subscriptionId, customerEmail).first();

    if (existing) {
      // Update user plan in D1
      const userId = existing.id;
      await c.env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?')
        .bind(existing.plan, userId).run();
      
      // Mark activation as consumed
      await c.env.DB.prepare('UPDATE pending_activations SET consumed = 1 WHERE id = ?')
        .bind(existing.id).run();

      console.log(`PayPal webhook activated plan ${existing.plan} for user ${userId}`);
    }
  }
  else if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
    const subscription = event.resource;
    const customerEmail = subscription.subscriber?.email_address || '';

    // Store cancellation for client to handle
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO pending_cancellations 
      (id, email, paypal_subscription_id, cancelled_at, consumed) 
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      uuid(),
      customerEmail,
      subscription.id,
      new Date().toISOString(),
      false
    ).run();

    console.log(`PayPal webhook stored cancellation for ${customerEmail}`);
  }

  return c.json({ received: true });
});

export default app;
