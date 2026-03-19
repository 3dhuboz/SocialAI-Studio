-- SocialAI Studio — D1 schema migration v3
-- Adds dedicated social_tokens column to users + clients.
-- Tokens are never cached in browser localStorage — only served from D1.
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v3.sql --remote

ALTER TABLE users   ADD COLUMN social_tokens TEXT DEFAULT '{}';
ALTER TABLE clients ADD COLUMN social_tokens TEXT DEFAULT '{}';
