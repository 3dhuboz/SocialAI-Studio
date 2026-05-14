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

  /**
   * LANDING PAGE POSTER SAMPLE IMAGE:
   * URL of the hero image inside the Poster Maker spotlight mockup on the
   * landing page (the 4:5 tilted poster card). When set, fills the dark
   * "AI image" placeholder area with a real photo so the mockup reads as
   * an actual poster output instead of a wireframe.
   *
   * Defaults to a stable Unsplash food/venue photo. Override via
   * VITE_SAMPLE_POSTER_IMAGE_URL for a whitelabel deploy, or drop a real
   * generated poster PNG at public/samples/poster-demo.png and set this
   * to '/samples/poster-demo.png' to show your own brand's output.
   */
  samplePosterImageUrl: (import.meta as any).env?.VITE_SAMPLE_POSTER_IMAGE_URL
    || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&h=400&fit=crop&q=70&auto=format',

  /**
   * LANDING PAGE AI REELS SAMPLE:
   * Direct MP4 URL of a sample reel that plays in the AI Reels spotlight
   * section's 9:16 phone frame. The browser autoplays it muted + looped, so
   * the visitor sees a real example instead of the CSS placeholder.
   *
   * Set via VITE_SAMPLE_REEL_URL env var on Cloudflare Pages. Three ways
   * to populate it:
   *   1. Drop a 5–10s portrait MP4 at public/samples/reel-demo.mp4 and set
   *      this to '/samples/reel-demo.mp4'.
   *   2. Generate a reel in the app, wait for the prewarm cron to persist
   *      it to R2, then copy that durable URL here (e.g.
   *      https://pub-cff7bdfbd7204e129ae671d65d62b20e.r2.dev/reels/<id>.mp4).
   *   3. Use any other public CDN-hosted portrait MP4.
   *
   * Leave empty to fall back to the animated CSS placeholder.
   */
  sampleReelUrl: (import.meta as any).env?.VITE_SAMPLE_REEL_URL || '',

  /** Where clients purchase plans */
  salesUrl: 'https://pennywiseit.com.au',

  /** Google Form / Typeform URL sent to clients after purchase */
  onboardingFormUrl: 'https://pennywiseit.com.au/onboarding',

  /** Support contact */
  supportEmail: 'support@pennywiseit.com.au',

  /**
   * FOUNDER IDENTITY — used on the landing page trust card.
   *
   * Cold AU SMBs trust "local + named human" more than any other signal a
   * small SaaS without name recognition can offer. When all three fields
   * are set, the trust card renders the photo + first-person promise + name
   * attribution. Leaving any field blank gracefully falls back to the
   * generic "Built and supported in Australia" treatment.
   *
   * Setup:
   *   1. Drop a square (≥ 200×200) JPG at public/founder.jpg
   *   2. Set photoUrl to '/founder.jpg' below
   *   3. Set firstName to your first name
   *   4. (optional) Tweak the promise line
   */
  founder: {
    firstName: '',                   // e.g. 'Steve'
    photoUrl: '',                    // e.g. '/founder.jpg' (relative to public/)
    promise: 'Email me directly. I reply same-day, AEST.',
  },

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

  /**
   * REEL CREDIT PACKS — one-off purchases via PayPal Smart Buttons.
   * Available on every plan; especially used by Starter/Growth (no monthly
   * grant) and Pro/Agency users who exhaust their monthly allotment. Credits
   * never expire. Margin is healthy at every tier (~$0.30 fal cost per reel).
   *
   * To change pricing: update the value/credits below — the worker verifies
   * the captured order's amount against this list before crediting, so
   * mismatches are rejected automatically.
   *
   * Currency is AUD by default to match the existing PayPal subscription
   * config; PayPal converts at checkout for international customers.
   */
  reelCreditPacks: [
    { id: 'small',  credits: 3,  price: 9.99,  currency: 'AUD', label: 'Starter pack' },
    { id: 'medium', credits: 10, price: 24.99, currency: 'AUD', label: 'Value pack' },
    { id: 'large',  credits: 25, price: 49.99, currency: 'AUD', label: 'Pro pack' },
  ],

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
        'Poster Maker: 3 posters/month',
        'AI Insights & best-time analysis',
        'Content calendar',
      ],
      limitations: ['Text posts only — no AI images'],
      color: 'from-blue-500 to-indigo-600',
      badge: null,
      // Per-plan feature gates. Drives sidebar tab visibility (e.g. the Posters
      // tab only renders when includes.posters is true) and the worker's
      // poster routes use the same source-of-truth via PLAN_INCLUDES_POSTERS.
      // White-label client configs in src/client.configs/* omit this field
      // entirely so their portals don't surface SocialAI-only features.
      includes: { posters: true },
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
        'Poster Maker: 10 posters/month',
        'Smart AI Scheduler (auto-plan 2 weeks)',
        'AI Insights & best-time analysis',
        'Content calendar',
      ],
      limitations: [],
      color: 'from-amber-500 to-orange-500',
      badge: 'Most Popular',
      includes: { posters: true },
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
        'Poster Maker: 30 posters/month',
        'Smart AI Scheduler + Saturation Mode',
        'AI Reels: 4 credits/month (Kling video + auto-mixed music)',
        'AI Insights & best-time analysis',
        'Priority support',
      ],
      limitations: [],
      color: 'from-purple-500 to-pink-600',
      // Single visual anchor on landing — Growth keeps "Most Popular".
      // Pro and Agency are unbadged so the eye picks one Most Popular plan
      // instead of bouncing between competing badges (decoy effect — Ariely).
      badge: null,
      includes: { posters: true },
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
        'Poster Maker: 100 posters/month (shared across all clients)',
        'Smart AI Scheduler + Saturation Mode',
        'AI Reels: 20 credits/month (shared across all clients)',
        'Per-client Insights & analytics',
        'Priority support',
      ],
      limitations: [],
      color: 'from-emerald-500 to-teal-600',
      badge: 'For Agencies',
      includes: { posters: true },
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
