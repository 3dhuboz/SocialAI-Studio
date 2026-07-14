export interface SocialPost {
  id: string;
  clientId?: string | null;
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
  // Customer QA feedback loop (schema v36). Set when a user marks a post,
  // image, or caption as off-brand/bad from PostModal.
  qaFeedbackTarget?: 'post' | 'image' | 'caption';
  qaFeedbackReason?: 'off_brand' | 'bad_image' | 'bad_caption' | 'other';
  qaFeedbackNote?: string;
  qaFeedbackAt?: string;
}

/**
 * Social platform tokens — stored in dedicated D1 column, never cached in localStorage.
 *
 * Postproxy migration (schema_v22): the postproxy* fields below are added
 * to support the cutover off direct Facebook Graph publishing onto
 * Postproxy's hosted layer. They live alongside the legacy facebook*
 * fields so the worker can read either path during the dual-path
 * migration window. The legacy fields are NOT deprecated yet — they
 * remain authoritative for any workspace whose `users.use_postproxy` is
 * still 0. A future cleanup PR drops both the legacy fields here and the
 * corresponding columns in schema_v23 once every workspace is on Postproxy.
 */
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
  // ── Postproxy mapping (schema_v22) ───────────────────────────────────
  // Populated as the OAuth + placement-picker flow progresses. All
  // optional during the dual-path migration window — a workspace may
  // have legacy facebook* fields set with no postproxy* fields (yet)
  // while it's still on the Graph publish path.
  /** Postproxy's internal profile ID — set after the hosted OAuth callback completes. */
  postproxyProfileId?: string;
  /** FB page numeric ID chosen by the user in the placement picker (= Postproxy placement.id). */
  postproxyPlacementId?: string;
  /** Postproxy profile_group ID — one per (user, client) workspace tuple. */
  postproxyGroupId?: string;
  /** Lifecycle state of the Postproxy profile. */
  postproxyProfileStatus?: 'pending' | 'active' | 'expired' | 'revoked';
  /** ISO timestamp when the Postproxy profile became active. */
  postproxyConnectedAt?: string;
  // ── Postproxy Instagram mapping (schema_v24 / ig-wire) ──────────────
  // Parallel to the Facebook fields above — a workspace can hold BOTH an
  // FB profile AND an IG profile in postproxy_profiles, keyed by
  // (user_id, client_id, platform). IG has no placement picker (docs
  // §3299), so postproxyInstagramProfileId is the single sentinel for
  // "this workspace has Instagram connected via Postproxy".
  /** Postproxy's internal profile ID for Instagram — set after the
   *  hosted OAuth callback completes for platform='instagram'. */
  postproxyInstagramProfileId?: string;
  /** ISO timestamp when the IG-via-Postproxy profile became active. */
  postproxyInstagramConnectedAt?: string;
  /** Display label for the connected IG account (handle/username). */
  postproxyInstagramName?: string;
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
  postproxyProfileId: undefined,
  postproxyPlacementId: undefined,
  postproxyGroupId: undefined,
  postproxyProfileStatus: undefined,
  postproxyConnectedAt: undefined,
  postproxyInstagramProfileId: undefined,
  postproxyInstagramConnectedAt: undefined,
  postproxyInstagramName: undefined,
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
  /**
   * REAL MATERIAL the owner has provided — the AI draws from these so
   * it doesn't have to invent specifics. Added 2026-05 in response to
   * fabrication issues caught in audit (made-up customer numbers,
   * invented ROI percentages, etc.).
   *
   * Each is plain text, one item per line. Empty is OK — the
   * post-writer prompt treats missing fields as "no material, fall
   * back to tactical/observational content (never fabricate)".
   */
  /** Real customer stories with permission status — e.g.
   *  "Mary at Carlton Café — 'Posts that used to take me an hour now take 10 minutes' — anonymous OK"
   *  Used for testimonial-style posts. Without these, the model is
   *  forbidden from inventing customer outcomes. */
  customerStories?: string;
  /** Strong opinions the owner holds about their industry —
   *  one per line. Fuels "industry hot take" pillar content. */
  hotTakes?: string;
  /** Free tactical tips the owner can give their audience —
   *  one per line. Fuels "tactical tip" pillar content (no product mention). */
  tacticalTips?: string;
  /** This week's "what happened worth posting about" — refreshed by the
   *  owner regularly. Real launches, real fixes, real moments. Used for
   *  founder-voice / behind-the-build posts. Without recent material,
   *  the model falls back to evergreen pillar content. */
  weeklyMaterial?: string;
  /**
   * Legacy preference retained for stored profile compatibility. The publish
   * pipeline no longer auto-appends an AI disclosure to customer captions.
   */
  aiDisclosure?: boolean;
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
