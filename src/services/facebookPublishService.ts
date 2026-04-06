/**
 * Direct Facebook Graph API publishing — replaces Late.dev.
 * Each call uses page-scoped tokens, so cross-posting is impossible.
 */

const WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

export interface FbPublishResult {
  id: string;
  success: boolean;
}

export const FacebookPublishService = {
  /**
   * Publish or schedule a post to a Facebook Page.
   * imageUrl: public URL of the image (not base64)
   * scheduledTime: Unix timestamp for future publish (omit for immediate)
   */
  publish: async (
    pageId: string,
    pageAccessToken: string,
    text: string,
    imageUrl?: string,
    scheduledTime?: number,
  ): Promise<FbPublishResult> => {
    const res = await fetch(`${WORKER}/api/facebook/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, pageAccessToken, text, imageUrl, scheduledTime }),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) throw new Error(data.error || `Facebook publish failed (${res.status})`);
    return { id: data.id, success: true };
  },

  /**
   * Fetch published posts from a Facebook Page.
   */
  getPublishedPosts: async (
    pageId: string,
    pageAccessToken: string,
  ): Promise<{ message: string; created_time: string; full_picture?: string }[]> => {
    const res = await fetch(`${WORKER}/api/facebook/posts?pageId=${encodeURIComponent(pageId)}&pageAccessToken=${encodeURIComponent(pageAccessToken)}`);
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error);
    return data.posts || [];
  },
};
