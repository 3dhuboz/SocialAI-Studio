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
   * STRIPE SETUP:
   * 1. Go to dashboard.stripe.com → Products → Pricing tables → Create pricing table
   * 2. Add your 3 plans (Starter $29, Growth $49, Pro $79) + $99 setup fee as an add-on
   * 3. Set the success URL to: https://YOUR_APP_URL/?checkout=success&plan={plan_id}
   *    where {plan_id} is one of: starter | growth | pro
   * 4. Copy your Publishable Key from Stripe dashboard → Developers → API keys
   * 5. Copy the Pricing Table ID from the embed code (starts with prctbl_)
   * Leave these as empty strings to fall back to the static pricing cards.
   */
  stripePublishableKey: 'pk_live_51P8FoQ00ETA4f7VOQn6UauJebPB5aU4TX5qyMpHgvwgy7OUnGKZllHAFAKwAShNRNcfEOlfeLVjNBm345oSyN0S100Oq8F8l3W',
  stripePricingTableId: 'prctbl_1T9d6K00ETA4f7VOScFSprrm',

  /**
   * STRIPE CUSTOMER PORTAL:
   * 1. Go to dashboard.stripe.com → Settings → Billing → Customer portal
   * 2. Enable the portal and configure what customers can do (cancel, update payment, etc.)
   * 3. Copy the portal link and paste below.
   * Users can then manage/cancel their own subscription directly from the Account panel.
   */
  stripeCustomerPortalUrl: 'https://billing.stripe.com/p/login/8x25kv9dq6did1Ca2V2oE00',

  /**
   * STRIPE PAYMENT LINKS — UPGRADES (plan subscription only, no setup fee):
   * Used when an existing subscriber upgrades from one plan to another.
   * In Stripe dashboard → Payment Links → Create a link for each plan (subscription only).
   */
  stripePaymentLinks: {
    starter: '',
    growth: '',
    pro: '',
    agency: 'https://buy.stripe.com/14A3cnexK45a1iUgrj2oE02',
  },

  /**
   * STRIPE PAYMENT LINKS — NEW CLIENTS (plan subscription + $99 setup fee):
   * Used for brand-new signups. Create separate Stripe Payment Links that include
   * a one-time $99 setup fee line item alongside the subscription.
   * In Stripe dashboard → Payment Links → Add both the plan product AND the setup fee product.
   * Leave as empty string to fall back to the generic salesUrl.
   */
  stripePaymentLinksNew: {
    starter: '',
    growth: '',
    pro: '',
    agency: '',
  },

  /** Max client workspaces per agency account */
  agencyClientLimit: 5,

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
