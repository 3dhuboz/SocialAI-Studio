# Release 3 Organic Reach Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workspace a confirmed geographic market, private audience segments, and per-post Facebook/Instagram Reach Plans covering timing, local language, hashtags, and media format.

**Architecture:** D1 stores versioned reach profiles, audience segments, approved media assets, and immutable Reach Plans. Pure timing/hashtag/media selectors use private account evidence first and archetype fallbacks second; AI proposes context but deterministic validators enforce geography, protected-trait, rights, and platform boundaries.

**Tech Stack:** Cloudflare Worker, D1 schema v38, Workers AI/Anthropic/OpenRouter, React, TypeScript, Vitest.

**Boundary:** This mirrors paid-campaign planning discipline, not paid Meta distribution. It may optimise creative, timing, local relevance, and broad commercial segments, but it must never claim guaranteed reach or infer protected-trait targeting.

---

## File Structure

- Create `workers/api/schema_v38_organic_reach.sql`.
- Create `workers/api/src/lib/reach/types.ts`, `reach-profile.ts`, `audience-model.ts`, `timing-model.ts`, `hashtag-model.ts`, `media-director.ts`, and `reach-plan.ts`; reuse `workspaceKey` from Release 1 rather than creating a second tenant-key implementation.
- Create `workers/api/src/routes/reach.ts`, `workers/api/src/routes/shopify-reach.ts`, and focused Worker tests.
- Create `src/components/ReachProfilePanel.tsx` and frontend service types.
- Modify `index.ts`, `env.ts`, `recommendations.ts`, `evaluate-learning-shadow.ts`, `routes/user.ts`, `routes/clients.ts`, `routes/shopify-oauth.ts`, `PostModal.tsx`, `AiEnginePanel.tsx`, `shopify-app/src/api.ts`, `shopify-app/src/pages/Settings.tsx`, `wrangler.toml`, and `AGENTS.md`.

### Task 1: Add V38 Reach Tables

**Files:**
- Create: `workers/api/schema_v38_organic_reach.sql`
- Create: `workers/api/src/__tests__/reach-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
it('creates private reach profiles, segments, plans, and approved assets', () => {
  const sql = readFileSync(resolve(process.cwd(), 'schema_v38_organic_reach.sql'), 'utf8');
  for (const table of ['reach_profiles', 'audience_segments', 'reach_plans', 'approved_media_assets']) {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  }
  expect(sql).toContain('workspace_key TEXT NOT NULL');
  expect(sql).toContain('owner_kind TEXT NOT NULL');
  expect(sql).toContain('owner_id TEXT NOT NULL');
  expect(sql).not.toMatch(/ALTER TABLE posts/i);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd workers/api; npm test -- reach-schema.test.ts`

Expected: FAIL because v38 does not exist.

- [ ] **Step 3: Create the migration**

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reach_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('proposed','confirmed')),
  timezone TEXT NOT NULL,
  base_location_json TEXT NOT NULL,
  service_area_json TEXT NOT NULL,
  excluded_locations_json TEXT NOT NULL DEFAULT '[]',
  platforms_json TEXT NOT NULL DEFAULT '["facebook","instagram"]',
  cadence_json TEXT NOT NULL DEFAULT '{}',
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, version)
);

CREATE TABLE IF NOT EXISTS audience_segments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  reach_profile_id TEXT NOT NULL,
  label TEXT NOT NULL,
  needs_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('predicted','confirmed','disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reach_profile_id) REFERENCES reach_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approved_media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image','video','poster','carousel')),
  url TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  rights_status TEXT NOT NULL CHECK (rights_status IN ('confirmed','blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reach_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reach_profile_id TEXT NOT NULL,
  reach_profile_version INTEGER NOT NULL,
  objective TEXT NOT NULL,
  audience_segment_id TEXT,
  geographic_focus_json TEXT NOT NULL,
  platform_plan_json TEXT NOT NULL,
  timing_json TEXT NOT NULL,
  language_json TEXT NOT NULL,
  hashtag_json TEXT NOT NULL,
  media_json TEXT NOT NULL,
  experiment_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('shadow','selected','invalidated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reach_profile_id) REFERENCES reach_profiles(id),
  FOREIGN KEY (audience_segment_id) REFERENCES audience_segments(id)
);

CREATE INDEX IF NOT EXISTS idx_reach_profiles_workspace ON reach_profiles(user_id,workspace_key,version DESC);
CREATE INDEX IF NOT EXISTS idx_audience_segments_workspace ON audience_segments(user_id,workspace_key,status);
CREATE INDEX IF NOT EXISTS idx_reach_plans_post ON reach_plans(user_id,workspace_key,post_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_workspace ON approved_media_assets(user_id,workspace_key,rights_status);
```

- [ ] **Step 4: Run the schema test and commit**

Run: `cd workers/api; npm test -- reach-schema.test.ts`

Expected: PASS.

```powershell
git add workers/api/schema_v38_organic_reach.sql workers/api/src/__tests__/reach-schema.test.ts
git commit -m "feat: add organic reach schema"
```

### Task 2: Add Reach Types, Workspace Keys, And Profile Repository

**Files:**
- Create: `workers/api/src/lib/reach/types.ts`
- Create: `workers/api/src/lib/reach/reach-profile.ts`
- Create: `workers/api/src/__tests__/reach-profile.test.ts`
- Modify: `workers/api/src/env.ts`

- [ ] **Step 1: Write profile validation and tenant-isolation tests**

```ts
it('requires a confirmed profile with timezone and included locations', () => {
  expect(() => assertConfirmedReachProfile({ ...profile, confirmationStatus: 'proposed' })).toThrow();
  expect(() => assertConfirmedReachProfile({ ...profile, serviceArea: { radiusKm: null, included: [] } })).toThrow();
  expect(() => assertConfirmedReachProfile(profile)).not.toThrow();
});

it('uses the shared non-null owner workspace key', () => {
  expect(workspaceKey(null)).toBe('__owner__');
  expect(workspaceKey('client_1')).toBe('client_1');
  expect(workspaceKey(null, 'shop', 'Store.MyShopify.com')).toBe('shop:store.myshopify.com');
});

it('binds authenticated owner and workspace key on every repository operation', async () => {
  const { db, calls } = makeRecordingD1();
  await getLatestReachProfile(db, 'owner_1', 'client_1');
  expect(calls[0].binds).toEqual(['owner_1', 'client_1']);
});
```

Define `profile` in the test as a complete user-owned `ReachProfile` for `Australia/Brisbane`, including `ownerKind='user'` and `ownerId=userId`, and import `makeRecordingD1` from the Release 1 helper. Add repository binding coverage for a Shopify profile using the canonical shop workspace key.

- [ ] **Step 2: Implement core types and workspace key**

```ts
import type { WorkspaceOwnerKind } from '../learning/types';

export type OrganicPlatform = 'facebook' | 'instagram';
export type ReachConfirmation = 'proposed' | 'confirmed';

export interface ReachProfile {
  id: string; userId: string; clientId: string | null; workspaceKey: string;
  ownerKind: WorkspaceOwnerKind; ownerId: string;
  version: number; confirmationStatus: ReachConfirmation; timezone: string;
  baseLocation: { country: string; region: string; locality: string };
  serviceArea: { radiusKm: number | null; included: string[] };
  excludedLocations: string[]; platforms: OrganicPlatform[];
}

export interface ApprovedMediaAsset {
  id: string;
  assetType: 'image' | 'video' | 'poster' | 'carousel';
  tags: string[];
  rightsStatus: 'confirmed' | 'blocked';
}

export interface MediaDirectorInput {
  assets: ApprovedMediaAsset[];
  requiredTags: string[];
  objective: string;
  platform: OrganicPlatform;
  history: Array<{
    format: ApprovedMediaAsset['assetType'];
    platform: OrganicPlatform;
    objective: string;
    score: number;
  }>;
}

export interface MediaDirection {
  source: 'approved_asset' | 'generated';
  assetId: string | null;
  format: ApprovedMediaAsset['assetType'];
  generate: boolean;
}

export function assertConfirmedReachProfile(profile: ReachProfile): void {
  if (profile.confirmationStatus !== 'confirmed') throw new Error('Reach profile is not confirmed');
  if (!profile.timezone || profile.serviceArea.included.length === 0) throw new Error('Reach profile is incomplete');
  new Intl.DateTimeFormat('en-AU', { timeZone: profile.timezone }).format(new Date());
}
```

- [ ] **Step 3: Implement versioned repository operations**

Add `getLatestReachProfile`, `proposeReachProfile`, `confirmReachProfile`, and `listApprovedAssets`. Each operation accepts `{ userId, clientId, ownerKind, ownerId }`, calls the single Release 1 `normalizeWorkspaceIdentity` helper before preparing SQL, and stores/binds its canonical `user_id`, `workspace_key`, `owner_kind`, and `owner_id`; confirmation inserts a new version rather than mutating historical plans. Also verify that a client row belongs to the canonical user and that a shop sentinel remains installed.

- [ ] **Step 4: Add disabled reach flags**

Add to `Env`:

```ts
  ORGANIC_REACH_ENABLED?: string;
  ORGANIC_REACH_APPLY_ENABLED?: string;
```

- [ ] **Step 5: Run tests and commit**

Run: `cd workers/api; npm test -- reach-profile.test.ts; npm run typecheck`

Expected: PASS.

```powershell
git add workers/api/src/lib/reach workers/api/src/env.ts workers/api/src/__tests__/reach-profile.test.ts
git commit -m "feat: add confirmed reach profiles"
```

### Task 3: Propose Safe Audience Segments

**Files:**
- Create: `workers/api/src/lib/reach/audience-model.ts`
- Create: `workers/api/src/__tests__/reach-audience-model.test.ts`

- [ ] **Step 1: Write failing safety tests**

```ts
const validSegments = [{
  label: 'Local families planning weekend takeaway',
  needs: ['easy group meal'],
  messageAngles: ['pre-order convenience'],
  suitableOffers: ['family pack'],
  evidence: ['confirmed Gladstone service area'],
  confidence: 0.72,
}];

it('rejects protected-trait audience labels', () => {
  expect(() => validateAudienceSegments([{ ...validSegments[0], label: 'People of a specific religion' }])).toThrow();
});

it('keeps segments broad, commercial, and capped at five', () => {
  expect(validateAudienceSegments(validSegments).length).toBeLessThanOrEqual(5);
});

it('rejects precise age, medical, political, and hardship targeting in any field', () => {
  for (const phrase of ['people aged 63', 'diabetes sufferers', 'party voters', 'people in financial hardship']) {
    expect(() => validateAudienceSegments([{ ...validSegments[0], messageAngles: [phrase] }])).toThrow();
  }
});
```

- [ ] **Step 2: Implement deterministic safety validation**

Create a denylist for religion, race, ethnicity, disability, medical condition, sexual orientation, political belief, precise age targeting, and financial hardship. Validation rejects labels/evidence containing those concepts and requires each segment to describe a commercial need or buying context.

- [ ] **Step 3: Implement AI proposal using only verified private context**

Use `callIndependentJson` with the confirmed reach profile, business profile, and tenant-scoped facts: `client_facts` for user/client workspaces and `shopify_facts` for shops. Return three to five segments shaped as `{ label, needs, messageAngles, suitableOffers, evidence, confidence }`. Wrap imported posts/facts as untrusted. Persist as `predicted`; confirmation is a separate route action.

- [ ] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- reach-audience-model.test.ts; npm run typecheck`

Expected: protected traits are rejected and valid segments pass.

```powershell
git add workers/api/src/lib/reach/audience-model.ts workers/api/src/__tests__/reach-audience-model.test.ts
git commit -m "feat: add private audience prediction"
```

### Task 4: Add Account-specific Timing And Hashtag Models

**Files:**
- Create: `workers/api/src/lib/reach/timing-model.ts`
- Create: `workers/api/src/lib/reach/hashtag-model.ts`
- Create: `workers/api/src/__tests__/reach-timing.test.ts`
- Create: `workers/api/src/__tests__/reach-hashtags.test.ts`

- [ ] **Step 1: Write deterministic timing tests**

Cover timezone conversion, fallback when history is sparse, platform/media-specific evidence, excluded duplicate slots, and a rule that low confidence returns a ranked window rather than a hold.

- [ ] **Step 2: Implement the timing ranker**

```ts
export interface TimingEvidence { weekday: number; hour: number; platform: OrganicPlatform; mediaType: string; score: number; }
export interface RankedWindow {
  weekday: number; startHour: number; endHour: number; platform: OrganicPlatform; mediaType: string;
  expectedScore: number; confidence: number; sampleSize: number; source: 'account'|'archetype';
}

export function rankPostingWindows(evidence: TimingEvidence[], fallback: RankedWindow[]): RankedWindow[] {
  if (evidence.length < 5) return fallback;
  const grouped = new Map<string, number[]>();
  for (const row of evidence) {
    const key = `${row.weekday}:${row.hour}:${row.platform}:${row.mediaType}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row.score]);
  }
  return [...grouped.entries()].map(([key, scores]) => {
    const [weekday, hour, platform, mediaType] = key.split(':');
    const sampleSize = scores.length;
    const mean = scores.reduce((sum, score) => sum + score, 0) / sampleSize;
    const confidence = Math.min(0.95, sampleSize / 10);
    return { weekday: Number(weekday), startHour: Number(hour), endHour: Number(hour) + 1,
      platform: platform as OrganicPlatform, mediaType, sampleSize, confidence,
      expectedScore: mean * confidence + 50 * (1 - confidence), source: 'account' as const };
  }).sort((a, b) => b.expectedScore - a.expectedScore || b.confidence - a.confidence);
}
```

Reject evidence outside weekday `0..6`, hour `0..23`, score `0..100`, or the requested timezone conversion before grouping. Rank Facebook/image, Facebook/video, Instagram/image, and Instagram/video independently; never discard the platform or media dimensions after grouping.

- [ ] **Step 3: Write hashtag filtering tests**

Test location inclusion, platform-specific sets, normalisation, duplicate removal, forbidden/spam term removal, and that empty evidence falls back to verified location/category/brand terms.

- [ ] **Step 4: Implement the hashtag plan**

Return `{ localKeywords, facebookTags, instagramTags, excluded, evidence }`. Cap Facebook to three focused tags and Instagram to eight focused tags in the first release. Keep all limits in exported constants so account evidence can revise them without changing call sites.

- [ ] **Step 5: Run tests and commit**

Run: `cd workers/api; npm test -- reach-timing.test.ts reach-hashtags.test.ts; npm run typecheck`

Expected: PASS.

```powershell
git add workers/api/src/lib/reach/timing-model.ts workers/api/src/lib/reach/hashtag-model.ts workers/api/src/__tests__/reach-timing.test.ts workers/api/src/__tests__/reach-hashtags.test.ts
git commit -m "feat: add reach timing and hashtag models"
```

### Task 5: Add Media Director And Reach Plan Orchestrator

**Files:**
- Create: `workers/api/src/lib/reach/media-director.ts`
- Create: `workers/api/src/lib/reach/reach-plan.ts`
- Create: `workers/api/src/__tests__/reach-plan.test.ts`

- [ ] **Step 1: Write selection-order tests**

```ts
const asset = (patch: Partial<ApprovedMediaAsset> = {}): ApprovedMediaAsset => ({
  id: 'brisket-1', assetType: 'image', tags: ['brisket', 'gladstone'], rightsStatus: 'confirmed', ...patch,
});
const mediaInput: MediaDirectorInput = {
  assets: [asset()], requiredTags: ['brisket', 'gladstone'], objective: 'local_order',
  platform: 'facebook', history: [],
};

it('prefers a fully matching rights-confirmed real asset', () => {
  expect(chooseMediaDirection(mediaInput)).toMatchObject({ source: 'approved_asset', assetId: 'brisket-1', generate: false });
});

it('never selects a blocked or only-partially-related asset', () => {
  const blocked = chooseMediaDirection({ ...mediaInput, assets: [asset({ rightsStatus: 'blocked' })] });
  const unrelated = chooseMediaDirection({ ...mediaInput, assets: [asset({ tags: ['brisket'] })] });
  expect(blocked.source).toBe('generated');
  expect(unrelated.source).toBe('generated');
});

it('requests generation only when no approved asset fully matches', () => {
  expect(chooseMediaDirection({ ...mediaInput, assets: [] }).generate).toBe(true);
  expect(chooseMediaDirection(mediaInput).generate).toBe(false);
});

it('creates Facebook and Instagram treatments separately', () => {
  const treatments = buildPlatformTreatments({ facebookCaption: 'Book locally', instagramCaption: 'Fresh today',
    facebookTags: ['GladstoneBBQ'], instagramTags: ['GladstoneBBQ','LowAndSlow'] });
  expect(treatments.facebook.caption).not.toBe(treatments.instagram.caption);
  expect(treatments.facebook.hashtags).toHaveLength(1);
  expect(treatments.instagram.hashtags).toHaveLength(2);
});

it('rejects experiments that change more than one variable', () => {
  expect(() => assertSingleExperimentChange({ hour: 17, format: 'image' }, { hour: 18, format: 'video' })).toThrow();
  expect(() => assertSingleExperimentChange({ hour: 17, format: 'image' }, { hour: 18, format: 'image' })).not.toThrow();
});

it('never chooses a Facebook format from Instagram-only evidence', () => {
  const history = Array.from({ length: 5 }, () => ({
    format: 'video' as const, platform: 'instagram' as const, objective: 'local_order', score: 100,
  }));
  expect(chooseFormat('local_order', 'facebook', history)).toBe('image');
});
```

- [ ] **Step 2: Implement media selection**

```ts
export function chooseFormat(
  objective: string,
  platform: OrganicPlatform,
  history: MediaDirectorInput['history'],
): ApprovedMediaAsset['assetType'] {
  const samePlatform = history.filter((row) => row.platform === platform && Number.isFinite(row.score));
  const sameObjective = samePlatform.filter((row) => row.objective === objective);
  const eligible = sameObjective.length >= 5 ? sameObjective : samePlatform;
  if (eligible.length >= 5) {
    const byFormat = new Map<ApprovedMediaAsset['assetType'], number[]>();
    for (const row of eligible) byFormat.set(row.format, [...(byFormat.get(row.format) ?? []), row.score]);
    const ranked = [...byFormat.entries()]
      .filter(([, scores]) => scores.length >= 3)
      .map(([format, scores]) => ({ format, mean: scores.reduce((sum, score) => sum + score, 0) / scores.length }))
      .sort((a, b) => b.mean - a.mean);
    if (ranked.length) return ranked[0].format;
  }
  if (platform === 'instagram' && ['demonstration', 'behind_scenes'].includes(objective)) return 'video';
  return 'image';
}

export function chooseMediaDirection(input: MediaDirectorInput): MediaDirection {
  const real = input.assets.find((asset) => asset.rightsStatus === 'confirmed'
    && input.requiredTags.length > 0
    && input.requiredTags.every((tag) => asset.tags.map((value) => value.toLowerCase()).includes(tag.toLowerCase())));
  if (real) return { source: 'approved_asset', assetId: real.id, format: real.assetType, generate: false };
  return { source: 'generated', assetId: null, format: chooseFormat(input.objective, input.platform, input.history), generate: true };
}
```

In `reach-plan.ts`, keep platform treatment and experiment validation deterministic:

```ts
export function buildPlatformTreatments(input: {
  facebookCaption: string; instagramCaption: string; facebookTags: string[]; instagramTags: string[];
}) {
  return {
    facebook: { caption: input.facebookCaption, hashtags: [...input.facebookTags] },
    instagram: { caption: input.instagramCaption, hashtags: [...input.instagramTags] },
  };
}

export function assertSingleExperimentChange(
  control: Record<string, string | number>,
  test: Record<string, string | number>,
): void {
  const keys = new Set([...Object.keys(control), ...Object.keys(test)]);
  const changed = [...keys].filter((key) => control[key] !== test[key]);
  if (changed.length > 1) throw new Error(`Experiment changes ${changed.length} variables`);
}
```

- [ ] **Step 3: Implement and persist Reach Plans**

`buildReachPlan(env, userId, clientId, postBrief)` must require a confirmed profile before apply mode, select one audience segment, rank timing, build platform-specific language/hashtags with `buildPlatformTreatments`, choose media direction, validate `assertSingleExperimentChange`, and persist immutable JSON fields. In shadow mode, an unconfirmed proposal may be evaluated but cannot influence scheduling or generated media. A generated direction must call the existing `generateImageWithGuardrails` or existing reel pipeline and then pass Release 2 media preflight; the Reach Engine must never bypass those chokepoints.

- [ ] **Step 4: Run tests and commit**

Run: `cd workers/api; npm test -- reach-plan.test.ts; npm run typecheck`

Expected: PASS; no blocked asset or out-of-area location is selected.

```powershell
git add workers/api/src/lib/reach/media-director.ts workers/api/src/lib/reach/reach-plan.ts workers/api/src/__tests__/reach-plan.test.ts
git commit -m "feat: build organic reach plans"
```

### Task 6: Add Reach APIs And One-time Confirmation UI

**Files:**
- Create: `workers/api/src/routes/reach.ts`
- Create: `workers/api/src/routes/shopify-reach.ts`
- Create: `workers/api/src/__tests__/reach-routes.test.ts`
- Create: `workers/api/src/__tests__/shopify-reach-routes.test.ts`
- Create: `workers/api/src/__tests__/reach-deletion.test.ts`
- Create: `src/components/ReachProfilePanel.tsx`
- Modify: `workers/api/src/index.ts`
- Modify: `workers/api/src/routes/user.ts`
- Modify: `workers/api/src/routes/clients.ts`
- Modify: `workers/api/src/routes/shopify-oauth.ts`
- Modify: `src/services/db.ts`
- Modify: `src/components/AiEnginePanel.tsx`
- Modify: `src/components/PostModal.tsx`
- Modify: `shopify-app/src/api.ts`
- Modify: `shopify-app/src/pages/Settings.tsx`

- [ ] **Step 1: Add authenticated route tests**

Cover `GET /api/reach/profile`, `POST /api/reach/profile/propose`, `PUT /api/reach/profile/confirm`, `POST /api/reach/segments/propose`, `PUT /api/reach/segments/confirm`, and `GET /api/reach/plans/:postId`. Every route must reject cross-owner/client access; add signed portal/embed auth coverage using the same optional secret path as post routes. Mirror profile/segment/plan operations under `/api/shopify/reach/*` using the existing signed Shopify session gate; the server derives the canonical shop domain and ignores any tenant ID supplied by the body.

- [ ] **Step 2: Register the routes**

Export `registerReachRoutes(app)` and `registerShopifyReachRoutes(app)`. Apply `getAuthUserId` with `ISS_EMBED_SECRET || PENNYBUILDER_PROVISION_SECRET` to main/portal routes, the existing Shopify session gate to shop routes, and rate limits to both AI proposal endpoints. Register both in `index.ts`.

- [ ] **Step 3: Build the one-time confirmation panel**

`ReachProfilePanel` displays base location, timezone, radius, included/excluded areas, platforms, and predicted segments. Confirmation sends the complete reviewed profile once. Edits create a new version and do not invalidate old decision receipts. Add the same fields to Shopify `Settings.tsx` through typed methods in `shopify-app/src/api.ts`; do not reuse Clerk tokens in the embedded app.

- [ ] **Step 4: Show Reach Plan rationale in PostModal**

Display intended audience, geographic focus, platform treatment, timing confidence, local keywords, hashtags, and media source under the existing preflight report. Keep it read-only while `ORGANIC_REACH_APPLY_ENABLED=false`.

- [ ] **Step 5: Extend account and client deletion coverage**

Delete in dependency order: `reach_plans`, `approved_media_assets`, `audience_segments`, then `reach_profiles`. Client deletion binds authenticated `user_id` plus `workspace_key=clientId`; account deletion removes every row for `user_id`; Shopify uninstall binds the shop sentinel plus canonical `shop:` key. In `reach-deletion.test.ts`, assert the order and tenant binds, and prove one client/shop deletion cannot remove another workspace.

- [ ] **Step 6: Run frontend and Worker tests**

Run: `cd workers/api; npm test -- reach-routes.test.ts shopify-reach-routes.test.ts reach-deletion.test.ts; npm run typecheck`

Run from root: `npm test; npm run build`

Run: `cd shopify-app; npm run typecheck; npm run build`

Expected: PASS.

- [x] **Step 7: Commit API and UI**

```powershell
git add workers/api/src/routes/reach.ts workers/api/src/routes/shopify-reach.ts workers/api/src/routes/user.ts workers/api/src/routes/clients.ts workers/api/src/routes/shopify-oauth.ts workers/api/src/index.ts workers/api/src/__tests__/reach-routes.test.ts workers/api/src/__tests__/shopify-reach-routes.test.ts workers/api/src/__tests__/reach-deletion.test.ts src/components/ReachProfilePanel.tsx src/services/db.ts src/components/AiEnginePanel.tsx src/components/PostModal.tsx shopify-app/src/api.ts shopify-app/src/pages/Settings.tsx
git commit -m "feat: add organic reach setup and rationale"
```

### Task 7: Run Reach Plans In Shadow And Deploy Release 3

**Files:**
- Modify: `workers/api/src/cron/evaluate-learning-shadow.ts`
- Modify: `workers/api/src/routes/recommendations.ts`
- Modify: `workers/api/wrangler.toml`
- Modify: `AGENTS.md`

- [x] **Step 1: Attach shadow Reach Plans to decision receipts**

When `ORGANIC_REACH_ENABLED=true`, build a shadow Reach Plan for each upcoming post and persist its ID on the snapshot decision. Do not alter content, hashtags, image, platform, or `scheduled_for` while apply is false.

- [x] **Step 2: Replace generic schedule advice only in preview results**

Refactor the recommendations schedule audit to call the timing ranker and return account-specific preview windows. Do not write new times unless the existing auto-fix request has `dryRun=false` and `ORGANIC_REACH_APPLY_ENABLED=true`.

- [x] **Step 3: Configure shadow flags**

```toml
ORGANIC_REACH_ENABLED = "true"
ORGANIC_REACH_APPLY_ENABLED = "false"
```

- [x] **Step 4: Migrate staging, back up production, migrate production**

Use the Release 1 migration sequence with `schema_v38_organic_reach.sql` and backup name `socialai-db-pre-v38-$stamp.sql`. Verify all four tables with `PRAGMA table_info`.

- [x] **Step 5: Run complete verification and deploy**

Run Worker tests/typecheck, main frontend tests/build, and Shopify typecheck/build. Deploy Worker with explicit config. Verify live health, shadow plan counts for user/client/shop ownership, zero out-of-area plans, and no post mutations while apply is false.

- [x] **Step 6: Update map, commit, push, and save**

Update schema version to v38 and document all reach modules/flags in `AGENTS.md`.

```powershell
git add workers/api/src/cron/evaluate-learning-shadow.ts workers/api/src/routes/recommendations.ts workers/api/wrangler.toml AGENTS.md
git commit -m "feat: run organic reach plans in shadow"
git push
npm run codex:save
```
