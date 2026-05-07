/**
 * Cloudflare Pages Function — PayPal verify proxy
 * Available at: /api/paypal-verify
 *
 * Thin proxy to the worker. The worker holds PAYPAL_CLIENT_ID/SECRET and
 * has the D1 binding, so verification + activation storage live there.
 *
 * Frontend (PricingTable.tsx) calls /api/paypal-verify (relative URL on
 * socialaistudio.au), this forwards to the worker, the worker confirms the
 * subscription with PayPal and stores a pending_activations row keyed by
 * email. App.tsx consumes it on the user's next render.
 *
 * Optional env var: AI_WORKER_URL (overrides the default below).
 */

const DEFAULT_WORKER_URL = 'https://socialai-api.steve-700.workers.dev';

export async function onRequest(context) {
  const { request, env } = context;
  const workerBase = env.AI_WORKER_URL || DEFAULT_WORKER_URL;
  const target = `${workerBase}/api/paypal-verify`;

  try {
    return await fetch(new Request(target, request));
  } catch (err) {
    console.error('paypal-verify proxy error:', err && err.message);
    return new Response(JSON.stringify({ error: 'Proxy error. Please contact support.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
