import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUser, useClerk, useAuth as useClerkAuth } from '@clerk/react';
import { createDb } from '../services/db';

interface UserDoc {
  email: string;
  plan: 'starter' | 'growth' | 'pro' | 'agency' | null;
  setupStatus: 'ordered' | 'form_sent' | 'in_progress' | 'live' | 'cancelled' | null;
  createdAt?: any;
}

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface AuthContextType {
  user: AppUser | null;
  userDoc: UserDoc | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshUserDoc: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user: clerkUser, isLoaded } = useUser();
  const clerk = useClerk();
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);

  const user: AppUser | null = clerkUser
    ? {
        uid: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
        displayName: clerkUser.fullName,
      }
    : null;

  const loading = !isLoaded;

  const { getToken } = useClerkAuth();

  const fetchUserDoc = async (uid: string, email: string | null) => {
    const dbClient = createDb(getToken);
    const row = await dbClient.getUser();
    if (row) {
      setUserDoc({
        email: row.email ?? '',
        plan: (row.plan as UserDoc['plan']) ?? null,
        setupStatus: (row.setup_status as UserDoc['setupStatus']) ?? null,
      });
    } else {
      const newDoc: UserDoc = { email: email ?? '', plan: null, setupStatus: null };
      await dbClient.upsertUser({ email: email ?? '', plan: null, setupStatus: null });
      setUserDoc(newDoc);
    }
  };

  const refreshUserDoc = async () => {
    if (user) await fetchUserDoc(user.uid, user.email);
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (clerkUser) {
      fetchUserDoc(clerkUser.id, clerkUser.primaryEmailAddress?.emailAddress ?? null).catch(() => {});
    } else {
      setUserDoc(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkUser?.id, isLoaded]);

  const logOut = async () => { await clerk.signOut(); };

  // Auth UI is now handled by Clerk
  const signUp = async (_e: string, _p: string) => {};
  const logIn = async (email: string, password: string) => {
    if (!clerk.client) throw new Error('Clerk not initialized');
    const result = await clerk.client.signIn.create({ identifier: email, password });
    if (result.status === 'complete') {
      await clerk.setActive({ session: result.createdSessionId });
    }
  };
  const resetPassword = async (_e: string) => {};

  return (
    <AuthContext.Provider value={{ user, userDoc, loading, signUp, logIn, logOut, resetPassword, refreshUserDoc }}>
      {children}
    </AuthContext.Provider>
  );
};
