/**
 * O'Connor Client Configuration
 * GIP - The Butcher Online
 */

export const CLIENT = {
  appName: 'SocialAI Studio - O\'Connor',
  tagline: 'AI-powered social media for O\'Connor Butcher',

  defaultBusinessName: 'O\'Connor Butcher',
  defaultBusinessType: 'Butcher Shop & Meat Provider',
  defaultLocation: 'GIP, Australia',
  defaultTone: 'Professional yet friendly, highlighting quality and freshness',
  defaultDescription: 'Premium quality meats, locally sourced and freshly prepared daily',

  accentColor: '#dc2626', // Red for butcher theme

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  // Facebook App (reuse main app's)
  facebookAppId: '847198108337884',

  // Admin emails
  adminEmails: ['steve@pennywiseit.com.au'],

  // Landing page video (optional)
  youtubeVideoId: '',

  // Sales and onboarding
  salesUrl: 'https://pennywiseit.com.au',
  onboardingFormUrl: 'https://pennywiseit.com.au/onboarding',

  // Support
  supportEmail: 'steve@pennywiseit.com.au',

  // Plans (using main app's structure)
  plans: [
    {
      id: 'starter' as const,
      name: 'Starter',
      price: 297,
      postsPerWeek: 3.5, // 14 posts per month
      color: 'from-gray-600 to-gray-800',
      badge: null,
      features: [
        '14 posts per month',
        'Basic AI content generation',
        'Facebook scheduling',
        'Email support'
      ],
      limitations: ['Text posts only — no AI images']
    },
    {
      id: 'growth' as const,
      name: 'Growth',
      price: 497,
      postsPerWeek: 7, // 28 posts per month
      color: 'from-blue-600 to-indigo-600',
      badge: 'Popular',
      features: [
        '28 posts per month',
        'Advanced AI content',
        'Facebook & Instagram',
        'Image generation',
        'Priority support'
      ],
      limitations: []
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: 797,
      postsPerWeek: 14, // 56 posts per month
      color: 'from-purple-600 to-pink-600',
      badge: null,
      features: [
        '56 posts per month',
        'Premium AI content',
        'All platforms',
        'Video generation',
        'Analytics & insights',
        'Dedicated support'
      ],
      limitations: []
    }
  ],

  // PayPal (empty for now)
  paypalClientId: '',
  paypalManageUrl: '',
  paypalPlanIds: {
    starter: '',
    growth: '',
    pro: '',
    agency: ''
  },

  // EmailJS
  emailJsServiceId: '',
  emailJsTemplateId: '',
  emailJsPublicKey: '',

  // Features
  enableVideoGeneration: true,
  enableImageGeneration: true,
  enableSmartScheduling: true,
  enableAnalytics: true,

  // Agency settings
  agencyMode: false,
  agencyClientLimit: 0,
  setupFee: 0, // Waived for existing client

  // Auto-login for client mode
  autoLoginEmail: '',
  autoLoginPassword: '',

  // Required properties for compatibility
  clientMode: false,
  setupFeePromo: {
    active: false,
    amount: 0,
    label: ''
  }
} as const;
