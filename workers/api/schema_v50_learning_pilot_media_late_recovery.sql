-- schema_v50_learning_pilot_media_late_recovery.sql
-- Staging-only: permit one verified late Fal result to recover a timed-out
-- record-only video directly into an immutable Draft-backed ready receipt.
-- This migration must never be applied to production.

PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS validate_learning_pilot_media_job_transition;

CREATE TRIGGER validate_learning_pilot_media_job_transition
BEFORE UPDATE ON learning_pilot_media_jobs
WHEN OLD.state <> 'ready'
AND (
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
    OR
    (
      OLD.media_kind = 'video'
      AND OLD.state = 'failed'
      AND OLD.error_code = 'pilot_media_video_timed_out'
      AND OLD.post_id IS NULL
      AND OLD.media_url IS NULL
      AND OLD.content_hash IS NULL
      AND OLD.completed_at IS NOT NULL
      AND NEW.state = 'ready'
      AND NEW.attempt_count = OLD.attempt_count
      AND NEW.claim_token_hash = OLD.claim_token_hash
      AND NEW.claimed_at = OLD.claimed_at
      AND NEW.lease_expires_at = OLD.lease_expires_at
      AND NEW.content IS OLD.content
      AND NEW.hashtags IS OLD.hashtags
      AND NEW.image_prompt IS OLD.image_prompt
      AND NEW.thumbnail_url IS OLD.thumbnail_url
      AND NEW.caption_provider IS OLD.caption_provider
      AND NEW.caption_model IS OLD.caption_model
      AND NEW.caption_attempt_count IS OLD.caption_attempt_count
      AND NEW.archetype_slug IS OLD.archetype_slug
      AND NEW.media_provider IS OLD.media_provider
      AND NEW.media_model IS OLD.media_model
      AND NEW.provider_request_id IS OLD.provider_request_id
      AND NEW.video_script IS OLD.video_script
      AND NEW.video_shots IS OLD.video_shots
      AND NEW.error_code IS NULL
      AND NEW.post_id IS NOT NULL
      AND NEW.media_url IS NOT NULL
      AND NEW.content_hash IS NOT NULL
      AND NEW.completed_at IS NOT NULL
      AND unixepoch(NEW.updated_at) >= unixepoch(OLD.completed_at)
      AND unixepoch(NEW.updated_at) - unixepoch(OLD.completed_at) < 7200
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid record-only pilot media job transition');
END;
