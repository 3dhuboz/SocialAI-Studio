import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createPostproxyService, type Placement, type Platform } from '../services/postproxyService';
import {
  Facebook, Instagram, Loader2, CheckCircle, ChevronRight, AlertCircle, ExternalLink, X, Shield,
} from 'lucide-react';

/**
 * PostproxyConnectButton — replaces FacebookConnectButton during the
 * dual-path migration window. Two-stage UX:
 *
 *   Stage 1 ("idle"): single "Connect with Facebook" button. On click,
 *     calls POST /api/postproxy/init-connection → receives authUrl →
 *     full-navigates the browser to Postproxy's hosted OAuth page. The
 *     user completes Meta consent on facebook.com (hosted by Postproxy),
 *     then Postproxy redirects back to our worker's oauth-callback,
 *     which 303s the browser to /onboarding?step=pick-placement.
 *
 *   Stage 2 ("picking"): when the page mounts with that query-string
 *     present, this component immediately fetches the placements and
 *     renders a picker. On selection it calls POST
 *     /api/postproxy/save-placement, which persists the Page choice and
 *     flips users.use_postproxy=1 so the publish cron starts routing
 *     this workspace through Postproxy on its next */
interface Props {
  /** Active workspace — null = own. Forwarded to the worker so it can
   *  enforce agency-tenant ownership and write to the right
   *  postproxy_profiles row. */
  clientId?: string | null;
  /** Called after Stage 2 save-placement succeeds. The parent uses this
   *  to refresh socialTokens state so subsequent renders show the
   *  "Connected" pill instead of the connect button. */
  onConnected: (placement: Placement) => void;
  /** Called when the user clicks the X on the connected pill. Clears
   *  Postproxy fields from socialTokens — the worker side keeps the
   *  postproxy_profiles row (so a reconnect skips re-auth) but the UI
   *  acts as if disconnected until the user picks a Page again. */
  onDisconnect?: () => void;
  /** Already-connected placement ID — when set, this component renders
   *  the "Connected" state with a "Switch page" link. For IG (no
   *  placements), pass any truthy string to indicate "already connected". */
  connectedPlacementId?: string;
  connectedPageName?: string;
  /** When true, the parent has manually navigated to Stage 2 (e.g. via
   *  the MigrationBanner's "Reconnect" button after a full-page reload
   *  finished OAuth). This bypasses the URL query-string check. */
  forcePickerStage?: boolean;
  /** ig-wire (v2): which platform to connect. Defaults to 'facebook'
   *  to preserve byte-identical behaviour for every existing call site.
   *  When 'instagram', the component:
   *    - Shows an Instagram icon + brand color (#E1306C) instead of FB blue
   *    - Skips Stage 2 placement-picker entirely (IG has no placements
   *      per docs §3299; the worker auto-flips use_postproxy=1 in the
   *      oauth-callback)
   *    - Treats `?step=connected` as the post-OAuth landing state
   *      instead of `?step=pick-placement` */
  platform?: Platform;
}

/** Platform-specific UI tokens — colours, copy, icon. Keeps the branching
 *  inside the component to ONE place; the JSX below reads from `theme`
 *  instead of inline ternaries. */
function platformTheme(platform: Platform) {
  if (platform === 'instagram') {
    return {
      label: 'Instagram',
      // Instagram brand gradient (pink → orange → purple). We use a solid
      // pink for the button hover state since gradients-on-hover are
      // janky cross-browser; pure brand colour is `#E1306C`.
      bg: 'bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737]',
      bgHover: 'hover:opacity-90',
      shadow: 'shadow-lg shadow-pink-900/30',
      iconBg: 'bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#F77737]',
      pillBg: 'bg-pink-500/8 border-pink-500/20',
      pillTextHover: 'text-pink-400',
      Icon: Instagram,
      // IG has no placement picker; oauth-callback redirects to
      // ?step=connected. The Stage-2 sniff in the useEffect below treats
      // either step as a Stage-2-ish landing depending on platform.
      stage2UrlStep: 'connected',
    } as const;
  }
  // Facebook (default — byte-identical to pre-ig-wire styling)
  return {
    label: 'Facebook',
    bg: 'bg-[#1877F2]',
    bgHover: 'hover:bg-[#166FE5]',
    shadow: 'shadow-lg shadow-blue-900/30',
    iconBg: 'bg-[#1877F2]',
    pillBg: 'bg-blue-500/5 border-blue-500/15',
    pillTextHover: 'text-blue-400',
    Icon: Facebook,
    stage2UrlStep: 'pick-placement',
  } as const;
}

type Step = 'idle' | 'connecting' | 'picking' | 'saving' | 'saved' | 'error';

/** Map OAuth-callback failure codes (passed through by our worker's
 *  oauth-callback failure-redirect) to user-readable messages. Defaults
 *  to a generic retry prompt for unknown codes. Keep the strings
 *  actionable — they're the user's only signal when OAuth bombs at Meta. */
function friendlyPostproxyError(code: string): string {
  if (code.startsWith('account_is_already')) {
    return 'This Facebook account is already connected to another SocialAI Studio workspace. Disconnect it from that workspace first, or contact support if you need help.';
  }
  if (code === 'access_denied' || code === 'user_cancelled') {
    return 'You cancelled the Facebook authorisation. Click Connect to try again.';
  }
  if (code === 'scope_denied') {
    return 'Some required Facebook permissions were declined. We need them to publish to your Page. Click Connect and approve all requested permissions.';
  }
  if (code === 'no_profile_after_oauth') {
    return 'Facebook authorisation completed but the new connection didn\'t register. Wait a few seconds and click Connect to retry — if it persists, contact support.';
  }
  return `Facebook connection failed (code: ${code}). Click Connect to try again, or contact support if it persists.`;
}

export const PostproxyConnectButton: React.FC<Props> = ({
  clientId,
  onConnected,
  onDisconnect,
  connectedPlacementId,
  connectedPageName,
  forcePickerStage = false,
  platform = 'facebook',
}) => {
  const { getApiToken, authMode } = useAuth();
  // Memoise so the service identity stays stable across renders — otherwise
  // any useEffect that depends on it loops.
  const service = useMemo(
    () => createPostproxyService(getApiToken, authMode),
    [getApiToken, authMode],
  );
  const theme = useMemo(() => platformTheme(platform), [platform]);
  const isInstagram = platform === 'instagram';

  const [step, setStep] = useState<Step>('idle');
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [error, setError] = useState<string>('');

  // Detect Stage 2 — either ?step=pick-placement in the URL (worker's
  // oauth-callback redirect target) or forcePickerStage prop (e.g.
  // Migration banner reconnect). Listed-placement workspace honours the
  // ?workspace=<clientId|"own"> query-string so a multi-client agency
  // doesn't accidentally save the placement to the wrong workspace.
  useEffect(() => {
    if (connectedPlacementId) return; // already-connected wins
    const url = new URL(window.location.href);
    const urlStep = url.searchParams.get('step');
    const urlError = url.searchParams.get('postproxy_error');

    // OAuth failure path — worker redirects here with
    // ?step=connect-failed&postproxy_error=<code>. Render the friendly
    // error and clean up the URL so a refresh doesn't re-show it.
    if (urlStep === 'connect-failed' && urlError) {
      setError(friendlyPostproxyError(urlError));
      setStep('error');
      try {
        url.searchParams.delete('step');
        url.searchParams.delete('postproxy_error');
        url.searchParams.delete('workspace');
        window.history.replaceState({}, '', url.toString());
      } catch { /* non-fatal */ }
      return;
    }

    const urlWorkspace = url.searchParams.get('workspace');
    const urlPlatform = url.searchParams.get('platform');
    // ig-wire: IG's post-OAuth redirect uses ?step=connected (no picker
    // needed since IG has no placements). FB uses ?step=pick-placement.
    // Both land us in "Stage 2" semantically, but IG short-circuits to
    // the saved/confirmation state instead of fetching placements.
    const isStage2 = forcePickerStage
      || urlStep === 'pick-placement'
      || urlStep === 'connected';
    if (!isStage2) return;
    // Only act on a `?step=connected` redirect if it belongs to our
    // platform — an IG `?step=connected` redirect should not trigger
    // the FB button to flip to "saved".
    if (urlStep === 'connected') {
      const expectedPlatform = (urlPlatform || 'instagram').toLowerCase();
      if (expectedPlatform !== platform) return;
    }

    // If the URL specifies a workspace that doesn't match the active
    // clientId prop, don't fetch — wait for the parent to re-render
    // with the right activeClientId. This handles the case where the
    // user starts a reconnect from a client workspace, then refreshes
    // their browser on the agency view before the callback lands.
    const expectsOwn = urlWorkspace === 'own';
    const expectsClient = urlWorkspace && urlWorkspace !== 'own';
    if (expectsOwn && clientId !== null) return;
    if (expectsClient && clientId !== urlWorkspace) return;

    let aborted = false;
    // IG short-circuit: no placement picker. The worker auto-flipped
    // use_postproxy=1 in the oauth-callback, so we render the saved/
    // confirmation state directly. Synthesise a Placement-shaped object
    // so onConnected's existing contract still holds — the placementId
    // doubles as "any truthy means connected" for IG since there's no
    // real placement to track.
    if (isInstagram) {
      setStep('saved');
      // Clean up the URL so a refresh doesn't re-trigger.
      try {
        url.searchParams.delete('step');
        url.searchParams.delete('workspace');
        url.searchParams.delete('platform');
        window.history.replaceState({}, '', url.toString());
      } catch { /* non-fatal */ }
      // Notify the parent. For IG, placementId is a sentinel — the cron
      // checks postproxy_profile_id (not placement_id) for IG posts, so
      // any non-empty value works to signal "this workspace has IG".
      onConnected({ id: 'instagram-connected', name: 'Instagram' });
      return () => { aborted = true; };
    }

    setStep('picking');
    setError('');
    service.listPlacements(clientId, platform)
      .then((res) => {
        if (aborted) return;
        if (res.skipPicker) {
          // Defensive: the IG short-circuit above should already have
          // caught this, but if the worker reports skipPicker for any
          // platform we honour it instead of rendering an empty picker.
          setStep('saved');
          onConnected({ id: `${platform}-connected`, name: theme.label });
          return;
        }
        if (!res.placements || res.placements.length === 0) {
          setError('NO_PLACEMENTS_FOUND');
          setStep('error');
          return;
        }
        setPlacements(res.placements);
      })
      .catch((e: any) => {
        if (aborted) return;
        const msg = String(e?.message || e || 'Unknown error');
        setError(msg.length > 200 ? msg.slice(0, 200) : msg);
        setStep('error');
      });
    return () => { aborted = true; };
  }, [forcePickerStage, clientId, connectedPlacementId, service, platform, isInstagram, onConnected, theme.label]);

  const handleConnect = async () => {
    setStep('connecting');
    setError('');
    try {
      const { authUrl } = await service.initConnection(clientId, platform);
      // Full navigation — Postproxy's OAuth flow requires referrer +
      // cookie context that a popup window misses. The user comes back
      // via the worker's oauth-callback 303 redirect to
      // /onboarding?step=pick-placement, at which point the useEffect
      // above flips to picking.
      window.location.href = authUrl;
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg.length > 200 ? msg.slice(0, 200) : msg);
      setStep('error');
    }
  };

  const handlePickPlacement = async (p: Placement) => {
    setStep('saving');
    setError('');
    try {
      await service.savePlacement({
        clientId: clientId ?? null,
        placementId: p.id,
        pageName: p.name,
        platform,
      });
      setStep('saved');
      onConnected(p);
      // Clean up the ?step=pick-placement query string so a browser
      // refresh doesn't re-trigger the picker on a workspace that's
      // already saved.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('step');
        url.searchParams.delete('workspace');
        window.history.replaceState({}, '', url.toString());
      } catch { /* non-fatal */ }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg.length > 200 ? msg.slice(0, 200) : msg);
      setStep('error');
    }
  };

  const handleDisconnect = () => {
    if (onDisconnect) onDisconnect();
    setStep('idle');
    setPlacements([]);
    setError('');
  };

  // ─── Already connected ───────────────────────────────
  if (connectedPlacementId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 bg-green-500/8 border border-green-500/20 rounded-2xl p-4">
          <div className={`w-10 h-10 ${theme.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
            <theme.Icon size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{connectedPageName || `${theme.label} ${isInstagram ? 'account' : 'Page'}`}</p>
            <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
              <CheckCircle size={11} /> Connected
            </p>
            <p className="text-[11px] mt-0.5">
              <span className="text-emerald-400/80 flex items-center gap-1">
                <Shield size={10} /> Token refresh, reels, and story publishing handled automatically
              </span>
            </p>
          </div>
          {onDisconnect && (
            <button
              onClick={handleDisconnect}
              className="text-white/20 hover:text-red-400 transition p-1 flex-shrink-0"
              title="Disconnect"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {/* "Switch page" only makes sense for FB (where there's an actual
            placement to switch). IG has no placements — re-clicking is a
            re-OAuth of the same account, which isn't useful here. */}
        {!isInstagram && (
          <button
            onClick={handleConnect}
            disabled={step === 'connecting'}
            className={`text-xs text-blue-400/60 hover:${theme.pillTextHover} transition flex items-center gap-1.5 disabled:opacity-50`}
          >
            <ChevronRight size={12} /> {step === 'connecting' ? `Opening ${theme.label}…` : 'Switch to a different page'}
          </button>
        )}
      </div>
    );
  }

  // ─── Stage 2 — placement picker (FB only; IG short-circuits to 'saved') ──
  if (step === 'picking' || step === 'saving') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-white">Select the page to connect:</p>
        {placements.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-white/40 text-sm">
            <Loader2 size={14} className="animate-spin mr-2" /> Loading your {theme.label} pages…
          </div>
        ) : (
          <div className="space-y-2">
            {placements.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePickPlacement(p)}
                disabled={step === 'saving'}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl glass card-hover hover:bg-blue-500/10 hover:border-blue-500/30 text-left group disabled:opacity-50"
              >
                <div className={`w-9 h-9 rounded-lg ${theme.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <theme.Icon size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                  <p className="text-xs text-white/30">{theme.label} Page · ID {p.id}</p>
                </div>
                {step === 'saving' ? (
                  <Loader2 size={15} className="text-blue-400 animate-spin flex-shrink-0" />
                ) : (
                  <ChevronRight size={15} className="text-white/20 group-hover:text-blue-400 transition flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Saved confirmation ─────────────────────────────
  if (step === 'saved') {
    return (
      <div className="space-y-3">
        <div className="bg-green-500/10 border border-green-500/25 rounded-2xl p-5 flex items-center gap-3">
          <CheckCircle className="text-green-400 flex-shrink-0" size={20} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">All set!</p>
            <p className="text-xs text-white/55 mt-0.5">
              Your {theme.label} {isInstagram ? 'account' : 'page'} is connected — auto-publishing is now active.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Default / error — connect button ────────────────
  return (
    <div className="space-y-3">
      {step === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs font-bold text-red-400 mb-1 flex items-center gap-1.5">
            <AlertCircle size={12} /> Connection failed
          </p>
          {error === 'NO_PLACEMENTS_FOUND' ? (
            <div className="text-xs text-red-300/80 leading-relaxed space-y-2">
              <p>
                No {theme.label} {isInstagram ? 'accounts' : 'Pages'} were found on your account. To use this app you need to be an
                {' '}<strong>admin of a {theme.label} {isInstagram ? 'Business or Creator account' : 'Page'}</strong> — a personal profile isn't enough.
              </p>
              <a
                href={isInstagram
                  ? 'https://help.instagram.com/502981923235522'
                  : 'https://www.facebook.com/pages/create'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 underline"
              >
                {isInstagram ? 'Set up an Instagram Business account' : 'Create a Facebook Page (free, 2 minutes)'} <ExternalLink size={11} />
              </a>
              <p className="text-white/30">After setup, come back and click Connect again.</p>
            </div>
          ) : (
            <p className="text-xs text-red-300/70 leading-relaxed">{error}</p>
          )}
        </div>
      )}

      {step === 'idle' && (
        <div className={`${theme.pillBg} border rounded-xl p-3 flex gap-2.5`}>
          <AlertCircle size={14} className="flex-shrink-0 text-blue-400/70 mt-0.5" />
          <div className="text-[11px] text-white/60 leading-relaxed">
            <p>
              You'll need to be an <strong className="text-white/80">admin of a {theme.label} {isInstagram ? 'Business or Creator account' : 'Page'}</strong>
              {' '}(a personal profile alone won't work).
            </p>
            <a
              href={isInstagram
                ? 'https://help.instagram.com/502981923235522'
                : 'https://www.facebook.com/pages/create'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-400/80 hover:text-blue-300 mt-1"
            >
              Don't have one? {isInstagram ? 'Switch to a Business account' : 'Create a Page'} <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={step === 'connecting'}
        className={`w-full flex items-center justify-center gap-3 ${theme.bg} ${theme.bgHover} disabled:opacity-60 text-white font-bold py-4 px-6 rounded-2xl text-sm transition ${theme.shadow} press`}
      >
        {step === 'connecting'
          ? <><Loader2 size={18} className="animate-spin" /> Opening {theme.label}…</>
          : <><theme.Icon size={18} /> Connect with {theme.label}</>
        }
      </button>

      {step === 'idle' && (
        <details className="group">
          <summary className="text-[11px] text-white/40 hover:text-white/60 cursor-pointer list-none flex items-center gap-1.5 transition">
            <ChevronRight size={11} className="group-open:rotate-90 transition" />
            What happens when I click Connect?
          </summary>
          <ol className="mt-2 ml-4 text-[11px] text-white/45 leading-relaxed space-y-1 list-decimal list-inside">
            <li>You'll be sent to a secure Facebook OAuth page</li>
            <li>Facebook will ask you to log in and approve the permissions we need</li>
            <li>You'll see a list of Pages you admin — tick the one for this business</li>
            <li>You'll see a summary of permissions — click <strong className="text-white/60">Continue</strong></li>
            <li>You'll be redirected back here to pick which Facebook Page to publish to</li>
          </ol>
        </details>
      )}

      <p className="text-[11px] text-white/25 text-center leading-relaxed">
        No passwords are stored. You can disconnect anytime.
      </p>
    </div>
  );
};
