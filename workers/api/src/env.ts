// Cloudflare runtime + Env type definitions for the worker.
//
// Extracted from src/index.ts as the first step of the route-module split
// (see WORKER_SPLIT_PLAN.md). The Env type + binding shims are referenced
// by every route handler, cron, and helper — having them in their own file
// means each future extracted module can `import type { Env } from './env'`
// without pulling in the rest of the 4000-LOC index.
//
// D1Database / R2Bucket types come from @cloudflare/workers-types (loaded
// globally via tsconfig.types). No local shim needed for those.

// Cloudflare Workers AI binding — used by Phase 2 Vectorize layer to embed
// business descriptions with @cf/baai/bge-base-en-v1.5 (768-dim, free tier
// covers 30M queried dims/month).
export interface AiRunner {
  run(model: string, input: { text: string | string[] } | Record<string, unknown>): Promise<any>;
}

// Cloudflare Vectorize binding — semantic similarity search over the 13
// archetype descriptions. When this binding is configured, the classifier
// uses it as a cheap-fast first stage before falling through to Haiku.
export interface VectorizeIndex {
  query(vector: number[], opts?: { topK?: number; returnMetadata?: boolean | 'all' | 'indexed'; returnValues?: boolean }): Promise<{
    matches: Array<{ id: string; score: number; metadata?: Record<string, unknown>; values?: number[] }>;
  }>;
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<{ mutationId: string }>;
  describe(): Promise<{ vectorsCount: number; dimensions: number }>;
}

export type Env = {
  OPENROUTER_API_KEY: string;
  /** When set, Anthropic-model calls (anthropic/claude-*) route direct to
   *  Anthropic's Messages API instead of OpenRouter. Unlocks: 1-hour prompt
   *  cache TTL (vs OpenRouter's 5-min default), native structured outputs,
   *  ~5.5% saved on OpenRouter's markup, ~25-40ms saved on routing latency.
   *  See callAnthropicDirect helper. Set with: wrangler secret put ANTHROPIC_API_KEY */
  ANTHROPIC_API_KEY?: string;
  /** Phase 2 archetype classifier — Cloudflare Vectorize binding. Wire by
   *  adding `[[vectorize]] binding = "ARCHETYPE_VEC"` to wrangler.toml +
   *  creating the index with `wrangler vectorize create archetypes
   *  --dimensions=768 --metric=cosine`. When this binding is configured,
   *  /api/classify-business uses cosine similarity as Layer 0.5 between the
   *  cheap keyword match and the LLM fallback. See classifyViaVectorize. */
  ARCHETYPE_VEC?: VectorizeIndex;
  /** Cloudflare Workers AI binding — needed for the bge-base-en-v1.5
   *  embedding model. Wire by adding `[ai] binding = "AI"` to wrangler.toml.
   *  Free tier: 30M queried dimensions / month. */
  AI?: AiRunner;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  DB: D1Database;
  // R2 bucket for AI-generated reel videos. fal.ai Kling URLs expire ~24h —
  // the prewarm cron copies each generated mp4 here so the publish cron has
  // a durable, public URL to feed FB/IG via file_url.
  REELS_R2?: R2Bucket;
  // Server-side MP4 trimming and cover-frame extraction for owner uploads.
  MEDIA?: MediaBinding;
  // R2 bucket for Poster Maker PNG bytes. Keyed `posters/<id>.png`; D1 row
  // posters.image_r2_key references the key. ~5 MB cap enforced in the upload
  // route. Streamed back to the browser via GET /api/db/posters/:id/image.
  POSTER_ASSETS?: R2Bucket;
  // Public base URL for REELS_R2 — e.g. "https://reels.socialaistudio.au"
  // (custom domain) or "https://pub-{hash}.r2.dev" (default public bucket).
  // Set in [vars] in wrangler.toml once the bucket exposes a public URL.
  R2_REELS_PUBLIC_BASE?: string;
  LATE_API_KEY?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  FAL_API_KEY?: string;
  // Admin-scoped fal key used only for account billing checks. Keep separate
  // from the generation key so model requests retain least privilege.
  FAL_ADMIN_API_KEY?: string;
  // Controlled primary image-provider switch. Keep unset or set to
  // `flux-dev` for immediate rollback; set to `gpt-image-2` after the worker
  // and critic gate have passed production smoke checks.
  IMAGE_GEN_PROVIDER?: string;
  // Optional future image-provider integration. Do not use a desktop/browser
  // Higgsfield CLI OAuth token here; production workers need a deploy-safe
  // server credential and a stable API base URL. See docs/higgsfield-production-gate.md.
  HIGGSFIELD_API_BASE_URL?: string;
  HIGGSFIELD_API_KEY?: string;
  HIGGSFIELD_API_SECRET?: string;
  HIGGSFIELD_IMAGE_MODEL?: string;
  RUNWAY_API_KEY?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  RESEND_API_KEY?: string;
  FACTS_BOOTSTRAP_SECRET?: string;
  MONITOR_SECRET?: string;
  // Phase B portal automation — when these are set, the provision endpoint
  // also creates the CF Pages project and attaches the custom domain.
  // Without them, those steps stay as manual instructions in the response.
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  // Optional shared values used by the CF Pages source config — defaults
  // are baked in below if not set.
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  // Shared HMAC secret with PennyBuilder. Used to authenticate the
  // /api/admin/provision-from-pennybuilder endpoint AND to verify the
  // HMAC-signed embed token on GET /embed.
  PENNYBUILDER_PROVISION_SECRET?: string;
  // Optional dedicated HMAC secret for ISS admin iframe embeds. When set,
  // /embed accepts ISS-minted tokens without sharing or rotating the
  // PennyBuilder provisioning secret.
  ISS_EMBED_SECRET?: string;
  // Richo Road Butchery server-to-server ingest. The Richo ordering app sends
  // staff-approved weekly-special/order-safe briefs here so SocialAI can create
  // real draft posts and verified context rows without a Clerk browser session.
  RICHO_ROAD_INGEST_API_KEY?: string;
  SOCIALAI_STUDIO_API_KEY?: string;
  RICHO_ROAD_AGENT_ACCOUNT_ID?: string;
  RICHO_ROAD_WORKSPACE_ID?: string;
  // My Assistant server-to-server ingest. My Assistant sends approval-gated
  // post, campaign, and social-reply draft requests into a mapped SocialAI
  // workspace. SOCIALAI_STUDIO_API_KEY remains a shared fallback while the
  // dedicated key is being rolled out.
  MY_ASSISTANT_INGEST_API_KEY?: string;
  MY_ASSISTANT_AGENT_ACCOUNT_ID?: string;
  MY_ASSISTANT_WORKSPACE_ID?: string;
  // Deployment-environment marker. Unset (or 'production') in prod. Set
  // to 'dev' / 'staging' in lower envs so cost-metering and other
  // observability helpers can no-op outside prod (see lib/ai-usage.ts).
  // This is a `[vars]` value in wrangler.toml, not a binding.
  ENVIRONMENT?: string;
  // When staging trusts a Clerk public JWT key, accept bearer sessions only
  // from these comma-separated user IDs and authorized browser origins.
  // Both must be configured or staging bearer authentication fails closed.
  STAGING_AUTH_ALLOWED_USER_IDS?: string;
  STAGING_AUTH_AUTHORIZED_PARTIES?: string;

  // Customer Learning Brain rollout controls. Both are literal-string,
  // off-by-default flags; workspace settings can only narrow behaviour.
  LEARNING_BRAIN_ENABLED?: string;
  LEARNING_RELEASE_ENFORCEMENT?: string;
  LEARNING_AUTOPILOT_ENABLED?: string;
  ORGANIC_REACH_ENABLED?: string;
  ORGANIC_REACH_APPLY_ENABLED?: string;

  // ── Postproxy integration (schema_v22, 2026-05) ─────────────────────────
  // Hosted publishing layer replacing direct FB Graph publishing. See
  // docs/POSTPROXY_INTEGRATION_PLAN.md + workers/api/src/lib/postproxy.ts.
  //
  // POSTPROXY_API_KEY — Bearer-prefixed onto every Postproxy request. Set
  //   with `wrangler secret put POSTPROXY_API_KEY` (this is required for the
  //   integration to function at all — non-secret env vars below override
  //   defaults safely).
  POSTPROXY_API_KEY: string;
  // POSTPROXY_BASE_URL — defaults to https://api.postproxy.dev/api when
  //   unset. Override only for staging / local-mock environments.
  POSTPROXY_BASE_URL?: string;
  // POSTPROXY_WEBHOOK_SECRET — shared HMAC-SHA256 secret used to verify
  //   inbound webhooks. Preferred over the query-string fallback. Set with
  //   `wrangler secret put POSTPROXY_WEBHOOK_SECRET`.
  POSTPROXY_WEBHOOK_SECRET?: string;
  // POSTPROXY_WEBHOOK_QUERY_SECRET — fallback shared secret carried in a
  //   `?secret=<value>` query string for environments where Postproxy can't
  //   sign webhook bodies. Either this OR HMAC verification must succeed.
  POSTPROXY_WEBHOOK_QUERY_SECRET?: string;
  // ENABLE_POSTPROXY — global kill switch. When set literally to the string
  //   'false', the publish cron forces every workspace back onto the legacy
  //   Graph path regardless of users.use_postproxy. Used for emergency
  //   rollback mid-cutover. Defaults to enabled (any other value treated as
  //   on, including unset).
  ENABLE_POSTPROXY?: string;

  // ── Shopify embedded app (Phase 1+2, schema_v25_shopify_*) ─────────────
  // SHOPIFY_API_KEY is the Client ID from your Shopify Partners dashboard
  // (also called the "API key"). Public — appears in the embedded app's
  // HTML <meta> tag and in the OAuth authorize URL. Safe to ship in vars.
  SHOPIFY_API_KEY?: string;
  // SHOPIFY_API_SECRET is the Client Secret. Used to:
  //   1. Verify HMAC on OAuth callbacks (query-string HMAC)
  //   2. Verify HMAC on inbound webhooks (X-Shopify-Hmac-Sha256 header)
  //   3. Verify session token JWTs from App Bridge (HS256 with this key)
  // MUST be set as a secret: `wrangler secret put SHOPIFY_API_SECRET`.
  SHOPIFY_API_SECRET?: string;
  // Public base URL where the embedded React app is hosted (CF Pages).
  // The OAuth callback handler redirects merchants here after install.
  SHOPIFY_APP_URL?: string;
  // OAuth scopes requested at install. Comma-separated. Phase 1 uses
  // "read_products" only. Keep the scope list minimal — the App Store
  // reviewer asks why each scope is needed.
  SHOPIFY_APP_SCOPES?: string;
  // Comma-separated shop domains where Shopify Billing API charges MUST
  // be created with `test: true`. Use this for dev stores whose plan_name
  // reports as a real paid plan but which can't be charged for real (no
  // payment method on file). Read by shouldForceTestMode in
  // lib/shopify-billing.ts.
  SHOPIFY_FORCE_TEST_SHOPS?: string;

  // ── At-rest encryption for D1-stored OAuth tokens ──────────────────────
  // 32-byte (256-bit) master key, hex-encoded. Used by lib/crypto.ts to
  // AES-GCM-encrypt Shopify access_tokens before they hit D1. Generate
  // with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
  // Set with: wrangler secret put MASTER_ENCRYPTION_KEY
  MASTER_ENCRYPTION_KEY?: string;

  // ── R2 bucket for Shopify-poster images ────────────────────────────────
  // The shop-scoped AI poster gallery (routes/shopify-posters.ts) stores
  // generated PNGs at shopify-posters/<id>.png. Shared with the main-app
  // poster bucket (binding: POSTER_ASSETS in wrangler.toml) — namespaced
  // by key prefix.
};
