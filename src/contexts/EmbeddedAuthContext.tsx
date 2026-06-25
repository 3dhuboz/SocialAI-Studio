/**
 * EmbeddedAuthContext - signed iframe auth for partner admin panels.
 * The parent app mints a short-lived HMAC token, SocialAI verifies it on
 * every Worker request with Authorization: Embed <token>.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AuthContext } from './AuthContext';
import type { AppUser } from './AuthContext';
import { createDb } from '../services/db';
import { setGeminiAuth } from '../services/gemini';

interface UserDoc {
  email: string;
  plan: 'starter' | 'growth' | 'pro' | 'agency' | null;
  setupStatus: 'ordered' | 'form_sent' | 'in_progress' | 'live' | 'cancelled' | null;
}

type EmbedClaims = {
  sub?: string;
  email?: string;
  name?: string;
  exp?: number;
};

function getEmbedToken(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('embed_token');
}

function decodeClaims(token: string | null): EmbedClaims | null {
  if (!token) return null;
  const [payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as EmbedClaims;
  } catch {
    return null;
  }
}

export const EmbeddedAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = useMemo(() => getEmbedToken(), []);
  const claims = useMemo(() => decodeClaims(token), [token]);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  const user: AppUser | null = useMemo(() => {
    if (!token || !claims?.sub) return null;
    return {
      uid: claims.sub,
      email: claims.email ?? null,
      displayName: claims.name ?? null,
    };
  }, [claims, token]);

  const getApiToken = async () => token;

  useEffect(() => { setGeminiAuth(getApiToken, 'embed'); }, [token]);

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;
    window.history.replaceState({}, '', `${window.location.pathname}?embedded=1${window.location.hash}`);
  }, [token]);

  useEffect(() => {
    const run = async () => {
      if (!token || !user) {
        setLoading(false);
        return;
      }
      try {
        const db = createDb(getApiToken, 'embed');
        const row = await db.getUser();
        setUserDoc({
          email: row?.email ?? user.email ?? '',
          plan: (row?.plan as UserDoc['plan']) ?? 'pro',
          setupStatus: (row?.setup_status as UserDoc['setupStatus']) ?? 'live',
        });
      } catch (error) {
        console.error('[EmbeddedAuth] Init failed:', error);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [token, user]);

  const refreshUserDoc = async () => {
    if (!token || !user) return;
    const db = createDb(getApiToken, 'embed');
    const row = await db.getUser();
    setUserDoc({
      email: row?.email ?? user.email ?? '',
      plan: (row?.plan as UserDoc['plan']) ?? 'pro',
      setupStatus: (row?.setup_status as UserDoc['setupStatus']) ?? 'live',
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userDoc,
        loading,
        signUp: async () => {},
        logIn: async () => {},
        logOut: async () => {},
        resetPassword: async () => {},
        refreshUserDoc,
        getApiToken,
        authMode: 'embed',
        portalClientId: null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
