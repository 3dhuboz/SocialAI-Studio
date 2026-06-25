/**
 * src/services/postproxyService.ts
 *
 * Thin client wrapper around the four Clerk-authed Postproxy routes mounted
 * by `workers/api/src/routes/postproxy.ts`. Mirrors the fetch pattern in
 * `services/db.ts` — caller supplies a `getToken` (Clerk JWT in `clerk`
 * mode, portal JWT in `portal` mode); this module attaches it to every
 * request as `Authorization: Bearer …` (or `Portal …`).
 *
 * Used by:
 *   - `components/PostproxyConnectButton.tsx` — Stage-1 OAuth kick-off +
 *     Stage-2 placement-picker save
 *   - `components/MigrationBanner.tsx` — legacy → Postproxy reconnect CTA
 *   - `App.tsx` — `publishNow(postId)` replaces the per-platform Graph
 *     calls at the three calendar/publish call sites once a workspace is
 *     on the Postproxy path.
 *
 * NOT used for the webhook (public endpoint) or oauth-callback (303
 * redirect, browser navigates there directly from Postproxy's hosted
 * page). Those endpoints don't go through this service.
 */

const BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

type GetToken = () => Promise<string | null>;
type AuthMode = 'clerk' | 'portal' | 'embed';

async function apiFetch(
  getToken: GetToken,
  path: string,
  options: RequestInit = {},
  authMode: AuthMode = 'clerk',
): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = authMode === 'portal' ? `Portal ${token}` : authMode === 'embed' ? `Embed ${token}` : `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Postproxy ${options.method || 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return res;
}

export type Platform = 'facebook' | 'instagram';

export interface InitConnectionResponse {
  authUrl: string;
  oauthState: string;
  /** Echoed back from the worker so the caller can confirm which
   *  platform's OAuth URL it received. */
  platform?: Platform;
}

export interface Placement {
  id: string;
  name: string;
}

export interface ListPlacementsResponse {
  placements: Placement[];
  /** ig-wire: IG has no placements (docs §3299). The worker returns
   *  `placements: []` with `skipPicker: true` so the UI can short-circuit
   *  Stage 2 instead of rendering an empty picker. */
  platform?: Platform;
  skipPicker?: boolean;
}

export interface SavePlacementArgs {
  clientId?: string | null;
  placementId: string;
  pageName: string;
  /** Forwarded to the worker; for IG, save-placement is a no-op
   *  (oauth-callback already flipped use_postproxy=1). */
  platform?: Platform;
}

export interface PublishNowResponse {
  ok: true;
  postproxyPostId: string;
}

/** Factory matches the `createDb()` pattern in `services/db.ts` — caller is
 *  the `useDb`-equivalent hook, which is `usePostproxy` below. */
export function createPostproxyService(getToken: GetToken, authMode: AuthMode = 'clerk') {
  const f = (path: string, opts: RequestInit = {}) => apiFetch(getToken, path, opts, authMode);
  const j = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

  return {
    /** Stage 1 — mint the hosted-OAuth URL. Caller does
     *  `window.location.href = authUrl` (full nav, not popup; Postproxy's
     *  flow needs the referrer + cookie context). The worker writes a
     *  pending postproxy_profiles row keyed on `oauthState` so the
     *  callback can resolve workspace ownership without any browser
     *  state. */
    async initConnection(
      clientId?: string | null,
      platform: Platform = 'facebook',
    ): Promise<InitConnectionResponse> {
      const res = await f('/api/postproxy/init-connection', j({
        clientId: clientId ?? null,
        platform,
      }));
      return res.json() as Promise<InitConnectionResponse>;
    },

    /** Stage 2 — list placements for the connected profile. For Facebook,
     *  returns the Pages the user just OAuth'd. For Instagram, the worker
     *  short-circuits with `{ placements: [], skipPicker: true }` because
     *  IG has no placements (docs §3299) — the UI should not render a
     *  picker for IG. */
    async listPlacements(
      clientId?: string | null,
      platform: Platform = 'facebook',
    ): Promise<ListPlacementsResponse> {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      params.set('platform', platform);
      const res = await f(`/api/postproxy/placements?${params.toString()}`);
      return res.json() as Promise<ListPlacementsResponse>;
    },

    /** Stage 2 commit — persist the chosen Page and flip
     *  users.use_postproxy (or clients.use_postproxy) to 1 server-side.
     *  For Instagram, the worker already flipped the flag in the
     *  oauth-callback (no picker step), so this call is a no-op success
     *  for IG — included for parent-callsite uniformity. */
    async savePlacement(args: SavePlacementArgs): Promise<{ ok: true }> {
      const res = await f('/api/postproxy/save-placement', j({
        clientId: args.clientId ?? null,
        placementId: args.placementId,
        pageName: args.pageName,
        platform: args.platform ?? 'facebook',
      }));
      return res.json() as Promise<{ ok: true }>;
    },

    /** Out-of-band manual publish — bypasses the */
    async publishNow(postId: string): Promise<PublishNowResponse> {
      const res = await f('/api/postproxy/publish-now', j({ postId }));
      return res.json() as Promise<PublishNowResponse>;
    },
  };
}

export type PostproxyService = ReturnType<typeof createPostproxyService>;
