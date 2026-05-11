-- SocialAI Studio — D1 schema migration v7
-- The Business Archetype Library: replaces the hardcoded `if`-cascade in
-- getImagePromptExamples / matchIndustry with a queryable D1 table. The
-- worker also caches the classifier's verdict per-user so we don't re-run
-- Haiku on every generation.
--
-- This is Phase 1 of the architecture redesign discussed 2026-05. Phase 2
-- (Cloudflare Vectorize as the cheap-fast first stage) slots in on top of
-- this table — the `description` column is what gets embedded.
--
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v7.sql --remote
-- Local dev:  npx wrangler d1 execute socialai-db --file=schema_v7.sql --local

CREATE TABLE IF NOT EXISTS business_archetypes (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Plain-English description of the archetype. This is what gets embedded
  -- in Phase 2 (Vectorize) and also what the Haiku classifier sees in the
  -- system prompt to choose from.
  description TEXT NOT NULL,
  -- JSON string array of substring keywords. Used as the cheap Layer-0
  -- match — if the user's businessType contains an exact keyword, we skip
  -- the LLM call. Keep this conservative; ambiguous matches should fall
  -- through to the classifier.
  keywords TEXT NOT NULL,
  -- JSON string array of 6-10 image-prompt scene templates. Each one is a
  -- complete scene description that FLUX can render. Replaces the hardcoded
  -- getImagePromptExamples branches.
  image_examples TEXT NOT NULL,
  -- Free-text notes about what NOT to render for this archetype
  -- (e.g. "no people, no UI mockups"). Concatenated into image prompts as a
  -- positive constraint, with FLUX_NEGATIVE_PROMPT handling the actual
  -- negative_prompt parameter.
  image_avoid_notes TEXT,
  -- Short voice description ("casual, mate-friendly, specific products and
  -- pricing called out by name"). Injected into Smart Schedule + single-post
  -- prompts so the AI matches the genre, not generic marketing copy.
  voice_cues TEXT,
  -- JSON string array of 4-6 content pillars (e.g. "Behind the Scenes",
  -- "Product Showcase"). These seed the Smart Schedule weekly rotation.
  content_pillars TEXT NOT NULL,
  -- Optional JSON array of regex patterns to additionally scrub for this
  -- archetype. NULL/empty means no archetype-specific extras — the global
  -- BANNED_PATTERNS still apply. Used when an archetype has known
  -- genre-specific tropes (e.g. "SaaS marketing" tropes for tech-agency).
  banned_trope_extras TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Cache the classifier's verdict on the user row so we don't re-classify
-- every generation. Re-classification is triggered explicitly by the user
-- (via Settings → Re-classify business) or implicitly if description/products
-- change substantially.
ALTER TABLE users ADD COLUMN archetype_slug TEXT;
ALTER TABLE users ADD COLUMN archetype_confidence REAL;
ALTER TABLE users ADD COLUMN archetype_reasoning TEXT;
ALTER TABLE users ADD COLUMN archetype_classified_at TEXT;

-- Index for the fast workspace-archetype lookup at generation time.
CREATE INDEX IF NOT EXISTS idx_users_archetype_slug ON users(archetype_slug);
