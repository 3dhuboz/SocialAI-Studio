import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schema v40 learning metric snapshots', () => {
  const path = resolve(process.cwd(), 'schema_v40_learning_metric_snapshots.sql');

  it('adds append-only platform snapshots and bounded outcome retry state', () => {
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;

    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS platform_metric_snapshots');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_outcome_attempts');
    expect(sql).toContain(
      'UNIQUE(user_id, workspace_key, platform, remote_post_id, captured_at)',
    );
    expect(sql).toContain('UNIQUE(publication_event_id, window_hours)');
    expect(sql).toContain('attempt_count INTEGER NOT NULL');
    expect(sql).toContain('next_retry_at TEXT');
    expect(sql).not.toMatch(/ALTER TABLE posts/i);
  });

  it('captures normal and Shopify own-post fact refreshes without changing publishers', () => {
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;

    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('CREATE TRIGGER IF NOT EXISTS capture_client_fact_metric_snapshot');
    expect(sql).toContain('CREATE TRIGGER IF NOT EXISTS capture_shopify_fact_metric_snapshot');
    expect(sql).toMatch(/AFTER INSERT ON client_facts/i);
    expect(sql).toMatch(/AFTER INSERT ON shopify_facts/i);
    expect(sql).toMatch(/NEW\.fact_type\s*=\s*'own_post'/i);
    expect(sql).toContain("'shop:' || LOWER(TRIM(NEW.shop_domain))");
    expect(sql).not.toMatch(/UPDATE\s+posts/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+posts/i);
  });
});
