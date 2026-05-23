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
  it('does not authenticate portal tokens on paid provider proxy routes', async () => {
    const uid = await getAuthUserId(
      new Request('https://worker.example/api/fal-proxy?action=generate-image', {
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
