/**
 * Tests for the ApiError class + isNotConnectedError type guard in db.ts.
 *
 * These two are the contract between the worker's 409 NOT_CONNECTED responses
 * (POST /api/posts and POST /api/postproxy/publish-now) and the App.tsx UX
 * that routes the user to Settings → Connect Facebook/Instagram instead of
 * toasting a raw error blob. Drift here silently breaks the reconnect CTA.
 *
 * Coverage targets the exact `instanceof + status + body.code` triple-check
 * — narrow enough that a regression (e.g. someone widening the guard to
 * accept any 409, or someone narrowing it to only Facebook) fails loudly.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ApiError, createDb, isNotConnectedError, mapDbPostToSocialPost } from '../db';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNotConnectedError', () => {
  it('returns true for canonical 409 NOT_CONNECTED with platform=facebook', () => {
    const err = new ApiError('Facebook not connected', 409, {
      error: 'Facebook not connected',
      code: 'NOT_CONNECTED',
      platform: 'facebook',
    });
    expect(isNotConnectedError(err)).toBe(true);
  });

  it('returns true for canonical 409 NOT_CONNECTED with platform=instagram', () => {
    const err = new ApiError('Instagram not connected', 409, {
      error: 'Instagram not connected',
      code: 'NOT_CONNECTED',
      platform: 'instagram',
    });
    expect(isNotConnectedError(err)).toBe(true);
  });

  it('returns false for 409 with a different code (e.g. RATE_LIMITED)', () => {
    const err = new ApiError('Rate limited', 409, {
      error: 'Too many requests',
      code: 'RATE_LIMITED',
    });
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for non-409 status even when code is NOT_CONNECTED', () => {
    // Defensive: the guard must require BOTH status === 409 AND
    // code === 'NOT_CONNECTED'. If a worker route ever returned a 500
    // with a NOT_CONNECTED body (it shouldn't), we still want the UX
    // to fall through to a generic toast, not the reconnect CTA.
    const err = new ApiError('Server error', 500, {
      error: 'Internal',
      code: 'NOT_CONNECTED',
    });
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for ApiError with null body', () => {
    const err = new ApiError('No body', 409, null);
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for a plain Error instance', () => {
    // Not an ApiError → instanceof check fails, guard returns false even
    // when the caller has tried to monkey-patch status/body on a plain
    // Error (TypeScript would also reject this, but the guard is the
    // runtime safety net).
    const err = new Error('Something broke');
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for non-Error values (string, undefined, null, plain object)', () => {
    // Catch-all: caught values from `catch (e)` clauses are `unknown` and
    // can be any JS value. The guard must safely reject all of them.
    expect(isNotConnectedError('not an error')).toBe(false);
    expect(isNotConnectedError(undefined)).toBe(false);
    expect(isNotConnectedError(null)).toBe(false);
    expect(isNotConnectedError({ status: 409, body: { code: 'NOT_CONNECTED' } })).toBe(false);
  });
});

describe('learning decision client', () => {
  it('carries the canonical client scope from D1 posts into the receipt request', async () => {
    const post = mapDbPostToSocialPost({
      id: 'post_1', client_id: 'client 1', content: 'Safe copy',
      platform: 'Facebook', status: 'Scheduled', scheduled_for: new Date().toISOString(),
      hashtags: [],
    });
    const fetchMock = vi.fn(async (_input: unknown) => new Response(
      JSON.stringify({ decisions: [{ id: 'decision_1', verdicts: [] }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const decisions = await db.getLearningDecisions(post.id, post.clientId);

    expect(post.clientId).toBe('client 1');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/learning/decisions/post_1?clientId=client%201',
    );
    expect(decisions).toEqual([{ id: 'decision_1', verdicts: [] }]);
  });

  it('keeps learning profile, settings, and readiness reads in the selected client scope', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      const body = url.includes('/profile')
        ? { profile: null, signals: [], outcomes: [] }
        : url.includes('/settings')
          ? { settings: { mode: 'approval', exists: true }, effectiveMode: 'approval' }
          : {
              policyVersion: '2026-07-14-v1',
              ready: false,
              stale: false,
              effectiveMode: 'approval',
              evaluatedAt: '2026-07-14T00:00:00.000Z',
              checks: { pilot: false },
              metrics: { pilotDecisions: 0 },
              cost: {
                monthlyAiSpendUsdCents: 120,
                telemetryCount: 4,
                monthlyAiBudgetUsdCents: 2000,
                withinBudget: true,
              },
              globalSwitches: {
                learningBrain: true,
                releaseEnforcement: false,
                protectedAutopilot: false,
              },
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const summary = await db.getLearningSummary('client 1');
    const settings = await db.getLearningSettings('client 1');
    const readiness = await db.getLearningReadiness('client 1');

    expect(summary).toEqual({ profile: null, signals: [], outcomes: [] });
    expect(settings.effectiveMode).toBe('approval');
    expect(readiness.cost.monthlyAiSpendUsdCents).toBe(120);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/api/learning/profile?clientId=client%201'),
      expect.stringContaining('/api/learning/settings?clientId=client%201'),
      expect.stringContaining('/api/learning/readiness?clientId=client%201'),
    ]);
  });

  it('sends only bounded customer controls and conversion feedback', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      const body = url.includes('/settings')
        ? {
            settings: {
              mode: 'protected_autopilot',
              autopublishConsentAt: '2026-07-14T00:00:00.000Z',
              autopublishPolicyVersion: '2026-07-14-v1',
              experimentRate: 0.1,
              monthlyAiBudgetUsdCents: 2500,
              exists: true,
            },
            effectiveMode: 'approval',
          }
        : { ok: true, feedbackId: 'feedback_1' };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    await db.updateLearningSettings({
      clientId: 'client_1',
      mode: 'protected_autopilot',
      consent: true,
      experimentRate: 0.1,
      monthlyAiBudgetUsdCents: 2500,
    });
    const feedback = await db.recordConversionFeedback('post 1', {
      clientId: 'client_1',
      calls: 2,
      messages: 3,
      leads: 1,
      bookings: 1,
      sales: 1,
      orderValueCents: 12900,
    });

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method,
      body: JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')),
    }));
    expect(calls[0]).toEqual({
      url: expect.stringContaining('/api/learning/settings'),
      method: 'PUT',
      body: {
        clientId: 'client_1',
        mode: 'protected_autopilot',
        consent: true,
        experimentRate: 0.1,
        monthlyAiBudgetUsdCents: 2500,
      },
    });
    expect(calls[0].body).not.toHaveProperty('userId');
    expect(calls[0].body).not.toHaveProperty('ownerId');
    expect(calls[1]).toEqual({
      url: expect.stringContaining('/api/learning/outcomes/post%201/feedback'),
      method: 'POST',
      body: {
        clientId: 'client_1',
        calls: 2,
        messages: 3,
        leads: 1,
        bookings: 1,
        sales: 1,
        orderValueCents: 12900,
      },
    });
    expect(feedback).toEqual({ ok: true, feedbackId: 'feedback_1' });
  });

  it('keeps admin operations read-only except for explicit adjudication labels', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      return new Response(JSON.stringify(
        url.includes('/adjudicate')
          ? { adjudicationId: 'adjudication_1' }
          : {
              policyVersion: '2026-07-14-v1',
              globalSwitches: {
                learningBrain: true,
                releaseEnforcement: false,
                protectedAutopilot: false,
              },
              readiness: { ready: false, stale: false, checks: {}, metrics: {} },
              workspaces: [{ workspaceKey: 'client_1', mode: 'approval' }],
            },
      ), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const operations = await db.getAdminLearningOperations(75);
    const result = await db.adjudicateLearningDecision('decision 1', {
      expectedState: 'block_red',
      severity: 'release_critical',
      note: 'The critic missed a prohibited claim.',
    });

    expect(operations.workspaces).toEqual([{ workspaceKey: 'client_1', mode: 'approval' }]);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/socialai-api\.steve-700\.workers\.dev\//,
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/learning/admin/operations?limit=75');
    const adjudicationCall = fetchMock.mock.calls[1];
    expect(String(adjudicationCall[0])).toContain(
      '/api/learning/decisions/decision%201/adjudicate',
    );
    expect((adjudicationCall[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((adjudicationCall[1] as RequestInit).body))).toEqual({
      expectedState: 'block_red',
      severity: 'release_critical',
      note: 'The critic missed a prohibited claim.',
    });
    expect(result).toEqual({ adjudicationId: 'adjudication_1' });
  });

  it('uses the bounded pilot queue and attests the exact real draft before validation', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      const payload = url.includes('/pilot/candidates')
        ? {
            recordOnly: true,
            candidates: [{
              clientId: 'client_1', ownerKind: 'client', ownerId: 'client_1',
              workspaceKey: 'client_1', label: 'Active Client',
              eligibleDraftCount: 4, samplePostId: 'draft_1', enrolled: false,
              monthlyAiBudgetUsdCents: null,
              sampleDraft: {
                postId: 'draft_1', content: 'Real customer draft content.',
                platform: 'facebook', hashtags: '["#RealBusiness"]',
                imageUrl: 'https://cdn.example.test/draft.jpg', postType: 'image',
                videoUrl: null, contentHash: 'a'.repeat(64),
              },
            }],
          }
        : url.endsWith('/pilot/enrollment')
          ? {
              withdrawn: true,
              alreadyWithdrawn: false,
              enrollmentId: 'pilot-enrollment-1',
              policyVersion: '2026-07-14-v1',
              workspaceKey: 'client_1',
              ownerKind: 'client',
              ownerId: 'client_1',
              mode: 'shadow',
              decisionsRemoved: 1,
              samplesRemoved: 1,
              generatedPilotDraftsDeleted: 1,
              sourcePostsDeleted: 0,
              publishingRecordsDeleted: 0,
              originalDraftsRetained: true,
              copiedStagingDataRequiresArtifactWithdrawal: true,
            }
          : url.includes('/pilot/generate-draft')
          ? {
              receiptId: 'generated-receipt-1',
              enrollmentId: 'pilot-enrollment-1',
              postId: 'draft_1',
              contentHash: 'a'.repeat(64),
              provider: 'anthropic',
              model: 'claude-haiku-4-5',
              attemptCount: 1,
              generatedAt: '2026-07-24T04:00:00.000Z',
              recordOnly: true,
              sourceStatus: 'Draft',
              scheduledFor: null,
              publishingAllowed: false,
              created: true,
            }
          : url.includes('/pilot/enroll')
          ? {
              workspaceKey: 'client_1', ownerKind: 'client', ownerId: 'client_1',
              mode: 'approval', monthlyAiBudgetUsdCents: 500,
              autopublishConsentAt: null, recordOnly: true,
            }
          : url.includes('/pilot/attest')
            ? {
                sampleId: 'sample_1', postId: 'draft_1', contentHash: 'a'.repeat(64),
                attestationBasis: 'customer_real_post',
                attestedAt: '2026-07-19T00:00:00.000Z', created: true,
                postMutated: false,
              }
          : {
              decisionId: 'decision_1', releaseState: 'pass_green',
              postId: 'draft_1', sourceStatus: 'Draft', postMutated: false,
            };
      return new Response(JSON.stringify(payload), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const queue = await db.getLearningPilotCandidates();
    const enrolled = await db.enrollLearningPilotWorkspace('client_1', 500, {
      confirmed: true,
      note: 'Customer confirmed record-only pilot participation by phone.',
    });
    const generated = await db.generateLearningPilotDraft('client_1');
    const attested = await db.attestLearningPilotDraft(
      'draft 1',
      'a'.repeat(64),
      'Admin confirmed this exact server-selected draft is a real business draft.',
    );
    const validated = await db.validateLearningPilotDraft('draft 1');
    const withdrawn = await db.withdrawLearningPilotWorkspace(
      'client_1',
      'Customer withdrew record-only pilot participation in writing.',
    );

    expect(queue.recordOnly).toBe(true);
    expect(queue.enrollments).toEqual([]);
    expect(queue.candidates[0].samplePostId).toBe('draft_1');
    expect(queue.candidates[0].sampleDraft?.contentHash).toBe('a'.repeat(64));
    expect(enrolled).toMatchObject({ mode: 'approval', recordOnly: true });
    expect(generated).toMatchObject({
      postId: 'draft_1',
      sourceStatus: 'Draft',
      scheduledFor: null,
      publishingAllowed: false,
      recordOnly: true,
    });
    expect(attested).toMatchObject({
      sampleId: 'sample_1', created: true, postMutated: false,
    });
    expect(validated).toMatchObject({
      decisionId: 'decision_1', postMutated: false, sourceStatus: 'Draft',
    });
    expect(withdrawn).toMatchObject({
      withdrawn: true,
      sourcePostsDeleted: 0,
      publishingRecordsDeleted: 0,
      originalDraftsRetained: true,
      generatedPilotDraftsDeleted: 1,
    });
    expect(calls.every(({ url }) =>
      url.startsWith('https://socialai-api-staging.steve-700.workers.dev/'))).toBe(true);
    expect(calls).toEqual([
      {
        url: expect.stringContaining('/api/learning/pilot/candidates'),
        method: 'GET', body: null,
      },
      {
        url: expect.stringContaining('/api/learning/pilot/enroll'),
        method: 'POST',
        body: {
          clientId: 'client_1',
          monthlyAiBudgetUsdCents: 500,
          customerConsentConfirmed: true,
          customerConsentNote: 'Customer confirmed record-only pilot participation by phone.',
        },
      },
      {
        url: expect.stringContaining('/api/learning/pilot/generate-draft'),
        method: 'POST',
        body: {
          clientId: 'client_1',
          recordOnlyConfirmed: true,
        },
      },
      {
        url: expect.stringContaining('/api/learning/pilot/attest/draft%201'),
        method: 'POST',
        body: {
          realPostConfirmed: true,
          expectedContentHash: 'a'.repeat(64),
          note: 'Admin confirmed this exact server-selected draft is a real business draft.',
        },
      },
      {
        url: expect.stringContaining('/api/learning/pilot/validate/draft%201'),
        method: 'POST', body: {},
      },
      {
        url: expect.stringContaining('/api/learning/pilot/enrollment'),
        method: 'DELETE',
        body: {
          clientId: 'client_1',
          withdrawalConfirmed: true,
          withdrawalNote: 'Customer withdrew record-only pilot participation in writing.',
        },
      },
    ]);
  });
});

describe('organic reach client', () => {
  it('keeps profile and plan reads in the selected client scope', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      return new Response(JSON.stringify(
        url.includes('/plans/')
          ? { plans: [{ id: 'plan_1', postId: 'post_1', status: 'shadow' }] }
          : { profile: { id: 'reach_1' }, segments: [{ id: 'segment_1' }] },
      ), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const setup = await db.getReachProfile('client 1');
    const plans = await db.getReachPlans('post 1', 'client 1');

    expect(setup.profile).toEqual({ id: 'reach_1' });
    expect(setup.segments).toEqual([{ id: 'segment_1' }]);
    expect(plans).toEqual([{ id: 'plan_1', postId: 'post_1', status: 'shadow' }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/reach/profile?clientId=client%201',
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/api/reach/plans/post%201?clientId=client%201',
    );
  });

  it('sends only reviewed reach data and the selected client id to mutations', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      const body = url.includes('/segments/propose')
        ? { segments: [{ id: 'segment_1' }] }
        : url.includes('/segments/confirm')
          ? { segmentId: 'segment_1', status: 'confirmed' }
          : { profile: { id: 'reach_1' } };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    await db.proposeReachProfile({
      clientId: 'client_1',
      timezone: 'Australia/Brisbane',
      baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
      serviceArea: { radiusKm: 40, included: ['Gladstone'] },
      excludedLocations: ['Rockhampton'],
      platforms: ['facebook', 'instagram'],
    });
    await db.confirmReachProfile('reach_1', 'client_1');
    await db.proposeReachSegments('client_1');
    await db.confirmReachSegment('segment_1', 'client_1');

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method,
      body: JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')),
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      url: expect.stringContaining('/api/reach/profile/propose'),
      method: 'POST',
      body: expect.objectContaining({ clientId: 'client_1', timezone: 'Australia/Brisbane' }),
    }));
    expect(calls[0].body).not.toHaveProperty('userId');
    expect(calls[0].body).not.toHaveProperty('ownerId');
    expect(calls[1]).toEqual(expect.objectContaining({
      method: 'PUT', body: { profileId: 'reach_1', clientId: 'client_1' },
    }));
    expect(calls[2]).toEqual(expect.objectContaining({
      method: 'POST', body: { clientId: 'client_1' },
    }));
    expect(calls[3]).toEqual(expect.objectContaining({
      method: 'PUT', body: { segmentId: 'segment_1', clientId: 'client_1' },
    }));
  });
});
