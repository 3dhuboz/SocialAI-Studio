export interface SocialPost {
  id: string;
  platform: 'Facebook' | 'Instagram';
  content: string;
  hashtags: string[];
  scheduledFor: string;
  status: 'Draft' | 'Scheduled' | 'Posted';
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

export interface BusinessProfile {
  name: string;
  type: string;
  description: string;
  tone: string;
  location: string;
  logoUrl: string;
  facebookAppId: string;
  facebookPageId: string;
  facebookPageAccessToken: string;
  facebookConnected: boolean;
  instagramBusinessAccountId: string;
  geminiApiKey: string;
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
export type SetupStatus = 'ordered' | 'form_sent' | 'in_progress' | 'live';

export interface ClientWorkspace {
  id: string;
  name: string;
  businessType: string;
  createdAt: string;
  lateProfileId?: string;
  lateConnectedPlatforms?: string[];
}
