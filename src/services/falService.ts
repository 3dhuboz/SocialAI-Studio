import { aiAuthHeaders, buildSafeImagePromptClient } from './gemini';

const WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';
const PROXY = `${WORKER}/api/fal-proxy`;

// /api/fal-proxy now requires Clerk JWT or Portal token. Reuse the gemini auth
// header builder so all callers stay in sync. Server uses its own FAL_API_KEY,
// so X-Fal-Key from localStorage is no longer accepted (security).
const proxyHeaders = () => aiAuthHeaders();

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
    const res = await fetch(`${PROXY}?action=generate-video`, {
      method: 'POST',
      headers: await proxyHeaders(),
      body: JSON.stringify({ promptText, promptImage, duration }),
    });
    const data = await res.json();
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
      const pollRes = await fetch(
        `${PROXY}?${pollQuery.toString()}`,
        { headers: await proxyHeaders() },
      );
      const poll = await pollRes.json();

      if (poll.status === 'SUCCEEDED') {
        const url = poll.output?.[0];
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
   * Generate a marketing image via fal.ai FLUX Dev. Returns a public image URL.
   *
   * Routes through the worker's fal-proxy which applies archetype guardrails,
   * negative-prompt safety, and full FLUX-dev quality settings (square_hd,
   * 35 inference steps, guidance_scale 7.0).
   *
   * Optional clientId scopes archetype detection to a specific client
   * workspace — agency users get the correct per-client archetype guardrails.
   */
  generateImage: async (
    prompt: string,
    businessType: string = 'small business',
    clientId?: string | null,
  ): Promise<{ url: string; model: string; referencesUsed: number }> => {
    const safe = buildSafeImagePromptClient(prompt, businessType);
    if (!safe) throw new Error('Cannot generate image: prompt is empty/abstract and no business type to seed a fallback. Open the post and add an image prompt.');
    const res = await fetch(`${PROXY}?action=generate-image`, {
      method: 'POST',
      headers: await proxyHeaders(),
      body: JSON.stringify({ prompt: safe.prompt, negativePrompt: safe.negativePrompt, clientId: clientId || null }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Image generation failed');
    if (!data.imageUrl) throw new Error('No image URL returned from fal.ai');
    return { url: data.imageUrl, model: data.model_used || 'flux-dev', referencesUsed: data.references_used || 0 };
  },

  isConfigured: () => true, // FAL_API_KEY is configured server-side in Cloudflare env
};
