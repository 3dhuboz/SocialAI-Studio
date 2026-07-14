import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('learning release configuration', () => {
  it('keeps both learning switches disabled in production and staging', () => {
    const config = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8');

    expect(config.match(/LEARNING_BRAIN_ENABLED\s*=\s*"false"/g)).toHaveLength(2);
    expect(config.match(/LEARNING_RELEASE_ENFORCEMENT\s*=\s*"false"/g)).toHaveLength(2);
    expect(config).not.toMatch(/LEARNING_(?:BRAIN_ENABLED|RELEASE_ENFORCEMENT)\s*=\s*"true"/);
  });

  it('documents the read-only, off-by-default foundation', () => {
    const map = readFileSync(resolve(process.cwd(), '../../AGENTS.md'), 'utf8');

    expect(map).toContain('schema_v37_learning_foundation.sql');
    expect(map).toContain('routes/learning.ts');
    expect(map).toContain('cron/evaluate-learning-shadow.ts');
    expect(map).toContain('lib/learning/');
    expect(map).toMatch(/read-only/i);
    expect(map).toMatch(/off by default/i);
  });
});
