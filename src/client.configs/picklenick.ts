/// <reference types="vite/client" />
/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  Pickle Nick
 *  Deployed at: social.picklenick.au
 *  Netlify env: VITE_CLIENT_ID=picklenick
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  clientId: 'picklenick',
  appName: 'Pickle Nick Social',
  tagline: 'AI-powered social media — brined to perfection',

  defaultBusinessName: 'Pickle Nick',
  defaultBusinessType: 'artisan deli & pickled goods',
  defaultLocation: 'Australia',
  defaultTone: 'Fun, quirky and food-loving',
  defaultDescription: 'Handcrafted pickles, fermented goods and deli favourites. Small batch, big flavour.',

  accentColor: '#b5513c',
  theme: 'light' as const,

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  facebookAppId: '847198108337884',
  facebookLoginConfigId: import.meta.env.VITE_FACEBOOK_LOGIN_CONFIG_ID ?? '947627521425720',

  adminEmails: ['steve@3dhub.au', 'steve@pennywiseit.com.au'],

  youtubeVideoId: '',

  salesUrl: 'https://pennywiseit.com.au',
  onboardingFormUrl: 'https://pennywiseit.com.au/onboarding',
  supportEmail: 'support@pennywiseit.com.au',

  emailJsServiceId: '',
  emailJsTemplateId: '',
  emailJsPublicKey: '',

  setupFee: 0,

  stripePublishableKey: '',
  stripePricingTableId: '',
  stripeCustomerPortalUrl: '',

  stripePaymentLinks: {
    starter: '',
    growth: '',
    pro: '',
    agency: '',
  },

  stripePaymentLinksNew: {
    starter: '',
    growth: '',
    pro: '',
    agency: '',
  },

  agencyClientLimit: 10,
  clientMode: true,
  autoLoginEmail: import.meta.env.VITE_AUTO_LOGIN_EMAIL ?? '',
  autoLoginPassword: import.meta.env.VITE_AUTO_LOGIN_PASSWORD ?? '',

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
      color: 'from-green-700 to-green-800',
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
      color: 'from-green-600 to-emerald-600',
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
      color: 'from-emerald-600 to-teal-600',
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
      color: 'from-green-700 to-green-900',
      badge: 'For Agencies',
    },
  ],
} as const;
