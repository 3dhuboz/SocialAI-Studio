import { describe, expect, it } from 'vitest';
import type { ClientFact } from '../../services/gemini';
import { isCustomerSafeFact, publicFactContent } from '../ReelStudio';

function fact(overrides: Partial<ClientFact> = {}): ClientFact {
  return {
    fact_type: 'event',
    content: 'Bourbon lamb burgers\nFreshly prepared for this week.',
    metadata: {},
    engagement_score: 0,
    ...overrides,
  };
}

describe('Reel Studio verified context', () => {
  it('allows Richo weekly specials without attached order data', () => {
    expect(isCustomerSafeFact(fact({
      metadata: { source: 'richo-road-butchery', eventType: 'weekly_special' },
    }))).toBe(true);
  });

  it('blocks Richo order and non-special facts from caption context', () => {
    expect(isCustomerSafeFact(fact({
      metadata: {
        source: 'richo-road-butchery',
        eventType: 'weekly_special',
        order: { customerName: 'Private customer' },
      },
    }))).toBe(false);

    expect(isCustomerSafeFact(fact({
      metadata: { source: 'richo-road-butchery', eventType: 'order_created' },
    }))).toBe(false);
  });

  it('strips fulfilment and order-detail lines before AI captioning', () => {
    expect(publicFactContent(fact({
      content: [
        'Bourbon lamb burgers',
        'Freshly prepared for this week.',
        'Fulfilment: delivery',
        'Window: Wednesday 2pm',
        'Suburb: Kawana',
        'Packed total: $164.50',
        'Items: 8',
      ].join('\n'),
    }))).toBe('Bourbon lamb burgers\nFreshly prepared for this week.');
  });
});
