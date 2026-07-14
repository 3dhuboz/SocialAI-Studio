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
});
