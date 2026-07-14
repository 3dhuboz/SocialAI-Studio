import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schema v38 organic reach', () => {
  it('creates private reach profiles, segments, plans, and approved assets', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'schema_v38_organic_reach.sql'),
      'utf8',
    );

    for (const table of [
      'reach_profiles',
      'audience_segments',
      'reach_plans',
      'approved_media_assets',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain('workspace_key TEXT NOT NULL');
    expect(sql).toContain('owner_kind TEXT NOT NULL');
    expect(sql).toContain('owner_id TEXT NOT NULL');
    expect(sql).not.toMatch(/ALTER TABLE posts/i);
  });
});
