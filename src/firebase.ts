import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA",
  authDomain: "socialai-e22c2.firebaseapp.com",
  projectId: "socialai-e22c2",
  storageBucket: "socialai-e22c2.firebasestorage.app",
  messagingSenderId: "176799681610",
  appId: "1:176799681610:web:c7ae2eaac6ee525077eab3",
  measurementId: "G-3P68Z42QF4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
