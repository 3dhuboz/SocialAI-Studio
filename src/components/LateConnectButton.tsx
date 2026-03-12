import React, { useState } from 'react';
import { CheckCircle, Loader2, X, Zap, Facebook, Instagram, AlertCircle, ExternalLink } from 'lucide-react';
import { LateService, LatePage } from '../services/lateService';

interface Props {
  profileId?: string;
  connectedPlatforms?: string[];
  onConnected: (profileId: string, platforms: string[]) => void;
  onDisconnect: () => void;
  businessName?: string;
}

type Step = 'idle' | 'creating' | 'connecting' | 'picking' | 'error';

export const LateConnectButton: React.FC<Props> = ({
  profileId,
  connectedPlatforms = [],
  onConnected,
  onDisconnect,
  businessName = 'My Business',
}) => {
  const [step, setStep] = useState<Step>('idle');
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState('');
  const [pages, setPages] = useState<LatePage[]>([]);
  const [connectToken, setConnectToken] = useState('');
  const [pendingProfileId, setPendingProfileId] = useState('');

  const isConnected = !!profileId && connectedPlatforms.length > 0;

  const handleConnect = async () => {
    setStep('creating');
    setError('');
    try {
      let pid = profileId || pendingProfileId;

      if (!pid) {
        setStep('creating');
        pid = await LateService.createProfile(businessName);
        setPendingProfileId(pid);
      }

      setStep('connecting');
      const redirectUrl = `${window.location.origin}${window.location.pathname}?late_connect=1&profileId=${pid}`;
      const authUrl = await LateService.getConnectUrl(pid, 'facebook', redirectUrl);

      // Open OAuth in a popup
      const popup = window.open(authUrl, 'late_oauth', 'width=600,height=700,scrollbars=yes');
      if (!popup) {
        window.location.href = authUrl;
        return;
      }

      // Poll for the popup to close and check for connect_token in URL
      const poll = setInterval(async () => {
        try {
          if (popup.closed) {
            clearInterval(poll);
            setStep('idle');
            return;
          }
          const popupUrl = popup.location.href;
          if (popupUrl.includes('late_connect=1') || popupUrl.includes('connect_token=')) {
            const params = new URL(popupUrl).searchParams;
            const token = params.get('connect_token') || params.get('connectToken');
            popup.close();
            clearInterval(poll);

            if (token) {
              setConnectToken(token);
              setStep('picking');
              const ps = await LateService.listFacebookPages(token);
              setPages(ps);
            } else {
              // No token — connection may have completed without page selection
              onConnected(pid, ['facebook']);
              setStep('idle');
            }
          }
        } catch {
          // Cross-origin — popup still on Facebook, keep polling
        }
      }, 500);

    } catch (e: any) {
      setError(e?.message || 'Connection failed');
      setStep('error');
    }
  };

  const handleSelectPage = async (page: LatePage) => {
    setIsSelecting(true);
    try {
      await LateService.selectFacebookPage(connectToken, page.id);
      const pid = pendingProfileId || profileId!;
      onConnected(pid, ['facebook']);
      setPages([]);
      setConnectToken('');
      setPendingProfileId('');
      setIsSelecting(false);
      setStep('idle');
    } catch (e: any) {
      setIsSelecting(false);
      setError(e?.message || 'Failed to select page');
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
            <div className="flex gap-1.5 mt-1.5">
              {connectedPlatforms.includes('facebook') && (
                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Facebook size={9} /> Facebook
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
            className="text-white/20 hover:text-red-400 transition p-1 flex-shrink-0"
            title="Disconnect"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[11px] text-white/25 text-center">
          To add Instagram, reconnect and select both platforms.
        </p>
      </div>
    );
  }

  // ── Page picker ──────────────────────────────────────────────────────
  if (step === 'picking' && pages.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-white/60">Select your Facebook Page:</p>
        {pages.map(page => (
          <button
            key={page.id}
            onClick={() => handleSelectPage(page)}
            disabled={isSelecting}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 hover:border-blue-500/30 transition text-left disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              {page.picture
                ? <img src={page.picture} alt="" className="w-full h-full rounded-lg object-cover" />
                : <Facebook size={14} className="text-blue-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{page.name}</p>
              <p className="text-xs text-white/30">{page.id}</p>
            </div>
            {isSelecting ? <Loader2 size={13} className="animate-spin text-white/30" /> : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {step === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs font-bold text-red-400 mb-1 flex items-center gap-1.5">
            <AlertCircle size={12} /> Connection failed
          </p>
          <p className="text-xs text-red-300/70 leading-relaxed">{error}</p>
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={step === 'creating' || step === 'connecting'}
        className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 disabled:opacity-60 text-white font-bold py-4 px-6 rounded-2xl text-sm transition shadow-lg shadow-purple-900/30"
      >
        {step === 'creating' && <><Loader2 size={18} className="animate-spin" /> Creating your profile…</>}
        {step === 'connecting' && <><Loader2 size={18} className="animate-spin" /> Opening connection…</>}
        {(step === 'idle' || step === 'error') && (
          <>
            <Zap size={18} />
            Connect Facebook &amp; Instagram
          </>
        )}
      </button>

      <div className="flex items-center gap-2 justify-center">
        <Facebook size={11} className="text-white/20" />
        <Instagram size={11} className="text-white/20" />
        <p className="text-[11px] text-white/25 text-center">
          A secure popup will appear — log in and authorise in seconds.
        </p>
      </div>
    </div>
  );
};
