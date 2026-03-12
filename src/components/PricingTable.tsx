import React, { useEffect, useState } from 'react';
import { CLIENT } from '../client.config';
import { CheckCircle, Zap, ArrowRight, X, Loader2, Shield, Lock } from 'lucide-react';

interface Props {
  onClose?: () => void;
  selectedPlan?: string | null;
}

const planGlows: Record<string, string> = {
  starter: 'rgba(59,130,246,0.15)',
  growth:  'rgba(245,158,11,0.15)',
  pro:     'rgba(168,85,247,0.15)',
  agency:  'rgba(16,185,129,0.15)',
};

const planBorderActive: Record<string, string> = {
  starter: 'border-blue-500/40',
  growth:  'border-amber-500/40',
  pro:     'border-purple-500/40',
  agency:  'border-emerald-500/40',
};

const planCheckColor: Record<string, string> = {
  starter: 'text-blue-400',
  growth:  'text-amber-400',
  pro:     'text-purple-400',
  agency:  'text-emerald-400',
};

export const PricingTable: React.FC<Props> = ({ onClose }) => {
  const [fallback, setFallback] = useState(false);

  const handlePlanClick = (planId: string) => {
    const link = (CLIENT.stripePaymentLinks as Record<string, string>)[planId];
    if (link) {
      window.open(link, '_blank');
    } else {
      setFallback(true);
    }
  };

  if (fallback) {
    return <StripeFallback onClose={onClose} onBack={() => setFallback(false)} />;
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/85 backdrop-blur-lg flex items-start justify-center p-4 pt-6 overflow-y-auto">
      <div className="w-full max-w-5xl pb-10">
        {/* Header row */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-black text-white">Choose your plan</h2>
            <p className="text-white/35 text-sm mt-1">One-time $99 setup · Cancel anytime · No lock-in</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white bg-white/8 hover:bg-white/15 rounded-xl px-4 py-2 text-sm transition flex items-center gap-2"
            >
              <X size={14} /> Close
            </button>
          )}
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {CLIENT.plans.map((plan) => {
            const glow = planGlows[plan.id] || 'rgba(255,255,255,0.05)';
            const borderClass = planBorderActive[plan.id] || 'border-white/15';
            const checkClass = planCheckColor[plan.id] || 'text-green-400';
            const isPopular = plan.badge === 'Most Popular';

            return (
              <div
                key={plan.id}
                className={`relative rounded-3xl border flex flex-col overflow-hidden transition-transform hover:scale-[1.02] ${
                  isPopular ? `${borderClass} shadow-2xl` : `${borderClass}`
                }`}
                style={{ background: `linear-gradient(160deg, ${glow} 0%, #0d0d14 55%)` }}
              >
                {/* Coloured top bar */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${plan.color}`} />

                {/* Badge */}
                {plan.badge && (
                  <div className={`absolute top-4 right-4 bg-gradient-to-r ${plan.color} text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg`}>
                    {plan.badge}
                  </div>
                )}

                <div className="p-6 flex flex-col flex-1">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-5 shadow-lg`}>
                    <Zap size={18} className="text-white" />
                  </div>

                  {/* Name & price */}
                  <h3 className="text-xl font-black text-white mb-1">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl font-black text-white">${plan.price}</span>
                    <span className="text-white/35 text-sm">/mo</span>
                  </div>
                  <p className="text-xs text-white/25 mb-6">+ ${CLIENT.setupFee} one-time setup</p>

                  {/* Features */}
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle size={14} className={`${checkClass} shrink-0 mt-0.5`} />
                        <span className="text-white/65">{f}</span>
                      </li>
                    ))}
                    {plan.limitations.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm opacity-40">
                        <span className="text-white/20 shrink-0 w-[14px] text-center mt-0.5">—</span>
                        <span className="text-white/30 line-through">{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    onClick={() => handlePlanClick(plan.id)}
                    className={`w-full bg-gradient-to-r ${plan.color} text-white font-black py-3.5 rounded-2xl hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg text-sm`}
                  >
                    Get {plan.name} <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust row */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-xs text-white/20">
          <span className="flex items-center gap-1.5"><Lock size={11} /> 256-bit SSL</span>
          <span className="flex items-center gap-1.5"><Shield size={11} /> Powered by Stripe</span>
          <span className="flex items-center gap-1.5"><CheckCircle size={11} /> Cancel anytime</span>
          <span className="flex items-center gap-1.5"><CheckCircle size={11} /> No lock-in contract</span>
        </div>
      </div>
    </div>
  );
};

const StripeFallback: React.FC<{ onClose?: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const check = () => {
      if (customElements.get('stripe-pricing-table')) { setLoaded(true); return; }
      setTimeout(check, 200);
    };
    check();
  }, []);

  return (
    <div className="fixed inset-0 z-[999] bg-black/85 backdrop-blur-lg flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-5xl">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-white/40 hover:text-white bg-white/8 hover:bg-white/15 rounded-xl px-4 py-2 text-sm transition flex items-center gap-2">
            ← Back to plans
          </button>
          {onClose && (
            <button onClick={onClose} className="text-white/40 hover:text-white bg-white/8 hover:bg-white/15 rounded-xl px-4 py-2 text-sm transition flex items-center gap-2">
              <X size={14} /> Close
            </button>
          )}
        </div>
        <div className="bg-[#111118] border border-white/10 rounded-3xl overflow-hidden">
          <div className="text-center pt-8 pb-4 px-6">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-4 py-2 rounded-full mb-4">
              <Zap size={12} /> Secure checkout via Stripe
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Complete your subscription</h2>
          </div>
          <div className="px-6 pb-8 min-h-[380px] relative">
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 size={28} className="animate-spin text-amber-400" />
                  <p className="text-sm text-white/40">Loading secure checkout…</p>
                </div>
              </div>
            )}
            {React.createElement('stripe-pricing-table', {
              'pricing-table-id': CLIENT.stripePricingTableId,
              'publishable-key': CLIENT.stripePublishableKey,
            })}
          </div>
          <div className="border-t border-white/5 px-6 py-4 flex items-center justify-center gap-6 text-xs text-white/20">
            <span className="flex items-center gap-1.5"><CheckCircle size={11} /> 256-bit SSL</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={11} /> Powered by Stripe</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={11} /> Cancel anytime</span>
          </div>
        </div>
      </div>
    </div>
  );
};
