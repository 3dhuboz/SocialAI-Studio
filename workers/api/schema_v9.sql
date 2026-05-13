-- SocialAI Studio — D1 schema migration v9
-- Per-client archetype (Phase 1B closure for agency users).
--
-- Bug: the worker reads users.archetype_slug for EVERY post, including
-- posts that belong to an agency owner's client workspace. So a SocialAI
-- agency owner (archetype: tech-saas-agency) running Picklenick's account
-- (archetype: food-restaurant) gets tech guardrails applied to the food
-- client's posts — wrong direction, defeats the whole archetype system
-- for the highest-value plan tier.
--
-- Fix: clients get their own archetype_slug. Worker's resolveArchetypeSlug
-- helper prefers clients.archetype_slug when post.client_id is set, falls
-- back to users.archetype_slug otherwise.
--
-- Idempotent ALTER. Run via:
--   npx wrangler d1 execute socialai-db --file=workers/api/schema_v9.sql --remote

ALTER TABLE clients ADD COLUMN archetype_slug TEXT;
ALTER TABLE clients ADD COLUMN archetype_confidence REAL;
ALTER TABLE clients ADD COLUMN archetype_reasoning TEXT;
ALTER TABLE clients ADD COLUMN archetype_classified_at TEXT;
