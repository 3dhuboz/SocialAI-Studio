import type { Env } from '../env';
import {
  assessCriticContextReadiness,
  loadCriticContext,
  type CriticContext,
} from '../lib/learning/critic-context';
import {
  getRecordOnlyPilotBudgetStatus,
  runClaimedPilotEvaluation,
  type ClaimedPilotEvaluationResult,
  type PilotBudgetStatus,
} from '../lib/learning/pilot-evaluation';
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';
import type { PublishablePost } from '../lib/learning/release-preflight';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
  type WorkspaceOwnerKind,
} from '../lib/learning/types';

interface PilotCandidateRow {
  id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: string;
  owner_id: string;
  content: string;
  platform: string | null;
  hashtags: string | null;
  image_url: string | null;
  post_type: string | null;
  video_url: string | null;
  video_status: string | null;
  video_script: string | null;
  video_shots: string | null;
  archetype_slug: string | null;
  consent_basis: string | null;
  consent_confirmed_at: string | null;
  consent_note: string | null;
  monthly_ai_budget_usd_cents: number | string | null;
  client_status: string | null;
}

interface PilotCollectorDeps {
  loadCandidates(env: Env, now: Date): Promise<PilotCandidateRow[]>;
  getBudgetStatus(
    db: D1Database,
    identity: WorkspaceIdentity,
    budgetUsdCents: number,
    now: Date,
  ): Promise<PilotBudgetStatus>;
  loadContext(env: Env, identity: WorkspaceIdentity): Promise<CriticContext>;
  runEvaluation(env: Env, post: PublishablePost): Promise<ClaimedPilotEvaluationResult>;
}

export interface PilotCollectorResult {
  posts_processed: number;
  candidates_considered: number;
  evaluated: number;
  reused: number;
  claimed_elsewhere: number;
  budget_skipped: number;
  context_not_ready: number;
  invalid_skipped: number;
  errors: number;
}

const PILOT_CANDIDATE_SCAN_LIMIT = 10;
const PILOT_CANDIDATES_PER_OWNER_KIND = 5;
const PILOT_OWNER_KIND_LIMIT = 2;

async function loadPilotCandidates(env: Env, now: Date): Promise<PilotCandidateRow[]> {
  const rows = await env.DB.prepare(`
    WITH ranked AS (
      SELECT
        p.id,
        pen.user_id,
        pen.workspace_key,
        pen.client_id,
        pen.owner_kind,
        pen.owner_id,
        p.content,
        p.platform,
        p.hashtags,
        p.image_url,
        p.post_type,
        p.video_url,
        p.video_status,
        p.video_script,
        p.video_shots,
        COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug,
        pen.consent_basis,
        pen.consent_confirmed_at,
        pen.consent_note,
        w.monthly_ai_budget_usd_cents,
        c.status AS client_status,
        ROW_NUMBER() OVER (
          PARTITION BY pen.user_id, pen.workspace_key
          ORDER BY p.created_at ASC, p.id ASC
        ) AS workspace_rank
      FROM learning_pilot_enrollments pen
      INNER JOIN workspace_learning_settings w
        ON w.user_id = pen.user_id
       AND w.workspace_key = pen.workspace_key
       AND w.client_id IS pen.client_id
       AND w.owner_kind = pen.owner_kind
       AND w.owner_id = pen.owner_id
      INNER JOIN users u ON u.id = pen.user_id
      INNER JOIN posts p
        ON p.user_id = pen.user_id
       AND p.client_id IS pen.client_id
       AND p.status = 'Draft'
      LEFT JOIN clients c
        ON c.id = pen.client_id
       AND c.user_id = pen.user_id
      WHERE pen.policy_version = ?
        AND pen.record_only = 1
        AND pen.consent_confirmed_at IS NOT NULL
        AND pen.consent_confirmed_at <= ?
        AND w.mode = 'approval'
        AND w.monthly_ai_budget_usd_cents > 0
        AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
        AND (
          (
            pen.owner_kind = 'user'
            AND pen.consent_basis = 'owner_self'
            AND pen.client_id IS NULL
            AND pen.workspace_key = '__owner__'
            AND pen.owner_id = pen.user_id
            AND p.client_id IS NULL
            AND (p.owner_kind IS NULL OR p.owner_kind = 'user')
            AND (p.owner_id IS NULL OR TRIM(p.owner_id) = '' OR p.owner_id = pen.user_id)
          )
          OR (
            pen.owner_kind = 'client'
            AND pen.consent_basis = 'customer_attested'
            AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
            AND pen.client_id IS NOT NULL
            AND pen.workspace_key = pen.client_id
            AND pen.owner_id = pen.client_id
            AND c.id IS NOT NULL
            AND LOWER(TRIM(COALESCE(c.status, 'active'))) != 'on_hold'
            AND (p.owner_kind IS NULL OR p.owner_kind = 'client')
            AND (p.owner_id IS NULL OR TRIM(p.owner_id) = '' OR p.owner_id = pen.client_id)
          )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM learning_decisions d
           WHERE d.user_id = pen.user_id
             AND d.workspace_key = pen.workspace_key
             AND d.client_id IS pen.client_id
             AND d.owner_kind = pen.owner_kind
             AND d.owner_id = pen.owner_id
             AND d.post_id = p.id
             AND d.stage = 'release'
             AND d.release_state IN ('pass_green','hold_amber','block_red')
             AND CAST(
               COALESCE(json_extract(d.summary_json, '$.verdictCount'), -1)
               AS INTEGER
             ) = (
               SELECT COUNT(*)
                 FROM learning_critic_verdicts v
                WHERE v.decision_id = d.id
             )
             AND CAST(
               COALESCE(json_extract(d.summary_json, '$.verdictCount'), 0)
               AS INTEGER
             ) > 0
        )
    ),
    balanced AS (
      SELECT
        ranked.*,
        ROW_NUMBER() OVER (
          PARTITION BY owner_kind
          ORDER BY workspace_key, user_id
        ) AS owner_kind_rank
      FROM ranked
      WHERE workspace_rank = 1
    )
    SELECT *
      FROM balanced
     WHERE owner_kind_rank <= ${PILOT_CANDIDATES_PER_OWNER_KIND}
     ORDER BY
       owner_kind_rank,
       CASE owner_kind WHEN 'user' THEN 0 ELSE 1 END,
       workspace_key
     LIMIT ${PILOT_CANDIDATE_SCAN_LIMIT}
  `).bind(
    AUTOPILOT_POLICY_VERSION,
    now.toISOString(),
  ).all<PilotCandidateRow>();
  return rows.results ?? [];
}

const defaultDeps: PilotCollectorDeps = {
  loadCandidates: loadPilotCandidates,
  getBudgetStatus: getRecordOnlyPilotBudgetStatus,
  loadContext: (env, identity) => loadCriticContext(
    env,
    identity.userId,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
  ),
  runEvaluation: runClaimedPilotEvaluation,
};

function dormantPilotEnabled(env: Env): boolean {
  return env.LEARNING_BRAIN_ENABLED === 'true'
    && env.LEARNING_RELEASE_ENFORCEMENT !== 'true'
    && env.LEARNING_AUTOPILOT_ENABLED !== 'true';
}

function candidatePost(
  row: PilotCandidateRow,
  now: Date,
): { post: PublishablePost; identity: WorkspaceIdentity; budgetUsdCents: number } | null {
  const ownerKind: WorkspaceOwnerKind | null =
    row.owner_kind === 'user' || row.owner_kind === 'client'
      ? row.owner_kind
      : null;
  if (!ownerKind || !row.id?.trim() || !row.user_id?.trim() || typeof row.content !== 'string') {
    return null;
  }
  const clientId = row.client_id?.trim() || null;
  if (
    (ownerKind === 'user' && clientId !== null)
    || (ownerKind === 'client' && clientId === null)
  ) return null;

  let identity: WorkspaceIdentity;
  try {
    identity = normalizeWorkspaceIdentity(
      row.user_id,
      clientId,
      ownerKind,
      row.owner_id,
    );
  } catch {
    return null;
  }
  if (identity.workspaceKey !== row.workspace_key) return null;

  const consentAt = Date.parse(row.consent_confirmed_at ?? '');
  if (!Number.isFinite(consentAt) || consentAt > now.getTime()) return null;
  if (ownerKind === 'user' && row.consent_basis !== 'owner_self') return null;
  if (
    ownerKind === 'client'
    && (
      row.consent_basis !== 'customer_attested'
      || !row.consent_note?.trim()
      || !row.client_status
      || row.client_status.trim().toLowerCase() === 'on_hold'
    )
  ) return null;

  const budgetUsdCents = Number(row.monthly_ai_budget_usd_cents);
  if (!Number.isSafeInteger(budgetUsdCents) || budgetUsdCents <= 0) return null;
  return {
    identity,
    budgetUsdCents,
    post: {
      id: row.id,
      user_id: identity.userId,
      client_id: identity.clientId,
      owner_kind: identity.ownerKind,
      owner_id: identity.ownerId,
      content: row.content,
      platform: row.platform?.trim() || 'facebook',
      hashtags: row.hashtags,
      image_url: row.image_url,
      post_type: row.post_type,
      video_url: row.video_url,
      video_status: row.video_status,
      video_script: row.video_script,
      video_shots: row.video_shots,
      archetype_slug: row.archetype_slug,
    },
  };
}

export async function cronEvaluateLearningPilot(
  env: Env,
  overrides: Partial<PilotCollectorDeps> = {},
  now: Date = new Date(),
): Promise<PilotCollectorResult> {
  const result: PilotCollectorResult = {
    posts_processed: 0,
    candidates_considered: 0,
    evaluated: 0,
    reused: 0,
    claimed_elsewhere: 0,
    budget_skipped: 0,
    context_not_ready: 0,
    invalid_skipped: 0,
    errors: 0,
  };
  if (!dormantPilotEnabled(env)) return result;

  const deps = { ...defaultDeps, ...overrides };
  const rows = await deps.loadCandidates(env, now);
  result.candidates_considered = rows.length;
  const seenWorkspaces = new Set<string>();
  const seenOwnerKinds = new Set<WorkspaceOwnerKind>();

  for (const row of rows) {
    if (seenOwnerKinds.size >= PILOT_OWNER_KIND_LIMIT) break;
    const candidate = candidatePost(row, now);
    if (
      !candidate
      || seenWorkspaces.has(row.workspace_key)
      || seenOwnerKinds.has(candidate.identity.ownerKind)
    ) {
      result.invalid_skipped += 1;
      continue;
    }

    try {
      const context = await deps.loadContext(env, candidate.identity);
      if (!assessCriticContextReadiness(context).ready) {
        result.context_not_ready += 1;
        continue;
      }

      const budget = await deps.getBudgetStatus(
        env.DB,
        candidate.identity,
        candidate.budgetUsdCents,
        now,
      );
      if (!budget.allowed) {
        if (budget.reason === 'telemetry_unavailable') result.errors += 1;
        else result.budget_skipped += 1;
        continue;
      }
      seenWorkspaces.add(row.workspace_key);
      seenOwnerKinds.add(candidate.identity.ownerKind);

      const evaluation = await deps.runEvaluation(env, candidate.post);
      if (evaluation.status === 'evaluated') {
        result.evaluated += 1;
        result.posts_processed += 1;
      } else if (evaluation.status === 'existing') {
        result.reused += 1;
      } else {
        result.claimed_elsewhere += 1;
      }
    } catch (error) {
      result.errors += 1;
      console.warn('[learning-pilot] record-only collector failed closed', {
        postId: candidate.post.id,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
  return result;
}
