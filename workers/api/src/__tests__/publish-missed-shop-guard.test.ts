import { describe, expect, it, vi } from 'vitest';
import { cronPublishMissedPosts } from '../cron/publish-missed';

type PostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  status: string;
  scheduled_for: string;
  claim_id: string | null;
  claim_at: string | null;
  fb_publish_state: string | null;
  image_critique_score: number | null;
  image_regen_count: number | null;
};

function makePost(overrides: Partial<PostRow>): PostRow {
  return {
    id: 'post_1',
    user_id: 'user_1',
    client_id: null,
    owner_kind: 'user',
    status: 'Scheduled',
    scheduled_for: '2000-01-01T00:00:00.000',
    claim_id: null,
    claim_at: null,
    fb_publish_state: null,
    image_critique_score: null,
    image_regen_count: null,
    ...overrides,
  };
}

function isDue(row: PostRow, now: string): boolean {
  return row.scheduled_for <= now;
}

function sqlExcludesShopOwners(sql: string): boolean {
  return /owner_kind/i.test(sql) && /shop/i.test(sql);
}

function makeEnv(posts: PostRow[]) {
  const calls: { sql: string; binds: unknown[]; kind: 'first' | 'run' | 'all' }[] = [];
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: (...binds: unknown[]) => ({
      first: async () => {
        calls.push({ sql, binds, kind: 'first' });
        if (/COUNT\(\*\)/i.test(sql)) {
          const now = String(binds[0]);
          const excludesShop = sqlExcludesShopOwners(sql);
          return {
            c: posts.filter((p) =>
              ['Scheduled', 'Publishing'].includes(p.status) &&
              isDue(p, now) &&
              (!excludesShop || p.owner_kind !== 'shop')
            ).length,
          };
        }
        return null;
      },
      run: async () => {
        calls.push({ sql, binds, kind: 'run' });
        const excludesShop = sqlExcludesShopOwners(sql);

        if (/UPDATE posts SET status = 'Missed'/i.test(sql) && /WHERE status = 'Publishing'/i.test(sql)) {
          for (const post of posts) {
            if (post.status === 'Publishing' && (!excludesShop || post.owner_kind !== 'shop')) {
              post.status = 'Missed';
              post.claim_id = null;
              post.claim_at = null;
            }
          }
        }

        if (/UPDATE posts SET status = 'Missed'/i.test(sql) && /WHERE id = \?/i.test(sql)) {
          const id = String(binds[binds.length - 1]);
          const post = posts.find((p) => p.id === id);
          if (post) {
            post.status = 'Missed';
            post.claim_id = null;
            post.claim_at = null;
          }
        }

        if (/UPDATE posts SET status = 'Publishing'/i.test(sql)) {
          const [claimId, claimAt, now] = binds.map(String);
          for (const post of posts) {
            if (
              post.status === 'Scheduled' &&
              post.claim_id === null &&
              isDue(post, now) &&
              (!excludesShop || post.owner_kind !== 'shop')
            ) {
              post.status = 'Publishing';
              post.claim_id = claimId;
              post.claim_at = claimAt;
            }
          }
        }

        return { success: true };
      },
      all: async () => {
        calls.push({ sql, binds, kind: 'all' });
        if (/image_critique_score/i.test(sql)) {
          const [now, threshold, maxAttempts] = binds;
          const excludesShop = sqlExcludesShopOwners(sql);
          return {
            results: posts.filter((p) =>
              p.status === 'Scheduled' &&
              isDue(p, String(now)) &&
              p.image_critique_score !== null &&
              p.image_critique_score <= Number(threshold) &&
              (p.image_regen_count ?? 0) >= Number(maxAttempts) &&
              (!excludesShop || p.owner_kind !== 'shop')
            ),
          };
        }
        if (/FROM posts p/i.test(sql) && /p\.claim_id = \?/i.test(sql)) {
          const claimId = String(binds[0]);
          return { results: posts.filter((p) => p.status === 'Publishing' && p.claim_id === claimId) };
        }
        return { results: [] };
      },
    }),
  }));

  return {
    env: {
      DB: { prepare },
      ENABLE_POSTPROXY: 'false',
    } as any,
    calls,
  };
}

describe('cronPublishMissedPosts shop-owned guard', () => {
  it('does not claim due Shopify-owned scheduled posts in the generic publisher', async () => {
    const shopPost = makePost({
      id: 'shop_post_1',
      user_id: 'acme.myshopify.com',
      owner_kind: 'shop',
    });
    const userPost = makePost({
      id: 'user_post_1',
      user_id: 'user_1',
      owner_kind: 'user',
    });
    const { env } = makeEnv([shopPost, userPost]);

    await cronPublishMissedPosts(env);

    expect(shopPost.status).toBe('Scheduled');
    expect(shopPost.claim_id).toBeNull();
    expect(shopPost.claim_at).toBeNull();
    expect(userPost.status).toBe('Publishing');
    expect(userPost.claim_id).toEqual(expect.any(String));
  });

  it('does not mark Shopify-owned Publishing zombies as Missed', async () => {
    const shopPost = makePost({
      id: 'shop_post_1',
      user_id: 'acme.myshopify.com',
      owner_kind: 'shop',
      status: 'Publishing',
      claim_id: 'old_claim',
      claim_at: '2000-01-01T00:00:00.000Z',
    });
    const userPost = makePost({
      id: 'user_post_1',
      user_id: 'user_1',
      owner_kind: 'user',
    });
    const { env } = makeEnv([shopPost, userPost]);

    await cronPublishMissedPosts(env);

    expect(shopPost.status).toBe('Publishing');
    expect(shopPost.claim_id).toBe('old_claim');
  });

  it('does not quality-block Shopify-owned scheduled posts', async () => {
    const shopPost = makePost({
      id: 'shop_post_1',
      user_id: 'acme.myshopify.com',
      owner_kind: 'shop',
      image_critique_score: 1,
      image_regen_count: 99,
    });
    const userPost = makePost({
      id: 'user_post_1',
      user_id: 'user_1',
      owner_kind: 'user',
    });
    const { env } = makeEnv([shopPost, userPost]);

    await cronPublishMissedPosts(env);

    expect(shopPost.status).toBe('Scheduled');
    expect(shopPost.claim_id).toBeNull();
  });
});
