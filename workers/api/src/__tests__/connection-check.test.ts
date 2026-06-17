import { describe, expect, it } from 'vitest';
import { isShopConnected } from '../lib/connection-check';

function makeEnv(rows: Record<string, string | null | undefined>) {
  return {
    DB: {
      prepare: () => ({
        bind: (shopDomain: string) => ({
          first: async () => (
            Object.prototype.hasOwnProperty.call(rows, shopDomain)
              ? { social_tokens: rows[shopDomain] ?? null }
              : null
          ),
        }),
      }),
    },
  } as any;
}

describe('isShopConnected', () => {
  it('accepts Facebook-ready shop token payloads', async () => {
    const env = makeEnv({
      'acme.myshopify.com': JSON.stringify({
        facebookPageId: '123',
        facebookPageAccessToken: 'token',
      }),
    });

    await expect(isShopConnected(env, 'acme.myshopify.com', 'facebook')).resolves.toBe(true);
    await expect(isShopConnected(env, 'acme.myshopify.com', 'instagram')).resolves.toBe(false);
  });

  it('accepts Instagram-ready payloads only when the Instagram business id exists', async () => {
    const env = makeEnv({
      'acme.myshopify.com': JSON.stringify({
        facebookPageId: '123',
        facebookPageAccessToken: 'token',
        instagramBusinessAccountId: 'ig_123',
      }),
    });

    await expect(isShopConnected(env, 'acme.myshopify.com', 'facebook')).resolves.toBe(true);
    await expect(isShopConnected(env, 'acme.myshopify.com', 'instagram')).resolves.toBe(true);
  });

  it('fails closed for missing rows or malformed JSON', async () => {
    const env = makeEnv({
      'broken.myshopify.com': '{not-json}',
      'empty.myshopify.com': null,
    });

    await expect(isShopConnected(env, 'missing.myshopify.com', 'facebook')).resolves.toBe(false);
    await expect(isShopConnected(env, 'broken.myshopify.com', 'facebook')).resolves.toBe(false);
    await expect(isShopConnected(env, 'empty.myshopify.com', 'facebook')).resolves.toBe(false);
  });
});
