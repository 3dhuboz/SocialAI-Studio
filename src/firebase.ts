import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const env = (key: string, fallback: string) =>
  (typeof import.meta !== 'undefined' && (import.meta.env as any)?.[key]) || fallback;

const firebaseConfig = {
  apiKey:            env('VITE_FIREBASE_API_KEY',            'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA'),
  authDomain:        env('VITE_FIREBASE_AUTH_DOMAIN',        'socialai-e22c2.firebaseapp.com'),
  projectId:         env('VITE_FIREBASE_PROJECT_ID',         'socialai-e22c2'),
  storageBucket:     env('VITE_FIREBASE_STORAGE_BUCKET',     'socialai-e22c2.firebasestorage.app'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID','176799681610'),
  appId:             env('VITE_FIREBASE_APP_ID',             '1:176799681610:web:c7ae2eaac6ee525077eab3'),
  measurementId:     env('VITE_FIREBASE_MEASUREMENT_ID',     'G-3P68Z42QF4'),
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
