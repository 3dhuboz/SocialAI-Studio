export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
  picture?: { data: { url: string } };
}

export interface ExchangeResult {
  pages: FacebookPage[];
  longLivedUserToken: string;
  expiresIn: number;           // seconds, ~5_184_000 (60 days)
  pageTokensNeverExpire: boolean;
}

export const FacebookService = {
  init: (appId: string): Promise<void> => {
    return new Promise((resolve) => {
      const doInit = () => {
        window.FB.init({ appId, cookie: true, xfbml: true, version: 'v21.0' });
        resolve();
      };
      if (window.FB) { doInit(); return; }
      window.fbAsyncInit = doInit;
      if (!document.querySelector('script[src*="connect.facebook.net"]')) {
        const script = document.createElement('script');
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.defer = true;
        document.body.appendChild(script);
      }
    });
  },

  login: (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!window.FB) return reject(new Error('Facebook SDK not initialized'));
      window.FB.login((response: any) => {
        if (response.authResponse) resolve(response.authResponse);
        else reject(new Error('User cancelled login or did not fully authorize.'));
      }, { scope: 'pages_show_list,pages_read_engagement,pages_manage_posts' });
    });
  },

  /** Get the current short-lived user access token from the FB SDK auth response */
  getUserAccessToken: (): string | null => {
    if (!window.FB) return null;
    const auth = window.FB.getAuthResponse();
    return auth?.accessToken ?? null;
  },

  /**
   * Exchange the short-lived user token for permanent page tokens via the
   * Netlify serverless function (keeps App Secret off the client).
   * Page tokens derived from a long-lived user token never expire.
   */
  exchangeForLongLivedPages: async (shortLivedToken: string): Promise<ExchangeResult> => {
    const res = await fetch('/api/facebook-exchange-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: shortLivedToken }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Token exchange failed');
    }
    return data as ExchangeResult;
  },

  /** Fallback: fetch pages directly with the short-lived token (tokens expire in ~1h) */
  getPages: (): Promise<FacebookPage[]> => {
    return new Promise((resolve, reject) => {
      if (!window.FB) return reject(new Error('Facebook SDK not initialized'));
      window.FB.api('/me/accounts', { fields: 'id,name,access_token,category,picture' }, (response: any) => {
        if (response && !response.error) resolve(response.data);
        else reject(response.error || new Error('Failed to fetch pages'));
      });
    });
  },

  getPagesByToken: async (accessToken: string): Promise<FacebookPage[]> => {
    const base = 'https://graph.facebook.com/v21.0';
    const res = await fetch(`${base}/me/accounts?fields=id,name,access_token,category,picture&access_token=${accessToken}`);
    const data = await res.json();

    if (data.error) {
      const code = data.error.code;
      const msg: string = data.error.message || 'Unknown error';

      // Error 100 "nonexisting field (accounts)" means this is a Page Access Token,
      // not a User Access Token. Fall back to using it directly as a page token.
      if (code === 100 && msg.includes('accounts')) {
        const pageRes = await fetch(`${base}/me?fields=id,name,category,picture&access_token=${accessToken}`);
        const pageData = await pageRes.json();
        if (pageData.error) throw new Error('This appears to be a Page Access Token but could not retrieve page info. Make sure the token has pages_show_list, pages_manage_posts and pages_read_engagement permissions.');
        // When the token IS the page token, access_token = the supplied token itself
        return [{
          id: pageData.id,
          name: pageData.name,
          access_token: accessToken,
          category: pageData.category || 'Page',
          picture: pageData.picture,
        }];
      }

      if (msg.includes('Invalid OAuth') || msg.includes('token') || code === 190) {
        throw new Error('Invalid or expired access token. Generate a fresh token from Facebook Graph Explorer.');
      }
      throw new Error(msg);
    }

    if (!data.data || data.data.length === 0) throw new Error('No Pages found for this token. Make sure you are an admin of the Facebook Page and generated the token with pages_show_list permission.');
    return data.data as FacebookPage[];
  },

  getPageStats: async (pageId: string, pageAccessToken: string): Promise<{
    fanCount: number;
    followersCount: number;
    reach28d: number;
    engagedUsers28d: number;
    engagementRate: number;
  }> => {
    const base = 'https://graph.facebook.com/v21.0';
    const pageRes = await fetch(`${base}/${pageId}?fields=fan_count,followers_count&access_token=${pageAccessToken}`);
    const pageData = await pageRes.json();
    // Codes 10 / 200: permission not granted or requires App Review — degrade silently
    if (pageData.error) {
      const code = pageData.error.code;
      if (code === 10 || code === 200 || code === 190) {
        return { fanCount: 0, followersCount: 0, reach28d: 0, engagedUsers28d: 0, engagementRate: 0 };
      }
      throw new Error(pageData.error.message);
    }

    // Insights require read_insights permission (needs Facebook App Review).
    // Gracefully degrade to zeros if unavailable rather than surfacing an error.
    let reach28d = 0;
    let engagedUsers28d = 0;
    try {
      const insightsRes = await fetch(
        `${base}/${pageId}/insights?metric=page_impressions_unique,page_engaged_users&period=days_28&access_token=${pageAccessToken}`
      );
      const insightsData = await insightsRes.json();
      if (insightsData.data && !insightsData.error) {
        for (const item of insightsData.data) {
          const val = item.values?.[item.values.length - 1]?.value ?? 0;
          if (item.name === 'page_impressions_unique') reach28d = typeof val === 'number' ? val : 0;
          if (item.name === 'page_engaged_users') engagedUsers28d = typeof val === 'number' ? val : 0;
        }
      }
    } catch {
      // Insights unavailable — continue with zeros
    }

    const engagementRate = reach28d > 0 ? Math.round((engagedUsers28d / reach28d) * 1000) / 10 : 0;

    return {
      fanCount: pageData.fan_count || 0,
      followersCount: pageData.followers_count || pageData.fan_count || 0,
      reach28d,
      engagedUsers28d,
      engagementRate,
    };
  },

  getRecentPosts: async (pageId: string, pageAccessToken: string, limit = 25): Promise<Array<{
    message: string;
    created_time: string;
    likes: number;
    comments: number;
    shares: number;
  }>> => {
    const base = 'https://graph.facebook.com/v21.0';
    const fields = 'message,created_time,likes.summary(true),comments.summary(true),shares';
    const res = await fetch(
      `${base}/${pageId}/posts?fields=${fields}&limit=${limit}&access_token=${pageAccessToken}`
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return (data.data || []).map((p: any) => ({
      message: p.message || '',
      created_time: p.created_time || '',
      likes: p.likes?.summary?.total_count || 0,
      comments: p.comments?.summary?.total_count || 0,
      shares: p.shares?.count || 0,
    }));
  },

  postToPageDirect: async (pageId: string, pageAccessToken: string, message: string, imageBase64?: string): Promise<string> => {
    const base = 'https://graph.facebook.com/v21.0';
    if (imageBase64 && imageBase64.startsWith('data:image/')) {
      const [header, b64data] = imageBase64.split(',');
      const mimeMatch = header.match(/data:(image\/[^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const bytes = Uint8Array.from(atob(b64data), c => c.charCodeAt(0));
      const form = new FormData();
      form.append('source', new Blob([bytes], { type: mimeType }), 'post.jpg');
      form.append('message', message);
      form.append('access_token', pageAccessToken);
      form.append('published', 'true');
      const res = await fetch(`${base}/${pageId}/photos`, { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.post_id || data.id;
    }
    const res = await fetch(`${base}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: pageAccessToken }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
  },
};

declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}
