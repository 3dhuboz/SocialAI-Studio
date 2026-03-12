import React, { useState } from 'react';
import { FacebookService, FacebookPage } from '../services/facebookService';
import { CLIENT } from '../client.config';
import { Facebook, Loader2, CheckCircle, ChevronRight, AlertCircle, ExternalLink, X, Shield } from 'lucide-react';

interface Props {
  onConnected: (pageId: string, pageAccessToken: string, pageName: string, longLivedUserToken?: string) => void;
  onDisconnect: () => void;
  connectedPageId?: string;
  connectedPageName?: string;
  tokenNeverExpires?: boolean | undefined;  // true=permanent, false=known short-lived, undefined=unknown
}

type Step = 'idle' | 'logging_in' | 'picking' | 'error';

export const FacebookConnectButton: React.FC<Props> = ({
  onConnected, onDisconnect, connectedPageId, connectedPageName, tokenNeverExpires,
}) => {
  const [step, setStep] = useState<Step>('idle');
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [longLivedToken, setLongLivedToken] = useState<string | undefined>();
  const [usingPermanentTokens, setUsingPermanentTokens] = useState(false);
  const [error, setError] = useState('');
  const hasAppId = !!CLIENT.facebookAppId;

  const handleConnect = async () => {
    setStep('logging_in');
    setError('');
    try {
      await FacebookService.init(CLIENT.facebookAppId);
      const authResponse = await FacebookService.login();
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
        setError('No Facebook Pages found on your account. Make sure you are an admin of a Facebook Page (not just a personal profile).');
        setStep('error');
        return;
      }
      if (fetchedPages.length === 1) {
        const p = fetchedPages[0];
        onConnected(p.id, p.access_token, p.name, llt);
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

  const handlePickPage = (page: FacebookPage) => {
    onConnected(page.id, page.access_token, page.name, longLivedToken);
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
            {tokenNeverExpires === true && (
              <p className="text-[11px] mt-0.5">
                <span className="text-emerald-400/80 flex items-center gap-1"><Shield size={10} /> Permanent token — never expires</span>
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
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/8 bg-white/3 hover:bg-blue-500/10 hover:border-blue-500/30 transition text-left group"
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
            To enable one-click Facebook connection for your clients, you need to create a free Facebook Developer App and paste your App ID into <code className="bg-white/10 px-1.5 rounded text-amber-300">client.config.ts</code>.
          </p>
          <ol className="text-xs text-white/40 space-y-2 list-decimal list-inside leading-relaxed">
            <li>Go to <a href="https://developers.facebook.com/apps/create/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-0.5">developers.facebook.com <ExternalLink size={10} /></a> → Create App → <strong className="text-white/60">Business</strong></li>
            <li>Add the <strong className="text-white/60">Facebook Login</strong> product</li>
            <li>Facebook Login → Settings → add <code className="bg-white/10 px-1 rounded">https://socialai-studio.pages.dev</code> to Valid OAuth Redirect URIs</li>
            <li>Request permissions: <code className="bg-white/10 px-1 rounded text-blue-300">pages_show_list</code> <code className="bg-white/10 px-1 rounded text-blue-300">pages_manage_posts</code> <code className="bg-white/10 px-1 rounded text-blue-300">pages_read_engagement</code></li>
            <li>Copy your <strong className="text-white/60">App ID</strong> and paste it into <code className="bg-white/10 px-1 rounded">client.config.ts</code> → <code className="bg-white/10 px-1 rounded text-amber-300">facebookAppId</code></li>
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
          <p className="text-xs text-red-300/70 leading-relaxed">{error}</p>
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={step === 'logging_in'}
        className="w-full flex items-center justify-center gap-3 bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 text-white font-bold py-4 px-6 rounded-2xl text-sm transition shadow-lg shadow-blue-900/30"
      >
        {step === 'logging_in'
          ? <><Loader2 size={18} className="animate-spin" /> Connecting…</>
          : <><Facebook size={18} /> Connect with Facebook</>
        }
      </button>

      <p className="text-[11px] text-white/25 text-center leading-relaxed">
        A Facebook popup will appear. Log in, choose your Page, and tick the 3 permissions.
        <br />No passwords are stored — only your Page access token.
      </p>
    </div>
  );
};
