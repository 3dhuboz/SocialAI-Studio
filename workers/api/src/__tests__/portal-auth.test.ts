import { describe, expect, it } from 'vitest';
import { getAuthUserId, requireAdmin } from '../auth';

function makePortalDb(): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => ({
          user_id: 'owner_admin',
          expires_at: '2099-01-01T00:00:00Z',
          revoked_at: null,
        }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as unknown as D1Database;
}

describe('portal token scope', () => {
  it.each([
    '/api/db/social-tokens?clientId=hughesq-001',
    '/api/db/campaigns?clientId=hughesq-001',
    '/api/db/campaigns/campaign-123',
    '/api/db/posters?clientId=hughesq-001&limit=30',
    '/api/db/posters-usage',
    '/api/db/posters/poster-123/image',
    '/api/db/poster-brand-kit?clientId=hughesq-001',
    '/api/db/facts?clientId=hughesq-001',
    '/api/db/refresh-facts',
    '/api/db/refresh-facts/hughesq-001',
    '/api/ai/generate',
    '/api/ai/poster-image',
    '/api/ai/web-fetch',
    '/api/fal-proxy?action=generate-image',
    '/api/postproxy/init-connection',
    '/api/postproxy/placements?clientId=hughesq-001&platform=facebook',
    '/api/postproxy/save-placement',
    '/api/postproxy/publish-now',
  ])('authenticates portal tokens on whitelabel social route %s', async (path) => {
    const uid = await getAuthUserId(
      new Request(`https://worker.example${path}`, {
        headers: { Authorization: 'Portal valid-portal-token' },
      }),
      'sk_test',
      undefined,
      makePortalDb(),
    );

    expect(uid).toBe('owner_admin');
  });

  it('does not authenticate portal tokens on unscoped provider passthrough routes', async () => {
    const uid = await getAuthUserId(
      new Request('https://worker.example/api/fal-proxy/fal-ai/flux/dev', {
        headers: { Authorization: 'Portal leaked-token' },
      }),
      'sk_test',
      undefined,
      makePortalDb(),
    );

    expect(uid).toBeNull();
  });

  it('does not allow portal tokens through the admin gate', async () => {
    const response = await requireAdmin({
      req: {
        raw: new Request('https://worker.example/api/admin/stats', {
          headers: { Authorization: 'Portal leaked-token' },
        }),
      },
      env: {
        CLERK_SECRET_KEY: 'sk_test',
        DB: makePortalDb(),
      },
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
    } as any);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });
});
