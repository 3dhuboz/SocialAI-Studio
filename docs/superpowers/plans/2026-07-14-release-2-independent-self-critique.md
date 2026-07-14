# Release 2 Independent Self-Critique Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every candidate independently self-critique, self-repair, and receive a green/amber/red release decision while keeping enforcement disabled until shadow and approval evidence passes.

**Architecture:** Deterministic checks run first, followed by an independent structured text council, a separate adversarial business-harm call, an actual-publish-media critic, and a separate Release Judge. Images use the existing vision critic. Reels validate the script/storyboard, the critiqued thumbnail, final URL/status, and deterministic media metadata; if the reel is unavailable and publishing falls back to its image, the image is judged as the actual media. The release pipeline is dependency-injected for tests, capped at two repairs, persisted into v37 receipts, and fail-open only for optimisation while fail-closed for persistent release-critical risk.

**Tech Stack:** Cloudflare Worker, Anthropic/OpenRouter, existing `critiqueImageInternal`, D1 v37, Hono, TypeScript, Vitest.

---

## File Structure

- Create `workers/api/src/lib/learning/critic-types.ts`: critic contracts and verdict reduction.
- Create `workers/api/src/lib/learning/critic-context.ts`: verified profile, facts, denylist, and recent-post context.
- Create `workers/api/src/lib/learning/deterministic-critics.ts`: non-LLM denylist, claim, repetition, and platform checks.
- Create `workers/api/src/lib/learning/independent-json.ts`: bounded retry and provider fallback for critic calls.
- Create `workers/api/src/lib/learning/text-critic-council.ts`: structured brand/fact/repetition/platform review.
- Create `workers/api/src/lib/learning/business-harm-critic.ts`: independent adversarial review.
- Create `workers/api/src/lib/learning/media-critic.ts`: image and actual-publish reel manifest review.
- Create `workers/api/src/lib/learning/release-judge.ts`: independent green/amber/red decision.
- Create `workers/api/src/lib/learning/release-pipeline.ts`: retries, repairs, final media critique, and persistence.
- Create `workers/api/src/lib/learning/release-preflight.ts`: prewarm and publish integration boundary.
- Create `workers/api/src/lib/publishing/publish-orchestrator.ts`: shared Postproxy/legacy Graph egress after preflight.
- Create focused tests under `workers/api/src/__tests__/learning-critics*.test.ts`.
- Modify `anthropic.ts`, `prewarm-images.ts`, `prewarm-videos.ts`, `publish-missed.ts`, `routes/postproxy.ts`, `routes/learning.ts`, `App.tsx`, `postproxyService.ts`, `PostModal.tsx`, `db.ts`, `wrangler.toml`, and `AGENTS.md`.

### Task 1: Define Critic Contracts And Fail-closed Reduction

**Files:**
- Create: `workers/api/src/lib/learning/critic-types.ts`
- Create: `workers/api/src/__tests__/learning-critic-reducer.test.ts`

- [ ] **Step 1: Write failing reducer tests**

```ts
import { describe, expect, it } from 'vitest';
import { BASE_REQUIRED_CRITICS, reduceCriticResults, type CriticResult } from '../lib/learning/critic-types';

const result = (patch: Partial<CriticResult>): CriticResult => ({
  kind: 'brand', verdict: 'pass', severity: 'advisory', confidence: 0.9,
  evidence: [], repairs: [], provider: 'test', model: 'test', ...patch,
});

describe('reduceCriticResults', () => {
  it('does not hold for advisory warnings', () => {
    const results = BASE_REQUIRED_CRITICS.map((kind) => result({ kind }));
    results[0] = result({ kind: 'brand', verdict: 'warn_repairable', repairs: ['remove claim'] });
    expect(reduceCriticResults(results).state).toBe('repair');
  });

  it('blocks release-critical content failures', () => {
    const results = BASE_REQUIRED_CRITICS.map((kind) => result({ kind }));
    results[1] = result({ kind: 'fact', verdict: 'block', severity: 'release_critical' });
    expect(reduceCriticResults(results).state).toBe('block_red');
  });

  it('holds when a required critic remains unavailable', () => {
    const results = BASE_REQUIRED_CRITICS.map((kind) => result({ kind }));
    results[4] = result({ kind: 'business_harm', verdict: 'unavailable', severity: 'release_critical' });
    expect(reduceCriticResults(results).state).toBe('hold_amber');
  });

  it('holds when any required critic is missing', () => {
    expect(reduceCriticResults([result({ kind: 'brand' })]).state).toBe('hold_amber');
  });

  it('passes when all required results pass and advisory warnings are resolved', () => {
    expect(reduceCriticResults(BASE_REQUIRED_CRITICS.map((kind) => result({ kind }))).state).toBe('pass_green');
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `cd workers/api; npm test -- learning-critic-reducer.test.ts`

Expected: FAIL because `critic-types.ts` does not exist.

- [ ] **Step 3: Implement the contracts and reducer**

```ts
import type { CriticSeverity, CriticVerdict } from './types';

export type CriticKind = 'brand' | 'fact' | 'repetition' | 'platform' | 'business_harm' | 'image' | 'video_manifest';
export const BASE_REQUIRED_CRITICS: CriticKind[] = ['brand', 'fact', 'repetition', 'platform', 'business_harm'];

export interface CriticResult {
  kind: CriticKind;
  verdict: CriticVerdict;
  severity: CriticSeverity;
  confidence: number;
  evidence: string[];
  repairs: string[];
  provider: string;
  model: string;
}

export type CouncilState = 'repair' | 'pass_green' | 'hold_amber' | 'block_red';

export function reduceCriticResults(
  results: CriticResult[],
  requiredKinds: CriticKind[] = BASE_REQUIRED_CRITICS,
): { state: CouncilState; repairs: string[] } {
  if (requiredKinds.some((kind) => !results.some((result) => result.kind === kind))) {
    return { state: 'hold_amber', repairs: [] };
  }
  if (results.some((r) => r.verdict === 'block')) return { state: 'block_red', repairs: [] };
  const criticalUnavailable = results.some((r) => r.severity === 'release_critical' && r.verdict === 'unavailable');
  if (criticalUnavailable) return { state: 'hold_amber', repairs: [] };
  const repairs = results.filter((r) => r.verdict === 'warn_repairable').flatMap((r) => r.repairs);
  return repairs.length ? { state: 'repair', repairs } : { state: 'pass_green', repairs: [] };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- learning-critic-reducer.test.ts; npm run typecheck`

Expected: PASS and exit 0.

```powershell
git add workers/api/src/lib/learning/critic-types.ts workers/api/src/__tests__/learning-critic-reducer.test.ts
git commit -m "feat: define independent critic verdicts"
```

### Task 2: Load Verified, Tenant-scoped Critic Context

**Files:**
- Create: `workers/api/src/lib/learning/critic-context.ts`
- Create: `workers/api/src/__tests__/learning-critic-context.test.ts`

- [ ] **Step 1: Write failing isolation tests**

```ts
it('loads only the requested client facts and recent posts', async () => {
  const { db, calls } = makeRecordingD1({
    'SELECT profile FROM users': [{ profile: '{}' }],
    'SELECT profile FROM clients': [{ profile: '{"forbiddenSubjects":["competitor-logo"]}' }],
    'FROM client_facts': [{ client_id: 'client_1', fact_type: 'offer', content: 'Brisket only', verified_at: '2026-07-14' }],
    'FROM posts': [{ id: 'p1', client_id: 'client_1', content: 'Low and slow', platform: 'facebook' }],
  });
  const context = await loadCriticContext({ DB: db } as Env, 'owner_1', 'client_1');
  expect(context.verifiedFacts.every((f) => f.clientId === 'client_1')).toBe(true);
  expect(context.recentPosts.every((p) => p.clientId === 'client_1')).toBe(true);
  expect(context.forbiddenSubjects).toContain('competitor-logo');
  expect(calls.filter((call) => /client_facts|FROM posts/.test(call.sql)).every((call) =>
    call.binds.includes('owner_1') && call.binds.includes('client_1'))).toBe(true);
});

it('loads Shopify profile, facts, denylist, and posts only from the canonical shop', async () => {
  const { db, calls } = makeRecordingD1({
    'SELECT profile FROM shopify_stores': [{ profile: '{"forbiddenSubjects":["competitor-logo"]}' }],
    'FROM shopify_facts': [{ fact_type: 'product', content: 'Blue mug', verified_at: '2026-07-14' }],
    "owner_kind='shop'": [{ id: 'p1', content: 'New mug', platform: 'facebook' }],
  });
  const context = await loadCriticContext({ DB: db } as Env, 'store.myshopify.com', null, 'shop', 'Store.MyShopify.com');
  expect(context.verifiedFacts.every((fact) => fact.ownerKind === 'shop' && fact.ownerId === 'store.myshopify.com')).toBe(true);
  expect(context.forbiddenSubjects).toContain('competitor-logo');
  expect(calls.filter((call) => /shopify_stores|shopify_facts|owner_kind='shop'/.test(call.sql))
    .every((call) => call.binds.includes('store.myshopify.com'))).toBe(true);
});
```

Import `makeRecordingD1` from `./helpers/recording-d1` and add an owner-workspace case asserting both fact/post queries contain `client_id IS NULL`, bind only the authenticated owner ID, and never return client rows.

- [ ] **Step 2: Verify the test fails**

Run: `cd workers/api; npm test -- learning-critic-context.test.ts`

Expected: FAIL because the context loader does not exist.

- [ ] **Step 3: Implement the context loader**

```ts
import type { Env } from '../../env';
import { loadForbiddenSubjects, loadForbiddenSubjectsForShop } from '../profile-guards';
import { normalizeWorkspaceIdentity, type WorkspaceOwnerKind } from './types';

export interface CriticContext {
  profile: Record<string, unknown>;
  verifiedFacts: Array<{ ownerKind: WorkspaceOwnerKind; ownerId: string; clientId: string | null; factType: string; content: string; verifiedAt: string | null }>;
  recentPosts: Array<{ id: string; ownerKind: WorkspaceOwnerKind; ownerId: string; clientId: string | null; content: string; platform: string | null }>;
  forbiddenSubjects: string[];
}

export async function loadCriticContext(
  env: Env,
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
): Promise<CriticContext> {
  const identity = normalizeWorkspaceIdentity(userId, clientId, ownerKind, ownerId);
  if (identity.ownerKind === 'shop') {
    const shop = identity.ownerId;
    const profileRow = await env.DB.prepare('SELECT profile FROM shopify_stores WHERE shop_domain=? AND uninstalled_at IS NULL')
      .bind(shop).first<{ profile: string | null }>();
    const facts = await env.DB.prepare(`SELECT fact_type,content,verified_at FROM shopify_facts
      WHERE shop_domain=? ORDER BY engagement_score DESC,verified_at DESC LIMIT 80`).bind(shop).all<any>();
    const posts = await env.DB.prepare(`SELECT id,content,platform FROM posts WHERE owner_kind='shop' AND owner_id=?
      ORDER BY created_at DESC LIMIT 30`).bind(shop).all<any>();
    return {
      profile: profileRow?.profile ? JSON.parse(profileRow.profile) : {},
      verifiedFacts: (facts.results ?? []).map((row) => ({ ownerKind: 'shop', ownerId: shop, clientId: null,
        factType: row.fact_type, content: row.content, verifiedAt: row.verified_at ?? null })),
      recentPosts: (posts.results ?? []).map((row) => ({ id: row.id, ownerKind: 'shop', ownerId: shop,
        clientId: null, content: row.content, platform: row.platform ?? null })),
      forbiddenSubjects: await loadForbiddenSubjectsForShop(env, shop),
    };
  }
  const profileRow = identity.clientId
    ? await env.DB.prepare('SELECT profile FROM clients WHERE id=? AND user_id=?').bind(identity.clientId, identity.userId).first<{ profile: string | null }>()
    : await env.DB.prepare('SELECT profile FROM users WHERE id=?').bind(identity.userId).first<{ profile: string | null }>();
  if (!profileRow) throw new Error('Workspace profile not found');
  const scope = identity.clientId === null ? 'client_id IS NULL' : 'client_id = ?';
  const factsStmt = env.DB.prepare(`SELECT client_id,fact_type,content,verified_at FROM client_facts WHERE user_id=? AND ${scope} ORDER BY verified_at DESC LIMIT 80`);
  const postsStmt = env.DB.prepare(`SELECT id,client_id,content,platform FROM posts WHERE user_id=? AND ${scope} ORDER BY created_at DESC LIMIT 30`);
  const facts = identity.clientId === null ? await factsStmt.bind(identity.userId).all<any>() : await factsStmt.bind(identity.userId, identity.clientId).all<any>();
  const posts = identity.clientId === null ? await postsStmt.bind(identity.userId).all<any>() : await postsStmt.bind(identity.userId, identity.clientId).all<any>();
  return {
    profile: profileRow?.profile ? JSON.parse(profileRow.profile) : {},
    verifiedFacts: (facts.results ?? []).map((row) => ({ ownerKind: identity.ownerKind, ownerId: identity.ownerId, clientId: row.client_id ?? null,
      factType: row.fact_type, content: row.content, verifiedAt: row.verified_at ?? null })),
    recentPosts: (posts.results ?? []).map((row) => ({ id: row.id, ownerKind: identity.ownerKind, ownerId: identity.ownerId,
      clientId: row.client_id ?? null, content: row.content, platform: row.platform ?? null })),
    forbiddenSubjects: await loadForbiddenSubjects(env, identity.userId, identity.clientId),
  };
}
```

- [ ] **Step 4: Run isolation tests and commit**

Run: `cd workers/api; npm test -- learning-critic-context.test.ts; npm run typecheck`

Expected: PASS and no cross-client rows.

```powershell
git add workers/api/src/lib/learning/critic-context.ts workers/api/src/__tests__/learning-critic-context.test.ts
git commit -m "feat: load tenant scoped critic context"
```

### Task 3: Implement Text Council And Adversarial Harm Critic

**Files:**
- Create: `workers/api/src/lib/learning/deterministic-critics.ts`
- Create: `workers/api/src/lib/learning/independent-json.ts`
- Create: `workers/api/src/lib/learning/text-critic-council.ts`
- Create: `workers/api/src/lib/learning/business-harm-critic.ts`
- Create: `workers/api/src/__tests__/learning-text-critics.test.ts`
- Modify: `workers/api/src/lib/anthropic.ts`
- Modify: `workers/api/src/__tests__/anthropic.test.ts`

- [ ] **Step 1: Write provider-fallback and prompt-isolation tests**

Test deterministic blocks for forbidden subjects and prompt injection, repairable unsupported price/date/location claims, near-duplicate copy, and platform-limit violations. Also test that the council parses exactly four verdicts, wraps captions/facts with `wrapUntrusted`, treats malformed JSON as `unavailable`, retries each provider at most twice, falls back from Anthropic to OpenRouter, and that the harm critic receives no generator reasoning.

```ts
it('returns unavailable instead of passing malformed model output', async () => {
  const results = await runTextCriticCouncil(input, context, async () => ({ text: 'not-json' }));
  expect(results.every((r) => r.verdict === 'unavailable')).toBe(true);
  expect(results.every((r) => r.severity === 'release_critical')).toBe(true);
});
```

- [ ] **Step 2: Implement a shared JSON caller**

```ts
import type { Env } from '../../env';
import { callAnthropicDirect, callOpenRouter } from '../anthropic';

export interface IndependentCallContext {
  operation: string;
  userId: string;
  clientId: string | null;
  postId: string | null;
}

export interface IndependentJsonResult { text: string; provider: string; model: string; }

export async function callIndependentJson(
  env: Env,
  systemPrompt: string,
  prompt: string,
  context: IndependentCallContext,
): Promise<IndependentJsonResult> {
  const providers: Array<{ provider: string; model: string; call: () => Promise<{ text: string }> }> = [];
  if (env.ANTHROPIC_API_KEY) providers.push({
    provider: 'anthropic', model: 'claude-haiku-4-5',
    call: () => callAnthropicDirect({
      apiKey: env.ANTHROPIC_API_KEY!, model: 'claude-haiku-4-5', systemPrompt, prompt,
      temperature: 0, maxTokens: 1400, responseFormat: 'json',
      metering: { env, ...context },
    }),
  });
  if (env.OPENROUTER_API_KEY) providers.push({
    provider: 'openrouter', model: 'anthropic/claude-haiku-4.5',
    call: () => callOpenRouter(env.OPENROUTER_API_KEY!, systemPrompt, prompt, 0, 1400, {
      responseFormat: 'json', metering: { env, ...context },
    }),
  });
  const failures: string[] = [];
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await provider.call();
        if (!response.text.trim()) throw new Error('empty response');
        return { text: response.text, provider: provider.provider, model: provider.model };
      } catch (error) {
        failures.push(`${provider.provider}:${attempt}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw new Error(`Independent critic providers unavailable: ${failures.join(' | ') || 'none configured'}`);
}
```

Extend `callOpenRouter` in `anthropic.ts` with the same optional metering contract used by the direct Anthropic path. Record every successful and failed attempt in `ai_usage` with canonical user/client/post context, provider, model, operation, token counts when returned, estimated USD cost, and `ok`; logging remains non-throwing. Add a source-contract test proving neither fallback provider can run without metering context, because Release 4 cost ceilings treat missing telemetry as unsafe.

- [ ] **Step 3: Implement the council and harm schemas**

The text council returns `brand`, `fact`, `repetition`, and `platform` results. The separate harm call returns only `business_harm`. Use one strict parser shared by both:

```ts
const VERDICTS = new Set(['pass', 'warn_repairable', 'block', 'unavailable']);
const SEVERITIES = new Set(['advisory', 'release_critical']);

export function parseCriticResult(value: unknown, expectedKind: CriticKind): CriticResult {
  if (!value || typeof value !== 'object') throw new Error(`Missing ${expectedKind} result`);
  const row = value as Record<string, unknown>;
  if (row.kind !== expectedKind || !VERDICTS.has(String(row.verdict)) || !SEVERITIES.has(String(row.severity))) {
    throw new Error(`Invalid ${expectedKind} enum`);
  }
  const confidence = Number(row.confidence);
  const evidence = Array.isArray(row.evidence) ? row.evidence.filter((item): item is string => typeof item === 'string') : [];
  const repairs = Array.isArray(row.repairs) ? row.repairs.filter((item): item is string => typeof item === 'string') : [];
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`Invalid ${expectedKind} confidence`);
  if (row.verdict === 'warn_repairable' && repairs.length === 0) throw new Error(`Missing ${expectedKind} repair`);
  return { kind: expectedKind, verdict: row.verdict as CriticVerdict, severity: row.severity as CriticSeverity,
    confidence, evidence, repairs, provider: String(row.provider ?? ''), model: String(row.model ?? '') };
}
```

Parse a JSON object keyed by expected critic kind and require exactly the requested keys. On call, parse, or validation failure, return release-critical `unavailable` results for every expected kind; never synthesise a pass.

Use `wrapUntrusted` and `UNTRUSTED_CONTENT_DIRECTIVE` from `prompt-safety.ts`. Include the candidate, verified facts, forbidden subjects, and recent posts, but omit generator reasoning from the harm prompt.

`runDeterministicCritics` runs before any LLM call. It uses `scanForForbidden`, explicit prompt-injection signatures added and tested in this module, versioned Facebook/Instagram length/hashtag constants, normalized exact/near-duplicate comparison against recent posts, and extraction of currency, dates, percentages, phone numbers, offers, and locations. A concrete claim not found in verified profile/facts becomes at least `warn_repairable`; a denylisted subject or prompt injection is release-critical `block`. Keep imported text wrapped with `wrapUntrusted` for the later LLM calls. Deterministic passes must include the checked rule IDs in evidence so the Release Judge can confirm coverage.

- [ ] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- learning-text-critics.test.ts; npm run typecheck`

Expected: PASS; malformed output cannot become green.

```powershell
git add workers/api/src/lib/anthropic.ts workers/api/src/lib/learning/deterministic-critics.ts workers/api/src/lib/learning/independent-json.ts workers/api/src/lib/learning/text-critic-council.ts workers/api/src/lib/learning/business-harm-critic.ts workers/api/src/__tests__/anthropic.test.ts workers/api/src/__tests__/learning-text-critics.test.ts
git commit -m "feat: add independent text and harm critics"
```

### Task 4: Add Two-pass Correction And Independent Release Judge

**Files:**
- Create: `workers/api/src/lib/learning/media-critic.ts`
- Create: `workers/api/src/lib/learning/release-judge.ts`
- Create: `workers/api/src/lib/learning/release-pipeline.ts`
- Create: `workers/api/src/__tests__/learning-release-pipeline.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

```ts
const candidate: CandidateInput = {
  userId: 'u1', clientId: null, ownerKind: 'user', ownerId: 'u1', postId: 'p1', content: 'Fresh brisket today',
  mode: 'shadow', platform: 'facebook', hashtags: [], media: { kind: 'none', url: null, thumbnailUrl: null },
};
const context: ReleaseContext = {
  profile: { businessName: 'Hugheseys Que' },
  verifiedFacts: ['Brisket only'], forbiddenSubjects: ['pork', 'chicken'],
  recentPostDigests: ['low and slow'],
};
const verdict = (kind: CriticKind, patch: Partial<CriticResult> = {}): CriticResult => ({
  kind, verdict: 'pass', severity: 'advisory', confidence: 0.95,
  evidence: [], repairs: [], provider: 'test', model: 'test', ...patch,
});
const passingText = () => ['brand','fact','repetition','platform'].map((kind) => verdict(kind as CriticKind));
const passingDeps = (): ReleasePipelineDeps => ({
  runDeterministicCritics: async () => [],
  runTextCouncil: async () => passingText(),
  runHarmCritic: async () => verdict('business_harm'),
  runMediaCritic: async () => verdict('image'),
  repair: async (input) => input,
  judge: async () => 'pass_green',
});

it('repairs advisory warnings and passes without human approval', async () => {
  let repairs = 0;
  const deps = passingDeps();
  deps.runTextCouncil = async () => repairs === 0
    ? [verdict('brand', { verdict: 'warn_repairable', repairs: ['remove unsupported superlative'] }), ...passingText().slice(1)]
    : passingText();
  deps.repair = async (input) => { repairs += 1; return { ...input, content: 'Brisket available today' }; };
  const result = await runReleasePipeline(candidate, context, deps);
  expect(result.state).toBe('pass_green');
  expect(repairs).toBe(1);
});

it('caps repairs at two and then holds', async () => {
  let repairs = 0;
  const deps = passingDeps();
  deps.runTextCouncil = async () => [verdict('brand', { verdict: 'warn_repairable', repairs: ['rewrite'] }), ...passingText().slice(1)];
  deps.repair = async (input) => { repairs += 1; return input; };
  const result = await runReleasePipeline(candidate, context, deps);
  expect(result.state).toBe('hold_amber');
  expect(repairs).toBe(2);
});

it('blocks a release-critical content failure without judge override', async () => {
  let judgeCalls = 0;
  const deps = passingDeps();
  deps.runTextCouncil = async () => [verdict('brand'), verdict('fact', { verdict: 'block', severity: 'release_critical' }),
    verdict('repetition'), verdict('platform')];
  deps.judge = async () => { judgeCalls += 1; return 'pass_green'; };
  expect((await runReleasePipeline(candidate, context, deps)).state).toBe('block_red');
  expect(judgeCalls).toBe(0);
});

it('holds after the release judge exhausts primary and fallback providers', async () => {
  const deps = passingDeps();
  deps.judge = async () => 'hold_amber';
  expect((await runReleasePipeline(candidate, context, deps)).state).toBe('hold_amber');
});

it('never sends an extra generator-reasoning property to the judge', async () => {
  let judgeInput = '';
  const deps = passingDeps();
  deps.judge = async (input) => { judgeInput = JSON.stringify(input); return 'pass_green'; };
  const untrusted = { ...candidate, generatorReasoning: 'SECRET_CHAIN' } as CandidateInput;
  await runReleasePipeline(untrusted, context, deps);
  expect(judgeInput).not.toContain('SECRET_CHAIN');
});
```

- [ ] **Step 2: Implement a dependency-injected pipeline**

```ts
export interface CandidateInput {
  userId: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  postId: string;
  mode: LearningMode;
  content: string;
  platform: string;
  hashtags: string[];
  media: { kind: 'none' | 'image' | 'video'; url: string | null; thumbnailUrl: string | null };
  videoScript?: string | null;
  videoShots?: string[];
}

export interface ReleaseContext {
  profile: Record<string, unknown>;
  verifiedFacts: string[];
  forbiddenSubjects: string[];
  recentPostDigests: string[];
}

export interface ReleaseJudgeInput {
  candidate: CandidateInput;
  context: ReleaseContext;
  results: CriticResult[];
  repairHistory: string[][];
}

export interface ReleasePipelineResult {
  state: 'pass_green' | 'hold_amber' | 'block_red';
  candidate: CandidateInput;
  attempts: CriticResult[][];
  repairHistory: string[][];
}

export interface ReleasePipelineDeps {
  runDeterministicCritics(input: CandidateInput, context: ReleaseContext): Promise<CriticResult[]>;
  runTextCouncil(input: CandidateInput, context: ReleaseContext): Promise<CriticResult[]>;
  runHarmCritic(input: CandidateInput, context: ReleaseContext): Promise<CriticResult>;
  runMediaCritic?(input: CandidateInput, context: ReleaseContext): Promise<CriticResult>;
  repair(input: CandidateInput, repairs: string[], context: ReleaseContext): Promise<CandidateInput>;
  judge(input: ReleaseJudgeInput): Promise<'pass_green' | 'hold_amber' | 'block_red'>;
}

function judgeCandidate(candidate: CandidateInput): CandidateInput {
  return {
    userId: candidate.userId, clientId: candidate.clientId, ownerKind: candidate.ownerKind,
    ownerId: candidate.ownerId, postId: candidate.postId,
    mode: candidate.mode, content: candidate.content, platform: candidate.platform, hashtags: [...candidate.hashtags],
    media: { ...candidate.media }, videoScript: candidate.videoScript ?? null,
    videoShots: candidate.videoShots ? [...candidate.videoShots] : [],
  };
}

export async function runReleasePipeline(
  input: CandidateInput,
  context: ReleaseContext,
  deps: ReleasePipelineDeps,
): Promise<ReleasePipelineResult> {
  let candidate = input;
  const attempts: CriticResult[][] = [];
  const repairHistory: string[][] = [];
  for (let repairAttempt = 0; repairAttempt <= 2; repairAttempt += 1) {
    const deterministic = await deps.runDeterministicCritics(candidate, context);
    if (deterministic.some((result) => result.verdict === 'block')) {
      return { state: 'block_red', candidate, attempts: [[...deterministic]], repairHistory };
    }
    const results = [...deterministic, ...await deps.runTextCouncil(candidate, context), await deps.runHarmCritic(candidate, context)];
    const mediaKind = candidate.media.kind === 'image' ? 'image'
      : candidate.media.kind === 'video' ? 'video_manifest' : null;
    if (mediaKind) {
      results.push(deps.runMediaCritic
        ? await deps.runMediaCritic(candidate, context)
        : { kind: mediaKind, verdict: 'unavailable', severity: 'release_critical', confidence: 0,
            evidence: ['Media critic unavailable'], repairs: [], provider: 'internal', model: 'none' });
    }
    attempts.push(results);
    const required = mediaKind ? [...BASE_REQUIRED_CRITICS, mediaKind] : BASE_REQUIRED_CRITICS;
    const reduced = reduceCriticResults(results, required);
    if (reduced.state === 'block_red') return { state: 'block_red', candidate, attempts, repairHistory };
    if (reduced.state === 'hold_amber') return { state: 'hold_amber', candidate, attempts, repairHistory };
    if (reduced.state === 'pass_green') {
      return { state: await deps.judge({ candidate: judgeCandidate(candidate), context, results, repairHistory }), candidate, attempts, repairHistory };
    }
    if (repairAttempt === 2) return { state: 'hold_amber', candidate, attempts, repairHistory };
    repairHistory.push([...reduced.repairs]);
    try { candidate = await deps.repair(candidate, reduced.repairs, context); }
    catch { return { state: 'hold_amber', candidate, attempts, repairHistory }; }
  }
  return { state: 'hold_amber', candidate, attempts, repairHistory };
}
```

- [ ] **Step 3: Implement actual-publish media criticism**

`runMediaCritic` must use the media selected by `publish-missed`, not merely the media originally requested:

- For `image`, call `critiqueImageInternal` with the final URL, caption, archetype, and owner/client forbidden subjects. Convert a missing critique or a score below the locked publish threshold to release-critical `unavailable` or `block` rather than a pass.
- For `video`, require the final video URL/status, a passing thumbnail vision critique, a passing script/storyboard text verdict, an allowed MIME type, a non-zero content length, and no failed generation state. Return `video_manifest`; do not claim frame-level vision inspection that the Worker did not perform.
- When a failed reel will actually publish its thumbnail fallback, construct `CandidateInput.media.kind='image'` and critique that image. When no safe fallback exists, return a release-critical media block.

Add tests proving a requested reel with image fallback requires `image`, a ready reel requires `video_manifest`, a missing final URL holds, and a thumbnail below `CRITIQUE_ACCEPT_THRESHOLD` cannot pass.

The repair dependency is verdict-aware but still shares the pipeline's total two-repair cap. Text/fact/platform/repetition/harm repairs rewrite only caption and hashtags against verified facts. Image repairs regenerate only through `generateImageWithGuardrails`, carrying critic evidence and the owner denylist. Video repairs may regenerate the manifest once when the prewarm window allows; otherwise they switch to a passing critiqued thumbnail fallback. After every repair, rerun deterministic checks, the full text council, harm critic, actual-media critic, and Release Judge. Never patch a verdict row directly to green.

- [ ] **Step 4: Implement Release Judge validation**

The judge receives candidate text/media references, verified facts, forbidden subjects, critic verdicts, repair history, and mode. Wrap every context field as untrusted before constructing the prompt. It calls `callIndependentJson`, so each provider gets at most two attempts and OpenRouter is the fallback. Catch total provider failure as `hold_amber`. Reject any model result outside `pass_green|hold_amber|block_red`. Before returning `pass_green`, deterministically assert that every required kind is present and no release-critical verdict is `block` or `unavailable`.

- [ ] **Step 5: Run tests and commit**

Run: `cd workers/api; npm test -- learning-release-pipeline.test.ts; npm run typecheck`

Expected: all orchestration tests PASS.

```powershell
git add workers/api/src/lib/learning/media-critic.ts workers/api/src/lib/learning/release-judge.ts workers/api/src/lib/learning/release-pipeline.ts workers/api/src/__tests__/learning-release-pipeline.test.ts
git commit -m "feat: add self correction and release judge"
```

### Task 5: Integrate Preflight Without Enabling Enforcement

**Files:**
- Create: `workers/api/src/lib/learning/release-preflight.ts`
- Create: `workers/api/src/lib/publishing/publish-orchestrator.ts`
- Create: `workers/api/src/__tests__/learning-release-preflight.test.ts`
- Create: `workers/api/src/__tests__/publish-egress-preflight.test.ts`
- Modify: `workers/api/src/cron/prewarm-images.ts`
- Modify: `workers/api/src/cron/prewarm-videos.ts`
- Modify: `workers/api/src/cron/publish-missed.ts`
- Modify: `workers/api/src/routes/postproxy.ts`
- Modify: `src/App.tsx`
- Modify: `src/services/postproxyService.ts`

- [ ] **Step 1: Write mode-specific integration tests**

```ts
const post: PublishablePost = {
  id: 'p1', user_id: 'u1', client_id: null, owner_kind: 'user', owner_id: 'u1',
  content: 'Safe copy', platform: 'facebook',
  hashtags: '', image_url: null, post_type: 'image', video_url: null, video_status: null,
};
const pipelineResult = (state: ReleaseState) => ({ id: `decision-${state}`, state });

it('off mode makes no critic calls and preserves publish', async () => {
  let calls = 0;
  const decision = await evaluateReleasePreflight({} as Env, post, {
    loadMode: async () => 'off', runPipeline: async () => { calls += 1; return pipelineResult('block_red'); },
  });
  expect(decision).toMatchObject({ mayPublish: true, mustHold: false, decisionId: null });
  expect(calls).toBe(0);
});

it('shadow mode records a red result but preserves publish', async () => {
  const decision = await evaluateReleasePreflight({} as Env, post, {
    loadMode: async () => 'shadow', runPipeline: async () => pipelineResult('block_red'),
  });
  expect(decision).toMatchObject({ state: 'shadow_only', mayPublish: true, mustHold: false });
});

it('a global enforcement kill switch makes approval mode shadow-only', async () => {
  const decision = await evaluateReleasePreflight({ LEARNING_RELEASE_ENFORCEMENT: 'false' } as Env, post, {
    loadMode: async () => 'approval', runPipeline: async () => pipelineResult('block_red'),
  });
  expect(decision).toMatchObject({ state: 'shadow_only', mayPublish: true, mustHold: false });
});

it('approval mode holds an unresolved post when enforcement is enabled', async () => {
  const decision = await evaluateReleasePreflight({ LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env, post, {
    loadMode: async () => 'approval', runPipeline: async () => pipelineResult('hold_amber'),
  });
  expect(decision).toMatchObject({ mayPublish: false, mustHold: true, state: 'hold_amber' });
});

it('protected autopilot publishes only pass_green', async () => {
  const env = { LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env;
  const green = await evaluateReleasePreflight(env, post, {
    loadMode: async () => 'protected_autopilot', runPipeline: async () => pipelineResult('pass_green'),
  });
  const red = await evaluateReleasePreflight(env, post, {
    loadMode: async () => 'protected_autopilot', runPipeline: async () => pipelineResult('block_red'),
  });
  expect(green.mayPublish).toBe(true);
  expect(red.mustHold).toBe(true);
});

it('passes the canonical Shopify ownership scope into mode resolution', async () => {
  let scope: unknown[] = [];
  await evaluateReleasePreflight({} as Env, {
    ...post, user_id: 'store.myshopify.com', owner_kind: 'shop', owner_id: 'store.myshopify.com',
  }, {
    loadMode: async (_env, userId, clientId, ownerKind, ownerId) => {
      scope = [userId, clientId, ownerKind, ownerId]; return 'shadow';
    },
    runPipeline: async () => pipelineResult('pass_green'),
  });
  expect(scope).toEqual(['store.myshopify.com', null, 'shop', 'store.myshopify.com']);
});
```

- [ ] **Step 2: Implement the preflight boundary**

```ts
export interface PublishablePost {
  id: string; user_id: string; client_id: string | null; owner_kind: WorkspaceOwnerKind; owner_id: string;
  content: string; platform: string;
  hashtags: string | null; image_url: string | null; post_type: string | null;
  video_url: string | null; video_status: string | null;
}

export interface PreflightDecision {
  mode: LearningMode;
  state: ReleaseState;
  mayPublish: boolean;
  mustHold: boolean;
  decisionId: string | null;
}

export interface ReleasePreflightDeps {
  loadMode(env: Env, userId: string, clientId: string | null, ownerKind: WorkspaceOwnerKind, ownerId: string): Promise<LearningMode>;
  runPipeline(env: Env, post: PublishablePost): Promise<{ id: string; state: ReleaseState }>;
}

const defaultDeps: ReleasePreflightDeps = {
  loadMode: loadWorkspaceLearningMode,
  runPipeline: runAndPersistReleasePipeline,
};

export async function evaluateReleasePreflight(
  env: Env,
  post: PublishablePost,
  deps: ReleasePreflightDeps = defaultDeps,
): Promise<PreflightDecision> {
  const mode = await deps.loadMode(env, post.user_id, post.client_id, post.owner_kind, post.owner_id);
  if (mode === 'off') return { mode, state: 'pending', mayPublish: true, mustHold: false, decisionId: null };
  const result = await deps.runPipeline(env, post);
  if (mode === 'shadow' || env.LEARNING_RELEASE_ENFORCEMENT !== 'true') {
    return { mode, state: 'shadow_only', mayPublish: true, mustHold: false, decisionId: result.id };
  }
  return { mode, state: result.state, mayPublish: result.state === 'pass_green', mustHold: result.state !== 'pass_green', decisionId: result.id };
}
```

- [ ] **Step 3: Centralize every publish egress behind preflight**

Run preflight during image prewarm after final image critique and during video prewarm when a reel becomes ready. At publish time, construct `CandidateInput.media` from the actual URL selected by the existing publish fallback logic, reuse a fresh matching content/media hash receipt, and rerun if content, hashtags, selected image, selected video, or video status changed. Any requested mode is record-only unless `LEARNING_RELEASE_ENFORCEMENT === 'true'`; `off` makes no calls and `shadow` never enforces.

Extract the existing Postproxy and Graph publishing branches from `publish-missed.ts` into `publish-orchestrator.ts`. Its only public method accepts a persisted post including `owner_kind/owner_id`, resolved tokens/mapping, and injected dependencies. Before learning-mode resolution, it revalidates the persisted user/client/shop ownership tuple and active state against D1; missing, cross-owner, uninstalled, or `clients.status='on_hold'` workspaces throw before preflight and before any network call, even while learning flags are off. It then calls `evaluateReleasePreflight` internally and throws before `createPost` or `fetch(graph.facebook.com)` unless `mayPublish=true`. Do not expose a lower-level network-publish export that routes can call directly. The cron and manual route both call this method, preserving the current backend selection, idempotency claims, status transitions, video/image fallback, and error classification. Extend every post SELECT used by these paths to include `owner_kind` and `owner_id`; never infer a Shopify post from `client_id IS NULL` alone.

Keep `/api/postproxy/publish-now` for compatibility, but make it the single manual Worker egress for both Postproxy and legacy Graph workspaces. In `App.tsx`, Quick Post always saves one D1 post per platform and calls that endpoint; Calendar publishing also calls it. Remove all publishing calls to `FacebookService.postToPageDirect`, `postToPageWithImageUrl`, and `postToInstagram` from `App.tsx`; leave OAuth and read-only stats methods intact. Shopify force-publish continues to mark the post Scheduled and therefore reaches the same cron preflight.

In `publish-egress-preflight.test.ts`, assert all of the following:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '../..');

it('makes zero Postproxy or Graph calls when an enforced decision holds', async () => {
  const network = { postproxy: 0, graph: 0 };
  await expect(publishPersistedPost({} as Env, fixturePost, fixtureTargets, {
    evaluatePreflight: async () => ({ mayPublish: false, mustHold: true }), ...fakeNetwork(network),
  })).rejects.toThrow('release preflight');
  expect(network).toEqual({ postproxy: 0, graph: 0 });
});

it('preserves Postproxy and Graph delivery while off or shadow', async () => {
  const deps = { evaluatePreflight: async () => ({ mayPublish: true, mustHold: false }), ...fakeNetwork() };
  expect((await publishPersistedPost({} as Env, postproxyPost, postproxyTarget, deps)).backend).toBe('postproxy');
  expect((await publishPersistedPost({} as Env, graphPost, graphTarget, deps)).backend).toBe('graph');
});

it('makes zero critic and network calls for invalid or on-hold persisted ownership', async () => {
  const calls = { critic: 0, postproxy: 0, graph: 0 };
  await expect(publishPersistedPost({} as Env, fixturePost, fixtureTargets, {
    validateWorkspace: async () => { throw new Error('workspace inactive'); },
    evaluatePreflight: async () => { calls.critic += 1; return { mayPublish: true, mustHold: false }; },
    ...fakeNetwork(calls),
  })).rejects.toThrow('workspace inactive');
  expect(calls).toEqual({ critic: 0, postproxy: 0, graph: 0 });
});

it('routes quick and calendar publish through the Worker only', () => {
  const appSource = readFileSync(resolve(repoRoot, 'src/App.tsx'), 'utf8');
  expect(appSource).not.toMatch(/FacebookService\.(postToPageDirect|postToPageWithImageUrl|postToInstagram)/);
  expect(appSource).toContain('postproxyService.publishNow');
});
```

Inject preflight and network functions so tests never call Meta or Postproxy. Add a source-contract assertion that `publish-orchestrator.ts` contains the only direct `createPost`/Meta publish calls reachable from the manual route and cron.

- [ ] **Step 4: Persist enforced holds without creating remote orphans**

For a persistent enforced amber/red decision, atomically set the post to `Draft`, clear `scheduled_for`, clear `claim_id/claim_at`, and write the decision ID and plain-English hold reason to `reasoning`, scoped by post ID, user ID, and owner/client identity. Do not mark it `Missed` and do not create a Facebook scheduled orphan. Add a recording-D1 assertion that the hold SQL contains all four state resets and tenant binds.

- [ ] **Step 5: Run focused and regression tests**

Run: `cd workers/api; npm test -- learning-release-preflight.test.ts publish-egress-preflight.test.ts postproxy-routes.test.ts publish-missed-postproxy-fallback.test.ts image-gen.test.ts critique.test.ts critique-thresholds.test.ts; npm run typecheck`

Run from repo root: `npm test; npm run build`

Run from repo root:

```powershell
rg -n "FacebookService\.(postToPageDirect|postToPageWithImageUrl|postToInstagram)|createPost\(|graph\.facebook\.com.*(/feed|media_publish)" src/App.tsx workers/api/src
```

Expected: no publish-method hit remains in `App.tsx`; Worker publish calls are limited to `publish-orchestrator.ts`, asynchronous completion/reconciliation code, and non-publishing service definitions/tests. Investigate every other hit before enabling enforcement.

Expected: PASS; off/shadow paths preserve existing publish behaviour.

- [ ] **Step 6: Commit integration**

```powershell
git add workers/api/src/lib/learning/release-preflight.ts workers/api/src/lib/publishing/publish-orchestrator.ts workers/api/src/cron/prewarm-images.ts workers/api/src/cron/prewarm-videos.ts workers/api/src/cron/publish-missed.ts workers/api/src/routes/postproxy.ts workers/api/src/__tests__/learning-release-preflight.test.ts workers/api/src/__tests__/publish-egress-preflight.test.ts src/App.tsx src/services/postproxyService.ts
git commit -m "feat: integrate release preflight in shadow mode"
```

### Task 6: Expose Preflight Reports And Run Release 2 Shadow

**Files:**
- Modify: `workers/api/src/routes/learning.ts`
- Modify: `src/services/db.ts`
- Modify: `src/components/PostModal.tsx`
- Modify: `workers/api/wrangler.toml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Return verdicts with each decision**

Extend the receipt endpoint to load `learning_critic_verdicts` by `decision_id`, still scoped through the parent decision's `user_id/client_id/post_id`. Return `{ decisions: [{ ...decision, verdicts }] }`.

- [ ] **Step 2: Add frontend types and a collapsed preflight report**

Define `LearningDecision` and `LearningCriticVerdict` in `db.ts`. In `PostModal`, show the latest state, critic labels, evidence, repairs, and release reason. Keep the report collapsed by default and do not add approval buttons in this release.

- [ ] **Step 3: Keep enforcement disabled and run full verification**

Set:

```toml
LEARNING_BRAIN_ENABLED = "true"
LEARNING_RELEASE_ENFORCEMENT = "false"
```

Run: `cd workers/api; npm test; npm run typecheck`

Run from repo root: `npm test; npm run build`

Expected: all tests and build PASS.

- [ ] **Step 4: Deploy and prove shadow behaviour**

Deploy Worker with explicit config, allow Pages to auto-deploy after push, then verify:

```powershell
Invoke-RestMethod 'https://socialai-api.steve-700.workers.dev/api/health'
npx wrangler d1 execute socialai-db --remote --command="SELECT mode,release_state,COUNT(*) AS n FROM learning_decisions GROUP BY mode,release_state;"
```

Expected: shadow receipts accumulate; scheduled post content/status/time remain unchanged; publish health shows no regression.

- [ ] **Step 5: Update developer map, commit, push, and save**

Document new learning modules and the enforcement rule in `AGENTS.md`.

```powershell
git add workers/api/src/routes/learning.ts src/services/db.ts src/components/PostModal.tsx workers/api/wrangler.toml AGENTS.md
git commit -m "feat: surface independent preflight reports"
git push
npm run codex:save
```

Expected: GitHub and D-drive save succeed. Leave enforcement false.
