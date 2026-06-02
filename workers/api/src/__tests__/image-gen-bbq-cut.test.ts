import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImageWithGuardrails } from '../lib/image-gen';

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as any;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeEnv(): any {
  const prepare = vi.fn().mockImplementation((sql: string) => {
    const lower = sql.toLowerCase();
    return {
      bind: () => ({
        first: () => {
          if (lower.includes('from clients')) return Promise.resolve({ archetype_slug: 'bbq-smokehouse' });
          if (lower.includes('from users')) return Promise.resolve({ archetype_slug: 'bbq-smokehouse' });
          return Promise.resolve(null);
        },
        all: () => Promise.resolve({ results: [] }),
        run: () => Promise.resolve(),
      }),
    };
  });

  return {
    FAL_API_KEY: 'fal-test-key',
    DB: { prepare },
  };
}

describe('BBQ cut-accuracy image generation', () => {
  it('routes brisket posts to nano-banana-pro with cut-anatomy instructions', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/brisket.png' }] }), { status: 200 }),
    );

    const result = await generateImageWithGuardrails(makeEnv(), 'user-1', 'hughesq-001', {
      prompt: 'close-up of slow-smoked brisket bark on a butcher board, smoke trail behind',
      negativePrompt: 'people',
    }, {
      caption: 'Our smoked brisket gets 12+ hours in the pit.',
      seedHint: 'post-brisket-1',
    });

    expect(result.imageUrl).toBe('https://fal.cdn/brisket.png');
    expect(result.modelUsed).toBe('nano-banana-pro-bbq-cut');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/gemini-3-pro-image-preview');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt.toLowerCase()).toContain('flat-and-point');
    expect(body.prompt.toLowerCase()).toContain('smoke ring');
    expect(body.prompt.toLowerCase()).toContain('fat cap');
    expect(body.prompt.toLowerCase()).toContain('bolar blade');
    expect(body.aspect_ratio).toBe('1:1');
  });

  it('falls back to flux-dev with the refined prompt if nano-banana-pro fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'provider unavailable' }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/flux-brisket.png' }] }), { status: 200 }),
      );

    const result = await generateImageWithGuardrails(makeEnv(), 'user-1', 'hughesq-001', {
      prompt: 'brisket bark on a board',
      negativePrompt: 'people',
    }, {
      caption: 'Low and slow brisket, sliced fresh.',
      seedHint: 'post-brisket-2',
    });

    expect(result.imageUrl).toBe('https://fal.cdn/flux-brisket.png');
    expect(result.modelUsed).toBe('flux-dev');
    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/gemini-3-pro-image-preview');
    expect(fetchMock.mock.calls[1][0]).toBe('https://fal.run/fal-ai/flux/dev');
    const fluxBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fluxBody.prompt.toLowerCase()).toContain('flat-and-point');
    expect(fluxBody.negative_prompt.toLowerCase()).toContain('chuck roast');
  });
});
