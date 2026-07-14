import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { cronEvaluateLearningShadow } from '../cron/evaluate-learning-shadow';
import { makeRecordingD1 } from './helpers/recording-d1';

describe('learning shadow evaluation', () => {
  afterEach(() => vi.useRealTimers());

  it('does not query D1 while the global switch is disabled', async () => {
    const { db, calls } = makeRecordingD1();

    await expect(cronEvaluateLearningShadow({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'false',
    } as Env)).resolves.toEqual({ posts_processed: 0 });
    expect(calls).toEqual([]);
  });

  it('creates snapshot receipts without mutating posts', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts p': [{
        id: 'post_1',
        user_id: 'owner_1',
        client_id: null,
        owner_kind: 'user',
        owner_id: 'owner_1',
        content: 'Safe draft',
        image_url: null,
        platform: 'facebook',
        scheduled_for: '2026-07-14T12:00:00.000Z',
        image_critique_score: 9,
        image_critique_reasoning: 'Strong match',
      }],
      'INSERT INTO learning_decisions': [{ id: 'decision_1' }],
    });

    const result = await cronEvaluateLearningShadow({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
    } as Env);

    expect(result).toEqual({ posts_processed: 1 });
    expect(calls.some((call) => /UPDATE\s+posts|DELETE\s+FROM\s+posts/i.test(call.sql))).toBe(false);
    const insert = calls.find((call) => /INSERT INTO learning_decisions/i.test(call.sql));
    expect(insert?.binds).toEqual(expect.arrayContaining([
      'owner_1', '__owner__', 'post_1', 'shadow', 'snapshot', 'shadow_only',
    ]));
  });

  it('uses a bounded ownership-safe upcoming-post query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    const { db, calls } = makeRecordingD1({ 'FROM posts p': [] });

    await cronEvaluateLearningShadow({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
    } as Env);

    const query = calls.find((call) => call.sql.includes('FROM posts p'))?.sql ?? '';
    const queryCall = calls.find((call) => call.sql.includes('FROM posts p'));
    expect(query).toContain('LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id');
    expect(query).toContain('p.scheduled_for > ?');
    expect(query).toContain('p.scheduled_for <= ?');
    expect(query).toContain("COALESCE(c.status, 'active') != 'on_hold'");
    expect(query).toMatch(/LIMIT\s+8/i);
    expect(queryCall?.binds).toEqual([
      '2026-07-14T10:00:00.000',
      '2026-07-15T10:00:00.000',
    ]);
  });

  it('skips a held client even if it appears in the query result', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts p': [{
        id: 'post_held',
        user_id: 'owner_1',
        client_id: 'client_held',
        owner_kind: 'client',
        owner_id: 'client_held',
        content: 'Draft',
        image_url: null,
        platform: 'facebook',
        scheduled_for: '2026-07-14T12:00:00.000Z',
      }],
      'FROM clients': [{ status: 'on_hold' }],
    });

    const result = await cronEvaluateLearningShadow({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
    } as Env);

    expect(result).toEqual({ posts_processed: 0 });
    expect(calls.some((call) => /INSERT INTO learning_decisions/i.test(call.sql))).toBe(false);
  });

  it('records Shopify posts under their canonical shop workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts p': [{
        id: 'post_shop',
        user_id: 'store.myshopify.com',
        client_id: null,
        owner_kind: 'shop',
        owner_id: 'Store.MyShopify.com',
        content: 'Product launch',
        image_url: 'https://example.com/product.jpg',
        platform: 'facebook',
        scheduled_for: '2026-07-14T12:00:00.000Z',
      }],
      'FROM shopify_stores': [{ shop_domain: 'store.myshopify.com' }],
      'INSERT INTO learning_decisions': [{ id: 'decision_shop' }],
    });

    const result = await cronEvaluateLearningShadow({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
    } as Env);

    expect(result).toEqual({ posts_processed: 1 });
    const insert = calls.find((call) => /INSERT INTO learning_decisions/i.test(call.sql));
    expect(insert?.binds).toEqual(expect.arrayContaining([
      'store.myshopify.com', 'shop:store.myshopify.com', 'shop',
    ]));
  });
});
