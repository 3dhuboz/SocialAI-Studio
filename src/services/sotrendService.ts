const proxy = async (action: string, params: Record<string, unknown> = {}) => {
  const res = await fetch('/.netlify/functions/sotrender-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    let msg = `Sotrender proxy error ${res.status}`;
    try { const d = await res.json(); msg = d.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
};

export interface SotrendPost {
  message: string;
  created_time: string;
  likes: number;
  comments: number;
  shares: number;
}

export const SotrendService = {
  /** Register a Facebook page with your Sotrender account (one-time per client) */
  addProfile: (facebookPageId: string) =>
    proxy('add-profile', { facebookPageId }),

  /** Search for a Facebook page by name to verify it exists in Sotrender */
  searchProfile: (query: string) =>
    proxy('search-profile', { query }),

  /** Fetch recent posts with engagement data */
  getPosts: async (pageId: string, limit = 30): Promise<SotrendPost[]> => {
    const data = await proxy('get-posts', { pageId, limit });
    const posts = data?.data || data?.posts || [];
    return posts.map((p: any) => ({
      message: p.message || p.text || '',
      created_time: p.published_at || p.created_time || '',
      likes: p.reactions ?? p.likes ?? 0,
      comments: p.comments ?? 0,
      shares: p.shares ?? 0,
    }));
  },

  /** Fetch daily follower/engagement trends */
  getDaily: (pageId: string, since?: string, until?: string) =>
    proxy('get-daily', { pageId, since, until }),

  /** Fetch hourly engagement breakdown (best hours to post) */
  getHourly: (pageId: string, since?: string, until?: string) =>
    proxy('get-hourly', { pageId, since, until }),

  /** Fetch weekday engagement breakdown (best days to post) */
  getWeekdaily: (pageId: string, since?: string, until?: string) =>
    proxy('get-weekdaily', { pageId, since, until }),
};
