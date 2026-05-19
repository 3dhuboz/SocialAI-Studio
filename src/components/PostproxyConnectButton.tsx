import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createPostproxyService, type Placement } from '../services/postproxyService';
import {
  Facebook, Loader2, CheckCircle, ChevronRight, AlertCircle, ExternalLink, X, Shield,
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
   *  the "Connected" state with a "Switch page" link. */
  connectedPlacementId?: string;
  connectedPageName?: string;
  /** When true, the parent has manually navigated to Stage 2 (e.g. via
   *  the MigrationBanner's "Reconnect" button after a full-page reload
   *  finished OAuth). This bypasses the URL query-string check. */
  forcePickerStage?: boolean;
}

type Step = 'idle' | 'connecting' | 'picking' | 'saving' | 'saved' | 'error';

export const PostproxyConnectButton: React.FC<Props> = ({
  clientId,
  onConnected,
  onDisconnect,
  connectedPlacementId,
  connectedPageName,
  forcePickerStage = false,
}) => {
  const { getApiToken, authMode } = useAuth();
  // Memoise so the service identity stays stable across renders — otherwise
  // any useEffect that depends on it loops.
  const service = useMemo(
    () => createPostproxyService(getApiToken, authMode),
    [getApiToken, authMode],
  );

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
    const urlWorkspace = url.searchParams.get('workspace');
    const isStage2 = forcePickerStage || urlStep === 'pick-placement';
    if (!isStage2) return;

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
    setStep('picking');
    setError('');
    service.listPlacements(clientId)
      .then((res) => {
        if (aborted) return;
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
  }, [forcePickerStage, clientId, connectedPlacementId, service]);

  const handleConnect = async () => {
    setStep('connecting');
    setError('');
    try {
      const { authUrl } = await service.initConnection(clientId);
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
          <div className="w-10 h-10 bg-[#1877F2] rounded-xl flex items-center justify-center flex-shrink-0">
            <Facebook size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{connectedPageName || 'Facebook Page'}</p>
            <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
              <CheckCircle size={11} /> Connected via Postproxy
            </p>
            <p className="text-[11px] mt-0.5">
              <span className="text-emerald-400/80 flex items-center gap-1">
                <Shield size={10} /> Token refresh + reel/story publishing handled by Postproxy
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
        <button
          onClick={handleConnect}
          disabled={step === 'connecting'}
          className="text-xs text-blue-400/60 hover:text-blue-400 transition flex items-center gap-1.5 disabled:opacity-50"
        >
          <ChevronRight size={12} /> {step === 'connecting' ? 'Opening Postproxy…' : 'Switch to a different page'}
        </button>
      </div>
    );
  }

  // ─── Stage 2 — placement picker ──────────────────────
  if (step === 'picking' || step === 'saving') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-white">Select the page to connect:</p>
        {placements.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-white/40 text-sm">
            <Loader2 size={14} className="animate-spin mr-2" /> Loading your Facebook pages…
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
                <div className="w-9 h-9 rounded-lg bg-[#1877F2] flex items-center justify-center flex-shrink-0">
                  <Facebook size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                  <p className="text-xs text-white/30">Facebook Page · ID {p.id}</p>
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
              Your Facebook page is connected via Postproxy — auto-publishing is now active.
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
                No Facebook Pages were found on your account. To use this app you need to be an
                {' '}<strong>admin of a Facebook Page</strong> — a personal profile isn't enough.
              </p>
              <a
                href="https://www.facebook.com/pages/create"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 underline"
              >
                Create a Facebook Page (free, 2 minutes) <ExternalLink size={11} />
              </a>
              <p className="text-white/30">After your Page is created, come back and click Connect again.</p>
            </div>
          ) : (
            <p className="text-xs text-red-300/70 leading-relaxed">{error}</p>
          )}
        </div>
      )}

      {step === 'idle' && (
        <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3 flex gap-2.5">
          <AlertCircle size={14} className="flex-shrink-0 text-blue-400/70 mt-0.5" />
          <div className="text-[11px] text-white/60 leading-relaxed">
            <p>
              You'll need to be an <strong className="text-white/80">admin of a Facebook Page</strong>
              {' '}(a personal profile alone won't work).
            </p>
            <a
              href="https://www.facebook.com/pages/create"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-400/80 hover:text-blue-300 mt-1"
            >
              Don't have one? Create a Page <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={step === 'connecting'}
        className="w-full flex items-center justify-center gap-3 bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 text-white font-bold py-4 px-6 rounded-2xl text-sm transition shadow-lg shadow-blue-900/30 press"
      >
        {step === 'connecting'
          ? <><Loader2 size={18} className="animate-spin" /> Opening Postproxy…</>
          : <><Facebook size={18} /> Connect with Facebook</>
        }
      </button>

      {step === 'idle' && (
        <details className="group">
          <summary className="text-[11px] text-white/40 hover:text-white/60 cursor-pointer list-none flex items-center gap-1.5 transition">
            <ChevronRight size={11} className="group-open:rotate-90 transition" />
            What happens when I click Connect?
          </summary>
          <ol className="mt-2 ml-4 text-[11px] text-white/45 leading-relaxed space-y-1 list-decimal list-inside">
            <li>You'll be sent to Postproxy's secure connect page</li>
            <li>Postproxy walks you through Facebook's official OAuth (it's a real Facebook page — not us)</li>
            <li>You'll see a list of Pages you admin — tick the one for this business</li>
            <li>You'll see a summary of permissions — click <strong className="text-white/60">Continue</strong></li>
            <li>You'll be redirected back here to pick which Facebook Page to publish to</li>
          </ol>
        </details>
      )}

      <p className="text-[11px] text-white/25 text-center leading-relaxed">
        Powered by <strong className="text-white/40">Postproxy</strong> — handles Facebook token refresh, reels, and story publishing on your behalf.
        <br />No passwords are stored. You can disconnect anytime.
      </p>
    </div>
  );
};
