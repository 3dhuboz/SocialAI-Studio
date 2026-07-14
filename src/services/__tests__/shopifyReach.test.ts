import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmShopifyReachProfile,
  confirmShopifyReachSegment,
  getShopifyReachPlans,
  getShopifyReachProfile,
  proposeShopifyReachProfile,
  proposeShopifyReachSegments,
} from '../../../shopify-app/src/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Shopify organic reach client', () => {
  it('mounts the one-time setup card without a publish or apply control', () => {
    const settings = readFileSync(
      resolve(process.cwd(), 'shopify-app/src/pages/Settings.tsx'),
      'utf8',
    );
    const source = readFileSync(
      resolve(process.cwd(), 'shopify-app/src/components/OrganicReachCard.tsx'),
      'utf8',
    );

    expect(settings).toContain("import { OrganicReachCard } from '../components/OrganicReachCard';");
    expect(settings).toContain('<OrganicReachCard />');
    expect(source).toContain('getShopifyReachProfile');
    expect(source).toContain('confirmShopifyReachProfile');
    expect(source).toContain('proposeShopifyReachSegments');
    expect(source).toContain('Shadow advice only');
    expect(source).not.toContain('Apply reach plan');
  });

  it('uses only the signed App Bridge session and never sends tenant identity', async () => {
    vi.stubGlobal('window', {
      shopify: {
        idToken: vi.fn(async () => 'signed-shop-token'),
        config: { apiKey: 'key', host: 'host' },
      },
    });
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const path = String(input);
      const response = path.includes('/plans/')
        ? { plans: [] }
        : path.includes('/segments/propose')
          ? { segments: [] }
          : path.includes('/segments/confirm')
            ? { segmentId: 'segment_1', status: 'confirmed' }
            : { profile: null, segments: [] };
      return new Response(JSON.stringify(response), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getShopifyReachProfile();
    await proposeShopifyReachProfile({
      timezone: 'Australia/Brisbane',
      baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
      serviceArea: { radiusKm: 40, included: ['Gladstone'] },
      excludedLocations: [],
      platforms: ['facebook', 'instagram'],
    });
    await confirmShopifyReachProfile('reach_1');
    await proposeShopifyReachSegments();
    await confirmShopifyReachSegment('segment_1');
    await getShopifyReachPlans('post_1');

    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers((init as RequestInit).headers).get('Authorization'))
        .toBe('Bearer signed-shop-token');
      const body = (init as RequestInit).body;
      if (typeof body === 'string') {
        expect(JSON.parse(body)).not.toHaveProperty('shop');
        expect(JSON.parse(body)).not.toHaveProperty('userId');
        expect(JSON.parse(body)).not.toHaveProperty('ownerId');
      }
    }
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/api/shopify/reach/profile'),
      expect.stringContaining('/api/shopify/reach/profile/propose'),
      expect.stringContaining('/api/shopify/reach/profile/confirm'),
      expect.stringContaining('/api/shopify/reach/segments/propose'),
      expect.stringContaining('/api/shopify/reach/segments/confirm'),
      expect.stringContaining('/api/shopify/reach/plans/post_1'),
    ]);
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
