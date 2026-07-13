# Release 1 Shadow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped decision receipts and read-only shadow evaluation without changing any post content, schedule, status, image, or publishing path.

**Architecture:** D1 stores workspace settings, immutable evaluation receipts, and critic verdicts. A workspace-mode resolver requires the global kill switch plus a tenant-scoped settings row; an off-by-default cron snapshots upcoming posts into receipts but cannot mutate the `posts` table.

**Tech Stack:** Cloudflare Worker, Hono, D1 schema v37, TypeScript, Vitest, Wrangler.

---

## File Structure

- Create `workers/api/schema_v37_learning_foundation.sql`: workspace settings, decision, and verdict tables.
- Create `workers/api/src/lib/learning/types.ts`: shared domain types and constants.
- Create `workers/api/src/lib/learning/workspace-mode.ts`: global/workspace feature resolution.
- Create `workers/api/src/lib/learning/decision-repository.ts`: tenant-scoped D1 writes and reads.
- Create `workers/api/src/__tests__/helpers/recording-d1.ts`: reusable deterministic D1 fake for focused tests.
- Create `workers/api/src/cron/evaluate-learning-shadow.ts`: bounded read-only shadow evaluator.
- Create `workers/api/src/routes/learning.ts`: authenticated receipt inspection endpoint.
- Create focused tests under `workers/api/src/__tests__/learning-*.test.ts`.
- Modify `workers/api/src/env.ts`, `workers/api/src/index.ts`, `workers/api/src/cron/dispatcher.ts`, `workers/api/src/routes/user.ts`, `workers/api/src/routes/clients.ts`, `workers/api/src/routes/shopify-oauth.ts`, `workers/api/wrangler.toml`, and `AGENTS.md`.

### Task 0: Create The Isolated Implementation Worktree

**Files:**
- Worktree: `D:\GitHubBackup\_working-repos\STEVES-Steve\SocialAI-Studio-customer-learning`
- Branch: `codex/customer-learning-brain`

- [ ] **Step 1: Verify the source checkout is safe**

```powershell
git status --short --branch
git fetch origin
git rev-parse main
git rev-parse origin/main
```

Expected: the source checkout is clean and `main` matches `origin/main`. Stop and reconcile through Git if either check fails; do not move or delete a dirty checkout.

- [ ] **Step 2: Create the branch and owner-lane worktree without overwriting anything**

```powershell
$branch = 'codex/customer-learning-brain'
$worktree = 'D:\GitHubBackup\_working-repos\STEVES-Steve\SocialAI-Studio-customer-learning'
if (Test-Path -LiteralPath $worktree) { throw "Worktree already exists: $worktree" }
if (-not (git branch --list $branch)) { git branch $branch main }
git worktree add $worktree $branch
git -C $worktree status --short --branch
```

Expected: the new D-drive worktree is on `codex/customer-learning-brain` and clean. If the branch is already attached to another worktree, inspect `git worktree list` and reuse that canonical worktree rather than forcing it.

- [ ] **Step 3: Install dependencies through the serialized installer**

```powershell
Set-Location 'D:\GitHubBackup\_working-repos\STEVES-Steve\SocialAI-Studio-customer-learning'
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Steve\.codex\scripts\codex-install-dependencies.ps1
```

Expected: the installer completes once; do not start a second package-manager process if it yields a running cell.

### Task 1: Add The V37 Learning Foundation Schema

**Files:**
- Create: `workers/api/schema_v37_learning_foundation.sql`
- Create: `workers/api/src/__tests__/learning-schema.test.ts`

- [ ] **Step 1: Write the failing schema-contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schema v37 learning foundation', () => {
  const sql = readFileSync(resolve(process.cwd(), 'schema_v37_learning_foundation.sql'), 'utf8');

  it('creates tenant-scoped settings, decisions, and critic verdicts', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workspace_learning_settings');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_decisions');
    expect(sql).toContain('user_id TEXT NOT NULL');
    expect(sql).toContain('workspace_key TEXT NOT NULL');
    expect(sql).toContain('owner_kind TEXT NOT NULL');
    expect(sql).toContain('owner_id TEXT NOT NULL');
    expect(sql).toContain('monthly_ai_budget_usd_cents INTEGER');
    expect(sql).toContain('client_id TEXT');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_critic_verdicts');
    expect(sql).toContain('FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE(user_id, workspace_key, post_id, stage, content_hash)');
  });

  it('adds bounded lookup indexes without altering posts', () => {
    expect(sql).toContain('idx_learning_decisions_workspace_post');
    expect(sql).toContain('idx_learning_decisions_state_created');
    expect(sql).not.toMatch(/ALTER TABLE posts/i);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing migration failure**

Run: `cd workers/api; npm test -- learning-schema.test.ts`

Expected: FAIL because `schema_v37_learning_foundation.sql` does not exist.

- [ ] **Step 3: Create the migration**

```sql
-- schema_v37_learning_foundation.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_learning_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off','shadow','approval','protected_autopilot')),
  autopublish_consent_at TEXT,
  autopublish_policy_version TEXT,
  experiment_rate REAL NOT NULL DEFAULT 0 CHECK (experiment_rate >= 0 AND experiment_rate <= 0.20),
  monthly_ai_budget_usd_cents INTEGER CHECK (monthly_ai_budget_usd_cents IS NULL OR monthly_ai_budget_usd_cents >= 0),
  disabled_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key)
);

CREATE TABLE IF NOT EXISTS learning_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('off','shadow','approval','protected_autopilot')),
  stage TEXT NOT NULL CHECK (stage IN ('snapshot','text_preflight','media_preflight','release')),
  release_state TEXT NOT NULL CHECK (release_state IN ('pending','pass_green','hold_amber','block_red','shadow_only')),
  content_hash TEXT NOT NULL,
  strategy_version INTEGER,
  reach_plan_id TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, post_id, stage, content_hash)
);

CREATE TABLE IF NOT EXISTS learning_critic_verdicts (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  critic_kind TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','warn_repairable','block','unavailable')),
  severity TEXT NOT NULL CHECK (severity IN ('advisory','release_critical')),
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  repair_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_decisions_workspace_post
  ON learning_decisions(user_id, workspace_key, post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_decisions_state_created
  ON learning_decisions(release_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_verdicts_decision
  ON learning_critic_verdicts(decision_id, critic_kind, attempt);
```

- [ ] **Step 4: Run the schema test**

Run: `cd workers/api; npm test -- learning-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the schema contract**

```powershell
git add workers/api/schema_v37_learning_foundation.sql workers/api/src/__tests__/learning-schema.test.ts
git commit -m "feat: add learning decision schema"
```

### Task 2: Define Domain Types And Workspace Modes

**Files:**
- Create: `workers/api/src/lib/learning/types.ts`
- Create: `workers/api/src/lib/learning/workspace-mode.ts`
- Create: `workers/api/src/__tests__/learning-workspace-mode.test.ts`
- Modify: `workers/api/src/env.ts`

- [ ] **Step 1: Write failing mode-resolution tests**

```ts
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { normalizeWorkspaceIdentity, workspaceKey } from '../lib/learning/types';
import { loadWorkspaceLearningMode, resolveLearningMode } from '../lib/learning/workspace-mode';

function modeEnv(rows: {
  client?: { on_hold: number } | null;
  shop?: { shop_domain: string } | null;
  settings?: { mode: string } | null;
}): Env {
  return {
    LEARNING_BRAIN_ENABLED: 'true',
    DB: {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async first<T>() {
            const row = sql.includes('FROM clients') ? rows.client ?? null
              : sql.includes('FROM shopify_stores') ? rows.shop ?? null : rows.settings ?? null;
            return row as T | null;
          },
        };
        return statement;
      },
    } as unknown as D1Database,
  } as Env;
}

describe('resolveLearningMode', () => {
  it('is off when the global flag is not true', () => {
    expect(resolveLearningMode(undefined, { mode: 'protected_autopilot' })).toBe('off');
  });

  it('honours an explicit workspace mode when globally enabled', () => {
    expect(resolveLearningMode('true', { mode: 'approval' })).toBe('approval');
  });

  it('defaults enabled workspaces to shadow, never autopilot', () => {
    expect(resolveLearningMode('true', {})).toBe('shadow');
  });

  it('rejects malformed profile values', () => {
    expect(resolveLearningMode('true', { mode: 'anything' })).toBe('shadow');
  });

  it('defaults an owner without settings to shadow', async () => {
    await expect(loadWorkspaceLearningMode(modeEnv({}), 'owner_1', null)).resolves.toBe('shadow');
  });

  it('gives Shopify a canonical key distinct from the own workspace key', () => {
    expect(workspaceKey(null)).toBe('__owner__');
    expect(workspaceKey(null, 'shop', 'Store.MyShopify.com')).toBe('shop:store.myshopify.com');
  });

  it('rejects inconsistent user, client, and Shopify identity tuples', () => {
    expect(() => normalizeWorkspaceIdentity('owner_1', 'client_1', 'user', 'owner_1')).toThrow();
    expect(() => normalizeWorkspaceIdentity('owner_1', 'client_1', 'client', 'client_2')).toThrow();
    expect(() => normalizeWorkspaceIdentity('other.myshopify.com', null, 'shop', 'store.myshopify.com')).toThrow();
  });

  it('allows only an installed canonical Shopify sentinel', async () => {
    const env = modeEnv({ shop: { shop_domain: 'store.myshopify.com' } });
    await expect(loadWorkspaceLearningMode(env, 'store.myshopify.com', null, 'shop', 'store.myshopify.com'))
      .resolves.toBe('shadow');
    await expect(loadWorkspaceLearningMode(env, 'other.myshopify.com', null, 'shop', 'store.myshopify.com'))
      .resolves.toBe('off');
  });

  it('returns off for an on-hold or cross-owner client', async () => {
    await expect(loadWorkspaceLearningMode(modeEnv({ client: { on_hold: 1 } }), 'owner_1', 'client_1')).resolves.toBe('off');
    await expect(loadWorkspaceLearningMode(modeEnv({ client: null }), 'owner_1', 'client_1')).resolves.toBe('off');
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd workers/api; npm test -- learning-workspace-mode.test.ts`

Expected: FAIL because the learning modules do not exist.

- [ ] **Step 3: Add the shared types**

```ts
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
    if (!ownerId?.trim()) throw new Error('Shop workspace requires ownerId');
    return `shop:${ownerId.trim().toLowerCase()}`;
  }
  return clientId ?? '__owner__';
}

export function normalizeWorkspaceIdentity(
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
): WorkspaceIdentity {
  const canonicalUserId = userId.trim();
  if (!canonicalUserId) throw new Error('Workspace requires userId');
  if (ownerKind === 'shop') {
    const shop = ownerId.trim().toLowerCase();
    if (clientId !== null || !shop || shop !== canonicalUserId.toLowerCase()) {
      throw new Error('Invalid Shopify workspace identity');
    }
    return { userId: shop, clientId: null, ownerKind, ownerId: shop, workspaceKey: workspaceKey(null, ownerKind, shop) };
  }
  if (ownerKind === 'client') {
    if (!clientId || ownerId !== clientId) throw new Error('Invalid client workspace identity');
    return { userId: canonicalUserId, clientId, ownerKind, ownerId: clientId, workspaceKey: workspaceKey(clientId, ownerKind, clientId) };
  }
  if (clientId !== null || ownerId !== canonicalUserId) throw new Error('Invalid owner workspace identity');
  return { userId: canonicalUserId, clientId: null, ownerKind, ownerId: canonicalUserId, workspaceKey: workspaceKey(null) };
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
```

- [ ] **Step 4: Implement the pure resolver**

```ts
import { LEARNING_MODES, normalizeWorkspaceIdentity, type LearningMode, type WorkspaceLearningSettings, type WorkspaceOwnerKind } from './types';
import type { Env } from '../../env';

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
    `SELECT mode,autopublish_consent_at,autopublish_policy_version,experiment_rate,monthly_ai_budget_usd_cents,disabled_reason
       FROM workspace_learning_settings WHERE user_id = ? AND workspace_key = ?`,
  ).bind(identity.userId, identity.workspaceKey).first<Record<string, unknown>>();
  return resolveLearningMode(env.LEARNING_BRAIN_ENABLED, {
    mode: row?.mode,
    autopublishConsentAt: typeof row?.autopublish_consent_at === 'string' ? row.autopublish_consent_at : null,
    autopublishPolicyVersion: typeof row?.autopublish_policy_version === 'string' ? row.autopublish_policy_version : null,
    experimentRate: Number(row?.experiment_rate ?? 0),
    monthlyAiBudgetUsdCents: row?.monthly_ai_budget_usd_cents == null ? null : Number(row.monthly_ai_budget_usd_cents),
    disabledReason: typeof row?.disabled_reason === 'string' ? row.disabled_reason : null,
  });
}
```

Extend the tests with a recording D1 fake: an owner with no row resolves to `shadow`, a client row resolves to its explicit mode, inconsistent identity tuples resolve to `off` without a settings query, a cross-owner client ID resolves to `off`, and `on_hold=1` always resolves to `off`.

- [ ] **Step 5: Add off-by-default Worker bindings**

Add to `Env` in `workers/api/src/env.ts`:

```ts
  // Customer Learning Brain global kill switch. Only literal "true" enables
  // evaluation. Workspace mode still controls shadow/approval/autopilot.
  LEARNING_BRAIN_ENABLED?: string;
  LEARNING_RELEASE_ENFORCEMENT?: string;
```

- [ ] **Step 6: Run tests and typecheck**

Run: `cd workers/api; npm test -- learning-workspace-mode.test.ts; npm run typecheck`

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit the type boundary**

```powershell
git add workers/api/src/env.ts workers/api/src/lib/learning workers/api/src/__tests__/learning-workspace-mode.test.ts
git commit -m "feat: add learning workspace modes"
```

### Task 3: Add The Tenant-scoped Decision Repository

**Files:**
- Create: `workers/api/src/__tests__/helpers/recording-d1.ts`
- Create: `workers/api/src/lib/learning/decision-repository.ts`
- Create: `workers/api/src/__tests__/learning-decision-repository.test.ts`

- [ ] **Step 1: Create the reusable recording D1 fake**

```ts
export interface RecordedD1Call {
  sql: string;
  binds: unknown[];
  method: 'run' | 'all' | 'first';
}

export function makeRecordingD1(fixtures: Record<string, unknown[]> = {}) {
  const calls: RecordedD1Call[] = [];
  const rowsFor = (sql: string) => {
    const key = Object.keys(fixtures).find((candidate) => sql.includes(candidate));
    return key ? fixtures[key] : [];
  };
  const db = {
    prepare(sql: string) {
      const statement = {
        binds: [] as unknown[],
        bind(...values: unknown[]) { statement.binds = values; return statement; },
        async run() { calls.push({ sql, binds: statement.binds, method: 'run' as const }); return { success: true }; },
        async all<T>() { calls.push({ sql, binds: statement.binds, method: 'all' as const }); return { results: rowsFor(sql) as T[] }; },
        async first<T>() { calls.push({ sql, binds: statement.binds, method: 'first' as const }); return (rowsFor(sql)[0] ?? null) as T | null; },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, calls };
}
```

- [ ] **Step 2: Write failing owner/client repository tests**

```ts
import { describe, expect, it } from 'vitest';
import { createDecisionReceipt, listDecisionReceipts } from '../lib/learning/decision-repository';
import { makeRecordingD1 } from './helpers/recording-d1';

describe('learning decision repository', () => {
  it('binds a client workspace key on writes and reads', async () => {
    const { db, calls } = makeRecordingD1({ 'INSERT INTO learning_decisions': [{ id: 'decision-client' }] });
    await createDecisionReceipt(db, {
      userId: 'owner_1', clientId: 'client_1', postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    });
    await listDecisionReceipts(db, 'owner_1', 'client_1', 'post_1', 20);
    expect(calls.every((call) => call.binds.includes('owner_1'))).toBe(true);
    expect(calls.every((call) => call.binds.includes('client_1'))).toBe(true);
  });

  it('uses a non-null owner key so duplicate owner receipts upsert', async () => {
    const { db, calls } = makeRecordingD1({ 'INSERT INTO learning_decisions': [{ id: 'decision-owner' }] });
    await createDecisionReceipt(db, {
      userId: 'owner_1', clientId: null, postId: 'post_1', mode: 'shadow',
      stage: 'snapshot', releaseState: 'shadow_only', contentHash: 'abc', summary: {},
    });
    expect(calls[0].sql).toContain('ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash)');
    expect(calls[0].binds).toContain('__owner__');
  });

  it('uses the canonical Shopify key and owner metadata', async () => {
    const { db, calls } = makeRecordingD1({ 'INSERT INTO learning_decisions': [{ id: 'decision-shop' }] });
    await createDecisionReceipt(db, {
      userId: 'store.myshopify.com', clientId: null, ownerKind: 'shop', ownerId: 'Store.MyShopify.com',
      postId: 'post_1', mode: 'shadow', stage: 'snapshot', releaseState: 'shadow_only',
      contentHash: 'abc', summary: {},
    });
    expect(calls[0].binds).toEqual(expect.arrayContaining([
      'store.myshopify.com', 'shop:store.myshopify.com', 'shop', 'store.myshopify.com',
    ]));
  });

  it('rejects inconsistent ownership before preparing SQL', async () => {
    const { db, calls } = makeRecordingD1();
    await expect(createDecisionReceipt(db, {
      userId: 'owner_1', clientId: null, ownerKind: 'shop', ownerId: 'store.myshopify.com',
      postId: 'post_1', mode: 'shadow', stage: 'snapshot', releaseState: 'shadow_only',
      contentHash: 'abc', summary: {},
    })).rejects.toThrow('Invalid Shopify workspace identity');
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `cd workers/api; npm test -- learning-decision-repository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 4: Implement create and list operations**

```ts
import type { DecisionReceiptInput, WorkspaceOwnerKind } from './types';
import { normalizeWorkspaceIdentity } from './types';

export async function createDecisionReceipt(db: D1Database, input: DecisionReceiptInput): Promise<string> {
  const id = crypto.randomUUID();
  const ownerKind = input.ownerKind ?? (input.clientId === null ? 'user' : 'client');
  const ownerId = input.ownerId ?? input.clientId ?? input.userId;
  const identity = normalizeWorkspaceIdentity(input.userId, input.clientId, ownerKind, ownerId);
  const row = await db.prepare(`INSERT INTO learning_decisions
    (id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,mode,stage,release_state,content_hash,strategy_version,reach_plan_id,summary_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash) DO UPDATE SET
      mode=excluded.mode, release_state=excluded.release_state,
      strategy_version=excluded.strategy_version, reach_plan_id=excluded.reach_plan_id,
      summary_json=excluded.summary_json, updated_at=datetime('now')
    RETURNING id`)
    .bind(id, identity.userId, identity.workspaceKey, identity.clientId, identity.ownerKind, identity.ownerId,
      input.postId, input.mode, input.stage,
      input.releaseState, input.contentHash, input.strategyVersion ?? null,
      input.reachPlanId ?? null, JSON.stringify(input.summary)).first<{ id: string }>();
  if (!row?.id) throw new Error('Learning decision receipt was not persisted');
  return row.id;
}

export async function listDecisionReceipts(
  db: D1Database, userId: string, clientId: string | null, postId: string, limit: number,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client', ownerId: string = clientId ?? userId,
) {
  const identity = normalizeWorkspaceIdentity(userId, clientId, ownerKind, ownerId);
  const statement = db.prepare(`SELECT * FROM learning_decisions
    WHERE user_id = ? AND workspace_key = ? AND post_id = ? ORDER BY created_at DESC LIMIT ?`);
  const result = await statement.bind(identity.userId, identity.workspaceKey, postId, limit).all();
  return result.results ?? [];
}
```

- [ ] **Step 5: Run repository tests and typecheck**

Run: `cd workers/api; npm test -- learning-decision-repository.test.ts; npm run typecheck`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit the repository**

```powershell
git add workers/api/src/lib/learning/decision-repository.ts workers/api/src/__tests__/helpers/recording-d1.ts workers/api/src/__tests__/learning-decision-repository.test.ts
git commit -m "feat: persist tenant scoped learning receipts"
```

### Task 4: Add Read-only Shadow Evaluation And Receipt API

**Files:**
- Create: `workers/api/src/cron/evaluate-learning-shadow.ts`
- Create: `workers/api/src/routes/learning.ts`
- Create: `workers/api/src/__tests__/learning-shadow.test.ts`
- Create: `workers/api/src/__tests__/learning-routes.test.ts`
- Create: `workers/api/src/__tests__/learning-deletion.test.ts`
- Modify: `workers/api/src/cron/dispatcher.ts`
- Modify: `workers/api/src/index.ts`
- Modify: `workers/api/src/routes/user.ts`
- Modify: `workers/api/src/routes/clients.ts`
- Modify: `workers/api/src/routes/shopify-oauth.ts`

- [ ] **Step 1: Write a failing mutation-safety test**

```ts
it('creates receipts without updating posts', async () => {
  const { db, calls } = makeRecordingD1({
    'FROM posts p': [{ id: 'p1', user_id: 'u1', client_id: null, content: 'Safe draft', image_url: null }],
  });
  const result = await cronEvaluateLearningShadow({ DB: db, LEARNING_BRAIN_ENABLED: 'true' } as Env);
  expect(result.posts_processed).toBe(1);
  expect(calls.some((call) => /UPDATE\s+posts|DELETE\s+FROM\s+posts/i.test(call.sql))).toBe(false);
  expect(calls.some((call) => /INSERT INTO learning_decisions/i.test(call.sql))).toBe(true);
});
```

Import `makeRecordingD1` from `./helpers/recording-d1` in this test. Add a second fixture with `clients.on_hold=1` and assert `posts_processed=0` and no decision insert.

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd workers/api; npm test -- learning-shadow.test.ts`

Expected: FAIL because the cron module does not exist.

- [ ] **Step 3: Implement bounded shadow evaluation**

```ts
import type { Env } from '../env';
import { createDecisionReceipt } from '../lib/learning/decision-repository';
import { loadWorkspaceLearningMode } from '../lib/learning/workspace-mode';

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function cronEvaluateLearningShadow(env: Env): Promise<{ posts_processed: number }> {
  if (env.LEARNING_BRAIN_ENABLED !== 'true') return { posts_processed: 0 };
  const rows = await env.DB.prepare(`SELECT p.id,p.user_id,p.client_id,p.owner_kind,p.owner_id,p.content,p.image_url,p.platform,p.scheduled_for,
      p.image_critique_score,p.image_critique_reasoning
    FROM posts p
    LEFT JOIN clients c ON c.id=p.client_id AND c.user_id=p.user_id
    WHERE p.status='Scheduled' AND p.scheduled_for > datetime('now')
      AND p.scheduled_for <= datetime('now','+24 hours')
      AND (p.client_id IS NULL OR (c.id IS NOT NULL AND COALESCE(c.on_hold,0)=0))
    ORDER BY p.scheduled_for ASC LIMIT 8`).all<Record<string, unknown>>();
  let processed = 0;
  for (const post of rows.results ?? []) {
    const clientId = post.client_id === null || post.client_id === undefined ? null : String(post.client_id);
    const ownerKind = post.owner_kind === 'shop' ? 'shop' : clientId === null ? 'user' : 'client';
    const ownerId = typeof post.owner_id === 'string' && post.owner_id ? post.owner_id : clientId ?? String(post.user_id);
    const mode = await loadWorkspaceLearningMode(env, String(post.user_id), clientId, ownerKind, ownerId);
    if (mode === 'off') continue;
    const contentHash = await sha256(JSON.stringify({ content: post.content, image: post.image_url, platform: post.platform }));
    await createDecisionReceipt(env.DB, {
      userId: String(post.user_id), clientId, ownerKind, ownerId,
      postId: String(post.id), mode, stage: 'snapshot', releaseState: 'shadow_only',
      contentHash, summary: { scheduledFor: post.scheduled_for, imageCritiqueScore: post.image_critique_score },
    });
    processed += 1;
  }
  return { posts_processed: processed };
}
```

- [ ] **Step 4: Add the authenticated inspection route**

```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import { listDecisionReceipts } from '../lib/learning/decision-repository';

export function registerLearningRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/learning/decisions/:postId', async (c) => {
    const uid = await getAuthUserId(
      c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB,
      c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET,
    );
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') || null;
    const rows = await listDecisionReceipts(c.env.DB, uid, clientId, c.req.param('postId'), 20);
    return c.json({ decisions: rows });
  });
}
```

- [ ] **Step 5: Extend account and client deletion coverage**

Before deleting a client, delete its `learning_decisions` and `workspace_learning_settings` rows with both authenticated `user_id` and `workspace_key=clientId`; verdicts cascade from decisions. Before deleting a user, delete all of that user's decisions and settings. During Shopify uninstall, delete rows using `user_id=shop_domain` plus `workspace_key='shop:<canonical-domain>'` before removing the shop sentinel. In `learning-deletion.test.ts`, use a recording D1 fake to assert all three ownership kinds bind their tenant keys, a client/shop deletion cannot touch another tenant, and account deletion issues settings/decision cleanup before deleting the user.

- [ ] **Step 6: Register route and cron without changing publish order**

In `index.ts`, import and call `registerLearningRoutes(app)` with the other Clerk-auth routes.

In the `*/5 * * * *` branch of `dispatcher.ts`, add after image/video prewarm and before publish:

```ts
await trackCron(env, 'learning_shadow', () => cronEvaluateLearningShadow(env));
```

The new cron must remain independent inside `trackCron`; its failure cannot stop `cronPublishMissedPosts`.

- [ ] **Step 7: Test route ownership, deletion, and dispatcher wiring**

Run: `cd workers/api; npm test -- learning-shadow.test.ts learning-routes.test.ts learning-deletion.test.ts; npm run typecheck`

Expected: all tests PASS; unauthenticated route returns 401; Clerk and signed portal/embed auth can read only their workspace; cross-owner lookup returns no rows; deletion is tenant-scoped; shadow SQL contains no post mutation.

- [ ] **Step 8: Commit shadow evaluation**

```powershell
git add workers/api/src/cron/evaluate-learning-shadow.ts workers/api/src/routes/learning.ts workers/api/src/routes/user.ts workers/api/src/routes/clients.ts workers/api/src/routes/shopify-oauth.ts workers/api/src/index.ts workers/api/src/cron/dispatcher.ts workers/api/src/__tests__/learning-shadow.test.ts workers/api/src/__tests__/learning-routes.test.ts workers/api/src/__tests__/learning-deletion.test.ts
git commit -m "feat: add read only learning shadow evaluation"
```

### Task 5: Configure, Document, Migrate, And Deploy Release 1

**Files:**
- Modify: `workers/api/wrangler.toml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add disabled production variables**

Add under `[vars]` in `workers/api/wrangler.toml`:

```toml
LEARNING_BRAIN_ENABLED = "false"
LEARNING_RELEASE_ENFORCEMENT = "false"
```

- [ ] **Step 2: Update the developer map**

Update `AGENTS.md` to record schema v37, `routes/learning.ts`, `cron/evaluate-learning-shadow.ts`, the `lib/learning/` boundary, and both new vars. State that Release 1 is read-only and off by default.

- [ ] **Step 3: Run the complete local verification**

Run: `cd workers/api; npm test; npm run typecheck`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 4: Apply v37 to staging and inspect it**

```powershell
cd workers/api
npx wrangler d1 execute socialai-db-staging --remote --file=schema_v37_learning_foundation.sql
npx wrangler d1 execute socialai-db-staging --remote --command="PRAGMA table_info(workspace_learning_settings);"
npx wrangler d1 execute socialai-db-staging --remote --command="PRAGMA table_info(learning_decisions);"
```

Expected: migration succeeds; `workspace_learning_settings` includes `workspace_key`, `owner_kind`, `owner_id`, mode, consent, policy, experiment, and USD-cent budget fields; `learning_decisions` includes `user_id`, `workspace_key`, `client_id`, `owner_kind`, `owner_id`, `post_id`, `mode`, `stage`, and `release_state`.

- [ ] **Step 5: Back up and migrate production**

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "D:\GitHubBackup\SocialAi\database\socialai-db-pre-v37-$stamp.sql"
New-Item -ItemType Directory -Force (Split-Path $backup) | Out-Null
npx wrangler d1 export socialai-db --remote --output=$backup
npx wrangler d1 execute socialai-db --remote --file=schema_v37_learning_foundation.sql
npx wrangler d1 execute socialai-db --remote --command="PRAGMA table_info(workspace_learning_settings);"
npx wrangler d1 execute socialai-db --remote --command="PRAGMA table_info(learning_decisions);"
```

Expected: export exists on D drive, migration succeeds, and the production pragma matches staging.

- [ ] **Step 6: Deploy with both flags false**

Run from `workers/api`:

```powershell
npx wrangler deploy --config wrangler.toml
```

Expected: deploy succeeds with a Worker version ID.

- [ ] **Step 7: Verify no behaviour change**

```powershell
Invoke-RestMethod 'https://socialai-api.steve-700.workers.dev/api/health'
npx wrangler d1 execute socialai-db --remote --command="SELECT COUNT(*) AS decisions FROM learning_decisions;"
```

Expected: health returns `ok=true`; decisions remain `0` while the global flag is false; scheduled posts keep their existing content, status, and times.

- [ ] **Step 8: Commit, push, and save**

```powershell
git add workers/api/wrangler.toml AGENTS.md
git commit -m "docs: record learning shadow foundation"
git push -u origin codex/customer-learning-brain
npm run codex:save
```

Expected: branch is on GitHub and the D-drive save completes without errors.
