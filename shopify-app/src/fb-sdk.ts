// Facebook JavaScript SDK loader + login helper for the embedded Shopify app.
//
// The SDK is lazy-loaded on first call to initFB() so the SocialAI Studio
// home/products/compose/calendar surfaces don't pay the ~110 KB JS cost
// just to render. Once Settings → Connect Facebook is clicked we inject the
// `<script>` tag, await `window.fbAsyncInit`, then resolve.
//
// ── App ID ────────────────────────────────────────────────────────────────
// FB_APP_ID is a PUBLIC value — it shows up in network requests and in the
// HTML meta tag of every embedded-app load anyway. Same app that the main
// SocialAI Studio frontend uses (src/client.config.ts → facebookAppId).
//
// ── Embedded-iframe gotchas ───────────────────────────────────────────────
//  • FB.login MUST be invoked from a user gesture (button onClick) — browsers
//    block popups from inside iframes otherwise.
//  • The embedded app's hosting origin (app.socialaistudio.au — the public
//    custom domain that fronts the socialai-shopify Pages project) needs to
//    be on the FB App's Allowed Domains list. If FB.login returns
//    `status: 'unknown'` immediately, that's the symptom — fix in the FB
//    App Dashboard → Settings → Basic → App Domains, AND in Login product →
//    Settings → Valid OAuth Redirect URIs.
//  • Cookies must be allowed in third-party context. Most modern browsers
//    block 3rd-party cookies by default, so we use cookie: false (and never
//    rely on FB's session cookie persistence — every login is a fresh popup).

const FB_APP_ID = '847198108337884';
const SDK_VERSION = 'v21.0';

// Shopify App Store review is for Facebook Page publishing only. Keep this
// embedded surface to the minimum permissions needed for the listed workflow.
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
].join(',');

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
      login: (
        cb: (response: { authResponse?: { accessToken: string; userID: string; expiresIn: number }; status?: string }) => void,
        opts?: { scope?: string; return_scopes?: boolean },
      ) => void;
      logout: (cb: () => void) => void;
      getAuthResponse: () => { accessToken: string; userID: string } | null;
      api: (path: string, params: Record<string, unknown>, cb: (response: any) => void) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let initPromise: Promise<void> | null = null;

/** Load + init the FB JS SDK. Idempotent — subsequent calls reuse the same Promise. */
export function initFB(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    const doInit = () => {
      try {
        if (!window.FB) {
          reject(new Error('FB SDK loaded but window.FB is missing'));
          return;
        }
        // cookie: false — embedded iframes are 3rd-party context, and we don't
        // rely on FB session persistence anyway. xfbml: false — no <fb:*> tags
        // in this app, skip the DOM scan.
        window.FB.init({ appId: FB_APP_ID, cookie: false, xfbml: false, version: SDK_VERSION });
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    if (window.FB) { doInit(); return; }

    window.fbAsyncInit = doInit;

    // Inject the script only once. fbAsyncInit fires after load.
    if (!document.querySelector('script[data-fb-sdk]')) {
      const script = document.createElement('script');
      script.src = `https://connect.facebook.net/en_US/sdk.js`;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.dataset.fbSdk = '1';
      script.onerror = () => reject(new Error('Failed to load Facebook SDK — check network / ad-blocker'));
      document.body.appendChild(script);
    }

    // Safety timeout — if the SDK hasn't booted in 15s, surface a clear error
    // rather than spinning forever.
    setTimeout(() => {
      if (!window.FB) reject(new Error('Facebook SDK timed out after 15s'));
    }, 15_000);
  });

  return initPromise;
}

export interface FBLoginResult {
  accessToken: string;
  userId: string;
  expiresIn: number;
}

/** Prompt the merchant to log in. MUST be called from a user gesture (onClick). */
export function loginFB(): Promise<FBLoginResult> {
  return new Promise((resolve, reject) => {
    if (!window.FB) return reject(new Error('FB SDK not initialized — call initFB() first'));
    window.FB.login(
      (response) => {
        if (response.authResponse) {
          resolve({
            accessToken: response.authResponse.accessToken,
            userId: response.authResponse.userID,
            expiresIn: response.authResponse.expiresIn,
          });
        } else if (response.status === 'unknown') {
          // Most common cause: embedded-app origin not on the FB App's
          // Allowed Domains list. Surface a clear, actionable message.
          reject(new Error('Facebook rejected the login. The embedded app origin may need to be added to your Facebook App\'s Allowed Domains.'));
        } else {
          reject(new Error('User cancelled Facebook login or did not grant the required permissions.'));
        }
      },
      { scope: SCOPES, return_scopes: true },
    );
  });
}
