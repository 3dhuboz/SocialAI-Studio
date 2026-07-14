import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LearningDecision } from '../services/db';
import { LearningSafetyReport } from './PostModal';

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
});
