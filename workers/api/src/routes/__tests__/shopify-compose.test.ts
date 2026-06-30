import { describe, expect, it } from 'vitest';
import { buildFallbackCaption, type ProductRow } from '../shopify-compose';

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'gid://shopify/Product/1',
    shop_domain: 'review-store.myshopify.com',
    title: 'Canvas <strong>Tote</strong> Bag',
    handle: 'canvas-tote',
    vendor: 'SocialAI Goods',
    product_type: 'Accessories',
    description: '<p>Roomy reusable bag for markets, errands, and packing orders.</p>',
    tags: null,
    price: '29.00',
    currency: 'USD',
    image_url: 'https://cdn.shopify.com/tote.jpg',
    status: null,
    ...overrides,
  };
}

describe('Shopify compose fallback caption', () => {
  it('builds an editable product caption when AI caption generation fails', () => {
    const caption = buildFallbackCaption(product(), 'facebook', 'friendly');

    expect(caption).toContain('Canvas Tote Bag');
    expect(caption).toContain('SocialAI Goods');
    expect(caption).toContain('Accessories');
    expect(caption).toContain('29.00 USD');
    expect(caption).toContain('Roomy reusable bag');
    expect(caption).not.toContain('<p>');
    expect(caption).not.toContain('#ShopSmall');
  });

  it('adds lightweight hashtags for Instagram fallback captions', () => {
    const caption = buildFallbackCaption(product(), 'instagram', 'playful');

    expect(caption).toContain('Fresh find alert');
    expect(caption).toContain('#ShopSmall #ProductFinds #NewIn');
  });
});
