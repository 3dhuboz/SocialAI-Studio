import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('learning pilot sample schema', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'schema_v46_learning_pilot_samples.sql'),
    'utf8',
  );

  it('creates immutable positive evidence for exact real pilot post versions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_pilot_samples');
    expect(sql).toContain('post_id TEXT NOT NULL');
    expect(sql).toContain('content_hash TEXT NOT NULL');
    expect(sql).toContain("owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client'))");
    expect(sql).toContain(
      "attestation_basis TEXT NOT NULL CHECK (attestation_basis IN ('owner_real_post','customer_real_post'))",
    );
    expect(sql).toContain('UNIQUE(user_id, workspace_key, post_id, content_hash)');
    expect(sql).toContain("workspace_key = '__owner__'");
    expect(sql).toContain('workspace_key = client_id');
    expect(sql).toContain(
      'FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE',
    );
    expect(sql).toContain('prevent_learning_pilot_sample_update');
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+learning_decisions\b/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+posts\b/i);
  });
});
