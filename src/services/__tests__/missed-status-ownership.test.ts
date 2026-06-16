import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('missed post status ownership', () => {
  it('does not let the browser mark scheduled posts as Missed', () => {
    const source = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("db.bulkUpdatePostStatus(overdue.map(p => p.id), 'Missed')");
    expect(source).not.toContain("status: 'Missed' as const");
    expect(source).not.toContain('Marking ${overdue.length} posts as missed');
  });
});
