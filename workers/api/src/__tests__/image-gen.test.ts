/**
 * Unit tests for workers/api/src/lib/image-gen.ts — the single
 * generateImageWithGuardrails chokepoint that every internal image-gen
 * caller (cron prewarm, JIT publish, manual backfill, fal-proxy)
 * shares.
 *
 * Mocks:
 *   - global fetch (fal.ai endpoints)
 *   - env.DB.prepare(...).all/first() — the brand-ref photo lookup and
 *     archetype resolution
 *
 * Tests focus on:
 *   - happy path returns the image URL
 *   - flux-dev request body params (lock the values we tuned)
 *   - archetype guardrails: forbidden subjects swap to fallback BEFORE fetch
 *   - 5xx error bubbles back as imageUrl=null with useful context logged
 */
// Image-gen test assertions lock the post-PR-#86 source values
// (num_inference_steps=35, guidance_scale=7.0). Kontext tests have been
// removed because PR #86 deletes that code path entirely. On this branch,
// source still has the pre-#86 values — flux-dev tests will FAIL until #86
// merges into main. Merging order: #86 → this PR.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateImageWithGuardrails } from '../lib/image-gen';

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as any;
  // Silence console output during tests; assertions on logs go through
  // explicit spies in individual tests.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Build a mock Env with chainable D1 prepare(...).bind(...).first/all stubs.
 *  Pass opts:
 *    - userArchetype: row returned by `SELECT archetype_slug FROM users`
 *    - clientArchetype: row returned by `SELECT archetype_slug FROM clients`
 *    - photos: rows returned by `SELECT metadata FROM client_facts ... = 'photo'`
 */
function makeEnv(opts: {
  userArchetype?: string | null;
  clientArchetype?: string | null;
  photoUrls?: string[];
} = {}): any {
  const userArchetype = opts.userArchetype ?? null;
  const clientArchetype = opts.clientArchetype === undefined ? null : opts.clientArchetype;
  const photoRows = (opts.photoUrls ?? []).map((url) => ({ metadata: JSON.stringify({ url }) }));

  const prepare = vi.fn().mockImplementation((sql: string) => {
    const lower = sql.toLowerCase();
    return {
      bind: () => ({
        first: () => {
          if (lower.includes('from clients')) return Promise.resolve({ archetype_slug: clientArchetype });
          if (lower.includes('from users')) return Promise.resolve({ archetype_slug: userArchetype });
          return Promise.resolve(null);
        },
        all: () => Promise.resolve({ results: photoRows }),
        run: () => Promise.resolve(),
      }),
    };
  });

  return {
    FAL_API_KEY: 'fal-test-key',
    DB: { prepare },
  };
}

// ── Happy paths ──────────────────────────────────────────────────────

describe('generateImageWithGuardrails — happy path (no brand refs)', () => {
  it('returns the imageUrl from flux-dev when no photos are stored', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/abc.png' }] }), { status: 200 }),
    );
    const env = makeEnv({ userArchetype: 'food-restaurant', photoUrls: [] });
    const result = await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'overhead flatlay of sourdough on linen',
      negativePrompt: 'people, faces',
    });
    expect(result.imageUrl).toBe('https://fal.cdn/abc.png');
    expect(result.modelUsed).toBe('flux-dev');
  });

  it('hits the FLUX-dev endpoint (NOT Kontext) when there are no brand refs', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/x.png' }] }), { status: 200 }),
    );
    const env = makeEnv({ photoUrls: [] });
    await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'safe prompt',
      negativePrompt: 'neg',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe('https://fal.run/fal-ai/flux/dev');
    expect(url).not.toContain('kontext');
  });

  it('locks flux-dev request body params (image_size, steps, guidance_scale, safety_checker)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/x.png' }] }), { status: 200 }),
    );
    const env = makeEnv({ photoUrls: [] });
    await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'safe prompt',
      negativePrompt: 'neg',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Lock the dimensions: 1:1 hi-res
    expect(body.image_size).toBe('square_hd');
    // Lock the diffusion params (source-of-truth as of this PR).
    expect(body.num_inference_steps).toBe(35);
    expect(body.guidance_scale).toBe(7.0);
    expect(body.num_images).toBe(1);
    expect(body.enable_safety_checker).toBe(true);
    // Negative prompt threaded as a SEPARATE param (not inlined into prompt)
    expect(body.negative_prompt).toBeDefined();
    expect(body.prompt).not.toContain('no people');
  });

  it('uses Authorization: Key <FAL_API_KEY> header', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({ photoUrls: [] });
    await generateImageWithGuardrails(env, 'user-1', null, { prompt: 'p', negativePrompt: 'n' });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Key fal-test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });
});

// ── Archetype guardrails ─────────────────────────────────────────────

describe('generateImageWithGuardrails — archetype guardrails (defence-in-depth)', () => {
  it('SaaS archetype + food prompt → swaps for archetype-appropriate fallback BEFORE fetch', async () => {
    // SocialAI Studio regression: archetype=tech-saas-agency, but the
    // LLM's image_prompt drifted to a restaurant scene. Guardrail should
    // catch any of the forbidden subjects (food/restaurant/plated/etc) and
    // substitute a workspace fallback scene.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({ userArchetype: 'tech-saas-agency', photoUrls: [] });
    await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'overhead shot of a plated meal in a restaurant kitchen with sourdough loaf on the side',
      negativePrompt: 'people',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Forbidden words from the SaaS regex got swapped out — prompt now
    // references the workspace / co-working fallback scenes.
    expect(body.prompt.toLowerCase()).not.toMatch(/\b(restaurant|plated|kitchen|sourdough|meal)\b/);
  });

  it('SaaS archetype + clean prompt → keeps prompt, only extends negativePrompt with archetype avoid-list', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({ userArchetype: 'tech-saas-agency', photoUrls: [] });
    await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'modern co-working studio with closed laptop and morning light',
      negativePrompt: 'people, hands',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Prompt preserved as-is (with FLUX_STYLE_SUFFIX appended by image-safety).
    expect(body.prompt).toContain('co-working studio');
    // Negative prompt extended with the archetype's avoid-list.
    expect(body.negative_prompt).toMatch(/food|plated|bbq/);
  });

  it('NULL archetype + caption sniff → derives archetype from caption (un-classified workspace defence)', async () => {
    // Exact failure mode that produced food-on-SaaS posts: user never
    // ran /api/classify-business so archetype_slug is NULL. If we pass
    // a caption that screams SaaS, sniffArchetypeFromCaption should pick
    // up tech-saas-agency and the guardrail should still bite.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({ userArchetype: null, photoUrls: [] });
    const saasCaption = 'Smart Scheduling and engagement data: SocialAI auto-publishes your content calendar.';
    await generateImageWithGuardrails(
      env,
      'user-1',
      null,
      {
        prompt: 'plated meal on linen, restaurant kitchen background',
        negativePrompt: 'people',
      },
      { caption: saasCaption },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Forbidden food words got swapped because the caption sniffed
    // tech-saas-agency.
    expect(body.prompt.toLowerCase()).not.toMatch(/\bplated meal\b/);
    // Negative prompt picked up the SaaS avoid-list.
    expect(body.negative_prompt.toLowerCase()).toContain('food');
  });

  it('NULL archetype + non-distinctive caption → guardrails do not fire (no false-positive swap)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({ userArchetype: null, photoUrls: [] });
    await generateImageWithGuardrails(
      env,
      'user-1',
      null,
      {
        prompt: 'an overhead flatlay of an open notebook and a mug',
        negativePrompt: 'people',
      },
      { caption: 'come say hi' }, // no archetype keywords
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toContain('overhead flatlay');
  });

  it('client archetype WINS over user archetype (agency multi-tenant case)', async () => {
    // SaaS agency owner running a food-restaurant client: prompt is a
    // food scene, so it should pass through unmodified (client tier wins,
    // food-restaurant has no `food` in its forbidden regex).
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({
      userArchetype: 'tech-saas-agency',
      clientArchetype: 'food-restaurant',
      photoUrls: [],
    });
    await generateImageWithGuardrails(env, 'user-1', 'client-99', {
      prompt: 'overhead shot of plated pasta with herbs',
      negativePrompt: 'people',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // food-restaurant archetype: NOT in the forbidden regex for that
    // archetype, prompt survives.
    expect(body.prompt.toLowerCase()).toContain('plated pasta');
  });

  it('forceFallback=true picks a curated archetype scene WITHOUT consulting the LLM prompt', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://x' }] }), { status: 200 }),
    );
    const env = makeEnv({ userArchetype: 'tech-saas-agency', photoUrls: [] });
    await generateImageWithGuardrails(
      env,
      'user-1',
      null,
      {
        prompt: 'this prompt should be ignored',
        negativePrompt: 'people',
      },
      { forceFallback: true },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).not.toContain('this prompt should be ignored');
  });
});

// ── Error paths ──────────────────────────────────────────────────────

describe('generateImageWithGuardrails — error handling', () => {
  it('flux-dev 5xx → returns imageUrl=null + logs the error context', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'GPU pool exhausted', message: 'try again' }), { status: 503 }),
    );
    const env = makeEnv({ userArchetype: 'food-restaurant', photoUrls: [] });
    const result = await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'overhead flatlay',
      negativePrompt: 'people',
    });
    expect(result.imageUrl).toBeNull();
    expect(result.modelUsed).toBe('flux-dev');
    // Useful context (status + detail) should make it into the warn log
    // so on-call can grep for "GPU pool exhausted" without re-running.
    const allWarnCalls = warnSpy.mock.calls.flat().join(' ');
    expect(allWarnCalls).toMatch(/flux-dev failed/i);
    expect(allWarnCalls).toMatch(/503/);
    expect(allWarnCalls).toMatch(/GPU pool exhausted/);
  });

  it('flux-dev 400 with no detail → still returns imageUrl=null with "unknown" message', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    const env = makeEnv({ photoUrls: [] });
    const result = await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'x',
      negativePrompt: 'y',
    });
    expect(result.imageUrl).toBeNull();
    const allWarnCalls = warnSpy.mock.calls.flat().join(' ');
    expect(allWarnCalls).toMatch(/unknown/i);
  });

  it('brand-ref DB lookup failure does NOT throw — falls through to flux-dev', async () => {
    // Simulate the photo query crashing. Prepare returns an object whose
    // .all() rejects; the rest of the function should swallow and proceed.
    const env: any = {
      FAL_API_KEY: 'k',
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          const lower = sql.toLowerCase();
          return {
            bind: () => ({
              first: () => Promise.resolve(lower.includes('from users') ? { archetype_slug: 'food-restaurant' } : null),
              all: () => Promise.reject(new Error('D1 down')),
            }),
          };
        }),
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/x' }] }), { status: 200 }),
    );
    const result = await generateImageWithGuardrails(env, 'user-1', null, {
      prompt: 'safe',
      negativePrompt: 'neg',
    });
    expect(result.imageUrl).toBe('https://fal.cdn/x');
    // Used flux-dev (no refs survived the failed lookup).
    expect(result.modelUsed).toBe('flux-dev');
  });
});
