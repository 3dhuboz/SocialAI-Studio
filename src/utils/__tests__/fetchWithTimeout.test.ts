import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchBlobWithTimeout,
  fetchJsonWithTimeout,
  RequestTimeoutError,
} from '../fetchWithTimeout';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
  it('aborts a request and reports the operation when its deadline expires', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      })
    )));

    const request = fetchJsonWithTimeout(
      'https://example.com/slow',
      {},
      100,
      'Reel progress check',
    );
    const rejection = expect(request).rejects.toEqual(
      expect.objectContaining<RequestTimeoutError>({
        name: 'RequestTimeoutError',
        message: 'Reel progress check timed out after 100ms.',
      }),
    );

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it('returns parsed JSON together with its response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    const result = await fetchJsonWithTimeout<{ ready: boolean }>(
      'https://example.com/status',
      {},
      1000,
      'Status',
    );

    expect(result.response.status).toBe(200);
    expect(result.data).toEqual({ ready: true });
  });

  it('returns downloaded media as a blob', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Blob(['video'], { type: 'video/mp4' }), { status: 200 }),
    ));

    const result = await fetchBlobWithTimeout(
      'https://v3b.fal.media/reel.mp4',
      {},
      1000,
      'Reel download',
    );

    expect(result.data.type).toBe('video/mp4');
    expect(result.data.size).toBeGreaterThan(0);
  });
});
