import React from 'react';
import { CLIENT } from '../client.config';
import { CheckCircle, Clock, Loader2, Zap, ExternalLink } from 'lucide-react';
import { SetupStatus } from '../types';

interface Props {
  status: SetupStatus;
  onStatusChange?: (s: SetupStatus) => void;
  isAdmin?: boolean;
}

const steps: { id: SetupStatus; label: string; sub: string }[] = [
  { id: 'ordered',     label: 'Payment Confirmed',    sub: 'Subscription active' },
  { id: 'form_sent',   label: 'Profile Set Up',       sub: 'Business details saved' },
  { id: 'in_progress', label: 'Facebook Connected',   sub: 'Ready to publish' },
  { id: 'live',        label: "You're Live!",          sub: 'All systems go' },
];

const statusIndex = (s: SetupStatus) => steps.findIndex(x => x.id === s);

export const SetupBanner: React.FC<Props> = ({ status, onStatusChange, isAdmin }) => {
  const idx = statusIndex(status);
  const isLive = status === 'live';

  if (isLive) return null;

  return (
    <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/8 to-transparent border border-amber-500/20 rounded-2xl p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-500/20 border border-amber-500/30 rounded-xl flex items-center justify-center">
            <Clock size={17} className="text-amber-400" />
          </div>
          <div>
            <p className="font-bold text-amber-300 text-sm">Setup in progress — up to 3 business days</p>
            <p className="text-xs text-white/40 mt-0.5">
              We're connecting your Facebook Business page. Check your email for the setup form.
            </p>
          </div>
        </div>
        <a
          href={`mailto:${CLIENT.supportEmail}`}
          className="text-xs text-amber-400/70 hover:text-amber-400 flex items-center gap-1.5 transition whitespace-nowrap"
        >
          <ExternalLink size={12} /> Contact support
        </a>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const done = i <= idx;
          const active = i === idx;
          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center min-w-0 flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition ${
                  done
                    ? active && !isLive
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                      : 'bg-green-500/20 border-green-500 text-green-400'
                    : 'bg-white/5 border-white/15 text-white/20'
                }`}>
                  {done && !active ? (
                    <CheckCircle size={14} />
                  ) : active ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <span className="text-xs font-bold">{i + 1}</span>
                  )}
                </div>
                <p className={`text-[10px] font-semibold mt-1.5 text-center leading-tight ${done ? active ? 'text-amber-300' : 'text-green-300' : 'text-white/25'}`}>
                  {step.label}
                </p>
                <p className="text-[9px] text-white/20 text-center hidden sm:block">{step.sub}</p>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-px flex-1 mx-1 mb-5 transition ${i < idx ? 'bg-green-500/40' : 'bg-white/10'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Admin controls */}
      {isAdmin && onStatusChange && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-[10px] text-white/30 mb-2 font-bold uppercase tracking-widest">Admin: advance setup status</p>
          <div className="flex flex-wrap gap-2">
            {steps.map((step) => (
              <button
                key={step.id}
                onClick={() => onStatusChange(step.id)}
                className={`text-[10px] px-3 py-1.5 rounded-lg border transition font-semibold ${
                  status === step.id
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-white/5 border-white/10 text-white/30 hover:bg-white/10'
                }`}
              >
                {step.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const LiveBadge: React.FC = () => (
  <div className="inline-flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold px-3 py-1 rounded-full">
    <Zap size={11} /> Live
  </div>
);
