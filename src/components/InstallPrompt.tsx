import React, { useEffect, useState } from 'react';
import { Smartphone, Plus, X, Share } from 'lucide-react';
import { CLIENT } from '../client.config';

/**
 * InstallPrompt — bottom-anchored A2HS card that appears once per
 * eligible device. Two render paths:
 *
 *   • Android Chrome / Edge / desktop Chrome:
 *     Listens for `beforeinstallprompt`, intercepts it, then shows our own
 *     bottom card with an "Install" button. Tapping calls the saved
 *     prompt.prompt() to fire the native install dialog.
 *
 *   • iOS Safari:
 *     `beforeinstallprompt` is not implemented; the user has to manually
 *     "Add to Home Screen" via the share sheet. We show a card explaining
 *     exactly that, with the iOS share-icon glyph in line.
 *
 * Skips entirely when the app is already running in standalone display
 * mode (i.e. it's already installed). Dismissals persist for 30 days
 * via localStorage so we don't nag.
 */

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'sai_install_dismissed';
const DISMISS_DAYS = 30;
const APPEAR_DELAY_MS = 6000; // give the user time to read the page first

export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredPrompt | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Already running standalone? The prompt is irrelevant.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // Recently dismissed? Honour the cool-off period.
    try {
      const dismissedAt = localStorage.getItem(DISMISS_KEY);
      if (dismissedAt) {
        const daysSince = (Date.now() - parseInt(dismissedAt, 10)) / 86400000;
        if (daysSince < DISMISS_DAYS) return;
      }
    } catch {
      // localStorage might be blocked — fall through to showing the prompt.
    }

    // iOS Safari path. UA sniff is brittle but it's the only reliable way
    // to detect "no beforeinstallprompt support but A2HS is available."
    const ua = navigator.userAgent;
    const isiPad = /iPad/.test(ua);
    const isiPhone = /iPhone/.test(ua);
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
    if ((isiPad || isiPhone) && isSafari) {
      setIsIOS(true);
      const timer = window.setTimeout(() => setShow(true), APPEAR_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    // Android / desktop Chromium path.
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as DeferredPrompt);
      window.setTimeout(() => setShow(true), APPEAR_DELAY_MS);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    } catch {
      // localStorage blocked — best-effort dismiss for this session.
    }
    setShow(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
      setDeferredPrompt(null);
    } else {
      dismiss();
    }
  };

  if (!show) return null;
  if (!isIOS && !deferredPrompt) return null;

  return (
    <div
      className="fixed left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-[60] bg-[#0e0e16] border border-amber-500/30 rounded-2xl p-4 shadow-[0_30px_80px_-20px_rgba(245,158,11,0.4)] animate-fadeSlideUp"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      role="dialog"
      aria-label="Install app"
    >
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-white/40 hover:text-white/80 transition"
        aria-label="Dismiss install prompt"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0">
          <Smartphone size={18} className="text-black" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm mb-1">
            Install {CLIENT.appName} on your home screen
          </p>
          {isIOS ? (
            <p className="text-xs text-white/60 leading-relaxed">
              Tap{' '}
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-white/10 align-middle mx-0.5">
                <Share size={10} className="text-white/80" />
              </span>{' '}
              in Safari, then "Add to Home Screen".
            </p>
          ) : (
            <>
              <p className="text-xs text-white/60 leading-relaxed mb-3">
                One-tap launch · full-screen · works offline.
              </p>
              <button
                onClick={install}
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold text-xs px-4 py-2 rounded-full hover:opacity-90 transition flex items-center gap-1.5"
              >
                <Plus size={12} /> Install
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
