// Pages Function — proxies https://www.socialaistudio.au/embed?token=...
// to the worker's /embed endpoint so the PennyBuilder iframe URL stays on
// the marketing domain (no need to expose socialai-api.steve-700.workers.dev
// to embedding sites). The worker handles HMAC verification, Clerk ticket
// minting, and the 302 redirect to /sign-in. We preserve status + headers
// (including Location + CSP frame-ancestors) end-to-end.
//
// If the worker is unreachable we degrade by 302'ing to the homepage so
// the iframe at least shows something — and add a hint header so anyone
// inspecting the response can see what happened.

const WORKER_BASE = "https://socialai-api.steve-700.workers.dev";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const target = WORKER_BASE + "/embed" + url.search;

  try {
    const upstream = await fetch(target, { redirect: "manual" });
    // Re-emit the upstream response. Pages will pass-through the 302 and
    // its Location header, which points at /sign-in?__clerk_ticket=... so
    // Clerk's React SDK can consume it and sign the user in.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (err) {
    return new Response("embed proxy unavailable", {
      status: 502,
      headers: { "X-Embed-Error": String(err).slice(0, 120) },
    });
  }
}
