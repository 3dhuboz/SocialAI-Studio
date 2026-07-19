import type { Env } from '../../env';
import {
  LEARNING_MODES,
  normalizeWorkspaceIdentity,
  type LearningMode,
  type WorkspaceIdentity,
  type WorkspaceLearningSettings,
  type WorkspaceOwnerKind,
} from './types';
import { AUTOPILOT_POLICY_VERSION } from './readiness';

const READINESS_MAX_AGE_MS = 20 * 60 * 1000;

type LearningSettingsRow = {
  mode?: unknown;
  autopublish_consent_at?: unknown;
  autopublish_policy_version?: unknown;
  experiment_rate?: unknown;
  monthly_ai_budget_usd_cents?: unknown;
  disabled_reason?: unknown;
};

function settingsFromRow(row: LearningSettingsRow | null): WorkspaceLearningSettings {
  return {
    mode: row?.mode,
    autopublishConsentAt: typeof row?.autopublish_consent_at === 'string'
      ? row.autopublish_consent_at : null,
    autopublishPolicyVersion: typeof row?.autopublish_policy_version === 'string'
      ? row.autopublish_policy_version : null,
    experimentRate: Number(row?.experiment_rate ?? 0),
    monthlyAiBudgetUsdCents: row?.monthly_ai_budget_usd_cents == null
      ? null : Number(row.monthly_ai_budget_usd_cents),
    disabledReason: typeof row?.disabled_reason === 'string' ? row.disabled_reason : null,
  };
}

export interface StoredWorkspaceLearningSettings extends WorkspaceLearningSettings {
  exists: boolean;
}

export async function getWorkspaceLearningSettings(
  db: D1Database,
  identity: WorkspaceIdentity,
): Promise<StoredWorkspaceLearningSettings> {
  const row = await db.prepare(`
    SELECT mode,autopublish_consent_at,autopublish_policy_version,experiment_rate,
           monthly_ai_budget_usd_cents,disabled_reason
      FROM workspace_learning_settings
     WHERE user_id = ? AND workspace_key = ? AND client_id IS ?
       AND owner_kind = ? AND owner_id = ?
     LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
  ).first<LearningSettingsRow>();
  return { ...settingsFromRow(row), exists: row != null };
}

export async function saveWorkspaceLearningSettings(
  db: D1Database,
  identity: WorkspaceIdentity,
  settings: {
    mode: LearningMode;
    autopublishConsentAt: string | null;
    autopublishPolicyVersion: string | null;
    experimentRate: number;
    monthlyAiBudgetUsdCents: number | null;
  },
  now: string,
): Promise<void> {
  await db.prepare(`
    INSERT INTO workspace_learning_settings (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,mode,
      autopublish_consent_at,autopublish_policy_version,experiment_rate,
      monthly_ai_budget_usd_cents,disabled_reason,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)
    ON CONFLICT(user_id,workspace_key) DO UPDATE SET
      mode = excluded.mode,
      autopublish_consent_at = excluded.autopublish_consent_at,
      autopublish_policy_version = excluded.autopublish_policy_version,
      experiment_rate = excluded.experiment_rate,
      monthly_ai_budget_usd_cents = excluded.monthly_ai_budget_usd_cents,
      disabled_reason = NULL,
      updated_at = excluded.updated_at
    WHERE workspace_learning_settings.client_id IS excluded.client_id
      AND workspace_learning_settings.owner_kind = excluded.owner_kind
      AND workspace_learning_settings.owner_id = excluded.owner_id
  `).bind(
    crypto.randomUUID(),
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    settings.mode,
    settings.autopublishConsentAt,
    settings.autopublishPolicyVersion,
    settings.experimentRate,
    settings.monthlyAiBudgetUsdCents,
    now,
    now,
  ).run();
}

function currentMonthBounds(now: Date): [string, string] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [start.toISOString(), end.toISOString()];
}

export interface WorkspaceMonthlyAiSpend {
  monthlyAiSpendUsdCents: number | null;
  telemetryCount: number;
}

export async function getWorkspaceMonthlyAiSpend(
  db: D1Database,
  identity: WorkspaceIdentity,
  now: Date = new Date(),
): Promise<WorkspaceMonthlyAiSpend> {
  const [monthStart, monthEnd] = currentMonthBounds(now);
  const sql = identity.clientId === null
    ? `SELECT COALESCE(SUM(est_cost_usd), 0) AS spend_usd, COUNT(*) AS telemetry_count
         FROM ai_usage
        WHERE user_id = ? AND client_id IS NULL AND ts >= ? AND ts < ?`
    : `SELECT COALESCE(SUM(est_cost_usd), 0) AS spend_usd, COUNT(*) AS telemetry_count
         FROM ai_usage
        WHERE user_id = ? AND client_id = ? AND ts >= ? AND ts < ?`;
  const bindings = identity.clientId === null
    ? [identity.userId, monthStart, monthEnd]
    : [identity.userId, identity.clientId, monthStart, monthEnd];
  const row = await db.prepare(sql).bind(...bindings).first<{
    spend_usd: number | null;
    telemetry_count: number;
  }>();
  const spendUsd = Number(row?.spend_usd);
  const telemetryCount = Number(row?.telemetry_count ?? 0);
  if (
    !row
    || !Number.isSafeInteger(telemetryCount)
    || telemetryCount <= 0
    || !Number.isFinite(spendUsd)
    || spendUsd < 0
  ) {
    return { monthlyAiSpendUsdCents: null, telemetryCount: Math.max(0, telemetryCount || 0) };
  }
  return {
    monthlyAiSpendUsdCents: Math.round(spendUsd * 100),
    telemetryCount,
  };
}

export function resolveLearningMode(
  globalFlag: string | undefined,
  settings: WorkspaceLearningSettings,
): LearningMode {
  if (globalFlag !== 'true') return 'off';
  return LEARNING_MODES.includes(settings.mode as LearningMode)
    ? settings.mode as LearningMode
    : 'shadow';
}

export async function isProtectedAutopilotEligible(
  env: Env,
  identity: WorkspaceIdentity,
  settings: WorkspaceLearningSettings,
  now: Date = new Date(),
): Promise<boolean> {
  if (
    env.LEARNING_BRAIN_ENABLED !== 'true'
    || env.LEARNING_RELEASE_ENFORCEMENT !== 'true'
    || env.LEARNING_AUTOPILOT_ENABLED !== 'true'
  ) return false;

  const budgetCents = settings.monthlyAiBudgetUsdCents;
  if (
    settings.autopublishConsentAt == null
    || settings.autopublishPolicyVersion !== AUTOPILOT_POLICY_VERSION
    || !Number.isSafeInteger(budgetCents)
    || Number(budgetCents) <= 0
  ) return false;

  const readiness = await env.DB.prepare(`
    SELECT ready, policy_version, checks_json, evaluated_at
      FROM learning_release_readiness
     WHERE policy_version = ?
     ORDER BY evaluated_at DESC, id DESC
     LIMIT 1
  `).bind(AUTOPILOT_POLICY_VERSION).first<{
    ready: number;
    policy_version: string;
    checks_json: string;
    evaluated_at: string;
  }>();
  if (!readiness || readiness.ready !== 1 || readiness.policy_version !== AUTOPILOT_POLICY_VERSION) {
    return false;
  }
  const evaluatedAt = Date.parse(readiness.evaluated_at);
  const age = now.getTime() - evaluatedAt;
  if (!Number.isFinite(evaluatedAt) || age < 0 || age > READINESS_MAX_AGE_MS) {
    return false;
  }
  let parsedChecks: unknown;
  try {
    parsedChecks = JSON.parse(readiness.checks_json);
  } catch {
    return false;
  }
  if (!parsedChecks || typeof parsedChecks !== 'object' || Array.isArray(parsedChecks)) return false;
  const tenancyProofs = (parsedChecks as {
    tenancyProofs?: Partial<Record<WorkspaceOwnerKind, boolean>>;
  }).tenancyProofs;
  if (!tenancyProofs || typeof tenancyProofs !== 'object' || Array.isArray(tenancyProofs)) {
    return false;
  }
  if (tenancyProofs[identity.ownerKind] !== true) return false;

  const cost = await getWorkspaceMonthlyAiSpend(env.DB, identity, now);
  return cost.monthlyAiSpendUsdCents != null
    && cost.monthlyAiSpendUsdCents < Number(budgetCents);
}

export async function loadWorkspaceLearningMode(
  env: Env,
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
  now: Date = new Date(),
): Promise<LearningMode> {
  if (
    env.LEARNING_BRAIN_ENABLED !== 'true'
    && env.LEARNING_RELEASE_ENFORCEMENT !== 'true'
  ) return 'off';

  let identity;
  try {
    identity = normalizeWorkspaceIdentity(userId, clientId, ownerKind, ownerId);
  } catch {
    return 'off';
  }

  if (identity.ownerKind === 'client') {
    const client = await env.DB.prepare(
      'SELECT status FROM clients WHERE id = ? AND user_id = ?',
    ).bind(identity.ownerId, identity.userId).first<{ status: string | null }>();
    if (!client || client.status?.trim().toLowerCase() === 'on_hold') return 'off';
  } else if (identity.ownerKind === 'shop') {
    const shop = await env.DB.prepare(
      'SELECT shop_domain FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL',
    ).bind(identity.ownerId).first<{ shop_domain: string }>();
    if (!shop) return 'off';
  }

  const settings = await getWorkspaceLearningSettings(env.DB, identity);
  const requested = LEARNING_MODES.includes(settings.mode as LearningMode)
    ? settings.mode as LearningMode
    : null;

  if (requested !== 'protected_autopilot') {
    if (env.LEARNING_RELEASE_ENFORCEMENT === 'true') return 'approval';
    return resolveLearningMode(env.LEARNING_BRAIN_ENABLED, settings);
  }

  return await isProtectedAutopilotEligible(env, identity, settings, now)
    ? 'protected_autopilot'
    : 'approval';
}
