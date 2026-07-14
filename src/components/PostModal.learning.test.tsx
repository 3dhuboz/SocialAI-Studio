import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LearningDecision, ReachPlan } from '../services/db';
import { LearningSafetyReport, ReachPlanRationale } from './PostModal';

const decision: LearningDecision = {
  id: 'decision_1',
  post_id: 'post_1',
  mode: 'shadow',
  stage: 'release',
  release_state: 'hold_amber',
  content_hash: 'hash',
  summary: {
    pipelineState: 'pass_green',
    candidateChanged: true,
  },
  created_at: '2026-07-14T00:00:00Z',
  verdicts: [{
    id: 'verdict_1',
    decision_id: 'decision_1',
    critic_kind: 'fact',
    verdict: 'warn_repairable',
    severity: 'release_critical',
    confidence: 0.9,
    evidence: ['Unsupported price claim'],
    repairs: ['Remove the unverified price'],
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    attempt: 0,
  }],
};

const reachPlan: ReachPlan = {
  id: 'plan_1',
  postId: 'post_1',
  reachProfileId: 'reach_1',
  reachProfileVersion: 2,
  objective: 'local engagement',
  audienceSegmentId: 'segment_1',
  audience: { label: 'Local BBQ buyers', needs: ['weekend catering'] },
  status: 'shadow',
  createdAt: '2026-07-14T00:00:00Z',
  geographicFocus: ['Gladstone'],
  platformPlan: {
    facebook: { caption: 'Fresh from the smoker.', hashtags: ['#gladstone', '#bbq'] },
  },
  timing: [{
    weekday: 5, startHour: 18, endHour: 19, platform: 'facebook',
    mediaType: 'image', expectedScore: 76, confidence: 0.8,
    sampleSize: 12, source: 'account',
  }],
  language: {},
  hashtags: {
    localKeywords: ['gladstonebbq'],
    facebookTags: ['#gladstone', '#bbq'],
    instagramTags: ['#gladstone', '#lowandslow'],
    evidence: ['account hashtag evidence'],
  },
  media: {
    facebook: { source: 'approved_asset', assetId: 'asset_1', format: 'image', generate: false },
  },
  experiment: {},
};

describe('LearningSafetyReport', () => {
  it('renders the latest evidence and repairs in a collapsed read-only report', () => {
    const html = renderToStaticMarkup(
      <LearningSafetyReport decision={decision} loading={false} />,
    );

    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Safety report');
    expect(html).toContain('Needs attention');
    expect(html).toContain('Unsupported price claim');
    expect(html).toContain('Remove the unverified price');
    expect(html).toContain('A safer repair was proposed but has not replaced the scheduled post.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Approve');
  });

  it('renders complete organic reach rationale as shadow-only guidance', () => {
    const html = renderToStaticMarkup(
      <ReachPlanRationale plan={reachPlan} loading={false} platform="Facebook" />,
    );

    expect(html).toContain('Organic reach rationale');
    expect(html).toContain('Local BBQ buyers');
    expect(html).toContain('Gladstone');
    expect(html).toContain('Facebook-specific caption');
    expect(html).toContain('80% confidence');
    expect(html).toContain('gladstonebbq');
    expect(html).toContain('#gladstone');
    expect(html).toContain('Approved image');
    expect(html).toContain('Shadow advice only');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Apply plan');
  });
});
