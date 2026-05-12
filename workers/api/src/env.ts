// Cloudflare runtime + Env type definitions for the worker.
//
// Extracted from src/index.ts as the first step of the route-module split
// (see WORKER_SPLIT_PLAN.md). The Env type + binding shims are referenced
// by every route handler, cron, and helper — having them in their own file
// means each future extracted module can `import type { Env } from './env'`
// without pulling in the rest of the 4000-LOC index.

// ── D1 type shim (provided by Cloudflare runtime) ────────────────────────
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<void>;
}

// ── R2 type shim (provided by Cloudflare runtime) ────────────────────────
// Minimal surface — we only put + delete reel videos. If we expand to reads
// or signed URLs later, add those methods then.
export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
}

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
};
