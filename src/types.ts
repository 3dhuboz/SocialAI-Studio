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
  // ── Scheduled Reels pipeline (v5) ───────────────────────────────────────
  // videoUrl gets populated by the prewarm cron once Kling completes; the
  // status field drives the dashboard's reel-status indicator and tells the
  // publish cron whether the slot is reel-ready or should fall back to image.
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'ready' | 'failed';
  videoRequestId?: string;
  videoStartedAt?: string;
  videoError?: string;
  /** R2 object key for the cached reel mp4 (e.g. 'reels/{post_id}.mp4') */
  r2VideoKey?: string;
  /** Mixed-audio version — populated by PR #2 (server-side ffmpeg). NULL in PR #1. */
  audioMixedUrl?: string;
  // ── Vision critique result (schema v8) ───────────────────────────────────
  // Populated by the prewarm cron (every 5 min) and by manual /api/critique-
  // image-caption calls. The score is Haiku 4.5 vision's verdict on whether
  // the image actually matches the caption + workspace archetype. PostModal
  // renders a small badge when these are present.
  imageCritiqueScore?: number;        // 0-10
  imageCritiqueReasoning?: string;    // one-sentence explanation
  imageCritiqueAt?: string;           // ISO timestamp
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
  /**
   * Absolute "never depict, never mention" list — comma-separated subjects
   * the AI must NOT include in captions, image prompts, or generated images
   * for this business. Use for products competitors might sell that this
   * business doesn't (e.g. a brisket-only BBQ writing "pork, chicken,
   * lamb, seafood" here), or any subject that's been flagged by the owner
   * as off-brand.
   *
   * Enforced at four layers: (1) caption gen prompt has an EXCLUSION
   * MANDATE clause built from this list, (2) image-prompt gen is
   * constrained to draw from productsServices instead of generic archetype
   * examples, (3) vision critique gets the denylist as a HARD RULE that
   * scores any forbidden subject 1-2, (4) pre-publish cron does a final
   * regex scan and flags the post for review before going live.
   */
  forbiddenSubjects: string;
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
  /** v5 — reel credits balance for this workspace. Plan grants + purchased
   *  credit packs both accrue here. Reel generation decrements by 1. */
  reelCredits?: number;
}

export type CampaignType = 'countdown' | 'promo' | 'launch' | 'event' | 'custom';

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  startDate: string;
  endDate: string;
  rules: string;
  imageNotes: string;
  postsPerDay: number;
  enabled: boolean;
  createdAt: string;
  // Research brief (schema_v12 — agentic campaigns). Populated by
  // POST /api/db/campaigns/:id/research and consumed by the post-writer.
  // brief is the full markdown brief, briefSummary is the 1-2 sentence
  // confirmation line shown in the UI ("Checked example.com — found …").
  brief?: string;
  briefSummary?: string;
  briefStatus?: 'idle' | 'researching' | 'ready' | 'failed';
  briefUpdatedAt?: string;
  briefSources?: Array<{ url: string; ok: boolean; title?: string; status?: number; error?: string }>;
}
