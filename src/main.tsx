import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkProvider } from '@clerk/react';
import { AuthProvider } from './contexts/AuthContext';
import { PortalAuthProvider } from './contexts/PortalAuthContext';
import { CLIENT } from './client.config';
import './index.css';

// Apply light theme if configured
if ((CLIENT as any).theme === 'light') {
  document.documentElement.setAttribute('data-theme', 'light');
}

// Apply per-client accent color as CSS variables. The CSS in index.css overrides
// the hardcoded Tailwind amber-/orange- classes to use these vars, so JSX stays
// clean while every portal renders with its own brand colour.
function hexToRgbTriple(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}
const accent = (CLIENT as any).accentColor || '#f59e0b';
document.documentElement.style.setProperty('--accent', accent);
document.documentElement.style.setProperty('--accent-rgb', hexToRgbTriple(accent));

// pk_live_ is a publishable key — safe to commit (it's designed to be public)
const clerkPubKey = (import.meta.env as Record<string, string>).VITE_CLERK_PUBLISHABLE_KEY
  || 'pk_live_Y2xlcmsuc29jaWFsYWlzdHVkaW8uYXUk';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {CLIENT.clientMode ? (
      <PortalAuthProvider>
        <App />
      </PortalAuthProvider>
    ) : (
      <ClerkProvider publishableKey={clerkPubKey}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ClerkProvider>
    )}
  </React.StrictMode>
);
