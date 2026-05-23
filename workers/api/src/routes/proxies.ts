// fal.ai + Runway API proxies — the frontend never holds the upstream
// API keys, the worker proxies through and adds auth + rate limiting.
//
// Three endpoints:
//
//   app.all('/api/fal-proxy', ...)    — query-param dispatcher with named
//                                       actions (generate-image, generate-video,
//                                       task-status, task-result, get-credits,
//                                       check-credits-alert). The generate-image
//                                       branch delegates to lib/image-gen.ts
//                                       which uses FLUX-dev as the workhorse,
//                                       or routes to nano-banana-pro when
//                                       forceModel is set.
//
//   app.all('/api/fal-proxy/*', ...)  — generic passthrough for raw fal endpoints
//                                       not covered by the dispatcher above.
//
//   app.all('/api/runway-proxy/*', ...) — generic passthrough for Runway.
//
// All paths gated by Clerk auth + 20 calls/min rate limit per user. fal.ai
// is paid per-image/video; we never let unauthenticated traffic hit it.
//
// Extracted from src/index.ts as Phase B step 24 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { checkBillingGate } from '../lib/billing-gate';
import { FLUX_NEGATIVE_PROMPT } from '../lib/image-safety';
import { generateImageWithGuardrails } from '../lib/image-gen';
import { logAiUsage } from '../lib/ai-usage';
import { checkFalCreditsAlert } from '../cron/check-fal-credits';

const NANO_BANANA_PRO_COST_USD = 0.15;
const KLING_STANDARD_VIDEO_COST_USD = 0.30;

export function registerProxyRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── fal.ai Proxy (query-param based — matches Pages Function pattern) ────
  app.all('/api/fal-proxy', async (c) => {
    const apiKey = c.env.FAL_API_KEY;
    if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 401);

    // AUTH GATE — fal.ai is paid per-image/video; never let it run anonymous.
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    // RATE LIMIT + BILLING GATE — fal.ai is the most expensive endpoint
    // ($0.025-$0.15/image). Block past_due subscribers so a declined card
    // can't churn provider credit until the cancellation eventually lands.
    // Both checks hit different tables (rate_limit_log vs users) and neither
    // depends on the other's result — fire them in parallel.
    const [isLimited, denied] = await Promise.all([
      isRateLimited(c.env.DB, `fal:${uid}`, 20),
      checkBillingGate(c, uid),
    ]);
    if (isLimited) return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    if (denied) return denied;

    const url = new URL(c.req.url);
    const action = url.searchParams.get('action');
    const authHeader = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };

    if (action === 'generate-image' && c.req.method === 'POST') {
      const { prompt, negativePrompt, clientId, forceModel, caption } = await c.req.json() as {
        prompt?: string;
        negativePrompt?: string;
        clientId?: string | null;
        // caption: the post text this image will accompany. Used by
        // generateImageWithGuardrails for archetype sniffing when the workspace
        // hasn't run classify-business yet — without it, guardrails no-op for
        // unclassified workspaces and cross-domain images ship unchecked.
        caption?: string | null;
        // forceModel: optional override for testing/UX. Acceptable values:
        //   'flux-dev'       — FLUX Dev baseline (default path, square_hd, 35 steps)
        //   'nano-banana-pro' — Gemini 3 Pro Image with up to 14 brand refs ($0.15/img)
        forceModel?: 'flux-dev' | 'nano-banana-pro';
      };
      if (!prompt) return c.json({ error: 'prompt is required' }, 400);
      if (!/candid iPhone/i.test(prompt)) {
        console.warn(`[fal-proxy] generate-image prompt missing safety marker — uid=${uid}, prompt prefix="${prompt.substring(0, 80)}"`);
      }

      // ── Premium tier: nano-banana-pro (Gemini 3 Pro Image) ──
      // Up to 14 refs, $0.15/image, best brand consistency. Kept inline
      // because the lib/image-gen.ts helper doesn't support this model —
      // it's a premium-tier opt-in via forceModel, not the default route.
      // Falls back to the default delegation below if no refs are available.
      if (forceModel === 'nano-banana-pro') {
        let referenceImageUrls: string[] = [];
        try {
          const photoRows = await c.env.DB.prepare(
            `SELECT metadata FROM client_facts
             WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'photo'
             ORDER BY engagement_score DESC, verified_at DESC
             LIMIT 14`
          ).bind(uid, clientId || '').all<{ metadata: string }>();
          for (const row of photoRows.results || []) {
            try {
              const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
              if (meta?.url && typeof meta.url === 'string') referenceImageUrls.push(meta.url);
            } catch { /* skip bad row */ }
          }
        } catch (e) {
          console.warn(`[fal-proxy] nano-banana-pro brand-ref fetch failed:`, e);
        }
        if (referenceImageUrls.length > 0) {
          const res = await fetch('https://fal.run/fal-ai/gemini-3-pro-image-preview', {
            method: 'POST', headers: authHeader,
            body: JSON.stringify({
              prompt,
              image_urls: referenceImageUrls.slice(0, 14),
              aspect_ratio: '1:1',
              num_images: 1,
            }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            const imageUrl = data?.images?.[0]?.url || null;
            if (imageUrl) {
              await logAiUsage(c.env, {
                userId: uid,
                clientId: clientId || null,
                provider: 'fal',
                model: 'nano-banana-pro',
                operation: 'image-gen-nano-banana-pro',
                imagesGenerated: 1,
                estCostUsd: NANO_BANANA_PRO_COST_USD,
                ok: true,
              });
              return c.json({ imageUrl, model_used: 'nano-banana-pro' });
            }
            await logAiUsage(c.env, {
              userId: uid,
              clientId: clientId || null,
              provider: 'fal',
              model: 'nano-banana-pro',
              operation: 'image-gen-nano-banana-pro',
              imagesGenerated: 0,
              estCostUsd: 0,
              ok: false,
            });
          } else {
            console.warn(`[fal-proxy] nano-banana-pro failed (status ${res.status}), falling through to flux chain`);
            await logAiUsage(c.env, {
              userId: uid,
              clientId: clientId || null,
              provider: 'fal',
              model: 'nano-banana-pro',
              operation: 'image-gen-nano-banana-pro',
              imagesGenerated: 0,
              estCostUsd: 0,
              ok: false,
            });
          }
        }
        // Fall through to the default delegation if nano-banana-pro had no
        // refs or failed — better to ship a flux-dev image than nothing.
      }

      // ── Default path: delegate to lib/image-gen.ts ──
      // Single source of truth for image gen: same code path the cron +
      // backfill use. FLUX-dev at square_hd / 35 steps / guidance 7.0,
      // with archetype guardrails + caption-based archetype sniffing.
      const result = await generateImageWithGuardrails(
        c.env, uid, clientId || null,
        { prompt, negativePrompt: negativePrompt || FLUX_NEGATIVE_PROMPT },
        { caption: caption || null },
      );
      if (!result.imageUrl) {
        return c.json({ error: 'Image generation failed — flux-dev returned no image' }, 502);
      }
      return c.json({ imageUrl: result.imageUrl, model_used: result.modelUsed });
    }
    if (action === 'generate-video' && c.req.method === 'POST') {
      const { promptText, promptImage, duration = 5 } = await c.req.json() as any;
      if (!promptImage) return c.json({ error: 'promptImage is required' }, 400);
      const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({ prompt: promptText || 'cinematic, smooth motion', image_url: promptImage, duration: String(duration), aspect_ratio: '9:16' }),
      });
      const data = await res.json() as any;
      await logAiUsage(c.env, {
        userId: uid,
        clientId: null,
        provider: 'fal',
        model: 'kling-video/v1.6/standard/image-to-video',
        operation: 'video-start',
        imagesGenerated: 0,
        estCostUsd: res.ok && data?.request_id ? KLING_STANDARD_VIDEO_COST_USD : 0,
        ok: res.ok && !!data?.request_id,
      });
      if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
      return c.json({ requestId: data.request_id, statusUrl: data.status_url || null, responseUrl: data.response_url || null });
    }
    if (action === 'task-status') {
      const requestId = url.searchParams.get('requestId');
      if (!requestId) return c.json({ error: 'requestId required' }, 400);
      // Use the fal queue URL format returned by generate-video (without version/model path)
      const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`, { headers: authHeader });
      const data = await res.json() as any;
      return c.json(data, { status: res.status as any });
    }
    if (action === 'task-result') {
      const requestId = url.searchParams.get('requestId');
      if (!requestId) return c.json({ error: 'requestId required' }, 400);
      const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`, { headers: authHeader });
      const data = await res.json() as any;
      await logAiUsage(c.env, {
        userId: uid,
        clientId: null,
        provider: 'fal',
        model: 'kling-video',
        operation: 'video-result',
        imagesGenerated: 0,
        estCostUsd: 0,
        ok: res.ok && !!(data?.video?.url || data?.output?.video?.url),
      });
      return c.json(data, { status: res.status as any });
    }
    if (action === 'get-credits') {
      const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
      const data = await res.json() as any;
      if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
      return c.json({ balance: data?.balance ?? data?.credits ?? null });
    }
    if (action === 'check-credits-alert') {
      try {
        return c.json(await checkFalCreditsAlert(c.env));
      } catch (e: any) {
        return c.json({ error: e?.message || 'fal.ai credit check failed' }, 502);
      }
    }
    return c.json({ error: `Unknown action: ${action}` }, 400);
  });

  // ── fal.ai Proxy (path-based passthrough) ───────────────────────────────
  app.all('/api/fal-proxy/*', async (c) => {
    // AUTH GATE — required to use the proxied fal.ai endpoint with our key.
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    // RATE LIMIT + BILLING GATE — same rationale as the dispatcher above.
    const [isLimited, denied] = await Promise.all([
      isRateLimited(c.env.DB, `fal:${uid}`, 20),
      checkBillingGate(c, uid),
    ]);
    if (isLimited) return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    if (denied) return denied;

    const path = c.req.path.replace('/api/fal-proxy', '');
    const url = `https://api.fal.ai${path}`;
    const method = c.req.method;
    const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;

    // Server uses its own key; ignore client-supplied keys to prevent abuse.
    const apiKey = c.env.FAL_API_KEY;
    if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 500);

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, { method, headers, body });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return c.json(data as any, { status: res.status as any });
    }
    const text = await res.text();
    return c.body(text, { status: res.status as any });
  });

  // ── Runway Proxy ────────────────────────────────────────────────────────
  app.all('/api/runway-proxy/*', async (c) => {
    // AUTH GATE — Runway is paid per-generation; mirror the fal-proxy guard
    // so anonymous internet traffic can't drain RUNWAY_API_KEY. The earlier
    // version accepted a client-supplied Authorization header as a fallback
    // key, which made this an effectively-open proxy onto our key whenever
    // the caller omitted their own — drop that path entirely.
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    // RATE LIMIT + BILLING GATE — Runway is paid per-generation; mirror the
    // fal-proxy guard so a past_due card can't keep generating videos.
    const [isLimited, denied] = await Promise.all([
      isRateLimited(c.env.DB, `runway:${uid}`, 20),
      checkBillingGate(c, uid),
    ]);
    if (isLimited) return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    if (denied) return denied;

    const path = c.req.path.replace('/api/runway-proxy', '');
    const url = `https://api.runwayml.com/v1${path}`;
    const method = c.req.method;
    const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;

    // Server uses its own key; ignore client-supplied keys to prevent abuse.
    const apiKey = c.env.RUNWAY_API_KEY;
    if (!apiKey) return c.json({ error: 'Runway API key not configured' }, 500);

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, { method, headers, body });
    await logAiUsage(c.env, {
      userId: uid,
      clientId: null,
      provider: 'runway',
      model: path || '/',
      operation: 'runway-proxy',
      imagesGenerated: 0,
      estCostUsd: undefined,
      ok: res.ok,
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return c.json(data as any, { status: res.status as any });
    }
    const text = await res.text();
    return c.body(text, { status: res.status as any });
  });
}
