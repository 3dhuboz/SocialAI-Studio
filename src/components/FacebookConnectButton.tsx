import React, { useState } from 'react';
import { FacebookService, FacebookPage } from '../services/facebookService';
import { CLIENT } from '../client.config';
import { Facebook, Loader2, CheckCircle, ChevronRight, AlertCircle, ExternalLink, X, Shield } from 'lucide-react';

interface Props {
  onConnected: (pageId: string, pageAccessToken: string, pageName: string, longLivedUserToken?: string, instagramBusinessAccountId?: string) => void;
  onDisconnect: () => void;
  connectedPageId?: string;
  connectedPageName?: string;
  instagramConnected?: boolean;
  tokenNeverExpires?: boolean | undefined;  // true=permanent, false=known short-lived, undefined=unknown
}

type Step = 'idle' | 'logging_in' | 'picking' | 'error';

export const FacebookConnectButton: React.FC<Props> = ({
  onConnected, onDisconnect, connectedPageId, connectedPageName, instagramConnected, tokenNeverExpires,
}) => {
  const [step, setStep] = useState<Step>('idle');
  const [pages, setPages] = useState<(FacebookPage & { instagramBusinessAccountId?: string })[]>([]);
  const [longLivedToken, setLongLivedToken] = useState<string | undefined>();
  const [usingPermanentTokens, setUsingPermanentTokens] = useState(false);
  const [error, setError] = useState('');
  const hasAppId = !!CLIENT.facebookAppId;

  const handleConnect = async () => {
    setStep('logging_in');
    setError('');
    try {
      await FacebookService.init(CLIENT.facebookAppId);
      // FLB mode if a Configuration ID is set (modern asset-picker UX).
      // Falls back to classic scope-based flow when configId is absent.
      const configId = (CLIENT as any).facebookLoginConfigId || undefined;
      const authResponse = await FacebookService.login(configId);
      const shortLivedToken: string = authResponse?.accessToken;

      let fetchedPages: FacebookPage[] = [];
      let llt: string | undefined;
      let permanent = false;

      // Try the Netlify token-exchange function first (permanent page tokens)
      try {
        const result = await FacebookService.exchangeForLongLivedPages(shortLivedToken);
        fetchedPages = result.pages;
        llt = result.longLivedUserToken;
        permanent = result.pageTokensNeverExpire;
      } catch (exchangeErr: any) {
        // Netlify function not available (e.g. local dev) — fall back to short-lived tokens
        console.warn('Token exchange unavailable, using short-lived tokens:', exchangeErr.message);
        fetchedPages = await FacebookService.getPages();
      }

      setLongLivedToken(llt);
      setUsingPermanentTokens(permanent);

      if (fetchedPages.length === 0) {
        setError('NO_PAGES_FOUND');
        setStep('error');
        return;
      }
      if (fetchedPages.length === 1) {
        const p = fetchedPages[0] as any;
        onConnected(p.id, p.access_token, p.name, llt, p.instagramBusinessAccountId);
        setStep('idle');
        return;
      }
      setPages(fetchedPages);
      setStep('picking');
    } catch (e: any) {
      const msg: string = e?.message || String(e);
      if (msg.includes('cancelled') || msg.includes('cancel')) {
        setStep('idle');
        return;
      }
      if (msg.includes('SDK not initialized') || msg.includes('appId')) {
        setError('Facebook App ID is not configured. See setup instructions below.');
      } else if (msg.includes('permission') || msg.includes('scope')) {
        setError('Missing permissions. Make sure to tick all three permissions when the popup appears.');
      } else {
        setError(msg.substring(0, 200));
      }
      setStep('error');
    }
  };

  const handlePickPage = (page: FacebookPage & { instagramBusinessAccountId?: string }) => {
    onConnected(page.id, page.access_token, page.name, longLivedToken, page.instagramBusinessAccountId);
    setPages([]);
    setStep('idle');
  };

  const handleDisconnect = () => {
    onDisconnect();
    setStep('idle');
    setPages([]);
    setError('');
  };

  // ─── Already connected ───────────────────────────────
  if (connectedPageId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 bg-green-500/8 border border-green-500/20 rounded-2xl p-4">
          <div className="w-10 h-10 bg-[#1877F2] rounded-xl flex items-center justify-center flex-shrink-0">
            <Facebook size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{connectedPageName || 'Facebook Page'}</p>
            <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
              <CheckCircle size={11} /> Connected · auto-publishing active
            </p>
            <p className="text-[11px] mt-0.5">
              <span className="text-emerald-400/80 flex items-center gap-1"><Shield size={10} /> Token auto-refreshes daily — never expires</span>
            </p>
            {instagramConnected ? (
              <p className="text-[11px] mt-0.5">
                <span className="text-fuchsia-400/80 flex items-center gap-1"><CheckCircle size={10} /> Instagram connected</span>
              </p>
            ) : (
              <p className="text-[11px] mt-0.5">
                <span className="text-white/25 flex items-center gap-1">Instagram not linked — add this account as a Test User in your Facebook App to enable</span>
              </p>
            )}
            {tokenNeverExpires === false && (
              <p className="text-[11px] mt-0.5">
                <span className="text-amber-400/60 flex items-center gap-1">⚠ Short-lived token — reconnect to upgrade</span>
              </p>
            )}
          </div>
          <button
            onClick={handleDisconnect}
            className="text-white/20 hover:text-red-400 transition p-1 flex-shrink-0"
            title="Disconnect"
          >
            <X size={16} />
          </button>
        </div>
        <button
          onClick={handleConnect}
          disabled={!hasAppId}
          className="text-xs text-blue-400/60 hover:text-blue-400 transition flex items-center gap-1.5"
        >
          <ChevronRight size={12} /> Switch to a different page
        </button>
      </div>
    );
  }

  // ─── Page picker (multiple pages found) ─────────────
  if (step === 'picking') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-white">Select the page to connect:</p>
        <div className="space-y-2">
          {pages.map(page => (
            <button
              key={page.id}
              onClick={() => handlePickPage(page)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl glass card-hover hover:bg-blue-500/10 hover:border-blue-500/30 text-left group"
            >
              {page.picture?.data?.url
                ? <img src={page.picture.data.url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                : (
                  <div className="w-9 h-9 rounded-lg bg-[#1877F2] flex items-center justify-center flex-shrink-0">
                    <Facebook size={16} className="text-white" />
                  </div>
                )
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{page.name}</p>
                <p className="text-xs text-white/30">{page.category}</p>
              </div>
              <ChevronRight size={15} className="text-white/20 group-hover:text-blue-400 transition flex-shrink-0" />
            </button>
          ))}
        </div>
        <button onClick={() => { setStep('idle'); setPages([]); }} className="text-xs text-white/30 hover:text-white/50 transition">
          Cancel
        </button>
      </div>
    );
  }

  // ─── App ID not configured ───────────────────────────
  if (!hasAppId) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-500/8 border border-amber-500/15 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-amber-300 flex items-center gap-2">
            <AlertCircle size={15} /> One-time Facebook App setup required
          </p>
          <p className="text-xs text-white/50 leading-relaxed">
            To enable one-click Facebook connection for your clients, you need a Facebook Developer App configured for <strong className="text-amber-300">Facebook Login for Business</strong>, then paste your App ID into <code className="bg-white/10 px-1.5 rounded text-amber-300">client.config.ts</code>.
          </p>
          <ol className="text-xs text-white/40 space-y-2 list-decimal list-inside leading-relaxed">
            <li>Go to <a href="https://developers.facebook.com/apps/create/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-0.5">developers.facebook.com <ExternalLink size={10} /></a> → Create App → <strong className="text-white/60">Business</strong></li>
            <li>Add the <strong className="text-white/60">Facebook Login for Business</strong> product (preferred) or <strong className="text-white/60">Facebook Login</strong></li>
            <li>Facebook Login for Business → <strong className="text-white/60">Configurations</strong> → Create new. Token type = <em>User access token</em>. Permissions: <code className="bg-white/10 px-1 rounded text-blue-300">pages_show_list</code> <code className="bg-white/10 px-1 rounded text-blue-300">pages_manage_posts</code> <code className="bg-white/10 px-1 rounded text-blue-300">pages_read_engagement</code> <code className="bg-white/10 px-1 rounded text-blue-300">instagram_basic</code> <code className="bg-white/10 px-1 rounded text-blue-300">instagram_content_publish</code>. Asset types: Pages + Instagram Accounts.</li>
            <li>Add your domain to Valid OAuth Redirect URIs (e.g. <code className="bg-white/10 px-1 rounded">https://socialaistudio.au</code>)</li>
            <li>Copy your <strong className="text-white/60">App ID</strong> into <code className="bg-white/10 px-1 rounded text-amber-300">facebookAppId</code> and your <strong className="text-white/60">Configuration ID</strong> into <code className="bg-white/10 px-1 rounded text-amber-300">facebookLoginConfigId</code> (or set <code className="bg-white/10 px-1 rounded">VITE_FACEBOOK_LOGIN_CONFIG_ID</code> in CF Pages env vars).</li>
          </ol>
        </div>
        <p className="text-xs text-white/25 text-center">In the meantime, use the manual token method below ↓</p>
      </div>
    );
  }

  // ─── Default — connect button ────────────────────────
  return (
    <div className="space-y-3">
      {step === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs font-bold text-red-400 mb-1 flex items-center gap-1.5"><AlertCircle size={12} /> Connection failed</p>
          {error === 'NO_PAGES_FOUND' ? (
            <div className="text-xs text-red-300/80 leading-relaxed space-y-2">
              <p>No Facebook Pages were found on your account. To use this app you need to be an <strong>admin of a Facebook Page</strong> — a personal profile isn't enough.</p>
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

      {/* Pre-flight hint — only shown before they've clicked Connect */}
      {step === 'idle' && (
        <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3 flex gap-2.5">
          <AlertCircle size={14} className="flex-shrink-0 text-blue-400/70 mt-0.5" />
          <div className="text-[11px] text-white/60 leading-relaxed">
            <p>You'll need to be an <strong className="text-white/80">admin of a Facebook Page</strong> (a personal profile alone won't work).</p>
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
        disabled={step === 'logging_in'}
        className="w-full flex items-center justify-center gap-3 bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 text-white font-bold py-4 px-6 rounded-2xl text-sm transition shadow-lg shadow-blue-900/30 press"
      >
        {step === 'logging_in'
          ? <><Loader2 size={18} className="animate-spin" /> Connecting…</>
          : <><Facebook size={18} /> Connect with Facebook</>
        }
      </button>

      <p className="text-[11px] text-white/25 text-center leading-relaxed">
        A Facebook popup will appear. Log in and pick your Page — that's it.
        <br />No passwords are stored — only your Page access token.
      </p>
    </div>
  );
};
