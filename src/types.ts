export interface SocialPost {
  id: string;
  platform: 'Facebook' | 'Instagram';
  content: string;
  hashtags: string[];
  scheduledFor: string;
  status: 'Draft' | 'Scheduled' | 'Posted' | 'Missed';
  image?: string;
  imagePrompt?: string;
  reasoning?: string;
  pillar?: string;
  topic?: string;
  postType?: 'image' | 'video' | 'text';
  videoScript?: string;
  videoShots?: string;
  videoMood?: string;
}

/** Social platform tokens — stored in dedicated D1 column, never cached in localStorage */
export interface SocialTokens {
  facebookPageId: string;
  facebookPageAccessToken: string;
  facebookConnected: boolean;
  instagramBusinessAccountId: string;
  instagramConnected: boolean;
  /** Long-lived user token (60 days) — used by worker cron to refresh page tokens */
  longLivedUserToken?: string;
  /** ISO timestamp when the Facebook connection was granted */
  connectedAt?: string;
  /** Name of the connected page, for display only */
  facebookPageName?: string;
}

export const DEFAULT_SOCIAL_TOKENS: SocialTokens = {
  facebookPageId: '',
  facebookPageAccessToken: '',
  facebookConnected: false,
  instagramBusinessAccountId: '',
  instagramConnected: false,
  longLivedUserToken: undefined,
  connectedAt: undefined,
  facebookPageName: undefined,
};

export interface BusinessProfile {
  name: string;
  type: string;
  description: string;
  tone: string;
  location: string;
  logoUrl: string;
  /** @deprecated use SocialTokens state instead — kept for backwards compat during migration */
  facebookAppId?: string;
  /** @deprecated use SocialTokens state instead */
  facebookPageId?: string;
  /** @deprecated use SocialTokens state instead */
  facebookPageAccessToken?: string;
  /** @deprecated use SocialTokens state instead */
  facebookConnected?: boolean;
  /** @deprecated use SocialTokens state instead */
  instagramBusinessAccountId?: string;
  targetAudience: string;
  uniqueValue: string;
  productsServices: string;
  socialGoal: string;
  contentTopics: string;
  videoEnabled: boolean;
}

export interface ContentCalendarStats {
  followers: number;
  reach: number;
  engagement: number;
  postsLast30Days: number;
}

export type PlanTier = 'starter' | 'growth' | 'pro' | 'agency';
export type SetupStatus = 'ordered' | 'form_sent' | 'in_progress' | 'live' | 'cancelled';

export interface ClientWorkspace {
  id: string;
  name: string;
  businessType: string;
  createdAt: string;
  plan?: PlanTier;
  lastPostAt?: string;
  scheduledPostCount?: number;
  /** Vite CLIENT_ID slug for the branded site, e.g. "streetmeats" */
  clientSlug?: string;
}

export interface Campaign {
  id: string;
  name: string;
  type: 'custom' | 'launch' | 'seasonal' | 'event';
  startDate: string;
  endDate: string;
  rules: string;
  postsPerDay: number;
  enabled: boolean;
  createdAt?: string;
}
