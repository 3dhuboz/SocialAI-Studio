import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('learning shadow wiring', () => {
  it('registers the authenticated learning route', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

    expect(source).toContain("import { registerLearningRoutes } from './routes/learning';");
    expect(source).toContain('registerLearningRoutes(app);');
  });

  it('runs shadow evaluation after prewarm and before publishing', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/cron/dispatcher.ts'), 'utf8');
    const prewarmIndex = source.indexOf("trackCron(env, 'prewarm_videos'");
    const disabledGuardIndex = source.indexOf("if (env.LEARNING_BRAIN_ENABLED === 'true')");
    const shadowIndex = source.indexOf("trackCron(env, 'learning_shadow'");
    const publishIndex = source.indexOf("trackCron(env, 'publish'");

    expect(source).toContain("import { cronEvaluateLearningShadow } from './evaluate-learning-shadow';");
    expect(prewarmIndex).toBeGreaterThan(-1);
    expect(disabledGuardIndex).toBeGreaterThan(prewarmIndex);
    expect(shadowIndex).toBeGreaterThan(disabledGuardIndex);
    expect(shadowIndex).toBeGreaterThan(prewarmIndex);
    expect(publishIndex).toBeGreaterThan(shadowIndex);
  });

  it('runs readiness in the isolated 15-minute lane and defaults autopilot off', () => {
    const dispatcher = readFileSync(resolve(process.cwd(), 'src/cron/dispatcher.ts'), 'utf8');
    const wrangler = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8');
    const env = readFileSync(resolve(process.cwd(), 'src/env.ts'), 'utf8');

    expect(dispatcher).toContain(
      "import { cronEvaluateLearningReadiness } from './evaluate-learning-readiness';",
    );
    const lane = dispatcher.indexOf("if (cron === '*/15 * * * *')");
    const readiness = dispatcher.indexOf("trackCron(env, 'learning_readiness'");
    expect(readiness).toBeGreaterThan(lane);
    expect(env).toContain('LEARNING_AUTOPILOT_ENABLED?: string;');
    expect(wrangler.match(/LEARNING_AUTOPILOT_ENABLED\s*=\s*"false"/g)).toHaveLength(2);
  });

  it('runs the bounded record-only collector only on the dormant 15-minute lane', () => {
    const dispatcher = readFileSync(resolve(process.cwd(), 'src/cron/dispatcher.ts'), 'utf8');
    const lane = dispatcher.indexOf("if (cron === '*/15 * * * *')");
    const importIndex = dispatcher.indexOf(
      "import { cronEvaluateLearningPilot } from './evaluate-learning-pilot';",
    );
    const enforcementGuard = dispatcher.indexOf(
      "env.LEARNING_RELEASE_ENFORCEMENT !== 'true'",
      lane,
    );
    const autopilotGuard = dispatcher.indexOf(
      "env.LEARNING_AUTOPILOT_ENABLED !== 'true'",
      lane,
    );
    const collector = dispatcher.indexOf("trackCron(env, 'learning_pilot'", lane);
    const readiness = dispatcher.indexOf("trackCron(env, 'learning_readiness'", lane);

    expect(importIndex).toBeGreaterThan(-1);
    expect(enforcementGuard).toBeGreaterThan(lane);
    expect(autopilotGuard).toBeGreaterThan(enforcementGuard);
    expect(collector).toBeGreaterThan(autopilotGuard);
    expect(readiness).toBeGreaterThan(collector);
  });

  it('gives staging only record-only learning schedules', () => {
    const dispatcher = readFileSync(resolve(process.cwd(), 'src/cron/dispatcher.ts'), 'utf8');
    const wrangler = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8');
    const staging = wrangler.slice(wrangler.indexOf('[env.staging]'));
    const triggerStart = staging.indexOf('[env.staging.triggers]');
    const stagingTriggers = staging.slice(
      triggerStart,
      staging.indexOf('[[env.staging.r2_buckets]]', triggerStart),
    );
    const fifteenMinuteLane = dispatcher.slice(
      dispatcher.indexOf("if (cron === '*/15 * * * *')"),
      dispatcher.indexOf("if (cron === '0 21 * * SUN')"),
    );
    const weeklyLane = dispatcher.slice(
      dispatcher.indexOf("if (cron === '0 21 * * SUN')"),
      dispatcher.indexOf('// Unknown cron expression'),
    );

    expect(stagingTriggers).toContain(
      'crons = ["*/15 * * * *", "0 21 * * SUN"]',
    );
    expect(dispatcher).toContain("const recordOnlyStaging = env.ENVIRONMENT === 'staging';");
    expect(fifteenMinuteLane).toContain("trackCron(env, 'health_sweep'");
    expect(fifteenMinuteLane).toContain("trackCron(env, 'learning_pilot'");
    expect(fifteenMinuteLane).toContain("trackCron(env, 'learning_readiness'");
    expect(fifteenMinuteLane).toMatch(
      /if \(!recordOnlyStaging\) \{\s+await trackCron\(env, 'shopify_reconcile'/,
    );
    expect(weeklyLane).toMatch(
      /trackCron\(\s+env,\s+'learning_calibration',[\s\S]+cronExpression: cron,\s+scheduledTime: event\.scheduledTime/,
    );
    expect(weeklyLane).toMatch(
      /if \(!recordOnlyStaging\) \{\s+await trackCron\(env, 'learn_strategies'/,
    );
    expect(weeklyLane).toMatch(
      /if \(!recordOnlyStaging\) \{\s+await trackCron\(env, 'weekly_review'/,
    );
  });
});
