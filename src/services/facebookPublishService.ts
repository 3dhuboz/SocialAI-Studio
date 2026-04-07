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

  /**
   * Discover Instagram Business Account linked to a Facebook Page.
   * Returns the Instagram account ID or null if not linked.
   */
  getInstagramAccount: async (
    pageId: string,
    pageAccessToken: string,
  ): Promise<string | null> => {
    const res = await fetch(`${WORKER}/api/facebook/instagram?pageId=${encodeURIComponent(pageId)}&pageAccessToken=${encodeURIComponent(pageAccessToken)}`);
    const data = await res.json() as any;
    if (data.error) return null;
    return data.instagramAccountId || null;
  },

  /**
   * Publish a photo or Reel to Instagram.
   */
  publishInstagram: async (
    instagramAccountId: string,
    pageAccessToken: string,
    caption: string,
    imageUrl?: string,
    videoUrl?: string,
    mediaType: 'IMAGE' | 'REELS' = 'IMAGE',
  ): Promise<FbPublishResult> => {
    const res = await fetch(`${WORKER}/api/facebook/instagram-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId, pageAccessToken, caption, imageUrl, videoUrl, mediaType }),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) throw new Error(data.error || `Instagram publish failed (${res.status})`);
    return { id: data.id, success: true };
  },

  /**
   * Publish a Facebook Reel.
   */
  publishFacebookReel: async (
    pageId: string,
    pageAccessToken: string,
    description: string,
    videoUrl: string,
  ): Promise<FbPublishResult> => {
    const res = await fetch(`${WORKER}/api/facebook/reel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, pageAccessToken, description, videoUrl }),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) throw new Error(data.error || `Facebook Reel failed (${res.status})`);
    return { id: data.id, success: true };
  },
};
