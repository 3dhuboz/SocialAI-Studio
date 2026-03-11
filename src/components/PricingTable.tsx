import React, { useEffect, useState } from 'react';
import { CLIENT } from '../client.config';
import { CheckCircle, Zap, ArrowRight, X, Loader2 } from 'lucide-react';

interface Props {
  onClose?: () => void;
  selectedPlan?: string | null;
}

const useStripeLoaded = () => {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const check = () => {
      if (customElements.get('stripe-pricing-table')) { setLoaded(true); return; }
      setTimeout(check, 200);
    };
    check();
  }, []);
  return loaded;
};

export const PricingTable: React.FC<Props> = ({ onClose, selectedPlan }) => {
  const hasStripe = !!(CLIENT.stripePublishableKey && CLIENT.stripePricingTableId);
  const stripeLoaded = useStripeLoaded();
  const [showLoading, setShowLoading] = useState(true);

  useEffect(() => {
    if (stripeLoaded) setShowLoading(false);
  }, [stripeLoaded]);

  if (!hasStripe) {
    return <StaticPricingFallback onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-5xl">
        {onClose && (
          <div className="flex justify-end mb-4">
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2 text-sm transition flex items-center gap-2"
            >
              <X size={14} /> Close
            </button>
          </div>
        )}

        <div className="bg-[#111118] border border-white/10 rounded-3xl overflow-hidden">
          <div className="text-center pt-8 pb-4 px-6">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-4 py-2 rounded-full mb-4">
              <Zap size={12} /> Secure checkout via Stripe
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Choose your plan</h2>
            <p className="text-white/40 text-sm">One-time $99 setup · Cancel anytime · No lock-in</p>
          </div>

          <div className="px-6 pb-8 min-h-[400px] relative">
            {showLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-white/40">
                  <Loader2 size={28} className="animate-spin text-amber-400" />
                  <p className="text-sm">Loading secure checkout…</p>
                </div>
              </div>
            )}
            {React.createElement('stripe-pricing-table', {
              'pricing-table-id': CLIENT.stripePricingTableId,
              'publishable-key': CLIENT.stripePublishableKey,
            })}
          </div>

          <div className="border-t border-white/5 px-6 py-4 flex items-center justify-center gap-6 text-xs text-white/20">
            <span className="flex items-center gap-1.5"><CheckCircle size={11} /> 256-bit SSL encryption</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={11} /> Powered by Stripe</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={11} /> Cancel anytime</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const StaticPricingFallback: React.FC<{ onClose?: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
    <div className="w-full max-w-4xl">
      {onClose && (
        <div className="flex justify-end mb-4">
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2 text-sm transition flex items-center gap-2"
          >
            <X size={14} /> Close
          </button>
        </div>
      )}
      <div className="bg-[#111118] border border-white/10 rounded-3xl p-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-black text-white mb-2">Choose your plan</h2>
          <p className="text-white/40 text-sm">One-time $99 setup · Cancel anytime</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {CLIENT.plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                plan.badge === 'Most Popular'
                  ? 'bg-gradient-to-b from-amber-500/10 to-transparent border-amber-500/30 scale-[1.02]'
                  : 'bg-white/3 border-white/10'
              }`}
            >
              {plan.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r ${plan.color} text-white text-[10px] font-black px-3 py-1 rounded-full whitespace-nowrap`}>
                  {plan.badge}
                </div>
              )}
              <h3 className="text-xl font-black mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-black">${plan.price}</span>
                <span className="text-white/30 text-sm">/month</span>
              </div>
              <p className="text-xs text-white/25 mb-5">+ $99 one-time setup</p>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.slice(0, 4).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <CheckCircle size={13} className="text-green-400 shrink-0 mt-0.5" />
                    <span className="text-white/60">{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={CLIENT.salesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full bg-gradient-to-r ${plan.color} text-white font-bold py-3 rounded-xl text-center text-sm hover:opacity-90 transition flex items-center justify-center gap-2`}
              >
                Get {plan.name} <ArrowRight size={14} />
              </a>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-white/20 mt-6">
          Payment processed securely via{' '}
          <a href={CLIENT.salesUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400/50 hover:text-amber-400 transition">
            {CLIENT.salesUrl.replace('https://', '')}
          </a>
        </p>
      </div>
    </div>
  </div>
);
