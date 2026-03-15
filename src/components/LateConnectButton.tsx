import React, { useState, useEffect } from 'react';
import { CheckCircle, Loader2, X, Zap, Facebook, Instagram, AlertCircle } from 'lucide-react';
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

  const handleConnect = async () => {
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
      const authUrl = await LateService.getConnectUrl(pid, 'facebook', redirectUrl);

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
          return resolved;
        }
        // Method 2: diff accounts before/after — scoped to THIS profile only
        try {
          // Always filter by finalPid so we never pick up another workspace's accounts
          const accountsAfter = await LateService.getAccounts(finalPid);
          console.log('[Connect] Accounts AFTER (profile-scoped):', JSON.stringify(accountsAfter.map(a => ({ id: a.id, platform: a.platform, name: a.name }))));
          const newAccounts = accountsAfter.filter(a => !beforeIds.has(a.id));
          console.log('[Connect] NEW accounts (diff):', JSON.stringify(newAccounts));
          if (newAccounts.length > 0) {
            for (const acc of newAccounts) {
              resolved[acc.platform.toLowerCase()] = acc.id;
            }
            return resolved;
          }
          // Method 3: no new accounts found — take any account for this platform scoped to this profile
          for (const p of [platform.toLowerCase()]) {
            const matches = accountsAfter.filter(a => a.platform.toLowerCase() === p);
            if (matches.length > 0) {
              resolved[p] = matches[matches.length - 1].id;
              console.log(`[Connect] Using profile-scoped ${p} account:`, resolved[p]);
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
            // Resolve accountIds then call onConnected
            resolveAccountIds(platform, urlAccountId || undefined).then(accIds => {
              console.log('[Connect] Final resolved accountIds:', JSON.stringify(accIds));
              onConnected(finalPid, [platform], accIds);
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
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 bg-green-500/8 border border-green-500/20 rounded-2xl p-4">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Social accounts connected</p>
            <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
              <CheckCircle size={11} /> Auto-publishing active
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {connectedPlatforms.includes('facebook') && (
                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Facebook size={9} />
                  {connectedPageName ? connectedPageName : 'Facebook'}
                </span>
              )}
              {connectedPlatforms.includes('instagram') && (
                <span className="text-[10px] bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Instagram size={9} /> Instagram
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onDisconnect}
            className="text-white/20 hover:text-red-400 transition p-1.5 flex-shrink-0 rounded-lg hover:bg-red-500/10"
            title="Disconnect social accounts"
          >
            <X size={16} />
          </button>
        </div>
        <button
          onClick={handleConnect}
          disabled={step === 'connecting' || step === 'waiting'}
          className="w-full text-[11px] text-white/25 hover:text-white/50 transition py-1"
        >
          Reconnect or add Instagram →
        </button>
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
        onClick={handleConnect}
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
