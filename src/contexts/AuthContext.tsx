import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';

interface UserDoc {
  email: string;
  plan: 'starter' | 'growth' | 'pro' | null;
  setupStatus: 'ordered' | 'form_sent' | 'in_progress' | 'live' | null;
  createdAt?: any;
}

interface AuthContextType {
  user: User | null;
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
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserDoc = async (uid: string) => {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      setUserDoc(snap.data() as UserDoc);
    } else {
      setUserDoc(null);
    }
  };

  const refreshUserDoc = async () => {
    if (user) await fetchUserDoc(user.uid);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await fetchUserDoc(u.uid);
      } else {
        setUserDoc(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signUp = async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      email,
      plan: null,
      setupStatus: null,
      createdAt: serverTimestamp(),
    });
    await fetchUserDoc(cred.user.uid);
  };

  const logIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logOut = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, userDoc, loading, signUp, logIn, logOut, resetPassword, refreshUserDoc }}>
      {children}
    </AuthContext.Provider>
  );
};
