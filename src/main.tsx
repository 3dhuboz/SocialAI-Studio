import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkProvider } from '@clerk/react';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';

// pk_live_ is a publishable key — safe to commit (it's designed to be public)
const clerkPubKey = (import.meta.env as Record<string, string>).VITE_CLERK_PUBLISHABLE_KEY
  || 'pk_live_Y2xlcmsuc29jaWFsYWlzdHVkaW8uYXUk';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPubKey}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ClerkProvider>
  </React.StrictMode>
);
