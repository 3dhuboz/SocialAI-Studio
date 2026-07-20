import { describe, expect, it } from 'vitest';
import {
  EXPECTED_GLADSTONE_ATTESTATION,
  EXPECTED_GLADSTONE_POST_ID,
  EXPECTED_OWNER_COPY_STATEMENT,
  buildOwnerApplySql,
  buildOwnerRollbackSql,
  buildOwnerWithdrawalSql,
  classifyOwnerDraft,
  copiedOwnerPostId,
  serverSelectOwnerDraft,
  validateDualPilotAuthorization,
  type DualPilotAuthorizationReceipt,
  type OwnerSourceDraft,
} from '../../scripts/learning-owner-pilot-staging-copy';
import { EXPECTED_USER_ID } from '../../scripts/learning-pilot-staging-copy';

const authorization: DualPilotAuthorizationReceipt = {
  schemaVersion: 1,
  receiptId: 'pilot-authorization-penny-owner-gladstone-gradient-20260720',
  capturedAt: '2026-07-20T01:47:33.413Z',
  source: {
    kind: 'user_provided_attestation',
    threadId: '019ed317-7f47-7b22-ae5e-0fab6b0218c6',
  },
  statements: {
    gladstoneExactDraft: EXPECTED_GLADSTONE_ATTESTATION,
    pennyWiseOwnerDraftCopy: EXPECTED_OWNER_COPY_STATEMENT,
  },
  grants: {
    gladstoneExactDraft: {
      postId: EXPECTED_GLADSTONE_POST_ID,
      clientId: 'gladstonebbq-001',
      recordOnly: true,
      genuineSocialAiOutput: true,
      publishDisposition: 'rejected',
      rejectionReason: 'irrelevant_image',
      scheduleAllowed: false,
      publishAllowed: false,
      learningApplyAllowed: false,
    },
    pennyWiseOwnerDraftCopy: {
      userId: EXPECTED_USER_ID,
      workspaceKey: '__owner__',
      maxDrafts: 1,
      serverSelected: true,
      requiresUnpublished: true,
      copyProfileAllowed: false,
      isolatedStaging: true,
      recordOnly: true,
      scheduleAllowed: false,
      publishAllowed: false,
      learningApplyAllowed: false,
    },
  },
  withdrawal: {
    allowed: true,
    effect: 'Delete only the copied staging Draft and its derived learning evidence.',
  },
};

function draft(patch: Partial<OwnerSourceDraft> = {}): OwnerSourceDraft {
  return {
    id: 'owner-draft-1',
    user_id: EXPECTED_USER_ID,
    client_id: null,
    content: 'A practical workflow automation lesson for Australian small businesses.',
    platform: 'Facebook',
    status: 'Draft',
    scheduled_for: '2026-07-16T18:00:00.000Z',
    hashtags: '["#SmallBusiness"]',
    image_url: 'https://example.com/workflow.jpg',
    topic: 'Workflow automation',
    pillar: 'Practical technology',
    created_at: '2026-07-15T08:00:00.000Z',
    post_type: 'image',
    owner_kind: 'user',
    owner_id: EXPECTED_USER_ID,
    late_post_id: null,
    video_url: null,
    video_request_id: null,
    audio_mixed_url: null,
    claim_id: null,
    claim_at: null,
    fb_video_id: null,
    fb_publish_state: null,
    postproxy_post_id: null,
    postproxy_status: null,
    postproxy_permalink: null,
    postproxy_sent_at: null,
    postproxy_finished_at: null,
    publish_attempts: 0,
    qa_feedback_target: null,
    qa_feedback_reason: null,
    qa_feedback_note: null,
    qa_feedback_at: null,
    publication_event_count: 0,
    delivery_receipt_count: 0,
    ...patch,
  };
}

describe('owner learning pilot staging copy', () => {
  it('accepts only the two exact record-only authorization statements', () => {
    expect(validateDualPilotAuthorization(authorization)).toEqual(authorization);
    expect(() => validateDualPilotAuthorization({
      ...authorization,
      grants: {
        ...authorization.grants,
        pennyWiseOwnerDraftCopy: {
          ...authorization.grants.pennyWiseOwnerDraftCopy,
          maxDrafts: 2,
        },
      },
    } as unknown as DualPilotAuthorizationReceipt)).toThrow('exactly one');
    expect(() => validateDualPilotAuthorization({
      ...authorization,
      grants: {
        ...authorization.grants,
        gladstoneExactDraft: {
          ...authorization.grants.gladstoneExactDraft,
          publishAllowed: true,
        },
      },
    } as unknown as DualPilotAuthorizationReceipt)).toThrow('rejected for publishing');
  });

  it('rejects non-owner, published, claimed, video, QA, or delivered Drafts', () => {
    expect(classifyOwnerDraft(draft())).toEqual([]);
    expect(classifyOwnerDraft(draft({ client_id: 'client-1' }))).toContain('wrong_workspace');
    expect(classifyOwnerDraft(draft({ late_post_id: 'external' })))
      .toContain('external_publish_marker:late_post_id');
    expect(classifyOwnerDraft(draft({ claim_id: 'claim' })))
      .toContain('external_publish_marker:claim_id');
    expect(classifyOwnerDraft(draft({ video_request_id: 'video-job' })))
      .toContain('external_publish_marker:video_request_id');
    expect(classifyOwnerDraft(draft({ qa_feedback_target: 'image' })))
      .toContain('existing_qa_feedback');
    expect(classifyOwnerDraft(draft({ publication_event_count: 1 })))
      .toContain('publication_event_present');
    expect(classifyOwnerDraft(draft({ delivery_receipt_count: 1 })))
      .toContain('delivery_receipt_present');
  });

  it('selects exactly one eligible Draft deterministically regardless of input order', () => {
    const rows = [draft({ id: 'a' }), draft({ id: 'b' }), draft({ id: 'c' })];
    const forward = serverSelectOwnerDraft(rows, authorization.receiptId);
    const reverse = serverSelectOwnerDraft([...rows].reverse(), authorization.receiptId);

    expect(forward.selected.id).toBe(reverse.selected.id);
    expect(forward.eligibleCount).toBe(3);
    expect(forward.excludedCount).toBe(0);
  });

  it('copies a canonical owner Draft with schedules and publishing metadata cleared', () => {
    const row = draft();
    const sql = buildOwnerApplySql(row, '2026-07-20T01:50:00.000Z');

    expect(sql).toContain(copiedOwnerPostId(row.id));
    expect(sql.replace(/\s+/g, '')).toContain(",'Facebook','Draft',NULL,");
    expect(sql).toContain("'image','user'");
    expect(sql).not.toContain(row.scheduled_for!);
    expect(sql).not.toContain('late_post_id');
    expect(sql).not.toContain('learning_pilot_enrollments');
    expect(sql).not.toContain('workspace_learning_settings');
    expect(sql).not.toContain('social_tokens');
  });

  it('limits rollback to an unprocessed copied Draft', () => {
    const copiedId = copiedOwnerPostId('source-1');
    const sql = buildOwnerRollbackSql(copiedId);

    expect(sql).toContain(`id = '${copiedId}'`);
    expect(sql).not.toContain('workspace_key');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM learning_decisions');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM publication_events');
    expect(sql).not.toContain('DELETE FROM users');
    expect(sql).not.toContain('DELETE FROM workspace_learning_settings');
  });

  it('withdraws only the copied post and its decision-scoped evidence', () => {
    const copiedId = copiedOwnerPostId('source-1');
    const sql = buildOwnerWithdrawalSql(copiedId);

    expect(sql).toContain(`post_id = '${copiedId}'`);
    expect(sql).toContain("workspace_key = '__owner__'");
    expect(sql).toContain('DELETE FROM learning_critic_verdicts');
    expect(sql).toContain('DELETE FROM learning_pilot_samples');
    expect(sql).toContain('DELETE FROM learning_decisions');
    expect(sql).not.toContain('DELETE FROM users');
    expect(sql).not.toContain('DELETE FROM workspace_learning_settings');
    expect(sql).not.toContain('DELETE FROM learning_pilot_enrollments');
  });
});
