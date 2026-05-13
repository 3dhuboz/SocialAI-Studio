/**
 * SocialAI Studio — Poster Maker client service.
 *
 * Mirrors the pattern in `services/db.ts` — factory that takes the Clerk
 * `getToken` function and the active `clientId` (workspace) and returns
 * methods scoped to that workspace. All routes hit the Worker at
 * VITE_AI_WORKER_URL, NOT same-origin Pages Functions.
 *
 * Auth: each call attaches `Authorization: Bearer <Clerk JWT>` via
 * apiFetch. The Worker's auth gate verifies the JWT and uses the userId
 * for ownership scoping; the workspace is passed via `?clientId=`.
 */

import type { BrandKitOverrides } from '../utils/posterBrandKit';

const BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

type GetToken = () => Promise<string | null>;
type AuthMode = 'clerk' | 'portal';

async function apiFetch(
  getToken: GetToken,
  path: string,
  options: RequestInit = {},
  authMode: AuthMode = 'clerk',
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(options.headers);
  // Don't force Content-Type — multipart uploads need the browser to set
  // the boundary itself. Callers that want JSON should set it explicitly.
  if (token) {
    headers.set('Authorization', authMode === 'portal' ? `Portal ${token}` : `Bearer ${token}`);
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${options.method || 'GET'} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res;
}

/** Raw shape returned by the worker. */
export interface SavedPoster {
  id: string;
  contentInputs: Record<string, unknown> & {
    headline?: string;
    subhead?: string;
    venue?: string;
    date?: string;
    pickupTime?: string;
    body?: string;
    hashtags?: string[];
    heroPrompt?: string;
    heroDataUrl?: string | null;
    qrEnabled?: boolean;
    qrUrl?: string;
    qrLabel?: string;
    sizeId?: 'square' | 'story' | 'wide';
    layout?: Record<string, unknown>;
  };
  /** Relative path; combine with VITE_AI_WORKER_URL or call posterImageUrl(). */
  imageUrl: string | null;
  brandName: string | null;
  createdBy: string | null;
  createdAt: string;
  scheduledAt: string | null;
  clientId: string | null;
}

export interface BrandKitFetchResult {
  overrides: BrandKitOverrides;
  updatedAt: number;
}

/**
 * Factory — call once per render where you have the Clerk token + the
 * active workspace id. Returns workspace-scoped methods. Caller passes
 * clientId (or null for own workspace) on each method that needs it, so
 * the factory itself isn't memoised against the workspace — easier to
 * reason about across the Agency-plan client switcher.
 */
export function createPosterApi(getToken: GetToken, authMode: AuthMode = 'clerk') {
  const f = (path: string, opts: RequestInit = {}) => apiFetch(getToken, path, opts, authMode);

  return {
    /** List the most recent posters in the given workspace (newest-first). */
    async listPosters(clientId: string | null, opts: { limit?: number } = {}): Promise<SavedPoster[]> {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (opts.limit) params.set('limit', String(opts.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await f(`/api/db/posters${qs}`);
      const data = await res.json() as { items?: SavedPoster[] };
      return data.items ?? [];
    },

    /**
     * Save a freshly-rendered PNG + its input snapshot. Multipart upload —
     * the browser fills in the boundary in Content-Type, so DON'T set it on
     * the apiFetch headers.
     */
    async savePoster(args: {
      blob: Blob;
      contentInputs: Record<string, unknown>;
      brandName?: string;
      clientId: string | null;
      scheduledAt?: string | null;
    }): Promise<SavedPoster> {
      const fd = new FormData();
      fd.append('image', args.blob, 'poster.png');
      fd.append('content_inputs', JSON.stringify(args.contentInputs));
      if (args.brandName) fd.append('brand_name', args.brandName);
      if (args.clientId)  fd.append('client_id', args.clientId);
      if (args.scheduledAt) fd.append('scheduled_at', args.scheduledAt);
      const res = await f('/api/db/posters', { method: 'POST', body: fd });
      return res.json();
    },

    /** Permanently delete a saved poster (R2 object + D1 row). */
    async deletePoster(id: string): Promise<void> {
      await f(`/api/db/posters/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /** Set or clear the post-to-socials schedule on a saved poster. */
    async updatePosterSchedule(id: string, scheduledAt: string | null): Promise<{ id: string; scheduledAt: string | null }> {
      const res = await f(`/api/db/posters/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt }),
      });
      return res.json();
    },

    /** Fetch the workspace's brand-kit override blob from D1. */
    async fetchBrandKitOverrides(clientId: string | null): Promise<BrandKitFetchResult> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/poster-brand-kit${qs}`);
      const data = await res.json() as { overrides?: BrandKitOverrides; updatedAt?: number };
      return {
        overrides: (data?.overrides && typeof data.overrides === 'object') ? data.overrides : {},
        updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : 0,
      };
    },

    /** Replace the workspace's brand-kit override blob (total-replace, not merge). */
    async putBrandKitOverrides(clientId: string | null, overrides: BrandKitOverrides): Promise<BrandKitFetchResult> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/poster-brand-kit${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json() as { overrides?: BrandKitOverrides; updatedAt?: number };
      return {
        overrides: (data?.overrides && typeof data.overrides === 'object') ? data.overrides : overrides,
        updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : Date.now(),
      };
    },
  };
}

/** Build the same-origin URL that streams the PNG bytes from R2. */
export function posterImageUrl(id: string): string {
  return `${BASE}/api/db/posters/${encodeURIComponent(id)}/image`;
}
