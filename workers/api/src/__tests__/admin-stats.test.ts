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

type FeedbackRow = {
  id: string;
  user_id: string | null;
  client_id: string | null;
  content: string | null;
  platform: string | null;
  status: string | null;
  scheduled_for: string | null;
  image_url: string | null;
  qa_feedback_target: string | null;
  qa_feedback_reason: string | null;
  qa_feedback_note: string | null;
  qa_feedback_at: string | null;
  email?: string | null;
  client_name?: string | null;
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

function makeFeedbackEnv(feedbackRows: FeedbackRow[], calls: QueryCall[] = []): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return {
            async all() {
              const [limit] = params as [number];
              const results = feedbackRows
                .filter((post) => post.qa_feedback_at || post.qa_feedback_target || post.qa_feedback_reason)
                .sort((a, b) => String(b.qa_feedback_at || '').localeCompare(String(a.qa_feedback_at || '')))
                .slice(0, limit)
                .map((post) => ({
                  id: post.id,
                  user_id: post.user_id,
                  client_id: post.client_id,
                  email: post.email ?? null,
                  client_name: post.client_name ?? null,
                  platform: post.platform,
                  status: post.status,
                  scheduled_for: post.scheduled_for,
                  image_url: post.image_url,
                  qa_feedback_target: post.qa_feedback_target,
                  qa_feedback_reason: post.qa_feedback_reason,
                  qa_feedback_note: post.qa_feedback_note,
                  qa_feedback_at: post.qa_feedback_at,
                  content_preview: String(post.content || '').slice(0, 240),
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

async function postFeedback(feedbackRows: FeedbackRow[], query = '', calls: QueryCall[] = []) {
  const app = new Hono<{ Bindings: Env }>();
  registerAdminStatsRoutes(app);

  const response = await app.request(
    `http://localhost/api/admin/post-feedback${query}`,
    { headers: { Authorization: 'Bearer test' } },
    makeFeedbackEnv(feedbackRows, calls),
  );
  const text = await response.text();
  let body = { feedback: [], limit: 0 } as { feedback: any[]; limit: number };
  try {
    body = text ? JSON.parse(text) as { feedback: any[]; limit: number } : body;
  } catch {
    // Missing routes return Hono's plain 404 body; leave body empty so the
    // status assertion shows the intended RED failure.
  }

  return {
    response,
    body,
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

describe('GET /api/admin/post-feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns latest posts with customer QA feedback and caps the requested limit', async () => {
    const calls: QueryCall[] = [];
    const { response, body } = await postFeedback([
      {
        id: 'old-feedback',
        user_id: 'user-1',
        client_id: null,
        email: 'owner@example.com',
        client_name: null,
        scheduled_for: '2026-05-23T09:00:00.000Z',
        platform: 'facebook',
        status: 'Scheduled',
        image_url: 'https://example.com/old.jpg',
        content: 'Older caption that still needs support review.',
        qa_feedback_target: 'caption',
        qa_feedback_reason: 'bad_caption',
        qa_feedback_note: 'Too generic',
        qa_feedback_at: '2026-05-23T09:30:00.000Z',
      },
      {
        id: 'new-feedback',
        user_id: 'user-2',
        client_id: 'client-2',
        email: 'agency@example.com',
        client_name: 'Gladstone BBQ',
        scheduled_for: '2026-05-24T10:00:00.000Z',
        platform: 'instagram',
        status: 'Draft',
        image_url: 'https://example.com/new.jpg',
        content: 'Newest caption for a client workspace.',
        qa_feedback_target: 'image',
        qa_feedback_reason: 'off_brand',
        qa_feedback_note: 'Logo colour feels wrong',
        qa_feedback_at: '2026-05-23T10:15:00.000Z',
      },
      {
        id: 'no-feedback',
        user_id: 'user-3',
        client_id: null,
        scheduled_for: '2026-05-24T11:00:00.000Z',
        platform: 'facebook',
        status: 'Draft',
        image_url: null,
        content: 'No feedback on this one.',
        qa_feedback_target: null,
        qa_feedback_reason: null,
        qa_feedback_note: null,
        qa_feedback_at: null,
      },
    ], '?limit=999', calls);

    expect(response.status).toBe(200);
    expect(calls[0].params).toEqual([100]);
    expect(body.limit).toBe(100);
    expect(body.feedback.map((post) => post.id)).toEqual(['new-feedback', 'old-feedback']);
    expect(body.feedback[0]).toMatchObject({
      id: 'new-feedback',
      email: 'agency@example.com',
      client_name: 'Gladstone BBQ',
      qa_feedback_target: 'image',
      qa_feedback_reason: 'off_brand',
      qa_feedback_note: 'Logo colour feels wrong',
      content_preview: 'Newest caption for a client workspace.',
    });
  });

  it('defaults to 50 feedback rows when limit is not numeric', async () => {
    const calls: QueryCall[] = [];
    const { response, body } = await postFeedback([], '?limit=nope', calls);

    expect(response.status).toBe(200);
    expect(calls[0].params).toEqual([50]);
    expect(body.limit).toBe(50);
  });
});
