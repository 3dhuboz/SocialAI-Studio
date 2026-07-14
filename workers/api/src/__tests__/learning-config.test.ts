import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('learning release configuration', () => {
  it('enables shadow learning but keeps enforcement disabled in production and staging', () => {
    const config = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8');

    expect(config.match(/LEARNING_BRAIN_ENABLED\s*=\s*"true"/g)).toHaveLength(2);
    expect(config.match(/LEARNING_RELEASE_ENFORCEMENT\s*=\s*"false"/g)).toHaveLength(2);
    expect(config).not.toMatch(/LEARNING_RELEASE_ENFORCEMENT\s*=\s*"true"/);
    expect(config.match(/ORGANIC_REACH_ENABLED\s*=\s*"true"/g)).toHaveLength(2);
    expect(config.match(/ORGANIC_REACH_APPLY_ENABLED\s*=\s*"false"/g)).toHaveLength(2);
    expect(config).not.toMatch(/ORGANIC_REACH_APPLY_ENABLED\s*=\s*"true"/);
  });

  it('documents shadow-only operation and the disabled enforcement kill switch', () => {
    const map = readFileSync(resolve(process.cwd(), '../../AGENTS.md'), 'utf8');

    expect(map).toContain('schema_v37_learning_foundation.sql');
    expect(map).toContain('routes/learning.ts');
    expect(map).toContain('cron/evaluate-learning-shadow.ts');
    expect(map).toContain('lib/learning/');
    expect(map).toContain('lib/reach/timing-evidence.ts');
    expect(map).toMatch(/shadow/i);
    expect(map).toMatch(/enforcement remains disabled/i);
  });
});
