-- Attribute AI usage to an exact learning decision without weakening the
-- existing workspace-wide monthly budget ledger.
--
-- Apply to staging before deploying code that writes learning_decision_id.
-- Production remains on its documented schema until the release gates pass.

ALTER TABLE ai_usage
  ADD COLUMN learning_decision_id TEXT
  REFERENCES learning_decisions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ai_usage_learning_decision
  ON ai_usage(learning_decision_id, user_id, client_id, ts);

-- A scoped usage row must belong to the same canonical tenant and post as its
-- decision. This prevents attribution from crossing workspace boundaries even
-- if an application caller supplies mismatched identifiers.
CREATE TRIGGER IF NOT EXISTS guard_ai_usage_learning_decision_insert
BEFORE INSERT ON ai_usage
WHEN NEW.learning_decision_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM learning_decisions d
    WHERE d.id = NEW.learning_decision_id
      AND d.user_id = NEW.user_id
      AND d.client_id IS NEW.client_id
      AND d.post_id = NEW.post_id
  ) THEN RAISE(ABORT, 'invalid learning AI usage attribution') END;
END;

-- Attribution is append-only. Privacy erasure may still delete the usage row,
-- and deleting its parent decision cascades only its attributed usage rows.
CREATE TRIGGER IF NOT EXISTS prevent_ai_usage_learning_attribution_update
BEFORE UPDATE OF learning_decision_id, user_id, client_id, post_id ON ai_usage
WHEN OLD.learning_decision_id IS NOT NULL OR NEW.learning_decision_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'learning AI usage attribution is immutable');
END;
