/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  edit this file for each white-label client
 *  Everything here is the ONLY thing you need to change when
 *  deploying a new branded instance of SocialAI Studio.
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  /** Portal slug — leave empty on the main agency site, set per-client on white-label deployments */
  clientId: '',

  appName: 'SocialAI Studio',
  tagline: 'AI-powered social media — done for you',

  defaultBusinessName: 'Penny Wise I.T',
  defaultBusinessType: 'small business',
  defaultLocation: 'Australia',
  defaultTone: 'Friendly and professional',
  defaultDescription: '',

  accentColor: '#f59e0b',

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  /**
   * FACEBOOK APP SETUP (Facebook Login for Business — recommended):
   * 1. Go to developers.facebook.com → Create App → "Business" type
   * 2. Add the "Facebook Login for Business" product (NOT classic Facebook Login)
   * 3. Facebook Login for Business → Configurations → Create new:
   *      - Token type: "User access token" (or "Business Integration System User
   *        access token" for non-expiring tokens — Phase 2)
   *      - Permissions: pages_show_list, pages_manage_posts, pages_read_engagement,
   *        publish_video, instagram_basic, instagram_content_publish, pages_read_user_content
   *      - Asset types: Pages, Instagram Accounts
   *      - Save → copy the Configuration ID
   * 4. Settings → add your domain to Valid OAuth Redirect URIs
   * 5. App Review: get Advanced Access for each permission above
   * 6. Toggle "Live" once approved
   * 7. Copy your App ID into facebookAppId and Configuration ID into
   *    facebookLoginConfigId (or set VITE_FACEBOOK_LOGIN_CONFIG_ID in CF Pages env)
   *
   * UPGRADE FROM CLASSIC: if facebookLoginConfigId is empty, the Connect button
   * falls back to legacy scope-based FB.login() — still works, but customers see
   * the old per-permission checkbox dialog instead of the modern asset picker.
   */
  facebookAppId: '847198108337884',

  /**
   * Facebook Login for Business Configuration ID.
   * Default = "SocialAI Studio Connect" Configuration on app 847198108337884
   * (User access token, all Pages + IG permissions). Override via the env var
   * if a portal needs a different Configuration. See FACEBOOK APP SETUP above.
   */
  facebookLoginConfigId: (import.meta as any).env?.VITE_FACEBOOK_LOGIN_CONFIG_ID || '947627521425720',

  /** Admin emails — these accounts auto-get Pro plan + admin mode on login */
  adminEmails: ['steve@3dhub.au', 'steve@pennywiseit.com.au'],

  /**
   * LANDING PAGE VIDEO:
   * Paste a YouTube video ID (the part after ?v= in the URL) to embed your
   * "Benefits of AI for Social Media" video on the landing page.
   * Leave as empty string to show the animated placeholder section instead.
   * Example: 'dQw4w9WgXcQ' from https://youtube.com/watch?v=dQw4w9WgXcQ
   */
  youtubeVideoId: '',

  /** Where clients purchase plans */
  salesUrl: 'https://pennywiseit.com.au',

  /** Google Form / Typeform URL sent to clients after purchase */
  onboardingFormUrl: 'https://pennywiseit.com.au/onboarding',

  /** Support contact */
  supportEmail: 'support@pennywiseit.com.au',

  /**
   * EMAILJS SETUP (for automatic email alerts when a new client submits the intake form):
   * 1. Sign up free at https://emailjs.com
   * 2. Dashboard → Email Services → Add Service (Gmail/Outlook) → copy Service ID
   * 3. Email Templates → Create Template — use these variables in the template body:
   *      {{from_name}}, {{from_email}}, {{phone}}, {{business_name}}, {{business_type}},
   *      {{location}}, {{facebook_page_url}}, {{facebook_page_name}},
   *      {{instagram_handle}}, {{followers}}, {{chosen_plan}}, {{notes}}
   *    Set "To Email" to your support email address.
   * 4. Copy the Template ID
   * 5. Account → API Keys → copy your Public Key
   * Leave all three as empty string to fall back to the mailto: method.
   */
  emailJsServiceId: '',
  emailJsTemplateId: '',
  emailJsPublicKey: '',

  /**
   * Setup fee — kept as a config knob in case you ever want to charge one,
   * but autonomous self-serve onboarding means there's no human cost to
   * amortize. Set to 0 by default; setting >0 makes the pricing UI show
   * "+ $N one-time setup" again. The setup-fee promo is unused now and
   * the UI hides the entire setup-fee row when setupFee is 0.
   */
  setupFee: 0,
  setupFeePromo: {
    active: false,
    amount: 0,
    label: '',
  },

  /**
   * Free trial — number of AI post generations a brand-new (no-plan)
   * signup gets before the paywall fires. Usage-bound, not time-bound:
   * easier to communicate, harder to game, and the conversion CTA fires
   * exactly when they're trying to extract more value. Set to 0 to
   * disable the trial entirely.
   */
  freeTrialPosts: 3,

  /**
   * PAYPAL SETUP:
   * 1. Go to developer.paypal.com → My Apps & Credentials → Create App (Live)
   * 2. Copy your Client ID and paste into paypalClientId below
   * 3. In your PayPal Business account, go to Products & Services → Subscription Plans
   * 4. For each plan (Starter/Growth/Pro/Agency):
   *    a. Create a Subscription Plan with monthly billing at the plan price
   *    b. In Payment Preferences, set Setup Fee = $99 (new subscribers only)
   *    c. Copy the Plan ID — it starts with P-
   * 5. Paste each Plan ID into paypalPlanIds below
   * 6. Add your Client ID and Client Secret to Netlify env vars:
   *    PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
   * 7. Set up a PayPal Webhook (developer.paypal.com → Webhooks) pointing to:
   *    https://YOUR_APP_URL/api/paypal-webhook
   *    Subscribe to: BILLING.SUBSCRIPTION.ACTIVATED, BILLING.SUBSCRIPTION.CANCELLED
   *    Copy the Webhook ID into PAYPAL_WEBHOOK_ID CF Pages env var
   * Leave paypalClientId as empty string to hide PayPal checkout and fall back to salesUrl.
   */
  paypalClientId: 'AbpGXFs7ZM-jJInXOHQTCD-grOswjEkCaElRuchGsNHEeV9cMJd3jkvuIBL3R9siQ3dBs0qyq5oPOo4i',

  /**
   * PAYPAL SUBSCRIPTION PLAN IDs (each starts with P-):
   * Create one subscription plan per tier in PayPal dashboard.
   * Include a $99 one-time setup fee on each plan for new subscribers.
   * Leave as empty string to fall back to the generic salesUrl.
   */
  paypalPlanIds: {
    starter: 'P-1AB09838JG575723YNG3TKPY',
    growth:  'P-5JX42118D0152071LNG3TLDY',
    pro:     'P-0MN86219YF921874FNG3TLRY',
    agency:  'P-5VB80462AU714124YNG3TL7Q',
  },

  /**
   * PAYPAL YEARLY SUBSCRIPTION PLAN IDs:
   * Same as above but billed annually at a discounted rate (2 months free).
   * Created separately in PayPal with YEAR billing cycles.
   */
  paypalYearlyPlanIds: {
    starter: 'P-62C327553Y779300FNHDUU7Y',
    growth:  'P-60J02873W1559770VNHDUVAA',
    pro:     'P-6G9907746Y8649457NHDUVAA',
    agency:  'P-1BH48559DE324360CNHDUVAA',
  },

  /**
   * PAYPAL MANAGE URL:
   * Where customers go to manage or cancel their PayPal subscription.
   * Default points to the PayPal autopay management page.
   */
  paypalManageUrl: 'https://www.paypal.com/myaccount/autopay',

  /** Max client workspaces per agency account */
  agencyClientLimit: 10,

  /**
   * CLIENT MODE: set true on white-label sites deployed for end-clients.
   * Hides billing, upgrade prompts, plan badges, agency/client-switcher,
   * and setup banners — shows only the core Create/Calendar/Insights/Settings tabs.
   * Set VITE_CLIENT_MODE=true in CF Pages env vars to enable for a specific deployment.
   */
  clientMode: (import.meta as any).env?.VITE_CLIENT_MODE === 'true',

  /**
   * Auto-login credentials for clientMode deployments (leave empty on main agency site).
   * Set VITE_AUTO_LOGIN_EMAIL and VITE_AUTO_LOGIN_PASSWORD in CF Pages env vars.
   * Each client deployment should have its own dedicated Clerk account.
   */
  autoLoginEmail: (import.meta as any).env?.VITE_AUTO_LOGIN_EMAIL || '',
  autoLoginPassword: (import.meta as any).env?.VITE_AUTO_LOGIN_PASSWORD || '',

  plans: [
    {
      id: 'starter' as const,
      name: 'Starter',
      price: 29,
      yearlyPrice: 290,
      postsPerWeek: 7,
      features: [
        'Up to 7 posts per week',
        'AI-written captions & hashtags',
        'Facebook & Instagram scheduling',
        'AI Insights & best-time analysis',
        'Content calendar',
      ],
      limitations: ['Text posts only — no AI images'],
      color: 'from-blue-500 to-indigo-600',
      badge: null,
    },
    {
      id: 'growth' as const,
      name: 'Growth',
      price: 49,
      yearlyPrice: 490,
      postsPerWeek: 14,
      features: [
        'Up to 14 posts per week',
        'AI-written captions & hashtags',
        'Facebook & Instagram scheduling',
        'AI-generated images for every post',
        'Smart AI Scheduler (auto-plan 2 weeks)',
        'AI Insights & best-time analysis',
        'Content calendar',
      ],
      limitations: [],
      color: 'from-amber-500 to-orange-500',
      badge: 'Most Popular',
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: 79,
      yearlyPrice: 790,
      postsPerWeek: 21,
      features: [
        'Up to 21 posts per week',
        'AI-written captions & hashtags',
        'Facebook & Instagram scheduling',
        'AI-generated images for every post',
        'Smart AI Scheduler + Saturation Mode',
        'Short video script generation',
        'AI Insights & best-time analysis',
        'Priority support',
      ],
      limitations: [],
      color: 'from-purple-500 to-pink-600',
      badge: 'Best Value',
    },
    {
      id: 'agency' as const,
      name: 'Agency',
      price: 149,
      yearlyPrice: 1490,
      postsPerWeek: 21,
      features: [
        'Up to 5 client workspaces',
        'Switch between clients instantly',
        'Per-client AI content & scheduling',
        'Per-client Facebook & Instagram connection',
        'AI-generated images for every post',
        'Smart AI Scheduler + Saturation Mode',
        'Per-client Insights & analytics',
        'Priority support',
      ],
      limitations: [],
      color: 'from-emerald-500 to-teal-600',
      badge: 'For Agencies',
    },
  ],
};

// ── Per-deployment overrides via VITE_CLIENT_CONFIG env var ──────────────────
// Set VITE_CLIENT_CONFIG as a JSON string in CF Pages env vars to override
// any of the above defaults for a specific white-label deployment.
// e.g. {"defaultBusinessName":"O'Connor Agriculture","accentColor":"#4E7732"}
try {
  const raw = (import.meta as any).env?.VITE_CLIENT_CONFIG;
  if (raw) {
    const overrides = JSON.parse(raw);
    Object.assign(CLIENT, overrides);
  }
} catch (e) {
  console.warn('[client.config] Failed to parse VITE_CLIENT_CONFIG — check your env var JSON:', e);
}
