import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReachAudienceSegment, ReachProfile } from '../services/db';
import { ReachProfileSummary } from './ReachProfilePanel';

const profile: ReachProfile = {
  id: 'reach_1',
  version: 3,
  confirmationStatus: 'confirmed',
  timezone: 'Australia/Brisbane',
  baseLocation: {
    country: 'Australia', region: 'Queensland', locality: 'Gladstone',
  },
  serviceArea: { radiusKm: 40, included: ['Gladstone', 'Tannum Sands'] },
  excludedLocations: ['Rockhampton'],
  platforms: ['facebook', 'instagram'],
  confirmedAt: '2026-07-14T00:00:00Z',
};

const segments: ReachAudienceSegment[] = [{
  id: 'segment_1',
  label: 'Local families planning an easy dinner',
  needs: ['easy local dinner'],
  messageAngles: ['local pickup'],
  suitableOffers: ['family pack'],
  evidence: ['confirmed Gladstone service area'],
  confidence: 0.82,
  status: 'predicted',
}];

describe('ReachProfileSummary', () => {
  it('is mounted with the active agency client scope', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/AiEnginePanel.tsx'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(panel).toContain("import { ReachProfilePanel } from './ReachProfilePanel';");
    expect(panel).toContain('<ReachProfilePanel clientId={clientId} />');
    expect(app).toContain('<AiEnginePanel isSuperAdmin={isSuperAdmin} clientId={activeClientId} />');
  });

  it('shows every confirmed geographic field and predicted segment for review', () => {
    const html = renderToStaticMarkup(
      <ReachProfileSummary
        profile={profile}
        segments={segments}
        busy={false}
        onEdit={() => undefined}
        onConfirmProfile={() => undefined}
        onPredictSegments={() => undefined}
        onConfirmSegment={() => undefined}
      />,
    );

    expect(html).toContain('Organic reach profile');
    expect(html).toContain('Gladstone, Queensland, Australia');
    expect(html).toContain('Australia/Brisbane');
    expect(html).toContain('40 km');
    expect(html).toContain('Gladstone');
    expect(html).toContain('Tannum Sands');
    expect(html).toContain('Rockhampton');
    expect(html).toContain('Facebook');
    expect(html).toContain('Instagram');
    expect(html).toContain('Local families planning an easy dinner');
    expect(html).toContain('82% confidence');
    expect(html).toContain('Confirm audience');
    expect(html).toContain('cannot change scheduling or publishing');
    expect(html).not.toContain('Auto-publish');
  });

  it('requires explicit confirmation for a newly proposed immutable version', () => {
    const html = renderToStaticMarkup(
      <ReachProfileSummary
        profile={{ ...profile, confirmationStatus: 'proposed', version: 4 }}
        segments={[]}
        busy={false}
        onEdit={() => undefined}
        onConfirmProfile={() => undefined}
        onPredictSegments={() => undefined}
        onConfirmSegment={() => undefined}
      />,
    );

    expect(html).toContain('Proposed version 4');
    expect(html).toContain('Confirm reviewed profile');
    expect(html).not.toContain('Predict audiences');
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
