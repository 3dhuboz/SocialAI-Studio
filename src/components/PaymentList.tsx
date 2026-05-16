/**
 * PaymentList — compact event-list renderer used inside expanded customer
 * rows in AdminCustomers, and inside AccountPanel for the user's own
 * billing history.
 *
 * Extracted out of AdminCustomers.tsx so AccountPanel (which is part of the
 * eager initial bundle) doesn't drag the entire admin module into the main
 * chunk. With the import moved here, AdminCustomers stays cleanly code-split.
 */
import React from 'react';
import { Calendar } from 'lucide-react';
import type { PaymentEvent } from '../services/db';

const fmtMoney = (cents: number, currency = 'AUD') => {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

const fmtDateShort = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const eventLabel = (eventType: string): string => {
  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': return 'Subscription activated';
    case 'BILLING.SUBSCRIPTION.CANCELLED': return 'Subscription cancelled';
    case 'PAYMENT.SALE.COMPLETED':         return 'Payment received';
    case 'PAYMENT.SALE.REFUNDED':          return 'Refunded';
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': return 'Payment failed';
    default: return eventType.replace(/^[A-Z]+\./, '').replace(/_/g, ' ').toLowerCase();
  }
};

const statusTone = (status: string): string => {
  switch (status) {
    case 'completed': return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
    case 'cancelled': return 'text-white/55 bg-white/5 border-white/10';
    case 'refunded':  return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
    case 'failed':    return 'text-orange-300 bg-orange-500/10 border-orange-500/20';
    default:          return 'text-white/55 bg-white/5 border-white/10';
  }
};

export const PaymentList: React.FC<{ payments: PaymentEvent[] }> = ({ payments }) => (
  <ul className="pt-3 space-y-1.5">
    {payments.map((p, i) => (
      <li
        key={p.id ?? `${p.event_type}-${p.created_at}-${i}`}
        className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.025] border border-white/[0.04]"
      >
        <div className="flex-shrink-0 text-white/35">
          <Calendar size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-white/85">{eventLabel(p.event_type)}</span>
            <span className={`text-[9px] font-bold tracking-[0.08em] uppercase border rounded-full px-1.5 py-0.5 ${statusTone(p.status)}`}>
              {p.status}
            </span>
          </div>
          <div className="text-[10.5px] text-white/35 mt-0.5">
            {fmtDateShort(p.created_at)}
            {p.plan && <span className="ml-2 capitalize">· {p.plan}</span>}
          </div>
        </div>
        {typeof p.amount_cents === 'number' && (
          <div className={`text-sm font-bold tabular-nums ${p.amount_cents < 0 ? 'text-rose-300' : 'text-white'}`}>
            {fmtMoney(p.amount_cents, p.currency || 'AUD')}
          </div>
        )}
      </li>
    ))}
  </ul>
);
