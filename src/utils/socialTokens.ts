/**
 * Pure SocialTokens mutations — shared by the IG connect callsites in
 * App.tsx and OnboardingWizard.tsx. Side effects (toasts, magicOnboarding,
 * navigation) stay at the callsite; this module only owns the token
 * shape.
 *
 * postproxyInstagramProfileId is intentionally NOT touched by
 * applyIgConnected — the worker oauth-callback writes the real
 * profile_id to postproxy_profiles server-side, and the next
 * socialTokens refetch picks it up. Writing a sentinel here would
 * overwrite the server's value via saveSocialTokens.
 */
import type { SocialTokens } from '../types';

export const applyIgConnected = (
  tokens: SocialTokens,
  placementName: string,
): SocialTokens => ({
  ...tokens,
  postproxyInstagramConnectedAt: new Date().toISOString(),
  postproxyInstagramName: placementName,
  instagramConnected: true,
});

export const applyIgDisconnected = (tokens: SocialTokens): SocialTokens => ({
  ...tokens,
  postproxyInstagramProfileId: undefined,
  postproxyInstagramConnectedAt: undefined,
  postproxyInstagramName: undefined,
  instagramConnected: false,
});
