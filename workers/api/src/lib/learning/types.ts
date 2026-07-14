export const LEARNING_MODES = ['off', 'shadow', 'approval', 'protected_autopilot'] as const;

export type LearningMode = typeof LEARNING_MODES[number];
export type ReleaseState = 'pending' | 'pass_green' | 'hold_amber' | 'block_red' | 'shadow_only';
export type CriticVerdict = 'pass' | 'warn_repairable' | 'block' | 'unavailable';
export type CriticSeverity = 'advisory' | 'release_critical';
export type WorkspaceOwnerKind = 'user' | 'client' | 'shop';

export interface WorkspaceIdentity {
  userId: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  workspaceKey: string;
}

export interface WorkspaceLearningSettings {
  mode?: unknown;
  autopublishConsentAt?: string | null;
  autopublishPolicyVersion?: string | null;
  experimentRate?: number;
  monthlyAiBudgetUsdCents?: number | null;
  disabledReason?: string | null;
}

export function workspaceKey(
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string | null = null,
): string {
  if (ownerKind === 'shop') {
    const shop = ownerId?.trim().toLowerCase();
    if (!shop) throw new Error('Shop workspace requires ownerId');
    return `shop:${shop}`;
  }
  return clientId?.trim() || '__owner__';
}

export function normalizeWorkspaceIdentity(
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
): WorkspaceIdentity {
  const canonicalUserId = userId.trim();
  const canonicalOwnerId = ownerId.trim();
  if (!canonicalUserId) throw new Error('Workspace requires userId');

  if (ownerKind === 'shop') {
    const shop = canonicalOwnerId.toLowerCase();
    if (clientId !== null || !shop || shop !== canonicalUserId.toLowerCase()) {
      throw new Error('Invalid Shopify workspace identity');
    }
    return {
      userId: shop,
      clientId: null,
      ownerKind,
      ownerId: shop,
      workspaceKey: workspaceKey(null, ownerKind, shop),
    };
  }

  if (ownerKind === 'client') {
    const canonicalClientId = clientId?.trim();
    if (!canonicalClientId || canonicalOwnerId !== canonicalClientId) {
      throw new Error('Invalid client workspace identity');
    }
    return {
      userId: canonicalUserId,
      clientId: canonicalClientId,
      ownerKind,
      ownerId: canonicalClientId,
      workspaceKey: workspaceKey(canonicalClientId, ownerKind, canonicalClientId),
    };
  }

  if (clientId !== null || canonicalOwnerId !== canonicalUserId) {
    throw new Error('Invalid owner workspace identity');
  }
  return {
    userId: canonicalUserId,
    clientId: null,
    ownerKind,
    ownerId: canonicalUserId,
    workspaceKey: workspaceKey(null),
  };
}

export interface DecisionReceiptInput {
  userId: string;
  clientId: string | null;
  ownerKind?: WorkspaceOwnerKind;
  ownerId?: string;
  postId: string;
  mode: LearningMode;
  stage: 'snapshot' | 'text_preflight' | 'media_preflight' | 'release';
  releaseState: ReleaseState;
  contentHash: string;
  strategyVersion?: number | null;
  reachPlanId?: string | null;
  summary: Record<string, unknown>;
}
