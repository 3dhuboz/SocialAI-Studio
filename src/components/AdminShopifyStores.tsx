import React, { useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag, RefreshCw, Search, Loader2, AlertCircle,
  ChevronDown, ChevronRight, ExternalLink, X, Clock, CheckCircle, XCircle, Beaker,
  ShieldCheck,
} from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type {
  ShopifyStore, ShopifyStoreBucket, ShopifyStoresResponse, ShopifyBillingEvent,
} from '../services/db';

/**
 * AdminShopifyStores — admin-only tenant view for every Shopify merchant
 * that's installed our app. Mirrors the AdminCustomers layout so the admin
 * gets one consistent table per tenant type.
 *
 * Each row maps to one shopify_stores record. Click to expand and show the
 * shop's billing events (subscription_created → activated → cancelled timeline).
 *
 * Backend: GET /api/admin/shopify-stores (list) + GET .../{:domain} (detail).
 * Both gated by requireAdmin in workers/api/src/routes/admin-shopify.ts.
 */

type Filter = 'all' | ShopifyStoreBucket;

const FILTERS: { id: Filter; label: string; tone: string }[] = [
  { id: 'all',         label: 'All',          tone: 'amber'   },
  { id: 'active',      label: 'Active',       tone: 'emerald' },
  { id: 'trial',       label: 'Trial',        tone: 'sky'     },
  { id: 'pending',     label: 'Pending',      tone: 'violet'  },
  { id: 'cancelled',   label: 'Cancelled',    tone: 'rose'    },
  { id: 'uninstalled', label: 'Uninstalled',  tone: 'slate'   },
];

const fmtDate = (iso: string | null) => {
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

const fmtMoney = (amount: string | null, currency: string | null) => {
  if (!amount) return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? 'USD'}`;
};

function BucketBadge({ bucket, isTest }: { bucket: ShopifyStoreBucket; isTest: boolean }) {
  const map: Record<ShopifyStoreBucket, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
    active:      { bg: 'bg-emerald-500/15 border-emerald-500/25', text: 'text-emerald-300', icon: <CheckCircle size={10} />, label: 'Active' },
    trial:       { bg: 'bg-sky-500/15 border-sky-500/25',          text: 'text-sky-300',     icon: <Clock size={10} />,        label: 'Trial' },
    pending:     { bg: 'bg-violet-500/15 border-violet-500/25',    text: 'text-violet-300',  icon: <Clock size={10} />,        label: 'Pending' },
    cancelled:   { bg: 'bg-rose-500/15 border-rose-500/25',        text: 'text-rose-300',    icon: <XCircle size={10} />,      label: 'Cancelled' },
    uninstalled: { bg: 'bg-white/5 border-white/10',               text: 'text-white/40',    icon: <XCircle size={10} />,      label: 'Uninstalled' },
    none:        { bg: 'bg-amber-500/15 border-amber-500/25',      text: 'text-amber-300',   icon: <AlertCircle size={10} />,  label: 'No sub' },
  };
  const cfg = map[bucket];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border ${cfg.bg} ${cfg.text}`}>
      {cfg.icon}
      {cfg.label}
      {isTest && <Beaker size={10} className="opacity-60" />}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// StatCard — mirrors AdminCustomers.StatCard for visual parity across admin tabs.
// Kept inline so this file remains self-contained per the design-system task.
// ──────────────────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone: 'amber' | 'emerald' | 'sky' | 'rose' | 'violet' | 'slate';
  loading?: boolean;
}> = ({ icon: Icon, label, value, sub, tone, loading }) => {
  const toneClass = {
    amber:   'text-amber-300 bg-amber-500/10 border-amber-500/15',
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/15',
    sky:     'text-sky-300 bg-sky-500/10 border-sky-500/15',
    rose:    'text-rose-300 bg-rose-500/10 border-rose-500/15',
    violet:  'text-violet-300 bg-violet-500/10 border-violet-500/15',
    slate:   'text-white/55 bg-white/5 border-white/10',
  }[tone];
  return (
    <div className="glass-card rounded-2xl border border-white/[0.06] p-4 sm:p-5 relative overflow-hidden">
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

export const AdminShopifyStores: React.FC = () => {
  const db = useDb();

  const [data, setData] = useState<ShopifyStoresResponse | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, ShopifyBillingEvent[]>>({});

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await db.getShopifyStores();
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load Shopify stores');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filteredStores = useMemo(() => {
    const stores = data?.stores ?? [];
    return stores
      .filter((s) => filter === 'all' || s.bucket === filter)
      .filter((s) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (
          s.shop_domain.toLowerCase().includes(q) ||
          (s.shop_name ?? '').toLowerCase().includes(q) ||
          (s.shop_email ?? '').toLowerCase().includes(q)
        );
      });
  }, [data, filter, search]);

  const toggleExpand = async (store: ShopifyStore) => {
    if (expandedDomain === store.shop_domain) {
      setExpandedDomain(null);
      return;
    }
    setExpandedDomain(store.shop_domain);
    if (!detailCache[store.shop_domain]) {
      try {
        const detail = await db.getShopifyStore(store.shop_domain);
        setDetailCache((prev) => ({ ...prev, [store.shop_domain]: detail.events }));
      } catch (e) {
        console.error('[admin-shopify] detail fetch failed', e);
      }
    }
  };

  const counts = data?.counts;
  const plan = data?.plan;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* Section header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-amber-300/85 uppercase mb-2">
            <ShieldCheck size={11} /> Admin · Shopify merchants
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Shopify Stores
          </h1>
          <p className="text-sm text-white/40 mt-1">
            {counts?.total ?? 0} {counts?.total === 1 ? 'merchant' : 'merchants'}
            {plan && ` · ${plan.name}: $${plan.price}/mo ${plan.currency} · ${plan.trialDays}-day trial`}
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

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          icon={ShoppingBag}
          label="Total"
          value={counts ? counts.total.toLocaleString() : '—'}
          tone="amber"
          loading={loading}
        />
        <StatCard
          icon={CheckCircle}
          label="Active"
          value={counts ? counts.active.toLocaleString() : '—'}
          tone="emerald"
          loading={loading}
        />
        <StatCard
          icon={Clock}
          label="Trial"
          value={counts ? counts.trial.toLocaleString() : '—'}
          tone="sky"
          loading={loading}
        />
        <StatCard
          icon={AlertCircle}
          label="Pending"
          value={counts ? counts.pending.toLocaleString() : '—'}
          tone="violet"
          loading={loading}
        />
        <StatCard
          icon={XCircle}
          label="Cancelled"
          value={counts ? counts.cancelled.toLocaleString() : '—'}
          tone="rose"
          loading={loading}
        />
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 glass-card border border-white/[0.06] rounded-2xl p-1">
          {FILTERS.map((f) => (
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
              {f.id !== 'all' && counts && (
                <span className="ml-1.5 text-white/30 font-normal tabular-nums">{counts[f.id as keyof typeof counts] ?? 0}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by domain, name, or email…"
            aria-label="Search merchants by domain, name, or email"
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => load()} className="ml-auto text-xs font-bold underline underline-offset-2">Retry</button>
        </div>
      )}

      {/* Loading skeleton rows */}
      {loading && !error && (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="glass-card border border-white/[0.05] rounded-xl p-3 flex items-center gap-3"
            >
              <div className="w-3.5 h-3.5 rounded skeleton shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="skeleton skeleton-text" style={{ width: '45%' }} />
                <div className="skeleton skeleton-text-sm" style={{ width: '30%' }} />
              </div>
              <div className="w-20 space-y-2">
                <div className="skeleton skeleton-text" style={{ width: '100%' }} />
                <div className="skeleton skeleton-text-sm" style={{ width: '70%', marginLeft: 'auto' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredStores.length === 0 && (
        <div className="glass-card border border-dashed border-white/10 rounded-3xl p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/5 mb-3">
            <ShoppingBag size={20} className="text-white/35" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">
            {counts?.total === 0 ? 'No merchants installed yet' : 'No merchants match your filter'}
          </h3>
          <p className="text-sm text-white/40 max-w-md mx-auto">
            {counts?.total === 0
              ? 'Once a Shopify merchant installs the app, they appear here.'
              : 'Try the All filter or clear your search.'}
          </p>
        </div>
      )}

      {/* List */}
      {!loading && !error && filteredStores.length > 0 && (
        <div className="space-y-1.5">
          {filteredStores.map((store) => {
            const isExpanded = expandedDomain === store.shop_domain;
            const events = detailCache[store.shop_domain] ?? [];

            const handleToggle = () => toggleExpand(store);
            const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggle();
              }
            };

            return (
              <div
                key={store.shop_domain}
                className="glass-card border border-white/[0.05] rounded-xl overflow-hidden card-hover"
              >
                <div className="relative">
                  {/* Row is a div acting as button — keeps the inner <a> as valid HTML. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={handleToggle}
                    onKeyDown={onKeyDown}
                    className="press w-full p-3 pr-10 flex items-center gap-3 hover:bg-white/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20 transition text-left cursor-pointer"
                  >
                    {isExpanded ? <ChevronDown size={14} className="text-white/30 shrink-0" /> : <ChevronRight size={14} className="text-white/30 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white truncate">{store.shop_name || store.shop_domain}</span>
                        <BucketBadge bucket={store.bucket} isTest={store.is_test} />
                      </div>
                      <div className="text-[10px] text-white/30 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{store.shop_domain}</span>
                        {store.shop_email && <span>· {store.shop_email}</span>}
                        {store.plan_name && <span>· Shopify {store.plan_name}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-white tabular-nums">{fmtMoney(store.price_amount, store.price_currency)}</div>
                      <div className="text-[10px] text-white/30 mt-0.5">installed {fmtRelative(store.installed_at)}</div>
                    </div>
                  </div>
                  {/* External link lives outside the row's clickable area so the
                      HTML stays valid (no <a> inside a <button>-like control) and
                      a11y semantics are clear: tab order is row → link. */}
                  <a
                    href={`https://${store.shop_domain}/admin`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-3 right-3 text-white/30 hover:text-white/70 transition p-1 rounded-md hover:bg-white/5"
                    title="Open store admin"
                    aria-label={`Open ${store.shop_domain} admin in new tab`}
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>

                {isExpanded && (
                  <div className="border-t border-white/[0.05] px-4 py-3 bg-black/20">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] mb-3">
                      <div>
                        <div className="text-white/30 uppercase font-bold tracking-wide">Subscription</div>
                        <div className="text-white/80 mt-1 break-all">{store.subscription_status ?? 'none'}</div>
                      </div>
                      <div>
                        <div className="text-white/30 uppercase font-bold tracking-wide">Trial ends</div>
                        <div className="text-white/80 mt-1">{fmtDate(store.trial_ends_at)}</div>
                      </div>
                      <div>
                        <div className="text-white/30 uppercase font-bold tracking-wide">Period ends</div>
                        <div className="text-white/80 mt-1">{fmtDate(store.current_period_end)}</div>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <div className="text-white/30 uppercase font-bold tracking-wide">Scopes</div>
                        <div className="text-white/80 mt-1 break-all whitespace-pre-wrap font-mono text-[10px]">{store.scopes || '—'}</div>
                      </div>
                    </div>

                    <div className="text-[10px] uppercase tracking-wide text-white/30 font-bold mb-1.5">Billing events</div>
                    {events.length === 0 ? (
                      <div className="text-xs text-white/30 italic">No events yet.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {events.map((evt) => (
                          <li key={evt.id} className="text-[11px] flex items-start gap-2">
                            <span className="text-white/30 shrink-0 tabular-nums">{fmtDate(evt.created_at)}</span>
                            <span className="text-white/70 font-mono">{evt.event_type}</span>
                            {evt.status_to && (
                              <span className="text-white/40">
                                {evt.status_from ? `${evt.status_from} → ` : ''}{evt.status_to}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
