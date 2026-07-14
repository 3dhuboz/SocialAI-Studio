import { describe, expect, it } from 'vitest';
import {
  getWorkspaceLearningSummary,
} from '../lib/learning/read-model';
import { normalizeWorkspaceIdentity } from '../lib/learning/types';
import { makeRecordingD1 } from './helpers/recording-d1';

describe('workspace learning read model', () => {
  it('returns bounded profile, signal, and outcome evidence under the full owner tuple', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_profiles': [{
        version: 3,
        profile_json: JSON.stringify({ generatedAt: '2026-07-14T00:00:00.000Z' }),
        approved: 0,
        created_at: '2026-07-14T00:00:00.000Z',
      }],
      'FROM learning_signals ls': [{
        variable_key: 'media_format', variable_value: 'image',
        objective: 'meaningful_engagement', sample_count: 12,
        effect: 0.24, confidence: 0.8,
        freshness_at: '2026-07-14T00:00:00.000Z', status: 'proven',
        experiment_isolated: 0,
      }, {
        variable_key: 'posting_hour', variable_value: '18',
        objective: 'tracked_action', sample_count: 10,
        effect: -0.12, confidence: 0.7,
        freshness_at: '2026-07-13T00:00:00.000Z', status: 'usable',
        experiment_isolated: 1,
      }],
      'FROM learning_outcomes lo': [{
        id: 'outcome-1', post_id: 'post-1', platform: 'facebook',
        post_type: 'image', content: 'Local offer', window_hours: 168,
        raw_signals_json: '{"engagement":14}', normalized_score: 78,
        completeness: 'engagement', source_status: 'complete',
        published_at: '2026-07-07T00:00:00.000Z', measured_at: '2026-07-14T00:00:00.000Z',
      }],
    });
    const identity = normalizeWorkspaceIdentity('owner-1', 'client-1', 'client', 'client-1');

    const summary = await getWorkspaceLearningSummary(db, identity);

    expect(summary.profile).toEqual({
      version: 3,
      approved: false,
      createdAt: '2026-07-14T00:00:00.000Z',
      data: { generatedAt: '2026-07-14T00:00:00.000Z' },
    });
    expect(summary.signals).toEqual([
      expect.objectContaining({
        variableKey: 'media_format', variableValue: 'image',
        evidenceKind: 'association', sampleCount: 12,
      }),
      expect.objectContaining({
        variableKey: 'posting_hour', variableValue: '18',
        evidenceKind: 'experiment', effect: -0.12,
      }),
    ]);
    expect(summary.outcomes).toEqual([
      expect.objectContaining({
        id: 'outcome-1', postId: 'post-1', rawSignals: { engagement: 14 },
      }),
    ]);

    const profileRead = calls.find((call) => call.sql.includes('FROM learning_profiles'))!;
    const signalRead = calls.find((call) => call.sql.includes('FROM learning_signals ls'))!;
    const outcomeRead = calls.find((call) => call.sql.includes('FROM learning_outcomes lo'))!;
    expect(profileRead.binds).toEqual(['owner-1', 'client-1', 'client-1', 'client', 'client-1']);
    expect(signalRead.binds).toEqual(['owner-1', 'client-1', 'client-1', 'client', 'client-1', 100]);
    expect(outcomeRead.binds).toEqual(['owner-1', 'client-1', 'client-1', 'client', 'client-1', 20]);
    expect(outcomeRead.sql).toContain('pe.client_id IS ?');
    expect(signalRead.sql).toContain('FROM learning_experiments e');
    expect(outcomeRead.sql).toContain('p.owner_kind = pe.owner_kind');
    expect(outcomeRead.sql).toContain('p.owner_id = pe.owner_id');
  });

  it('fails closed to empty JSON objects for malformed stored evidence', async () => {
    const { db } = makeRecordingD1({
      'FROM learning_profiles': [{
        version: 1, profile_json: 'not-json', approved: 0, created_at: 'now',
      }],
      'FROM learning_signals ls': [],
      'FROM learning_outcomes lo': [{
        id: 'outcome-1', post_id: 'post-1', platform: 'facebook',
        post_type: null, content: null, window_hours: 24,
        raw_signals_json: '[]', normalized_score: null,
        completeness: 'none', source_status: 'unavailable',
        published_at: '2026-07-14T00:00:00.000Z', measured_at: '2026-07-14T00:00:00.000Z',
      }],
    });
    const identity = normalizeWorkspaceIdentity('owner-1', null, 'user', 'owner-1');

    const summary = await getWorkspaceLearningSummary(db, identity);

    expect(summary.profile?.data).toEqual({});
    expect(summary.outcomes[0].rawSignals).toEqual({});
  });
});
