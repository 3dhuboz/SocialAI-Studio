import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { cronLearnStrategies } from '../cron/learn-strategies';
import {
  decayEffect,
  nextSignal,
  type LearningSignal,
} from '../lib/learning/strategy-learning';
import {
  assertSingleExperimentChange,
  selectExperimentCandidate,
  shouldExplore,
} from '../lib/learning/experiment-policy';
import { makeRecordingD1 } from './helpers/recording-d1';

const now = new Date('2026-07-14T00:00:00.000Z');

function makeSignal(patch: Partial<LearningSignal> = {}): LearningSignal {
  return {
    variableKey: 'posting_hour',
    variableValue: '18',
    objective: 'local_order',
    sampleCount: 0,
    effect: 0,
    confidence: 0,
    freshnessAt: now.toISOString(),
    status: 'tentative',
    ...patch,
  };
}

describe('confidence-weighted strategy learning', () => {
  it.each([
    { total: 4, expected: 'tentative' },
    { total: 5, expected: 'usable' },
    { total: 9, expected: 'usable' },
    { total: 10, expected: 'proven' },
  ] as const)('classifies $total cumulative outcomes as $expected', ({ total, expected }) => {
    const updated = nextSignal(makeSignal(), { effect: 0.3, sampleCount: total }, now);

    expect(updated.status).toBe(expected);
  });

  it('uses cumulative sample counts for status and confidence', () => {
    const updated = nextSignal(
      makeSignal({ sampleCount: 4, confidence: 0.4 }),
      { effect: 0.3, sampleCount: 6 },
      now,
    );

    expect(updated.sampleCount).toBe(10);
    expect(updated.status).toBe('proven');
    expect(updated.confidence).toBe(1);
  });

  it('caps upward and downward weekly changes at 0.10 after decay', () => {
    const stale = makeSignal({
      effect: 0.8,
      freshnessAt: '2026-04-15T00:00:00.000Z',
    });

    expect(nextSignal(stale, { effect: 1, sampleCount: 5 }, now).effect).toBeCloseTo(0.5);
    expect(nextSignal(stale, { effect: -1, sampleCount: 5 }, now).effect).toBeCloseTo(0.3);
  });

  it('uses a 90-day half-life without amplifying future-dated evidence', () => {
    expect(decayEffect(0.8, 90)).toBeCloseTo(0.4);
    expect(decayEffect(-0.8, 180)).toBeCloseTo(-0.2);
    expect(decayEffect(0.8, -30)).toBe(0.8);
  });

  it('fails safe for invalid decay numbers', () => {
    expect(decayEffect(Number.NaN, 90)).toBe(0);
    expect(decayEffect(0.8, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it.each([
    ['invalid freshness date', makeSignal({ freshnessAt: 'not-a-date' }), { effect: 0.5, sampleCount: 5 }, now],
    ['invalid current effect', makeSignal({ effect: Number.NaN }), { effect: 0.5, sampleCount: 5 }, now],
    ['invalid current sample count', makeSignal({ sampleCount: -1 }), { effect: 0.5, sampleCount: 5 }, now],
    ['invalid evidence effect', makeSignal(), { effect: Number.POSITIVE_INFINITY, sampleCount: 5 }, now],
    ['invalid evidence sample count', makeSignal(), { effect: 0.5, sampleCount: 1.5 }, now],
    ['invalid current time', makeSignal(), { effect: 0.5, sampleCount: 5 }, new Date(Number.NaN)],
  ] as const)('leaves the signal unchanged for %s', (_label, signal, evidence, at) => {
    expect(nextSignal(signal, evidence, at)).toEqual(signal);
  });

  it('never mutates an operator-locked signal', () => {
    const locked = makeSignal({ status: 'operator_locked', effect: 0.8, sampleCount: 12 });

    const updated = nextSignal(
      locked,
      { effect: -1, sampleCount: 100 },
      new Date('2026-10-12T00:00:00.000Z'),
    );

    expect(updated).toBe(locked);
    expect(updated).toEqual(locked);
  });
});

describe('safe experiment policy', () => {
  it('selects exploration deterministically at approximately 15 percent', () => {
    const first = Array.from({ length: 10_000 }, (_, index) =>
      shouldExplore(`post-${index}`, 3, 0.15));
    const second = Array.from({ length: 10_000 }, (_, index) =>
      shouldExplore(`post-${index}`, 3, 0.15));
    const selected = first.filter(Boolean).length;

    expect(second).toEqual(first);
    expect(selected).toBeGreaterThan(1_300);
    expect(selected).toBeLessThan(1_700);
  });

  it('clamps exploration to the inclusive 0 to 20 percent range', () => {
    const ids = Array.from({ length: 10_000 }, (_, index) => `bounded-${index}`);

    expect(ids.some((id) => shouldExplore(id, 3, -1))).toBe(false);
    expect(ids.map((id) => shouldExplore(id, 3, 1)))
      .toEqual(ids.map((id) => shouldExplore(id, 3, 0.20)));
  });

  it('fails closed for invalid exploration inputs', () => {
    expect(shouldExplore('post-1', Number.NaN, 0.15)).toBe(false);
    expect(shouldExplore('post-1', 3, Number.NaN)).toBe(false);
    expect(shouldExplore('', 3, 0.15)).toBe(false);
  });

  it('accepts exactly one eligible variable change', () => {
    expect(assertSingleExperimentChange(
      { posting_hour: 17, format: 'image' },
      { posting_hour: 18, format: 'image' },
    )).toBe('posting_hour');
  });

  it('rejects zero or multiple variable changes', () => {
    expect(() => assertSingleExperimentChange(
      { posting_hour: 17, format: 'image' },
      { posting_hour: 17, format: 'image' },
    )).toThrow(/exactly one/i);
    expect(() => assertSingleExperimentChange(
      { posting_hour: 17, format: 'image' },
      { posting_hour: 18, format: 'video' },
    )).toThrow(/exactly one/i);
  });

  it.each([
    'price',
    'factualClaims',
    'denylist_rules',
    'geography-exclusions',
    'excluded_locations',
    'serviceArea',
    'critic.thresholds',
    'releasePolicy',
    'autopilotPolicy',
    'arbitrary_database_field',
  ])('rejects changes to banned variable %s', (variable) => {
    expect(() => assertSingleExperimentChange(
      { [variable]: 'control', posting_hour: 17 },
      { [variable]: 'test', posting_hour: 17 },
    )).toThrow(/not eligible/i);
  });

  it('rejects non-finite numeric experiment values', () => {
    expect(() => assertSingleExperimentChange(
      { posting_hour: 17 },
      { posting_hour: Number.NaN },
    )).toThrow(/finite/i);
  });

  it.each([
    'posting_hour',
    'posting_window',
    'weekday',
    'caption_opening',
    'caption_length',
    'cta_style',
    'hashtag_set',
    'media_format',
    'media_style',
    'audience_segment',
    'offer_framing',
  ])('allows the explicitly approved experiment variable %s', (variable) => {
    expect(assertSingleExperimentChange(
      { [variable]: 'control' },
      { [variable]: 'test' },
    )).toBe(variable);
  });

  it('explores the least-tested safe candidate and exploits the best predicted effect', () => {
    const candidates = [
      {
        control: { posting_hour: 17 },
        test: { posting_hour: 18 },
        sampleCount: 8,
        predictedEffect: 0.6,
      },
      {
        control: { media_format: 'image' },
        test: { media_format: 'video' },
        sampleCount: 2,
        predictedEffect: 0.2,
      },
    ];
    const exploringPost = Array.from({ length: 1_000 }, (_, index) => `explore-${index}`)
      .find((postId) => shouldExplore(postId, 3, 0.15));
    const exploitingPost = Array.from({ length: 1_000 }, (_, index) => `exploit-${index}`)
      .find((postId) => !shouldExplore(postId, 3, 0.15));

    expect(exploringPost).toBeTruthy();
    expect(exploitingPost).toBeTruthy();
    expect(selectExperimentCandidate(exploringPost!, 3, 0.15, candidates)).toMatchObject({
      mode: 'explore',
      variableKey: 'media_format',
    });
    expect(selectExperimentCandidate(exploitingPost!, 3, 0.15, candidates)).toMatchObject({
      mode: 'exploit',
      variableKey: 'posting_hour',
    });
  });

  it('drops unsafe experiment candidates instead of persisting them', () => {
    expect(selectExperimentCandidate('post-1', 3, 1, [{
      control: { price: 20 },
      test: { price: 10 },
      sampleCount: 0,
      predictedEffect: 1,
    }])).toBeNull();
  });

  it('fails closed instead of exploiting when experiment identity is invalid', () => {
    const candidates = [{
      control: { posting_hour: 17 },
      test: { posting_hour: 18 },
      sampleCount: 0,
      predictedEffect: 0.4,
    }];

    expect(selectExperimentCandidate('', 3, 0.15, candidates)).toBeNull();
    expect(selectExperimentCandidate('post-1', 0, 0.15, candidates)).toBeNull();
    expect(selectExperimentCandidate('post-1', 3, Number.NaN, candidates)).toBeNull();
  });
});

const candidateOutcome = {
  outcome_id: 'outcome-168',
  publication_event_id: 'publication-1',
  user_id: 'user-1',
  workspace_key: 'client-1',
  client_id: 'client-1',
  owner_kind: 'client',
  owner_id: 'client-1',
  post_id: 'post-1',
  platform: 'facebook',
  post_type: 'image',
  objective: 'local_order',
  timezone: 'Australia/Brisbane',
  normalized_score: 80,
  completeness: 'conversion',
  source_status: 'complete',
  published_at: '2026-07-07T08:00:00.000Z',
  measured_at: '2026-07-14T08:00:00.000Z',
};

describe('weekly strategy learner', () => {
  it('learns only canonical final-window outcomes and writes a private versioned profile', async () => {
    const profileSignals = [
      {
        variable_key: 'posting_hour', variable_value: '18', objective: 'local_order',
        sample_count: 5, effect: 0.1, confidence: 0.5, freshness_at: now.toISOString(), status: 'usable',
      },
      {
        variable_key: 'media_format', variable_value: 'image', objective: 'local_order',
        sample_count: 10, effect: 0.3, confidence: 1, freshness_at: now.toISOString(), status: 'proven',
      },
    ];
    const { db, calls } = makeRecordingD1({
      'FROM learning_outcomes lo': [candidateOutcome],
      'status IN (\'usable\',\'proven\',\'operator_locked\')': profileSignals,
      'MAX(version)': [{ version: 2 }],
    });

    const result = await cronLearnStrategies(
      { DB: db } as Env,
      { now: now.toISOString(), limit: 20 },
    );

    expect(result).toMatchObject({
      posts_processed: 1,
      outcomes_processed: 1,
      signals_updated: 3,
      profiles_created: 1,
      skipped: 0,
    });
    const candidateRead = calls.find((call) => call.sql.includes('FROM learning_outcomes lo'))!;
    expect(candidateRead.sql).toContain('lo.window_hours = 168');
    expect(candidateRead.sql).toContain("lo.source_status != 'unavailable'");
    expect(candidateRead.sql).toContain("'on_hold'");
    expect(candidateRead.sql).toContain('p.owner_kind = pe.owner_kind');
    expect(candidateRead.sql).toContain('p.owner_id = pe.owner_id');

    const signalWrites = calls.filter((call) => call.sql.includes('INSERT INTO learning_signals'));
    expect(signalWrites).toHaveLength(3);
    expect(signalWrites.every((call) => call.binds.includes('user-1'))).toBe(true);
    expect(signalWrites.every((call) => call.binds.includes('client-1'))).toBe(true);
    expect(signalWrites.some((call) =>
      call.binds.includes('posting_hour') && call.binds.includes('18'))).toBe(true);

    const profileWrite = calls.find((call) => call.sql.includes('INSERT INTO learning_profiles'))!;
    expect(profileWrite.binds).toContain(3);
    expect(profileWrite.binds).toContain(0);
    expect(JSON.parse(String(profileWrite.binds.find((value) =>
      typeof value === 'string' && value.includes('posting_hour'))))).toMatchObject({
      version: 3,
      approved: false,
    });
  });

  it('rejects an inconsistent tenant identity without writing a signal or profile', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_outcomes lo': [{ ...candidateOutcome, workspace_key: '__owner__' }],
    });

    const result = await cronLearnStrategies(
      { DB: db } as Env,
      { now: now.toISOString() },
    );

    expect(result).toMatchObject({ outcomes_processed: 0, signals_updated: 0, profiles_created: 0, skipped: 1 });
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_signals'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_profiles'))).toBe(false);
  });

  it('does not count the same immutable outcome twice', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_outcomes lo': [candidateOutcome],
      'variable_key = ? AND variable_value = ?': [{
        id: 'signal-1', variable_key: 'posting_hour', variable_value: '8', objective: 'local_order',
        sample_count: 5, effect: 0.1, confidence: 0.5, freshness_at: now.toISOString(),
        status: 'usable', supporting_outcomes_json: '["outcome-168"]',
      }],
    });

    const result = await cronLearnStrategies(
      { DB: db } as Env,
      { now: now.toISOString() },
    );

    expect(result.signals_updated).toBe(0);
    expect(result.profiles_created).toBe(0);
    expect(calls.some((call) => call.sql.includes('UPDATE learning_signals'))).toBe(false);
  });

  it('runs before weekly review in an isolated telemetry wrapper', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/cron/dispatcher.ts'), 'utf8');
    const learning = source.indexOf("trackCron(env, 'learn_strategies'");
    const review = source.indexOf("trackCron(env, 'weekly_review'");

    expect(source).toContain("import { cronLearnStrategies } from './learn-strategies'");
    expect(learning).toBeGreaterThan(0);
    expect(review).toBeGreaterThan(learning);
  });
});
