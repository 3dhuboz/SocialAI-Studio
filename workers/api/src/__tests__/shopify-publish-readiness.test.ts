import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

function source(pathFromSrc: string): string {
  return readFileSync(resolve(srcRoot, pathFromSrc), 'utf8');
}

describe('Shopify publish readiness', () => {
  it('enables the shop-owned posts route for Facebook scheduling + publish-now', () => {
    const posts = source('routes/shopify-posts.ts');

    expect(posts).toContain("const SUPPORTED_SHOP_PLATFORM = 'facebook';");
    expect(posts).toContain('buildCritiqueInvalidationPatch');
    expect(posts).toContain("code: 'UNSUPPORTED_PLATFORM'");
    expect(posts).toContain('requireConnectedFacebook');
    expect(posts).toContain('scheduled_for is required when scheduling a post');
    expect(posts).toContain("UPDATE posts SET status = 'Scheduled', scheduled_for = ?");
    expect(posts).not.toContain('return c.json(SHOPIFY_SCHEDULER_DISABLED, 503);');
  });

  it('keeps Shopify Autopilot preview flow while allowing Facebook batch save when connected', () => {
    const autopilot = source('routes/shopify-autopilot.ts');

    expect(autopilot).toContain("const SUPPORTED_SHOP_PLATFORM = 'facebook';");
    expect(autopilot).toContain('const dryRun = body.dryRun === true;');
    expect(autopilot).toContain("status: 'Preview'");
    expect(autopilot).toContain('requireConnectedFacebook');
    expect(autopilot).not.toContain('return c.json(SHOPIFY_SCHEDULER_DISABLED, 503);');
  });

  it('wires the publish cron + reel poller to shop-owned token loading', () => {
    const shared = source('cron/_shared.ts');
    const publishMissed = source('cron/publish-missed.ts');
    const pollPendingReels = source('cron/poll-pending-reels.ts');

    expect(shared).toContain('FROM shopify_stores');
    expect(shared).toContain("map.set(`s:${r.shop_domain}`, parsed);");
    expect(shared).toContain("if (post.owner_kind === 'shop' && post.owner_id) return map.get(`s:${post.owner_id}`);");
    expect(publishMissed).toContain('SHOPIFY_FACEBOOK_ONLY_FILTER');
    expect(publishMissed).toContain('enforceFinalImageCritiqueGate');
    expect(publishMissed).toContain('buildCritiqueContextText');
    expect(publishMissed).toContain('loadForbiddenSubjectsForShop');
    expect(publishMissed).toContain('owner_kind, p.owner_id');
    expect(pollPendingReels).toContain('owner_kind, owner_id');
  });

  it('adds an app/scopes_update webhook handler alongside the existing Shopify webhooks', () => {
    const oauth = source('routes/shopify-oauth.ts');

    expect(oauth).toContain('/api/shopify/webhooks/app/scopes_update');
    expect(oauth).toContain("claimWebhook(c.env, shop, 'app/scopes_update'");
    expect(oauth).toContain('previous');
    expect(oauth).toContain('current');
  });
});
