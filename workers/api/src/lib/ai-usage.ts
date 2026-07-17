// AI provider usage metering — single chokepoint for recording every
// FLUX / Anthropic / Gemini / OpenRouter call against a workspace.
//
// Why this exists:
//   1. Spend attribution. The fal.ai dashboard aggregates by API key with
//      24h lag — useless for "how much did Penny Wise I.T cost us this
//      month". Per-call rows in D1 let admin tooling slice by user_id,
//      client_id, post_id, provider, operation.
//   2. Cost-cut evidence. PRs that claim regen savings (the 2026-05-16
//      "raise critique acceptance to <5" change is the immediate trigger
//      for shipping this table) need before/after metering to verify the
//      saving actually landed. Reading from D1 is faster than parsing
//      wrangler tail.
//   3. Future quota enforcement. With a per-user usage timeseries we can
//      build per-plan AI quotas without instrumenting every call site
//      individually (e.g. "Starter plan: 50 image gens/month" gate
//      becomes a single COUNT against ai_usage).
//
// Design rules:
//   - General logging never throws. A D1 outage or schema drift must not
//     break normal image generation or critique. A scoped learning-pilot
//     write is the exception: it fails closed so a complete decision can
//     never be promoted with a partial cost ledger.
//   - No-op outside production and staging. Local `wrangler dev` runs
//     against the same D1 by default (no separate dev binding), so without
//     this guard every developer's smoke test would pollute a remote usage
//     table. Staging has its own D1 and must log so release cost evidence can
//     be proven before production promotion. Default behaviour
//     (env.ENVIRONMENT undefined) is to LOG, matching existing production.
//
// Cost estimates (rough, hand-rolled — refine when actual invoices come
// in):
//   - FLUX-dev image: $0.025
//   - FLUX Pro Kontext image: $0.04
//   - Anthropic Haiku 4.5 vision critique: ~$0.003
//   - Anthropic Haiku 4.5 text generation: ~$0.001 per short prompt
//
// These are inputs the helper accepts so callers can override per-model.

import type { Env } from '../env';

export type AiUsageRow = {
  userId?: string | null;
  clientId?: string | null;
  provider: 'fal' | 'anthropic' | 'gemini' | 'openrouter' | 'runway';
  model: string;
  operation: string;
  tokensIn?: number;
  tokensOut?: number;
  imagesGenerated?: number;
  estCostUsd?: number;
  postId?: string | null;
  ok?: boolean;
};

interface LearningDecisionUsageScope {
  decisionId: string;
  attempted: number;
  persisted: number;
  failed: number;
}

const learningDecisionScopes = new WeakMap<object, LearningDecisionUsageScope>();

/**
 * Return a request-local Env view whose AI usage rows are attributed to one
 * already-persisted learning decision. A WeakMap keeps the scope out of
 * bindings/configuration, so it cannot be forged by a Wrangler variable and
 * cannot leak to the parent Env or another concurrent request.
 */
export function withLearningDecisionUsageScope(env: Env, decisionId: string): Env {
  const normalizedDecisionId = decisionId.trim();
  if (!normalizedDecisionId) {
    throw new Error('A learning decision id is required for AI usage attribution');
  }
  const scopedEnv = Object.create(env) as Env;
  learningDecisionScopes.set(scopedEnv, {
    decisionId: normalizedDecisionId,
    attempted: 0,
    persisted: 0,
    failed: 0,
  });
  return scopedEnv;
}

/**
 * Enforce complete scoped metering before a learning decision can transition
 * from writing to complete. Unscoped release paths remain unchanged.
 */
export function assertLearningDecisionUsageScopeComplete(
  env: Env,
  decisionId: string,
): void {
  const scope = learningDecisionScopes.get(env);
  if (!scope) return;
  if (
    scope.decisionId !== decisionId
    || scope.attempted <= 0
    || scope.failed !== 0
    || scope.persisted !== scope.attempted
  ) {
    throw new Error('Learning AI usage attribution is incomplete');
  }
}

/**
 * Append a row to the ai_usage table. General logging failures are swallowed
 * so they cannot break the underlying AI operation. A request-local learning
 * scope deliberately throws on persistence failure, preventing a partially
 * metered pilot decision from becoming complete release evidence.
 *
 * Skipped (no-op) when env.ENVIRONMENT is set to anything other than
 * 'production' or 'staging' — i.e. local wrangler dev runs don't write to
 * D1. When ENVIRONMENT is unset (existing prod deploys), the helper writes.
 */
export async function logAiUsage(env: Env, row: AiUsageRow): Promise<void> {
  // Dev-mode no-op. `undefined` means production behaviour so existing
  // production deploys keep logging without a wrangler.toml change.
  if (
    env.ENVIRONMENT !== undefined
    && env.ENVIRONMENT !== 'production'
    && env.ENVIRONMENT !== 'staging'
  ) {
    return;
  }

  const learningScope = learningDecisionScopes.get(env);
  const learningDecisionId = learningScope?.decisionId ?? null;
  if (learningScope) learningScope.attempted += 1;
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage (
         user_id, client_id, provider, model, operation,
         tokens_in, tokens_out, images_generated, est_cost_usd, post_id,
         learning_decision_id, ok
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.userId ?? null,
      row.clientId ?? null,
      row.provider,
      row.model,
      row.operation,
      row.tokensIn ?? null,
      row.tokensOut ?? null,
      row.imagesGenerated ?? null,
      row.estCostUsd ?? null,
      row.postId ?? null,
      learningDecisionId,
      row.ok === false ? 0 : 1,
    ).run();
    if (learningScope) learningScope.persisted += 1;
  } catch (e: any) {
    // Best-effort logging. The most likely failure here is the table
    // not existing yet (deploy ordering: code lands before D1 migration
    // applies on prod), in which case we degrade gracefully.
    console.warn(`[ai-usage] insert failed: ${e?.message || e}`);
    if (learningDecisionId) {
      learningScope!.failed += 1;
      throw new Error('Learning AI usage attribution failed');
    }
  }
}
