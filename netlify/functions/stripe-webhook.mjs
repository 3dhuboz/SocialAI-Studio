/**
 * RETIRED — Stripe has been replaced by PayPal.
 * See paypal-webhook.mjs for the active webhook handler.
 */
export const handler = async () => ({
  statusCode: 410,
  body: 'This endpoint is no longer in use.',
});
