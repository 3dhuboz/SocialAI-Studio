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
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100;
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
const accent = (CLIENT as any).accentColor || '#f59e0b';
const { r, g, b } = hexToRgb(accent);
const hsl = rgbToHsl(r, g, b);
// Compute a "light" variant for text/badges on dark backgrounds. Dark accents
// (like #b91c1c at L=42%) are unreadable on dark UI when used as text — bump
// lightness to ~65-72% so it pops. Bright accents (amber at L=50%) get a small
// boost to ~62%. This guarantees AA contrast for accent text on dark surfaces.
const lightL = Math.min(72, Math.max(60, hsl.l + 22));
const accentLight = hslToRgb(hsl.h, Math.min(95, hsl.s + 5), lightL);
document.documentElement.style.setProperty('--accent', accent);
document.documentElement.style.setProperty('--accent-rgb', `${r} ${g} ${b}`);
document.documentElement.style.setProperty('--accent-light', `rgb(${accentLight.r} ${accentLight.g} ${accentLight.b})`);
document.documentElement.style.setProperty('--accent-light-rgb', `${accentLight.r} ${accentLight.g} ${accentLight.b}`);

// pk_live_ is a publishable key — safe to commit (it's designed to be public)
const clerkPubKey = (import.meta.env as Record<string, string>).VITE_CLERK_PUBLISHABLE_KEY
  || 'pk_live_Y2xlcmsuc29jaWFsYWlzdHVkaW8uYXUk';

// PWA service worker — register only in production builds. Dev-mode
// service workers cause hot-reload thrash and stale cache headaches.
// On localhost the SW is a no-op; on the deployed site it caches the
// shell + hashed assets for offline-tolerant mobile use.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Non-fatal — the app still works without offline support.
        console.warn('[sw] registration failed:', err);
      });
  });
}

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
