/**
 * Unit tests for routes/admin-shopify.ts → deriveBucket().
 *
 * Scope: deriveBucket is pure and exported, so it's the easy half. The
 * route HANDLERS themselves (`/api/admin/shopify-stores`, etc.) depend
 * on Clerk auth, D1 (.prepare().bind().all/first()), and an audit-log
 * write — wiring all of that up via manual mocks would be more brittle
 * than the function we're testing. Those handlers are covered by the
 * integration suite (workers run end-to-end against miniflare).
 *
 * deriveBucket is what the frontend filter chips count, so a regression
 * here would show up as an Admin tab that quietly mislabels every shop.
 *
 * The function returns one of:
 *   'uninstalled' | 'active' | 'trial' | 'pending' | 'cancelled' | 'none'
 *
 * Branches under test (one per row):
 *   uninstalled_at set                        → 'uninstalled'
 *   ACTIVE + trial_ends_at in future          → 'trial'
 *   ACTIVE + trial_ends_at in past (or null)  → 'active'
 *   PENDING                                   → 'pending'
 *   DECLINED / CANCELLED / EXPIRED / FROZEN   → 'cancelled'
 *   subscription_status null                  → 'none'
 *   any other status                          → 'none' (fallback)
 */
import { describe, it, expect } from 'vitest';
import { deriveBucket } from '../admin-shopify';

// Minimal row factory — caller spreads in just the fields each test cares
// about. The defaults represent "newly installed, no subscription yet".
type Row = Parameters<typeof deriveBucket>[0];
function row(overrides: Partial<Row> = {}): Row {
  return {
    shop_domain: 'test-shop.myshopify.com',
    shop_name: null,
    shop_email: null,
    country_code: null,
    currency: null,
    plan_name: null,
    scopes: 'read_products',
    installed_at: '2026-01-01T00:00:00Z',
    uninstalled_at: null,
    subscription_id: null,
    subscription_status: null,
    trial_ends_at: null,
    current_period_end: null,
    price_amount: null,
    price_currency: null,
    is_test_subscription: 0,
    ...overrides,
  };
}

describe('deriveBucket', () => {
  it('returns "uninstalled" when uninstalled_at is set — even if subscription is ACTIVE', () => {
    // uninstalled wins over every other status. Once a shop uninstalls,
    // their charge is cancelled by Shopify but our row keeps the last
    // status for audit. The bucket MUST follow the install state, not
    // the stale subscription_status.
    expect(deriveBucket(row({
      uninstalled_at: '2026-04-01T00:00:00Z',
      subscription_status: 'ACTIVE',
    }))).toBe('uninstalled');
  });

  it('returns "trial" when ACTIVE and trial_ends_at is in the future', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveBucket(row({
      subscription_status: 'ACTIVE',
      trial_ends_at: future,
    }))).toBe('trial');
  });

  it('returns "active" when ACTIVE and trial_ends_at is in the past', () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveBucket(row({
      subscription_status: 'ACTIVE',
      trial_ends_at: past,
    }))).toBe('active');
  });

  it('returns "active" when ACTIVE and trial_ends_at is null (post-trial paid shops)', () => {
    expect(deriveBucket(row({
      subscription_status: 'ACTIVE',
      trial_ends_at: null,
    }))).toBe('active');
  });

  it('returns "pending" when subscription_status is PENDING', () => {
    expect(deriveBucket(row({ subscription_status: 'PENDING' }))).toBe('pending');
  });

  it('returns "cancelled" for the full cancelled-family (DECLINED / CANCELLED / EXPIRED / FROZEN)', () => {
    expect(deriveBucket(row({ subscription_status: 'DECLINED' }))).toBe('cancelled');
    expect(deriveBucket(row({ subscription_status: 'CANCELLED' }))).toBe('cancelled');
    expect(deriveBucket(row({ subscription_status: 'EXPIRED' }))).toBe('cancelled');
    expect(deriveBucket(row({ subscription_status: 'FROZEN' }))).toBe('cancelled');
  });

  it('handles cancelled-family case-insensitively (DB stores upper, but be defensive)', () => {
    expect(deriveBucket(row({ subscription_status: 'declined' }))).toBe('cancelled');
    expect(deriveBucket(row({ subscription_status: 'Cancelled' }))).toBe('cancelled');
  });

  it('returns "none" when subscription_status is null (installed but no charge yet)', () => {
    expect(deriveBucket(row({ subscription_status: null }))).toBe('none');
  });

  it('returns "none" for unrecognised statuses (fallback)', () => {
    // If Shopify ever adds a new status, the safe fallback is "none"
    // (visible in the admin "Other" filter) — never silently bucketing
    // as active or trial.
    expect(deriveBucket(row({ subscription_status: 'SOME_FUTURE_STATE' }))).toBe('none');
  });
});
