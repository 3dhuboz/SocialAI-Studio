const PROXY = '/.netlify/functions/runway-proxy';

const proxyHeaders = () => ({
  'Content-Type': 'application/json',
});

export const RunwayService = {
  /**
   * Generate a 5-second vertical reel from an image + text prompt.
   * Polls every 5 s until SUCCEEDED or FAILED (max ~3 min).
   * Returns the public video URL.
   */
  generateVideo: async (
    promptText: string,
    promptImage: string,   // base64 data URL OR public HTTPS URL
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
    const { taskId } = data;
    if (!taskId) throw new Error('No task ID returned from Runway ML');

    // Poll every 5 s, up to 36 attempts (~3 min)
    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch(
        `${PROXY}?action=task-status&taskId=${encodeURIComponent(taskId)}`,
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
        throw new Error(poll.failure || poll.failureCode || 'Video generation failed');
      }
      onProgress?.(poll.progress ?? Math.min(0.9, (i + 1) / 36));
    }
    throw new Error('Video generation timed out — try again');
  },

  /** Returns true if RUNWAY_API_KEY is set in the Netlify env. */
  isConfigured: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${PROXY}?action=task-status&taskId=probe`);
      if (res.status === 500) {
        const d = await res.json();
        if (d.error?.includes('API key not configured')) return false;
      }
      return true;
    } catch {
      return false;
    }
  },
};
