import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authentication loading gate', () => {
  it('reports an initialization timeout without falsely claiming the Clerk key is missing', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(source).toContain('Sign-in is taking longer than expected');
    expect(source).toContain('Your session and account data');
    expect(source).toContain('Reload sign-in');
    expect(source).toContain('mailto:${CLIENT.supportEmail}');
    expect(source).not.toContain('Authentication not configured');
    expect(source).not.toContain('is missing from your Cloudflare Pages environment variables');
  });
});
