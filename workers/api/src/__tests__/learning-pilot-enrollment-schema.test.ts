import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('schema v41 learning pilot enrollments', () => {
  const path = resolve(process.cwd(), 'schema_v41_learning_pilot_enrollments.sql');

  it('adds tenant-scoped append-only enrollment receipts without touching posts', () => {
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;

    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_pilot_enrollments');
    expect(sql).toContain('UNIQUE(user_id, workspace_key, policy_version)');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_pilot_enrollments_policy_owner_kind',
    );
    expect(sql).toContain('ON learning_pilot_enrollments(policy_version, owner_kind)');
    expect(sql).toContain("owner_kind IN ('user','client')");
    expect(sql).toContain("consent_basis IN ('owner_self','customer_attested')");
    expect(sql).toContain('record_only INTEGER NOT NULL');
    expect(sql).toContain('CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_enrollment_update');
    expect(sql).not.toContain('prevent_learning_pilot_enrollment_delete');
    expect(sql).toMatch(/RAISE\(ABORT,\s*'learning pilot enrollments are immutable'\)/i);
    expect(sql).not.toMatch(/UPDATE\s+posts/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+posts/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+posts/i);
  });
});
