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
//   - Logging NEVER throws. Every call site wraps logAiUsage in its own
//     try/catch as defense-in-depth, but the helper itself also swallows
//     all errors with a console.warn. A D1 outage or schema drift must
//     not break image-gen or critique.
//   - No-op outside production. Local `wrangler dev` runs against the
//     same D1 by default (no separate dev binding), so without this
//     guard every developer's smoke test would pollute the production
//     usage table. We check env.ENVIRONMENT — the binding doesn't exist
//     in the Env type today (intentional: don't introduce a new binding
//     just for this), so the check uses a defensive `(env as any)` cast.
//     Default behaviour (binding undefined) is to LOG, matching today's
//     prod deploy where ENVIRONMENT isn't set.
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
  provider: 'fal' | 'anthropic' | 'gemini' | 'openrouter';
  model: string;
  operation: string;
  tokensIn?: number;
  tokensOut?: number;
  imagesGenerated?: number;
  estCostUsd?: number;
  postId?: string | null;
  ok?: boolean;
};

/**
 * Append a row to the ai_usage table. Never throws — a logging failure
 * must not break the underlying AI op. Returns Promise<void> so callers
 * can `await` if they want backpressure, but most call sites can fire
 * and forget (the wrapping try/catch makes this safe).
 *
 * Skipped (no-op) when env.ENVIRONMENT is set to anything other than
 * 'production' — i.e. local wrangler dev runs don't write to D1. When
 * ENVIRONMENT is unset (today's prod deploy), the helper writes.
 */
export async function logAiUsage(env: Env, row: AiUsageRow): Promise<void> {
  // Dev-mode no-op. The binding isn't in the Env type (intentional — we
  // don't want to add a new binding just for this), so cast to access it.
  // `undefined` means "production behaviour" so existing prod deploys keep
  // logging without a wrangler.toml change.
  const environment = (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT;
  if (environment !== undefined && environment !== 'production') {
    return;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage (
         user_id, client_id, provider, model, operation,
         tokens_in, tokens_out, images_generated, est_cost_usd, post_id, ok
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      row.ok === false ? 0 : 1,
    ).run();
  } catch (e: any) {
    // Best-effort logging. The most likely failure here is the table
    // not existing yet (deploy ordering: code lands before D1 migration
    // applies on prod), in which case we degrade gracefully.
    console.warn(`[ai-usage] insert failed: ${e?.message || e}`);
  }
}
