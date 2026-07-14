import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { normalizeWorkspaceIdentity, workspaceKey } from '../lib/learning/types';
import { loadWorkspaceLearningMode, resolveLearningMode } from '../lib/learning/workspace-mode';

type ModeRows = {
  client?: { on_hold: number } | null;
  shop?: { shop_domain: string } | null;
  settings?: { mode: string } | null;
};

function modeEnv(rows: ModeRows, calls: string[] = []): Env {
  return {
    LEARNING_BRAIN_ENABLED: 'true',
    DB: {
      prepare(sql: string) {
        calls.push(sql);
        const statement = {
          bind() { return statement; },
          async first<T>() {
            const row = sql.includes('FROM clients') ? rows.client ?? null
              : sql.includes('FROM shopify_stores') ? rows.shop ?? null
                : rows.settings ?? null;
            return row as T | null;
          },
        };
        return statement;
      },
    } as unknown as D1Database,
  } as Env;
}

describe('learning workspace mode', () => {
  it('is off when the global feature flag is not true', () => {
    expect(resolveLearningMode(undefined, { mode: 'protected_autopilot' })).toBe('off');
  });

  it('honours an explicit workspace mode when globally enabled', () => {
    expect(resolveLearningMode('true', { mode: 'approval' })).toBe('approval');
  });

  it('defaults enabled workspaces to shadow, never autopilot', () => {
    expect(resolveLearningMode('true', {})).toBe('shadow');
  });

  it('does not access D1 when the global feature is disabled', async () => {
    const env = {
      LEARNING_BRAIN_ENABLED: 'false',
      DB: {
        prepare() {
          throw new Error('D1 must not be touched while learning is disabled');
        },
      },
    } as unknown as Env;

    await expect(loadWorkspaceLearningMode(env, 'owner_1', null)).resolves.toBe('off');
  });

  it('rejects malformed profile values', () => {
    expect(resolveLearningMode('true', { mode: 'anything' })).toBe('shadow');
  });

  it('defaults an owner without settings to shadow', async () => {
    await expect(loadWorkspaceLearningMode(modeEnv({}), 'owner_1', null)).resolves.toBe('shadow');
  });

  it('returns an explicit active client setting', async () => {
    await expect(loadWorkspaceLearningMode(modeEnv({
      client: { on_hold: 0 }, settings: { mode: 'approval' },
    }), 'owner_1', 'client_1')).resolves.toBe('approval');
  });

  it('uses canonical non-null workspace keys', () => {
    expect(workspaceKey(null)).toBe('__owner__');
    expect(workspaceKey('client_1')).toBe('client_1');
    expect(workspaceKey(null, 'shop', 'Store.MyShopify.com')).toBe('shop:store.myshopify.com');
  });

  it('rejects inconsistent user, client, and Shopify identity tuples', () => {
    expect(() => normalizeWorkspaceIdentity('owner_1', 'client_1', 'user', 'owner_1')).toThrow();
    expect(() => normalizeWorkspaceIdentity('owner_1', 'client_1', 'client', 'client_2')).toThrow();
    expect(() => normalizeWorkspaceIdentity('other.myshopify.com', null, 'shop', 'store.myshopify.com')).toThrow();
  });

  it('allows only an installed canonical Shopify sentinel', async () => {
    const env = modeEnv({ shop: { shop_domain: 'store.myshopify.com' } });
    await expect(loadWorkspaceLearningMode(env, 'store.myshopify.com', null, 'shop', 'Store.MyShopify.com'))
      .resolves.toBe('shadow');
    await expect(loadWorkspaceLearningMode(env, 'other.myshopify.com', null, 'shop', 'store.myshopify.com'))
      .resolves.toBe('off');
  });

  it('returns off for an on-hold or cross-owner client', async () => {
    await expect(loadWorkspaceLearningMode(
      modeEnv({ client: { on_hold: 1 } }), 'owner_1', 'client_1',
    )).resolves.toBe('off');
    await expect(loadWorkspaceLearningMode(
      modeEnv({ client: null }), 'owner_1', 'client_1',
    )).resolves.toBe('off');
  });

  it('does not query settings for an inconsistent identity', async () => {
    const calls: string[] = [];
    const env = modeEnv({}, calls);
    await expect(loadWorkspaceLearningMode(env, 'owner_1', null, 'shop', 'store.myshopify.com'))
      .resolves.toBe('off');
    expect(calls).toEqual([]);
  });
});
