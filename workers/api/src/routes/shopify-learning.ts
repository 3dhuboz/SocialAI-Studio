import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import {
  normalizeWorkspaceIdentity,
  type LearningMode,
  type WorkspaceIdentity,
} from '../lib/learning/types';
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';
import { getWorkspaceLearningSummary } from '../lib/learning/read-model';
import { listDecisionReceipts } from '../lib/learning/decision-repository';
import {
  getWorkspaceLearningSettings,
  getWorkspaceMonthlyAiSpend,
  isProtectedAutopilotEligible,
  isProtectedExperimentRateTransitionAllowed,
  loadWorkspaceLearningMode,
  saveWorkspaceLearningSettings,
  type StoredWorkspaceLearningSettings,
} from '../lib/learning/workspace-mode';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';

const COUNT_FIELDS = ['calls', 'messages', 'leads', 'bookings', 'sales'] as const;
type CountField = typeof COUNT_FIELDS[number];
type FeedbackField = CountField | 'orderValueCents';
type FeedbackValues = Record<FeedbackField, number | null>;
type ShopifyContext = Context<{ Bindings: Env }>;

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

async function requireSession(c: ShopifyContext): Promise<VerifiedSession | Response> {
  const config = requireShopifyConfig(c.env);
  if (!config) return c.json({ error: 'Shopify app not configured' }, 500);

  const authorization = c.req.header('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(
    authorization.slice(7),
    config.key,
    config.secret,
  );
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

function readFeedback(body: unknown): FeedbackValues {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }

  const payload = body as Record<string, unknown>;
  const feedback = {} as FeedbackValues;
  const fields: readonly FeedbackField[] = [...COUNT_FIELDS, 'orderValueCents'];

  for (const field of fields) {
    const value = payload[field];
    if (value === undefined || value === null) {
      feedback[field] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative integer`);
    }
    feedback[field] = value;
  }

  if (fields.every((field) => feedback[field] === null)) {
    throw new Error('At least one feedback metric is required');
  }
  return feedback;
}

async function installedShopIdentity(
  env: Env,
  session: VerifiedSession,
): Promise<WorkspaceIdentity | null> {
  const identity = normalizeWorkspaceIdentity(
    session.shopDomain,
    null,
    'shop',
    session.shopDomain,
  );
  const installed = await env.DB.prepare(`
    SELECT shop_domain
    FROM shopify_stores
    WHERE shop_domain = ? AND uninstalled_at IS NULL
    LIMIT 1
  `).bind(identity.ownerId).first<{ shop_domain: string }>();
  return installed ? identity : null;
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

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be an object');
  }
  return value as Record<string, unknown>;
}

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

export function registerShopifyLearningRoutes(
  app: Hono<{ Bindings: Env }>,
): void {
  app.get('/api/shopify/learning/profile', async (c) => {
    const session = await requireSession(c);
    if (session instanceof Response) return session;
    const identity = await installedShopIdentity(c.env, session);
    if (!identity) return c.json({ error: 'Shop not installed' }, 404);
    return c.json(await getWorkspaceLearningSummary(c.env.DB, identity));
  });

  app.get('/api/shopify/learning/decisions/:postId', async (c) => {
    const session = await requireSession(c);
    if (session instanceof Response) return session;
    const identity = await installedShopIdentity(c.env, session);
    if (!identity) return c.json({ error: 'Shop not installed' }, 404);
    const postId = c.req.param('postId');
    const post = await c.env.DB.prepare(`
      SELECT id
        FROM posts
       WHERE id = ? AND user_id = ? AND client_id IS NULL
         AND owner_kind = 'shop' AND owner_id = ?
       LIMIT 1
    `).bind(
      postId,
      identity.userId,
      identity.ownerId,
    ).first<{ id: string }>();
    if (!post) return c.json({ error: 'Not found' }, 404);

    const decisions = await listDecisionReceipts(
      c.env.DB,
      identity.userId,
      null,
      postId,
      20,
      'shop',
      identity.ownerId,
    ) as Array<Record<string, unknown> & {
      id: string;
      summary_json?: string | null;
    }>;
    if (decisions.length === 0) return c.json({ decisions: [] });
    const ids = decisions.map((decision) => decision.id);
    const placeholders = ids.map(() => '?').join(',');
    const verdicts = await c.env.DB.prepare(`
      SELECT *
        FROM learning_critic_verdicts
       WHERE decision_id IN (${placeholders})
       ORDER BY decision_id, attempt ASC, critic_kind ASC
    `).bind(...ids).all<Record<string, unknown> & {
      decision_id: string;
      evidence_json?: string | null;
      repair_json?: string | null;
    }>();
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const verdict of verdicts.results ?? []) {
      const values = grouped.get(verdict.decision_id) ?? [];
      values.push({
        ...verdict,
        evidence: parseJsonStrings(verdict.evidence_json),
        repairs: parseJsonStrings(verdict.repair_json),
      });
      grouped.set(verdict.decision_id, values);
    }
    return c.json({
      decisions: decisions.map((decision) => ({
        ...decision,
        summary: parseJsonObject(decision.summary_json),
        verdicts: grouped.get(decision.id) ?? [],
      })),
    });
  });

  app.get('/api/shopify/learning/settings', async (c) => {
    const session = await requireSession(c);
    if (session instanceof Response) return session;
    const identity = await installedShopIdentity(c.env, session);
    if (!identity) return c.json({ error: 'Shop not installed' }, 404);
    const settings = await getWorkspaceLearningSettings(c.env.DB, identity);
    const effectiveMode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      null,
      'shop',
      identity.ownerId,
    );
    const fallbackMode: LearningMode = c.env.LEARNING_RELEASE_ENFORCEMENT === 'true'
      ? 'approval'
      : c.env.LEARNING_BRAIN_ENABLED === 'true' ? 'shadow' : 'off';
    return c.json({ settings: publicSettings(settings, fallbackMode), effectiveMode });
  });

  app.put('/api/shopify/learning/settings', async (c) => {
    const session = await requireSession(c);
    if (session instanceof Response) return session;
    const identity = await installedShopIdentity(c.env, session);
    if (!identity) return c.json({ error: 'Shop not installed' }, 404);
    try {
      const body = parseObject(await c.req.json());
      if (body.mode !== 'approval' && body.mode !== 'protected_autopilot') {
        return c.json({ error: 'mode must be approval or protected_autopilot' }, 400);
      }
      const current = await getWorkspaceLearningSettings(c.env.DB, identity);
      const rate = body.experimentRate === undefined
        ? Number(current.experimentRate ?? 0)
        : Number(body.experimentRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 0.2) {
        return c.json({ error: 'experimentRate must be between 0 and 0.2' }, 400);
      }
      const budget = body.monthlyAiBudgetUsdCents === undefined
        ? current.monthlyAiBudgetUsdCents ?? null
        : body.monthlyAiBudgetUsdCents;
      if (budget !== null && (
        typeof budget !== 'number'
        || !Number.isSafeInteger(budget)
        || budget < 0
      )) {
        return c.json({ error: 'monthlyAiBudgetUsdCents must be a non-negative integer or null' }, 400);
      }

      const requestedAt = new Date();
      const now = requestedAt.toISOString();
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
        if (!isProtectedExperimentRateTransitionAllowed(current, rate)) {
          return c.json({
            error: 'Protected Autopilot experiments must start at 0 and advance only to 0.10 then 0.15',
            code: 'protected_autopilot_experiment_ramp',
          }, 409);
        }
        const requestedConsentAt = alreadyConsented ? current.autopublishConsentAt! : now;
        if (!await isProtectedAutopilotEligible(c.env, identity, {
          mode: 'protected_autopilot',
          autopublishConsentAt: requestedConsentAt,
          autopublishPolicyVersion: AUTOPILOT_POLICY_VERSION,
          experimentRate: rate,
          monthlyAiBudgetUsdCents: budget as number,
          disabledReason: null,
        }, requestedAt)) {
          return c.json({
            error: 'Protected Autopilot is unavailable until every activation gate passes',
            code: 'protected_autopilot_not_ready',
          }, 409);
        }
        mode = 'protected_autopilot';
        consentAt = requestedConsentAt;
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
        monthlyAiBudgetUsdCents: budget as number | null,
      }, now);
      const settings: StoredWorkspaceLearningSettings = {
        exists: true,
        mode,
        autopublishConsentAt: consentAt,
        autopublishPolicyVersion: policyVersion,
        experimentRate: rate,
        monthlyAiBudgetUsdCents: budget as number | null,
        disabledReason: null,
      };
      const effectiveMode = await loadWorkspaceLearningMode(
        c.env,
        identity.userId,
        null,
        'shop',
        identity.ownerId,
      );
      return c.json({ settings: publicSettings(settings, mode), effectiveMode });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.get('/api/shopify/learning/readiness', async (c) => {
    const session = await requireSession(c);
    if (session instanceof Response) return session;
    const identity = await installedShopIdentity(c.env, session);
    if (!identity) return c.json({ error: 'Shop not installed' }, 404);
    const settings = await getWorkspaceLearningSettings(c.env.DB, identity);
    const cost = await getWorkspaceMonthlyAiSpend(c.env.DB, identity);
    const row = await c.env.DB.prepare(`
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
    const effectiveMode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      null,
      'shop',
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
      cost: {
        ...cost,
        monthlyAiBudgetUsdCents: settings.monthlyAiBudgetUsdCents ?? null,
        withinBudget: cost.monthlyAiSpendUsdCents != null
          && Number.isSafeInteger(settings.monthlyAiBudgetUsdCents)
          && Number(settings.monthlyAiBudgetUsdCents) > 0
          && cost.monthlyAiSpendUsdCents < Number(settings.monthlyAiBudgetUsdCents),
      },
      globalSwitches: {
        learningBrain: c.env.LEARNING_BRAIN_ENABLED === 'true',
        releaseEnforcement: c.env.LEARNING_RELEASE_ENFORCEMENT === 'true',
        protectedAutopilot: c.env.LEARNING_AUTOPILOT_ENABLED === 'true',
      },
    });
  });

  app.post('/api/shopify/learning/outcomes/:postId/feedback', async (c) => {
    const sessionOrResponse = await requireSession(c);
    if (sessionOrResponse instanceof Response) return sessionOrResponse;

    let feedback: FeedbackValues;
    try {
      const body = await c.req.json();
      feedback = readFeedback(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON body';
      return c.json({ error: message }, 400);
    }

    const identity = normalizeWorkspaceIdentity(
      sessionOrResponse.shopDomain,
      null,
      'shop',
      sessionOrResponse.shopDomain,
    );
    const postId = c.req.param('postId');
    const post = await c.env.DB.prepare(`
      SELECT id
      FROM posts
      WHERE id = ?
        AND user_id = ?
        AND client_id IS NULL
        AND owner_kind = 'shop'
        AND owner_id = ?
      LIMIT 1
    `).bind(
      postId,
      identity.userId,
      identity.ownerId,
    ).first<{ id: string }>();

    if (!post) return c.json({ error: 'Not found' }, 404);

    const feedbackId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO conversion_feedback (
        id, user_id, workspace_key, client_id, owner_kind, owner_id, post_id,
        calls, messages, leads, bookings, sales, order_value_cents, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      feedbackId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      postId,
      feedback.calls,
      feedback.messages,
      feedback.leads,
      feedback.bookings,
      feedback.sales,
      feedback.orderValueCents,
      'owner',
    ).run();

    return c.json({ feedbackId });
  });
}
