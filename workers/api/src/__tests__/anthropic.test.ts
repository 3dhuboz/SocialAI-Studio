/**
 * Unit tests for workers/api/src/lib/anthropic.ts — the direct-Anthropic
 * and OpenRouter HTTP wrappers.
 *
 * Mocks global fetch. Locks the request-shape guarantees that downstream
 * callers (lib/critique.ts, routes/ai.ts, route handlers in posts.ts)
 * rely on:
 *
 *   - 1-hour cache TTL beta header is set
 *   - cached prefix goes in a `cache_control: { type: 'ephemeral', ttl: '1h' }`
 *     content block on the user message
 *   - JSON-mode appends the "return ONLY valid JSON" suffix to the system prompt
 *   - 5xx / 429 throw with status + body context so callers can log
 *   - response text is extracted from the `content[].text` blocks
 *
 * Why HTTP-level mock (not a fake `fetch` library): these are tiny
 * wrappers — the only behaviour worth testing IS the request body and
 * the error handling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callAnthropicDirect, callAnthropicVision, callOpenRouter } from '../lib/anthropic';

// Track every fetch the wrapper makes so assertions can read URL + body.
let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ─── callAnthropicDirect ────────────────────────────────────────────────

describe('callAnthropicDirect — happy path', () => {
  it('returns concatenated text + usage from the Anthropic Messages response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          { type: 'text', text: 'Hello, ' },
          { type: 'text', text: 'world.' },
        ],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 8 },
      }),
    );
    const out = await callAnthropicDirect({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5',
      prompt: 'hi',
      temperature: 0.2,
      maxTokens: 100,
      responseFormat: 'text',
    });
    expect(out.text).toBe('Hello, world.');
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 8 });
  });

  it('POSTs to https://api.anthropic.com/v1/messages with anthropic-version + extended-cache-ttl beta headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      prompt: 'x',
      temperature: 0,
      maxTokens: 1,
      responseFormat: 'text',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-beta']).toBe('extended-cache-ttl-2025-04-11');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('passes through model + temperature + max_tokens to the request body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'k',
      model: 'claude-sonnet-4',
      prompt: 'hi',
      temperature: 0.5,
      maxTokens: 250,
      responseFormat: 'text',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-4');
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(250);
  });
});

describe('callAnthropicDirect — system prompt + JSON mode', () => {
  it('puts systemPrompt at top-level `system` (Anthropic format) — NOT in messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      systemPrompt: 'You are a classifier.',
      prompt: 'hi',
      temperature: 0,
      maxTokens: 10,
      responseFormat: 'text',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toBe('You are a classifier.');
    expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });

  it('appends the JSON-mode suffix to the system prompt when responseFormat=json', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: '{}' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      systemPrompt: 'You return JSON.',
      prompt: 'x',
      temperature: 0,
      maxTokens: 10,
      responseFormat: 'json',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toContain('You return JSON.');
    expect(body.system.toLowerCase()).toContain('return only valid json');
    expect(body.system.toLowerCase()).toContain('no prose');
  });

  it('JSON-mode without an existing systemPrompt still adds the suffix', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: '{}' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      prompt: 'x',
      temperature: 0,
      maxTokens: 10,
      responseFormat: 'json',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system.toLowerCase()).toContain('return only valid json');
  });
});

describe('callAnthropicDirect — cachedPrefix / prompt caching', () => {
  it('puts cached prefix in a content block with cache_control ephemeral 1h TTL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      cachedPrefix: 'BRAND CONTEXT: 5KB of stuff…',
      prompt: 'Now generate a post.',
      temperature: 0,
      maxTokens: 10,
      responseFormat: 'text',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(1);
    const userMsg = body.messages[0];
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    // Two blocks: cached prefix + user prompt.
    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[0].type).toBe('text');
    expect(userMsg.content[0].text).toBe('BRAND CONTEXT: 5KB of stuff…');
    expect(userMsg.content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(userMsg.content[1]).toEqual({ type: 'text', text: 'Now generate a post.' });
  });

  it('without cachedPrefix, message content is a plain string (legacy path)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicDirect({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      prompt: 'just a prompt',
      temperature: 0,
      maxTokens: 10,
      responseFormat: 'text',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe('just a prompt');
  });
});

describe('callAnthropicDirect — error paths', () => {
  it('throws on 5xx with status + body context', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('upstream overloaded', { status: 503 }),
    );
    await expect(
      callAnthropicDirect({
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        prompt: 'x',
        temperature: 0,
        maxTokens: 10,
        responseFormat: 'text',
      }),
    ).rejects.toThrow(/Anthropic 503/);
  });

  it('throws on 429 rate-limit with body context', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429 }),
    );
    await expect(
      callAnthropicDirect({
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        prompt: 'x',
        temperature: 0,
        maxTokens: 10,
        responseFormat: 'text',
      }),
    ).rejects.toThrow(/Anthropic 429.*rate_limit_error/);
  });

  it('throws on 400 with the error body truncated to 300 chars', async () => {
    const longBody = 'a'.repeat(500);
    fetchMock.mockResolvedValueOnce(new Response(longBody, { status: 400 }));
    try {
      await callAnthropicDirect({
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        prompt: 'x',
        temperature: 0,
        maxTokens: 10,
        responseFormat: 'text',
      });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e.message).toMatch(/Anthropic 400/);
      // Body slice is 300 chars + the "Anthropic 400: " prefix.
      expect(e.message.length).toBeLessThan(longBody.length + 50);
    }
  });
});

// ─── callAnthropicVision ────────────────────────────────────────────────

describe('callAnthropicVision', () => {
  it('sends an image content block with type=image, source=url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicVision({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      systemPrompt: 'critique this',
      prompt: 'is it good?',
      imageUrl: 'https://images.example.com/foo.jpg',
      temperature: 0.1,
      maxTokens: 200,
      responseFormat: 'text',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content = body.messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'image', source: { type: 'url', url: 'https://images.example.com/foo.jpg' } });
    expect(content[1]).toEqual({ type: 'text', text: 'is it good?' });
  });

  it('JSON mode appends suffix to system prompt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: '{}' }], usage: {} }));
    await callAnthropicVision({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      systemPrompt: 'score it',
      prompt: 'rate 1-10',
      imageUrl: 'https://x/y.jpg',
      temperature: 0,
      maxTokens: 50,
      responseFormat: 'json',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toContain('score it');
    expect(body.system.toLowerCase()).toContain('return only valid json');
  });

  it('does NOT set the extended-cache-ttl beta header (vision calls are not cached)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    await callAnthropicVision({
      apiKey: 'k',
      model: 'claude-haiku-4-5',
      systemPrompt: 's',
      prompt: 'p',
      imageUrl: 'https://x/y.jpg',
      temperature: 0,
      maxTokens: 10,
      responseFormat: 'text',
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['anthropic-beta']).toBeUndefined();
  });

  it('throws on 5xx with vision-specific error message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('server died', { status: 502 }));
    await expect(
      callAnthropicVision({
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        systemPrompt: 's',
        prompt: 'p',
        imageUrl: 'https://x/y.jpg',
        temperature: 0,
        maxTokens: 10,
        responseFormat: 'text',
      }),
    ).rejects.toThrow(/Anthropic vision 502/);
  });

  it('throws on 429 rate-limit', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
    await expect(
      callAnthropicVision({
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        systemPrompt: 's',
        prompt: 'p',
        imageUrl: 'https://x/y.jpg',
        temperature: 0,
        maxTokens: 10,
        responseFormat: 'text',
      }),
    ).rejects.toThrow(/Anthropic vision 429/);
  });
});

// ─── callOpenRouter ─────────────────────────────────────────────────────

describe('callOpenRouter', () => {
  it('POSTs to https://openrouter.ai/api/v1/chat/completions with bearer auth + referer headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    );
    await callOpenRouter('k-test', 'sys', 'user', 0.2, 100);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer k-test');
    expect(init.headers['HTTP-Referer']).toBe('https://socialaistudio.au');
    expect(init.headers['X-Title']).toBe('SocialAI Studio');
  });

  it('always uses anthropic/claude-haiku-4.5 model + json_object response format', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{}' } }] }),
    );
    await callOpenRouter('k', 's', 'u', 0.1, 50);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('anthropic/claude-haiku-4.5');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(50);
  });

  it('extracts text from choices[0].message.content', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"reasoning":"because"}' } }] }),
    );
    const out = await callOpenRouter('k', 's', 'u', 0.1, 50);
    expect(out.text).toBe('{"reasoning":"because"}');
  });

  it('returns empty string when the response has no choices (defensive)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    const out = await callOpenRouter('k', 's', 'u', 0.1, 50);
    expect(out.text).toBe('');
  });

  it('throws on 5xx with body context', async () => {
    fetchMock.mockResolvedValueOnce(new Response('internal error', { status: 500 }));
    await expect(callOpenRouter('k', 's', 'u', 0.1, 50)).rejects.toThrow(/OpenRouter 500/);
  });

  it('throws on 429 rate-limit', async () => {
    fetchMock.mockResolvedValueOnce(new Response('too many requests', { status: 429 }));
    await expect(callOpenRouter('k', 's', 'u', 0.1, 50)).rejects.toThrow(/OpenRouter 429/);
  });
});
