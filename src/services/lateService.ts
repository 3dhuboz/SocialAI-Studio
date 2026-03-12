const PROXY = '/.netlify/functions/late-proxy';

export interface LateProfile {
  id: string;
  title: string;
}

export interface LatePage {
  id: string;
  name: string;
  picture?: string;
}

export interface LatePostResult {
  id: string;
  status: string;
}

export const LateService = {
  /** Create a Late profile for a new client. Returns the profileId. */
  createProfile: async (title: string): Promise<string> => {
    const res = await fetch(`${PROXY}?action=create-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to create profile');
    return data.id as string;
  },

  /**
   * Get a headless OAuth URL for the given platform.
   * The user is redirected to this URL to authorise the connection.
   * After auth, a connect_token is returned via the redirect URL query param.
   */
  getConnectUrl: async (profileId: string, platform: 'facebook' | 'instagram', redirectUrl: string): Promise<string> => {
    const params = new URLSearchParams({ action: 'connect-url', profileId, platform, redirectUrl });
    const res = await fetch(`${PROXY}?${params}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to get connect URL');
    return data.authUrl as string;
  },

  /** List Facebook Pages available after OAuth (headless mode). */
  listFacebookPages: async (connectToken: string): Promise<LatePage[]> => {
    const res = await fetch(`${PROXY}?action=list-pages&connectToken=${encodeURIComponent(connectToken)}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to list pages');
    return (data.pages || data) as LatePage[];
  },

  /** Select a specific Facebook Page to connect to the profile. */
  selectFacebookPage: async (connectToken: string, pageId: string): Promise<void> => {
    const res = await fetch(`${PROXY}?action=select-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectToken, pageId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to select page');
  },

  /**
   * Publish a post to one or more platforms.
   * platforms: ['facebook'] | ['instagram'] | ['facebook','instagram']
   */
  post: async (
    profileId: string,
    platforms: ('facebook' | 'instagram')[],
    text: string,
    mediaUrls?: string[],
    scheduleDate?: string,
  ): Promise<LatePostResult> => {
    const res = await fetch(`${PROXY}?action=post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, platforms, text, mediaUrls, scheduleDate }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to publish post');
    return data as LatePostResult;
  },

  /** Get analytics for a profile. */
  getAnalytics: async (profileId: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${PROXY}?action=analytics&profileId=${encodeURIComponent(profileId)}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to get analytics');
    return data;
  },

  /** Get profile info including connected accounts. */
  getProfileInfo: async (profileId: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${PROXY}?action=profile-info&profileId=${encodeURIComponent(profileId)}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to get profile info');
    return data;
  },

  /** Check if the Late proxy is configured (API key present). */
  isConfigured: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${PROXY}?action=profile-info&profileId=test`);
      if (res.status === 500) {
        const d = await res.json();
        if (d.error?.includes('LATE_API_KEY')) return false;
      }
      return true;
    } catch {
      return false;
    }
  },
};
