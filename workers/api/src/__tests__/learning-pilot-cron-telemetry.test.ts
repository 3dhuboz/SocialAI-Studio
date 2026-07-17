import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { buildCronDetails, trackCron } from '../cron/dispatcher';
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
    expect(JSON.parse(buildCronDetails('learning_pilot', {
      posts_processed: -1,
      context_not_ready: Number.POSITIVE_INFINITY,
    })!)).toMatchObject({
      posts_processed: 0,
      context_not_ready: 0,
    });
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
