export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
  picture?: { data: { url: string } };
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

  getPages: (): Promise<FacebookPage[]> => {
    return new Promise((resolve, reject) => {
      if (!window.FB) return reject(new Error('Facebook SDK not initialized'));
      window.FB.api('/me/accounts', { fields: 'id,name,access_token,category,picture' }, (response: any) => {
        if (response && !response.error) resolve(response.data);
        else reject(response.error || new Error('Failed to fetch pages'));
      });
    });
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
    if (pageData.error) throw new Error(pageData.error.message);

    const insightsRes = await fetch(
      `${base}/${pageId}/insights?metric=page_impressions_unique,page_engaged_users&period=days_28&access_token=${pageAccessToken}`
    );
    const insightsData = await insightsRes.json();

    let reach28d = 0;
    let engagedUsers28d = 0;
    if (insightsData.data) {
      for (const item of insightsData.data) {
        const val = item.values?.[item.values.length - 1]?.value ?? 0;
        if (item.name === 'page_impressions_unique') reach28d = typeof val === 'number' ? val : 0;
        if (item.name === 'page_engaged_users') engagedUsers28d = typeof val === 'number' ? val : 0;
      }
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
