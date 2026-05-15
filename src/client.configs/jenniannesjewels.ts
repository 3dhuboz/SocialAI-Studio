/// <reference types="vite/client" />
/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  Jenni-Anne's Jewels
 *  Deployed at: social.jenniannesjewels.com.au (or .pages.dev)
 *  Netlify env: VITE_CLIENT_ID=jenniannesjewels
 *
 *  Jenni-Anne sews handmade kids' clothing, bucket hats, gift bags,
 *  crochet blankets and tea towels. Personal, warm, market-stall vibe.
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  clientId: 'jenniannesjewels',
  appName: "Jenni-Anne's Social",
  tagline: 'AI-powered social — sewn-by-hand stories, served daily',

  defaultBusinessName: "Jenni-Anne's Jewels",
  defaultBusinessType: 'handmade kids\' clothing & accessories',
  defaultLocation: 'Australia',
  defaultTone: 'Warm, casual, mum-with-a-sewing-machine. First-person, never corporate.',
  defaultDescription: "Lovingly handmade kids' clothing, bucket hats, gift bags, crochet blankets, hanging tea towels and bowl cosys — sewn by hand in small batches in Australia.",

  accentColor: '#8e7ab0', // deeper-lilac plum (matches storefront --accent-deep)
  theme: 'light' as const,

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  facebookAppId: '847198108337884',

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
      color: 'from-purple-500 to-purple-700',
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
      color: 'from-purple-400 to-pink-500',
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
      color: 'from-pink-500 to-rose-500',
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
      color: 'from-purple-600 to-fuchsia-700',
      badge: 'For Agencies',
    },
  ],
} as const;
