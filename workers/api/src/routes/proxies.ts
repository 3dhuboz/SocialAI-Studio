// fal.ai + Runway API proxies — the frontend never holds the upstream
// API keys, the worker proxies through and adds auth + rate limiting +
// brand-grounded reference image selection.
//
// Three endpoints:
//
//   app.all('/api/fal-proxy', ...)    — query-param dispatcher with named
//                                       actions (generate-image, generate-video,
//                                       task-status, task-result, get-credits,
//                                       check-credits-alert). The generate-image
//                                       branch is the brain — picks the right
//                                       fal model (flux-dev / flux-pro-kontext /
//                                       nano-banana-pro) based on whether the
//                                       workspace has scraped FB photos to use
//                                       as brand reference images.
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
import { FLUX_NEGATIVE_PROMPT } from '../lib/image-safety';
import { generateImageWithBrandRefs } from '../lib/image-gen';

export function registerProxyRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── fal.ai Proxy (query-param based — matches Pages Function pattern) ────
  app.all('/api/fal-proxy', async (c) => {
    const apiKey = c.env.FAL_API_KEY;
    if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 401);

    // AUTH GATE — fal.ai is paid per-image/video; never let it run anonymous.
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    // RATE LIMIT — 20 fal.ai calls per minute per user (images are the dominant cost).
    if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }

    const url = new URL(c.req.url);
    const action = url.searchParams.get('action');
    const authHeader = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };

    if (action === 'generate-image' && c.req.method === 'POST') {
      const { prompt, negativePrompt, clientId, forceModel } = await c.req.json() as {
        prompt?: string;
        negativePrompt?: string;
        clientId?: string | null;
        // forceModel: optional override for testing/UX. Acceptable values:
        //   'flux-dev'           — original cheap baseline (no brand refs)
        //   'flux-pro-kontext'   — brand-grounded ($0.04/img, max 4 refs)
        //   'nano-banana-pro'    — premium brand-grounded ($0.15/img, max 14 refs)
        forceModel?: 'flux-dev' | 'flux-pro-kontext' | 'nano-banana-pro';
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
              return c.json({ imageUrl, model_used: 'nano-banana-pro', references_used: referenceImageUrls.length });
            }
          } else {
            console.warn(`[fal-proxy] nano-banana-pro failed (status ${res.status}), falling through to flux chain`);
          }
        }
        // Fall through to the default delegation if nano-banana-pro had no
        // refs or failed — better to ship a flux-dev image than nothing.
      }

      // ── Default path: delegate to lib/image-gen.ts ──
      // Single source of truth for brand-grounded gen: same code path the
      // cron + backfill use. Inherits the flux-pro-kontext → flux-dev
      // graceful fallback that's load-bearing when FB CDN reference URLs
      // are stale (the failure mode the user hit on 2026-05-13 when SaaS
      // posts with abstract-UI prompts returned hard errors instead of
      // falling back to plain FLUX). Also gets archetype guardrails +
      // caption-based archetype sniffing for free.
      const result = await generateImageWithBrandRefs(
        c.env, uid, clientId || null,
        { prompt, negativePrompt: negativePrompt || FLUX_NEGATIVE_PROMPT },
      );
      if (!result.imageUrl) {
        return c.json({ error: 'Image generation failed — both flux-pro-kontext and flux-dev returned no image' }, 502);
      }
      return c.json({ imageUrl: result.imageUrl, model_used: result.modelUsed, references_used: result.referencesUsed });
    }
    if (action === 'generate-video' && c.req.method === 'POST') {
      const { promptText, promptImage, duration = 5 } = await c.req.json() as any;
      if (!promptImage) return c.json({ error: 'promptImage is required' }, 400);
      const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({ prompt: promptText || 'cinematic, smooth motion', image_url: promptImage, duration: String(duration), aspect_ratio: '9:16' }),
      });
      const data = await res.json() as any;
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
      return c.json(data, { status: res.status as any });
    }
    if (action === 'get-credits') {
      const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
      const data = await res.json() as any;
      if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
      return c.json({ balance: data?.balance ?? data?.credits ?? null });
    }
    if (action === 'check-credits-alert') {
      const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
      const data = await res.json() as any;
      if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
      const balance = data?.balance ?? data?.credits ?? null;
      const threshold = 5;
      const resendKey = c.env.RESEND_API_KEY;
      if (balance !== null && balance < threshold && resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'SocialAI Studio <noreply@socialaistudio.au>',
            to: 'steve@3dhub.au',
            subject: `fal.ai Credits Low — $${typeof balance === 'number' ? balance.toFixed(2) : balance} remaining`,
            html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out. Top up now to keep your posts looking great.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a><p style="color:#888;font-size:12px;margin-top:20px;">This alert triggers when balance drops below $${threshold}.</p></div>`,
          }),
        });
        return c.json({ balance, alert: 'sent', threshold });
      }
      return c.json({ balance, alert: balance !== null && balance < threshold ? 'no_resend_key' : 'not_needed', threshold });
    }
    return c.json({ error: `Unknown action: ${action}` }, 400);
  });

  // ── fal.ai Proxy (path-based passthrough) ───────────────────────────────
  app.all('/api/fal-proxy/*', async (c) => {
    // AUTH GATE — required to use the proxied fal.ai endpoint with our key.
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }

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
    const path = c.req.path.replace('/api/runway-proxy', '');
    const url = `https://api.runwayml.com/v1${path}`;
    const method = c.req.method;
    const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;

    // Get key from Authorization header or fallback to env var
    const authHeader = c.req.header('Authorization');
    const apiKey = authHeader?.replace('Bearer ', '') || c.env.RUNWAY_API_KEY;
    if (!apiKey) return c.json({ error: 'Runway API key required' }, 401);

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
}
