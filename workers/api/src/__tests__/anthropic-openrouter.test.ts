import { describe, it, expect, vi, afterEach } from 'vitest';
import { callOpenRouter } from '../lib/anthropic';

describe('callOpenRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests JSON mode by default for structured-output callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callOpenRouter('key', 'system', 'user', 0.2, 500);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format for plain-text fallback callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'caption text' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callOpenRouter('key', 'system', 'user', 0.2, 500, { responseFormat: 'text' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
  });
});
