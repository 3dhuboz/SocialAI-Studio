# Release 4 Learning And Protected Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Learn from measured business outcomes and safely enable one-time-consent Protected Autopilot for green posts without per-post approval.

**Architecture:** Publication events anchor immutable 24-hour, 72-hour, and 7-day outcomes. Pure scoring and confidence-weighted learning update versioned private strategies, deterministic experiments explore one variable, and thresholded fleet aggregates expose no raw tenant data. Sampled adjudications provide durable false-pass/false-hold labels; product-level readiness plus workspace consent controls enforcement.

**Tech Stack:** Cloudflare Worker, D1 schema v39, Facebook/Instagram facts, Hono, React, TypeScript, Vitest, Wrangler.

---

## File Structure

- Create `workers/api/schema_v39_learning_outcomes.sql`.
- Create `workers/api/src/lib/learning/outcome-score.ts`, `publication-repository.ts`, `outcome-collector.ts`, `strategy-learning.ts`, `experiment-policy.ts`, `archetype-aggregates.ts`, and `readiness.ts`.
- Create `workers/api/src/cron/collect-learning-outcomes.ts`, `learn-strategies.ts`, and `evaluate-learning-readiness.ts`.
- Create `workers/api/src/routes/tracking.ts` and `routes/shopify-learning.ts`; extend `routes/learning.ts`.
- Create `src/components/WhatsWorkingPanel.tsx` and `src/components/ProtectedAutopilotPanel.tsx`.
- Modify `publish-missed.ts`, `poll-pending-reels.ts`, `dispatcher.ts`, `index.ts`, `lib/publishing/publish-orchestrator.ts`, `lib/provisioning.ts`, `routes/postproxy.ts`, `routes/user.ts`, `routes/clients.ts`, `routes/onboarding.ts`, `routes/shopify-oauth.ts`, `HomeDashboard.tsx`, `AdminCustomers.tsx`, `db.ts`, `shopify-app/src/api.ts`, `shopify-app/src/pages/Autopilot.tsx`, `shopify-app/src/pages/Settings.tsx`, `wrangler.toml`, and `AGENTS.md`.

### Task 1: Add V39 Outcome And Learning Tables

**Files:**
- Create: `workers/api/schema_v39_learning_outcomes.sql`
- Create: `workers/api/src/__tests__/learning-outcome-schema.test.ts`

- [x] **Step 1: Write the failing schema test**

```ts
it('creates publication, outcome, strategy, experiment, aggregate, and tracking tables', () => {
  const sql = readFileSync(resolve(process.cwd(), 'schema_v39_learning_outcomes.sql'), 'utf8');
  for (const table of ['publication_events','learning_outcomes','learning_signals','learning_profiles',
    'learning_experiments','archetype_aggregates','tracking_links','conversion_feedback',
    'learning_adjudications','learning_release_evidence','learning_release_readiness']) {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  }
  expect(sql).toContain('workspace_key TEXT NOT NULL');
  expect(sql).toContain('owner_kind TEXT NOT NULL');
  expect(sql).toContain('owner_id TEXT NOT NULL');
  expect(sql).not.toMatch(/ALTER TABLE posts/i);
});
```

- [x] **Step 2: Run and verify failure**

Run: `cd workers/api; npm test -- learning-outcome-schema.test.ts`

Expected: FAIL because v39 does not exist.

- [x] **Step 3: Create the migration**

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publication_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL, platform TEXT NOT NULL, remote_post_id TEXT, permalink TEXT,
  decision_id TEXT, reach_plan_id TEXT, published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,workspace_key,post_id,platform)
);

CREATE TABLE IF NOT EXISTS learning_outcomes (
  id TEXT PRIMARY KEY, publication_event_id TEXT NOT NULL,
  window_hours INTEGER NOT NULL CHECK (window_hours IN (24,72,168)),
  raw_signals_json TEXT NOT NULL, normalized_score REAL,
  completeness TEXT NOT NULL CHECK (completeness IN ('none','engagement','action','conversion')),
  source_status TEXT NOT NULL CHECK (source_status IN ('complete','partial','unavailable')),
  measured_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_event_id,window_hours),
  FOREIGN KEY (publication_event_id) REFERENCES publication_events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_signals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  variable_key TEXT NOT NULL, variable_value TEXT NOT NULL, objective TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0, effect REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0, freshness_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('tentative','usable','proven','rejected','operator_locked')),
  supporting_outcomes_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,workspace_key,variable_key,variable_value,objective)
);

CREATE TABLE IF NOT EXISTS learning_profiles (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  version INTEGER NOT NULL, profile_json TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,workspace_key,version)
);

CREATE TABLE IF NOT EXISTS learning_experiments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL, variable_key TEXT NOT NULL, control_value TEXT NOT NULL,
  test_value TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('planned','running','won','lost','inconclusive')),
  outcome_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);

CREATE TABLE IF NOT EXISTS archetype_aggregates (
  id TEXT PRIMARY KEY, archetype_slug TEXT NOT NULL, variable_key TEXT NOT NULL,
  variable_value TEXT NOT NULL, workspace_count INTEGER NOT NULL, post_count INTEGER NOT NULL,
  effect_range_json TEXT NOT NULL, confidence REAL NOT NULL,
  rebuilt_at TEXT NOT NULL, UNIQUE(archetype_slug,variable_key,variable_value)
);

CREATE TABLE IF NOT EXISTS tracking_links (
  code TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL, destination_url TEXT NOT NULL, click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT
);

CREATE TABLE IF NOT EXISTS conversion_feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL, calls INTEGER, messages INTEGER, leads INTEGER,
  bookings INTEGER, sales INTEGER, order_value_cents INTEGER,
  source TEXT NOT NULL CHECK (source IN ('owner','tracked','integration')),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_adjudications (
  id TEXT PRIMARY KEY, decision_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL, workspace_key TEXT NOT NULL, client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')), owner_id TEXT NOT NULL,
  expected_state TEXT NOT NULL CHECK (expected_state IN ('pass_green','hold_amber','block_red')),
  severity TEXT NOT NULL CHECK (severity IN ('advisory','release_critical')),
  note TEXT NOT NULL, adjudicated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_release_evidence (
  id TEXT PRIMARY KEY, policy_version TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('replay_red_team','staging_green','staging_block','kill_switch','publish_regression')),
  owner_kind TEXT CHECK (owner_kind IS NULL OR owner_kind IN ('user','client','shop')),
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  artifact_hash TEXT NOT NULL, note TEXT NOT NULL, recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT
);

CREATE TABLE IF NOT EXISTS learning_release_readiness (
  id TEXT PRIMARY KEY, policy_version TEXT NOT NULL,
  ready INTEGER NOT NULL CHECK (ready IN (0,1)),
  metrics_json TEXT NOT NULL, checks_json TEXT NOT NULL,
  evaluated_by TEXT NOT NULL, evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_publication_events_due ON publication_events(published_at,post_id);
CREATE INDEX IF NOT EXISTS idx_learning_outcomes_window ON learning_outcomes(window_hours,measured_at);
CREATE INDEX IF NOT EXISTS idx_learning_signals_workspace ON learning_signals(user_id,workspace_key,status);
CREATE INDEX IF NOT EXISTS idx_learning_experiments_workspace ON learning_experiments(user_id,workspace_key,status);
CREATE INDEX IF NOT EXISTS idx_conversion_feedback_post ON conversion_feedback(user_id,workspace_key,post_id);
CREATE INDEX IF NOT EXISTS idx_learning_adjudications_workspace ON learning_adjudications(user_id,workspace_key,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_release_evidence_policy ON learning_release_evidence(policy_version,evidence_kind,owner_kind,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_release_readiness_latest ON learning_release_readiness(policy_version,evaluated_at DESC);
```

- [x] **Step 4: Run the test and commit**

Run: `cd workers/api; npm test -- learning-outcome-schema.test.ts`

Expected: PASS.

```powershell
git add workers/api/schema_v39_learning_outcomes.sql workers/api/src/__tests__/learning-outcome-schema.test.ts
git commit -m "feat: add outcome and learning schema"
```

### Task 2: Implement The Blended Outcome Score

**Files:**
- Create: `workers/api/src/lib/learning/outcome-score.ts`
- Create: `workers/api/src/__tests__/learning-outcome-score.test.ts`

- [x] **Step 1: Write exact weighting tests**

```ts
it('uses 40/25/15/15/5 when all categories exist', () => {
  expect(scoreOutcome({ conversion: 100, lead: 80, tracked_action: 60, meaningful_engagement: 40, reach: 20 }))
    .toEqual({ score: 76, completeness: 'conversion' });
});

it('renormalizes available categories instead of treating missing as zero', () => {
  expect(scoreOutcome({ conversion: 100, reach: 0 }).score).toBe(88.89);
});

it('returns no score when every source is unavailable', () => {
  expect(scoreOutcome({})).toEqual({ score: null, completeness: 'none' });
});

it('marks engagement-only evidence lower completeness than conversions', () => {
  expect(scoreOutcome({ meaningful_engagement: 70 }).completeness).toBe('engagement');
  expect(scoreOutcome({ conversion: 70 }).completeness).toBe('conversion');
});

it('returns neutral low-confidence normalisation with fewer than five historical values', () => {
  expect(normaliseSignal(80, [10, 20, 30, 40])).toEqual({ score: 50, confidence: 0.2, sampleSize: 4 });
});

it('uses within-workspace percentile rank once history is sufficient', () => {
  expect(normaliseSignal(35, [10, 20, 30, 40, 50])).toEqual({ score: 60, confidence: 0.25, sampleSize: 5 });
});
```

- [x] **Step 2: Implement the pure scorer**

```ts
export type OutcomeCategory = 'conversion'|'lead'|'tracked_action'|'meaningful_engagement'|'reach';
const WEIGHTS: Record<OutcomeCategory, number> = {
  conversion: 0.40, lead: 0.25, tracked_action: 0.15, meaningful_engagement: 0.15, reach: 0.05,
};

export function scoreOutcome(values: Partial<Record<OutcomeCategory, number>>) {
  const available = Object.entries(values).filter((entry): entry is [OutcomeCategory, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  if (!available.length) return { score: null, completeness: 'none' as const };
  const denominator = available.reduce((sum, [key]) => sum + WEIGHTS[key], 0);
  const score = available.reduce((sum, [key, value]) => sum + Math.max(0, Math.min(100, value)) * WEIGHTS[key], 0) / denominator;
  const completeness = values.conversion !== undefined ? 'conversion'
    : values.lead !== undefined || values.tracked_action !== undefined ? 'action' : 'engagement';
  return { score: Math.round(score * 100) / 100, completeness };
}
```

- [x] **Step 3: Add per-workspace percentile normalisation**

```ts
export function normaliseSignal(raw: number, history: number[]) {
  const clean = history.filter((value) => Number.isFinite(value));
  if (!Number.isFinite(raw) || clean.length < 5) {
    return { score: 50, confidence: Math.min(0.2, clean.length / 20), sampleSize: clean.length };
  }
  const below = clean.filter((value) => value < raw).length;
  const equal = clean.filter((value) => value === raw).length;
  const score = Math.round(((below + equal * 0.5) / clean.length) * 10_000) / 100;
  return { score, confidence: Math.min(1, clean.length / 20), sampleSize: clean.length };
}
```

Load `history` only from the same `user_id/workspace_key` and the rolling 90-day window. Never compare raw scores across workspaces.

- [x] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- learning-outcome-score.test.ts; npm run typecheck`

Expected: PASS.

```powershell
git add workers/api/src/lib/learning/outcome-score.ts workers/api/src/__tests__/learning-outcome-score.test.ts
git commit -m "feat: score blended business outcomes"
```

### Task 3: Record Publications And Collect Outcome Windows

**Files:**
- Create: `workers/api/src/lib/learning/publication-repository.ts`
- Create: `workers/api/src/lib/learning/outcome-collector.ts`
- Create: `workers/api/src/cron/collect-learning-outcomes.ts`
- Create: `workers/api/src/__tests__/learning-outcome-collector.test.ts`
- Modify: `workers/api/src/cron/publish-missed.ts`
- Modify: `workers/api/src/cron/poll-pending-reels.ts`
- Modify: `workers/api/src/cron/dispatcher.ts`
- Modify: `workers/api/src/lib/publishing/publish-orchestrator.ts`
- Modify: `workers/api/src/routes/postproxy.ts`
- Modify: the existing focused publish-cron test file that covers successful publish retries

- [x] **Step 1: Write idempotency and missing-data tests**

```ts
it('uses one idempotency key per post and platform', async () => {
  const { db, calls } = makeRecordingD1();
  await recordPublicationEvent(db, publication);
  expect(calls[0].sql).toContain('ON CONFLICT(user_id,workspace_key,post_id,platform)');
  expect(calls[0].binds).toEqual(expect.arrayContaining(['u1', '__owner__', 'p1', 'facebook']));
});

it('collects 24h, 72h, and 168h once each', async () => {
  const saved: number[] = [];
  const result = await collectOutcomeWindows(publication, [24, 72, 168], {
    hasOutcome: async () => false,
    fetchSignals: async () => ({ sourceStatus: 'complete', values: { reach: 60 } }),
    saveOutcome: async (_event, window) => { saved.push(window); },
  });
  expect(result.saved).toBe(3);
  expect(saved).toEqual([24, 72, 168]);
});

it('skips an outcome window already persisted', async () => {
  const saved: number[] = [];
  await collectOutcomeWindows(publication, [24, 72, 168], {
    hasOutcome: async (_id, window) => window === 72,
    fetchSignals: async () => ({ sourceStatus: 'complete', values: { reach: 60 } }),
    saveOutcome: async (_event, window) => { saved.push(window); },
  });
  expect(saved).toEqual([24, 168]);
});

it('marks a failed Facebook fetch unavailable instead of zero', async () => {
  const writes: Array<{ sourceStatus: string; score: number | null }> = [];
  await collectOutcomeWindows(publication, [24], {
    hasOutcome: async () => false,
    fetchSignals: async () => ({ sourceStatus: 'unavailable', values: {} }),
    saveOutcome: async (_event, _window, outcome) => { writes.push(outcome); },
  });
  expect(writes).toEqual([{ sourceStatus: 'unavailable', score: null }]);
});
```

Define `publication` as a persisted user-owned Facebook event with `ownerKind='user'`, `ownerId=userId`, and `workspaceKey='__owner__'`. Add a Shopify event fixture and assert the recording bind uses the sentinel user plus `shop:<canonical-domain>`. Import `makeRecordingD1` from the Release 1 helper. In the existing publish-cron regression suite, add a fixture where remote publish succeeds but `recordPublicationEvent` throws: assert the post remains `Published`, a second cron run makes zero remote publish calls, and reconciliation later writes the missing event.

- [x] **Step 2: Implement idempotent publication recording**

```ts
export interface PublicationEventInput {
  userId: string; clientId: string | null; ownerKind: WorkspaceOwnerKind; ownerId: string;
  postId: string; platform: string;
  remotePostId: string | null; permalink: string | null; decisionId: string | null;
  reachPlanId: string | null; publishedAt: string;
}
export interface PersistedPublicationEvent extends PublicationEventInput { id: string; workspaceKey: string; }

export async function recordPublicationEvent(db: D1Database, input: PublicationEventInput): Promise<void> {
  const identity = normalizeWorkspaceIdentity(input.userId, input.clientId, input.ownerKind, input.ownerId);
  await db.prepare(`INSERT INTO publication_events
    (id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,platform,remote_post_id,permalink,decision_id,reach_plan_id,published_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,workspace_key,post_id,platform) DO UPDATE SET
      remote_post_id=COALESCE(excluded.remote_post_id,publication_events.remote_post_id),
      permalink=COALESCE(excluded.permalink,publication_events.permalink),
      decision_id=COALESCE(excluded.decision_id,publication_events.decision_id),
      reach_plan_id=COALESCE(excluded.reach_plan_id,publication_events.reach_plan_id)`)
    .bind(crypto.randomUUID(), identity.userId, identity.workspaceKey, identity.clientId,
      identity.ownerKind, identity.ownerId, input.postId,
      input.platform, input.remotePostId, input.permalink, input.decisionId, input.reachPlanId, input.publishedAt).run();
}
```

Import the single Release 1 `normalizeWorkspaceIdentity` helper; callers may not supply an independent tenant key, and inconsistent ownership must fail before SQL is prepared.

- [x] **Step 3: Wire every successful publish branch**

After direct Facebook/Instagram success and the post status is persisted as Published/Posted, the shared publish orchestrator calls `recordPublicationEvent`. Record one event per actual remote destination using canonical `facebook` or `instagram`; never persist a synthetic `both` platform event. For asynchronous Postproxy, call it only from the signed webhook/reconciliation path that confirms platform publication; for Graph reels, call it only when `poll-pending-reels` confirms finish. The call is idempotent and later reconciliation may backfill remote, permalink, decision, or Reach Plan identifiers. If it fails, log and alert but do not republish the remote post; the collector reconciles missing events from Published/Posted posts and stored remote IDs.

- [x] **Step 4: Implement the collector**

Implement `collectOutcomeWindows` behind an injected repository/fetch boundary matching the test above:

```ts
export type OutcomeWindow = 24 | 72 | 168;
export interface OutcomeCollectorDeps {
  hasOutcome(eventId: string, window: OutcomeWindow): Promise<boolean>;
  fetchSignals(event: PersistedPublicationEvent, window: OutcomeWindow): Promise<{
    sourceStatus: 'complete' | 'partial' | 'unavailable';
    values: Partial<Record<OutcomeCategory, number>>;
  }>;
  saveOutcome(event: PersistedPublicationEvent, window: OutcomeWindow, outcome: {
    sourceStatus: string; score: number | null;
  }): Promise<void>;
}

export async function collectOutcomeWindows(
  event: PersistedPublicationEvent,
  windows: OutcomeWindow[],
  deps: OutcomeCollectorDeps,
) {
  let saved = 0;
  for (const window of windows) {
    if (await deps.hasOutcome(event.id, window)) continue;
    let sourceStatus: 'complete' | 'partial' | 'unavailable' = 'unavailable';
    let values: Partial<Record<OutcomeCategory, number>> = {};
    try ({ sourceStatus, values } = await deps.fetchSignals(event, window)); catch { sourceStatus = 'unavailable'; }
    const scored = sourceStatus === 'unavailable' ? { score: null } : scoreOutcome(values);
    await deps.saveOutcome(event, window, { sourceStatus, score: scored.score });
    saved += 1;
  }
  return { saved };
}
```

Use the immutable publication-event ID, not `postId`, as `hasOutcome`'s first argument. Select only due publication events with missing windows. Load matching `client_facts` for user/client ownership or `shopify_facts` for shop ownership, plus tracking-link aggregates and conversion feedback by `user_id/workspace_key/post_id`. Calculate category percentiles and write one immutable outcome row per window. Network/fact failure writes `source_status='unavailable'` with `normalized_score=NULL`; never turn a missing source into numeric zero. Add a shop test proving no `client_facts` query occurs for `ownerKind='shop'`.

- [x] **Step 5: Add collector to the six-hour lane**

In the `0 */6 * * *` dispatcher branch:

```ts
await trackCron(env, 'learning_outcomes', () => cronCollectLearningOutcomes(env));
```

- [x] **Step 6: Run tests and commit**

Run: `cd workers/api; npm test -- learning-outcome-collector.test.ts; npm run typecheck`

Expected: PASS; unavailable metrics never become negative outcomes.

```powershell
git add workers/api/src/lib/learning/publication-repository.ts workers/api/src/lib/learning/outcome-collector.ts workers/api/src/cron/collect-learning-outcomes.ts workers/api/src/cron/publish-missed.ts workers/api/src/cron/poll-pending-reels.ts workers/api/src/cron/dispatcher.ts workers/api/src/lib/publishing/publish-orchestrator.ts workers/api/src/routes/postproxy.ts workers/api/src/__tests__/learning-outcome-collector.test.ts
git commit -m "feat: collect immutable outcome windows"
```

### Task 4: Add Confidence-weighted Learning And Safe Experiments

**Files:**
- Create: `workers/api/src/lib/learning/strategy-learning.ts`
- Create: `workers/api/src/lib/learning/experiment-policy.ts`
- Create: `workers/api/src/cron/learn-strategies.ts`
- Create: `workers/api/src/__tests__/learning-strategy.test.ts`
- Modify: `workers/api/src/cron/dispatcher.ts`

- [x] **Step 1: Write threshold, cap, decay, and exploration tests**

```ts
const now = new Date('2026-07-14T00:00:00.000Z');
const signal: LearningSignal = {
  variableKey: 'posting_hour', variableValue: '18', objective: 'local_order', sampleCount: 0,
  effect: 0, confidence: 0, freshnessAt: now.toISOString(), status: 'tentative',
};

it('keeps fewer than five outcomes tentative', () => {
  expect(nextSignal(signal, { effect: 0.3, sampleCount: 3 }, now).status).toBe('tentative');
});

it('marks five outcomes usable and ten proven', () => {
  expect(nextSignal(signal, { effect: 0.3, sampleCount: 5 }, now).status).toBe('usable');
  expect(nextSignal(signal, { effect: 0.3, sampleCount: 10 }, now).status).toBe('proven');
});

it('caps one weekly effect change at 0.10', () => {
  expect(nextSignal(signal, { effect: 1, sampleCount: 5 }, now).effect).toBe(0.10);
});

it('uses a 90-day half-life and never changes operator locks', () => {
  expect(decayEffect(0.8, 90)).toBeCloseTo(0.4);
  const locked = { ...signal, status: 'operator_locked' as const, effect: 0.8 };
  expect(nextSignal(locked, { effect: 0, sampleCount: 100 }, new Date('2026-10-12T00:00:00.000Z'))).toEqual(locked);
});

it('selects exploration deterministically at an approximately 15 percent rate', () => {
  const first = Array.from({ length: 10_000 }, (_, i) => shouldExplore(`post-${i}`, 3, 0.15));
  const second = Array.from({ length: 10_000 }, (_, i) => shouldExplore(`post-${i}`, 3, 0.15));
  expect(second).toEqual(first);
  expect(first.filter(Boolean).length).toBeGreaterThan(1_300);
  expect(first.filter(Boolean).length).toBeLessThan(1_700);
});

it('never allows an experiment to change more than one variable', () => {
  expect(() => assertSingleExperimentChange({ hour: 17, format: 'image' }, { hour: 18, format: 'video' })).toThrow();
});
```

- [x] **Step 2: Implement bounded updates**

```ts
export function decayEffect(effect: number, ageDays: number): number {
  return effect * Math.pow(0.5, Math.max(0, ageDays) / 90);
}

export function nextSignal(current: LearningSignal, evidence: SignalEvidence, now: Date): LearningSignal {
  if (current.status === 'operator_locked') return current;
  const ageDays = Math.max(0, (now.getTime() - Date.parse(current.freshnessAt)) / 86_400_000);
  const decayed = decayEffect(current.effect, ageDays);
  const target = evidence.effect;
  const delta = Math.max(-0.10, Math.min(0.10, target - decayed));
  const sampleCount = current.sampleCount + evidence.sampleCount;
  const status = sampleCount >= 10 ? 'proven' : sampleCount >= 5 ? 'usable' : 'tentative';
  return { ...current, effect: decayed + delta, sampleCount, status, confidence: Math.min(1, sampleCount / 10), freshnessAt: now.toISOString() };
}
```

- [x] **Step 3: Implement deterministic experiment selection**

```ts
function hashUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export function shouldExplore(postId: string, strategyVersion: number, configuredRate: number): boolean {
  const rate = Math.max(0, Math.min(0.20, configuredRate));
  return hashUnit(`${postId}:${strategyVersion}`) < rate;
}
```

When `shouldExplore` is true, choose the least-tested eligible variable and call the Release 3 `assertSingleExperimentChange` before persistence. Otherwise choose the highest safe predicted-outcome candidate. Experiments can never alter price, factual claims, denylist rules, geography exclusions, critic thresholds, or release policy.

Every signal, profile, and experiment insert copies the validated `user_id`, canonical `workspace_key`, `owner_kind`, and `owner_id` from its publication/reach record. Repository methods require all four values and reject inconsistent client or Shopify identities.

- [x] **Step 4: Run learning before the existing weekly review**

In the `0 21 * * SUN` branch, call `cronLearnStrategies` before `cronWeeklyReview`. A learning failure is isolated by `trackCron` and cannot suppress the weekly email.

- [x] **Step 5: Run tests and commit**

Run: `cd workers/api; npm test -- learning-strategy.test.ts; npm run typecheck`

Expected: PASS.

```powershell
git add workers/api/src/lib/learning/strategy-learning.ts workers/api/src/lib/learning/experiment-policy.ts workers/api/src/cron/learn-strategies.ts workers/api/src/cron/dispatcher.ts workers/api/src/__tests__/learning-strategy.test.ts
git commit -m "feat: learn bounded customer strategies"
```

### Task 5: Add Tracked Actions And Owner Conversion Feedback

**Files:**
- Create: `workers/api/src/routes/tracking.ts`
- Create: `workers/api/src/routes/shopify-learning.ts`
- Create: `workers/api/src/__tests__/learning-tracking.test.ts`
- Create: `workers/api/src/__tests__/shopify-learning-routes.test.ts`
- Modify: `workers/api/src/routes/learning.ts`
- Modify: `workers/api/src/index.ts`

- [x] **Step 1: Write tracking and ownership tests**

Cover safe `https` destinations only, short-code uniqueness, expired links, aggregate click increments, bot user-agent exclusion, no IP storage, tenant-scoped feedback, and integer-cent order values.

- [x] **Step 2: Implement public redirects without personal tracking**

`GET /r/:code` loads an unexpired destination, increments only aggregate `click_count` for non-bot requests, and returns `302 Location`. It stores no IP, cookie, fingerprint, or user identifier.

- [x] **Step 3: Implement conversion feedback endpoint**

Add `POST /api/learning/outcomes/:postId/feedback`. Validate non-negative integer counts and `orderValueCents`; bind authenticated `user_id` plus `workspace_key`; write `source='owner'`. Main/portal routes use `getAuthUserId` with the existing embed-secret argument and verify the post belongs to the requested workspace. Add the equivalent `/api/shopify/learning/outcomes/:postId/feedback` behind the signed Shopify session gate; derive `user_id`, `owner_kind='shop'`, `owner_id`, and the canonical shop key on the server.

- [x] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- learning-tracking.test.ts shopify-learning-routes.test.ts; npm run typecheck`

Expected: PASS.

```powershell
git add workers/api/src/routes/tracking.ts workers/api/src/routes/learning.ts workers/api/src/routes/shopify-learning.ts workers/api/src/index.ts workers/api/src/__tests__/learning-tracking.test.ts workers/api/src/__tests__/shopify-learning-routes.test.ts
git commit -m "feat: track organic actions and conversions"
```

### Task 6: Build Anonymous Archetype Aggregates

**Files:**
- Create: `workers/api/src/lib/learning/archetype-aggregates.ts`
- Create: `workers/api/src/__tests__/learning-archetype-aggregates.test.ts`
- Create: `workers/api/src/__tests__/learning-outcome-deletion.test.ts`
- Modify: `workers/api/src/routes/user.ts`
- Modify: `workers/api/src/routes/clients.ts`
- Modify: `workers/api/src/routes/shopify-oauth.ts`

- [x] **Step 1: Write privacy-threshold tests**

```ts
const contributions = (workspaceCount: number, postsPerWorkspace: number): AggregateContribution[] =>
  Array.from({ length: workspaceCount }, (_, workspace) =>
    Array.from({ length: postsPerWorkspace }, (_, post) => ({
      tenantKey: `user-${workspace}\u0000__owner__`, postId: `p${workspace}-${post}`, archetypeSlug: 'bbq-smokehouse',
      variableKey: 'posting_hour', variableValue: '18', effect: 0.2, confidence: 0.8,
      caption: 'private', imageUrl: 'https://private.example/image.jpg',
    }))).flat();

it('emits nothing below ten workspaces', () => {
  expect(buildEligibleAggregates(contributions(9, 20))).toEqual([]);
});

it('emits nothing below one hundred eligible posts', () => {
  expect(buildEligibleAggregates(contributions(10, 9))).toEqual([]);
});

it('never includes captions, image URLs, tenant IDs, names, or raw facts', () => {
  const json = JSON.stringify(buildEligibleAggregates(contributions(10, 10)));
  for (const forbidden of ['private', 'private.example', 'tenantKey', 'postId', 'caption', 'imageUrl']) {
    expect(json).not.toContain(forbidden);
  }
});

it('rebuilds after customer deletion without the deleted contribution', () => {
  const before = contributions(10, 10);
  expect(buildEligibleAggregates(before)).toHaveLength(1);
  expect(buildEligibleAggregates(before.filter((row) => !row.tenantKey.startsWith('user-9\u0000')))).toEqual([]);
});
```

- [x] **Step 2: Implement thresholded rebuild**

```ts
export interface AggregateContribution {
  tenantKey: string; postId: string; archetypeSlug: string; variableKey: string;
  variableValue: string; effect: number; confidence: number;
  caption?: string; imageUrl?: string;
}

export function buildEligibleAggregates(rows: AggregateContribution[]) {
  const groups = new Map<string, AggregateContribution[]>();
  for (const row of rows) {
    const key = `${row.archetypeSlug}\u0000${row.variableKey}\u0000${row.variableValue}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((group) => {
    const workspaceCount = new Set(group.map((row) => row.tenantKey)).size;
    const postCount = new Set(group.map((row) => row.postId)).size;
    if (workspaceCount < 10 || postCount < 100) return [];
    const effects = group.map((row) => row.effect).sort((a, b) => a - b);
    return [{ archetypeSlug: group[0].archetypeSlug, variableKey: group[0].variableKey,
      variableValue: group[0].variableValue, workspaceCount, postCount,
      effectRange: [effects[0], effects[effects.length - 1]],
      confidence: group.reduce((sum, row) => sum + row.confidence, 0) / group.length }];
  });
}
```

Construct `tenantKey` internally as the opaque composite `user_id + "\u0000" + workspace_key`, so different owner workspaces and shops count separately even when their display key is similar. Write only the returned coarse fields. Delete and rebuild an archetype's aggregate rows inside one D1 batch. Do not persist or return the source rows, tenant keys, post IDs, captions, image URLs, names, or raw facts.

- [x] **Step 3: Extend tenant deletion and aggregate invalidation**

Before raw tenant deletion, read the affected user/client/shop `archetype_slug`, then delete all `archetype_aggregates` rows for that slug so no stale fleet value remains. The weekly learning cron rebuilds that archetype from remaining eligible workspaces. Delete tenant rows in dependency-safe order: delete `learning_outcomes` selected through tenant-scoped `publication_events`, then `publication_events`, `conversion_feedback`, `tracking_links`, `learning_experiments`, `learning_profiles`, `learning_signals`, and `learning_adjudications`; Release 1 then removes decisions/settings. Bind both `user_id` and `workspace_key` for client deletion, `user_id` for account deletion, and shop sentinel plus canonical shop key during Shopify uninstall.

In `learning-outcome-deletion.test.ts`, assert the delete order and tenant binds, prove a sibling workspace survives, prove the affected archetype aggregate is removed, and prove a deleted tracking code returns 404.

- [x] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- learning-archetype-aggregates.test.ts learning-outcome-deletion.test.ts; npm run typecheck`

Expected: PASS and snapshots contain no tenant fields.

```powershell
git add workers/api/src/lib/learning/archetype-aggregates.ts workers/api/src/routes/user.ts workers/api/src/routes/clients.ts workers/api/src/routes/shopify-oauth.ts workers/api/src/__tests__/learning-archetype-aggregates.test.ts workers/api/src/__tests__/learning-outcome-deletion.test.ts
git commit -m "feat: add privacy gated archetype learning"
```

### Task 7: Add Readiness Gates And One-time Protected Autopilot Consent

**Files:**
- Create: `workers/api/src/lib/learning/readiness.ts`
- Create: `workers/api/src/cron/evaluate-learning-readiness.ts`
- Create: `workers/api/src/__tests__/learning-readiness.test.ts`
- Modify: `workers/api/src/routes/learning.ts`
- Modify: `workers/api/src/routes/shopify-learning.ts`
- Modify: `workers/api/src/lib/learning/workspace-mode.ts`
- Modify: `workers/api/src/lib/learning/release-preflight.ts`
- Modify: `workers/api/src/env.ts`
- Modify: `workers/api/src/cron/dispatcher.ts`
- Modify: `workers/api/src/lib/provisioning.ts`
- Modify: `workers/api/src/routes/onboarding.ts`
- Modify: `workers/api/src/routes/shopify-oauth.ts`
- Create: `workers/api/src/__tests__/learning-permanent-preflight.test.ts`

- [ ] **Step 1: Write readiness and consent tests**

```ts
function modeEnv(options: {
  requested: LearningMode; readiness: boolean; consent: boolean; onHold?: boolean; shop?: string;
  budgetUsdCents?: number | null; spendUsdCents?: number; tenancyProofs?: Partial<Record<WorkspaceOwnerKind, boolean>>;
}): Env {
  const tenancyProofs = { user: true, client: true, shop: true, ...options.tenancyProofs };
  const { db } = makeRecordingD1({
    'FROM clients': [{ on_hold: options.onHold ? 1 : 0 }],
    'FROM shopify_stores': options.shop ? [{ shop_domain: options.shop }] : [],
    'FROM workspace_learning_settings': [{
      mode: options.requested,
      autopublish_consent_at: options.consent ? '2026-07-14T00:00:00.000Z' : null,
      autopublish_policy_version: options.consent ? AUTOPILOT_POLICY_VERSION : null,
      experiment_rate: 0,
      monthly_ai_budget_usd_cents: options.budgetUsdCents === undefined ? 1000 : options.budgetUsdCents,
    }],
    'FROM ai_usage': [{ spend_usd_cents: options.spendUsdCents ?? 100 }],
    'FROM learning_release_readiness': [{
      ready: options.readiness ? 1 : 0,
      policy_version: AUTOPILOT_POLICY_VERSION,
      checks_json: JSON.stringify({ tenancyProofs }),
      evaluated_at: '2026-07-14T00:00:00.000Z',
    }],
  });
  return { DB: db, LEARNING_BRAIN_ENABLED: 'true', LEARNING_RELEASE_ENFORCEMENT: 'true',
    LEARNING_AUTOPILOT_ENABLED: 'true' } as Env;
}

const readyMetrics: ReadinessMetrics = {
  pilotDecisions: 30, adjudicatedDecisions: 30, severeFalsePasses: 0,
  falseHoldRate: 0.033, requiredAvailability: 0.995, decisionReceiptCoverage: 1,
  predictionLift: 0.15, rankCorrelation: 0.1, criticalBypasses: 0,
  publishingRegressions: 0, costWithinBudget: true, killSwitchTested: true,
};

it('requires enough adjudicated pilot evidence and every safety threshold', () => {
  expect(evaluateReadiness(readyMetrics).ready).toBe(true);
  for (const patch of [
    { pilotDecisions: 29 }, { adjudicatedDecisions: 29 }, { severeFalsePasses: 1 },
    { falseHoldRate: 0.05 }, { requiredAvailability: 0.994 }, { decisionReceiptCoverage: 0.999 },
    { predictionLift: 0.149 }, { rankCorrelation: 0 }, { criticalBypasses: 1 },
    { publishingRegressions: 1 }, { costWithinBudget: false }, { killSwitchTested: false },
  ]) expect(evaluateReadiness({ ...readyMetrics, ...patch }).ready).toBe(false);
});

it('downgrades protected autopilot without global switches, readiness, current consent, or active client', async () => {
  await expect(loadWorkspaceLearningMode(modeEnv({ requested: 'protected_autopilot', readiness: false, consent: true }), 'u1', 'c1'))
    .resolves.toBe('approval');
  await expect(loadWorkspaceLearningMode(modeEnv({ requested: 'protected_autopilot', readiness: true, consent: false }), 'u1', 'c1'))
    .resolves.toBe('approval');
  await expect(loadWorkspaceLearningMode(modeEnv({ requested: 'protected_autopilot', readiness: true, consent: true, onHold: true }), 'u1', 'c1'))
    .resolves.toBe('off');
});

it('allows protected autopilot only when every gate passes', async () => {
  await expect(loadWorkspaceLearningMode(
    modeEnv({ requested: 'protected_autopilot', readiness: true, consent: true }), 'u1', 'c1',
    'client', 'c1', new Date('2026-07-14T00:10:00.000Z'),
  )).resolves.toBe('protected_autopilot');
});

it('promotes active off or shadow workspaces to critic-gated approval after enforcement', async () => {
  for (const requested of ['off', 'shadow'] as const) {
    await expect(loadWorkspaceLearningMode(
      modeEnv({ requested, readiness: true, consent: false }), 'u1', 'c1',
      'client', 'c1', new Date('2026-07-14T00:10:00.000Z'),
    )).resolves.toBe('approval');
  }
});

it('downgrades protected autopilot when the readiness receipt is stale', async () => {
  const env = modeEnv({ requested: 'protected_autopilot', readiness: true, consent: true });
  await expect(loadWorkspaceLearningMode(env, 'u1', 'c1', 'client', 'c1', new Date('2026-07-14T01:00:00.000Z')))
    .resolves.toBe('approval');
});

it('downgrades protected autopilot without a verified tenancy proof or configured cost ceiling', async () => {
  await expect(loadWorkspaceLearningMode(modeEnv({
    requested: 'protected_autopilot', readiness: true, consent: true, tenancyProofs: { client: false },
  }), 'u1', 'c1', 'client', 'c1', new Date('2026-07-14T00:10:00.000Z'))).resolves.toBe('approval');
  await expect(loadWorkspaceLearningMode(modeEnv({
    requested: 'protected_autopilot', readiness: true, consent: true, budgetUsdCents: null,
  }), 'u1', 'c1', 'client', 'c1', new Date('2026-07-14T00:10:00.000Z'))).resolves.toBe('approval');
});

it('downgrades protected autopilot when current-month AI spend reaches its ceiling', async () => {
  const env = modeEnv({ requested: 'protected_autopilot', readiness: true, consent: true,
    budgetUsdCents: 1000, spendUsdCents: 1000 });
  await expect(loadWorkspaceLearningMode(env, 'u1', 'c1', 'client', 'c1', new Date('2026-07-14T00:10:00.000Z')))
    .resolves.toBe('approval');
});

it('uses installed Shopify identity and current consent without Clerk identity', async () => {
  const shop = 'store.myshopify.com';
  const env = modeEnv({ requested: 'protected_autopilot', readiness: true, consent: true, shop });
  await expect(loadWorkspaceLearningMode(env, shop, null, 'shop', shop, new Date('2026-07-14T00:10:00.000Z')))
    .resolves.toBe('protected_autopilot');
});
```

Import `makeRecordingD1` from the Release 1 helper. Extend `loadWorkspaceLearningMode` with a final optional `now: Date = new Date()` argument after the Release 1 ownership arguments so freshness tests use a deterministic clock. Add separate cases that flip each global switch to `false`, assert the requested protected mode resolves to `approval`, and prove a Shopify call uses the canonical shop key and installed-shop session. A requested protected mode must query its settings before applying the rollout flags so an emergency autopilot kill downgrades to approval rather than silently becoming legacy `off` mode.

- [ ] **Step 2: Implement readiness evaluation**

```ts
export interface ReadinessMetrics {
  pilotDecisions: number; adjudicatedDecisions: number; severeFalsePasses: number; falseHoldRate: number;
  requiredAvailability: number; decisionReceiptCoverage: number; predictionLift: number; rankCorrelation: number;
  criticalBypasses: number; publishingRegressions: number; costWithinBudget: boolean; killSwitchTested: boolean;
}

export function evaluateReadiness(m: ReadinessMetrics) {
  const checks = {
    pilot: m.pilotDecisions >= 30,
    adjudications: m.adjudicatedDecisions >= 30,
    severeFalsePasses: m.severeFalsePasses === 0,
    falseHolds: m.falseHoldRate < 0.05,
    availability: m.requiredAvailability >= 0.995,
    receipts: m.decisionReceiptCoverage === 1,
    predictionLift: m.predictionLift >= 0.15,
    rankCorrelation: m.rankCorrelation > 0,
    criticalBypasses: m.criticalBypasses === 0,
    publishingRegressions: m.publishingRegressions === 0,
    cost: m.costWithinBudget,
    killSwitch: m.killSwitchTested,
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}
```

- [ ] **Step 3: Add adjudication, settings, and readiness routes**

Add admin-only `POST /api/learning/decisions/:decisionId/adjudicate`; it writes one tenant-scoped `learning_adjudications` row with expected state, severity, note, authenticated adjudicator, and no mutation of the post. Add admin-only `POST /api/learning/readiness/evidence`; it validates an allowed evidence kind, owner kind where required, pass/fail result, immutable artifact SHA-256, and note before writing `learning_release_evidence`. It never accepts a caller-supplied overall readiness result. Use the latest consecutive 30-decision pilot window, its sampled labels, critic-verdict availability, decision-receipt coverage, unexpired release evidence, within-workspace predicted-quartile lift/rank correlation, and cost telemetry to calculate readiness, then persist each evaluation in `learning_release_readiness`. Missing cost, outcome, or evidence data is not ready, never a pass.

Add `GET /api/learning/readiness`, `GET /api/learning/settings`, and `PUT /api/learning/settings`, plus equivalent `/api/shopify/learning/readiness|settings` routes under the signed shop session. Use `AUTOPILOT_POLICY_VERSION = '2026-07-14-v1'`. Protected mode requires the latest readiness row to be green for that exact policy, the row's `checks_json.tenancyProofs[ownerKind]` to be true, `autopublish_consent_at` to be present, `autopublish_policy_version` to match, and a positive `monthly_ai_budget_usd_cents` ceiling. Compare that ceiling with current-month `ai_usage.est_cost_usd`, scoped by canonical user/client/shop identity; missing telemetry or spend at/above the ceiling downgrades to approval. Main/portal routes derive user/client identity from Clerk or the existing signed embed token; Shopify routes derive the shop sentinel and canonical `shop:` key server-side. Existing explicit autopublish preference may be migrated once only when it is a clear affirmative value and an audit/adjudication note records the migration; never infer consent from scheduled posts alone. Disabling Protected Autopilot clears its consent timestamp and returns the workspace to `approval` after permanent enforcement, or to `shadow` only during the pre-enforcement rollout.

Create `cronEvaluateLearningReadiness` in the existing 15-minute health/reconcile lane. It recomputes every `ReadinessMetrics` field and owner-kind staging proof from durable evidence; writes a new readiness receipt every run; and treats missing evidence as not ready. A tenancy proof becomes true only when that owner kind has both unexpired passing `staging_green` and `staging_block` evidence for the current policy. Current-policy passing evidence is also mandatory for `replay_red_team`, `kill_switch`, and `publish_regression`; a newer failure overrides an older pass. On a green-to-red transition, send one rate-limited Resend operator alert with the failed checks. A cron failure leaves the previous receipt to become stale rather than silently green.

- [ ] **Step 4: Add a third global switch**

Add to `Env` and `wrangler.toml`:

```ts
LEARNING_AUTOPILOT_ENABLED?: string;
```

Default it to `"false"`. Modify `loadWorkspaceLearningMode` to return at most `approval` for a requested protected mode unless `LEARNING_BRAIN_ENABLED`, `LEARNING_RELEASE_ENFORCEMENT`, and `LEARNING_AUTOPILOT_ENABLED` are all literal `"true"`, the latest `learning_release_readiness` row is green for `AUTOPILOT_POLICY_VERSION` and no more than 20 minutes old, the current owner kind has a durable staging proof, the workspace settings row has current consent, and its configured AI-cost ceiling is healthy. It always returns `off` for missing/cross-owner or `on_hold` clients. `LEARNING_AUTOPILOT_ENABLED` is the emergency global autopilot kill: disabling it downgrades protected workspaces to approval, never to bypassing legacy `off`. Cache readiness and cost lookups only within one request/cron invocation; a global kill-switch change must take effect on the next invocation.

- [ ] **Step 5: Promote permanent critic preflight without a bypass state**

Preserve Release 2 behaviour while `LEARNING_RELEASE_ENFORCEMENT !== 'true'`: `off` and `shadow` are non-mutating rollout states. Once enforcement is literal `"true"`, every valid active workspace resolves to at least `approval`, including a missing, `off`, or `shadow` settings row; only a fully gated and consented workspace resolves to `protected_autopilot`. Invalid/cross-owner/uninstalled/on-hold identities remain inactive and are rejected by the publish orchestrator before mode resolution, so they can never inherit the old `off => publish` behaviour.

Add `ensureWorkspaceLearningSettings` to provisioning/onboarding/client creation and Shopify install. Before production enforcement, run its bounded admin backfill in dry-run then apply mode to create `approval` rows for active workspaces that lack settings; preserve explicit current consent only through the audited one-time migration described above. The helper writes canonical `user_id`, `workspace_key`, `owner_kind`, and `owner_id` and never changes posts. New active workspaces default to `approval` after enforcement; pausing publishing uses the existing hold/schedule controls, not a critic-bypass mode.

In `learning-permanent-preflight.test.ts`, prove: enforcement false preserves legacy off/shadow delivery; enforcement true makes active off/shadow/missing settings run the release pipeline; protected green publishes; unresolved amber/red holds; a disabled autopilot flag downgrades to approval; and invalid/on-hold identities make zero critic and network calls.

- [ ] **Step 6: Run tests and commit**

Run: `cd workers/api; npm test -- learning-readiness.test.ts learning-release-preflight.test.ts learning-permanent-preflight.test.ts; npm run typecheck`

Expected: PASS; no workspace can bypass readiness or consent.

```powershell
git add workers/api/src/lib/learning/readiness.ts workers/api/src/lib/learning/workspace-mode.ts workers/api/src/lib/learning/release-preflight.ts workers/api/src/lib/provisioning.ts workers/api/src/cron/evaluate-learning-readiness.ts workers/api/src/cron/dispatcher.ts workers/api/src/routes/learning.ts workers/api/src/routes/onboarding.ts workers/api/src/routes/shopify-learning.ts workers/api/src/routes/shopify-oauth.ts workers/api/src/env.ts workers/api/src/__tests__/learning-readiness.test.ts workers/api/src/__tests__/learning-permanent-preflight.test.ts workers/api/src/__tests__/shopify-learning-routes.test.ts
git commit -m "feat: gate protected autopilot activation"
```

### Task 8: Add What's Working And Autopilot Controls

**Files:**
- Create: `src/components/WhatsWorkingPanel.tsx`
- Create: `src/components/ProtectedAutopilotPanel.tsx`
- Modify: `src/services/db.ts`
- Modify: `src/components/HomeDashboard.tsx`
- Modify: `src/components/AdminCustomers.tsx`
- Modify: `shopify-app/src/api.ts`
- Modify: `shopify-app/src/pages/Autopilot.tsx`
- Modify: `shopify-app/src/pages/Settings.tsx`

- [ ] **Step 1: Add frontend types and service calls**

Add typed methods for learning profile, signals, outcomes, readiness, settings, decision receipts, and conversion feedback in both `src/services/db.ts` and `shopify-app/src/api.ts`. Never represent readiness as one opaque score; preserve each check.

- [ ] **Step 2: Build What's Working**

Show strong/weak topics, offers, CTAs, audiences, geography, posting windows, hashtags, media formats, confidence, sample size, and recent changes. Label correlations as associations unless an experiment isolated the variable.

- [ ] **Step 3: Build one-time Autopilot control**

Show `Approval` and `Protected Autopilot` in the main control and Shopify `Settings.tsx`. Protected mode displays readiness checks, current-month metered AI cost, the required USD-cent cost ceiling, and one consent action; once enabled, green posts need no per-post approval. Amber/red posts remain visible with exact reasons. Shopify `Autopilot.tsx` shows the latest receipt/reach rationale for generated shop posts.

- [ ] **Step 4: Add admin operational metrics**

Show hold rate, sampled false-hold rate, critic/judge availability, severe false passes, adjudication coverage, mode, consent version, on-hold status, and global kill-switch state per workspace. Provide an admin-only sampled decision action to record expected state/severity/note; it must not approve, schedule, or publish the post.

- [ ] **Step 5: Run frontend tests/build and commit**

Run: `npm test; npm run build`

Run: `cd shopify-app; npm run typecheck; npm run build`

Expected: PASS.

```powershell
git add src/components/WhatsWorkingPanel.tsx src/components/ProtectedAutopilotPanel.tsx src/services/db.ts src/components/HomeDashboard.tsx src/components/AdminCustomers.tsx shopify-app/src/api.ts shopify-app/src/pages/Autopilot.tsx shopify-app/src/pages/Settings.tsx
git commit -m "feat: add learning and autopilot controls"
```

### Task 9: Migrate, Shadow, Promote, And Close Release 4

**Files:**
- Modify: `workers/api/wrangler.toml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Apply v39 safely**

Apply to staging, verify all eleven tables, export production to `D:\GitHubBackup\SocialAi\database\socialai-db-pre-v39-$stamp.sql`, apply production, and verify table shapes.

- [ ] **Step 2: Run complete verification**

Run Worker full tests/typecheck, main frontend tests/build, and Shopify typecheck/build. Run replay/red-team fixtures covering Macca's surreal BBQ failures, wrong geography, old prices, invented offers, bad media, prompt injection, critic outages, advisory warnings, and cross-tenant access across user, client, portal, and Shopify ownership.

- [ ] **Step 3: Deploy with autopilot disabled**

Use:

```toml
LEARNING_BRAIN_ENABLED = "true"
LEARNING_RELEASE_ENFORCEMENT = "false"
ORGANIC_REACH_ENABLED = "true"
ORGANIC_REACH_APPLY_ENABLED = "false"
LEARNING_AUTOPILOT_ENABLED = "false"
```

Verify live health, outcome collection, learning versions, and no publishing mutation.

- [ ] **Step 4: Complete pilot evidence**

Run Steve's workspace and one consenting active customer through approval validation until readiness reports at least 30 decisions with 30 sampled adjudications, zero severe false pass, false holds below 5 percent, and required availability at least 99.5 percent. This review labels pilot evidence only; it is not a permanent per-post approval workflow. Hugheseys Que remains excluded while on hold.

- [ ] **Step 5: Enable Protected Autopilot controls**

Only after readiness passes, run the settings backfill in dry-run and apply mode, verify every active user/client/shop workspace has canonical settings, and verify no active workspace would retain an effective `off` or `shadow` publish path after enforcement. Then set release enforcement, reach apply, and autopilot globals true. Enable one workspace through the consent endpoint with experiment rate `0` and an explicit monthly AI-cost ceiling, then verify one green post publishes unattended and one seeded release-critical fixture is held. Repeat the green/blocked proof in staging for user, client/portal, and Shopify ownership before promoting any corresponding production tenancy kind. Increase experiment rate to `0.10`, then `0.15` only while readiness remains green and metered spend remains below the ceiling.

- [ ] **Step 6: Update docs, commit, push, and save**

Update `AGENTS.md` to schema v39, document all modules, routes, crons, flags, kill switches, and the rule that Higgsfield remains separately gated.

```powershell
git add workers/api/wrangler.toml AGENTS.md
git commit -m "docs: complete protected autopilot rollout"
git push
npm run codex:save
```

Expected: GitHub and D-drive save succeed; production proof is recorded in the task closeout.
