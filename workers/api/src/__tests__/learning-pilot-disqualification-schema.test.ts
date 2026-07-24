import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('learning pilot disqualification schema', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'schema_v44_learning_decision_disqualifications.sql'),
    'utf8',
  );

  it('creates immutable tenant-scoped synthetic QA receipts only', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS learning_decision_disqualifications',
    );
    expect(sql).toContain('decision_id TEXT NOT NULL UNIQUE');
    expect(sql).toContain("owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client'))");
    expect(sql).toContain("reason TEXT NOT NULL CHECK (reason = 'synthetic_qa')");
    expect(sql).toContain('LENGTH(TRIM(note)) BETWEEN 10 AND 2000');
    expect(sql).toContain("workspace_key = '__owner__'");
    expect(sql).toContain('workspace_key = client_id');
    expect(sql).toContain('owner_id = user_id');
    expect(sql).toContain('owner_id = client_id');
    expect(sql).toContain(
      'FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE',
    );
    expect(sql).toContain('prevent_learning_decision_disqualification_update');
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+learning_decisions\b/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+posts\b/i);
  });
});
