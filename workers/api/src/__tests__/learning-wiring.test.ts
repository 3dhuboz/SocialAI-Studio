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
});
