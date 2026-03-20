/**
 * PortalAuthContext — Clerk-free auth for white-label client portals.
 * Uses a portal_token stored in D1 to authenticate API calls.
 * Provides values through the SAME AuthContext so useAuth() works everywhere.
 * No Clerk SDK, no satellite domains, no extra cost.
 */
import React, { useEffect, useState } from 'react';
import { AuthContext } from './AuthContext';
import type { AppUser } from './AuthContext';
import { createDb } from '../services/db';
import { CLIENT } from '../client.config';

interface UserDoc {
  email: string;
  plan: 'starter' | 'growth' | 'pro' | 'agency' | null;
  setupStatus: 'ordered' | 'form_sent' | 'in_progress' | 'live' | 'cancelled' | null;
}

// Store the portal token globally so useDb can access it
let _portalToken: string | null = null;
export const getPortalToken = () => _portalToken;

export const PortalAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalClientId, setPortalClientId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const clientId = (CLIENT as any).clientId
          || (import.meta.env as Record<string, string>).VITE_CLIENT_ID
          || '';
        if (!clientId) {
          console.error('[PortalAuth] No clientId configured (set CLIENT.clientId or VITE_CLIENT_ID)');
          setLoading(false);
          return;
        }

        // Fetch portal record (public endpoint, no auth needed)
        const BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
          || 'https://socialai-api.steve-700.workers.dev';
        const res = await fetch(`${BASE}/api/db/portal/${encodeURIComponent(clientId.toLowerCase())}`);
        const data = await res.json() as {
          portal: {
            email: string;
            portal_token: string | null;
            user_id: string | null;
            client_id: string | null;
          } | null;
        };

        if (!data.portal?.portal_token || !data.portal.user_id) {
          console.error('[PortalAuth] No portal token configured for slug:', clientId);
          setLoading(false);
          return;
        }

        // Store the token for API calls
        _portalToken = data.portal.portal_token;

        // Store which client workspace to auto-select
        if (data.portal.client_id) setPortalClientId(data.portal.client_id);

        // Set the user from portal data
        setUser({
          uid: data.portal.user_id,
          email: data.portal.email,
          displayName: null,
        });

        // Fetch user doc using the portal token
        const getToken = async () => _portalToken;
        const db = createDb(getToken, 'portal');
        const row = await db.getUser();
        if (row) {
          setUserDoc({
            email: row.email ?? '',
            plan: (row.plan as UserDoc['plan']) ?? null,
            setupStatus: (row.setup_status as UserDoc['setupStatus']) ?? null,
          });
        }
      } catch (e) {
        console.error('[PortalAuth] Init failed:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const refreshUserDoc = async () => {
    if (!_portalToken) return;
    const getToken = async () => _portalToken;
    const db = createDb(getToken, 'portal');
    const row = await db.getUser();
    if (row) {
      setUserDoc({
        email: row.email ?? '',
        plan: (row.plan as UserDoc['plan']) ?? null,
        setupStatus: (row.setup_status as UserDoc['setupStatus']) ?? null,
      });
    }
  };

  const getApiToken = async () => _portalToken;

  // No-ops in portal mode
  const logIn = async () => {};
  const signUp = async () => {};
  const logOut = async () => {};
  const resetPassword = async () => {};

  return (
    <AuthContext.Provider
      value={{
        user, userDoc, loading,
        signUp, logIn, logOut, resetPassword, refreshUserDoc,
        getApiToken, authMode: 'portal', portalClientId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
