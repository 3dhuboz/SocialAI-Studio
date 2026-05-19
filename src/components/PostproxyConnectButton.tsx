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
  /** Already-connected presence indicator — when truthy, this component
   *  renders the "Connected" state. For FB it's the placement ID; for IG
   *  (no placements) it's the connected-at timestamp. Either works since
   *  the component only checks truthiness. */
  connectedPlacementId?: string;
  connectedPageName?: string;
  /** When true, the parent has manually navigated to Stage 2 (e.g. via
   *  the MigrationBanner's "Reconnect" button after a full-page reload
   *  finished OAuth). This bypasses the URL query-string check. */
  forcePickerStage?: boolean;
  /** Which platform to connect. Defaults to 'facebook' to preserve
   *  byte-identical behaviour for existing call sites. When 'instagram',
   *  the component skips Stage 2 entirely (IG has no placements per
   *  Postproxy docs §3299; the worker auto-flips use_postproxy=1 in the
   *  oauth-callback). */
  platform?: Platform;
}

/** URL ?step= values emitted by the worker's oauth-callback. FB lands
 *  on `picker` (placement-picker stage); IG lands on `connected` (no
 *  picker, already saved server-side); both can land on `failed`. */
const URL_STEP = {
  picker: 'pick-placement',
  connected: 'connected',
  failed: 'connect-failed',
} as const;

/** Platform-specific UI tokens — colours, copy, icon, setup-link copy.
 *  Keeps platform branching in ONE place; the JSX below reads from
 *  `theme` instead of inline ternaries. */
function platformTheme(platform: Platform) {
  if (platform === 'instagram') {
    return {
      label: 'Instagram',
      // Instagram brand gradient (pink → orange → purple). Solid pink
      // for hover since gradient-on-hover is janky cross-browser;
      // brand colour is #E1306C.
      bg: 'bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737]',
      bgHover: 'hover:opacity-90',
      shadow: 'shadow-lg shadow-pink-900/30',
      iconBg: 'bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#F77737]',
      pillBg: 'bg-pink-500/8 border-pink-500/20',
      pillTextHover: 'text-pink-400',
      Icon: Instagram,
      noun: 'account',
      nounPlural: 'accounts',
      adminOf: 'Business or Creator account',
      setupUrl: 'https://help.instagram.com/502981923235522',
      setupCta: 'Set up an Instagram Business account',
      setupCtaShort: 'Switch to a Business account',
      showOauthSteps: false,
    } as const;
  }
  return {
    label: 'Facebook',
    bg: 'bg-[#1877F2]',
    bgHover: 'hover:bg-[#166FE5]',
    shadow: 'shadow-lg shadow-blue-900/30',
    iconBg: 'bg-[#1877F2]',
    pillBg: 'bg-blue-500/5 border-blue-500/15',
    pillTextHover: 'text-blue-400',
    Icon: Facebook,
    noun: 'Page',
    nounPlural: 'Pages',
    adminOf: 'Page',
    setupUrl: 'https://www.facebook.com/pages/create',
    setupCta: 'Create a Facebook Page (free, 2 minutes)',
    setupCtaShort: 'Create a Page',
    showOauthSteps: true,
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

  // Detect Stage 2 — either the post-OAuth URL or forcePickerStage prop
  // (Migration banner reconnect). The ?workspace=<clientId|"own"> param
  // gates which workspace gets the save so a multi-client agency
  // doesn't accidentally save to the wrong one.
  useEffect(() => {
    if (connectedPlacementId) return; // already-connected wins
    const url = new URL(window.location.href);
    const urlStep = url.searchParams.get('step');
    const urlError = url.searchParams.get('postproxy_error');

    // OAuth failure path — worker redirects with
    // ?step=connect-failed&postproxy_error=<code>. Render the friendly
    // error and clean up the URL so a refresh doesn't re-show it.
    if (urlStep === URL_STEP.failed && urlError) {
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
    // IG OAuth lands on ?step=connected (no picker; docs §3299).
    // FB OAuth lands on ?step=pick-placement.
    const isStage2 = forcePickerStage
      || urlStep === URL_STEP.picker
      || urlStep === URL_STEP.connected;
    if (!isStage2) return;
    // ?step=connected is emitted only by IG OAuth callbacks. The FB
    // button must ignore it, and the IG button must ignore any
    // mismatched ?platform= (defends against future cross-platform
    // confusion if the worker ever emits ?step=connected for FB).
    if (urlStep === URL_STEP.connected) {
      if (platform !== 'instagram') return;
      if (urlPlatform && urlPlatform !== 'instagram') return;
    }

    // If the URL specifies a workspace that doesn't match the active
    // clientId prop, wait for the parent to re-render with the right
    // activeClientId. Handles the case where a user starts a reconnect
    // from a client workspace then refreshes on the agency view before
    // the callback lands.
    const expectsOwn = urlWorkspace === 'own';
    const expectsClient = urlWorkspace && urlWorkspace !== 'own';
    if (expectsOwn && clientId !== null) return;
    if (expectsClient && clientId !== urlWorkspace) return;

    let aborted = false;
    // IG short-circuit: no placement picker. The worker auto-flipped
    // use_postproxy=1 in the oauth-callback, so render saved directly.
    // placement.id is empty — the parent helper doesn't read it.
    if (isInstagram) {
      setStep('saved');
      try {
        url.searchParams.delete('step');
        url.searchParams.delete('workspace');
        url.searchParams.delete('platform');
        window.history.replaceState({}, '', url.toString());
      } catch { /* non-fatal */ }
      onConnected({ id: '', name: theme.label });
      return () => { aborted = true; };
    }

    setStep('picking');
    setError('');
    service.listPlacements(clientId, platform)
      .then((res) => {
        if (aborted) return;
        if (res.skipPicker) {
          // Defensive: IG short-circuit above should have caught this,
          // but honour worker-reported skipPicker for any platform.
          setStep('saved');
          onConnected({ id: '', name: theme.label });
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
    // onConnected + theme.label are event sinks — re-running on their
    // identity change would cause duplicate saveSocialTokens calls
    // whenever a parent re-render replaces the inline closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcePickerStage, clientId, connectedPlacementId, service, platform]);

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
            <p className="text-sm font-bold text-white">{connectedPageName || `${theme.label} ${theme.noun}`}</p>
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
              Your {theme.label} {theme.noun.toLowerCase()} is connected — auto-publishing is now active.
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
                No {theme.label} {theme.nounPlural} were found on your account. To use this app you need to be an
                {' '}<strong>admin of a {theme.label} {theme.adminOf}</strong> — a personal profile isn't enough.
              </p>
              <a
                href={theme.setupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 underline"
              >
                {theme.setupCta} <ExternalLink size={11} />
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
              You'll need to be an <strong className="text-white/80">admin of a {theme.label} {theme.adminOf}</strong>
              {' '}(a personal profile alone won't work).
            </p>
            <a
              href={theme.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-400/80 hover:text-blue-300 mt-1"
            >
              Don't have one? {theme.setupCtaShort} <ExternalLink size={10} />
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

      {step === 'idle' && theme.showOauthSteps && (
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
