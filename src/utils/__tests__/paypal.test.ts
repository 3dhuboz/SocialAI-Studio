/**
 * Unit tests for src/utils/paypal.ts — the Manage Billing URL builder
 * that powers the I4 fix (billing-tail audit). Verifies:
 *   - Non-empty subscription_id → specific /billing/subscriptions/<id> URL
 *   - Null / undefined / empty / whitespace → generic CLIENT.paypalManageUrl
 *   - subscription_id is URL-encoded so values with `&` / spaces don't
 *     break the redirect or open up an injection-y query string
 *
 * The util lives in utils/ instead of inline at call sites so the URL
 * format stays in one place — if PayPal ever changes the path, we change
 * it here and every Manage Billing button picks it up.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../client.config', () => ({
  CLIENT: {
    paypalManageUrl: 'https://www.paypal.com/myaccount/autopay',
  },
}));

import { getPaypalManageUrl } from '../paypal';

describe('getPaypalManageUrl', () => {
  it('returns the specific sub URL when subscription_id is non-empty', () => {
    expect(getPaypalManageUrl('I-ABC123XYZ')).toBe(
      'https://www.paypal.com/billing/subscriptions/I-ABC123XYZ',
    );
  });

  it('falls back to the generic CLIENT.paypalManageUrl for null/undefined', () => {
    expect(getPaypalManageUrl(null)).toBe('https://www.paypal.com/myaccount/autopay');
    expect(getPaypalManageUrl(undefined)).toBe('https://www.paypal.com/myaccount/autopay');
  });

  it('treats empty + whitespace-only strings as missing (generic URL)', () => {
    expect(getPaypalManageUrl('')).toBe('https://www.paypal.com/myaccount/autopay');
    expect(getPaypalManageUrl('   ')).toBe('https://www.paypal.com/myaccount/autopay');
  });

  it('URL-encodes the subscription_id to defang ampersands / spaces', () => {
    // Defensive: PayPal subscription IDs are normally `I-` + alphanumeric,
    // but URL-encoding protects against future ID shape changes (or a
    // malformed value leaking through from a webhook payload).
    expect(getPaypalManageUrl('I-AB C&garbage')).toBe(
      'https://www.paypal.com/billing/subscriptions/I-AB%20C%26garbage',
    );
  });
});
