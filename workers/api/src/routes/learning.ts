import type { Hono } from 'hono';
import type { Env } from '../env';
import { listDecisionReceipts } from '../lib/learning/decision-repository';
import {
  normalizeWorkspaceIdentity,
  type LearningMode,
  type WorkspaceIdentity,
  type WorkspaceOwnerKind,
} from '../lib/learning/types';
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';
import {
  getWorkspaceLearningSettings,
  loadWorkspaceLearningMode,
  saveWorkspaceLearningSettings,
  type StoredWorkspaceLearningSettings,
} from '../lib/learning/workspace-mode';
import { ensureWorkspaceLearningSettings } from '../lib/provisioning';
import { requireAuth } from '../middleware/auth';
import { createTrackingLink } from './tracking';

type OwnedPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
};

type DecisionRow = Record<string, unknown> & {
  id: string;
  summary_json?: string | null;
};

type VerdictRow = Record<string, unknown> & {
  decision_id: string;
  evidence_json?: string | null;
  repair_json?: string | null;
};

type BackfillWorkspaceRow = {
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonStrings(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Request body must be an object');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body must be an object') throw error;
    throw new Error('Invalid JSON body');
  }
}

function requestedClientId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalPostIdentity(
  post: OwnedPostRow,
  authenticatedUserId: string,
  clientId: string | null,
  allowShop = false,
): WorkspaceIdentity | null {
  const postClientId = post.client_id?.trim() || null;
  if (post.user_id !== authenticatedUserId || postClientId !== clientId) return null;
  const kind: WorkspaceOwnerKind = post.owner_kind === 'shop'
    ? 'shop'
    : postClientId === null ? 'user' : 'client';
  if ((!allowShop && kind === 'shop') || (post.owner_kind && post.owner_kind !== kind)) return null;
  try {
    return normalizeWorkspaceIdentity(
      authenticatedUserId,
      postClientId,
      kind,
      post.owner_id?.trim() || postClientId || authenticatedUserId,
    );
  } catch {
    return null;
  }
}

async function ownedPost(
  db: D1Database,
  postId: string,
  userId: string,
): Promise<OwnedPostRow | null> {
  return db.prepare(`
    SELECT id, user_id, client_id, owner_kind, owner_id
    FROM posts
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).bind(postId, userId).first<OwnedPostRow>();
}

const FEEDBACK_FIELDS = [
  'calls', 'messages', 'leads', 'bookings', 'sales', 'orderValueCents',
] as const;
type FeedbackField = typeof FEEDBACK_FIELDS[number];

function readMetric(body: Record<string, unknown>, key: FeedbackField): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value < 0) throw new Error(`${key} must be non-negative`);
  return value;
}

async function ownedSettingsIdentity(
  db: D1Database,
  userId: string,
  clientId: string | null,
): Promise<WorkspaceIdentity | null> {
  const identity = normalizeWorkspaceIdentity(
    userId,
    clientId,
    clientId === null ? 'user' : 'client',
    clientId ?? userId,
  );
  if (identity.ownerKind === 'client') {
    const client = await db.prepare(
      'SELECT status FROM clients WHERE id = ? AND user_id = ?',
    ).bind(identity.ownerId, identity.userId).first<{ status: string | null }>();
    if (!client) return null;
  }
  return identity;
}

function publicSettings(
  settings: StoredWorkspaceLearningSettings,
  fallbackMode: LearningMode,
): Record<string, unknown> {
  return {
    mode: typeof settings.mode === 'string' ? settings.mode : fallbackMode,
    autopublishConsentAt: settings.autopublishConsentAt ?? null,
    autopublishPolicyVersion: settings.autopublishPolicyVersion ?? null,
    experimentRate: Number.isFinite(settings.experimentRate) ? settings.experimentRate : 0,
    monthlyAiBudgetUsdCents: settings.monthlyAiBudgetUsdCents ?? null,
    disabledReason: settings.disabledReason ?? null,
    exists: settings.exists,
  };
}

function experimentRate(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 0.2) {
    throw new Error('experimentRate must be between 0 and 0.2');
  }
  return value;
}

function budgetCents(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('monthlyAiBudgetUsdCents must be a non-negative integer or null');
  }
  return value;
}

async function learningAdmin(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT email, is_admin FROM users WHERE id = ?',
  ).bind(userId).first<{ email: string | null; is_admin: number }>();
  return row?.is_admin === 1;
}

function releaseOwnerKind(value: string): WorkspaceOwnerKind | null {
  return value === 'user' || value === 'client' || value === 'shop' ? value : null;
}

function latestReadiness(db: D1Database) {
  return db.prepare(`
    SELECT id, ready, metrics_json, checks_json, evaluated_by, evaluated_at
    FROM learning_release_readiness
    WHERE policy_version = ?
    ORDER BY evaluated_at DESC, id DESC
    LIMIT 1
  `).bind(AUTOPILOT_POLICY_VERSION).first<{
    id: string;
    ready: number;
    metrics_json: string;
    checks_json: string;
    evaluated_by: string;
    evaluated_at: string;
  }>();
}

export function registerLearningRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/learning/*', requireAuth);

  app.get('/api/learning/settings', async (c) => {
    const userId = c.get('uid') as string;
    const clientId = c.req.query('clientId')?.trim() || null;
    const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
    if (!identity) return c.json({ error: 'Not found' }, 404);
    const settings = await getWorkspaceLearningSettings(c.env.DB, identity);
    const effectiveMode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    );
    const fallbackMode: LearningMode = c.env.LEARNING_RELEASE_ENFORCEMENT === 'true'
      ? 'approval'
      : c.env.LEARNING_BRAIN_ENABLED === 'true' ? 'shadow' : 'off';
    return c.json({ settings: publicSettings(settings, fallbackMode), effectiveMode });
  });

  app.put('/api/learning/settings', async (c) => {
    const userId = c.get('uid') as string;
    try {
      const body = await jsonBody(c.req.raw);
      const clientId = requestedClientId(body.clientId);
      const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      if (body.mode !== 'approval' && body.mode !== 'protected_autopilot') {
        return c.json({ error: 'mode must be approval or protected_autopilot' }, 400);
      }
      const current = await getWorkspaceLearningSettings(c.env.DB, identity);
      const rate = experimentRate(body.experimentRate, Number(current.experimentRate ?? 0));
      const budget = budgetCents(
        body.monthlyAiBudgetUsdCents,
        current.monthlyAiBudgetUsdCents ?? null,
      );
      const now = new Date().toISOString();
      let mode: LearningMode;
      let consentAt: string | null;
      let policyVersion: string | null;
      if (body.mode === 'protected_autopilot') {
        const alreadyConsented = current.autopublishConsentAt != null
          && current.autopublishPolicyVersion === AUTOPILOT_POLICY_VERSION;
        if (body.consent !== true && !alreadyConsented) {
          return c.json({ error: 'Explicit current-policy consent is required' }, 400);
        }
        if (!Number.isSafeInteger(budget) || Number(budget) <= 0) {
          return c.json({ error: 'Protected Autopilot requires a positive monthly AI budget' }, 400);
        }
        mode = 'protected_autopilot';
        consentAt = alreadyConsented ? current.autopublishConsentAt! : now;
        policyVersion = AUTOPILOT_POLICY_VERSION;
      } else {
        mode = c.env.LEARNING_RELEASE_ENFORCEMENT === 'true' ? 'approval' : 'shadow';
        consentAt = null;
        policyVersion = null;
      }
      await saveWorkspaceLearningSettings(c.env.DB, identity, {
        mode,
        autopublishConsentAt: consentAt,
        autopublishPolicyVersion: policyVersion,
        experimentRate: rate,
        monthlyAiBudgetUsdCents: budget,
      }, now);
      const settings: StoredWorkspaceLearningSettings = {
        exists: true,
        mode,
        autopublishConsentAt: consentAt,
        autopublishPolicyVersion: policyVersion,
        experimentRate: rate,
        monthlyAiBudgetUsdCents: budget,
        disabledReason: null,
      };
      const effectiveMode = await loadWorkspaceLearningMode(
        c.env,
        identity.userId,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
      );
      return c.json({ settings: publicSettings(settings, mode), effectiveMode });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.post('/api/learning/settings/backfill', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    try {
      const body = await jsonBody(c.req.raw);
      const unexpected = Object.keys(body).filter(
        (key) => key !== 'apply' && key !== 'limit',
      );
      if (unexpected.length > 0) {
        return c.json({
          error: 'Backfill accepts only apply and limit; consent is never migrated here',
        }, 400);
      }
      if (body.apply !== undefined && typeof body.apply !== 'boolean') {
        return c.json({ error: 'apply must be boolean' }, 400);
      }
      const limit = body.limit === undefined ? 50 : body.limit;
      if (
        typeof limit !== 'number'
        || !Number.isSafeInteger(limit)
        || limit < 1
        || limit > 200
      ) {
        return c.json({ error: 'limit must be an integer between 1 and 200' }, 400);
      }

      const rows = await c.env.DB.prepare(`
        SELECT user_id, workspace_key, client_id, owner_kind, owner_id
          FROM (
            SELECT u.id AS user_id, '__owner__' AS workspace_key,
                   NULL AS client_id, 'user' AS owner_kind, u.id AS owner_id
              FROM users u
             WHERE NOT EXISTS (
               SELECT 1 FROM workspace_learning_settings w
                WHERE w.user_id = u.id AND w.workspace_key = '__owner__'
             )
            UNION ALL
            SELECT c.user_id, c.id AS workspace_key, c.id AS client_id,
                   'client' AS owner_kind, c.id AS owner_id
              FROM clients c
             WHERE COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
               AND NOT EXISTS (
                 SELECT 1 FROM workspace_learning_settings w
                  WHERE w.user_id = c.user_id AND w.workspace_key = c.id
               )
            UNION ALL
            SELECT LOWER(s.shop_domain) AS user_id,
                   'shop:' || LOWER(s.shop_domain) AS workspace_key,
                   NULL AS client_id, 'shop' AS owner_kind,
                   LOWER(s.shop_domain) AS owner_id
              FROM shopify_stores s
             WHERE s.uninstalled_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM workspace_learning_settings w
                  WHERE w.user_id = LOWER(s.shop_domain)
                    AND w.workspace_key = 'shop:' || LOWER(s.shop_domain)
               )
          ) missing
         ORDER BY owner_kind, user_id, workspace_key
         LIMIT ?
      `).bind(limit).all<BackfillWorkspaceRow>();

      const workspaces = rows.results ?? [];
      for (const row of workspaces) {
        const identity = normalizeWorkspaceIdentity(
          row.user_id,
          row.client_id,
          row.owner_kind,
          row.owner_id,
        );
        if (identity.workspaceKey !== row.workspace_key) {
          throw new Error(`Non-canonical backfill candidate: ${row.owner_kind}:${row.owner_id}`);
        }
      }

      let applied = 0;
      if (body.apply === true) {
        const now = new Date().toISOString();
        for (const row of workspaces) {
          if (await ensureWorkspaceLearningSettings(
            c.env.DB,
            row.user_id,
            row.client_id,
            row.owner_kind,
            row.owner_id,
            now,
          )) applied += 1;
        }
      }
      return c.json({
        dryRun: body.apply !== true,
        found: workspaces.length,
        applied,
        workspaces,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Backfill failed' }, 400);
    }
  });

  app.get('/api/learning/readiness', async (c) => {
    const userId = c.get('uid') as string;
    const clientId = c.req.query('clientId')?.trim() || null;
    const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
    if (!identity) return c.json({ error: 'Not found' }, 404);
    const row = await latestReadiness(c.env.DB);
    const effectiveMode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    );
    const ageMs = row ? Date.now() - Date.parse(row.evaluated_at) : Number.POSITIVE_INFINITY;
    return c.json({
      policyVersion: AUTOPILOT_POLICY_VERSION,
      ready: row?.ready === 1 && ageMs >= 0 && ageMs <= 20 * 60 * 1000,
      stale: !row || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 20 * 60 * 1000,
      effectiveMode,
      evaluatedAt: row?.evaluated_at ?? null,
      checks: row ? parseJsonObject(row.checks_json) : {},
      metrics: row ? parseJsonObject(row.metrics_json) : {},
    });
  });

  app.post('/api/learning/decisions/:decisionId/adjudicate', async (c) => {
    const adjudicator = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adjudicator))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    try {
      const body = await jsonBody(c.req.raw);
      if (!['pass_green', 'hold_amber', 'block_red'].includes(String(body.expectedState))) {
        return c.json({ error: 'Invalid expectedState' }, 400);
      }
      if (body.severity !== 'advisory' && body.severity !== 'release_critical') {
        return c.json({ error: 'Invalid severity' }, 400);
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note || note.length > 2000) return c.json({ error: 'note is required' }, 400);
      const decisionId = c.req.param('decisionId');
      const decision = await c.env.DB.prepare(`
        SELECT id,user_id,workspace_key,client_id,owner_kind,owner_id
        FROM learning_decisions
        WHERE id = ? AND stage = 'release'
        LIMIT 1
      `).bind(decisionId).first<{
        id: string;
        user_id: string;
        workspace_key: string;
        client_id: string | null;
        owner_kind: string;
        owner_id: string;
      }>();
      const kind = decision && releaseOwnerKind(decision.owner_kind);
      if (!decision || !kind) return c.json({ error: 'Not found' }, 404);
      const identity = normalizeWorkspaceIdentity(
        decision.user_id,
        decision.client_id,
        kind,
        decision.owner_id,
      );
      if (identity.workspaceKey !== decision.workspace_key) {
        return c.json({ error: 'Not found' }, 404);
      }
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO learning_adjudications (
          id,decision_id,user_id,workspace_key,client_id,owner_kind,owner_id,
          expected_state,severity,note,adjudicated_by,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        decision.id,
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        body.expectedState,
        body.severity,
        note,
        adjudicator,
        new Date().toISOString(),
      ).run();
      return c.json({ adjudicationId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      return c.json({ error: message }, /unique/i.test(message) ? 409 : 400);
    }
  });

  app.post('/api/learning/readiness/evidence', async (c) => {
    const recorder = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, recorder))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    try {
      const body = await jsonBody(c.req.raw);
      if ('ready' in body || 'overallReady' in body) {
        return c.json({ error: 'Overall readiness is calculated server-side' }, 400);
      }
      const evidenceKinds = new Set([
        'replay_red_team', 'staging_green', 'staging_block', 'kill_switch', 'publish_regression',
      ]);
      const kind = typeof body.evidenceKind === 'string' ? body.evidenceKind : '';
      if (!evidenceKinds.has(kind)) return c.json({ error: 'Invalid evidenceKind' }, 400);
      if (typeof body.passed !== 'boolean') return c.json({ error: 'passed must be boolean' }, 400);
      const staging = kind === 'staging_green' || kind === 'staging_block';
      const ownerKind = typeof body.ownerKind === 'string'
        ? releaseOwnerKind(body.ownerKind)
        : null;
      if ((staging && !ownerKind) || (!staging && body.ownerKind != null)) {
        return c.json({ error: 'ownerKind is required only for staging evidence' }, 400);
      }
      const artifactHash = typeof body.artifactHash === 'string'
        ? body.artifactHash.trim().toLowerCase()
        : '';
      if (!/^[a-f0-9]{64}$/.test(artifactHash)) {
        return c.json({ error: 'artifactHash must be a SHA-256 hex digest' }, 400);
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note || note.length > 2000) return c.json({ error: 'note is required' }, 400);
      const now = new Date();
      const defaultExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const expiresAt = body.expiresAt === undefined
        ? defaultExpiry
        : new Date(String(body.expiresAt));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
        return c.json({ error: 'expiresAt must be in the future' }, 400);
      }
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO learning_release_evidence (
          id,policy_version,evidence_kind,owner_kind,passed,artifact_hash,note,
          recorded_by,recorded_at,expires_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        AUTOPILOT_POLICY_VERSION,
        kind,
        ownerKind,
        body.passed ? 1 : 0,
        artifactHash,
        note,
        recorder,
        now.toISOString(),
        expiresAt.toISOString(),
      ).run();
      return c.json({ evidenceId: id, policyVersion: AUTOPILOT_POLICY_VERSION });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.get('/api/learning/decisions/:postId', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    const requestedClientId = c.req.query('clientId')?.trim() || null;
    const post = await c.env.DB.prepare(`
      SELECT id, user_id, client_id, owner_kind, owner_id
      FROM posts
      WHERE id = ? AND user_id = ?
    `).bind(postId, userId).first<OwnedPostRow>();

    if (!post) {
      return c.json({ error: 'Not found' }, 404);
    }

    const clientId = post.client_id?.trim() || null;
    if (requestedClientId !== clientId) {
      return c.json({ error: 'Not found' }, 404);
    }

    const ownerKind: WorkspaceOwnerKind = post.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    if (post.owner_kind && post.owner_kind !== ownerKind) {
      return c.json({ error: 'Not found' }, 404);
    }
    const ownerId = post.owner_id?.trim() || clientId || userId;

    try {
      const decisions = await listDecisionReceipts(
        c.env.DB,
        userId,
        clientId,
        postId,
        20,
        ownerKind,
        ownerId,
      ) as DecisionRow[];
      if (decisions.length === 0) return c.json({ decisions: [] });

      // Decision ids come only from the tenant-scoped parent query above.
      // Verdict rows therefore cannot be fetched by an arbitrary id supplied
      // by the browser.
      const decisionIds = decisions.map((decision) => decision.id);
      const placeholders = decisionIds.map(() => '?').join(',');
      const verdictResult = await c.env.DB.prepare(`
        SELECT * FROM learning_critic_verdicts
        WHERE decision_id IN (${placeholders})
        ORDER BY decision_id, attempt ASC, critic_kind ASC
      `).bind(...decisionIds).all<VerdictRow>();
      const verdictsByDecision = new Map<string, Array<Record<string, unknown>>>();
      for (const verdict of verdictResult.results ?? []) {
        const normalized = {
          ...verdict,
          evidence: parseJsonStrings(verdict.evidence_json),
          repairs: parseJsonStrings(verdict.repair_json),
        };
        const rows = verdictsByDecision.get(verdict.decision_id) ?? [];
        rows.push(normalized);
        verdictsByDecision.set(verdict.decision_id, rows);
      }

      return c.json({
        decisions: decisions.map((decision) => ({
          ...decision,
          summary: parseJsonObject(decision.summary_json),
          verdicts: verdictsByDecision.get(decision.id) ?? [],
        })),
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  app.post('/api/learning/posts/:postId/tracking-link', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    try {
      const body = await jsonBody(c.req.raw);
      const clientId = requestedClientId(body.clientId);
      const post = await ownedPost(c.env.DB, postId, userId);
      const identity = post && canonicalPostIdentity(post, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      if (typeof body.destinationUrl !== 'string') {
        return c.json({ error: 'destinationUrl is required' }, 400);
      }
      const expiresAt = body.expiresAt === undefined || body.expiresAt === null
        ? null
        : typeof body.expiresAt === 'string' ? body.expiresAt : '__invalid__';
      const link = await createTrackingLink(c.env.DB, {
        identity,
        postId,
        destinationUrl: body.destinationUrl,
        expiresAt,
      });
      return c.json({ link });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.post('/api/learning/outcomes/:postId/feedback', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    try {
      const body = await jsonBody(c.req.raw);
      const metrics = Object.fromEntries(
        FEEDBACK_FIELDS.map((key) => [key, readMetric(body, key)]),
      ) as Record<FeedbackField, number | null>;
      if (FEEDBACK_FIELDS.every((key) => metrics[key] === null)) {
        return c.json({ error: 'At least one feedback metric is required' }, 400);
      }
      const clientId = requestedClientId(body.clientId);
      const post = await ownedPost(c.env.DB, postId, userId);
      const identity = post && canonicalPostIdentity(post, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO conversion_feedback (
          id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
          calls,messages,leads,bookings,sales,order_value_cents,source,recorded_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        postId,
        metrics.calls,
        metrics.messages,
        metrics.leads,
        metrics.bookings,
        metrics.sales,
        metrics.orderValueCents,
        'owner',
        new Date().toISOString(),
      ).run();
      return c.json({ ok: true, feedbackId: id });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });
}
