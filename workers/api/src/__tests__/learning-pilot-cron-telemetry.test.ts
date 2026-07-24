import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  buildCronDetails,
  shouldRunLearningCalibration,
  shouldRunRecordOnlyPilot,
  trackCron,
} from '../cron/dispatcher';
import { registerHealthRoutes } from '../routes/health';
import { makeRecordingD1 } from './helpers/recording-d1';

const pilotResult = {
  posts_processed: 0,
  candidates_considered: 3,
  evaluated: 0,
  reused: 0,
  claimed_elsewhere: 0,
  budget_skipped: 1,
  context_not_ready: 2,
  invalid_skipped: 0,
  errors: 0,
  caption: 'must never enter telemetry',
};

const calibrationResult = {
  posts_processed: 2,
  candidates_considered: 2,
  completed: 2,
  unavailable: 0,
  claimed_elsewhere: 0,
  budget_skipped: 0,
  severe_false_passes: 0,
  workspaces_disabled: 1,
  errors: 0,
  caption: 'must never enter telemetry',
};

const calibrationTrigger = {
  cronExpression: '0 21 * * SUN',
  scheduledTime: Date.parse('2026-07-19T21:00:00.000Z'),
};

describe('learning pilot cron telemetry', () => {
  it('serializes only allowlisted non-negative integer counters', () => {
    expect(JSON.parse(buildCronDetails('learning_pilot', pilotResult)!)).toEqual({
      posts_processed: 0,
      candidates_considered: 3,
      evaluated: 0,
      reused: 0,
      claimed_elsewhere: 0,
      budget_skipped: 1,
      context_not_ready: 2,
      invalid_skipped: 0,
      errors: 0,
    });
    expect(buildCronDetails('publish', pilotResult)).toBeNull();
    expect(JSON.parse(buildCronDetails('learning_readiness', {
      posts_processed: 30,
      workspaces_disabled: 2,
      decision_disqualifications_schema_ready: 1,
      ai_usage_attribution_schema_ready: 1,
      pilot_samples_schema_ready: 1,
      calibration_audits_schema_ready: 1,
    })!)).toEqual({
      workspaces_disabled: 2,
      decision_disqualifications_schema_ready: 1,
      ai_usage_attribution_schema_ready: 1,
      pilot_samples_schema_ready: 1,
      calibration_audits_schema_ready: 1,
    });
    expect(JSON.parse(buildCronDetails(
      'learning_calibration',
      calibrationResult,
      calibrationTrigger,
    )!)).toEqual({
      posts_processed: 2,
      candidates_considered: 2,
      completed: 2,
      unavailable: 0,
      claimed_elsewhere: 0,
      budget_skipped: 0,
      severe_false_passes: 0,
      workspaces_disabled: 1,
      errors: 0,
      cron_expression: '0 21 * * SUN',
      scheduled_for: '2026-07-19T21:00:00.000Z',
    });
  });

  it.each([
    ['learning_pilot', { ...pilotResult, errors: undefined }],
    ['learning_readiness', {
      posts_processed: 0,
      workspaces_disabled: 0,
      decision_disqualifications_schema_ready: 1,
      ai_usage_attribution_schema_ready: 1,
      pilot_samples_schema_ready: 1,
    }],
    ['learning_calibration', { ...calibrationResult, errors: -1 }],
    ['learning_calibration', { ...calibrationResult, completed: 0.5 }],
  ])('fails closed when %s emits an invalid or missing counter', (cronType, result) => {
    expect(() => buildCronDetails(cronType, result)).toThrow(
      new RegExp(`^${cronType} returned invalid counter`),
    );
  });

  it('persists the quarantine count and deferred schema state for readiness runs', async () => {
    const { db, calls } = makeRecordingD1();

    await trackCron({ DB: db } as Env, 'learning_readiness', async () => ({
      posts_processed: 30,
      workspaces_disabled: 2,
      decision_disqualifications_schema_ready: 0,
      ai_usage_attribution_schema_ready: 0,
      pilot_samples_schema_ready: 0,
      calibration_audits_schema_ready: 0,
    }));

    const insert = calls.find((call) => call.sql.includes('INSERT INTO cron_runs'))!;
    expect(JSON.parse(String(insert.binds[5]))).toEqual({
      workspaces_disabled: 2,
      decision_disqualifications_schema_ready: 0,
      ai_usage_attribution_schema_ready: 0,
      pilot_samples_schema_ready: 0,
      calibration_audits_schema_ready: 0,
    });
  });

  it('restricts record-only pilot and calibration scheduling to staging', () => {
    const staging = {
      ENVIRONMENT: 'staging',
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const production = { ...staging, ENVIRONMENT: 'production' } as Env;

    expect(shouldRunRecordOnlyPilot(staging)).toBe(true);
    expect(shouldRunLearningCalibration(staging)).toBe(true);
    expect(shouldRunRecordOnlyPilot(production)).toBe(false);
    expect(shouldRunLearningCalibration(production)).toBe(false);
    expect(shouldRunRecordOnlyPilot({
      ...staging,
      LEARNING_RELEASE_ENFORCEMENT: 'true',
    } as Env)).toBe(false);
  });

  it('persists the sanitized details alongside the normal cron receipt', async () => {
    const { db, calls } = makeRecordingD1();

    await trackCron({ DB: db } as Env, 'learning_pilot', async () => pilotResult);

    const insert = calls.find((call) => call.sql.includes('INSERT INTO cron_runs'))!;
    expect(insert.sql).toContain('details_json');
    expect(insert.binds.slice(0, 4)).toEqual(['learning_pilot', 1, 0, null]);
    expect(insert.binds[4]).toEqual(expect.any(Number));
    expect(JSON.parse(String(insert.binds[5]))).toMatchObject({
      candidates_considered: 3,
      budget_skipped: 1,
      context_not_ready: 2,
    });
    expect(String(insert.binds[5])).not.toContain('caption');
  });

  it('records a failed receipt when learning calibration emits malformed counters', async () => {
    const { db, calls } = makeRecordingD1();

    await trackCron({ DB: db } as Env, 'learning_calibration', async () => ({
      ...calibrationResult,
      errors: Number.NaN,
    }));

    const insert = calls.find((call) => call.sql.includes('INSERT INTO cron_runs'))!;
    expect(insert.binds[0]).toBe('learning_calibration');
    expect(insert.binds[1]).toBe(0);
    expect(insert.binds[2]).toBe(0);
    expect(insert.binds[3]).toMatch(/invalid counter errors/);
    expect(insert.binds[5]).toBeNull();
  });

  it('fails a calibration receipt without scheduled trigger provenance', async () => {
    const { db, calls } = makeRecordingD1();

    await trackCron(
      { DB: db } as Env,
      'learning_calibration',
      async () => calibrationResult,
    );

    const insert = calls.find((call) => call.sql.includes('INSERT INTO cron_runs'))!;
    expect(insert.binds[0]).toBe('learning_calibration');
    expect(insert.binds[1]).toBe(0);
    expect(insert.binds[3]).toMatch(/missing valid scheduled trigger metadata/);
    expect(insert.binds[5]).toBeNull();
  });

  it('persists bounded calibration schedule provenance', async () => {
    const { db, calls } = makeRecordingD1();

    await trackCron(
      { DB: db } as Env,
      'learning_calibration',
      async () => calibrationResult,
      calibrationTrigger,
    );

    const insert = calls.find((call) => call.sql.includes('INSERT INTO cron_runs'))!;
    expect(insert.binds[1]).toBe(1);
    expect(JSON.parse(String(insert.binds[5]))).toMatchObject({
      cron_expression: '0 21 * * SUN',
      scheduled_for: '2026-07-19T21:00:00.000Z',
    });
    expect(String(insert.binds[5])).not.toContain('caption');
  });

  it('ships a one-time bounded JSON migration for existing cron receipts', () => {
    const sql = readFileSync(
      new URL('../../schema_v43_cron_run_details.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('ALTER TABLE cron_runs ADD COLUMN details_json TEXT');
    expect(sql).toContain('json_valid(details_json)');
    expect(sql).toContain('LENGTH(details_json) <= 2000');
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS');
  });

  it('exposes sanitized details through the PII-free cron health feed', async () => {
    const detailsJson = buildCronDetails('learning_pilot', pilotResult);
    const { db, calls } = makeRecordingD1({
      'FROM cron_runs': [{
        run_at: '2026-07-17 13:00:00',
        cron_type: 'learning_pilot',
        success: 1,
        posts_processed: 0,
        duration_ms: 15,
        error: '',
        details_json: detailsJson,
      }],
    });
    const env = { DB: db } as Env;
    const app = new Hono<{ Bindings: Env }>();
    registerHealthRoutes(app);

    const response = await app.request('/api/cron-health', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runs: [{
        cron_type: 'learning_pilot',
        details_json: detailsJson,
      }],
      last_success_at: '2026-07-17 13:00:00',
    });
    expect(calls[0].sql).toContain('details_json');
  });
});
