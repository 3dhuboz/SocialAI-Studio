-- schema_v49_learning_pilot_media_jobs.sql
-- Staging-only, consent-bound media generation jobs for the record-only pilot.
-- This migration must never be applied to production.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_pilot_media_jobs (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 6),
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client')),
  owner_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image','video')),
  state TEXT NOT NULL CHECK (state IN ('claimed','generating','ready','failed')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 2),
  claim_token_hash TEXT NOT NULL CHECK (
    LENGTH(claim_token_hash) = 64
    AND claim_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  lease_expires_at TEXT NOT NULL,
  post_id TEXT UNIQUE,
  content TEXT,
  hashtags TEXT,
  image_prompt TEXT,
  thumbnail_url TEXT,
  media_url TEXT,
  content_hash TEXT CHECK (
    content_hash IS NULL
    OR (
      LENGTH(content_hash) = 64
      AND content_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  caption_provider TEXT,
  caption_model TEXT,
  caption_attempt_count INTEGER CHECK (
    caption_attempt_count IS NULL OR caption_attempt_count BETWEEN 1 AND 2
  ),
  archetype_slug TEXT,
  media_provider TEXT,
  media_model TEXT,
  provider_request_id TEXT,
  video_script TEXT,
  video_shots TEXT,
  error_code TEXT,
  generated_by TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  record_only INTEGER NOT NULL DEFAULT 1 CHECK (record_only = 1),
  UNIQUE(enrollment_id, slot),
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
  CHECK (
    (
      state = 'claimed'
      AND post_id IS NULL
      AND content IS NULL
      AND hashtags IS NULL
      AND image_prompt IS NULL
      AND thumbnail_url IS NULL
      AND media_url IS NULL
      AND content_hash IS NULL
      AND caption_provider IS NULL
      AND caption_model IS NULL
      AND caption_attempt_count IS NULL
      AND archetype_slug IS NULL
      AND media_provider IS NULL
      AND media_model IS NULL
      AND provider_request_id IS NULL
      AND video_script IS NULL
      AND video_shots IS NULL
      AND error_code IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      state = 'generating'
      AND media_kind = 'video'
      AND post_id IS NULL
      AND LENGTH(TRIM(COALESCE(content, ''))) BETWEEN 1 AND 5000
      AND LENGTH(TRIM(COALESCE(hashtags, ''))) BETWEEN 2 AND 1000
      AND LENGTH(TRIM(COALESCE(image_prompt, ''))) BETWEEN 40 AND 900
      AND thumbnail_url GLOB 'https://*'
      AND media_url IS NULL
      AND content_hash IS NULL
      AND LENGTH(TRIM(COALESCE(caption_provider, ''))) BETWEEN 2 AND 50
      AND LENGTH(TRIM(COALESCE(caption_model, ''))) BETWEEN 2 AND 100
      AND caption_attempt_count BETWEEN 1 AND 2
      AND LENGTH(TRIM(COALESCE(media_provider, ''))) BETWEEN 2 AND 50
      AND LENGTH(TRIM(COALESCE(media_model, ''))) BETWEEN 2 AND 150
      AND LENGTH(TRIM(COALESCE(provider_request_id, ''))) BETWEEN 3 AND 500
      AND LENGTH(TRIM(COALESCE(video_script, ''))) BETWEEN 10 AND 2000
      AND LENGTH(TRIM(COALESCE(video_shots, ''))) BETWEEN 2 AND 5000
      AND error_code IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      state = 'ready'
      AND post_id IS NOT NULL
      AND LENGTH(TRIM(COALESCE(content, ''))) BETWEEN 1 AND 5000
      AND LENGTH(TRIM(COALESCE(hashtags, ''))) BETWEEN 2 AND 1000
      AND LENGTH(TRIM(COALESCE(image_prompt, ''))) BETWEEN 40 AND 900
      AND thumbnail_url GLOB 'https://*'
      AND media_url GLOB 'https://*'
      AND content_hash IS NOT NULL
      AND LENGTH(TRIM(COALESCE(caption_provider, ''))) BETWEEN 2 AND 50
      AND LENGTH(TRIM(COALESCE(caption_model, ''))) BETWEEN 2 AND 100
      AND caption_attempt_count BETWEEN 1 AND 2
      AND LENGTH(TRIM(COALESCE(media_provider, ''))) BETWEEN 2 AND 50
      AND LENGTH(TRIM(COALESCE(media_model, ''))) BETWEEN 2 AND 150
      AND (
        (
          media_kind = 'image'
          AND media_url = thumbnail_url
          AND provider_request_id IS NULL
          AND video_script IS NULL
          AND video_shots IS NULL
        )
        OR
        (
          media_kind = 'video'
          AND LENGTH(TRIM(COALESCE(provider_request_id, ''))) BETWEEN 3 AND 500
          AND LENGTH(TRIM(COALESCE(video_script, ''))) BETWEEN 10 AND 2000
          AND LENGTH(TRIM(COALESCE(video_shots, ''))) BETWEEN 2 AND 5000
        )
      )
      AND error_code IS NULL
      AND completed_at IS NOT NULL
    )
    OR
    (
      state = 'failed'
      AND post_id IS NULL
      AND media_url IS NULL
      AND content_hash IS NULL
      AND LENGTH(TRIM(COALESCE(error_code, ''))) BETWEEN 3 AND 100
      AND completed_at IS NOT NULL
    )
  ),
  FOREIGN KEY (enrollment_id)
    REFERENCES learning_pilot_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_pilot_media_jobs_workspace
  ON learning_pilot_media_jobs(
    user_id, workspace_key, client_id, owner_kind, owner_id, state, slot
  );

CREATE TRIGGER IF NOT EXISTS validate_learning_pilot_media_job_insert
BEFORE INSERT ON learning_pilot_media_jobs
WHEN NEW.state <> 'claimed'
OR NOT EXISTS (
  SELECT 1
  FROM learning_pilot_enrollments enrollment
  WHERE enrollment.id = NEW.enrollment_id
    AND enrollment.user_id = NEW.user_id
    AND enrollment.workspace_key = NEW.workspace_key
    AND enrollment.client_id IS NEW.client_id
    AND enrollment.owner_kind = NEW.owner_kind
    AND enrollment.owner_id = NEW.owner_id
    AND enrollment.policy_version = NEW.policy_version
    AND enrollment.record_only = 1
    AND enrollment.consent_confirmed_at IS NOT NULL
    AND unixepoch(NEW.claimed_at) >= unixepoch(enrollment.consent_confirmed_at)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid record-only pilot media job');
END;

CREATE TRIGGER IF NOT EXISTS validate_learning_pilot_media_job_transition
BEFORE UPDATE ON learning_pilot_media_jobs
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.enrollment_id IS NOT OLD.enrollment_id
  OR NEW.slot IS NOT OLD.slot
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.workspace_key IS NOT OLD.workspace_key
  OR NEW.client_id IS NOT OLD.client_id
  OR NEW.owner_kind IS NOT OLD.owner_kind
  OR NEW.owner_id IS NOT OLD.owner_id
  OR NEW.policy_version IS NOT OLD.policy_version
  OR NEW.media_kind IS NOT OLD.media_kind
  OR NEW.generated_by IS NOT OLD.generated_by
  OR NEW.record_only IS NOT OLD.record_only
  OR NOT (
    (
      OLD.state = 'claimed'
      AND NEW.state IN ('generating','ready','failed')
      AND NEW.attempt_count = OLD.attempt_count
      AND NEW.claim_token_hash = OLD.claim_token_hash
      AND NEW.claimed_at = OLD.claimed_at
      AND NEW.lease_expires_at = OLD.lease_expires_at
    )
    OR
    (
      OLD.state = 'generating'
      AND NEW.state IN ('ready','failed')
      AND NEW.attempt_count = OLD.attempt_count
      AND NEW.claim_token_hash = OLD.claim_token_hash
      AND NEW.claimed_at = OLD.claimed_at
      AND NEW.lease_expires_at = OLD.lease_expires_at
    )
    OR
    (
      OLD.state IN ('claimed','failed')
      AND NEW.state = 'claimed'
      AND unixepoch(OLD.lease_expires_at) <= unixepoch(NEW.claimed_at)
      AND OLD.attempt_count = 1
      AND NEW.attempt_count = 2
      AND NEW.claim_token_hash <> OLD.claim_token_hash
      AND NEW.claimed_at <> OLD.claimed_at
      AND NEW.lease_expires_at <> OLD.lease_expires_at
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid record-only pilot media job transition');
END;

CREATE TRIGGER IF NOT EXISTS validate_learning_pilot_media_job_ready
BEFORE UPDATE ON learning_pilot_media_jobs
WHEN NEW.state = 'ready'
AND NOT EXISTS (
  SELECT 1
  FROM posts post
  WHERE post.id = NEW.post_id
    AND post.user_id = NEW.user_id
    AND post.client_id IS NEW.client_id
    AND post.owner_kind = NEW.owner_kind
    AND post.owner_id = NEW.owner_id
    AND post.content = NEW.content
    AND post.platform = 'facebook'
    AND post.hashtags = NEW.hashtags
    AND post.image_prompt = NEW.image_prompt
    AND post.image_url = NEW.thumbnail_url
    AND LOWER(TRIM(COALESCE(post.status, ''))) = 'draft'
    AND NULLIF(TRIM(COALESCE(post.scheduled_for, '')), '') IS NULL
    AND (
      (
        NEW.media_kind = 'image'
        AND post.post_type = 'image'
        AND post.video_url IS NULL
        AND post.video_status IS NULL
      )
      OR
      (
        NEW.media_kind = 'video'
        AND post.post_type = 'video'
        AND post.video_url = NEW.media_url
        AND LOWER(TRIM(COALESCE(post.video_status, ''))) = 'ready'
        AND post.video_script = NEW.video_script
        AND post.video_shots = NEW.video_shots
      )
    )
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
  SELECT RAISE(ABORT, 'invalid ready record-only pilot media job');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_media_job_ready_update
BEFORE UPDATE ON learning_pilot_media_jobs
WHEN OLD.state = 'ready'
BEGIN
  SELECT RAISE(ABORT, 'ready record-only pilot media jobs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_media_job_ready_delete
BEFORE DELETE ON learning_pilot_media_jobs
WHEN OLD.state = 'ready'
AND EXISTS (
  SELECT 1 FROM posts post WHERE post.id = OLD.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'ready record-only pilot media jobs require post-first deletion');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_media_enrollment_delete
BEFORE DELETE ON learning_pilot_enrollments
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_media_jobs job
  WHERE job.enrollment_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'record-only pilot media jobs require scoped withdrawal');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_media_post_update
BEFORE UPDATE OF
  user_id, client_id, owner_kind, owner_id, content, platform, status,
  scheduled_for, hashtags, image_url, topic, pillar, image_prompt,
  post_type, video_url, video_status, video_script, video_shots
ON posts
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_media_jobs job
  WHERE job.post_id = OLD.id
    AND job.state = 'ready'
)
AND (
  NEW.user_id IS NOT OLD.user_id
  OR NEW.client_id IS NOT OLD.client_id
  OR NEW.owner_kind IS NOT OLD.owner_kind
  OR NEW.owner_id IS NOT OLD.owner_id
  OR NEW.content IS NOT OLD.content
  OR NEW.platform IS NOT OLD.platform
  OR LOWER(TRIM(COALESCE(NEW.status, ''))) <> 'draft'
  OR NULLIF(TRIM(COALESCE(NEW.scheduled_for, '')), '') IS NOT NULL
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
  SELECT RAISE(ABORT, 'ready record-only pilot media posts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_media_publication_event
BEFORE INSERT ON publication_events
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_media_jobs job
  WHERE job.post_id = NEW.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'record-only pilot media candidates cannot be published');
END;

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_media_delivery
BEFORE INSERT ON publish_delivery_receipts
WHEN EXISTS (
  SELECT 1
  FROM learning_pilot_media_jobs job
  WHERE job.post_id = NEW.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'record-only pilot media candidates cannot enter delivery');
END;
