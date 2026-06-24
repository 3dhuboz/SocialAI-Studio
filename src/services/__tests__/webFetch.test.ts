import { describe, it, expect } from 'vitest';
import { fetchUrlContent, setGeminiAuth } from '../gemini';

describe('fetchUrlContent', () => {
  it('uses the authenticated worker web-fetch route', async () => {
    setGeminiAuth(async () => 'test-ai-token');
    const originalFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({ text: 'page copy' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const text = await fetchUrlContent('https://example.com');
      expect(text).toBe('page copy');
      expect(String(calls[0][0])).toContain('/api/ai/web-fetch');
      expect((calls[0][1]?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect((calls[0][1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-ai-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
