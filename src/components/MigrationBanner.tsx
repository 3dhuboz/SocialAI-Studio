import React from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import type { SocialTokens } from '../types';

/**
 * MigrationBanner — shown above the dashboard when a workspace has a
 * legacy Facebook connection (`facebookPageId` set) but no Postproxy
 * placement yet (`postproxyPlacementId` unset). The dual-path migration
 * window keeps the legacy Graph publish path working while the user
 * decides when to reconnect; this banner is the prompt that closes that
 * window.
 *
 * Once the user clicks Reconnect, the parent flips into the
 * `PostproxyConnectButton` Stage-1 flow. On successful save-placement,
 * `users.use_postproxy` flips to 1 and the publish cron starts routing
 * this workspace through Postproxy on its next */
interface Props {
  /** Current workspace social tokens. We only render the banner when
   *  the legacy fields are set but the Postproxy placement isn't. */
  socialTokens: SocialTokens;
  /** Active workspace id — informational; the Reconnect handler reads
   *  it via the parent's PostproxyConnectButton state. */
  clientId?: string | null;
  /** Click handler — parent navigates the user to whichever screen
   *  hosts the PostproxyConnectButton (Settings tab, Onboarding wizard,
   *  or an inline modal). */
  onReconnect: () => void;
  /** Optional className for layout spacing — parent controls margin
   *  rather than the banner hard-coding it. */
  className?: string;
}

export const MigrationBanner: React.FC<Props> = ({
  socialTokens,
  onReconnect,
  className = '',
}) => {
  // Show ONLY for the legacy → Postproxy migration cohort:
  //   • Legacy Facebook connection exists (facebookPageId present)
  //   • Postproxy placement NOT yet chosen
  const hasLegacy = !!socialTokens.facebookPageId;
  const hasPostproxy = !!socialTokens.postproxyPlacementId;
  if (!hasLegacy || hasPostproxy) return null;

  return (
    <div
      className={`rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex items-center justify-between gap-4 ${className}`}
      role="alert"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-500/20">
          <AlertCircle size={16} className="text-amber-300" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">
            We've upgraded our Facebook publishing
          </p>
          <p className="text-xs text-white/55 leading-relaxed">
            Reconnect once to enable <strong className="text-white/80">Reels</strong>, <strong className="text-white/80">Stories</strong>,
            and improved reliability. Your current connection still works — but new features land on the new path.
          </p>
        </div>
      </div>
      <button
        onClick={onReconnect}
        className="flex-shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition text-sm flex items-center gap-1.5 whitespace-nowrap"
      >
        Reconnect <ArrowRight size={14} />
      </button>
    </div>
  );
};
