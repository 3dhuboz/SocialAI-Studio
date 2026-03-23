import React, { useState, useEffect } from 'react';
import { CheckCircle, Loader2, X, Zap, Facebook, Instagram, AlertCircle, RefreshCw } from 'lucide-react';
import { LateService } from '../services/lateService';

interface Props {
  profileId?: string;
  connectedPlatforms?: string[];
  onConnected: (profileId: string, platforms: string[], accountIds?: Record<string, string>) => void;
  onDisconnect: () => void;
  businessName?: string;
}

type Step = 'idle' | 'creating' | 'connecting' | 'waiting' | 'error';

export const LateConnectButton: React.FC<Props> = ({
  profileId,
  connectedPlatforms = [],
  onConnected,
  onDisconnect,
  businessName = 'My Business',
}) => {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [connectedPageName, setConnectedPageName] = useState<string | null>(null);

  const isConnected = !!profileId && connectedPlatforms.length > 0;

  useEffect(() => {
    if (!isConnected || !profileId) return;
    let cancelled = false;
    LateService.getProfileInfo(profileId)
      .then((data: any) => {
        if (cancelled) return;
        const name =
          data?.accounts?.[0]?.name ||
          data?.connections?.[0]?.name ||
          data?.pages?.[0]?.name ||
          data?.facebook?.pageName ||
          data?.facebook?.name ||
          data?.name ||
          null;
        setConnectedPageName(name);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, isConnected]);

  const handleConnect = async (connectPlatform: 'facebook' | 'instagram' = 'facebook') => {
    setStep('creating');
    setError('');
    try {
      // ── Reuse THIS workspace's profile or create a brand-new one ─────
      // IMPORTANT: never reuse another workspace's profile — each workspace
      // must have its own Late profile so it can connect to its own FB page.
      let pid = profileId;
      if (!pid) {
        const name = businessName || 'SocialAI Client';
        try {
          pid = await LateService.createProfile(name);
        } catch (createErr: any) {
          // Late.dev rejects duplicate names — find the existing profile instead
          if (createErr?.message?.toLowerCase().includes('already exists')) {
            console.log('Profile name exists, looking up existing profile for:', name);
            const existing = await LateService.listProfiles();
            const match = existing.find(p => p.name === name) || existing[0];
            if (match) pid = match.id;
            else throw createErr; // truly no profile found
          } else {
            throw createErr;
          }
        }
      }

      // ── Standard mode: Late hosts page selection UI ───────────────────
      setStep('connecting');
      const redirectUrl = `${window.location.origin}${window.location.pathname}?late_cb=1`;
      const authUrl = await LateService.getConnectUrl(pid, connectPlatform, redirectUrl);

      // Snapshot accounts BEFORE connecting so we can diff after
      let accountsBefore: { id: string; platform: string; name?: string }[] = [];
      try {
        accountsBefore = await LateService.getAccounts();
        console.log('[Connect] Accounts BEFORE:', JSON.stringify(accountsBefore.map(a => ({ id: a.id, platform: a.platform, name: a.name }))));
      } catch (e) { console.warn('[Connect] Failed to snapshot accounts before:', e); }

      // Open popup — Late handles page selection, redirects back when done
      const popup = window.open(authUrl, 'late_oauth', 'width=640,height=720,scrollbars=yes,resizable=yes');
      if (!popup) {
        // Popup blocked — redirect instead
        window.location.href = authUrl;
        return;
      }

      setStep('waiting');

      const finalPid = pid;
      const beforeIds = new Set(accountsBefore.map(a => a.id));

      const resolveAccountIds = async (platform: string, urlAccountId?: string): Promise<Record<string, string>> => {
        const resolved: Record<string, string> = {};
        // Method 1: accountId from redirect URL
        if (urlAccountId) {
          console.log('[Connect] Got accountId from redirect URL:', urlAccountId);
          resolved[platform.toLowerCase()] = urlAccountId;
        }
        // Method 2: scan ALL accounts for this profile — pick up both Facebook AND Instagram
        try {
          const accountsAfter = await LateService.getAccounts(finalPid);
          console.log('[Connect] Accounts AFTER (profile-scoped):', JSON.stringify(accountsAfter.map(a => ({ id: a.id, platform: a.platform, name: a.name }))));

          // Check for new accounts (diff)
          const newAccounts = accountsAfter.filter(a => !beforeIds.has(a.id));
          console.log('[Connect] NEW accounts (diff):', JSON.stringify(newAccounts));
          if (newAccounts.length > 0) {
            for (const acc of newAccounts) {
              resolved[acc.platform.toLowerCase()] = acc.id;
            }
          }

          // ALWAYS scan for all platforms — pick up Instagram even if it's not "new"
          for (const p of ['facebook', 'instagram']) {
            if (!resolved[p]) {
              const matches = accountsAfter.filter(a => a.platform.toLowerCase() === p);
              if (matches.length > 0) {
                resolved[p] = matches[matches.length - 1].id;
                console.log(`[Connect] Found ${p} account:`, resolved[p]);
              }
            }
          }
        } catch (e) { console.warn('[Connect] Failed to resolve accountIds:', e); }
        return resolved;
      };

      const poll = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(poll);
            // Popup closed without redirect — try to resolve anyway
            resolveAccountIds('facebook').then(accIds => {
              if (Object.keys(accIds).length > 0) {
                onConnected(finalPid, Object.keys(accIds), accIds);
              }
            });
            setStep('idle');
            return;
          }
          const href = popup.location.href;
          if (href.includes('late_cb=1') || href.includes('connected=')) {
            const params = new URL(href).searchParams;
            const platform = params.get('connected') || 'facebook';
            const urlAccountId = params.get('accountId') || params.get('account_id') || '';
            popup.close();
            clearInterval(poll);
            // Resolve accountIds then call onConnected — pass ALL detected platforms
            resolveAccountIds(platform, urlAccountId || undefined).then(accIds => {
              console.log('[Connect] Final resolved accountIds:', JSON.stringify(accIds));
              onConnected(finalPid, Object.keys(accIds), accIds);
            });
            setStep('idle');
          }
        } catch {
          // Cross-origin while on Facebook/Late — keep polling
        }
      }, 600);

    } catch (e: any) {
      setError(e?.message || 'Connection failed');
      setStep('error');
    }
  };

  // ── Already connected ────────────────────────────────────────────────
  if (isConnected) {
    const hasFb = connectedPlatforms.includes('facebook');
    const hasIg = connectedPlatforms.includes('instagram');
    const isBusy = step === 'connecting' || step === 'waiting';

    return (
      <div className="space-y-3">
        {/* Facebook connection */}
        <div className={`flex items-center gap-3 ${hasFb ? 'bg-green-500/8 border-green-500/20' : 'bg-white/3 border-white/10'} border rounded-2xl p-4`}>
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Facebook size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Facebook</p>
            {hasFb ? (
              <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
                <CheckCircle size={10} /> {connectedPageName || 'Connected'} &middot; Auto-publishing active
              </p>
            ) : (
              <p className="text-xs text-white/40 mt-0.5">Not connected</p>
            )}
          </div>
          {hasFb ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => handleConnect('facebook')} disabled={isBusy} className="text-[10px] text-white/25 hover:text-blue-300 transition px-2 py-1 rounded-lg hover:bg-blue-500/10" title="Reconnect">
                <RefreshCw size={12} />
              </button>
              <button onClick={onDisconnect} className="text-white/20 hover:text-red-400 transition p-1 rounded-lg hover:bg-red-500/10" title="Disconnect Facebook">
                <X size={13} />
              </button>
            </div>
          ) : (
            <button onClick={() => handleConnect('facebook')} disabled={isBusy} className="text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg transition">
              Connect
            </button>
          )}
        </div>

        {/* Instagram connection */}
        <div className={`flex items-center gap-3 ${hasIg ? 'bg-green-500/8 border-green-500/20' : 'bg-white/3 border-white/10'} border rounded-2xl p-4`}>
          <div className="w-9 h-9 bg-gradient-to-br from-pink-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Instagram size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Instagram</p>
            {hasIg ? (
              <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
                <CheckCircle size={10} /> Connected &middot; Auto-publishing active
              </p>
            ) : hasFb ? (
              <p className="text-xs text-white/40 mt-0.5">Not connected &middot; Reconnect Facebook to auto-detect</p>
            ) : (
              <p className="text-xs text-white/40 mt-0.5">Connect Facebook first, then Instagram will auto-detect</p>
            )}
          </div>
          {hasIg ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => handleConnect('facebook')} disabled={isBusy} className="text-[10px] text-white/25 hover:text-pink-300 transition px-2 py-1 rounded-lg hover:bg-pink-500/10" title="Reconnect">
                <RefreshCw size={12} />
              </button>
            </div>
          ) : hasFb ? (
            <button onClick={() => handleConnect('facebook')} disabled={isBusy} className="text-xs font-semibold text-pink-400 hover:text-pink-300 bg-pink-500/10 hover:bg-pink-500/20 px-3 py-1.5 rounded-lg transition" title="Reconnect Facebook to detect linked Instagram">
              Detect
            </button>
          ) : null}
        </div>

        {/* Loading states */}
        {isBusy && (
          <div className="flex items-center justify-center gap-2 text-xs text-white/40 py-2">
            <Loader2 size={14} className="animate-spin" />
            {step === 'connecting' ? 'Opening connection...' : 'Waiting — select your page in the popup...'}
          </div>
        )}
      </div>
    );
  }

  const isBusy = step === 'creating' || step === 'connecting' || step === 'waiting';

  return (
    <div className="space-y-3">
      {step === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-400 mb-1">Connection failed</p>
            <p className="text-xs text-red-300/70 leading-relaxed break-words">{error}</p>
          </div>
          <button onClick={() => { setStep('idle'); setError(''); }} className="text-white/20 hover:text-white/50 transition flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <button
        onClick={() => handleConnect('facebook')}
        disabled={isBusy}
        className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 disabled:opacity-60 text-white font-bold py-4 px-6 rounded-2xl text-sm transition shadow-lg shadow-purple-900/30"
      >
        {step === 'creating' && <><Loader2 size={18} className="animate-spin" /> Setting up your profile…</>}
        {step === 'connecting' && <><Loader2 size={18} className="animate-spin" /> Opening connection…</>}
        {step === 'waiting' && <><Loader2 size={18} className="animate-spin" /> Waiting — select your page in the popup…</>}
        {(step === 'idle' || step === 'error') && (
          <><Zap size={18} /> Connect Facebook &amp; Instagram</>
        )}
      </button>

      <div className="flex items-center gap-2 justify-center">
        <Facebook size={11} className="text-white/20" />
        <Instagram size={11} className="text-white/20" />
        <p className="text-[11px] text-white/25 text-center">
          A secure popup will appear — select your page and authorise in seconds.
        </p>
      </div>
    </div>
  );
};
