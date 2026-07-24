-- schema_v48_learning_pilot_generated_drafts.sql
-- Immutable provenance for one authentic SocialAI-generated, record-only
-- staging Draft per current pilot enrollment. This table is staging-only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_pilot_generated_drafts (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL UNIQUE,
  post_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client')),
  owner_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (
    LENGTH(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  provider TEXT NOT NULL CHECK (LENGTH(TRIM(provider)) BETWEEN 2 AND 50),
  model TEXT NOT NULL CHECK (LENGTH(TRIM(model)) BETWEEN 2 AND 100),
  attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 2),
  generated_by TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  record_only INTEGER NOT NULL DEFAULT 1 CHECK (record_only = 1),
  CHECK (
    (
      owner_kind = 'user'
      AND client_id IS NULL
      AND workspace_key = '__owner__'
      AND owner_id = user_id
    )
    OR
    (
      owner_kind = 'client'
      AND client_id IS NOT NULL
      AND workspace_key = client_id
      AND owner_id = client_id
    )
  ),
  FOREIGN KEY (enrollment_id)
    REFERENCES learning_pilot_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_pilot_generated_drafts_workspace
  ON learning_pilot_generated_drafts(
    user_id, workspace_key, client_id, owner_kind, owner_id, generated_at DESC
  );

CREATE TRIGGER IF NOT EXISTS validate_learning_pilot_generated_draft_insert
BEFORE INSERT ON learning_pilot_generated_drafts
WHEN NOT EXISTS (
  SELECT 1
  FROM learning_pilot_enrollments enrollment
  INNER JOIN posts post
    ON post.id = NEW.post_id
   AND post.user_id = NEW.user_id
   AND post.client_id IS NEW.client_id
   AND post.owner_kind = NEW.owner_kind
   AND post.owner_id = NEW.owner_id
  WHERE enrollment.id = NEW.enrollment_id
    AND enrollment.user_id = NEW.user_id
    AND enrollment.workspace_key = NEW.workspace_key
    AND enrollment.client_id IS NEW.client_id
    AND enrollment.owner_kind = NEW.owner_kind
    AND enrollment.owner_id = NEW.owner_id
    AND enrollment.policy_version = NEW.policy_version
    AND enrollment.record_only = 1
    AND enrollment.consent_confirmed_at IS NOT NULL
    AND unixepoch(NEW.generated_at) >= unixepoch(enrollment.consent_confirmed_at)
    AND LOWER(TRIM(COALESCE(post.status, ''))) = 'draft'
    AND NULLIF(TRIM(COALESCE(post.scheduled_for, '')), '') IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM publication_events event WHERE event.post_id = NEW.post_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM publish_delivery_receipts delivery
      WHERE delivery.post_id = NEW.post_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid record-only pilot generated draft receipt');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_generated_draft_update
BEFORE UPDATE ON learning_pilot_generated_drafts
BEGIN
  SELECT RAISE(ABORT, 'learning pilot generated draft receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_generated_draft_scheduling
BEFORE UPDATE OF
  user_id, client_id, owner_kind, owner_id, content, platform, status,
  scheduled_for, hashtags, image_url, topic, pillar, image_prompt,
  post_type, video_url, video_status, video_script, video_shots
ON posts
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_generated_drafts generated
  WHERE generated.post_id = OLD.id
)
AND (
  NEW.user_id IS NOT OLD.user_id
  OR NEW.content IS NOT OLD.content
  OR NEW.platform IS NOT OLD.platform
  OR LOWER(TRIM(COALESCE(NEW.status, ''))) <> 'draft'
  OR NULLIF(TRIM(COALESCE(NEW.scheduled_for, '')), '') IS NOT NULL
  OR NEW.client_id IS NOT OLD.client_id
  OR NEW.owner_kind IS NOT OLD.owner_kind
  OR NEW.owner_id IS NOT OLD.owner_id
  OR NEW.hashtags IS NOT OLD.hashtags
  OR NEW.image_url IS NOT OLD.image_url
  OR NEW.topic IS NOT OLD.topic
  OR NEW.pillar IS NOT OLD.pillar
  OR NEW.image_prompt IS NOT OLD.image_prompt
  OR NEW.post_type IS NOT OLD.post_type
  OR NEW.video_url IS NOT OLD.video_url
  OR NEW.video_status IS NOT OLD.video_status
  OR NEW.video_script IS NOT OLD.video_script
  OR NEW.video_shots IS NOT OLD.video_shots
)
BEGIN
  SELECT RAISE(ABORT, 'record-only pilot generated drafts are immutable and cannot be scheduled');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_generated_publication_event
BEFORE INSERT ON publication_events
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_generated_drafts generated
  WHERE generated.post_id = NEW.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'record-only pilot generated drafts cannot be published');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_generated_delivery
BEFORE INSERT ON publish_delivery_receipts
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_generated_drafts generated
  WHERE generated.post_id = NEW.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'record-only pilot generated drafts cannot enter delivery');
END;
