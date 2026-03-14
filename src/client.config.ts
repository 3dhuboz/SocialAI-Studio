/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  edit this file for each white-label client
 *  Everything here is the ONLY thing you need to change when
 *  deploying a new branded instance of SocialAI Studio.
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  appName: 'SocialAI Studio',
  tagline: 'AI-powered social media — done for you',

  defaultBusinessName: 'My Business',
  defaultBusinessType: 'small business',
  defaultLocation: 'Australia',
  defaultTone: 'Friendly and professional',
  defaultDescription: '',

  accentColor: '#f59e0b',

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  /**
   * FACEBOOK APP SETUP:
   * 1. Go to developers.facebook.com → Create App → "Business" type
   * 2. Add "Facebook Login" product to the app
   * 3. Under Facebook Login → Settings, add your domain to Valid OAuth Redirect URIs
   * 4. App Review: request permissions: pages_show_list, pages_manage_posts, pages_read_engagement
   * 5. Go Live (toggle in top bar) once approved
   * 6. Copy your App ID from the app dashboard and paste below
   */
  facebookAppId: '847198108337884',

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

  setupFee: 99,

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
   *    https://YOUR_APP_URL/.netlify/functions/paypal-webhook
   *    Subscribe to: BILLING.SUBSCRIPTION.ACTIVATED, BILLING.SUBSCRIPTION.CANCELLED
   *    Copy the Webhook ID into PAYPAL_WEBHOOK_ID Netlify env var
   * Leave paypalClientId as empty string to hide PayPal checkout and fall back to salesUrl.
   */
  paypalClientId: '',

  /**
   * PAYPAL SUBSCRIPTION PLAN IDs (each starts with P-):
   * Create one subscription plan per tier in PayPal dashboard.
   * Include a $99 one-time setup fee on each plan for new subscribers.
   * Leave as empty string to fall back to the generic salesUrl.
   */
  paypalPlanIds: {
    starter: '',
    growth: '',
    pro: '',
    agency: '',
  },

  /**
   * PAYPAL MANAGE URL:
   * Where customers go to manage or cancel their PayPal subscription.
   * Default points to the PayPal autopay management page.
   */
  paypalManageUrl: 'https://www.paypal.com/myaccount/autopay',

  /** Max client workspaces per agency account */
  agencyClientLimit: 5,

  /**
   * CLIENT MODE: set true on white-label sites deployed for end-clients.
   * Hides billing, upgrade prompts, plan badges, agency/client-switcher,
   * and setup banners — shows only the core Create/Calendar/Insights/Settings tabs.
   */
  clientMode: false,

  plans: [
    {
      id: 'starter' as const,
      name: 'Starter',
      price: 29,
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
} as const;
