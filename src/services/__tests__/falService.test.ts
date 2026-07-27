import { afterEach, describe, it, expect, vi } from 'vitest';
import { FalService, extractCompletedFalVideoUrl } from '../falService';
import { setGeminiAuth } from '../gemini';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractCompletedFalVideoUrl', () => {
  it('accepts the task-result shapes returned by the worker proxy', () => {
    expect(extractCompletedFalVideoUrl({ video: { url: 'https://cdn/video.mp4' } })).toBe('https://cdn/video.mp4');
    expect(extractCompletedFalVideoUrl({ output: { video: { url: 'https://cdn/output-video.mp4' } } })).toBe('https://cdn/output-video.mp4');
    expect(extractCompletedFalVideoUrl({ output: ['https://cdn/array-video.mp4'] })).toBe('https://cdn/array-video.mp4');
  });

  it('returns null when the completed task has no usable URL', () => {
    expect(extractCompletedFalVideoUrl({ output: [] })).toBeNull();
    expect(extractCompletedFalVideoUrl({})).toBeNull();
  });
});

describe('persistGeneratedVideo', () => {
  it('copies an approved fal.ai result into the authenticated reel upload path', async () => {
    setGeminiAuth(async () => 'test-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        new Blob(['generated-reel'], { type: 'video/mp4' }),
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ url: 'https://media.socialaistudio.au/reels/saved.mp4' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await FalService.persistGeneratedVideo(
      'https://v3b.fal.media/files/reel.mp4',
      'client-123',
    );

    expect(result).toBe('https://media.socialaistudio.au/reels/saved.mp4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/reel-media/uploads');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token',
        'Content-Type': 'video/mp4',
        'X-Client-Id': 'client-123',
      }),
    }));
  });

  it('rejects media from an unapproved host before downloading it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      FalService.persistGeneratedVideo('https://example.com/not-fal.mp4'),
    ).rejects.toThrow(/approved fal\.ai media host/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
