import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../auth', () => ({
  requireAdmin: async () => ({ uid: 'admin-user', email: 'admin@example.com' }),
}));

import { registerAdminStatsRoutes } from '../routes/admin-stats';
import type { Env } from '../env';

type PostRow = {
  id: string;
  scheduled_for: string;
  platform: string;
  status: string;
  content: string;
  image_prompt?: string | null;
  client_id?: string | null;
};

type QueryCall = {
  sql: string;
  params: unknown[];
};

function makeEnv(posts: PostRow[], calls: QueryCall[] = []): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return {
            async all() {
              const [status, limit] = params as [string, number];
              const results = posts
                .filter((post) => post.status === status && post.content)
                .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
                .slice(0, limit)
                .map((post) => ({
                  id: post.id,
                  scheduled_for: post.scheduled_for,
                  platform: post.platform,
                  content: post.content,
                  image_prompt: post.image_prompt ?? '',
                  image_prompt_preview: (post.image_prompt ?? '').slice(0, 200),
                  workspace: post.client_id ?? '_self',
                }));
              return { results };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    DB: db,
    CLERK_SECRET_KEY: 'sk_test',
    CLERK_JWT_KEY: 'jwt_test',
  } as Env;
}

async function scan(posts: PostRow[], query = '', calls: QueryCall[] = []) {
  const app = new Hono<{ Bindings: Env }>();
  registerAdminStatsRoutes(app);

  const response = await app.request(
    `http://localhost/api/admin/scan-flagged-posts${query}`,
    { headers: { Authorization: 'Bearer test' } },
    makeEnv(posts, calls),
  );

  return {
    response,
    body: await response.json() as { scanned: number; flagged: any[] },
  };
}

describe('GET /api/admin/scan-flagged-posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags fabricated caption content', async () => {
    const { body } = await scan([
      {
        id: 'post-caption',
        scheduled_for: '2026-05-24T09:00:00.000Z',
        platform: 'facebook',
        status: 'Scheduled',
        content: 'Sarah J., Brisbane, says: "We saved 12 hours every week!"',
        image_prompt: 'Bright photo of the shop counter.',
      },
    ]);

    expect(body.scanned).toBe(1);
    expect(body.flagged).toHaveLength(1);
    expect(body.flagged[0]).toMatchObject({
      id: 'post-caption',
      workspace: '_self',
    });
    expect(body.flagged[0].reasons.length).toBeGreaterThan(0);
  });

  it('flags fabricated image_prompt content', async () => {
    const { body } = await scan([
      {
        id: 'post-image-prompt',
        scheduled_for: '2026-05-24T10:00:00.000Z',
        platform: 'instagram',
        status: 'Scheduled',
        content: 'Fresh ideas for the weekend menu.',
        image_prompt: 'Show a testimonial card: Sarah J., Brisbane, says: "Sales jumped 45% overnight!"',
      },
    ]);

    expect(body.scanned).toBe(1);
    expect(body.flagged).toHaveLength(1);
    expect(body.flagged[0].id).toBe('post-image-prompt');
    expect(body.flagged[0].reasons.some((reason: string) => reason.startsWith('image_prompt:'))).toBe(true);
  });

  it('does not flag a clean post', async () => {
    const { body } = await scan([
      {
        id: 'post-clean',
        scheduled_for: '2026-05-24T11:00:00.000Z',
        platform: 'facebook',
        status: 'Scheduled',
        content: 'Open from 8 today with fresh coffee and lunch specials.',
        image_prompt: 'Natural daylight photo of coffee and lunch specials on a counter.',
      },
    ]);

    expect(body.scanned).toBe(1);
    expect(body.flagged).toEqual([]);
  });

  it('filters scanned posts by requested status', async () => {
    const calls: QueryCall[] = [];
    const { body } = await scan([
      {
        id: 'draft-fabricated',
        scheduled_for: '2026-05-24T09:00:00.000Z',
        platform: 'facebook',
        status: 'Draft',
        content: 'A local owner said: "This changed everything."',
      },
      {
        id: 'scheduled-fabricated',
        scheduled_for: '2026-05-24T10:00:00.000Z',
        platform: 'facebook',
        status: 'Scheduled',
        content: 'Sarah J., Brisbane, says: "Bookings doubled in a week."',
      },
    ], '?status=Draft', calls);

    expect(calls[0].params[0]).toBe('Draft');
    expect(body.scanned).toBe(1);
    expect(body.flagged.map((post) => post.id)).toEqual(['draft-fabricated']);
  });

  it('caps the requested limit at 2000', async () => {
    const calls: QueryCall[] = [];
    const posts = Array.from({ length: 2005 }, (_, index) => ({
      id: `post-${index}`,
      scheduled_for: `2026-05-24T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      platform: 'facebook',
      status: 'Scheduled',
      content: 'Regular update for today.',
      image_prompt: null,
    }));

    const { body } = await scan(posts, '?limit=9999', calls);

    expect(calls[0].params[1]).toBe(2000);
    expect(body.scanned).toBe(2000);
  });
});
