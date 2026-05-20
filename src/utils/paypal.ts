/**
 * PayPal "Manage Billing" URL builder.
 *
 * When we know the customer's PayPal subscription ID, send them directly
 * to that subscription's management page — saves them clicks once they
 * land on PayPal. When we don't (free trial, ID hasn't loaded yet,
 * portal mode without a sub), fall back to the generic autopay URL.
 *
 * Lives in utils/ instead of inline at the call sites so the URL format
 * (PayPal's "/billing/subscriptions/<id>") is in ONE place — if PayPal
 * ever changes it, we change it here.
 *
 * Shared by AccountPanel.tsx (main view + billing tab) and the Plan &
 * Billing section in App.tsx.
 */

import { CLIENT } from '../client.config';

/**
 * Returns the right "Manage Billing" URL for a customer.
 *
 * @param subscriptionId The customer's `paypal_subscription_id` from the
 *   billing endpoint (or `null` if they're on the free trial / it hasn't
 *   loaded yet).
 * @returns Specific sub URL when `subscriptionId` is a non-empty string;
 *   otherwise `CLIENT.paypalManageUrl` (the generic fallback).
 */
export function getPaypalManageUrl(subscriptionId: string | null | undefined): string {
  if (subscriptionId && typeof subscriptionId === 'string' && subscriptionId.trim().length > 0) {
    return `https://www.paypal.com/billing/subscriptions/${encodeURIComponent(subscriptionId)}`;
  }
  return CLIENT.paypalManageUrl || 'https://www.paypal.com/myaccount/autopay';
}
