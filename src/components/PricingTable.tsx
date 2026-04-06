import React, { useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { CLIENT } from '../client.config';
import { CheckCircle, Zap, ArrowRight, X, Loader2, Shield, Lock, Tag } from 'lucide-react';

const promo = CLIENT.setupFeePromo;
const setupFeeDisplay = promo?.active
  ? (promo.amount === 0 ? 'FREE' : `$${promo.amount}`)
  : `$${CLIENT.setupFee}`;

interface Props {
  onClose?: () => void;
  onPlanActivated?: (planId: string) => void;
  userId?: string | null;
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

export const PricingTable: React.FC<Props> = ({ onClose, onPlanActivated, userId }) => {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  const isYearly = billingCycle === 'yearly';
  const hasPayPal = !!CLIENT.paypalClientId;
  const yearlyPlanIds = (CLIENT as typeof CLIENT & { paypalYearlyPlanIds?: Record<string, string> }).paypalYearlyPlanIds;
  const hasYearlyPlans = !!yearlyPlanIds;

  const getPayPalPlanId = (planId: string) => {
    if (isYearly && yearlyPlanIds) return yearlyPlanIds[planId];
    return (CLIENT.paypalPlanIds as Record<string, string>)[planId];
  };

  const handleSelectPlan = (planId: string) => {
    if (!hasPayPal) {
      window.open(CLIENT.salesUrl, '_blank');
      return;
    }
    const ppPlanId = getPayPalPlanId(planId);
    if (!ppPlanId) {
      window.open(CLIENT.salesUrl, '_blank');
      return;
    }
    setSelectedPlanId(planId);
    setActivationError(null);
  };

  const handleApprove = async (subscriptionId: string, planId: string) => {
    setActivating(true);
    setActivationError(null);
    try {
      const res = await fetch('/api/paypal-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId, uid: userId || null, planId }),
      });
      const json = await res.json();
      if (json.success) {
        setActivated(true);
        onPlanActivated?.(planId);
      } else {
        setActivationError(json.error || 'Activation failed. Please contact support.');
      }
    } catch {
      setActivationError('Network error during activation. Please contact support.');
    } finally {
      setActivating(false);
    }
  };

  if (activated) {
    return (
      <div className="fixed inset-0 z-[999] bg-black/90 backdrop-blur-lg flex items-center justify-center p-6">
        <div className="bg-[#111118] border border-green-500/25 rounded-3xl p-10 w-full max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-5 bg-green-500/15 border border-green-500/30 rounded-2xl flex items-center justify-center">
            <CheckCircle size={30} className="text-green-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">You're all set! 🎉</h2>
          <p className="text-white/40 text-sm mb-6">Your subscription is active. We'll be in touch within 1–3 business days to connect your Facebook page.</p>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-3 px-8 rounded-2xl hover:opacity-90 transition"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const selectedPlan = CLIENT.plans.find(p => p.id === selectedPlanId);
  const selectedPayPalPlanId = selectedPlanId
    ? getPayPalPlanId(selectedPlanId)
    : null;

  return (
    <div className="fixed inset-0 z-[999] bg-black/85 backdrop-blur-lg flex items-start justify-center p-4 pt-6 overflow-y-auto">
      <div className="w-full max-w-5xl pb-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-black text-white">Choose your plan</h2>
            {promo?.active ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="flex items-center gap-1.5 bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold px-2.5 py-1 rounded-full">
                  <Tag size={10} /> {promo.label}
                </span>
                <span className="text-white/30 text-sm line-through">${CLIENT.setupFee} setup</span>
              </div>
            ) : (
              <p className="text-white/35 text-sm mt-1">One-time ${CLIENT.setupFee} setup · Cancel anytime · No lock-in</p>
            )}
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

        {/* Monthly / Yearly toggle */}
        {hasYearlyPlans && (
          <div className="flex items-center justify-center gap-3 mb-8">
            <span className={`text-sm font-semibold transition ${!isYearly ? 'text-white' : 'text-white/35'}`}>Monthly</span>
            <button
              role="switch"
              aria-checked={isYearly}
              aria-label="Toggle yearly billing"
              onClick={() => { setBillingCycle(isYearly ? 'monthly' : 'yearly'); setSelectedPlanId(null); setActivationError(null); }}
              className={`relative w-14 h-7 rounded-full transition-colors ${isYearly ? 'bg-green-500' : 'bg-white/20'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${isYearly ? 'translate-x-7' : ''}`} />
            </button>
            <span className={`text-sm font-semibold transition ${isYearly ? 'text-white' : 'text-white/35'}`}>Yearly</span>
            {isYearly && (
              <span className="bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold px-2.5 py-1 rounded-full">
                Save ~17%
              </span>
            )}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {CLIENT.plans.map((plan) => {
            const glow        = planGlows[plan.id]       || 'rgba(255,255,255,0.05)';
            const borderClass = planBorderActive[plan.id] || 'border-white/15';
            const checkClass  = planCheckColor[plan.id]   || 'text-green-400';
            const isSelected  = selectedPlanId === plan.id;

            return (
              <div
                key={plan.id}
                className={`relative rounded-3xl border flex flex-col overflow-hidden card-hover noise ${
                  isSelected ? `${borderClass} shadow-2xl ring-2 ring-offset-2 ring-offset-transparent ${borderClass.replace('border-', 'ring-')}` : borderClass
                }`}
                style={{ background: `linear-gradient(160deg, ${glow} 0%, var(--color-surface-1) 55%)` }}
              >
                <div className={`h-1.5 w-full bg-gradient-to-r ${plan.color}`} />

                {plan.badge && (
                  <div className={`absolute top-4 right-4 bg-gradient-to-r ${plan.color} text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg`}>
                    {plan.badge}
                  </div>
                )}

                <div className="p-6 flex flex-col flex-1">
                  <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-5 shadow-lg`}>
                    <Zap size={18} className="text-white" />
                  </div>

                  <h3 className="text-xl font-black text-white mb-1">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mb-1">
                    {isYearly && plan.yearlyPrice ? (
                      <>
                        <span className="text-4xl font-black text-white">${Math.round(plan.yearlyPrice / 12)}</span>
                        <span className="text-white/35 text-sm">/mo</span>
                      </>
                    ) : (
                      <>
                        <span className="text-4xl font-black text-white">${plan.price}</span>
                        <span className="text-white/35 text-sm">/mo</span>
                      </>
                    )}
                  </div>
                  {isYearly && plan.yearlyPrice && (
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-white/25 line-through">${plan.price * 12}/yr</span>
                      <span className="text-xs text-green-400 font-semibold">${plan.yearlyPrice}/yr</span>
                    </div>
                  )}
                  {promo?.active ? (
                    <p className="text-xs mb-6 flex items-center gap-1.5">
                      <span className="text-white/25 line-through">${CLIENT.setupFee} setup</span>
                      <span className="text-green-400 font-bold">{setupFeeDisplay} setup</span>
                    </p>
                  ) : (
                    <p className="text-xs text-white/25 mb-6">+ ${CLIENT.setupFee} one-time setup</p>
                  )}

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

                  <button
                    onClick={() => handleSelectPlan(plan.id)}
                    className={`w-full bg-gradient-to-r ${plan.color} text-white font-black py-3.5 rounded-2xl hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg text-sm ${
                      isSelected ? 'opacity-70' : ''
                    }`}
                  >
                    {isSelected ? 'Selected ✓' : <>Get {plan.name} <ArrowRight size={15} /></>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* PayPal checkout panel */}
        {selectedPlan && selectedPayPalPlanId && (
          <div className="mt-8 bg-[#0d0d18] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-[#1a1a2e] to-[#0f0f1a] px-8 py-6 border-b border-white/5 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="inline-flex items-center gap-2 bg-[#003087]/20 border border-[#003087]/30 text-[#009cde] text-xs font-bold px-3 py-1.5 rounded-full mb-2">
                  <Lock size={10} /> Secure checkout via PayPal
                </div>
                <h3 className="text-lg font-black text-white">
                  {selectedPlan.name} — {isYearly && selectedPlan.yearlyPrice
                    ? `$${Math.round(selectedPlan.yearlyPrice / 12)}/mo ($${selectedPlan.yearlyPrice}/yr)`
                    : `$${selectedPlan.price}/mo`}
                </h3>
                <p className="text-xs text-white/35 mt-0.5">
                  {promo?.active
                    ? <><span className="line-through">${CLIENT.setupFee} setup fee</span> <span className="text-green-400 font-semibold">{setupFeeDisplay}</span> · Cancel anytime</>
                    : <>Includes ${CLIENT.setupFee} one-time setup fee · Cancel anytime</>}
                </p>
              </div>
              <button
                onClick={() => { setSelectedPlanId(null); setActivationError(null); }}
                className="text-white/30 hover:text-white text-xs flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-xl transition"
              >
                <X size={12} /> Change plan
              </button>
            </div>

            <div className="px-8 py-6">
              {activating && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={28} className="animate-spin text-[#009cde]" />
                  <p className="text-sm text-white/50">Activating your subscription…</p>
                </div>
              )}

              {activationError && (
                <div className="bg-red-500/10 border border-red-500/25 rounded-2xl px-5 py-4 mb-5 text-sm text-red-300">
                  {activationError}
                </div>
              )}

              {!activating && hasPayPal && (
                <PayPalScriptProvider
                  options={{
                    clientId: CLIENT.paypalClientId,
                    vault: true,
                    intent: 'subscription',
                  }}
                >
                  <PayPalButtons
                    style={{ layout: 'vertical', color: 'blue', shape: 'rect', label: 'subscribe' }}
                    createSubscription={(_data, actions) =>
                      actions.subscription.create({ plan_id: selectedPayPalPlanId })
                    }
                    onApprove={async (data) => {
                      if (data.subscriptionID) {
                        await handleApprove(data.subscriptionID, selectedPlan.id);
                      }
                    }}
                    onError={() => setActivationError('PayPal encountered an error. Please try again or contact support.')}
                  />
                </PayPalScriptProvider>
              )}
            </div>
          </div>
        )}

        {/* Trust row */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-xs text-white/20">
          <span className="flex items-center gap-1.5"><Lock size={11} /> 256-bit SSL</span>
          <span className="flex items-center gap-1.5"><Shield size={11} /> Powered by PayPal</span>
          <span className="flex items-center gap-1.5"><CheckCircle size={11} /> Cancel anytime</span>
          <span className="flex items-center gap-1.5"><CheckCircle size={11} /> No lock-in contract</span>
        </div>
      </div>
    </div>
  );
};
