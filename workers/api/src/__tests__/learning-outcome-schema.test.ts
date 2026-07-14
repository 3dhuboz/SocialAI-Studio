import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schema v39 learning outcomes', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'schema_v39_learning_outcomes.sql'),
    'utf8',
  );

  it('creates every outcome, learning, aggregate, tracking, and readiness table', () => {
    for (const table of [
      'publication_events',
      'learning_outcomes',
      'learning_signals',
      'learning_profiles',
      'learning_experiments',
      'archetype_aggregates',
      'tracking_links',
      'conversion_feedback',
      'learning_adjudications',
      'learning_release_evidence',
      'learning_release_readiness',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('keeps workspace-owned records tenant scoped and publication recording idempotent', () => {
    expect(sql).toContain('workspace_key TEXT NOT NULL');
    expect(sql).toContain('owner_kind TEXT NOT NULL');
    expect(sql).toContain('owner_id TEXT NOT NULL');
    expect(sql).toContain('UNIQUE(user_id, workspace_key, post_id, platform)');
    expect(sql).toContain('UNIQUE(publication_event_id, window_hours)');
  });

  it('adds bounded lookup indexes without altering posts', () => {
    expect(sql).toContain('idx_publication_events_due');
    expect(sql).toContain('idx_learning_signals_workspace');
    expect(sql).toContain('idx_learning_release_readiness_latest');
    expect(sql).not.toMatch(/ALTER TABLE posts/i);
  });
});
