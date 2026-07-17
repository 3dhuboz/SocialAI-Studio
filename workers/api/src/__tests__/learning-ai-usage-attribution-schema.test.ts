import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('learning AI usage attribution schema', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'schema_v45_learning_ai_usage_attribution.sql'),
    'utf8',
  );

  it('adds immutable tenant-and-post scoped decision attribution', () => {
    expect(sql).toContain('ALTER TABLE ai_usage');
    expect(sql).toContain('ADD COLUMN learning_decision_id TEXT');
    expect(sql).toContain(
      'REFERENCES learning_decisions(id) ON DELETE CASCADE',
    );
    expect(sql).toContain('guard_ai_usage_learning_decision_insert');
    expect(sql).toContain('d.id = NEW.learning_decision_id');
    expect(sql).toContain('d.user_id = NEW.user_id');
    expect(sql).toContain('d.client_id IS NEW.client_id');
    expect(sql).toContain('d.post_id = NEW.post_id');
    expect(sql).toContain('prevent_ai_usage_learning_attribution_update');
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+learning_decisions\b/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+posts\b/i);
  });
});
