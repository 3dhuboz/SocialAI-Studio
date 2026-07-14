import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schema v37 learning foundation', () => {
  const sql = readFileSync(resolve(process.cwd(), 'schema_v37_learning_foundation.sql'), 'utf8');

  it('creates tenant-scoped settings, decisions, and critic verdicts', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workspace_learning_settings');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_decisions');
    expect(sql).toContain('user_id TEXT NOT NULL');
    expect(sql).toContain('workspace_key TEXT NOT NULL');
    expect(sql).toContain('owner_kind TEXT NOT NULL');
    expect(sql).toContain('owner_id TEXT NOT NULL');
    expect(sql).toContain('monthly_ai_budget_usd_cents INTEGER');
    expect(sql).toContain('client_id TEXT');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_critic_verdicts');
    expect(sql).toContain('FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE(user_id, workspace_key, post_id, stage, content_hash)');
  });

  it('adds bounded lookup indexes without altering posts', () => {
    expect(sql).toContain('idx_learning_decisions_workspace_post');
    expect(sql).toContain('idx_learning_decisions_state_created');
    expect(sql).not.toMatch(/ALTER TABLE posts/i);
  });
});
