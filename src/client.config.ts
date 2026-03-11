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

  /** Admin emails — these accounts auto-get Pro plan + admin mode on login */
  adminEmails: ['steve@3dhub.au', 'steve@pennywiseit.com.au'],

  /** Where clients purchase plans */
  salesUrl: 'https://pennywiseit.com.au',

  /** Google Form / Typeform URL sent to clients after purchase */
  onboardingFormUrl: 'https://pennywiseit.com.au/onboarding',

  /** Support contact */
  supportEmail: 'support@pennywiseit.com.au',

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

  /** Max client workspaces per agency account */
  agencyClientLimit: 10,

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
        'Up to 10 client workspaces',
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
