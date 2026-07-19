import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CLIENT_ID,
  EXPECTED_USER_ID,
  buildApplySql,
  buildStagingWriteArgs,
  buildWithdrawalSql,
  classifyDraft,
  copiedPostId,
  sanitizeBusinessProfile,
  selectEligibleDrafts,
  validateConsentReceipt,
  type ConsentReceipt,
  type SourceDraft,
} from '../../scripts/learning-pilot-staging-copy';

const consent: ConsentReceipt = {
  schemaVersion: 1,
  receiptId: 'consent-gladstonebbq-001-20260720-record-only',
  capturedAt: '2026-07-19T22:40:07.724Z',
  source: {
    kind: 'user_provided_attestation',
    threadId: '019ed317-7f47-7b22-ae5e-0fab6b0218c6',
  },
  customer: {
    name: 'Gladstone BBQ Festival',
    clientId: EXPECTED_CLIENT_ID,
    userId: EXPECTED_USER_ID,
  },
  statement: 'I consent to SocialAI Studio copying Gladstone BBQ Festival\u2019s non-secret business profile and up to four unpublished drafts into isolated staging for record-only safety evaluation. Nothing may be scheduled or published, and consent may be withdrawn.',
  scope: {
    maxDrafts: 4,
    requiresUnpublished: true,
    isolatedStaging: true,
    recordOnly: true,
    scheduleAllowed: false,
    publishAllowed: false,
  },
  withdrawal: {
    allowed: true,
    effect: 'Delete imported staging profile, drafts, enrollment, settings, and derived learning data.',
  },
};

function draft(patch: Partial<SourceDraft> = {}): SourceDraft {
  return {
    id: 'draft-1',
    user_id: EXPECTED_USER_ID,
    client_id: EXPECTED_CLIENT_ID,
    content: 'Festival families can enjoy free rides and live music.',
    platform: 'Facebook',
    status: 'Draft',
    scheduled_for: '2026-05-16T17:00:00',
    hashtags: '["#FamilyFun"]',
    image_url: 'https://example.com/festival.jpg',
    topic: 'Family fun',
    pillar: 'Festival updates',
    created_at: '2026-05-07T07:02:11Z',
    post_type: 'image',
    owner_kind: 'client',
    owner_id: EXPECTED_CLIENT_ID,
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
    ...patch,
  };
}

describe('learning pilot staging copy', () => {
  it('accepts only the exact bounded Gladstone consent contract', () => {
    expect(validateConsentReceipt(consent)).toEqual(consent);
    expect(() => validateConsentReceipt({
      ...consent,
      scope: { ...consent.scope, publishAllowed: true },
    })).toThrow('publishing must be forbidden');
    expect(() => validateConsentReceipt({
      ...consent,
      scope: { ...consent.scope, maxDrafts: 5 },
    })).toThrow('four Drafts');
  });

  it('copies only allowlisted non-secret profile fields', () => {
    const result = sanitizeBusinessProfile(JSON.stringify({
      name: 'Gladstone BBQ Festival',
      type: 'BBQ festival and community event',
      description: 'Annual community festival in Gladstone.',
      tone: 'Friendly and professional',
      location: 'Australia, Gladstone, Qld',
      productsServices: 'BBQ competition, food vendors, live music.',
      contentTopics: 'Festival updates and community stories.',
      videoEnabled: false,
      facebookAppId: '',
      logoUrl: '',
    }));

    expect(result.profile).toEqual({
      name: 'Gladstone BBQ Festival',
      type: 'BBQ festival and community event',
      description: 'Annual community festival in Gladstone.',
      tone: 'Friendly and professional',
      location: 'Australia, Gladstone, Qld',
      productsServices: 'BBQ competition, food vendors, live music.',
      contentTopics: 'Festival updates and community stories.',
      videoEnabled: false,
    });
    expect(result.droppedKeys).toEqual(['facebookAppId', 'logoUrl']);
  });

  it('fails closed on secret-shaped or unapproved non-empty profile fields', () => {
    expect(() => sanitizeBusinessProfile({
      name: 'Gladstone BBQ Festival',
      description: 'Festival',
      apiToken: 'do-not-copy',
    })).toThrow('secret-shaped');
    expect(() => sanitizeBusinessProfile({
      name: 'Gladstone BBQ Festival',
      description: 'Festival',
      privateNotes: 'internal only',
    })).toThrow('not allowlisted');
  });

  it('rejects any Draft carrying evidence of publishing, claiming, video jobs, or QA', () => {
    expect(classifyDraft(draft())).toEqual([]);
    expect(classifyDraft(draft({ late_post_id: 'external-1' })))
      .toContain('external_publish_marker:late_post_id');
    expect(classifyDraft(draft({ publish_attempts: 1 })))
      .toContain('publish_attempts_present');
    expect(classifyDraft(draft({ claim_id: 'claim-1' })))
      .toContain('external_publish_marker:claim_id');
    expect(classifyDraft(draft({ video_request_id: 'job-1' })))
      .toContain('external_publish_marker:video_request_id');
    expect(classifyDraft(draft({ qa_feedback_target: 'caption' })))
      .toContain('existing_qa_feedback');
    expect(classifyDraft(draft({ status: 'Scheduled' })))
      .toContain('not_draft');
  });

  it('selects no more than four eligible image Drafts and records exclusions', () => {
    const rows = [
      draft({ id: 'a' }),
      draft({ id: 'b', late_post_id: 'published-before' }),
      draft({ id: 'c' }),
      draft({ id: 'd' }),
      draft({ id: 'e' }),
      draft({ id: 'f' }),
    ];
    const result = selectEligibleDrafts(rows, 4);

    expect(result.selected.map((row) => row.id)).toEqual(['a', 'c', 'd', 'e']);
    expect(result.excluded).toContainEqual({
      id: 'b',
      reasons: ['external_publish_marker:late_post_id'],
    });
    expect(result.excluded).toContainEqual({ id: 'f', reasons: ['consent_limit'] });
  });

  it('builds staging-only, record-only SQL with every publish path cleared', () => {
    const sql = buildApplySql({
      consent,
      client: {
        id: EXPECTED_CLIENT_ID,
        user_id: EXPECTED_USER_ID,
        name: 'Gladstone BBQ Festival',
        business_type: 'BBQ festival and community event',
        status: 'active',
        archetype_slug: 'bbq-smokehouse',
      },
      sanitizedProfile: { name: 'Gladstone BBQ Festival', description: 'Festival' },
      drafts: [draft()],
      appliedAt: '2026-07-19T22:45:00.000Z',
      monthlyBudgetCents: 500,
    });

    expect(sql).toContain("'Draft',NULL");
    expect(sql).toContain("'customer_attested'");
    expect(sql).toContain(',1,');
    expect(sql.replace(/\s+/g, '')).toContain("'approval',NULL,NULL,0,500,NULL");
    expect(sql).not.toContain('2026-05-16T17:00:00');
    expect(sql).not.toContain('late_post_id');
    expect(sql).not.toContain('social_tokens');
    expect(sql).not.toContain('postproxy_post_id');
    expect(sql).not.toContain('protected_autopilot');
  });

  it('can only target the named staging database for writes', () => {
    expect(buildStagingWriteArgs('C:/Temp/import.sql')).toEqual([
      'd1', 'execute', 'socialai-db-staging', '--remote', '--env', 'staging',
      '--config', 'wrangler.toml', '--file', 'C:/Temp/import.sql',
    ]);
  });

  it('builds a withdrawal purge scoped to only the imported workspace and rows', () => {
    const copiedPostIds = [copiedPostId('source-1'), copiedPostId('source-2')];
    const sql = buildWithdrawalSql({
      consent,
      copiedPostIds,
      withdrawnAt: '2026-07-19T22:46:00.000Z',
    });

    expect(sql).toContain("workspace_key = 'gladstonebbq-001'");
    expect(sql).toContain("user_id = 'user_3B9YKodZsIQjLdGW8wtwd7mmBMQ'");
    expect(sql).toContain(`id IN ('${copiedPostIds[0]}','${copiedPostIds[1]}')`);
    expect(sql).toContain('DELETE FROM learning_pilot_enrollments');
    expect(sql).toContain('DELETE FROM workspace_learning_settings');
    expect(sql).toContain('DELETE FROM clients');
    expect(sql).not.toContain('DELETE FROM users');
  });
});
