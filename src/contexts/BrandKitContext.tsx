/**
 * SocialAI Studio — Poster Maker brand-kit context.
 *
 * Provides the active workspace's poster brand kit + overrides to anything
 * inside the PosterManager subtree. Re-fetches on workspace switch (Agency
 * plan) so the kit Steve sees follows whichever client he's switched into.
 *
 * Why a Context (vs the hughesysque-origin module-load const):
 *   - SocialAi Studio is multi-tenant at runtime; brand kit is keyed on
 *     (user_id, client_id) in D1. The active value MUST be a function of
 *     React state, not a module global.
 *   - Multiple components below PosterManager need the kit (caption gen,
 *     hero-prompt seed, swatches, etc.) — Context avoids prop-drilling
 *     through ~6 levels.
 *
 * Override persistence model: server is source-of-truth, optimistic on
 * save. localStorage is intentionally NOT used here — overrides are a
 * shared resource within a workspace and we don't want stale localStorage
 * from device A leaking into device B's session.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BASE_BRAND_KIT,
  applyBrandKitOverrides,
  type PosterBrandKit,
  type BrandKitOverrides,
} from '../utils/posterBrandKit';
import { createPosterApi } from '../services/posters';

type GetToken = () => Promise<string | null>;
type AuthMode = 'clerk' | 'portal';

interface BrandKitContextValue {
  /** Compiled defaults (CLIENT-config-derived) — useful for "reset" buttons in the editor. */
  baseKit: PosterBrandKit;
  /** Compiled defaults merged with the workspace's overrides. The kit consumers should read. */
  activeKit: PosterBrandKit;
  /** Raw override blob (what's actually in D1). Empty object if none set. */
  overrides: BrandKitOverrides;
  /** Unix ms timestamp of the last server-side save. 0 = never written. */
  updatedAt: number;
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** Surface any fetch / save error so the editor can show a notice. */
  error: string | null;
  /** Re-fetch from D1 (no-op while already loading). */
  refresh: () => Promise<void>;
  /** Replace the workspace's override blob in D1. Total-replace, not deep-merge. */
  save: (next: BrandKitOverrides) => Promise<void>;
  /** Drop the override row entirely — base kit shows after this resolves. */
  reset: () => Promise<void>;
}

const BrandKitContext = createContext<BrandKitContextValue | null>(null);

interface BrandKitProviderProps {
  children: ReactNode;
  /** Clerk getToken — usually `useAuth().getToken` from @clerk/react. */
  getToken: GetToken;
  /** Currently-active workspace id (Agency-plan switcher). null = own workspace. */
  clientId: string | null;
  /** 'clerk' for the main site; 'portal' for white-label client portals. */
  authMode?: AuthMode;
}

export function BrandKitProvider({ children, getToken, clientId, authMode = 'clerk' }: BrandKitProviderProps) {
  const [overrides, setOverrides] = useState<BrandKitOverrides>({});
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hold the API client in a ref so we don't rebuild it on every render. The
  // getToken closure is stable (Clerk's useAuth returns a stable ref); even if
  // it weren't, createPosterApi captures it lazily so re-creating is cheap.
  const apiRef = useRef(createPosterApi(getToken, authMode));
  useEffect(() => {
    apiRef.current = createPosterApi(getToken, authMode);
  }, [getToken, authMode]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { overrides: blob, updatedAt: ts } = await apiRef.current.fetchBrandKitOverrides(clientId);
      setOverrides(blob);
      setUpdatedAt(ts);
    } catch (e: any) {
      setError(e?.message || 'Failed to load brand kit overrides.');
      // Don't clobber existing in-memory overrides on transient errors —
      // a fresh tab is the only place this would matter and a retry button
      // is right there.
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // Initial fetch + re-fetch whenever the active workspace changes. We don't
  // debounce this because workspace switching is a deliberate user action,
  // not a chatty re-render.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (next: BrandKitOverrides) => {
    setError(null);
    // Optimistic local update so the editor's preview reflects the save
    // immediately — server-confirmed timestamp comes back below.
    setOverrides(next);
    try {
      const { updatedAt: serverTs } = await apiRef.current.putBrandKitOverrides(clientId, next);
      setUpdatedAt(serverTs);
    } catch (e: any) {
      setError(e?.message || 'Failed to save brand kit.');
      throw e; // re-throw so the editor can show its own error toast
    }
  }, [clientId]);

  const reset = useCallback(async () => {
    await save({});
  }, [save]);

  const activeKit = useMemo(
    () => applyBrandKitOverrides(BASE_BRAND_KIT, overrides),
    [overrides],
  );

  const value: BrandKitContextValue = useMemo(() => ({
    baseKit: BASE_BRAND_KIT,
    activeKit,
    overrides,
    updatedAt,
    loading,
    error,
    refresh,
    save,
    reset,
  }), [activeKit, overrides, updatedAt, loading, error, refresh, save, reset]);

  return (
    <BrandKitContext.Provider value={value}>
      {children}
    </BrandKitContext.Provider>
  );
}

/**
 * Read the active brand kit. Throws if used outside a BrandKitProvider —
 * by design, so a misplaced consumer fails loud at dev time rather than
 * rendering with hidden defaults.
 */
export function useBrandKit(): BrandKitContextValue {
  const ctx = useContext(BrandKitContext);
  if (!ctx) {
    throw new Error('useBrandKit must be used inside a <BrandKitProvider>.');
  }
  return ctx;
}
