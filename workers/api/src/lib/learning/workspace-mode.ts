import type { Env } from '../../env';
import {
  LEARNING_MODES,
  normalizeWorkspaceIdentity,
  type LearningMode,
  type WorkspaceLearningSettings,
  type WorkspaceOwnerKind,
} from './types';

export function resolveLearningMode(
  globalFlag: string | undefined,
  settings: WorkspaceLearningSettings,
): LearningMode {
  if (globalFlag !== 'true') return 'off';
  return LEARNING_MODES.includes(settings.mode as LearningMode)
    ? settings.mode as LearningMode
    : 'shadow';
}

export async function loadWorkspaceLearningMode(
  env: Env,
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
): Promise<LearningMode> {
  if (env.LEARNING_BRAIN_ENABLED !== 'true') return 'off';

  let identity;
  try {
    identity = normalizeWorkspaceIdentity(userId, clientId, ownerKind, ownerId);
  } catch {
    return 'off';
  }

  if (identity.ownerKind === 'client') {
    const client = await env.DB.prepare(
      'SELECT on_hold FROM clients WHERE id = ? AND user_id = ?',
    ).bind(identity.ownerId, identity.userId).first<{ on_hold: number | null }>();
    if (!client || Number(client.on_hold) === 1) return 'off';
  } else if (identity.ownerKind === 'shop') {
    const shop = await env.DB.prepare(
      'SELECT shop_domain FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL',
    ).bind(identity.ownerId).first<{ shop_domain: string }>();
    if (!shop) return 'off';
  }

  const row = await env.DB.prepare(
    `SELECT mode,autopublish_consent_at,autopublish_policy_version,experiment_rate,
            monthly_ai_budget_usd_cents,disabled_reason
       FROM workspace_learning_settings
      WHERE user_id = ? AND workspace_key = ?`,
  ).bind(identity.userId, identity.workspaceKey).first<Record<string, unknown>>();

  return resolveLearningMode(env.LEARNING_BRAIN_ENABLED, {
    mode: row?.mode,
    autopublishConsentAt: typeof row?.autopublish_consent_at === 'string'
      ? row.autopublish_consent_at : null,
    autopublishPolicyVersion: typeof row?.autopublish_policy_version === 'string'
      ? row.autopublish_policy_version : null,
    experimentRate: Number(row?.experiment_rate ?? 0),
    monthlyAiBudgetUsdCents: row?.monthly_ai_budget_usd_cents == null
      ? null : Number(row.monthly_ai_budget_usd_cents),
    disabledReason: typeof row?.disabled_reason === 'string' ? row.disabled_reason : null,
  });
}
