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
}

export interface ContentCalendarStats {
  followers: number;
  reach: number;
  engagement: number;
  postsLast30Days: number;
}
