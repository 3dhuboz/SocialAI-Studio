import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Shopify learning controls', () => {
  const api = readFileSync(resolve(process.cwd(), 'shopify-app/src/api.ts'), 'utf8');
  const settings = readFileSync(resolve(process.cwd(), 'shopify-app/src/pages/Settings.tsx'), 'utf8');
  const autopilot = readFileSync(resolve(process.cwd(), 'shopify-app/src/pages/Autopilot.tsx'), 'utf8');

  it('uses signed shop-derived learning endpoints without caller identity fields', () => {
    expect(api).toContain('getShopifyLearningSummary');
    expect(api).toContain('getShopifyLearningSettings');
    expect(api).toContain('getShopifyLearningReadiness');
    expect(api).toContain('updateShopifyLearningSettings');
    expect(api).toContain('getShopifyLearningDecisions');
    expect(api).toContain('recordShopifyConversionFeedback');
    expect(api).toContain('None of these payloads accept shop, user, client, or owner ids.');
  });

  it('mounts one workspace consent control with every permanent safety gate visible', () => {
    expect(settings).toContain('<ProtectedAutopilotSettingsCard />');
    expect(settings).toContain('Consent and request Protected Autopilot');
    expect(settings).toContain('Permanent release gates');
    expect(settings).toContain('Tenant isolation proofs');
    expect(settings).toContain('This is one workspace-level consent, not per-post approval.');
  });

  it('loads immutable receipt and reach rationale from canonical saved post ids', () => {
    expect(autopilot).toContain('setSavedPostIds(result.saved)');
    expect(autopilot).toContain('<SavedBatchEvidence postIds={savedPostIds} />');
    expect(autopilot).toContain('getShopifyLearningDecisions(postId, signal)');
    expect(autopilot).toContain('getShopifyReachPlans(postId, signal)');
    expect(autopilot).toContain('if (signal?.aborted) return;');
    expect(autopilot).toContain('Latest safety receipt and organic reach rationale');
    expect(autopilot).toContain('not paid promotion or a reach guarantee');
  });
});
