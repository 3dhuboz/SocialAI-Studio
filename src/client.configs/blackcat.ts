/// <reference types="vite/client" />
/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  Black Cat Breathwork
 *  Deployed at: black-cat-breathwork.pages.dev
 *  CF Pages env: VITE_CLIENT_ID=blackcat
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  clientId: 'blackcat',
  appName: 'Black Cat Social',
  tagline: 'AI-powered social media — breathe easy online',

  defaultBusinessName: 'Black Cat Breathwork',
  defaultBusinessType: '9D Breathwork facilitator',
  defaultLocation: 'Central Queensland, Australia',
  defaultTone: 'Warm, grounded and inviting',
  defaultDescription: 'Black Cat Breathwork offers transformative 9D Breathwork journeys — immersive 70-minute experiences combining progressive breathwork, guided coaching, hypnotic affirmations, and multi-layered soundscapes.',

  accentColor: '#7c3aed',

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
      color: 'from-violet-600 to-purple-700',
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
      color: 'from-purple-600 to-fuchsia-600',
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
      color: 'from-fuchsia-600 to-pink-600',
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
      color: 'from-violet-700 to-purple-900',
      badge: 'For Agencies',
    },
  ],
} as const;
