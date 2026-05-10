import { Hono, Context } from 'hono';
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
  FACTS_BOOTSTRAP_SECRET?: string;
  // Phase B portal automation — when these are set, the provision endpoint
  // also creates the CF Pages project and attaches the custom domain.
  // Without them, those steps stay as manual instructions in the response.
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  // Optional shared values used by the CF Pages source config — defaults
  // are baked in below if not set.
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
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
        // Additional whitelabel portal origins
        'https://social.gladstonebbq.com.au', 'https://social.blackcat.com.au',
        'https://social.jonesysgarage.com.au', 'https://social.jenniannesjewels.com.au',
        'https://littlestomp.com.au', 'https://www.littlestomp.com.au',
        'https://streetmeatzbbq.com.au', 'https://www.streetmeatzbbq.com.au',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow all *.pages.dev subdomains (CF Pages preview/prod deployments)
      if (origin.endsWith('.pages.dev')) return origin;
      return 'https://socialaistudio.au';
    },
    // X-Portal-Secret is sent by whitelabel portal frontends to authenticate
    // their slug-based portal lookup. Without this, browser preflight blocks
    // the request and the portal shows "Portal not configured".
    allowHeaders: ['Content-Type', 'Authorization', 'X-Portal-Secret', 'X-Bootstrap-Secret'],
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

// ── Image prompt safety helper ───────────────────────────────────────────────
// Used by all server-side fal.ai FLUX entry points (backfillImagesForUser,
// the publish-cron JIT image gen, and the image pre-warm cron). Mirrors the
// validation logic in src/services/gemini.ts (generateMarketingImage /
// generateMarketingImageUrl). Catches three failure modes the bare prompt
// has historically tripped on:
//
//   1. People in the image — AI faces always look fake (strips human nouns)
//   2. UI/chart/pricing-table prompts — e.g. SaaS promo posts that the AI
//      interpreted as "render the pricing UI", producing a blurry mockup
//      (real regression: Penny Wise SocialAI promo post 2026-05). Swaps the
//      offending prompt for a neutral photographable scene.
//   3. Generic "marketing graphic" FLUX output — adds a wide UI/chart/
//      infographic negative list to the suffix as a last-line defense.
//
// Returns null if the prompt is too short to be useful — caller should skip.
function buildSafeImagePrompt(rawPrompt: string | null | undefined): string | null {
  const prompt = (rawPrompt || '').trim();
  if (!prompt || prompt.length < 5) return null;

  // If the AI's prompt is primarily describing a digital interface, chart,
  // or comparison grid, FLUX will render a blurry pricing-table mockup that
  // sells nothing. Swap to a neutral real-world scene instead.
  const isAbstractUI = /\b(pricing|tier|plan|comparison|dashboard|UI|interface|app screen|infographic|diagram|chart|graph|table|mockup|wireframe|column|grid|landing page|website screenshot|screenshot|logo design|3D render|illustration)\b/i.test(prompt);
  const safeBase = isAbstractUI
    ? 'calm tidy desk with morning daylight, plant and open notebook beside closed laptop, real-world wear and texture'
    : prompt;

  const cleaned = safeBase
    .replace(/\b(woman|women|man|men|person|people|portrait|face|faces|facial|smiling|smile|looking|standing|sitting|holding|posing|gazing|wearing|chef|farmer|barista|customer|owner|team|staff|employee|worker|girl|boy|lady|guy|couple|family|child|children|hand|hands|finger|fingers|happy|customers|interior shot)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleaned || safeBase}, candid iPhone photo taken at the venue, natural daylight, slightly imperfect framing, real-world wear and texture, 1:1 square format, no studio lighting, no over-styled food, no excessive steam or smoke, no glossy plastic reflections, no text, no watermarks, no people, no faces, no hands, no UI, no app screens, no dashboards, no charts, no graphs, no tables, no infographics, no diagrams, no pricing tiers, no comparison grids, no landing pages, no marketing graphics, no logo, no illustration`;
}

// ── Admin gate ───────────────────────────────────────────────────────────────
// Resolves the caller's Clerk uid, looks up users.is_admin, returns either
// { uid, email } or a 401/403 Response. Endpoints use:
//
//   const adminCheck = await requireAdmin(c);
//   if (adminCheck instanceof Response) return adminCheck;
//
// is_admin is set on the user row when their email matches CLIENT.adminEmails
// at sign-in time (see App.tsx line ~437), so this gate is consistent with the
// frontend's "admin mode" detection.
async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<{ uid: string; email: string | null } | Response> {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    'SELECT email, is_admin FROM users WHERE id = ?'
  ).bind(uid).first<{ email: string | null; is_admin: number }>();
  if (!row || !row.is_admin) return c.json({ error: 'Forbidden' }, 403);
  return { uid, email: row.email };
}

// ── Plan price source-of-truth (KEEP IN SYNC WITH src/client.config.ts) ──────
// MRR computation needs to know the monthly price per plan. Mirror the
// frontend's CLIENT.plans[].price values here. If you change a plan price
// in the frontend, also change it here.
const PLAN_PRICE_AUD: Record<string, number> = {
  starter: 29,
  growth: 49,
  pro: 79,
  agency: 149,
};

// ── Business-rule: posts for on-hold clients must NEVER be claimed by the cron.
// This filter has been reverted twice in the past when the SQL was inline; keep
// it named and centralised so any future cron query can include it explicitly.
// Append to a WHERE clause: ` AND ${ACTIVE_CLIENT_FILTER}` (no leading AND).
const ACTIVE_CLIENT_FILTER =
  `(client_id IS NULL OR client_id NOT IN (SELECT id FROM clients WHERE status = 'on_hold'))`;

// ── Rate limiter (D1-backed sliding window).
// Returns true if the caller is OVER the limit (i.e. the request should be blocked),
// false if the request is allowed.
async function isRateLimited(
  db: D1Database, key: string, maxPerMinute: number,
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

app.get('/api/health', (c) => c.json({ ok: true, service: 'socialai-api' }));

// Cron observability — last 30 cron runs (public so the deploy-monitor widget
// can poll without an auth token; emits no PII).
app.get('/api/cron-health', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT run_at, cron_type, success, posts_processed, duration_ms,
            substr(COALESCE(error,''),1,200) as error
     FROM cron_runs ORDER BY run_at DESC LIMIT 30`
  ).all();
  const runs = rows.results ?? [];
  const lastSuccess = runs.find((r: any) => r.success === 1);
  const lastFailure = runs.find((r: any) => r.success === 0);
  return c.json({
    runs,
    last_success_at: (lastSuccess as any)?.run_at ?? null,
    last_failure_at: (lastFailure as any)?.run_at ?? null,
  });
});


// Public post schedule feed — used by deploy monitor widget
app.get('/api/post-schedule', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.scheduled_for, p.status, p.platform,
            substr(p.content, 1, 80) as preview,
            COALESCE(c.name, 'Penny Wise I.T') as workspace
     FROM posts p LEFT JOIN clients c ON p.client_id = c.id
     WHERE p.status IN ('Scheduled','Posted','Missed')
       AND p.scheduled_for >= date('now','-1 day')
     ORDER BY p.scheduled_for ASC LIMIT 30`
  ).all();
  return c.json({ posts: rows.results ?? [] });
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

  // AUTH GATE — require Clerk JWT or Portal token. Stops anonymous abuse of OpenRouter credits.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);

  // RATE LIMIT — 30 generations per minute per user.
  if (await isRateLimited(c.env.DB, `ai:${uid}`, 30)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

  let body: {
    prompt?: string;
    systemPrompt?: string;
    /** Optional static prefix to send with cache_control (Anthropic prompt caching).
     * If supplied AND the model is an Anthropic one AND the prefix is large enough
     * (~1024+ tokens), Anthropic caches the block for 5 min and bills the rest at
     * a 90% discount on cache hits. Use for the GOLDEN RULES + ground-truth blocks
     * that repeat across every Smart Schedule call. */
    cachedPrefix?: string;
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
    cachedPrefix,
    temperature = 0.8,
    maxTokens = 2048,
    responseFormat = 'text',
  } = body;

  if (!prompt) {
    return c.json({ error: 'prompt is required.' }, 400);
  }

  const requestedModel = (body as any).model as string | undefined;
  const effectiveModel = requestedModel || 'anthropic/claude-haiku-4.5';
  const useAnthropicCaching = !!cachedPrefix && effectiveModel.startsWith('anthropic/');

  // Build messages with optional Anthropic-style cache_control on the prefix.
  // OpenRouter passes cache_control through to Anthropic verbatim.
  const messages: Array<{ role: string; content: any }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (useAnthropicCaching) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: prompt },
      ],
    });
  } else {
    const combined = cachedPrefix ? `${cachedPrefix}\n\n${prompt}` : prompt;
    messages.push({ role: 'user', content: combined });
  }

  // Model is selectable per-request via body.model. Defaults to Claude Haiku
  // for content generation — significantly better instruction-following and
  // hallucination resistance than Gemini Flash, ~3-5x more expensive but still
  // pennies per Smart Schedule. Gemini still available as a cheap fallback for
  // low-stakes calls (e.g. best-times tips) by passing model in the body.
  const orBody: Record<string, unknown> = {
    model: effectiveModel,
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

// ── DB: Campaigns ────────────────────────────────────────────────────────────

app.get('/api/db/campaigns', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.query('clientId') ?? null;
  const rows = clientId
    ? await c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id = ? AND client_id = ? ORDER BY start_date ASC').bind(uid, clientId).all()
    : await c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id = ? AND client_id IS NULL ORDER BY start_date ASC').bind(uid).all();
  return c.json({ campaigns: rows.results ?? [] });
});

app.post('/api/db/campaigns', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ clientId?: string; name: string; type?: string; startDate?: string; endDate?: string; rules?: string; postsPerDay?: number; enabled?: boolean }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, user_id, client_id, name, type, start_date, end_date, rules, posts_per_day, enabled)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, uid, body.clientId ?? null, body.name, body.type ?? 'custom', body.startDate ?? null, body.endDate ?? null, body.rules ?? '', body.postsPerDay ?? 1, body.enabled !== false ? 1 : 0).run();
  return c.json({ id });
});

app.put('/api/db/campaigns/:id', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const campaignId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const fieldMap: Record<string, string> = { name: 'name', type: 'type', startDate: 'start_date', endDate: 'end_date', rules: 'rules', imageNotes: 'image_notes', postsPerDay: 'posts_per_day', enabled: 'enabled' };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, col] of Object.entries(fieldMap)) {
    if (body[k] !== undefined) { sets.push(`${col} = ?`); vals.push(k === 'enabled' ? (body[k] ? 1 : 0) : body[k]); }
  }
  if (sets.length === 0) return c.json({ ok: true });
  vals.push(campaignId, uid);
  await c.env.DB.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

app.delete('/api/db/campaigns/:id', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid).run();
  return c.json({ ok: true });
});

// ── DB: Portal ────────────────────────────────────────────────────────────────

// Portal authentication endpoint.
// PUBLIC: GET /api/db/portal/:slug returns ONLY non-sensitive existence info.
//   Used by the portal frontend to confirm the slug is recognised.
// AUTHENTICATED: GET /api/db/portal/:slug?secret=<x> returns the portal_token
//   ONLY when the caller proves knowledge of a per-portal shared secret
//   (set as VITE_PORTAL_SECRET env var on each Pages deploy).
app.get('/api/db/portal/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  const row = await c.env.DB.prepare(
    'SELECT email, password, portal_token, user_id, client_id FROM portal WHERE slug = ?'
  ).bind(slug).first<{ email: string; password: string; portal_token: string | null; user_id: string | null; client_id: string | null }>();
  if (!row) return c.json({ portal: null }, 404);

  // Caller proved knowledge of the shared secret — return full record.
  // The "password" column is reused as the per-portal shared secret.
  const url = new URL(c.req.url);
  const providedSecret = url.searchParams.get('secret') || c.req.header('X-Portal-Secret');
  if (providedSecret && row.password && providedSecret === row.password) {
    return c.json({ portal: row });
  }

  // Anonymous response: no PII, no token. Just confirms slug exists.
  return c.json({ portal: { exists: true, client_id: row.client_id } });
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

// Portal content — public GET (for rendering), authenticated PUT (for editing)
app.get('/api/db/portal/:slug/content', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  const row = await c.env.DB.prepare(
    'SELECT hero_title, hero_subtitle, hero_cta_text FROM portal WHERE slug = ?'
  ).bind(slug).first<{ hero_title: string | null; hero_subtitle: string | null; hero_cta_text: string | null }>();
  return c.json({ content: row ?? { hero_title: '', hero_subtitle: '', hero_cta_text: '' } });
});

app.put('/api/db/portal/:slug/content', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const slug = c.req.param('slug').toLowerCase();
  const body = await c.req.json<{ hero_title?: string; hero_subtitle?: string; hero_cta_text?: string }>();
  const sets: string[] = []; const vals: unknown[] = [];
  if (body.hero_title !== undefined) { sets.push('hero_title = ?'); vals.push(body.hero_title); }
  if (body.hero_subtitle !== undefined) { sets.push('hero_subtitle = ?'); vals.push(body.hero_subtitle); }
  if (body.hero_cta_text !== undefined) { sets.push('hero_cta_text = ?'); vals.push(body.hero_cta_text); }
  if (sets.length === 0) return c.json({ ok: true });
  vals.push(slug);
  await c.env.DB.prepare(`UPDATE portal SET ${sets.join(', ')} WHERE slug = ?`).bind(...vals).run();
  return c.json({ ok: true });
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

// ── Onboarding health check ───────────────────────────────────────────────────
// Public endpoint — returns only boolean readiness flags + Resend domain
// verification status. No secrets, no customer info. Safe to leave open
// since the data here is the same observability you'd get by attempting
// a live signup yourself.
app.get('/api/health/onboarding', async (c) => {
  const out: Record<string, any> = {};

  // PayPal credentials — try to fetch an OAuth token. If credentials are
  // wrong/missing this throws.
  try {
    await paypalAccessToken(c.env);
    out.paypal_credentials_ok = true;
  } catch (e: any) {
    out.paypal_credentials_ok = false;
    out.paypal_error = (e?.message || 'unknown').slice(0, 120);
  }

  // PayPal webhook ID configured (worker secret only — value not returned)
  out.paypal_webhook_id_set = !!c.env.PAYPAL_WEBHOOK_ID;

  // Resend — try to list domains and find socialaistudio.au. Many of our
  // Resend keys are scoped to "Sending access" only, which means /v1/domains
  // returns 401 with name="restricted_api_key". That's a GOOD outcome —
  // sending emails still works; we just can't introspect domain verification
  // from here. Treat that case as "key is fine, can't verify domain via API".
  if (c.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
      });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as { name?: string };
        if (body.name === 'restricted_api_key') {
          out.resend = {
            api_key_set: true,
            sending_only: true,
            note: 'Key is sending-only — domain status not introspectable. Verify socialaistudio.au manually in Resend dashboard.',
          };
        } else {
          out.resend = { api_key_set: true, auth_error: true };
        }
      } else if (res.ok) {
        const data = await res.json() as { data?: Array<{ name: string; status: string }> };
        const dom = (data.data || []).find(d => d.name === 'socialaistudio.au');
        out.resend = {
          api_key_set: true,
          sending_only: false,
          domain_found: !!dom,
          domain_status: dom?.status || null,
          domain_verified: dom?.status === 'verified',
        };
      } else {
        out.resend = { api_key_set: true, http_status: res.status };
      }
    } catch (e: any) {
      out.resend = { api_key_set: true, error: (e?.message || 'unknown').slice(0, 120) };
    }
  } else {
    out.resend = { api_key_set: false };
  }

  // D1 connectivity — minimal probe, no row content returned.
  try {
    const r = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
    out.db_ok = r?.ok === 1;
  } catch (e: any) {
    out.db_ok = false;
    out.db_error = (e?.message || 'unknown').slice(0, 120);
  }

  return c.json(out);
});

// ── PayPal subscription endpoints ─────────────────────────────────────────────
// Live here on the worker (not the CF Pages Function) so they can use the
// PAYPAL_* and RESEND_API_KEY worker secrets directly. The Pages Functions
// at functions/api/paypal-{webhook,verify}.js are thin proxies to these
// routes — keeps PayPal's webhook URL stable while consolidating secrets.
//
// Plan-ID → tier mapping. Keep in sync with src/client.config.ts paypalPlanIds
// and paypalYearlyPlanIds. Both monthly and yearly IDs map to the same tier
// since `clients.plan` doesn't distinguish billing cycle.
const PAYPAL_PLAN_TIER: Record<string, string> = {
  // Monthly
  'P-1AB09838JG575723YNG3TKPY': 'starter',
  'P-5JX42118D0152071LNG3TLDY': 'growth',
  'P-0MN86219YF921874FNG3TLRY': 'pro',
  'P-5VB80462AU714124YNG3TL7Q': 'agency',
  // Yearly
  'P-62C327553Y779300FNHDUU7Y': 'starter',
  'P-60J02873W1559770VNHDUVAA': 'growth',
  'P-6G9907746Y8649457NHDUVAA': 'pro',
  'P-1BH48559DE324360CNHDUVAA': 'agency',
};

const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const ADMIN_NOTIFY_EMAIL = 'steve@pennywiseit.com.au';

async function paypalAccessToken(env: Env): Promise<string> {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET worker secret missing');
  const creds = btoa(`${id}:${secret}`);
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Failed to obtain PayPal access token');
  return data.access_token;
}

async function paypalVerifyWebhookSignature(req: Request, rawBody: string, token: string, env: Env): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) throw new Error('PAYPAL_WEBHOOK_ID worker secret missing');
  const body = {
    auth_algo: req.headers.get('paypal-auth-algo'),
    cert_url: req.headers.get('paypal-cert-url'),
    transmission_id: req.headers.get('paypal-transmission-id'),
    transmission_sig: req.headers.get('paypal-transmission-sig'),
    transmission_time: req.headers.get('paypal-transmission-time'),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: JSON.parse(rawBody),
  };
  const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { verification_status?: string };
  return data.verification_status === 'SUCCESS';
}

async function sendResendEmail(env: Env, opts: { to: string; subject: string; html: string }): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Social AI Studio <noreply@socialaistudio.au>',
        to: opts.to, subject: opts.subject, html: opts.html,
      }),
    });
  } catch (e: any) {
    console.error('Resend send error:', e?.message || e);
  }
}

function welcomeEmailHtml(plan: string): string {
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  const steps = ['Log in and complete your business profile','Connect your Facebook & Instagram pages','Generate your first AI post and schedule it'];
  const stepsHtml = steps.map((s, i) =>
    `<div style="display:flex;align-items:center;gap:12px;"><div style="width:24px;height:24px;background:#f59e0b22;border:1px solid #f59e0b44;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#f59e0b;font-size:11px;font-weight:700;flex-shrink:0;">${i+1}</div><span style="color:#d1d5db;font-size:13px;">${s}</span></div>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><div style="text-align:center;margin-bottom:32px;"><div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;"><span style="font-size:18px;">✨</span><span style="color:#f59e0b;font-weight:800;font-size:15px;">Social AI Studio</span></div></div><div style="background:linear-gradient(135deg,#f59e0b22,#ef444411);border:1px solid #f59e0b33;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;"><div style="font-size:48px;margin-bottom:16px;">🎉</div><h1 style="color:#ffffff;font-size:26px;font-weight:900;margin:0 0 12px;">You're all set!</h1><p style="color:#9ca3af;font-size:15px;line-height:1.6;margin:0 0 24px;">Your <strong style="color:#f59e0b;">${planName} Plan</strong> is now active. Welcome to Social AI Studio — let's grow your social media together.</p><a href="https://socialaistudio.au" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#000;font-weight:900;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;">Open Dashboard →</a></div><div style="background:#111118;border:1px solid #1f2937;border-radius:16px;padding:24px 28px;margin-bottom:16px;"><h2 style="color:#ffffff;font-size:14px;font-weight:700;margin:0 0 16px;">What happens next?</h2><div style="display:flex;flex-direction:column;gap:12px;">${stepsHtml}</div></div><p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:support@pennywiseit.com.au" style="color:#f59e0b;text-decoration:none;">support@pennywiseit.com.au</a> · <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">socialaistudio.au</a></p></div></body></html>`;
}

function cancellationEmailHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><div style="text-align:center;margin-bottom:32px;"><div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;"><span style="font-size:18px;">✨</span><span style="color:#f59e0b;font-weight:800;font-size:15px;">Social AI Studio</span></div></div><div style="background:#111118;border:1px solid #374151;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;"><h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0 0 12px;">Subscription Cancelled</h1><p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 24px;">Your Social AI Studio subscription has been cancelled. You'll retain access until the end of your current billing period.</p><p style="color:#6b7280;font-size:13px;margin:0;">Changed your mind? <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">Reactivate your plan</a> anytime.</p></div><p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:support@pennywiseit.com.au" style="color:#f59e0b;text-decoration:none;">support@pennywiseit.com.au</a></p></div></body></html>`;
}

// ── PayPal: Verify subscription ─────────────────────────────────────────────
// Called from the frontend (PricingTable.tsx) immediately after PayPal's
// onApprove fires. Confirms with PayPal that the subscription is active,
// stores a pending activation in D1 (consumed by App.tsx on the user's
// next render), and sends the welcome email so it goes out even when the
// PayPal webhook doesn't fire (or fires late).
app.post('/api/paypal-verify', async (c) => {
  const body = await c.req.json<{ subscriptionId?: string; uid?: string | null; planId?: string }>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { subscriptionId, planId } = body;
  if (!subscriptionId || !planId) return c.json({ error: 'Missing subscriptionId or planId' }, 400);

  try {
    const token = await paypalAccessToken(c.env);
    const res = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const sub = await res.json() as { status?: string; subscriber?: { email_address?: string; payer_id?: string } };
    if (sub.status !== 'ACTIVE') {
      return c.json({ error: `Subscription not yet active (status: ${sub.status}). Please wait and try again.` }, 400);
    }

    const email = sub.subscriber?.email_address || '';
    const payerId = sub.subscriber?.payer_id || '';
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
       VALUES (?,?,?,?,?,?,0)`
    ).bind(id, planId, email, subscriptionId, payerId, new Date().toISOString()).run();

    // Send welcome email here (don't wait for the webhook — it's the safety net,
    // not the primary signal). Skipped silently if RESEND_API_KEY isn't set.
    if (email) {
      await sendResendEmail(c.env, {
        to: email,
        subject: `Welcome to Social AI Studio — your ${planId} plan is active!`,
        html: welcomeEmailHtml(planId),
      });
      await sendResendEmail(c.env, {
        to: ADMIN_NOTIFY_EMAIL,
        subject: `New subscriber: ${email} — ${planId} plan`,
        html: `<p>New PayPal subscription activated.</p><p><strong>Email:</strong> ${email}<br><strong>Plan:</strong> ${planId}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>`,
      });
    }

    return c.json({ success: true, plan: planId });
  } catch (err: any) {
    console.error('PayPal verify error:', err?.message || err);
    return c.json({ error: 'Verification failed. Please contact support.' }, 500);
  }
});

// ── PayPal: Webhook (subscription lifecycle from PayPal) ────────────────────
// PayPal posts subscription events (ACTIVATED, CANCELLED) here. Public
// endpoint — protected by signature verification against PAYPAL_WEBHOOK_ID.
// Acts as the safety-net for /api/paypal-verify in case the user closes the
// browser tab mid-flow.
app.post('/api/paypal-webhook', async (c) => {
  const rawBody = await c.req.raw.text();
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return c.text('Invalid JSON', 400); }

  try {
    const token = await paypalAccessToken(c.env);
    const valid = await paypalVerifyWebhookSignature(c.req.raw, rawBody, token, c.env);
    if (!valid) {
      console.error('PayPal webhook signature verification failed');
      return c.text('Webhook signature invalid', 400);
    }
  } catch (err: any) {
    console.error('Webhook verification error:', err?.message || err);
    return c.text('Webhook verification failed', 400);
  }

  const resource = event.resource || {};
  const eventType = event.event_type;

  if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscriptionId = resource.id;
    const paypalPlanId = resource.plan_id;
    const email = resource.subscriber?.email_address || '';
    const payerId = resource.subscriber?.payer_id || '';
    const plan = PAYPAL_PLAN_TIER[paypalPlanId];
    if (!plan) {
      console.warn('No plan matched for PayPal plan ID:', paypalPlanId);
      return c.text('No plan matched — skipped.', 200);
    }

    const id = uuid();
    // INSERT OR IGNORE — verify endpoint may have already created the row.
    // Keying on subscription_id would be cleaner but the existing schema uses
    // a uuid primary key; the consumed flag handles double-consumption.
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
       VALUES (?,?,?,?,?,?,0)`
    ).bind(id, plan, email, subscriptionId, payerId, new Date().toISOString()).run();
    console.log(`PayPal activation stored for ${email || subscriptionId} → plan: ${plan}`);

    if (email) {
      await sendResendEmail(c.env, { to: email, subject: `Welcome to Social AI Studio — your ${plan} plan is active!`, html: welcomeEmailHtml(plan) });
      await sendResendEmail(c.env, { to: ADMIN_NOTIFY_EMAIL, subject: `New subscriber: ${email} — ${plan} plan`, html: `<p>New PayPal subscription activated.</p><p><strong>Email:</strong> ${email}<br><strong>Plan:</strong> ${plan}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>` });
    }
  }

  if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
    const subscriptionId = resource.id;
    const email = resource.subscriber?.email_address || '';
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO pending_cancellations (id, email, paypal_subscription_id, cancelled_at, consumed)
       VALUES (?,?,?,?,0)`
    ).bind(id, email ?? null, subscriptionId ?? null, new Date().toISOString()).run();
    console.log(`PayPal cancellation stored for ${email || subscriptionId}`);

    if (email) {
      await sendResendEmail(c.env, { to: email, subject: 'Your Social AI Studio subscription has been cancelled', html: cancellationEmailHtml() });
      await sendResendEmail(c.env, { to: ADMIN_NOTIFY_EMAIL, subject: `Cancellation: ${email}`, html: `<p>PayPal subscription cancelled.</p><p><strong>Email:</strong> ${email}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>` });
    }
  }

  // Audit-trail mirror — every event we care about gets a row in `payments`.
  // Append-only, dedup'd by paypal_event_id. The admin Customers dashboard
  // and the customer Billing screen read from this table; the `pending_*`
  // tables stay short-lived (consumed-then-ignored).
  try {
    await recordPaymentEvent(c, event);
  } catch (e) {
    console.error('recordPaymentEvent failed (webhook continues):', String(e));
  }

  return c.text('OK', 200);
});

/**
 * Mirror a PayPal webhook event into our `payments` table for audit + admin
 * visibility. Idempotent via the unique index on paypal_event_id — a retried
 * delivery will INSERT OR IGNORE without producing a duplicate row.
 *
 * Event types handled:
 *   BILLING.SUBSCRIPTION.ACTIVATED  → status 'completed', no amount
 *   BILLING.SUBSCRIPTION.CANCELLED  → status 'cancelled', no amount
 *   PAYMENT.SALE.COMPLETED          → status 'completed', positive amount_cents
 *   PAYMENT.SALE.REFUNDED           → status 'refunded',  negative amount_cents
 *   BILLING.SUBSCRIPTION.PAYMENT.FAILED → status 'failed', no amount
 *
 * Other event types are intentionally ignored (we'd just be storing noise).
 */
async function recordPaymentEvent(c: Context<{ Bindings: Env }>, event: any): Promise<void> {
  const eventId = event?.id;
  const eventType = event?.event_type as string | undefined;
  const resource = event?.resource || {};
  if (!eventId || !eventType) return;

  let subscriptionId: string | null = null;
  let captureId: string | null = null;
  let amountCents: number | null = null;
  let currency = 'AUD';
  let status: 'completed' | 'cancelled' | 'refunded' | 'failed' | null = null;
  let email: string | null = resource.subscriber?.email_address || null;
  let plan: string | null = null;

  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      subscriptionId = resource.id || null;
      const paypalPlanId = resource.plan_id;
      if (paypalPlanId) plan = PAYPAL_PLAN_TIER[paypalPlanId] ?? null;
      status = 'completed';
      break;
    }
    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      subscriptionId = resource.id || null;
      status = 'cancelled';
      break;
    }
    case 'PAYMENT.SALE.COMPLETED': {
      captureId = resource.id || null;
      // billing_agreement_id is the subscription_id for recurring sales.
      subscriptionId = resource.billing_agreement_id || null;
      const total = parseFloat(resource.amount?.total ?? '0');
      if (Number.isFinite(total) && total > 0) {
        amountCents = Math.round(total * 100);
      }
      currency = resource.amount?.currency || 'AUD';
      status = 'completed';
      break;
    }
    case 'PAYMENT.SALE.REFUNDED': {
      captureId = resource.id || null;
      subscriptionId = resource.billing_agreement_id || null;
      const total = parseFloat(resource.amount?.total ?? '0');
      if (Number.isFinite(total) && total > 0) {
        // Negative so SUMming amount_cents gives net revenue.
        amountCents = -Math.abs(Math.round(total * 100));
      }
      currency = resource.amount?.currency || 'AUD';
      status = 'refunded';
      break;
    }
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      subscriptionId = resource.id || null;
      status = 'failed';
      break;
    }
    default:
      return;
  }

  // Resolve user_id + email + plan via the subscription_id (or email fallback).
  // PAYMENT.SALE.* events don't carry subscriber email; we hop through the
  // users table via paypal_subscription_id to enrich the row.
  let userId: string | null = null;
  if (subscriptionId) {
    const u = await c.env.DB.prepare(
      'SELECT id, email, plan FROM users WHERE paypal_subscription_id = ?'
    ).bind(subscriptionId).first<{ id: string; email: string | null; plan: string | null }>();
    if (u) {
      userId = u.id;
      if (!email) email = u.email;
      if (!plan && u.plan) plan = u.plan;
    }
  }
  if (!userId && email) {
    const u = await c.env.DB.prepare(
      'SELECT id, plan FROM users WHERE email = ?'
    ).bind(email).first<{ id: string; plan: string | null }>();
    if (u) {
      userId = u.id;
      if (!plan && u.plan) plan = u.plan;
    }
  }

  // Cap raw_event so a single huge webhook can't blow row size limits.
  const rawJson = (() => {
    try { return JSON.stringify(event).slice(0, 8000); } catch { return null; }
  })();

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO payments
       (id, paypal_event_id, paypal_subscription_id, paypal_capture_id,
        email, user_id, plan, event_type, amount_cents, currency, status,
        raw_event, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    uuid(), eventId, subscriptionId, captureId,
    email, userId, plan, eventType, amountCents, currency, status,
    rawJson, new Date().toISOString(),
  ).run();
}

// ── Admin: Customers dashboard ───────────────────────────────────────────────
// Powers the agency owner's "Customers" tab. All endpoints gated by
// requireAdmin (Clerk JWT → users.is_admin=1).

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

// ── Customer: Billing screen ─────────────────────────────────────────────────

/**
 * GET /api/billing
 * Returns the SIGNED-IN user's current plan + their own payment history.
 * Scoped strictly to the caller — never returns another user's data even
 * if the caller knows the email.
 */
app.get('/api/billing', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);

  const user = await c.env.DB.prepare(
    'SELECT id, email, plan, paypal_subscription_id, created_at FROM users WHERE id = ?'
  ).bind(uid).first<{
    id: string; email: string | null; plan: string | null;
    paypal_subscription_id: string | null; created_at: string | null;
  }>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const payments = await c.env.DB.prepare(
    `SELECT event_type, amount_cents, currency, status, plan, created_at
       FROM payments
      WHERE user_id = ? OR (email IS NOT NULL AND email = ?)
      ORDER BY created_at DESC
      LIMIT 24`
  ).bind(uid, user.email ?? '').all();

  return c.json({
    email: user.email,
    plan: user.plan,
    plan_price_aud: user.plan ? (PLAN_PRICE_AUD[user.plan] ?? null) : null,
    subscription_id: user.paypal_subscription_id,
    member_since: user.created_at,
    payments: payments.results || [],
  });
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

  // Get page access tokens with fields for Instagram Business Account
  const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,category,picture,instagram_business_account&access_token=${exchangeData.access_token}`;
  const pagesRes = await fetch(pagesUrl);
  const pagesData = await pagesRes.json() as any;

  // Enrich pages with instagram_business_account ID
  const pages = (pagesData.data || []).map((page: any) => ({
    ...page,
    instagramBusinessAccountId: page.instagram_business_account?.id || null,
  }));

  return c.json({
    longLivedUserToken: exchangeData.access_token,
    expiresInSeconds: exchangeData.expires_in,
    pages,
    pageTokensNeverExpire: true,
  });
});

// ── Facebook Page Insights Scraper ─────────────────────────────────────────
// Pulls a connected Page's REAL data (own posts, comments, about, photos,
// events) into the client_facts table. The AI then writes from real ground
// truth instead of inventing testimonials and stats.
//
// POST /api/db/refresh-facts            → scrapes the calling user's own page
// POST /api/db/refresh-facts/:clientId  → scrapes a specific client's page
async function refreshFactsForWorkspace(
  db: D1Database,
  uid: string,
  clientId: string | null,
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  // Get tokens
  const tokenRow = clientId
    ? await db.prepare('SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<{ social_tokens: string | null }>()
    : await db.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(uid).first<{ social_tokens: string | null }>();
  const tokens = tokenRow?.social_tokens ? JSON.parse(tokenRow.social_tokens) : null;
  const pageId = tokens?.facebookPageId;
  const pageToken = tokens?.facebookPageAccessToken;
  if (!pageId || !pageToken) {
    return { inserted: 0, errors: ['No Facebook page connected for this workspace.'] };
  }

  const base = 'https://graph.facebook.com/v21.0';
  const inserts: Array<{ type: string; content: string; meta: any; fb_id: string; eng: number }> = [];

  // 1. Page about/description/products/hours (1 row)
  try {
    const r = await fetch(`${base}/${pageId}?fields=about,description,category,founded,mission,products,phone,hours,website,location,fan_count&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d && !d.error) {
      const blob = [
        d.about && `About: ${d.about}`,
        d.description && `Description: ${d.description}`,
        d.category && `Category: ${d.category}`,
        d.products && `Products: ${d.products}`,
        d.mission && `Mission: ${d.mission}`,
        d.hours && `Hours: ${JSON.stringify(d.hours)}`,
        d.location && `Location: ${[d.location.street, d.location.city, d.location.state, d.location.country].filter(Boolean).join(', ')}`,
        d.website && `Website: ${d.website}`,
      ].filter(Boolean).join('\n');
      if (blob) inserts.push({ type: 'about', content: blob, meta: { fan_count: d.fan_count }, fb_id: pageId, eng: 0 });
    } else if (d?.error) errors.push(`about: ${d.error.message}`);
  } catch (e: any) { errors.push(`about: ${e.message}`); }

  // 2. Last 50 posts with engagement
  let topPostIds: string[] = [];
  try {
    const r = await fetch(`${base}/${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&limit=50&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d?.error) errors.push(`posts: ${d.error.message}`);
    const posts = d?.data || [];
    for (const p of posts) {
      if (!p.message || p.message.length < 20) continue;
      const eng = (p.likes?.summary?.total_count || 0) + ((p.comments?.summary?.total_count || 0) * 3) + ((p.shares?.count || 0) * 5);
      inserts.push({
        type: 'own_post',
        content: p.message,
        meta: { likes: p.likes?.summary?.total_count, comments: p.comments?.summary?.total_count, shares: p.shares?.count, created: p.created_time },
        fb_id: p.id,
        eng,
      });
    }
    // Pick top 5 posts by engagement to mine for comments
    topPostIds = posts
      .filter((p: any) => p.message)
      .sort((a: any, b: any) => ((b.likes?.summary?.total_count || 0) + (b.comments?.summary?.total_count || 0)) - ((a.likes?.summary?.total_count || 0) + (a.comments?.summary?.total_count || 0)))
      .slice(0, 5)
      .map((p: any) => p.id);
  } catch (e: any) { errors.push(`posts: ${e.message}`); }

  // 3. Comments on top-engagement posts (real customer voice)
  for (const pid of topPostIds) {
    try {
      const r = await fetch(`${base}/${pid}/comments?fields=id,message,from,like_count&limit=20&access_token=${pageToken}`);
      const d: any = await r.json();
      if (d?.error) continue;
      for (const c of d?.data || []) {
        if (!c.message || c.message.length < 8 || c.message.length > 500) continue;
        // Skip comments from the page itself (replies)
        if (c.from?.id === pageId) continue;
        inserts.push({
          type: 'comment',
          content: c.message,
          meta: { like_count: c.like_count, from: c.from?.name },
          fb_id: c.id,
          eng: c.like_count || 0,
        });
      }
    } catch { /* skip this post */ }
  }

  // 4. Recent photos (URLs only — for AI to reference real imagery)
  try {
    const r = await fetch(`${base}/${pageId}/photos?type=uploaded&fields=id,images,name&limit=30&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d?.error) errors.push(`photos: ${d.error.message}`);
    for (const ph of d?.data || []) {
      const url = ph.images?.[0]?.source;
      if (!url) continue;
      inserts.push({
        type: 'photo',
        content: ph.name || 'Untitled photo',
        meta: { url },
        fb_id: ph.id,
        eng: 0,
      });
    }
  } catch (e: any) { errors.push(`photos: ${e.message}`); }

  // 5. Upcoming events (real future dates AI can reference)
  try {
    const r = await fetch(`${base}/${pageId}/events?fields=id,name,description,start_time,place&time_filter=upcoming&access_token=${pageToken}`);
    const d: any = await r.json();
    if (!d?.error) {
      for (const ev of d?.data || []) {
        inserts.push({
          type: 'event',
          content: `${ev.name}${ev.description ? ' — ' + ev.description.substring(0, 200) : ''}`,
          meta: { start_time: ev.start_time, place: ev.place?.name },
          fb_id: ev.id,
          eng: 0,
        });
      }
    }
    // events permission often missing — silently skip
  } catch { /* skip */ }

  // Wipe old rows for this workspace + replace (UNIQUE constraint covers de-dup
  // but a fresh wipe ensures stale facts are removed)
  await db.prepare('DELETE FROM client_facts WHERE user_id = ? AND COALESCE(client_id, \'\') = ?').bind(uid, clientId || '').run();

  let inserted = 0;
  for (const f of inserts) {
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(uid, clientId, f.type, f.content, JSON.stringify(f.meta || {}), f.fb_id, f.eng).run();
      inserted++;
    } catch { /* duplicate or constraint — skip */ }
  }

  return { inserted, errors };
}

app.post('/api/db/refresh-facts', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const result = await refreshFactsForWorkspace(c.env.DB, uid, null);
  return c.json(result);
});

app.post('/api/db/refresh-facts/:clientId', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.param('clientId');
  const result = await refreshFactsForWorkspace(c.env.DB, uid, clientId);
  return c.json(result);
});

// One-shot bootstrap — scrape ALL workspaces with FB tokens. Used to seed the
// table for existing connected accounts. Protected by FACTS_BOOTSTRAP_SECRET
// env var (set via wrangler secret) — anyone with the secret can re-seed.
// Backfill images for any Scheduled post that has an image_prompt but no image_url.
// Authenticated variant: only the calling user's posts (own + their clients').
app.post('/api/db/backfill-images', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(await backfillImagesForUser(c.env, uid));
});

// Admin variant: backfill across every workspace. Gated by FACTS_BOOTSTRAP_SECRET.
app.post('/api/admin/backfill-images-all', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const users = await c.env.DB.prepare('SELECT id FROM users').all();
  const results: any[] = [];
  for (const u of (users.results || [])) {
    const r = await backfillImagesForUser(c.env, (u as any).id);
    results.push({ user_id: (u as any).id, ...r });
  }
  return c.json({ users_processed: results.length, results });
});

async function backfillImagesForUser(env: Env, uid: string) {
  const apiKey = env.FAL_API_KEY;
  if (!apiKey) return { error: 'fal.ai not configured', found: 0, succeeded: 0, failed: 0 };

  // Find Scheduled posts owned by this user (own + via client) that have a
  // prompt but no URL. Cap at 30 per call so a single backfill can't blow the
  // fal.ai budget.
  const rows = await env.DB.prepare(
    `SELECT p.id, p.image_prompt, p.client_id
     FROM posts p
     LEFT JOIN clients c ON p.client_id = c.id
     WHERE p.status = 'Scheduled'
       AND (p.user_id = ? OR c.user_id = ?)
       AND (p.image_url IS NULL OR p.image_url = '')
       AND p.image_prompt IS NOT NULL
       AND p.image_prompt != 'N/A'
       AND p.image_prompt != ''
     LIMIT 30`
  ).bind(uid, uid).all();

  const posts = rows.results || [];
  let succeeded = 0; let failed = 0; const errors: string[] = [];

  for (const post of posts) {
    try {
      // Validated, UI-safe prompt (see buildSafeImagePrompt at top of file).
      // Replaces the previous inline strip + "product photography" suffix
      // which (a) had no UI/chart guards and (b) used an older over-styled
      // suffix that drifted away from the candid-iPhone look in gemini.ts.
      const finalPrompt = buildSafeImagePrompt(String((post as any).image_prompt || ''));
      if (!finalPrompt) { failed++; continue; }

      const res = await fetch('https://fal.run/fal-ai/flux/dev', {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt, image_size: 'square_hd',
          num_inference_steps: 25, num_images: 1,
          enable_safety_checker: true, guidance_scale: 3.5,
        }),
      });
      const data: any = await res.json();
      const url = data?.images?.[0]?.url;
      if (res.ok && url) {
        await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?').bind(url, (post as any).id).run();
        succeeded++;
      } else {
        failed++;
        errors.push(`${(post as any).id}: ${(data?.detail || data?.message || res.status)}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${(post as any).id}: ${e.message}`);
    }
    // Pace fal.ai — 700ms between calls so 30 posts = ~21s, well under any rate limit
    await new Promise(r => setTimeout(r, 700));
  }
  return { found: posts.length, succeeded, failed, errors: errors.slice(0, 5) };
}

// ── Admin: Provision a whitelabel portal (atomic) ─────────────────────────────
// Combines the existing 2-step provisioning (client row + portal row) into one
// call, generates the per-portal shared secret, and returns the full env-var
// set the agent must paste into the CF Pages project. This is Phase B-Lite —
// the database side of portal automation. Steps that require external APIs
// (creating the CF Pages project, adding the custom domain, creating the
// Clerk auto-login user) are still manual until those credentials are wired
// in. See .windsurf/workflows/phase-b-portal-automation.md.
//
// Auth: gated by FACTS_BOOTSTRAP_SECRET (the same secret used by the existing
// admin endpoints — keeps the bootstrap-secret surface area at one secret).
//
// Request body:
//   {
//     slug: "newclient",                    // unique, lowercase, kebab-case
//     ownerUserId: "user_xxx",              // Clerk user id of the AGENCY admin
//                                           // who owns this portal (typically Steve)
//     businessName: "New Client",
//     businessType: "florist",              // optional
//     plan: "agency",                       // optional, defaults to 'agency'
//     autoLoginEmail: "client@example.com", // the Clerk auto-login email
//                                           // (Clerk user MUST be created
//                                           //  manually until Phase B step 3)
//     autoLoginPassword: "...",             // the Clerk auto-login password
//     customDomain: "social.client.com.au"  // for the docs string only
//   }
//
// Response:
//   {
//     ok: true,
//     clientId: "<uuid>",
//     portalToken: "<random>",
//     portalSecret: "<random>",   // also stored as portal.password — set this
//                                  // as VITE_PORTAL_SECRET on the CF Pages project
//     envVars: { ... },           // copy-paste block for CF Pages env vars
//     manualSteps: [ ... ]        // remaining steps that need a human
//   }
app.post('/api/admin/portals/provision', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json<{
    slug?: string;
    ownerUserId?: string;
    businessName?: string;
    businessType?: string;
    plan?: string;
    autoLoginEmail?: string;
    autoLoginPassword?: string;
    customDomain?: string;
  }>();

  // Validate inputs
  const slug = (body.slug || '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    return c.json({ error: 'slug must be lowercase, 2-41 chars, [a-z0-9-]' }, 400);
  }
  if (!body.ownerUserId || !body.businessName || !body.autoLoginEmail || !body.autoLoginPassword) {
    return c.json({ error: 'ownerUserId, businessName, autoLoginEmail, autoLoginPassword are required' }, 400);
  }
  if (body.autoLoginPassword.length < 16) {
    return c.json({ error: 'autoLoginPassword must be at least 16 chars' }, 400);
  }

  // Refuse if slug is already taken
  const existing = await c.env.DB.prepare('SELECT slug FROM portal WHERE slug = ?').bind(slug).first();
  if (existing) return c.json({ error: `slug '${slug}' is already taken` }, 409);

  // Generate the per-portal shared secret + portal token. The "password" column
  // on the portal table doubles as the shared secret used by VITE_PORTAL_SECRET.
  // We use crypto.randomUUID twice to widen the entropy beyond a single UUID.
  const portalSecret = crypto.randomUUID() + '-' + crypto.randomUUID();
  const portalToken = crypto.randomUUID() + '-' + crypto.randomUUID();

  // Atomic create: client first, then portal pointing at it.
  const clientId = uuid();
  const plan = body.plan || 'agency';
  await c.env.DB.prepare(
    'INSERT INTO clients (id, user_id, name, business_type, created_at, plan) VALUES (?,?,?,?,?,?)'
  ).bind(clientId, body.ownerUserId, body.businessName, body.businessType ?? null, new Date().toISOString(), plan).run();

  await c.env.DB.prepare(
    `INSERT INTO portal (slug, email, password, portal_token, user_id, client_id)
     VALUES (?,?,?,?,?,?)`
  ).bind(slug, body.autoLoginEmail, portalSecret, portalToken, body.ownerUserId, clientId).run();

  // Try to create the Clerk auto-login user. We already have CLERK_SECRET_KEY
  // configured (it's used everywhere for JWT verification) and the Backend
  // API's POST /v1/users supports user creation with a password — no new
  // credentials needed. If creation fails (e.g. email already exists, network
  // error, Clerk plan restriction), we fall back to manual creation and the
  // CLI will print a clear instruction.
  const clerk = await tryCreateClerkUser(
    c.env.CLERK_SECRET_KEY,
    body.autoLoginEmail,
    body.autoLoginPassword,
    { portal_slug: slug, client_id: clientId },
  );

  // Build the env-var block. Real values are baked into the CF Pages project
  // automatically when CLOUDFLARE_API_TOKEN is set; otherwise these are the
  // values to paste manually.
  const workerUrl = (c.env as any).PUBLIC_WORKER_URL || 'https://socialai-api.steve-700.workers.dev';
  const envVars: Record<string, string> = {
    VITE_CLERK_PUBLISHABLE_KEY: '<copy from main CF Pages project>',
    VITE_AI_WORKER_URL: workerUrl,
    VITE_AUTO_LOGIN_EMAIL: body.autoLoginEmail,
    VITE_AUTO_LOGIN_PASSWORD: body.autoLoginPassword,
    VITE_PORTAL_SECRET: portalSecret,
    VITE_CLIENT_ID: slug,
    FACEBOOK_APP_ID: '<copy from main CF Pages project>',
    FACEBOOK_APP_SECRET: '<copy from main CF Pages project>',
  };

  // Try to create the Cloudflare Pages project + attach the custom domain.
  // Gated on both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID being set.
  // Skipped silently when missing — the manualSteps array surfaces the work
  // the human still needs to do.
  const customDomain = body.customDomain || `social.${slug}.com.au`;
  const cfPages = await tryCreateCFPagesProject(c.env, {
    projectName: `${slug}-social`,
    slug,
    customDomain,
    envVars,
  });

  // Build the manual-steps list. Each item conditionally appears only when
  // its automation failed or wasn't attempted.
  const manualSteps: string[] = [];

  if (!cfPages.projectCreated) {
    manualSteps.push(
      `Create CF Pages project named '${slug}-social' pointing at the SocialAI-Studio repo`,
      `Set CF Pages build command: cp src/client.configs/${slug}.ts src/client.config.ts && npm run build`,
      `Set the env vars above on the new CF Pages project`,
    );
  }
  if (!cfPages.domainAttached) {
    manualSteps.push(`Add custom domain '${customDomain}' in CF Pages → Custom domains`);
  }
  if (!clerk.created) {
    manualSteps.push(
      `In Clerk dashboard, create a user with email '${body.autoLoginEmail}' and the autoLoginPassword above (auto-create failed: ${clerk.error || 'unknown'})`
    );
  }
  manualSteps.push(
    `Create src/client.configs/${slug}.ts (copy picklenick.ts as template; set clientId='${slug}', clientMode:true, accentColor, defaultBusinessName, etc.) — the CLI does this for you when run from a checkout`,
    `Commit + push the new config — CF Pages auto-builds`,
  );
  // Re-number for readability
  const numbered = manualSteps.map((s, i) => `${i + 1}. ${s}`);

  return c.json({
    ok: true,
    clientId,
    portalToken,
    portalSecret,
    clerkUserCreated: clerk.created,
    clerkUserId: clerk.userId,
    clerkError: clerk.error,
    cfPagesProjectCreated: cfPages.projectCreated,
    cfPagesProjectName: cfPages.projectName,
    cfPagesDomainAttached: cfPages.domainAttached,
    cfPagesError: cfPages.error,
    envVars,
    manualSteps: numbered,
  });
});

/**
 * Create a Clerk user via the Backend API. Returns { created, userId?, error? }.
 * Never throws — caller decides how to handle failures.
 *
 * Clerk's instance settings determine whether passwords or email-only signups
 * are allowed; if the instance disallows passwords, this fails gracefully and
 * the caller falls back to printing a manual-create instruction.
 */
async function tryCreateClerkUser(
  secretKey: string,
  email: string,
  password: string,
  publicMetadata: Record<string, unknown>,
): Promise<{ created: boolean; userId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.clerk.com/v1/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: [email],
        password,
        skip_password_checks: true,    // we generate a 24-byte base64url password, well above any sane minimum
        skip_password_requirement: false,
        public_metadata: publicMetadata,
      }),
    });
    if (res.ok) {
      const data = await res.json() as { id?: string };
      return { created: true, userId: data.id };
    }
    // Clerk returns 422 with a structured `errors` array on validation failures
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json() as { errors?: Array<{ message?: string; code?: string; long_message?: string }> };
      if (data.errors && data.errors[0]) {
        const e = data.errors[0];
        errMsg = e.long_message || e.message || e.code || errMsg;
      }
    } catch { /* keep HTTP fallback */ }
    return { created: false, error: errMsg };
  } catch (e: any) {
    return { created: false, error: e?.message || 'fetch failed' };
  }
}

/**
 * Create a Cloudflare Pages project pointing at the SocialAI-Studio repo,
 * with build command + env vars baked in, then attach the custom domain.
 *
 * Gated on CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID being present —
 * if either is missing the function returns { projectCreated: false,
 * error: 'CLOUDFLARE_API_TOKEN not configured' } and the caller falls
 * back to manual instructions.
 *
 * IMPORTANT prerequisite: the Cloudflare account must already have
 * authorized GitHub access to the repo (one-time OAuth grant in the
 * dashboard). The CF Pages REST API can't bootstrap that authorization
 * itself — once it's granted, this function works for every subsequent
 * portal.
 *
 * Two API calls happen:
 *   1. POST .../pages/projects        — create the project
 *   2. POST .../pages/projects/{name}/domains — attach the custom domain
 *
 * If step 1 fails the function returns early; step 2 only runs if step 1
 * succeeded. Both successes/failures surface as separate booleans on the
 * return value so the caller can build a precise manualSteps list.
 */
async function tryCreateCFPagesProject(
  env: Env,
  args: { projectName: string; slug: string; customDomain: string; envVars: Record<string, string> },
): Promise<{
  projectCreated: boolean;
  domainAttached: boolean;
  projectName?: string;
  error?: string;
}> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return {
      projectCreated: false,
      domainAttached: false,
      error: !token ? 'CLOUDFLARE_API_TOKEN not configured' : 'CLOUDFLARE_ACCOUNT_ID not configured',
    };
  }

  const repoOwner = env.GITHUB_REPO_OWNER || '3dhuboz';
  const repoName  = env.GITHUB_REPO_NAME  || 'SocialAI-Studio';
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // CF Pages env_vars take a { value, type } shape per key. "plain_text" is
  // the default; "secret_text" encrypts at rest. We use "plain_text" for
  // VITE_* (they're baked into the public bundle anyway) and "secret_text"
  // for the auto-login password + portal secret + FB secrets which should
  // not appear in the dashboard plaintext.
  const SECRETS = new Set(['VITE_AUTO_LOGIN_PASSWORD', 'VITE_PORTAL_SECRET', 'FACEBOOK_APP_SECRET']);
  const envForCF: Record<string, { value: string; type: string }> = {};
  for (const [k, v] of Object.entries(args.envVars)) {
    envForCF[k] = { value: v, type: SECRETS.has(k) ? 'secret_text' : 'plain_text' };
  }

  // Step 1 — create the project
  let createOk = false;
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: args.projectName,
        production_branch: 'main',
        source: {
          type: 'github',
          config: {
            owner: repoOwner,
            repo_name: repoName,
            production_branch: 'main',
            pr_comments_enabled: false,
            deployments_enabled: true,
            production_deployment_enabled: true,
            preview_deployment_setting: 'none',
          },
        },
        build_config: {
          build_command: `cp src/client.configs/${args.slug}.ts src/client.config.ts && npm run build`,
          destination_dir: 'dist',
          root_dir: '/',
        },
        deployment_configs: {
          production: { env_vars: envForCF },
        },
      }),
    });
    if (res.ok) {
      createOk = true;
    } else {
      let errMsg = `HTTP ${res.status}`;
      try {
        const data = await res.json() as { errors?: Array<{ message?: string }> };
        if (data.errors && data.errors[0]?.message) errMsg = data.errors[0].message;
      } catch { /* keep HTTP fallback */ }
      return {
        projectCreated: false,
        domainAttached: false,
        error: `CF Pages project create failed: ${errMsg}`,
      };
    }
  } catch (e: any) {
    return {
      projectCreated: false,
      domainAttached: false,
      error: `CF Pages project create error: ${e?.message || 'fetch failed'}`,
    };
  }

  // Step 2 — attach the custom domain. SSL provisioning is async; this call
  // returns immediately with the domain in pending status. CF will issue
  // the cert in the background (~5 min).
  let domainOk = false;
  let domainErr: string | undefined;
  try {
    const domainUrl = `${baseUrl}/${encodeURIComponent(args.projectName)}/domains`;
    const res = await fetch(domainUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: args.customDomain }),
    });
    if (res.ok) {
      domainOk = true;
    } else {
      try {
        const data = await res.json() as { errors?: Array<{ message?: string }> };
        domainErr = data.errors?.[0]?.message || `HTTP ${res.status}`;
      } catch { domainErr = `HTTP ${res.status}`; }
    }
  } catch (e: any) {
    domainErr = e?.message || 'fetch failed';
  }

  return {
    projectCreated: createOk,
    domainAttached: domainOk,
    projectName: createOk ? args.projectName : undefined,
    error: domainErr ? `Custom domain attach failed: ${domainErr}` : undefined,
  };
}

// ── Admin: PayPal subscription diagnostic ─────────────────────────────────────
// Queries PayPal for every plan ID baked into client.config.ts, returns each
// plan's status + billing cycle + currency. Use this when the hermes checkout
// shows "We're sorry. Things don't appear to be working" — the most common
// cause is one or more plans being in CREATED/INACTIVE state instead of ACTIVE.
//
// Usage:
//   curl -X POST https://socialai-api.steve-700.workers.dev/api/admin/paypal-diagnose \
//     -H "X-Bootstrap-Secret: $FACTS_BOOTSTRAP_SECRET"
//
// Auth: same FACTS_BOOTSTRAP_SECRET as the other admin endpoints — no new
// surface area.
app.post('/api/admin/paypal-diagnose', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const clientId = c.env.PAYPAL_CLIENT_ID;
  const clientSecret = c.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json({ error: 'PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET worker secret missing' }, 500);
  }

  // PayPal plan IDs — keep in sync with src/client.config.ts
  const PLAN_IDS = {
    monthly: {
      starter: 'P-1AB09838JG575723YNG3TKPY',
      growth:  'P-5JX42118D0152071LNG3TLDY',
      pro:     'P-0MN86219YF921874FNG3TLRY',
      agency:  'P-5VB80462AU714124YNG3TL7Q',
    },
    yearly: {
      starter: 'P-62C327553Y779300FNHDUU7Y',
      growth:  'P-60J02873W1559770VNHDUVAA',
      pro:     'P-6G9907746Y8649457NHDUVAA',
      agency:  'P-1BH48559DE324360CNHDUVAA',
    },
  };

  // Get OAuth token
  const creds = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) {
    return c.json({ error: 'PayPal auth failed', detail: tokenData }, 500);
  }
  const token = tokenData.access_token;
  const appId = tokenData.app_id || null;

  // Query each plan
  type PlanStatus = {
    label: string;
    planId: string;
    httpStatus: number;
    status?: string;
    interval?: string;
    price?: string;
    currency?: string;
    setupFee?: string;
    productId?: string;
    error?: string;
  };
  const results: PlanStatus[] = [];
  const issues: string[] = [];

  const checkPlan = async (label: string, planId: string) => {
    const res = await fetch(`https://api-m.paypal.com/v1/billing/plans/${planId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const r: PlanStatus = { label, planId, httpStatus: res.status };
    if (!res.ok) {
      try {
        const err = await res.json() as any;
        r.error = err?.details?.[0]?.description || err?.message || `HTTP ${res.status}`;
      } catch {
        r.error = `HTTP ${res.status}`;
      }
      issues.push(`${label} (${planId}) — ${r.error}`);
      results.push(r);
      return;
    }
    const plan = await res.json() as any;
    const billingCycle = plan.billing_cycles?.[0];
    const price = billingCycle?.pricing_scheme?.fixed_price;
    const setupFee = plan.payment_preferences?.setup_fee;
    r.status = plan.status;
    r.interval = billingCycle?.frequency
      ? `${billingCycle.frequency.interval_count} ${billingCycle.frequency.interval_unit}`
      : undefined;
    r.price = price ? price.value : undefined;
    r.currency = price ? price.currency_code : undefined;
    r.setupFee = setupFee ? `${setupFee.value} ${setupFee.currency_code}` : 'none';
    r.productId = plan.product_id;
    if (plan.status !== 'ACTIVE') {
      issues.push(`${label} (${planId}) is ${plan.status} — must be ACTIVE. Run: POST /v1/billing/plans/${planId}/activate`);
    }
    if (r.currency && r.currency !== 'AUD') {
      issues.push(`${label} (${planId}) is in ${r.currency} not AUD — currency mismatch causes hermes to fail`);
    }
    results.push(r);
  };

  for (const [label, id] of Object.entries(PLAN_IDS.monthly)) await checkPlan(label, id);
  for (const [label, id] of Object.entries(PLAN_IDS.yearly)) await checkPlan(`${label}-yearly`, id);

  return c.json({
    paypalAppId: appId,
    plans: results,
    issues,
    verdict: issues.length === 0
      ? 'All plans look healthy. The hermes "We\'re sorry" error is likely browser-anti-fraud (CDP debugging attached) or PayPal app domain restriction missing socialaistudio.au. Check developer.paypal.com → your live app → return URLs / domains.'
      : 'Plan-level issues found — see "issues" array. Fix those first before assuming it\'s a browser/domain problem.',
  });
});

app.post('/api/admin/bootstrap-all-facts', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const users = await c.env.DB.prepare(
    `SELECT id FROM users WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL`
  ).all();
  const clients = await c.env.DB.prepare(
    `SELECT id, user_id FROM clients WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL AND COALESCE(status,'active') != 'on_hold'`
  ).all();
  const results: any[] = [];
  for (const u of (users.results || [])) {
    const r = await refreshFactsForWorkspace(c.env.DB, (u as any).id, null);
    results.push({ workspace: 'user:' + (u as any).id, ...r });
  }
  for (const cl of (clients.results || [])) {
    const r = await refreshFactsForWorkspace(c.env.DB, (cl as any).user_id, (cl as any).id);
    results.push({ workspace: 'client:' + (cl as any).id, ...r });
  }
  return c.json({ workspaces_processed: results.length, results });
});

// Read facts back — used by the frontend to inject into AI prompts.
app.get('/api/db/facts', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const clientId = c.req.query('clientId') || null;
  const rows = await c.env.DB.prepare(
    `SELECT fact_type, content, metadata, engagement_score, verified_at
     FROM client_facts
     WHERE user_id = ? AND COALESCE(client_id, '') = ?
     ORDER BY engagement_score DESC, verified_at DESC
     LIMIT 200`
  ).bind(uid, clientId || '').all();
  return c.json({ facts: rows.results || [] });
});

// ── fal.ai Proxy (query-param based — matches Pages Function pattern) ────────
app.all('/api/fal-proxy', async (c) => {
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 401);

  // AUTH GATE — fal.ai is paid per-image/video; never let it run anonymous.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  // RATE LIMIT — 20 fal.ai calls per minute per user (images are the dominant cost).
  if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

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
    // Use the fal queue URL format returned by generate-video (without version/model path)
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'task-result') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`, { headers: authHeader });
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
  // AUTH GATE — required to use the proxied fal.ai endpoint with our key.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

  const path = c.req.path.replace('/api/fal-proxy', '');
  const url = `https://api.fal.ai${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;

  // Server uses its own key; ignore client-supplied keys to prevent abuse.
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 500);

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

// ── Cron Triggers ────────────────────────────────────────────────────────────
// */5 * * * *  → missed post publisher (every 5 min)
// 0 3 * * *   → token refresh (daily at 3am UTC)
// 0 */6 * * * → fal.ai credit check (every 6 hours)

async function cronPublishMissedPosts(env: Env): Promise<{ posts_processed: number }> {
  // Posts are stored in AEST (UTC+10) without timezone offset, so compare in AEST
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');

  // Clean up zombie Publishing posts — only if they've been stuck for >10 min
  // (previous code reset ALL Publishing posts every 5-min cron tick, which
  // caused posts to be marked Missed while still actively being published)
  const tenMinAgo = new Date(Date.now() + 10 * 60 * 60 * 1000 - 10 * 60 * 1000).toISOString().replace('Z', '');
  await env.DB.prepare(
    `UPDATE posts SET status = 'Missed' WHERE status = 'Publishing' AND scheduled_for <= ?`
  ).bind(tenMinAgo).run();

  // Claim posts with a unique ID so concurrent cron instances don't double-post.
  // Each instance stamps its own claimId, then only selects posts it claimed.
  const claimId = crypto.randomUUID();
  await env.DB.prepare(
    `UPDATE posts SET status = 'Publishing', image_prompt = COALESCE(image_prompt, '') || '|claim:' || ?
     WHERE status = 'Scheduled' AND scheduled_for <= ?
       AND ${ACTIVE_CLIENT_FILTER}`
  ).bind(claimId, nowAEST).run();

  const rows = await env.DB.prepare(
    `SELECT id, content, hashtags, image_url, image_prompt, platform, user_id, client_id
     FROM posts WHERE status = 'Publishing' AND image_prompt LIKE '%' || ? LIMIT 20`
  ).bind(claimId).all();
  const posts = rows.results ?? [];
  if (posts.length === 0) { console.log('[CRON] No posts to publish'); return { posts_processed: 0 }; }
  console.log(`[CRON] Claimed ${posts.length} posts (claim: ${claimId.substring(0, 8)})`);

  // Cap on JIT image generations per cron run. fal.ai can be slow (~10-15s per
  // image on cold start) and the worker has a wall-time budget, so we don't let
  // a stampede of missing images blow the budget. Posts above the cap publish
  // text-only this tick and get picked up by the next 5-minute tick (a future
  // tick re-claims them via the missed-post sweep).
  const MAX_JIT_IMAGES_PER_RUN = 5;
  let jitGenerated = 0;

  for (const post of posts) {
    try {
      // Get social tokens for this workspace
      const tokensRaw = (post as any).client_id
        ? await env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ?').bind((post as any).client_id).first<{ social_tokens: string | null }>()
        : await env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind((post as any).user_id).first<{ social_tokens: string | null }>();
      const tokens = tokensRaw?.social_tokens ? JSON.parse(tokensRaw.social_tokens) : null;
      if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
        const reason = 'No Facebook page connected — go to Settings → Connect Facebook to fix.';
        console.warn(`[CRON] No FB tokens for post ${(post as any).id} — marking missed`);
        await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ? WHERE id = ?')
          .bind('Missed', reason, (post as any).id).run();
        await notifyOwnerOnPublishFailure(env, post as any, reason);
        continue;
      }

      const hashtags = (post as any).hashtags ? JSON.parse((post as any).hashtags as string) : [];
      const contentText = (post as any).content as string;
      // Strip any trailing hashtags from content (idempotent: handles inline hashtags and double-appended cases)
      const cleanContent = contentText.replace(/(\s+#\w+)+\s*$/, '').trim();
      const fullText = hashtags.length > 0
        ? `${cleanContent}\n\n${hashtags.join(' ')}`
        : cleanContent;

      const base = 'https://graph.facebook.com/v21.0';
      const pageId = tokens.facebookPageId;
      const token = tokens.facebookPageAccessToken;

      // ── JIT image backfill ────────────────────────────────────────────────
      // Smart Schedule fires Promise.all over a batch of posts — if the user is
      // accepting 14+ posts at once, the fal-proxy 20/min/user rate limit drops
      // some of them on the floor, the catch silently swallows the error, and
      // the post lands with image_url=NULL. Without this block the publish
      // cron would fall through to text-only-fallback every time. Generate the
      // image just before publishing instead, paced + capped so a stampede can't
      // exhaust the cron's wall-time budget.
      let imageUrl: string | null = ((post as any).image_url || null) as string | null;
      const rawPrompt = (post as any).image_prompt as string | null;
      // Cron's claim step appends "|claim:UUID" to image_prompt to track who owns
      // the post — strip that to recover the actual prompt.
      const promptForGen = rawPrompt ? rawPrompt.split('|claim:')[0].trim() : '';
      const needsImage = !imageUrl
        && promptForGen
        && promptForGen !== 'N/A'
        && promptForGen.length > 5;
      if (needsImage && env.FAL_API_KEY && jitGenerated < MAX_JIT_IMAGES_PER_RUN) {
        // Validated, UI-safe prompt (see buildSafeImagePrompt at top of
        // file). Mirrors the validation in src/services/gemini.ts so JIT-
        // generated images look the same as accept-time images (candid
        // iPhone vibe) AND don't render as pricing-table mockups when the
        // post topic is promotional/SaaS. Returns null for prompts too
        // short/invalid to be useful — in that case we skip image gen
        // entirely and the post publishes text-only (same outcome as if
        // the fal.ai call had failed, which is non-fatal here).
        const finalPrompt = buildSafeImagePrompt(promptForGen);
        if (finalPrompt) try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 15000);
          const falRes = await fetch('https://fal.run/fal-ai/flux/dev', {
            method: 'POST',
            headers: { Authorization: `Key ${env.FAL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: finalPrompt, image_size: 'square_hd',
              num_inference_steps: 25, num_images: 1,
              enable_safety_checker: true, guidance_scale: 3.5,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(timeout);
          const falData: any = await falRes.json();
          const generatedUrl = falData?.images?.[0]?.url;
          if (falRes.ok && generatedUrl) {
            imageUrl = generatedUrl;
            // Persist so a re-publish or the dashboard sees it without re-spending fal credits.
            await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?')
              .bind(generatedUrl, (post as any).id).run();
            jitGenerated++;
            console.log(`[CRON] JIT-generated image for post ${(post as any).id} (${jitGenerated}/${MAX_JIT_IMAGES_PER_RUN})`);
          } else {
            console.warn(`[CRON] JIT image gen returned no URL for post ${(post as any).id}: ${falData?.detail || falData?.message || falRes.status}`);
          }
        } catch (e: any) {
          // Don't fail the publish if image gen fails — still better to send text than nothing.
          console.warn(`[CRON] JIT image gen failed for post ${(post as any).id}: ${e?.message}`);
        }
      } else if (needsImage && jitGenerated >= MAX_JIT_IMAGES_PER_RUN) {
        // Post still publishes (better than missing the slot). The cap is a wall-time
        // safety valve — in practice 5+ images stuck in one batch is rare; the bulk
        // of misses come from Smart Schedule's 14-post Promise.all, which spaces out
        // by scheduled_for so they don't all hit the same cron tick.
        console.log(`[CRON] Post ${(post as any).id} needs image but JIT cap reached — publishing text-only this tick`);
      }

      let publishMethod = 'text-only';

      let fbRes: Response | null = null;

      if (imageUrl && imageUrl.startsWith('http')) {
        // Download image and upload via manual multipart body construction.
        // CF Workers FormData API silently drops binary data in cron context,
        // so we build the multipart body from raw bytes.
        try {
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const imageBuffer = await imgRes.arrayBuffer();
            const imageBytes = new Uint8Array(imageBuffer);
            console.log(`[CRON] Downloaded image (${imageBytes.length} bytes) for post ${(post as any).id}`);

            const boundary = '----CFBoundary' + Date.now();
            const enc = new TextEncoder();

            const head = enc.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="source"; filename="image.jpg"\r\n` +
              `Content-Type: image/jpeg\r\n\r\n`
            );
            const mid = enc.encode(
              `\r\n--${boundary}\r\n` +
              `Content-Disposition: form-data; name="message"\r\n\r\n` +
              fullText +
              `\r\n--${boundary}\r\n` +
              `Content-Disposition: form-data; name="published"\r\n\r\n` +
              `true` +
              `\r\n--${boundary}--\r\n`
            );

            const body = new Uint8Array(head.length + imageBytes.length + mid.length);
            body.set(head, 0);
            body.set(imageBytes, head.length);
            body.set(mid, head.length + imageBytes.length);

            fbRes = await fetch(`${base}/${pageId}/photos?access_token=${encodeURIComponent(token)}`, {
              method: 'POST',
              headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
              body: body,
            });
            publishMethod = `multipart-raw (${imageBytes.length}b)`;
            console.log(`[CRON] Multipart upload status: ${fbRes.status} for post ${(post as any).id}`);
          } else {
            console.warn(`[CRON] Image download returned ${imgRes.status} for post ${(post as any).id}`);
          }
        } catch (dlErr: any) {
          console.warn(`[CRON] Image download/upload failed for post ${(post as any).id}: ${dlErr.message}`);
        }
      }

      // Text-only fallback
      if (!fbRes) {
        fbRes = await fetch(`${base}/${pageId}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: fullText, access_token: token }),
        });
        publishMethod = 'text-only-fallback';
      }

      const fbText = await fbRes.text();
      console.log(`[CRON] FB response [${publishMethod}] for post ${(post as any).id}: ${fbText.substring(0, 300)}`);
      const fbData = JSON.parse(fbText);
      if (fbData.error) {
        throw new Error(`FB API [${publishMethod}]: ${fbData.error.message || JSON.stringify(fbData.error)}`);
      }

      // Log publish method to D1 for debugging
      await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ? WHERE id = ?')
        .bind('Posted', publishMethod, (post as any).id).run();
      console.log(`[CRON] Published post ${(post as any).id} via ${publishMethod} -> ${fbData.id || fbData.post_id || 'ok'}`);
    } catch (e: any) {
      const reason = friendlyPublishReason(e?.message || String(e));
      console.error(`[CRON] Failed to publish post ${(post as any).id}:`, e.message, e.stack);
      await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ? WHERE id = ?')
        .bind('Missed', reason, (post as any).id).run();
      await notifyOwnerOnPublishFailure(env, post as any, reason);
    }
  }
  return { posts_processed: posts.length };
}

// Translate raw FB Graph errors into a human sentence the user can act on.
// Keep originals for debugging — but the version we put in posts.reasoning
// (and the alert email) needs to read like advice, not a stack trace.
function friendlyPublishReason(raw: string): string {
  const r = (raw || '').toLowerCase();
  if (r.includes('expired') || r.includes('invalid_token') || r.includes('oauth') || r.includes('error validating access token')) {
    return 'Facebook token expired — reconnect Facebook in Settings (takes 30 sec).';
  }
  if (r.includes('not found') || r.includes('does not exist') || r.includes('unknown path')) {
    return 'Facebook page not found — it may have been deleted, renamed, or disconnected.';
  }
  if (r.includes('permission') || r.includes('forbidden') || r.includes('manage_pages') || r.includes('pages_manage_posts')) {
    return 'Facebook permission denied — reconnect Facebook and grant publishing permissions.';
  }
  if (r.includes('rate') && r.includes('limit')) {
    return 'Facebook rate limit hit — will retry on the next 5-min cron tick.';
  }
  if (r.includes('image') && (r.includes('download') || r.includes('upload'))) {
    return 'Image upload to Facebook failed — open Calendar and click Retry.';
  }
  return raw.slice(0, 200);
}

// Email the workspace owner when one of their posts fails to publish.
// Throttled to ONE email per workspace per hour — a 14-post Smart Schedule batch
// hitting an expired token shouldn't fire 14 emails. Uses cron_runs as a tiny
// KV store: a row of synthetic type `alert:fb_failure:<wsKey>` means "we sent
// for this workspace at this run_at." Query the latest within 1h to throttle.
async function notifyOwnerOnPublishFailure(
  env: Env,
  post: { id: string; user_id?: string | null; client_id?: string | null },
  reason: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const wsKey = post.client_id ? `client:${post.client_id}` : `user:${post.user_id ?? 'unknown'}`;
    const cronType = `alert:fb_failure:${wsKey}`.slice(0, 80);

    // Throttle — skip if we sent for this workspace in the last hour
    const recent = await env.DB.prepare(
      `SELECT 1 FROM cron_runs WHERE cron_type = ? AND run_at > datetime('now','-1 hour') LIMIT 1`,
    ).bind(cronType).first();
    if (recent) return;

    // Look up owner email + workspace name
    let email: string | null = null;
    let workspaceName = 'your workspace';
    if (post.client_id) {
      const row = await env.DB.prepare(
        `SELECT u.email as email, c.name as name FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      ).bind(post.client_id).first<{ email: string | null; name: string | null }>();
      email = row?.email ?? null;
      if (row?.name) workspaceName = row.name;
    } else if (post.user_id) {
      const row = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
        .bind(post.user_id).first<{ email: string | null }>();
      email = row?.email ?? null;
    }
    if (!email) return;

    const isTokenIssue = /token|expired|reconnect|permission|forbidden|connect facebook|page not found|manage_pages/i.test(reason);
    const fixCta = isTokenIssue
      ? `<a href="https://socialaistudio.au/admin" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Reconnect Facebook</a>`
      : `<a href="https://socialaistudio.au" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Open Calendar</a>`;

    await sendResendEmail(env, {
      to: email,
      subject: `Heads up — a scheduled post couldn't publish to Facebook`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="margin:0 0 8px;color:#dc2626;">A scheduled post didn't go out</h2>
        <p style="margin:0 0 16px;color:#374151;">A post for <strong>${escapeHtml(workspaceName)}</strong> was scheduled but couldn't be published to Facebook.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
          <strong>Reason:</strong><br/><span style="color:#374151;">${escapeHtml(reason)}</span>
        </div>
        ${isTokenIssue
          ? `<p style="margin:0 0 16px;color:#374151;">This usually means your Facebook page connection has expired. It takes 30 seconds to reconnect — click below.</p>`
          : `<p style="margin:0 0 16px;color:#374151;">Open your calendar to retry the post or check what went wrong.</p>`}
        <p>${fixCta}</p>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">We only send one of these per workspace per hour, so you won't get spammed if multiple posts queue up.</p>
      </div>`,
    });

    // Mark sent — doubles as a 1-hour throttle window
    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms) VALUES (?,1,0,?,0)`,
    ).bind(cronType, reason.slice(0, 200)).run();
    console.log(`[CRON] Sent publish-failure alert to ${email} for post ${post.id}`);
  } catch (e: any) {
    // Never let alert plumbing kill the publish path — log and move on
    console.error(`[CRON] notifyOwnerOnPublishFailure error: ${e?.message || e}`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Pre-warm images for posts scheduled in the next 30 minutes. Runs at the start
// of every */5 publish cron tick BEFORE the publish loop. The goal: by the time
// publish cron picks up a post (scheduled_for <= now), its image_url is already
// populated, so the publish loop's MAX_JIT_IMAGES_PER_RUN cap never bites.
//
// Capped at 8 per tick — fal.ai is ~10-15s/image so 8 fits comfortably in the
// CF Workers wall-time budget alongside the publish loop's own work. A post not
// reached this tick gets picked up in the next 5-min tick (still 25 min before
// publish time).
async function cronPrewarmImages(env: Env): Promise<{ posts_processed: number }> {
  if (!env.FAL_API_KEY) return { posts_processed: 0 };
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');
  const in30AEST = new Date(Date.now() + 10 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString().replace('Z', '');
  const rows = await env.DB.prepare(
    `SELECT id, image_prompt FROM posts
     WHERE status = 'Scheduled'
       AND scheduled_for > ? AND scheduled_for <= ?
       AND (image_url IS NULL OR image_url = '')
       AND image_prompt IS NOT NULL AND image_prompt != '' AND image_prompt != 'N/A'
       AND length(image_prompt) > 5
       AND ${ACTIVE_CLIENT_FILTER}
     ORDER BY scheduled_for ASC LIMIT 8`,
  ).bind(nowAEST, in30AEST).all();
  const posts = rows.results ?? [];
  if (posts.length === 0) return { posts_processed: 0 };
  console.log(`[CRON prewarm] ${posts.length} posts queued for image pre-warm`);

  let generated = 0;
  for (const post of posts) {
    const rawPrompt = (post as any).image_prompt as string | null;
    const prompt = rawPrompt ? rawPrompt.split('|claim:')[0].trim() : '';
    if (!prompt || prompt.length < 5) continue;
    try {
      // Validated, UI-safe prompt (see buildSafeImagePrompt at top of file).
      // All three server-side image-gen paths now share the same validation:
      //   1. backfillImagesForUser (admin manual catch-up)
      //   2. cronPublishMissedPosts JIT (publish-time backfill)
      //   3. this image pre-warm cron (proactive ahead-of-publish)
      const finalPrompt = buildSafeImagePrompt(prompt);
      if (!finalPrompt) {
        console.warn(`[CRON prewarm] skipped post ${(post as any).id}: prompt too short or invalid`);
        continue;
      }

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      const falRes = await fetch('https://fal.run/fal-ai/flux/dev', {
        method: 'POST',
        headers: { Authorization: `Key ${env.FAL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt, image_size: 'square_hd',
          num_inference_steps: 25, num_images: 1,
          enable_safety_checker: true, guidance_scale: 3.5,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      const data: any = await falRes.json();
      const url = data?.images?.[0]?.url;
      if (falRes.ok && url) {
        await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?')
          .bind(url, (post as any).id).run();
        generated++;
        console.log(`[CRON prewarm] generated for post ${(post as any).id}`);
      } else {
        console.warn(`[CRON prewarm] no URL for post ${(post as any).id}: ${data?.detail || data?.message || falRes.status}`);
      }
    } catch (e: any) {
      console.warn(`[CRON prewarm] failed for post ${(post as any).id}: ${e?.message}`);
    }
  }
  return { posts_processed: generated };
}

// Daily — refresh client_facts for every workspace with a connected FB Page.
// Keeps the AI's ground-truth data current without the user clicking Refresh.
async function cronRefreshFacts(env: Env): Promise<{ posts_processed: number }> {
  const users = await env.DB.prepare(
    `SELECT id FROM users WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL`
  ).all();
  const clients = await env.DB.prepare(
    `SELECT id, user_id FROM clients WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL AND COALESCE(status,'active') != 'on_hold'`
  ).all();
  let processed = 0;
  for (const u of (users.results || [])) {
    try { await refreshFactsForWorkspace(env.DB, (u as any).id, null); processed++; }
    catch (e: any) { console.warn(`[CRON facts] user ${(u as any).id}: ${e.message}`); }
  }
  for (const cl of (clients.results || [])) {
    try { await refreshFactsForWorkspace(env.DB, (cl as any).user_id, (cl as any).id); processed++; }
    catch (e: any) { console.warn(`[CRON facts] client ${(cl as any).id}: ${e.message}`); }
  }
  console.log(`[CRON facts] refreshed ${processed} workspaces`);
  return { posts_processed: processed };
}

async function cronRefreshTokens(env: Env) {
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) { console.log('[CRON] No FB app credentials — skipping token refresh'); return; }

  // Collect all workspaces (users + clients) that have a longLivedUserToken
  const users = await env.DB.prepare('SELECT id, social_tokens FROM users WHERE social_tokens IS NOT NULL').all();
  const clients = await env.DB.prepare('SELECT id, social_tokens FROM clients WHERE social_tokens IS NOT NULL').all();
  const workspaces = [...(users.results ?? []).map((r: any) => ({ id: r.id, table: 'users', tokens: r.social_tokens })),
                       ...(clients.results ?? []).map((r: any) => ({ id: r.id, table: 'clients', tokens: r.social_tokens }))];

  let refreshed = 0, failed = 0;
  for (const ws of workspaces) {
    try {
      const tokens = JSON.parse(ws.tokens as string);
      if (!tokens.longLivedUserToken) continue;

      // Exchange for a fresh long-lived token
      const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokens.longLivedUserToken}`;
      const res = await fetch(exchangeUrl);
      const data = await res.json() as any;
      if (!data.access_token) { failed++; continue; }

      // Get fresh page tokens
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${data.access_token}`);
      const pagesData = await pagesRes.json() as any;
      const pages = pagesData.data || [];

      // Find the matching page
      const page = pages.find((p: any) => p.id === tokens.facebookPageId) || pages[0];
      if (!page) { failed++; continue; }

      const updated = {
        ...tokens,
        longLivedUserToken: data.access_token,
        facebookPageAccessToken: page.access_token,
        facebookPageId: page.id,
        facebookPageName: page.name,
        instagramBusinessAccountId: page.instagram_business_account?.id || tokens.instagramBusinessAccountId || '',
        instagramConnected: !!(page.instagram_business_account?.id || tokens.instagramBusinessAccountId),
      };

      const col = ws.table === 'users' ? 'users' : 'clients';
      await env.DB.prepare(`UPDATE ${col} SET social_tokens = ? WHERE id = ?`).bind(JSON.stringify(updated), ws.id).run();
      refreshed++;
    } catch (e: any) {
      console.error(`[CRON] Token refresh failed for ${ws.table}/${ws.id}:`, e.message);
      failed++;
    }
  }
  console.log(`[CRON] Token refresh complete: ${refreshed} refreshed, ${failed} failed`);

  // Alert if any failures
  if (failed > 0 && env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SocialAI Studio <noreply@socialaistudio.au>',
        to: 'steve@3dhub.au',
        subject: `Token refresh: ${failed} workspace(s) failed`,
        html: `<p>${refreshed} tokens refreshed, ${failed} failed. Check worker logs.</p>`,
      }),
    });
  }
}

async function cronCheckFalCredits(env: Env) {
  const apiKey = env.FAL_API_KEY;
  const resendKey = env.RESEND_API_KEY;
  if (!apiKey || !resendKey) return;

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
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a></div>`,
        }),
      });
      console.log(`[CRON] Low balance alert sent ($${balance})`);
    }
  } catch (e: any) {
    console.error('[CRON] Credit check failed:', e.message);
  }
}

// Wrap a cron function with try/catch + duration tracking + cron_runs logging.
// Returns void; never throws (so a failure in one cron doesn't kill the worker).
async function trackCron(
  env: Env,
  cronType: string,
  fn: () => Promise<{ posts_processed?: number } | void>,
): Promise<void> {
  const start = Date.now();
  let success = 1;
  let posts = 0;
  let error: string | null = null;
  try {
    const result = await fn();
    posts = result?.posts_processed ?? 0;
  } catch (e: any) {
    success = 0;
    error = (e?.message || String(e)).slice(0, 1000);
    console.error(`[CRON ${cronType}] FAILED:`, error);
  }
  const duration = Date.now() - start;
  try {
    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms)
       VALUES (?,?,?,?,?)`
    ).bind(cronType, success, posts, error, duration).run();
  } catch (logErr: any) {
    console.error(`[CRON ${cronType}] Failed to log run:`, logErr?.message);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const cron = event.cron;
    // Every 5 minutes — pre-warm images first (so publish cron always finds
    // image_url populated for posts due in the next 30 min), then publish.
    if (cron === '*/5 * * * *') {
      await trackCron(env, 'prewarm_images', () => cronPrewarmImages(env));
      await trackCron(env, 'publish', () => cronPublishMissedPosts(env));
      return;
    }
    // Daily at 3am UTC — refresh Facebook tokens
    if (cron === '0 3 * * *') {
      await trackCron(env, 'token_refresh', () => cronRefreshTokens(env));
      return;
    }
    // Daily at 4am UTC — refresh client_facts from connected Facebook Pages
    if (cron === '0 4 * * *') {
      await trackCron(env, 'facts_refresh', () => cronRefreshFacts(env));
      return;
    }
    // Fallback: run all (for 6-hourly credit check and any unmatched triggers)
    await trackCron(env, 'prewarm_fallback', () => cronPrewarmImages(env));
    await trackCron(env, 'publish_fallback', () => cronPublishMissedPosts(env));
    await trackCron(env, 'fal_credits', () => cronCheckFalCredits(env));
  },
};
