import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  LearningSummary,
  ReachAudienceSegment,
  ReachProfile,
} from '../services/db';
import { WhatsWorkingSummary } from './WhatsWorkingPanel';

const summary: LearningSummary = {
  profile: {
    version: 4,
    approved: false,
    createdAt: '2026-07-14T08:30:00.000Z',
    data: {},
  },
  signals: [
    {
      variableKey: 'media_format', variableValue: 'image', objective: 'local_orders',
      sampleCount: 12, effect: 0.32, confidence: 0.9,
      freshnessAt: '2026-07-14T08:00:00.000Z', status: 'proven', evidenceKind: 'experiment',
    },
    {
      variableKey: 'posting_hour', variableValue: '18', objective: 'local_orders',
      sampleCount: 8, effect: 0.18, confidence: 0.75,
      freshnessAt: '2026-07-13T08:00:00.000Z', status: 'usable', evidenceKind: 'association',
    },
    {
      variableKey: 'weekday', variableValue: '5', objective: 'local_orders',
      sampleCount: 7, effect: -0.16, confidence: 0.7,
      freshnessAt: '2026-07-12T08:00:00.000Z', status: 'usable', evidenceKind: 'association',
    },
    {
      variableKey: 'media_format', variableValue: 'generated_image', objective: 'local_orders',
      sampleCount: 10, effect: -0.22, confidence: 0.8,
      freshnessAt: '2026-07-11T08:00:00.000Z', status: 'proven', evidenceKind: 'association',
    },
  ],
  outcomes: [{
    id: 'outcome_1', postId: 'post_1', platform: 'facebook', postType: 'image',
    content: 'Fresh from the smoker.', windowHours: 168,
    rawSignals: { reactions: 17, clicks: 6 }, normalizedScore: 78,
    completeness: 'complete', sourceStatus: 'available',
    publishedAt: '2026-07-07T08:00:00.000Z', measuredAt: '2026-07-14T08:00:00.000Z',
  }],
};

const profile: ReachProfile = {
  id: 'reach_1', version: 2, confirmationStatus: 'confirmed',
  timezone: 'Australia/Brisbane',
  baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
  serviceArea: { radiusKm: 40, included: ['Gladstone', 'Tannum Sands'] },
  excludedLocations: ['Rockhampton'], platforms: ['facebook', 'instagram'],
};

const segments: ReachAudienceSegment[] = [{
  id: 'segment_1', label: 'Local families planning an easy dinner',
  needs: ['easy local dinner'], messageAngles: ['local pickup'],
  suitableOffers: ['family pack'], evidence: ['confirmed service area'],
  confidence: 0.82, status: 'confirmed',
}];

describe('WhatsWorkingSummary', () => {
  it('is mounted with the active agency client scope', () => {
    const dashboard = readFileSync(resolve(process.cwd(), 'src/components/HomeDashboard.tsx'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(dashboard).toContain("import { WhatsWorkingPanel } from './WhatsWorkingPanel';");
    expect(dashboard).toContain("import { ProtectedAutopilotPanel } from './ProtectedAutopilotPanel';");
    expect(dashboard).toContain('<WhatsWorkingPanel clientId={clientId} />');
    expect(dashboard).toContain('<ProtectedAutopilotPanel clientId={clientId} />');
    expect(app).toContain('clientId={activeClientId}');
  });

  it('separates measured learning, isolated experiments, and reach predictions', () => {
    const html = renderToStaticMarkup(
      <WhatsWorkingSummary summary={summary} profile={profile} segments={segments} />,
    );

    expect(html).toContain("What&#x27;s working");
    expect(html).toContain('Image posts');
    expect(html).toContain('6:00 pm');
    expect(html).toContain('Friday');
    expect(html).toContain('Generated images');
    expect(html).toContain('90% confidence');
    expect(html).toContain('12 posts');
    expect(html).toContain('Isolated experiment');
    expect(html).toContain('Observed association');
    expect(html).toContain('Local families planning an easy dinner');
    expect(html).toContain('Predicted audience');
    expect(html).toContain('82% confidence');
    expect(html).toContain('Gladstone');
    expect(html).toContain('40 km');
    expect(html).toContain('Recent changes');
    expect(html).toContain('Profile version 4');
    expect(html).toContain('Associations are not proof of causation');
  });

  it('does not invent topic, offer, CTA, or hashtag performance', () => {
    const html = renderToStaticMarkup(
      <WhatsWorkingSummary summary={summary} profile={profile} segments={segments} />,
    );

    expect(html).toContain('Topic performance');
    expect(html).toContain('Offer performance');
    expect(html).toContain('CTA performance');
    expect(html).toContain('Hashtag performance');
    expect((html.match(/Not enough evidence yet/g) ?? [])).toHaveLength(4);
    expect(html).toContain('Predicted offer fit');
    expect(html).toContain('family pack');
    expect(html).not.toContain('Family pack wins');
    expect(html).not.toContain('proven audience');
  });

  it('shows a calm evidence-building state when no learning exists yet', () => {
    const html = renderToStaticMarkup(
      <WhatsWorkingSummary
        summary={{ profile: null, signals: [], outcomes: [] }}
        profile={null}
        segments={[]}
      />,
    );

    expect(html).toContain('Learning safely from published results');
    expect(html).toContain('No measured winners or weak spots yet');
    expect(html).not.toContain('0% confidence');
  });
});
