import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEligibleAggregates,
  rebuildArchetypeAggregates,
  type AggregateContribution,
} from '../lib/learning/archetype-aggregates';
import { makeRecordingD1 } from './helpers/recording-d1';

function contributions(
  workspaceCount: number,
  postsPerWorkspace: number,
): AggregateContribution[] {
  return Array.from({ length: workspaceCount }, (_, workspace) =>
    Array.from({ length: postsPerWorkspace }, (_, post) => ({
      tenantKey: `user-${workspace}\u0000__owner__`,
      postId: `p${workspace}-${post}`,
      archetypeSlug: 'bbq-smokehouse',
      variableKey: 'posting_hour',
      variableValue: '18',
      effect: 0.2,
      confidence: 0.8,
      caption: 'private',
      imageUrl: 'https://private.example/image.jpg',
    }))).flat();
}

describe('privacy-gated archetype aggregates', () => {
  it('emits nothing below ten distinct workspaces', () => {
    expect(buildEligibleAggregates(contributions(9, 20))).toEqual([]);
  });

  it('emits nothing below one hundred distinct posts', () => {
    expect(buildEligibleAggregates(contributions(10, 9))).toEqual([]);
  });

  it('emits only coarse fields after both privacy thresholds pass', () => {
    const aggregates = buildEligibleAggregates(contributions(10, 10));

    expect(aggregates).toEqual([{
      archetypeSlug: 'bbq-smokehouse',
      variableKey: 'posting_hour',
      variableValue: '18',
      workspaceCount: 10,
      postCount: 100,
      effectRange: [0.2, 0.2],
      confidence: 0.8,
    }]);
    const json = JSON.stringify(aggregates);
    for (const forbidden of [
      'private', 'private.example', 'tenantKey', 'postId', 'caption', 'imageUrl', 'user-0',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('deduplicates repeated post contributions and drops invalid numeric rows', () => {
    const rows = contributions(10, 10);
    rows.push({ ...rows[0] });
    rows.push({ ...rows[1], postId: 'invalid-effect', effect: Number.NaN });
    rows.push({ ...rows[1], postId: 'invalid-confidence', confidence: 2 });

    expect(buildEligibleAggregates(rows)).toEqual([expect.objectContaining({
      workspaceCount: 10,
      postCount: 100,
      confidence: 0.8,
    })]);
  });

  it('falls below threshold immediately when a deleted workspace is removed', () => {
    const before = contributions(10, 10);
    expect(buildEligibleAggregates(before)).toHaveLength(1);
    expect(buildEligibleAggregates(
      before.filter((row) => !row.tenantKey.startsWith('user-9\u0000')),
    )).toEqual([]);
  });

  it('atomically replaces one archetype with coarse rows only', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_signals ls': contributions(10, 10).map((row) => ({
        tenant_key: row.tenantKey,
        post_id: row.postId,
        archetype_slug: row.archetypeSlug,
        variable_key: row.variableKey,
        variable_value: row.variableValue,
        effect: row.effect,
        confidence: row.confidence,
      })),
    });

    const result = await rebuildArchetypeAggregates(
      db,
      'bbq-smokehouse',
      '2026-07-14T00:00:00.000Z',
      () => 'aggregate-1',
    );

    expect(result).toEqual({ deleted: 1, inserted: 1 });
    const source = calls.find((call) => call.sql.includes('FROM learning_signals ls'))!;
    expect(source.sql).toContain("char(0)");
    expect(source.sql).toContain('pe.user_id = ls.user_id');
    expect(source.sql).not.toMatch(/caption|image_url|name|raw_facts/i);
    const writes = calls.filter((call) => call.method === 'run');
    expect(writes[0].sql).toContain('DELETE FROM archetype_aggregates');
    expect(writes[1].sql).toContain('INSERT INTO archetype_aggregates');
    expect(writes[1].binds).toEqual([
      'aggregate-1', 'bbq-smokehouse', 'posting_hour', '18',
      10, 100, '[0.2,0.2]', 0.8, '2026-07-14T00:00:00.000Z',
    ]);
  });

  it('is wired into the weekly strategy learner', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/cron/learn-strategies.ts'), 'utf8');
    expect(source).toContain('rebuildAllArchetypeAggregates');
  });
});
