import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getAuthUserId } from '../../auth';
import { requestIdMiddleware } from '../request-id';
import { requireAuth, stagingBearerIdentityGuard } from '../auth';

vi.mock('../../auth', () => ({
  getAuthUserId: vi.fn(),
}));

type TestEnv = {
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  DB: unknown;
  ENVIRONMENT?: string;
  STAGING_AUTH_ALLOWED_USER_IDS?: string;
  STAGING_AUTH_AUTHORIZED_PARTIES?: string;
};

const allowedUserId = 'user_allowed_operator';
const allowedParty = 'https://socialaistudio.au';
const mockedGetAuthUserId = vi.mocked(getAuthUserId);

function buildApp() {
  const app = new Hono<{ Bindings: TestEnv }>();
  app.use('*', requestIdMiddleware);
  app.use('*', stagingBearerIdentityGuard as never);
  app.use('/private/*', requireAuth as never);
  app.get('/private/whoami', (c) => c.json({ uid: c.get('uid') }));
  return app;
}

function stagingEnv(overrides: Partial<TestEnv> = {}): TestEnv {
  return {
    CLERK_JWT_KEY: 'public-pem-placeholder',
    DB: null,
    ENVIRONMENT: 'staging',
    STAGING_AUTH_ALLOWED_USER_IDS: allowedUserId,
    STAGING_AUTH_AUTHORIZED_PARTIES: allowedParty,
    ...overrides,
  };
}

function bearerRequest() {
  return new Request('http://test.local/private/whoami', {
    headers: { Authorization: 'Bearer signed-session-token' },
  });
}

describe('staging bearer identity guard', () => {
  beforeEach(() => {
    mockedGetAuthUserId.mockReset();
  });

  it('fails closed before verification when either staging allowlist is absent', async () => {
    mockedGetAuthUserId.mockResolvedValue(allowedUserId);
    const app = buildApp();

    const res = await app.fetch(
      bearerRequest(),
      stagingEnv({ STAGING_AUTH_ALLOWED_USER_IDS: undefined }),
    );

    expect(res.status).toBe(401);
    expect(mockedGetAuthUserId).not.toHaveBeenCalled();
  });

  it('rejects a valid Clerk identity that is not explicitly allowlisted', async () => {
    mockedGetAuthUserId.mockResolvedValue('user_not_allowed');
    const app = buildApp();

    const res = await app.fetch(bearerRequest(), stagingEnv());

    expect(res.status).toBe(401);
    expect(mockedGetAuthUserId).toHaveBeenCalledWith(
      expect.any(Request),
      undefined,
      'public-pem-placeholder',
      null,
      undefined,
      { authorizedParties: [allowedParty] },
    );
  });

  it('accepts one allowlisted operator and reuses the verified identity', async () => {
    mockedGetAuthUserId.mockResolvedValue(allowedUserId);
    const app = buildApp();

    const res = await app.fetch(
      bearerRequest(),
      stagingEnv({
        STAGING_AUTH_ALLOWED_USER_IDS: ` ${allowedUserId},${allowedUserId} `,
        STAGING_AUTH_AUTHORIZED_PARTIES: ` ${allowedParty},${allowedParty} `,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: allowedUserId });
    expect(mockedGetAuthUserId).toHaveBeenCalledTimes(1);
  });

  it('does not apply the staging allowlist in production', async () => {
    mockedGetAuthUserId.mockResolvedValue('user_normal_production');
    const app = buildApp();

    const res = await app.fetch(bearerRequest(), {
      DB: null,
      ENVIRONMENT: 'production',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: 'user_normal_production' });
    expect(mockedGetAuthUserId).toHaveBeenCalledTimes(1);
  });
});
