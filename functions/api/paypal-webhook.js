/**
 * Cloudflare Pages Function — PayPal webhook proxy
 * Available at: /api/paypal-webhook
 *
 * Forwards the request to the worker, where the actual logic lives. The
 * worker has the PAYPAL_*, RESEND_API_KEY, and DB bindings — keeping the
 * implementation there avoids duplicating secrets across two CF projects.
 *
 * PayPal's webhook URL is configured to socialaistudio.au/api/paypal-webhook,
 * so this proxy keeps that contract stable. Update WORKER_URL if the worker
 * domain changes.
 *
 * Optional env var: AI_WORKER_URL (overrides the default below).
 */

const DEFAULT_WORKER_URL = 'https://socialai-api.steve-700.workers.dev';

export async function onRequest(context) {
  const { request, env } = context;
  const workerBase = env.AI_WORKER_URL || DEFAULT_WORKER_URL;
  const target = `${workerBase}/api/paypal-webhook`;

  // Pass through method, headers, and body. PayPal's webhook signature is
  // computed over the raw body, so it must arrive at the worker unchanged.
  // new Request(target, request) preserves all of those.
  try {
    return await fetch(new Request(target, request));
  } catch (err) {
    console.error('paypal-webhook proxy error:', err && err.message);
    return new Response('Proxy error', { status: 502 });
  }
}
