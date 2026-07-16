import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  recordPublishDeliveryReceipt,
  recordPublicationEvent,
  type PersistedPublicationEvent,
  type PublicationEventInput,
} from '../lib/learning/publication-repository';
import {
  collectOutcomeWindows,
  dueOutcomeWindows,
  fetchOutcomeSignals,
  listDueOutcomeWindows,
  OUTCOME_MAX_ATTEMPTS,
  OUTCOME_WINDOWS,
  recordUnavailableOutcomeAttempt,
  saveLearningOutcome,
} from '../lib/learning/outcome-collector';
import { cronCollectLearningOutcomes } from '../cron/collect-learning-outcomes';
import { makeRecordingD1 } from './helpers/recording-d1';

const publishedAt = '2026-07-01T00:00:00.000Z';

const userPublicationInput: PublicationEventInput = {
  userId: ' user_1 ',
  clientId: null,
  ownerKind: 'user',
  ownerId: 'user_1',
  postId: 'post_1',
  platform: ' Facebook ',
  remotePostId: 'fb_1',
  permalink: 'https://facebook.example/post/fb_1',
  decisionId: 'decision_1',
  reachPlanId: 'reach_1',
  publishedAt,
};

const userPublication: PersistedPublicationEvent = {
  id: 'publication_1',
  userId: 'user_1',
  clientId: null,
  ownerKind: 'user',
  ownerId: 'user_1',
  workspaceKey: '__owner__',
  postId: 'post_1',
  platform: 'facebook',
  remotePostId: 'fb_1',
  permalink: 'https://facebook.example/post/fb_1',
  decisionId: 'decision_1',
  reachPlanId: 'reach_1',
  publishedAt,
};

const shopPublication: PersistedPublicationEvent = {
  id: 'publication_shop_1',
  userId: 'store.myshopify.com',
  clientId: null,
  ownerKind: 'shop',
  ownerId: 'store.myshopify.com',
  workspaceKey: 'shop:store.myshopify.com',
  postId: 'shop_post_1',
  platform: 'facebook',
  remotePostId: 'shop_fb_1',
  permalink: null,
  decisionId: null,
  reachPlanId: null,
  publishedAt,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publication repository', () => {
  it('records canonical tenant-scoped delivery evidence while ignoring only duplicate events', async () => {
    const { db, calls } = makeRecordingD1();

    await recordPublishDeliveryReceipt(db, {
      attemptId: ' attempt_1 ',
      userId: ' owner_1 ',
      clientId: ' client_1 ',
      ownerKind: 'client',
      ownerId: 'client_1',
      postId: ' post_1 ',
      platform: ' Facebook ',
      backend: 'postproxy',
      eventKind: 'provider_accepted',
      contentHash: 'a'.repeat(64),
      remotePostId: ' remote_1 ',
      httpStatus: 201,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain(
      'ON CONFLICT(attempt_id,event_kind) DO NOTHING',
    );
    expect(calls[0].sql).not.toContain('INSERT OR IGNORE');
    expect(calls[0].binds).toEqual(expect.arrayContaining([
      'attempt_1',
      'owner_1',
      'client_1',
      'client',
      'post_1',
      'facebook',
      'postproxy',
      'provider_accepted',
      'a'.repeat(64),
      'remote_1',
      201,
    ]));
  });

  it('records a canonical user publication idempotently without moving its first publication time', async () => {
    const { db, calls } = makeRecordingD1();

    await recordPublicationEvent(db, userPublicationInput);
    await recordPublicationEvent(db, {
      ...userPublicationInput,
      publishedAt: '2026-07-02T00:00:00.000Z',
      permalink: 'https://facebook.example/post/enriched',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain(
      'ON CONFLICT(user_id,workspace_key,post_id,platform)',
    );
    expect(calls[0].sql).toContain(
      'permalink = COALESCE(excluded.permalink, publication_events.permalink)',
    );
    expect(calls[0].sql).not.toMatch(/published_at\s*=/i);
    expect(calls[0].binds).toEqual(expect.arrayContaining([
      'user_1',
      '__owner__',
      'user',
      'post_1',
      'facebook',
      publishedAt,
    ]));
  });

  it('records the canonical Shopify sentinel and workspace identity', async () => {
    const { db, calls } = makeRecordingD1();

    await recordPublicationEvent(db, {
      userId: 'Store.MyShopify.com',
      clientId: null,
      ownerKind: 'shop',
      ownerId: ' STORE.MYSHOPIFY.COM ',
      postId: 'shop_post_1',
      platform: 'facebook',
      remotePostId: 'shop_fb_1',
      permalink: null,
      decisionId: null,
      reachPlanId: null,
      publishedAt,
    });

    expect(calls[0].binds).toEqual(expect.arrayContaining([
      'store.myshopify.com',
      'shop:store.myshopify.com',
      'shop',
      'shop_post_1',
      'facebook',
    ]));
    expect(calls[0].binds).not.toContain('Store.MyShopify.com');
  });

  it('rejects inconsistent ownership before preparing SQL', async () => {
    const { db, calls } = makeRecordingD1();

    await expect(recordPublicationEvent(db, {
      ...userPublicationInput,
      ownerKind: 'shop',
      ownerId: 'store.myshopify.com',
    })).rejects.toThrow('Invalid Shopify workspace identity');

    expect(calls).toEqual([]);
  });

  it('converts a canonical naive AEST publication time to an immutable UTC instant', async () => {
    const { db, calls } = makeRecordingD1();

    await recordPublicationEvent(db, {
      ...userPublicationInput,
      publishedAt: '2026-07-14T09:00:00',
    });

    expect(calls[0].binds).toContain('2026-07-13T23:00:00.000Z');
    expect(calls[0].binds).not.toContain('2026-07-14T09:00:00');
  });
});

describe('immutable outcome windows', () => {
  it('exposes only frozen 24, 72, and 168 hour windows', () => {
    expect(OUTCOME_WINDOWS).toEqual([24, 72, 168]);
    expect(Object.isFrozen(OUTCOME_WINDOWS)).toBe(true);
  });

  it('makes windows due only at their immutable publication-relative boundaries', () => {
    expect(dueOutcomeWindows(
      publishedAt,
      '2026-07-01T23:59:59.999Z',
    )).toEqual([]);
    expect(dueOutcomeWindows(
      publishedAt,
      '2026-07-02T00:00:00.000Z',
    )).toEqual([24]);
    expect(dueOutcomeWindows(
      publishedAt,
      '2026-07-04T00:00:00.000Z',
    )).toEqual([24, 72]);
    expect(dueOutcomeWindows(
      publishedAt,
      '2026-07-08T00:00:00.000Z',
    )).toEqual([24, 72, 168]);
  });

  it('collects each canonical window once in canonical order', async () => {
    const saved: number[] = [];
    const resolved: number[] = [];

    const result = await collectOutcomeWindows(
      userPublication,
      [168, 24, 72, 24],
      {
        hasOutcome: async () => false,
        fetchSignals: async () => ({
          sourceStatus: 'complete',
          values: { reach: 60 },
          rawSignals: { reach: 123 },
        }),
        saveOutcome: async (_event, window) => {
          saved.push(window);
        },
        recordUnavailableAttempt: async () => {
          throw new Error('complete outcomes must not consume retry budget');
        },
        markAttemptResolved: async (_eventId, window) => {
          resolved.push(window);
        },
      },
    );

    expect(result).toEqual({ saved: 3, skipped: 0, deferred: 0 });
    expect(saved).toEqual([24, 72, 168]);
    expect(resolved).toEqual([24, 72, 168]);
  });

  it('skips a window already saved for the immutable publication event id', async () => {
    const checked: Array<[string, number]> = [];
    const saved: number[] = [];

    const result = await collectOutcomeWindows(
      userPublication,
      [...OUTCOME_WINDOWS],
      {
        hasOutcome: async (eventId, window) => {
          checked.push([eventId, window]);
          return window === 72;
        },
        fetchSignals: async () => ({
          sourceStatus: 'complete',
          values: { reach: 60 },
        }),
        saveOutcome: async (_event, window) => {
          saved.push(window);
        },
        recordUnavailableAttempt: async () => {
          throw new Error('complete outcomes must not consume retry budget');
        },
        markAttemptResolved: async () => undefined,
      },
    );

    expect(checked).toEqual([
      ['publication_1', 24],
      ['publication_1', 72],
      ['publication_1', 168],
    ]);
    expect(saved).toEqual([24, 168]);
    expect(result).toEqual({ saved: 2, skipped: 1, deferred: 0 });
  });

  it('defers an unavailable source instead of freezing the first failed measurement', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const attempts: number[] = [];

    const result = await collectOutcomeWindows(userPublication, [24], {
      hasOutcome: async () => false,
      fetchSignals: async () => ({
        sourceStatus: 'unavailable',
        values: {},
        rawSignals: { facts: { status: 'unavailable' } },
      }),
      saveOutcome: async (_event, _window, outcome) => {
        writes.push(outcome);
      },
      recordUnavailableAttempt: async (_event, window) => {
        attempts.push(window);
        return { attempt: 1, finalize: false, nextRetryAt: '2026-07-02T06:00:00.000Z' };
      },
      markAttemptResolved: async () => undefined,
    });

    expect(result).toEqual({ saved: 0, skipped: 0, deferred: 1 });
    expect(attempts).toEqual([24]);
    expect(writes).toEqual([]);
  });

  it('persists an unavailable source only after the bounded retry budget is exhausted', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const resolved: number[] = [];

    const result = await collectOutcomeWindows(userPublication, [24], {
      hasOutcome: async () => false,
      fetchSignals: async () => ({
        sourceStatus: 'unavailable',
        values: {},
        rawSignals: { facts: { status: 'unavailable' } },
      }),
      saveOutcome: async (_event, _window, outcome) => {
        writes.push(outcome);
      },
      recordUnavailableAttempt: async () => ({
        attempt: 4,
        finalize: true,
        nextRetryAt: null,
      }),
      markAttemptResolved: async (_eventId, window) => {
        resolved.push(window);
      },
    });

    expect(result).toEqual({ saved: 1, skipped: 0, deferred: 0 });
    expect(writes[0]).toMatchObject({
      sourceStatus: 'unavailable',
      score: null,
      completeness: 'none',
    });
    expect(writes[0].score).not.toBe(0);
    expect(resolved).toEqual([24]);
  });

  it('turns a source exception into unavailable rather than a zero outcome', async () => {
    const writes: Array<Record<string, unknown>> = [];

    await collectOutcomeWindows(userPublication, [24], {
      hasOutcome: async () => false,
      fetchSignals: async () => {
        throw new Error('Facebook unavailable');
      },
      saveOutcome: async (_event, _window, outcome) => {
        writes.push(outcome);
      },
      recordUnavailableAttempt: async () => ({
        attempt: 4,
        finalize: true,
        nextRetryAt: null,
      }),
      markAttemptResolved: async () => undefined,
    });

    expect(writes[0]).toMatchObject({
      sourceStatus: 'unavailable',
      score: null,
      completeness: 'none',
    });
  });

  it('writes immutable rows with conflict-do-nothing semantics', async () => {
    const { db, calls } = makeRecordingD1();

    await saveLearningOutcome(db, userPublication, 24, {
      sourceStatus: 'partial',
      score: 60,
      completeness: 'engagement',
      values: { reach: 60 },
      rawSignals: { reach: 123 },
    }, '2026-07-02T00:00:00.000Z');

    expect(calls[0].sql).toContain(
      'ON CONFLICT(publication_event_id,window_hours) DO NOTHING',
    );
    expect(calls[0].sql).not.toMatch(/DO UPDATE/i);
    expect(calls[0].binds).toEqual(expect.arrayContaining([
      'publication_1',
      24,
      60,
      'engagement',
      'partial',
      '2026-07-02T00:00:00.000Z',
    ]));
  });

  it('backs off unavailable metric retries and finalizes only on attempt four', async () => {
    const first = makeRecordingD1();
    const firstDecision = await recordUnavailableOutcomeAttempt(
      first.db,
      userPublication,
      24,
      '2026-07-02T00:00:00.000Z',
    );

    expect(OUTCOME_MAX_ATTEMPTS).toBe(4);
    expect(firstDecision).toEqual({
      attempt: 1,
      finalize: false,
      nextRetryAt: '2026-07-02T06:00:00.000Z',
    });
    expect(first.calls[0].binds).toEqual(['publication_1', 24]);
    expect(first.calls[1].sql).toContain(
      'ON CONFLICT(publication_event_id,window_hours) DO UPDATE',
    );
    expect(first.calls[1].binds).toEqual(expect.arrayContaining([
      'publication_1',
      24,
      1,
      '2026-07-02T06:00:00.000Z',
    ]));

    const final = makeRecordingD1({
      'FROM learning_outcome_attempts': [{ attempt_count: 3, resolved_at: null }],
    });
    const finalDecision = await recordUnavailableOutcomeAttempt(
      final.db,
      userPublication,
      168,
      '2026-07-08T00:00:00.000Z',
    );
    expect(finalDecision).toEqual({ attempt: 4, finalize: true, nextRetryAt: null });
  });
});

describe('due-window repository and tenant signal collection', () => {
  it('selects only due publication windows that do not already have an outcome', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM publication_events pe': [{
        id: userPublication.id,
        user_id: userPublication.userId,
        workspace_key: userPublication.workspaceKey,
        client_id: userPublication.clientId,
        owner_kind: userPublication.ownerKind,
        owner_id: userPublication.ownerId,
        post_id: userPublication.postId,
        platform: userPublication.platform,
        remote_post_id: userPublication.remotePostId,
        permalink: userPublication.permalink,
        decision_id: userPublication.decisionId,
        reach_plan_id: userPublication.reachPlanId,
        published_at: userPublication.publishedAt,
        window_hours: 24,
      }],
    });

    const due = await listDueOutcomeWindows(
      db,
      '2026-07-02T00:00:00.000Z',
      50,
    );

    expect(due).toEqual([{ event: userPublication, windows: [24] }]);
    expect(calls[0].sql).toContain('(VALUES (24), (72), (168))');
    expect(calls[0].sql).toContain('NOT EXISTS');
    expect(calls[0].sql).toContain('FROM learning_outcomes lo');
    expect(calls[0].sql).toContain('learning_outcome_attempts');
    expect(calls[0].sql).toContain('next_retry_at');
    expect(calls[0].sql).toContain("'on_hold'");
    expect(calls[0].sql).toContain("'+' || w.window_hours || ' hours'");
    expect(calls[0].binds).toEqual([
      '2026-07-02T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      50,
    ]);
  });

  it('scopes user facts, tracking, and conversion reads to one canonical tenant', async () => {
    const { db, calls } = makeRecordingD1();

    const signals = await fetchOutcomeSignals(db, userPublication, 24);

    expect(signals).toMatchObject({
      sourceStatus: 'unavailable',
      values: {},
    });
    const factCalls = calls.filter((call) =>
      call.sql.includes('platform_metric_snapshots'));
    expect(factCalls.length).toBeGreaterThanOrEqual(2);
    expect(factCalls.every((call) =>
      call.sql.includes('user_id = ?')
      && call.sql.includes('workspace_key = ?')
      && call.sql.includes('client_id IS ?')
      && call.sql.includes('owner_kind = ?')
      && call.sql.includes('owner_id = ?')
      && call.binds.includes('user_1')
      && call.binds.includes('__owner__')
      && call.binds.includes(null))).toBe(true);
    expect(calls.some((call) => call.sql.includes('FROM client_facts'))).toBe(false);

    for (const table of ['tracking_links', 'conversion_feedback']) {
      const scoped = calls.filter((call) => call.sql.includes(`FROM ${table}`));
      expect(scoped.length).toBeGreaterThanOrEqual(2);
      expect(scoped.every((call) =>
        call.sql.includes('user_id = ?')
        && call.sql.includes('workspace_key = ?')
        && call.sql.includes('owner_kind = ?')
        && call.sql.includes('owner_id = ?')
        && call.binds.includes('user_1')
        && call.binds.includes('__owner__')
        && call.binds.includes('user'))).toBe(true);
    }

    const currentTracking = calls.find((call) =>
      call.sql.includes('FROM tracking_links') && call.sql.includes('post_id = ?'));
    const currentConversion = calls.find((call) =>
      call.sql.includes('FROM conversion_feedback') && call.sql.includes('post_id = ?'));
    expect(currentTracking?.binds).toContain('post_1');
    expect(currentConversion?.binds).toContain('post_1');
  });

  it('uses tenant-scoped metric snapshots for a Shopify publication', async () => {
    const { db, calls } = makeRecordingD1();

    await fetchOutcomeSignals(db, shopPublication, 24);

    const shopFacts = calls.filter((call) =>
      call.sql.includes('platform_metric_snapshots'));
    expect(shopFacts.length).toBeGreaterThanOrEqual(2);
    expect(shopFacts.every((call) =>
      call.sql.includes('workspace_key = ?')
      && call.sql.includes('owner_kind = ?')
      && call.sql.includes('owner_id = ?')
      && call.binds.includes('store.myshopify.com')
      && call.binds.includes('shop:store.myshopify.com')
      && call.binds.includes('shop'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('FROM client_facts'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('FROM shopify_facts'))).toBe(false);

    for (const table of ['tracking_links', 'conversion_feedback']) {
      const scoped = calls.filter((call) => call.sql.includes(`FROM ${table}`));
      expect(scoped.every((call) =>
        call.binds.includes('store.myshopify.com')
        && call.binds.includes('shop:store.myshopify.com')
        && call.binds.includes('shop'))).toBe(true);
    }
  });
});

describe('learning outcome cron', () => {
  it('runs through the isolated six-hour dispatcher lane', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/cron/dispatcher.ts'),
      'utf8',
    );

    expect(source).toContain("import { cronCollectLearningOutcomes } from './collect-learning-outcomes'");
    expect(source).toContain("trackCron(env, 'learning_outcomes', () => cronCollectLearningOutcomes(env))");
  });

  it('reconciles published rows missing events without invoking remote publishing', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts p': [{
        id: 'posted_1',
        user_id: 'user_1',
        client_id: null,
        owner_kind: 'user',
        owner_id: 'user_1',
        platform: 'Facebook',
        remote_post_id: 'fb_posted_1',
        permalink: 'https://facebook.example/post/fb_posted_1',
        decision_id: null,
        reach_plan_id: null,
        published_at: '2026-07-01T00:00:00.000Z',
      }],
    });
    const remoteFetch = vi.spyOn(globalThis, 'fetch');

    const result = await cronCollectLearningOutcomes(
      { DB: db } as Env,
      { now: '2026-07-01T01:00:00.000Z' },
    );

    expect(result).toEqual({
      posts_processed: 0,
      reconciled: 1,
      dueEvents: 0,
      saved: 0,
      skipped: 0,
      deferred: 0,
    });
    expect(remoteFetch).not.toHaveBeenCalled();
    const reconciliationRead = calls.find((call) => call.sql.includes('FROM posts p'));
    expect(reconciliationRead?.sql).toContain("p.status IN ('Published', 'Posted')");
    expect(reconciliationRead?.sql).toContain('NOT EXISTS');
    expect(reconciliationRead?.sql).toContain('publication_events');
    expect(reconciliationRead?.sql).toContain("COALESCE(c.status, 'active') != 'on_hold'");
    expect(reconciliationRead?.sql).toMatch(/d\.workspace_key\s*=/);
    expect(reconciliationRead?.sql).toMatch(/d\.owner_kind\s*=/);
    expect(reconciliationRead?.sql).toMatch(/d\.owner_id\s*=/);
    expect(reconciliationRead?.sql).toMatch(/rp\.workspace_key\s*=/);
    expect(reconciliationRead?.sql).toMatch(/rp\.owner_kind\s*=/);
    expect(reconciliationRead?.sql).toMatch(/rp\.owner_id\s*=/);

    const publicationWrite = calls.find((call) =>
      call.sql.includes('INSERT INTO publication_events'));
    expect(publicationWrite?.binds).toEqual(expect.arrayContaining([
      'user_1',
      '__owner__',
      'posted_1',
      'facebook',
      'fb_posted_1',
    ]));
  });
});
