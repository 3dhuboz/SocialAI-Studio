import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, TrendingUp, DollarSign, AlertCircle, CheckCircle,
  RefreshCw, Search, Loader2, ExternalLink, Calendar,
  ChevronDown, ChevronRight, ShieldCheck, X,
} from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type {
  AdminStats, AdminCustomer, PaymentEvent, AdminUserAddons,
} from '../services/db';
import { AdminQualityScan } from './AdminQualityScan';

/**
 * AdminCustomers — agency-owner / admin dashboard for self-serve signups +
 * payment activity. Mounts inside App.tsx when activeTab === 'customers' and
 * the caller is an admin.
 *
 * Layout:
 *   • Top stats strip — 4 metric cards (signups 7d, active subs, MRR, churn)
 *   • Filter chips — All · Trial · Paid · Cancelled
 *   • Search box (client-side filter on email substring)
 *   • Customer list — one row per user, click to expand and reveal that
 *     customer's payment history pulled from /api/admin/payments?email=…
 *
 * Empty state: gracefully shows "no customers yet" with explanatory copy
 * the first time the agency owner lands here. No fake demo rows.
 */

type Filter = 'all' | 'trial' | 'paid' | 'cancelled';

const FILTERS: { id: Filter; label: string; tone: string }[] = [
  { id: 'all',       label: 'All',       tone: 'amber'   },
  { id: 'trial',     label: 'Trial',     tone: 'sky'     },
  { id: 'paid',      label: 'Paid',      tone: 'emerald' },
  { id: 'cancelled', label: 'Cancelled', tone: 'rose'    },
];

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
const fmtRelative = (iso: string | null) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const d = ms / 86_400_000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.floor(d)}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};

export const AdminCustomers: React.FC = () => {
  const db = useDb();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        db.getAdminStats(),
        db.getAdminCustomers(filter, 100, 0),
      ]);
      setStats(s);
      setCustomers(c.customers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c =>
      (c.email || '').toLowerCase().includes(q)
      || (c.paypal_subscription_id || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* Section header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-amber-300/85 uppercase mb-2">
            <ShieldCheck size={11} /> Admin · Self-serve customers
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Customers
          </h1>
          <p className="text-sm text-white/40 mt-1">
            Every user that signed up via the public landing page. Click a row to see their payment history.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 disabled:opacity-50 transition rounded-xl px-3 py-2 text-xs font-bold text-white/70"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* AI Quality Scan — collapsible admin card.
          Added 2026-05 audit follow-up. Mounted here (above stats) so admins
          see flagged-post counts before drilling into customer metrics. */}
      <AdminQualityScan />

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Users}
          label="Signups · 7 days"
          value={stats ? stats.signups_7d.toLocaleString() : '—'}
          sub={stats ? `${stats.signups_total.toLocaleString()} total` : ''}
          tone="sky"
          loading={loading}
        />
        <StatCard
          icon={CheckCircle}
          label="Active subs"
          value={stats ? stats.active_subs.toLocaleString() : '—'}
          sub={stats ? `${stats.trial_users.toLocaleString()} on trial` : ''}
          tone="emerald"
          loading={loading}
        />
        <StatCard
          icon={DollarSign}
          label="MRR (est.)"
          value={stats ? `$${(stats.mrr_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          sub={stats ? `${fmtMoney(stats.revenue_30d_cents)} 30d` : ''}
          tone="amber"
          loading={loading}
        />
        <StatCard
          icon={TrendingUp}
          label="Churn · 30 days"
          value={stats ? stats.churn_30d.toLocaleString() : '—'}
          sub="cancellations"
          tone="rose"
          loading={loading}
        />
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-1">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`relative px-3.5 py-1.5 text-xs font-bold tracking-tight rounded-xl transition ${
                filter === f.id
                  ? 'bg-white/8 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'text-white/45 hover:text-white/75'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email or subscription ID…"
            className="w-full bg-white/[0.03] border border-white/[0.06] focus:border-white/20 transition rounded-2xl pl-9 pr-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Error / loading / empty */}
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => load()} className="ml-auto text-xs font-bold underline underline-offset-2">Retry</button>
        </div>
      )}

      {loading && !stats && (
        <div className="flex items-center justify-center py-16 text-white/40">
          <Loader2 size={20} className="animate-spin text-amber-400" />
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/5 mb-3">
            <Users size={20} className="text-white/35" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">
            {search ? 'No matches' : filter === 'all' ? 'No customers yet' : `No ${filter} customers`}
          </h3>
          <p className="text-sm text-white/40 max-w-md mx-auto">
            {search
              ? 'Try clearing your search or switching filter.'
              : 'When someone signs up via the landing page or starts a free trial, they\'ll appear here automatically.'}
          </p>
        </div>
      )}

      {/* Customer list */}
      {filtered.length > 0 && (
        <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          {/* Desktop column header — hidden on mobile (cards) */}
          <div className="hidden md:grid grid-cols-[2.2fr_1fr_1fr_1fr_1fr_44px] gap-4 px-5 py-3 text-[10px] font-bold tracking-[0.14em] text-white/35 uppercase border-b border-white/[0.04]">
            <span>Customer</span>
            <span>Plan</span>
            <span>Signed up</span>
            <span>Posts</span>
            <span className="text-right">Total paid</span>
            <span />
          </div>

          <ul className="divide-y divide-white/[0.04]">
            {filtered.map(c => (
              <CustomerRow
                key={c.id}
                customer={c}
                isExpanded={expandedId === c.id}
                onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
              />
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-white/25 text-center pt-2">
        Showing up to 100 customers · sorted newest first · payments mirrored from PayPal webhooks
      </p>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// StatCard — top strip metric card. Tone controls the icon colour.
// ──────────────────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone: 'amber' | 'emerald' | 'sky' | 'rose';
  loading?: boolean;
}> = ({ icon: Icon, label, value, sub, tone, loading }) => {
  const toneClass = {
    amber:   'text-amber-300 bg-amber-500/10 border-amber-500/15',
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/15',
    sky:     'text-sky-300 bg-sky-500/10 border-sky-500/15',
    rose:    'text-rose-300 bg-rose-500/10 border-rose-500/15',
  }[tone];
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5 relative overflow-hidden">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border ${toneClass} mb-3`}>
        <Icon size={15} />
      </div>
      <div className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase mb-1">{label}</div>
      <div className="text-2xl sm:text-3xl font-black text-white tabular-nums leading-none">
        {loading ? <span className="inline-block w-12 h-7 bg-white/5 rounded animate-pulse" /> : value}
      </div>
      {sub && (
        <div className="text-[11px] text-white/35 mt-1.5">{sub}</div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// CustomerRow — single user. Click to expand and load payment history.
// Lazy-loads /api/admin/payments?email=… on first expand only.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * AddonsPanel — per-user add-on overrides + credit grants. Lives inside the
 * expanded customer row in CustomerRow. Lazy-fetches on first expand.
 *
 * Three things admin can do here:
 *   1. Toggle Posters access (grant / revoke / inherit-from-plan)
 *   2. Set or delta the poster credit balance
 *   3. Set or delta the reel credit balance
 *
 * Credit edits use DELTA buttons (+5 / -1) for the common "gift more" flow,
 * with an absolute-set input as the precise option. Resolution rules + side
 * effects live in workers/api/src/lib/pricing.ts and routes/posters.ts.
 */
const AddonsPanel: React.FC<{ userId: string }> = ({ userId }) => {
  const db = useDb();
  const [data, setData] = useState<AdminUserAddons | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Local input state for the "set absolute" inputs — separate from `data`
  // so the user can type without mid-edit reconciliation noise.
  const [posterAbs, setPosterAbs] = useState('');
  const [reelAbs, setReelAbs] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    db.getAdminUserAddons(userId)
      .then(d => { if (!cancelled) { setData(d); setPosterAbs(String(d.posterCredits)); setReelAbs(String(d.reelCredits)); } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load add-ons'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, db]);

  const apply = async (patch: Parameters<typeof db.setAdminUserAddons>[1]) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await db.setAdminUserAddons(userId, patch);
      setData(updated);
      setPosterAbs(String(updated.posterCredits));
      setReelAbs(String(updated.reelCredits));
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-4 pt-4 border-t border-white/[0.04] flex items-center gap-2 text-white/40 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading add-ons…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mt-4 pt-4 border-t border-white/[0.04] text-sm text-red-300/80">
        {error || 'No add-on data.'}
      </div>
    );
  }

  // Tri-state for feature overrides: undefined = inherit-from-plan,
  // true = explicit grant, false = explicit revoke.
  const postersOverride = (data.addonFeatures.posters === true) ? 'grant'
    : (data.addonFeatures.posters === false) ? 'revoke'
    : 'inherit';
  const reelsOverride = (data.addonFeatures.reels === true) ? 'grant'
    : (data.addonFeatures.reels === false) ? 'revoke'
    : 'inherit';

  // Plan defaults mirroring userHasFeature() in pricing.ts:
  //   posters → all paid plans include it
  //   reels   → all paid plans include it (no plan-tier gate yet)
  const isPaidPlan = !!data.plan && ['starter','growth','pro','agency'].includes(data.plan);

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.04] space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider">Add-ons & Credits</h4>
        {saving && <Loader2 size={12} className="animate-spin text-amber-400" />}
      </div>

      {/* ── Feature access overrides ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Posters */}
        <FeatureToggle
          label="Posters access"
          planDefault={isPaidPlan ? 'included' : 'not included'}
          override={postersOverride}
          saving={saving}
          onChange={(opt) => apply({ addonFeatures: { posters: opt === 'inherit' ? null : opt === 'grant' } })}
        />
        {/* Reels */}
        <FeatureToggle
          label="Reels access"
          planDefault={isPaidPlan ? 'included' : 'not included'}
          override={reelsOverride}
          saving={saving}
          onChange={(opt) => apply({ addonFeatures: { reels: opt === 'inherit' ? null : opt === 'grant' } })}
        />
      </div>

      {/* ── Poster credits ─────────────────────────────────────────────── */}
      <CreditRow
        label="Poster credits"
        balance={data.posterCredits}
        absInput={posterAbs}
        setAbsInput={setPosterAbs}
        onDelta={(d) => apply({ posterCreditsDelta: d })}
        onSet={(n) => apply({ posterCredits: n })}
        saving={saving}
        helpText="Lifetime balance, additive on top of plan monthly quota. Decremented when a customer creates a poster after their monthly allowance is exhausted."
      />

      {/* ── Reel credits ────────────────────────────────────────────────── */}
      <CreditRow
        label="Reel credits"
        balance={data.reelCredits}
        absInput={reelAbs}
        setAbsInput={setReelAbs}
        onDelta={(d) => apply({ reelCreditsDelta: d })}
        onSet={(n) => apply({ reelCredits: n })}
        saving={saving}
        helpText="Used by AI Reels generation. Same lifetime-balance model as poster credits."
      />
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// FeatureToggle — tri-state Inherit / Grant / Revoke control for a single
// feature. Used for both Posters and Reels in the AddonsPanel.
// ──────────────────────────────────────────────────────────────────────────────

const FeatureToggle: React.FC<{
  label: string;
  planDefault: string;
  override: 'inherit' | 'grant' | 'revoke';
  saving: boolean;
  onChange: (opt: 'inherit' | 'grant' | 'revoke') => void;
}> = ({ label, planDefault, override, saving, onChange }) => (
  <div className="bg-black/20 border border-white/[0.06] rounded-xl p-3 space-y-2">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <p className="text-xs font-semibold text-white">{label}</p>
        <p className="text-[10px] text-white/35">
          Plan default: <span className="text-white/55">{planDefault}</span>
        </p>
      </div>
      <div className="flex items-center gap-1 bg-black/30 rounded-lg p-0.5 flex-shrink-0">
        {(['inherit', 'grant', 'revoke'] as const).map(opt => (
          <button
            key={opt}
            disabled={saving}
            onClick={() => onChange(opt)}
            className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-md transition ${
              override === opt
                ? (opt === 'grant' ? 'bg-emerald-500/25 text-emerald-200' : opt === 'revoke' ? 'bg-rose-500/25 text-rose-200' : 'bg-white/15 text-white')
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            {opt === 'inherit' ? 'Inherit' : opt === 'grant' ? 'Grant' : 'Revoke'}
          </button>
        ))}
      </div>
    </div>
  </div>
);

const CreditRow: React.FC<{
  label: string;
  balance: number;
  absInput: string;
  setAbsInput: (v: string) => void;
  onDelta: (delta: number) => void;
  onSet: (absolute: number) => void;
  saving: boolean;
  helpText: string;
}> = ({ label, balance, absInput, setAbsInput, onDelta, onSet, saving, helpText }) => (
  <div className="bg-black/20 border border-white/[0.06] rounded-xl p-3 space-y-2">
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div>
        <p className="text-xs font-semibold text-white">{label}</p>
        <p className="text-[10px] text-white/35">Current balance: <span className="text-amber-300 font-bold tabular-nums">{balance}</span></p>
      </div>
      <div className="flex items-center gap-1.5">
        {[-5, -1, +1, +5].map(d => (
          <button
            key={d}
            disabled={saving}
            onClick={() => onDelta(d)}
            className="text-[10px] font-bold tabular-nums px-2 py-1 rounded-md bg-white/5 hover:bg-amber-500/15 hover:text-amber-200 text-white/60 border border-white/10 hover:border-amber-500/30 transition disabled:opacity-40"
          >
            {d > 0 ? `+${d}` : `${d}`}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <input
            type="number"
            value={absInput}
            onChange={(e) => setAbsInput(e.target.value)}
            min="0"
            className="w-14 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white text-right tabular-nums focus:border-amber-500/40 focus:outline-none"
          />
          <button
            disabled={saving || Number(absInput) === balance}
            onClick={() => onSet(Math.max(0, Math.floor(Number(absInput) || 0)))}
            className="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Set
          </button>
        </div>
      </div>
    </div>
    <p className="text-[10px] text-white/30 leading-snug">{helpText}</p>
  </div>
);

const CustomerRow: React.FC<{
  customer: AdminCustomer;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ customer: c, isExpanded, onToggle }) => {
  const db = useDb();
  const [payments, setPayments] = useState<PaymentEvent[] | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);

  // Lazy-load on first expand
  useEffect(() => {
    if (!isExpanded || payments !== null || !c.email) return;
    setPaymentsLoading(true);
    setPaymentsError(null);
    db.getAdminPayments(c.email, 50)
      .then(r => setPayments(r.payments))
      .catch(e => setPaymentsError(e?.message || 'Failed to load payments'))
      .finally(() => setPaymentsLoading(false));
  }, [isExpanded, c.email, payments, db]);

  const planLabel = c.is_admin ? 'Admin' : (c.plan || 'Trial');
  const planTone = c.is_admin ? 'emerald' : c.plan ? 'amber' : 'sky';

  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full text-left grid grid-cols-1 md:grid-cols-[2.2fr_1fr_1fr_1fr_1fr_44px] gap-2 md:gap-4 px-5 py-3.5 hover:bg-white/[0.025] transition"
      >
        {/* Email + sub_id */}
        <div className="min-w-0">
          <div className="font-semibold text-sm text-white truncate">
            {c.email || <span className="text-white/30 italic">no email on file</span>}
          </div>
          {c.paypal_subscription_id && (
            <div className="font-mono text-[10px] text-white/30 truncate">{c.paypal_subscription_id}</div>
          )}
        </div>

        {/* Plan chip + status + addon grant badges */}
        <div className="flex items-center md:items-start gap-2 md:gap-1.5 md:flex-col">
          <PlanChip label={planLabel} tone={planTone} />
          {c.setup_status && c.setup_status !== 'live' && (
            <span className="text-[10px] text-white/35 truncate">{c.setup_status}</span>
          )}
          {/* Show small chips for any explicit feature overrides so Steve can
              spot custom grants without expanding every row. */}
          {(() => {
            try {
              const addons = c.addon_features ? JSON.parse(c.addon_features) : {};
              const chips: React.ReactNode[] = [];
              if (addons.posters === true)  chips.push(<span key="p" className="text-[9px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/25 rounded-full px-1.5 py-0.5">+Posters</span>);
              if (addons.posters === false) chips.push(<span key="p" className="text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full px-1.5 py-0.5">–Posters</span>);
              if (addons.reels === true)    chips.push(<span key="r" className="text-[9px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/25 rounded-full px-1.5 py-0.5">+Reels</span>);
              if (addons.reels === false)   chips.push(<span key="r" className="text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full px-1.5 py-0.5">–Reels</span>);
              return chips.length ? <div className="flex flex-wrap gap-1">{chips}</div> : null;
            } catch { return null; }
          })()}
        </div>

        {/* Signed up */}
        <div className="md:flex md:flex-col md:gap-0.5 text-xs text-white/55">
          <span className="md:hidden text-white/30 mr-2">Signed up:</span>
          <span className="text-white/70 font-medium">{fmtRelative(c.created_at)}</span>
          <span className="hidden md:inline text-[10px] text-white/30">{fmtDateShort(c.created_at)}</span>
        </div>

        {/* Posts */}
        <div className="md:flex md:flex-col md:gap-0.5 text-xs text-white/55">
          <span className="md:hidden text-white/30 mr-2">Posts:</span>
          <span className="text-white/70 font-medium tabular-nums">{c.post_count ?? 0}</span>
          {c.last_post_at && (
            <span className="hidden md:inline text-[10px] text-white/30">last {fmtRelative(c.last_post_at)}</span>
          )}
        </div>

        {/* Total paid */}
        <div className="md:flex md:flex-col md:gap-0.5 text-xs text-white/55 md:text-right">
          <span className="md:hidden text-white/30 mr-2">Paid:</span>
          <span className="text-white font-bold tabular-nums">
            {fmtMoney((c.total_paid_cents || 0) + (c.total_refunded_cents || 0))}
          </span>
          {c.total_refunded_cents !== 0 && (
            <span className="hidden md:inline text-[10px] text-rose-300/70">{fmtMoney(c.total_refunded_cents)} refund</span>
          )}
        </div>

        {/* Chevron */}
        <div className="hidden md:flex items-center justify-center text-white/30">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      {/* Expanded payment history */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-white/[0.04] bg-black/20">
          {paymentsLoading && (
            <div className="flex items-center gap-2 py-4 text-white/40 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading payment history…
            </div>
          )}
          {paymentsError && (
            <div className="py-4 text-sm text-red-300/80">{paymentsError}</div>
          )}
          {!paymentsLoading && !paymentsError && payments && payments.length === 0 && (
            <p className="py-4 text-sm text-white/40">
              No payment events yet — this customer is on the free trial or signed up but never paid.
            </p>
          )}
          {!paymentsLoading && !paymentsError && payments && payments.length > 0 && (
            <PaymentList payments={payments} />
          )}
          {/* Quick actions */}
          {c.paypal_subscription_id && (
            <div className="pt-3 flex flex-wrap gap-2">
              <a
                href={`https://www.paypal.com/billing/subscriptions/${c.paypal_subscription_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 hover:text-amber-200 bg-amber-500/8 hover:bg-amber-500/15 border border-amber-500/15 rounded-lg px-2.5 py-1.5 transition"
              >
                Open in PayPal <ExternalLink size={10} />
              </a>
            </div>
          )}

          {/* Per-user add-on overrides + credit grants (schema_v13). */}
          {c.id && <AddonsPanel userId={c.id} />}
        </div>
      )}
    </li>
  );
};

const PlanChip: React.FC<{ label: string; tone: 'amber' | 'emerald' | 'sky' }> = ({ label, tone }) => {
  const cls = {
    amber:   'bg-amber-500/12 text-amber-300 border-amber-500/20',
    emerald: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/20',
    sky:     'bg-sky-500/10 text-sky-300 border-sky-500/20',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold tracking-tight uppercase border rounded-full px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// PaymentList — compact event-list renderer used inside expanded customer rows
// AND inside the customer Billing screen. Accepts the raw rows from
// /api/admin/payments or /api/billing.
// ──────────────────────────────────────────────────────────────────────────────

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
