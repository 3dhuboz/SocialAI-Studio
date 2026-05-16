/**
 * Unit tests for the brand resolver (lib/brand.ts).
 *
 * Covers the two-level fallback chain that every email/alert callsite
 * relies on:
 *
 *   1. user has brand_id → load that brand row, resolve env fallbacks.
 *   2. user has NULL brand_id → load is_default brand row.
 *   3. user lookup fails OR table missing → return hardcoded SocialAI Studio
 *      defaults (so an in-flight deploy without the migration applied
 *      doesn't break email sends).
 *
 * Run with: `npm test` from repo root.
 *
 * The D1 binding is mocked with a tiny query-replay stub — we don't need
 * a real wrangler-d1 process for unit-level coverage of the resolver.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadBrandForUser, loadDefaultBrand, type Brand } from '../brand';
import type { Env } from '../../env';

type SqlBinding = string | number | null | undefined;

interface QueryStub {
  /** Substring that must appear in the SQL to use this stub. */
  match: string;
  /** Bindings the caller is expected to pass (for assertion). */
  bindings?: SqlBinding[];
  /** Value to return from `.first()`. */
  row: unknown;
}

/**
 * Minimal D1Database-shaped mock. Each `prepare(sql).bind(...).first()` call
 * walks the configured stubs and returns the first match.
 */
function makeDb(stubs: QueryStub[]): Env['DB'] {
  return {
    prepare(sql: string) {
      const stub = stubs.find((s) => sql.includes(s.match));
      return {
        bind(...args: SqlBinding[]) {
          return {
            first: vi.fn(async () => {
              if (!stub) return null;
              if (stub.bindings) {
                expect(args).toEqual(stub.bindings);
              }
              return stub.row as any;
            }),
            run: vi.fn(),
            all: vi.fn(),
          };
        },
        first: vi.fn(async () => stub?.row ?? null),
        run: vi.fn(),
        all: vi.fn(),
      };
    },
    // D1Database has more surface area but this resolver only uses prepare().
  } as unknown as Env['DB'];
}

function makeEnv(db: Env['DB']): Env {
  return {
    DB: db,
    OPENROUTER_API_KEY: 'test',
    CLERK_SECRET_KEY: 'test',
  } as Env;
}

const DEFAULT_BRAND_ROW = {
  id: 'socialai-studio',
  app_name: 'SocialAI Studio',
  domain: 'socialaistudio.au',
  accent_color: '#f59e0b',
  bg_color: '#0a0a0f',
  support_email: 'support@socialaistudio.au',
  admin_notify_email: 'steve@pennywiseit.com.au',
  from_email: 'hello@socialaistudio.au',
  facebook_app_id: null,
  facebook_app_secret: null,
  paypal_plan_starter: null,
  paypal_plan_pro: null,
  paypal_plan_agency: null,
  is_default: 1,
};

const CUSTOM_BRAND_ROW = {
  id: 'acme-marketing',
  app_name: 'Acme Marketing',
  domain: 'acme.example.com',
  accent_color: '#10b981',
  bg_color: '#001122',
  support_email: 'help@acme.example.com',
  admin_notify_email: 'ops@acme.example.com',
  from_email: 'no-reply@acme.example.com',
  facebook_app_id: 'fb-acme-123',
  facebook_app_secret: 'secret-acme',
  paypal_plan_starter: 'P-ACME-STARTER',
  paypal_plan_pro: 'P-ACME-PRO',
  paypal_plan_agency: null,
  is_default: 0,
};

describe('loadBrandForUser', () => {
  it('returns the default brand when the user has no brand_id', async () => {
    const db = makeDb([
      { match: 'FROM users WHERE id', row: { brand_id: null } },
      { match: 'is_default = 1', row: DEFAULT_BRAND_ROW },
    ]);
    const brand = await loadBrandForUser(makeEnv(db), 'user_123');
    expect(brand.id).toBe('socialai-studio');
    expect(brand.appName).toBe('SocialAI Studio');
    expect(brand.domain).toBe('socialaistudio.au');
    expect(brand.accentColor).toBe('#f59e0b');
    expect(brand.adminNotifyEmail).toBe('steve@pennywiseit.com.au');
  });

  it('returns the custom brand when the user has brand_id set', async () => {
    const db = makeDb([
      { match: 'FROM users WHERE id', row: { brand_id: 'acme-marketing' } },
      { match: 'FROM brands\n        WHERE id', row: CUSTOM_BRAND_ROW },
    ]);
    const brand = await loadBrandForUser(makeEnv(db), 'user_456');
    expect(brand.id).toBe('acme-marketing');
    expect(brand.appName).toBe('Acme Marketing');
    expect(brand.accentColor).toBe('#10b981');
    expect(brand.bgColor).toBe('#001122');
    expect(brand.supportEmail).toBe('help@acme.example.com');
    expect(brand.adminNotifyEmail).toBe('ops@acme.example.com');
    expect(brand.fromEmail).toBe('no-reply@acme.example.com');
    expect(brand.facebookAppId).toBe('fb-acme-123');
    expect(brand.facebookAppSecret).toBe('secret-acme');
    expect(brand.paypal.starter).toBe('P-ACME-STARTER');
    expect(brand.paypal.pro).toBe('P-ACME-PRO');
    expect(brand.paypal.agency).toBeNull();
  });

  it('falls back to env when the brand row has NULL Facebook credentials', async () => {
    const rowWithNoFb = { ...DEFAULT_BRAND_ROW, facebook_app_id: null, facebook_app_secret: null };
    const db = makeDb([
      { match: 'FROM users WHERE id', row: { brand_id: null } },
      { match: 'is_default = 1', row: rowWithNoFb },
    ]);
    const env = makeEnv(db);
    env.FACEBOOK_APP_ID = 'env-fb-id';
    env.FACEBOOK_APP_SECRET = 'env-fb-secret';
    const brand = await loadBrandForUser(env, 'user_789');
    expect(brand.facebookAppId).toBe('env-fb-id');
    expect(brand.facebookAppSecret).toBe('env-fb-secret');
  });

  it('returns the hardcoded fallback when the brands table is missing entirely', async () => {
    // Simulate the table not existing yet (pre-migration deploy window):
    // every D1 prepare throws.
    const failingDb = {
      prepare() {
        throw new Error('no such table: brands');
      },
    } as unknown as Env['DB'];
    const brand = await loadBrandForUser(makeEnv(failingDb), 'user_xyz');
    expect(brand.id).toBe('socialai-studio');
    expect(brand.appName).toBe('SocialAI Studio');
    expect(brand.adminNotifyEmail).toBe('steve@pennywiseit.com.au');
  });

  it('falls back to the default brand when the user_id has no users row', async () => {
    // user lookup returns null, then default lookup returns the row.
    const db = makeDb([
      { match: 'FROM users WHERE id', row: null },
      { match: 'is_default = 1', row: DEFAULT_BRAND_ROW },
    ]);
    const brand = await loadBrandForUser(makeEnv(db), 'ghost_user');
    expect(brand.id).toBe('socialai-studio');
  });

  it('falls back to the default brand when brand_id points at a missing row', async () => {
    // Manual DB edit left brand_id dangling — resolver must not blow up.
    const db = makeDb([
      { match: 'FROM users WHERE id', row: { brand_id: 'deleted-brand' } },
      { match: 'FROM brands\n        WHERE id', row: null },
      { match: 'is_default = 1', row: DEFAULT_BRAND_ROW },
    ]);
    const brand: Brand = await loadBrandForUser(makeEnv(db), 'user_dangling');
    expect(brand.id).toBe('socialai-studio');
  });
});

describe('loadDefaultBrand', () => {
  it('reads the is_default = 1 row', async () => {
    const db = makeDb([{ match: 'is_default = 1', row: DEFAULT_BRAND_ROW }]);
    const brand = await loadDefaultBrand(makeEnv(db));
    expect(brand.id).toBe('socialai-studio');
    expect(brand.appName).toBe('SocialAI Studio');
  });

  it('falls back to hardcoded defaults when the table is missing', async () => {
    const failingDb = {
      prepare() {
        throw new Error('no such table: brands');
      },
    } as unknown as Env['DB'];
    const brand = await loadDefaultBrand(makeEnv(failingDb));
    expect(brand.id).toBe('socialai-studio');
    expect(brand.domain).toBe('socialaistudio.au');
    expect(brand.accentColor).toBe('#f59e0b');
  });
});
