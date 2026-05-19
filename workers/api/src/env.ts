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
  RUNWAY_API_KEY?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  RESEND_API_KEY?: string;
  FACTS_BOOTSTRAP_SECRET?: string;
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

  // ── Shopify embedded app (Phase 1, schema_v17) ─────────────────────────
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
  // Default during setup: "https://shopify.socialaistudio.au".
  SHOPIFY_APP_URL?: string;
  // OAuth scopes requested at install. Comma-separated. Phase 1 uses
  // "read_products" only; Phase 2 adds "write_products" if we need
  // product-tagging back. Keep the scope list minimal — the App Store
  // reviewer asks why each scope is needed.
  SHOPIFY_APP_SCOPES?: string;
  // Comma-separated shop domains where Shopify Billing API charges MUST
  // be created with `test: true`. Use this for dev stores whose plan_name
  // reports as a real paid plan ("basic", "shopify", etc.) but which can't
  // be charged for real (no payment method on file). isTestStore handles
  // the well-known dev plan names; this var is the escape hatch for
  // edge cases. Read by shouldForceTestMode in lib/shopify-billing.ts.
  SHOPIFY_FORCE_TEST_SHOPS?: string;

  // ── At-rest encryption for D1-stored OAuth tokens ──────────────────────
  // 32-byte (256-bit) master key, hex-encoded. Used by lib/crypto.ts to
  // AES-GCM-encrypt Shopify access_tokens (and any future OAuth refresh
  // tokens) before they hit D1. Generate with:
  //   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
  // Set as a worker secret:
  //   npx wrangler secret put MASTER_ENCRYPTION_KEY
  //
  // OPTIONAL: when this is not set, the route + cron code logs a warning
  // and falls back to storing/reading plaintext (so a missing secret does
  // NOT take down installs). Once it IS set, new writes are encrypted and
  // existing plaintext rows decrypt to themselves transparently and get
  // upgraded on their next write.
  MASTER_ENCRYPTION_KEY?: string;
};
