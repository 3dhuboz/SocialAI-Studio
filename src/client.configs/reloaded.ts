/// <reference types="vite/client" />
/**
 * CLIENT CONFIG - The Reloaded Collective
 * Deployed with: VITE_CLIENT_ID=reloaded
 *
 * Starter SocialAI Studio package for Brent's print, apparel, engraving,
 * memorabilia and market-sale business.
 */
export const CLIENT = {
  clientId: 'reloaded',
  appName: 'Reloaded Social',
  tagline: 'AI-powered social posts for print, apparel and custom gear',

  defaultBusinessName: 'The Reloaded Collective',
  defaultBusinessType: 'custom print, apparel, engraving and memorabilia',
  defaultLocation: 'Yeppoon, Queensland',
  defaultTone: 'Practical, local, confident and a little bit cheeky. Clear calls to action, no corporate fluff.',
  defaultDescription:
    'The Reloaded Collective creates custom apparel, DTF prints, engraved pieces, memorabilia displays and market-ready custom gear for customers around Yeppoon and the Capricorn Coast.',

  accentColor: '#c2410c',
  theme: 'dark' as const,

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  facebookAppId: '847198108337884',
  facebookLoginConfigId: import.meta.env.VITE_FACEBOOK_LOGIN_CONFIG_ID ?? '947627521425720',

  adminEmails: ['steve@3dhub.au', 'steve@pennywiseit.com.au'],

  youtubeVideoId: '',

  salesUrl: 'https://re-loaded.com.au',
  onboardingFormUrl: 'https://re-loaded.com.au/contact?source=socialai-onboarding',
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

  agencyClientLimit: 5,
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
        'AI-written captions and hashtags',
        'Facebook and Instagram scheduling',
        'AI Insights and best-time analysis',
        'Content calendar',
      ],
      limitations: ['Text posts only - no AI images'],
      color: 'from-orange-700 to-zinc-900',
      badge: null,
    },
    {
      id: 'growth' as const,
      name: 'Growth',
      price: 49,
      postsPerWeek: 14,
      features: [
        'Up to 14 posts per week',
        'AI-written captions and hashtags',
        'Facebook and Instagram scheduling',
        'AI-generated images for every post',
        'Smart AI Scheduler',
        'AI Insights and best-time analysis',
        'Content calendar',
      ],
      limitations: [],
      color: 'from-orange-600 to-red-700',
      badge: 'Most Popular',
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: 79,
      postsPerWeek: 21,
      features: [
        'Up to 21 posts per week',
        'AI-written captions and hashtags',
        'Facebook and Instagram scheduling',
        'AI-generated images for every post',
        'Smart AI Scheduler plus Saturation Mode',
        'AI Reels credits',
        'AI Insights and best-time analysis',
        'Priority support',
      ],
      limitations: [],
      color: 'from-red-700 to-zinc-950',
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
        'Per-client AI content and scheduling',
        'Per-client Facebook and Instagram connection',
        'AI-generated images for every post',
        'Smart AI Scheduler plus Saturation Mode',
        'Shared AI Reels credits',
        'Per-client Insights and analytics',
        'Priority support',
      ],
      limitations: [],
      color: 'from-zinc-800 to-orange-950',
      badge: 'For Agencies',
    },
  ],
} as const;
