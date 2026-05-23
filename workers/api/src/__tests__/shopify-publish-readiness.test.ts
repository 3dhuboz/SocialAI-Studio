import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

function source(pathFromSrc: string): string {
  return readFileSync(resolve(srcRoot, pathFromSrc), 'utf8');
}

describe('Shopify publish readiness guardrails', () => {
  it('keeps manual Shopify scheduling and publish-now disabled', () => {
    const posts = source('routes/shopify-posts.ts');

    expect(posts).toContain('SHOPIFY_SCHEDULER_DISABLED');
    expect(posts).toMatch(/function isShopifySchedulerDisabled\(\): boolean \{\s*return true;\s*\}/);
    expect(posts).toMatch(/if \(v === 'Scheduled' && isShopifySchedulerDisabled\(\)\) \{\s*return c\.json\(SHOPIFY_SCHEDULER_DISABLED, 503\);/);
    expect(posts).toMatch(/if \(isShopifySchedulerDisabled\(\)\) \{\s*return c\.json\(SHOPIFY_SCHEDULER_DISABLED, 503\);/);
  });

  it('keeps Shopify autopilot persistence disabled while allowing dry-run preview generation', () => {
    const autopilot = source('routes/shopify-autopilot.ts');

    expect(autopilot).toContain('SHOPIFY_SCHEDULER_DISABLED');
    expect(autopilot).toMatch(/function isShopifySchedulerDisabled\(\): boolean \{\s*return true;\s*\}/);
    expect(autopilot).toMatch(/if \(!dryRun && isShopifySchedulerDisabled\(\)\) \{\s*return c\.json\(SHOPIFY_SCHEDULER_DISABLED, 503\);/);
    expect(autopilot).toMatch(/if \(dryRun\) \{[\s\S]*status: 'Preview'[\s\S]*\}, 200\);[\s\S]*\}/);
    expect(autopilot).toMatch(/if \(isShopifySchedulerDisabled\(\)\) \{\s*return c\.json\(SHOPIFY_SCHEDULER_DISABLED, 503\);/);
  });

  it('keeps the generic publish cron scoped away from shop-owned posts', () => {
    const shared = source('cron/_shared.ts');
    const publishMissed = source('cron/publish-missed.ts');

    expect(shared).toMatch(/export const NON_SHOP_OWNER_FILTER =\s*`\(COALESCE\(owner_kind, 'user'\) != 'shop'\)`;/);
    expect(publishMissed).toContain('NON_SHOP_OWNER_FILTER');
    expect(publishMissed.match(/\$\{NON_SHOP_OWNER_FILTER\}/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('documents why shop-owned publish is still not wired into the generic token loaders', () => {
    const shared = source('cron/_shared.ts');
    const publishMissed = source('cron/publish-missed.ts');

    expect(shared).toContain('Shop-owned rows need shopify_stores.social_tokens');
    expect(shared).toContain('SELECT id, social_tokens FROM clients');
    expect(shared).toContain('SELECT id, social_tokens FROM users');
    expect(publishMissed).not.toMatch(/FROM\s+shopify_stores/i);
  });
});
