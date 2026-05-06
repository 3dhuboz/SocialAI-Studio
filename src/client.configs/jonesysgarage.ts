/// <reference types="vite/client" />
/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  Jonesy's Garage
 *  Deployed at: social.jonesysgarage.com.au (pending domain)
 *  Netlify env: VITE_CLIENT_ID=jonesysgarage
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  clientId: 'jonesysgarage',
  appName: "Jonesy's Social",
  tagline: 'AI-powered social — keeping the workshop in front of Rocky',

  defaultBusinessName: "Jonesy's Garage",
  defaultBusinessType: 'Automotive mechanical workshop',
  defaultLocation: 'Rockhampton, QLD, Australia',
  defaultTone: 'Blunt, blue-collar, straight-talking. No fluff, no corporate speak. Occasional dry Aussie humour. Focus on honest work, fair quotes, and getting the car back on the road.',
  defaultDescription:
    "Jonesy's Garage is a Rockhampton mechanical workshop doing logbook servicing, tune-ups, brakes, tyres, diagnostics, safety certificates, and engine rebuilds. Known for blunt honesty, quality work, and fair pricing — no upsell games. Handles everything from daily drivers to classic rotaries.",

  accentColor: '#f5c518',

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  facebookAppId: '847198108337884',
  facebookLoginConfigId: import.meta.env.VITE_FACEBOOK_LOGIN_CONFIG_ID ?? '',

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
      color: 'from-yellow-500 to-amber-600',
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
      color: 'from-yellow-500 to-red-700',
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
      color: 'from-red-700 to-red-900',
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
      color: 'from-zinc-700 to-zinc-900',
      badge: 'For Agencies',
    },
  ],
} as const;
