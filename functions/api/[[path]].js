/**
 * Cloudflare Pages Function — catch-all API proxy.
 *
 * Why this exists:
 * - `public/_redirects` sends any unmatched path to `/index.html`.
 * - The real API lives on the dedicated Worker, not on Pages Functions.
 * - Without this catch-all, same-domain URLs like `/api/health` and
 *   `/api/_meta` fall through to the SPA shell instead of returning JSON.
 *
 * Route precedence still works in our favor: more specific files such as
 * `functions/api/paypal-verify.js` or `functions/api/ai/generate.js` win
 * over this multipath route, so those bespoke handlers keep their behavior.
 */

const DEFAULT_WORKER_URL = 'https://socialai-api.steve-700.workers.dev';

function buildTargetUrl(requestUrl, workerBase) {
  const incoming = new URL(requestUrl);
  const target = new URL(workerBase.replace(/\/+$/, '') + incoming.pathname);
  target.search = incoming.search;
  return target;
}

export async function onRequest(context) {
  const { request, env } = context;
  const workerBase = env.AI_WORKER_URL || DEFAULT_WORKER_URL;
  const target = buildTargetUrl(request.url, workerBase);

  try {
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.set('X-Forwarded-Host', new URL(request.url).host);
    upstreamHeaders.set('X-Forwarded-Proto', new URL(request.url).protocol.replace(':', ''));

    return await fetch(new Request(target, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.body,
      redirect: 'manual',
    }));
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'API proxy unavailable',
      code: 'API_PROXY_UNAVAILABLE',
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Error': String(err).slice(0, 120),
      },
    });
  }
}
