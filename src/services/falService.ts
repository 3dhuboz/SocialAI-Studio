import { aiAuthHeaders, buildSafeImagePromptClient } from './gemini';
import { fetchBlobWithTimeout, fetchJsonWithTimeout } from '../utils/fetchWithTimeout';

const WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';
const PROXY = `${WORKER}/api/fal-proxy`;
const VIDEO_START_TIMEOUT_MS = 30_000;
const VIDEO_POLL_TIMEOUT_MS = 20_000;
const VIDEO_RESULT_TIMEOUT_MS = 30_000;
const VIDEO_TRANSFER_TIMEOUT_MS = 90_000;
const IMAGE_GENERATION_TIMEOUT_MS = 120_000;
const MAX_REEL_UPLOAD_BYTES = 95 * 1024 * 1024;

// /api/fal-proxy now requires Clerk JWT or Portal token. Reuse the gemini auth
// header builder so all callers stay in sync. Server uses its own FAL_API_KEY,
// so X-Fal-Key from localStorage is no longer accepted (security).
const proxyHeaders = () => aiAuthHeaders();

export function extractCompletedFalVideoUrl(payload: any): string | null {
  const candidates = [
    payload?.video?.url,
    payload?.output?.video?.url,
    Array.isArray(payload?.output) ? payload.output[0] : null,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found || null;
}

export const FalService = {
  /**
   * Generate a short vertical reel from an image + text prompt via fal.ai (Kling v1.6).
   * Polls every 5 s until SUCCEEDED or FAILED (max ~4 min).
   * Returns the public video URL.
   */
  generateVideo: async (
    promptText: string,
    promptImage: string,
    duration: 5 | 10 = 5,
    onProgress?: (pct: number) => void,
  ): Promise<string> => {
    const { response: res, data } = await fetchJsonWithTimeout<any>(
      `${PROXY}?action=generate-video`,
      {
        method: 'POST',
        headers: await proxyHeaders(),
        body: JSON.stringify({ promptText, promptImage, duration }),
      },
      VIDEO_START_TIMEOUT_MS,
      'Starting reel generation',
    );
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to start video generation');
    const { requestId, statusUrl, responseUrl } = data;
    if (!requestId) throw new Error('No request ID returned from fal.ai');

    // Build poll query — include fal.ai's own status_url to avoid URL construction issues
    const pollQuery = new URLSearchParams({ action: 'task-status', requestId });
    if (statusUrl) pollQuery.set('statusUrl', statusUrl);
    if (responseUrl) pollQuery.set('responseUrl', responseUrl);

    // Poll every 6 s, up to 40 attempts (~4 min)
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 6000));
      const { response: pollRes, data: poll } = await fetchJsonWithTimeout<any>(
        `${PROXY}?${pollQuery.toString()}`,
        { headers: await proxyHeaders() },
        VIDEO_POLL_TIMEOUT_MS,
        'Checking reel progress',
      );
      if (!pollRes.ok || poll.error) {
        throw new Error(poll.error || `Reel progress check failed (${pollRes.status})`);
      }

      if (poll.status === 'SUCCEEDED' || poll.status === 'COMPLETED') {
        const resultQuery = new URLSearchParams({ action: 'task-result', requestId });
        const { response: resultRes, data: result } = await fetchJsonWithTimeout<any>(
          `${PROXY}?${resultQuery.toString()}`,
          { headers: await proxyHeaders() },
          VIDEO_RESULT_TIMEOUT_MS,
          'Loading the finished reel',
        );
        if (!resultRes.ok || result.error) throw new Error(result.error || 'Failed to load completed video');
        const url = extractCompletedFalVideoUrl(result);
        if (!url) throw new Error('No video URL in completed task');
        onProgress?.(1);
        return url;
      }
      if (poll.status === 'FAILED') {
        throw new Error(poll.failure || 'Video generation failed');
      }
      // Smoothly increment: IN_QUEUE stays low, IN_PROGRESS climbs toward 90%
      const base = poll.status === 'IN_QUEUE' ? 0.05 : 0.15;
      onProgress?.(Math.min(0.9, base + (i / 40) * (1 - base)));
    }
    throw new Error('Video generation timed out — try again');
  },

  /**
   * Copy a temporary fal.ai result into the authenticated R2 upload path.
   * This preserves the exact reel the user previewed for later publishing.
   */
  persistGeneratedVideo: async (
    sourceUrl: string,
    clientId?: string | null,
  ): Promise<string> => {
    const source = new URL(sourceUrl);
    if (source.protocol !== 'https:' || !(source.hostname === 'fal.media' || source.hostname.endsWith('.fal.media'))) {
      throw new Error('Generated reel URL was not from the approved fal.ai media host.');
    }

    const { response: sourceRes, data: videoBlob } = await fetchBlobWithTimeout(
      sourceUrl,
      { method: 'GET' },
      VIDEO_TRANSFER_TIMEOUT_MS,
      'Downloading the generated reel',
    );
    if (!sourceRes.ok) throw new Error(`Generated reel download failed (${sourceRes.status})`);
    if (!videoBlob.size) throw new Error('Generated reel download was empty.');
    if (videoBlob.size > MAX_REEL_UPLOAD_BYTES) {
      throw new Error('Generated reel is too large to save (95 MB maximum).');
    }

    const headers = await proxyHeaders();
    headers['Content-Type'] = videoBlob.type || 'video/mp4';
    headers['X-Reel-Size'] = String(videoBlob.size);
    headers['X-Reel-Filename'] = encodeURIComponent('generated-reel.mp4');
    if (clientId) headers['X-Client-Id'] = clientId;

    const { response: uploadRes, data } = await fetchJsonWithTimeout<{ url?: string; error?: string }>(
      `${WORKER}/api/reel-media/uploads`,
      {
        method: 'POST',
        headers,
        body: videoBlob,
      },
      VIDEO_TRANSFER_TIMEOUT_MS,
      'Saving the generated reel',
    );
    if (!uploadRes.ok || data.error || !data.url) {
      throw new Error(data.error || `Generated reel could not be saved (${uploadRes.status})`);
    }
    return data.url;
  },

  /**
   * Generate a reviewed marketing image. Returns a public image URL.
   *
   * Routes through the worker's fal-proxy which applies archetype guardrails,
   * the configured primary provider, retry logic, and the release critic.
   *
   * Optional clientId scopes archetype detection to a specific client
   * workspace — agency users get the correct per-client archetype guardrails.
   */
  generateImage: async (
    prompt: string,
    businessType: string = 'small business',
    clientId?: string | null,
  ): Promise<{ url: string; model: string }> => {
    const safe = buildSafeImagePromptClient(prompt, businessType);
    if (!safe) throw new Error('Cannot generate image: prompt is empty/abstract and no business type to seed a fallback. Open the post and add an image prompt.');
    const { response: res, data } = await fetchJsonWithTimeout<any>(
      `${PROXY}?action=generate-image`,
      {
        method: 'POST',
        headers: await proxyHeaders(),
        body: JSON.stringify({ prompt: safe.prompt, negativePrompt: safe.negativePrompt, clientId: clientId || null }),
      },
      IMAGE_GENERATION_TIMEOUT_MS,
      'Preparing the reel start frame',
    );
    if (!res.ok || data.error) throw new Error(data.error || 'Image generation failed');
    if (!data.imageUrl) throw new Error('No image URL returned from fal.ai');
    return { url: data.imageUrl, model: data.model_used || 'configured-image-provider' };
  },

  isConfigured: () => true, // FAL_API_KEY is configured server-side in Cloudflare env
};
