import React, { useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { CLIENT } from '../client.config';
import { aiAuthHeaders } from '../services/gemini';
import { CheckCircle, X, Loader2, Lock, Shield, Sparkles, Film } from 'lucide-react';

const AI_WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

// Default packs — matches the worker's REEL_CREDIT_PACKS canonical pricing.
// Whitelabel agencies can override via CLIENT.reelCreditPacks if they want
// different pricing on their portal (the worker still validates against its
// own canonical map, so frontend-only overrides won't credit the wrong amount).
const DEFAULT_PACKS = [
  { id: 'small',  credits: 3,  price: 9.99,  currency: 'AUD', label: 'Starter pack' },
  { id: 'medium', credits: 10, price: 24.99, currency: 'AUD', label: 'Value pack' },
  { id: 'large',  credits: 25, price: 49.99, currency: 'AUD', label: 'Pro pack' },
];

type Pack = { id: string; credits: number; price: number; currency: string; label: string };

interface Props {
  /** When closed, returns the user to where they came from. */
  onClose: () => void;
  /** Called after a successful purchase with the new credit balance delta.
   *  Parent should refresh local state (user.reel_credits or activeClientWorkspace.reelCredits)
   *  so the dashboard reflects the credit immediately, not waiting for a reload. */
  onPurchased: (creditsAdded: number) => void;
  /** When set, credits go to a specific client workspace (Agency plan)
   *  instead of the user's own balance. Mirrors how reel_credits works
   *  on the consume side. */
  clientId?: string | null;
}

export const CreditPackModal: React.FC<Props> = ({ onClose, onPurchased, clientId }) => {
  const packs: Pack[] = ((CLIENT as { reelCreditPacks?: Pack[] }).reelCreditPacks) || DEFAULT_PACKS;
  const [selected, setSelected] = useState<Pack | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchasedCount, setPurchasedCount] = useState<number | null>(null);

  const hasPayPal = !!CLIENT.paypalClientId;

  // Confirm with our backend after PayPal captures the order. Frontend can't
  // be trusted to credit — backend re-fetches the order from PayPal directly,
  // verifies amount + status, and credits only then. See worker
  // /api/paypal-credit-pack-confirm.
  const confirmWithBackend = async (orderId: string, packId: string) => {
    setConfirming(true);
    setError(null);
    try {
      const headers = await aiAuthHeaders();
      const res = await fetch(`${AI_WORKER}/api/paypal-credit-pack-confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderId, packId, clientId: clientId ?? null }),
      });
      const data = await res.json() as { success?: boolean; credits_added?: number; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPurchasedCount(data.credits_added ?? selected?.credits ?? 0);
      onPurchased(data.credits_added ?? selected?.credits ?? 0);
    } catch (e: any) {
      // PayPal already charged the user at this point — make sure they know
      // not to retry the payment, just contact us.
      setError(
        `${e?.message || 'Confirmation failed'} — if you were charged, please email ${CLIENT.supportEmail} with this order ID: ${orderId}`,
      );
    } finally {
      setConfirming(false);
    }
  };

  // Success card — shown after the backend successfully credits.
  if (purchasedCount !== null) {
    return (
      <div className="fixed inset-0 z-[999] bg-black/90 backdrop-blur-lg flex items-center justify-center p-6">
        <div className="glass-card border border-emerald-500/25 rounded-3xl p-10 w-full max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl flex items-center justify-center">
            <CheckCircle size={30} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">+{purchasedCount} reel credit{purchasedCount === 1 ? '' : 's'} added 🎬</h2>
          <p className="text-white/40 text-sm mb-6">
            Credits never expire. They show up on your AI Reels toggle in Settings — start a Smart Schedule when you're ready.
          </p>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-black py-3 px-8 rounded-2xl hover:opacity-90 transition"
          >
            Done →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/85 backdrop-blur-lg flex items-start justify-center p-4 pt-6 overflow-y-auto">
      <div className="w-full max-w-3xl pb-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <Film size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white">Buy reel credits</h2>
              <p className="text-xs text-white/35 mt-0.5">One-off purchase · Credits never expire · Use any time</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white bg-white/8 hover:bg-white/15 rounded-xl px-4 py-2 text-sm transition flex items-center gap-2"
          >
            <X size={14} /> Close
          </button>
        </div>

        {/* Pack cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {packs.map(pack => {
            const isSelected = selected?.id === pack.id;
            const perReel = (pack.price / pack.credits).toFixed(2);
            return (
              <button
                key={pack.id}
                onClick={() => { setSelected(pack); setError(null); }}
                className={`relative rounded-3xl border p-6 text-left transition-all press ${
                  isSelected
                    ? 'border-purple-500/50 bg-purple-500/8 shadow-2xl ring-2 ring-purple-500/30'
                    : 'border-white/[0.08] glass-card hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                {pack.id === 'medium' && (
                  <div className="absolute top-3 right-3 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-[10px] font-black px-2.5 py-1 rounded-full">
                    Best value
                  </div>
                )}
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">{pack.label}</p>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-black text-white">{pack.credits}</span>
                  <span className="text-white/40 text-sm">credits</span>
                </div>
                <p className="text-2xl font-black text-purple-300 mb-1">${pack.price.toFixed(2)} <span className="text-xs text-white/30 font-normal">{pack.currency}</span></p>
                <p className="text-[11px] text-white/40">${perReel}/reel · never expires</p>
              </button>
            );
          })}
        </div>

        {/* PayPal checkout panel */}
        {selected && (
          <div className="bg-[#0d0d18] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-[#1a1a2e] to-[#0f0f1a] px-6 py-4 border-b border-white/5 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="inline-flex items-center gap-2 bg-[#003087]/20 border border-[#003087]/30 text-[#009cde] text-xs font-bold px-3 py-1.5 rounded-full mb-1">
                  <Lock size={10} /> Secure checkout via PayPal
                </div>
                <p className="text-sm text-white">
                  <span className="font-bold">{selected.credits} reel credits</span>
                  <span className="text-white/40"> — ${selected.price.toFixed(2)} {selected.currency}</span>
                </p>
              </div>
              <button
                onClick={() => { setSelected(null); setError(null); }}
                className="text-white/30 hover:text-white text-xs flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-xl transition"
              >
                <X size={11} /> Change pack
              </button>
            </div>

            <div className="px-6 py-5">
              {confirming && (
                <div className="flex flex-col items-center gap-3 py-5">
                  <Loader2 size={24} className="animate-spin text-[#009cde]" />
                  <p className="text-sm text-white/50">Crediting your account…</p>
                </div>
              )}
              {error && (
                <div className="bg-red-500/10 border border-red-500/25 rounded-2xl px-4 py-3 mb-4 text-xs text-red-300 leading-relaxed">
                  {error}
                </div>
              )}
              {!confirming && hasPayPal && (
                <PayPalScriptProvider
                  options={{
                    clientId: CLIENT.paypalClientId,
                    currency: selected.currency,
                    intent: 'capture',
                  }}
                >
                  <PayPalButtons
                    style={{ layout: 'vertical', color: 'blue', shape: 'rect', label: 'paypal' }}
                    forceReRender={[selected.id, selected.price]}
                    createOrder={(_data, actions) =>
                      actions.order.create({
                        intent: 'CAPTURE',
                        purchase_units: [{
                          amount: { currency_code: selected.currency, value: selected.price.toFixed(2) },
                          description: `${selected.credits} AI Reel credits — ${CLIENT.appName}`,
                          // custom_id on PayPal side for cross-reference; the
                          // server still validates the order amount and only
                          // trusts what the verified order returns.
                          custom_id: `reels:${selected.id}`,
                        }],
                      })
                    }
                    onApprove={async (data, actions) => {
                      // Capture the order client-side first (PayPal SDK requirement
                      // for capture flow), then ask our backend to verify + credit.
                      try {
                        if (actions.order) await actions.order.capture();
                        if (data.orderID) await confirmWithBackend(data.orderID, selected.id);
                      } catch (e: any) {
                        setError(`PayPal capture failed: ${e?.message || 'Unknown error'}`);
                      }
                    }}
                    onError={() => setError('PayPal encountered an error. Please try again or contact support.')}
                  />
                </PayPalScriptProvider>
              )}
              {!hasPayPal && (
                <div className="text-sm text-white/50 text-center py-4">
                  PayPal isn't configured on this portal yet. <a href={`mailto:${CLIENT.supportEmail}`} className="text-purple-400 underline">Contact support</a> to buy credits.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Trust row */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-6 text-xs text-white/20">
          <span className="flex items-center gap-1.5"><Lock size={11} /> 256-bit SSL</span>
          <span className="flex items-center gap-1.5"><Shield size={11} /> Powered by PayPal</span>
          <span className="flex items-center gap-1.5"><Sparkles size={11} /> Credits never expire</span>
        </div>
      </div>
    </div>
  );
};
