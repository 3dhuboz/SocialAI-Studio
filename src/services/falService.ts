const PROXY = '/.netlify/functions/fal-proxy';

const proxyHeaders = () => {
  const key = localStorage.getItem('sai_fal_key');
  return {
    'Content-Type': 'application/json',
    ...(key ? { 'X-Fal-Key': key } : {}),
  };
};

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
      headers: proxyHeaders(),
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
        { headers: proxyHeaders() },
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
      onProgress?.(poll.progress ?? Math.min(0.9, (i + 1) / 40));
    }
    throw new Error('Video generation timed out — try again');
  },

  isConfigured: () => !!localStorage.getItem('sai_fal_key'),
};
