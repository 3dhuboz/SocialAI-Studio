import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  assessCriticContextReadiness,
  loadCriticContext,
  type CriticContext,
} from '../lib/learning/critic-context';
import { makeRecordingD1 } from './helpers/recording-d1';

function readinessContext(
  profile: Record<string, unknown>,
  factContents: string[] = [],
): CriticContext {
  return {
    profile,
    verifiedFacts: factContents.map((content, index) => ({
      ownerKind: 'user',
      ownerId: 'owner_1',
      clientId: null,
      factType: `fact_${index}`,
      content,
      verifiedAt: '2026-07-17T00:00:00.000Z',
    })),
    recentPosts: [],
    forbiddenSubjects: [],
  };
}

describe('assessCriticContextReadiness', () => {
  it('rejects an empty or metadata-only profile without verified facts', () => {
    const result = assessCriticContextReadiness(readinessContext({
      name: 'Penny Wise I.T',
      tone: 'Professional',
      location: 'Gladstone',
      logoUrl: 'https://images.example/logo.png',
      socialGoal: 'Grow followers',
      forbiddenSubjects: 'competitor-logo',
    }));

    expect(result).toEqual({
      ready: false,
      reason: 'missing_business_context',
      meaningfulProfileFields: [],
      verifiedFactCount: 0,
    });
  });

  it('accepts a substantive business profile field and normalizes aliases', () => {
    const result = assessCriticContextReadiness(readinessContext({
      products_services: 'Custom software and workflow automation',
    }));

    expect(result).toEqual({
      ready: true,
      reason: 'business_profile',
      meaningfulProfileFields: ['products_services'],
      verifiedFactCount: 0,
    });
  });

  it('accepts a verified fact even when the business profile is empty', () => {
    const result = assessCriticContextReadiness(
      readinessContext({}, ['Custom-coded websites for Australian small businesses']),
    );

    expect(result).toEqual({
      ready: true,
      reason: 'verified_facts',
      meaningfulProfileFields: [],
      verifiedFactCount: 1,
    });
  });

  it('does not treat placeholder profile or fact values as context', () => {
    const result = assessCriticContextReadiness(
      readinessContext({ description: 'TBD', productsServices: ['N/A', ' '] }, ['unknown']),
    );

    expect(result.ready).toBe(false);
    expect(result.verifiedFactCount).toBe(0);
    expect(result.meaningfulProfileFields).toEqual([]);
  });
});

describe('loadCriticContext', () => {
  it('loads facts, posts, and denylist only for the requested client', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT profile FROM users': [{ profile: '{}' }],
      'SELECT profile FROM clients': [
        { profile: '{"forbiddenSubjects":["competitor-logo"]}' },
      ],
      'FROM client_facts': [
        {
          client_id: 'client_1',
          fact_type: 'offer',
          content: 'Brisket only',
          verified_at: '2026-07-14',
        },
      ],
      'FROM posts': [
        {
          id: 'p1',
          client_id: 'client_1',
          content: 'Low and slow',
          platform: 'facebook',
        },
      ],
    });

    const context = await loadCriticContext(
      { DB: db } as Env,
      'owner_1',
      'client_1',
    );

    expect(context.verifiedFacts.every((fact) => fact.clientId === 'client_1')).toBe(true);
    expect(context.recentPosts.every((post) => post.clientId === 'client_1')).toBe(true);
    expect(context.forbiddenSubjects).toContain('competitor-logo');

    const tenantQueries = calls.filter((call) =>
      /client_facts|FROM posts/.test(call.sql),
    );
    expect(tenantQueries).toHaveLength(2);
    expect(
      tenantQueries.every(
        (call) =>
          call.sql.includes('client_id = ?') &&
          call.binds.includes('owner_1') &&
          call.binds.includes('client_1'),
      ),
    ).toBe(true);
  });

  it('keeps the owner workspace separate from every client workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT profile FROM users': [
        { profile: '{"forbiddenSubjects":"competitor-logo"}' },
      ],
      'FROM client_facts': [
        {
          client_id: null,
          fact_type: 'about',
          content: 'Owner workspace',
          verified_at: '2026-07-14',
        },
      ],
      'FROM posts': [
        {
          id: 'p-owner',
          client_id: null,
          content: 'Owner post',
          platform: 'instagram',
        },
      ],
    });

    const context = await loadCriticContext({ DB: db } as Env, 'owner_1', null);

    expect(context.verifiedFacts[0]).toMatchObject({
      ownerKind: 'user',
      ownerId: 'owner_1',
      clientId: null,
    });
    expect(context.recentPosts[0]).toMatchObject({
      ownerKind: 'user',
      ownerId: 'owner_1',
      clientId: null,
    });

    const tenantQueries = calls.filter((call) =>
      /client_facts|FROM posts/.test(call.sql),
    );
    expect(
      tenantQueries.every(
        (call) =>
          call.sql.includes('client_id IS NULL') &&
          call.binds.length === 1 &&
          call.binds[0] === 'owner_1',
      ),
    ).toBe(true);
  });

  it('loads Shopify context only from the canonical shop domain', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT profile FROM shopify_stores': [
        { profile: '{"forbiddenSubjects":["competitor-logo"]}' },
      ],
      'FROM shopify_facts': [
        {
          fact_type: 'product',
          content: 'Blue mug',
          verified_at: '2026-07-14',
        },
      ],
      "owner_kind = 'shop'": [
        { id: 'p1', content: 'New mug', platform: 'facebook' },
      ],
    });

    const context = await loadCriticContext(
      { DB: db } as Env,
      'store.myshopify.com',
      null,
      'shop',
      'Store.MyShopify.com',
    );

    expect(
      context.verifiedFacts.every(
        (fact) =>
          fact.ownerKind === 'shop' &&
          fact.ownerId === 'store.myshopify.com' &&
          fact.clientId === null,
      ),
    ).toBe(true);
    expect(context.forbiddenSubjects).toContain('competitor-logo');

    const tenantQueries = calls.filter((call) =>
      /shopify_stores|shopify_facts|owner_kind = 'shop'/.test(call.sql),
    );
    expect(tenantQueries.length).toBeGreaterThanOrEqual(3);
    expect(
      tenantQueries.every((call) => call.binds.includes('store.myshopify.com')),
    ).toBe(true);
  });
});
