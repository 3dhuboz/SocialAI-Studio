import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, TrendingUp, DollarSign, AlertCircle, CheckCircle,
  RefreshCw, Search, Loader2, ExternalLink, Clock,
  ChevronDown, ChevronRight, ShieldCheck, X, MessageSquare,
  BrainCircuit, ClipboardCheck,
} from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type {
  AdminStats, AdminCustomer, PaymentEvent, AdminUserAddons, AdminPrewarmReadiness,
  AdminPostFeedback,
  AdminLearningOperations, LearningAdjudicationEvidence, LearningAdjudicationInput,
  LearningPilotCustomerConsent,
  LearningPilotQueue,
} from '../services/db';
import { AdminQualityScan } from './AdminQualityScan';
import { PaymentList } from './PaymentList';

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
  const [prewarmReadiness, setPrewarmReadiness] = useState<AdminPrewarmReadiness | null>(null);
  const [postFeedback, setPostFeedback] = useState<AdminPostFeedback[] | null>(null);
  const [learningOperations, setLearningOperations] = useState<AdminLearningOperations | null>(null);
  const [learningPilotQueue, setLearningPilotQueue] = useState<LearningPilotQueue | null>(null);
  const [learningSavingDecisionId, setLearningSavingDecisionId] = useState<string | null>(null);
  const [learningPilotActionKey, setLearningPilotActionKey] = useState<string | null>(null);
  const [learningError, setLearningError] = useState<string | null>(null);
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
      db.getAdminPrewarmReadiness(24, 25)
        .then(setPrewarmReadiness)
        .catch(() => setPrewarmReadiness(null));
      db.getAdminPostFeedback(10)
        .then(r => setPostFeedback(r.feedback))
        .catch(() => setPostFeedback(null));
      db.getAdminLearningOperations(100)
        .then(setLearningOperations)
        .catch(() => setLearningOperations(null));
      db.getLearningPilotCandidates()
        .then(setLearningPilotQueue)
        .catch(() => setLearningPilotQueue(null));
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

  const adjudicateLearningDecision = async (
    decisionId: string,
    input: LearningAdjudicationInput,
  ) => {
    setLearningSavingDecisionId(decisionId);
    setLearningError(null);
    try {
      await db.adjudicateLearningDecision(decisionId, input);
      setLearningOperations(await db.getAdminLearningOperations(100));
    } catch (reason) {
      setLearningError(reason instanceof Error ? reason.message : 'Audit label could not be saved');
      throw reason;
    } finally {
      setLearningSavingDecisionId(null);
    }
  };

  const reloadLearningPanels = async () => {
    const [operations, queue] = await Promise.all([
      db.getAdminLearningOperations(100),
      db.getLearningPilotCandidates(),
    ]);
    setLearningOperations(operations);
    setLearningPilotQueue(queue);
  };

  const enrollLearningPilot = async (
    clientId: string | null,
    budgetCents: number,
    customerConsent?: LearningPilotCustomerConsent,
  ) => {
    const actionKey = `enroll:${clientId ?? '__owner__'}`;
    setLearningPilotActionKey(actionKey);
    setLearningError(null);
    try {
      await db.enrollLearningPilotWorkspace(clientId, budgetCents, customerConsent);
      await reloadLearningPanels();
    } catch (reason) {
      setLearningError(reason instanceof Error ? reason.message : 'Pilot enrollment could not be saved');
    } finally {
      setLearningPilotActionKey(null);
    }
  };

  const validateLearningPilotDraft = async (postId: string) => {
    const actionKey = `validate:${postId}`;
    setLearningPilotActionKey(actionKey);
    setLearningError(null);
    try {
      await db.validateLearningPilotDraft(postId);
      await reloadLearningPanels();
    } catch (reason) {
      setLearningError(reason instanceof Error ? reason.message : 'Draft validation failed closed');
    } finally {
      setLearningPilotActionKey(null);
    }
  };

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

      <LearningOperationsCard
        operations={learningOperations}
        pilotQueue={learningPilotQueue}
        pilotActionKey={learningPilotActionKey}
        loading={loading && !learningOperations}
        savingDecisionId={learningSavingDecisionId}
        error={learningError}
        onAdjudicate={adjudicateLearningDecision}
        onPilotEnroll={enrollLearningPilot}
        onPilotValidate={validateLearningPilotDraft}
      />

      <PrewarmReadinessCard readiness={prewarmReadiness} loading={loading && !prewarmReadiness} />

      <PostFeedbackCard feedback={postFeedback} loading={loading && !postFeedback} />

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
        <div className="flex items-center gap-1.5 glass-card border border-white/[0.06] rounded-2xl p-1">
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
        <div className="glass-card rounded-3xl border border-dashed border-white/10 p-10 text-center">
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
        <div className="glass-card rounded-3xl border border-white/[0.06] overflow-hidden">
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

const fmtRate = (value: number | null) => value == null ? 'No sample' : `${(value * 100).toFixed(1)}%`;
const PILOT_DECISION_TARGET = 30;
const PILOT_WORKSPACE_TARGET = 2;
const RELEASE_EVIDENCE_TARGET = 9;

const safeMetricCount = (value: number | undefined): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
);

const releaseEvidenceExpiryLabel = (expiresAt: string | null): string => {
  if (!expiresAt) return 'No valid receipt expiry available';
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return 'Receipt expiry is invalid';
  const remainingMs = expiryMs - Date.now();
  if (remainingMs <= 0) return 'Release evidence has expired';
  const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
  const remaining = remainingHours <= 48
    ? `${remainingHours} hour${remainingHours === 1 ? '' : 's'}`
    : `${Math.ceil(remainingHours / 24)} days`;
  return `Next receipt expires in ${remaining}`;
};

const safeReviewMediaUrl = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const SampleAdjudicationForm: React.FC<{
  decisionId: string;
  postId: string | null;
  evidenceStatus: 'verified' | 'missing' | 'stale' | null;
  evidence: LearningAdjudicationEvidence | null;
  saving: boolean;
  onAdjudicate: (decisionId: string, input: LearningAdjudicationInput) => Promise<void>;
}> = ({ decisionId, postId, evidenceStatus, evidence, saving, onAdjudicate }) => {
  const [expectedState, setExpectedState] = useState<LearningAdjudicationInput['expectedState'] | ''>('');
  const [severity, setSeverity] = useState<LearningAdjudicationInput['severity']>('advisory');
  const [note, setNote] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!evidence || evidenceStatus !== 'verified' || !expectedState || !note.trim()) return;
    try {
      await onAdjudicate(decisionId, {
        expectedState,
        severity,
        note: note.trim(),
      });
      setExpectedState('');
      setNote('');
    } catch {
      // The parent displays the API error without losing the operator's note.
    }
  };

  if (!evidence || evidenceStatus !== 'verified') {
    return (
      <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.035] p-3.5">
        <p className="text-[10px] font-bold text-amber-200/80">Sample receipt {decisionId}</p>
        <p className="mt-0.5 text-[9px] text-white/30">Post {postId ?? 'unavailable'} - Review unavailable</p>
        <p className="mt-2 text-[10px] font-bold text-amber-100/70">Source evidence changed or is unavailable</p>
        <p className="mt-1 text-[9px] leading-relaxed text-white/35">
          Create a fresh receipt before independent review. This receipt cannot be labelled.
        </p>
      </div>
    );
  }

  const mediaUrl = safeReviewMediaUrl(evidence.mediaUrl);
  const thumbnailUrl = safeReviewMediaUrl(evidence.thumbnailUrl);

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/[0.035] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold text-sky-200/75">Sample receipt {decisionId}</p>
          <p className="mt-0.5 text-[9px] text-white/30">
            Post {postId ?? 'unavailable'} - Blind review
          </p>
          <p className="mt-1 text-[9px] text-sky-100/35">
            Observed release state is hidden until this label is saved.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[9px] font-bold text-white/35">
          Unadjudicated
        </span>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-emerald-400/15 bg-black/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-200/75">
            Receipt source verified
          </span>
          <span className="text-[9px] text-white/35">{evidence.platform}</span>
        </div>
        {evidence.mediaKind === 'image' && mediaUrl ? (
          <img
            src={mediaUrl}
            alt="Post media under independent review"
            className="max-h-72 w-full bg-black/30 object-contain"
          />
        ) : evidence.mediaKind === 'video' && mediaUrl ? (
          <video
            src={mediaUrl}
            poster={thumbnailUrl ?? undefined}
            controls
            preload="metadata"
            className="max-h-72 w-full bg-black/30 object-contain"
          />
        ) : null}
        <div className="space-y-2 p-3">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">{evidence.content}</p>
          {evidence.hashtags.length > 0 && (
            <p className="text-[10px] leading-relaxed text-sky-200/60">{evidence.hashtags.join(' ')}</p>
          )}
          {evidence.videoScript && (
            <p className="whitespace-pre-wrap text-[10px] leading-relaxed text-white/45">{evidence.videoScript}</p>
          )}
          <p className="font-mono text-[8px] text-white/20">Receipt hash {evidence.contentHash.slice(0, 12)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] font-bold text-white/45">
          Expected release state
          <select
            value={expectedState}
            onChange={(event) => setExpectedState(event.target.value as LearningAdjudicationInput['expectedState'])}
            disabled={saving}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] text-white outline-none"
          >
            <option value="" disabled>Choose independently</option>
            <option value="pass_green">Pass green</option>
            <option value="hold_amber">Hold amber</option>
            <option value="block_red">Block red</option>
          </select>
        </label>
        <label className="text-[10px] font-bold text-white/45">
          Audit severity
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as LearningAdjudicationInput['severity'])}
            disabled={saving}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] text-white outline-none"
          >
            <option value="advisory">Advisory</option>
            <option value="release_critical">Release critical</option>
          </select>
        </label>
      </div>
      <label className="mt-2 block text-[10px] font-bold text-white/45">
        Required audit note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          disabled={saving}
          placeholder="What should the independent release decision have been, and why?"
          className="mt-1 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] text-white outline-none placeholder:text-white/20"
        />
      </label>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] leading-relaxed text-white/30">
          This audit label cannot approve, schedule, or publish anything.
        </p>
        <button
          type="submit"
          disabled={saving || !evidence || !expectedState || !note.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-[10px] font-bold text-sky-200 transition hover:bg-sky-500/15 disabled:opacity-40"
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : <ClipboardCheck size={10} />}
          Save audit label
        </button>
      </div>
    </form>
  );
};

export const LearningOperationsCard: React.FC<{
  operations: AdminLearningOperations | null;
  pilotQueue?: LearningPilotQueue | null;
  pilotActionKey?: string | null;
  loading: boolean;
  savingDecisionId: string | null;
  error?: string | null;
  onAdjudicate: (decisionId: string, input: LearningAdjudicationInput) => Promise<void>;
  onPilotEnroll?: (
    clientId: string | null,
    budgetCents: number,
    customerConsent?: LearningPilotCustomerConsent,
  ) => Promise<void>;
  onPilotValidate?: (postId: string) => Promise<void>;
}> = ({
  operations,
  pilotQueue = null,
  pilotActionKey = null,
  loading,
  savingDecisionId,
  error = null,
  onAdjudicate,
  onPilotEnroll,
  onPilotValidate,
}) => {
  const ready = operations?.readiness.ready === true && operations.readiness.stale !== true;
  const killSwitchEngaged = operations?.globalSwitches.protectedAutopilot !== true;
  const pilotDecisions = safeMetricCount(operations?.readiness.metrics.pilotDecisions);
  const pilotWorkspaceCount = safeMetricCount(operations?.readiness.metrics.pilotWorkspaceCount);
  const pilotUserDecisions = safeMetricCount(operations?.readiness.metrics.pilotUserDecisions);
  const pilotClientDecisions = safeMetricCount(operations?.readiness.metrics.pilotClientDecisions);
  const adjudicatedDecisions = safeMetricCount(operations?.readiness.metrics.adjudicatedDecisions);
  const pilotRemaining = Math.max(0, PILOT_DECISION_TARGET - pilotDecisions);
  const pilotProgress = Math.min(100, (pilotDecisions / PILOT_DECISION_TARGET) * 100);
  const releaseEvidence = operations?.releaseEvidence ?? {
    validCount: 0,
    requiredCount: RELEASE_EVIDENCE_TARGET,
    invalidOrMissingCount: RELEASE_EVIDENCE_TARGET,
    expiredCount: 0,
    complete: false,
    nextExpiryAt: null,
  };
  const [pilotBudgetDollars, setPilotBudgetDollars] = useState('5.00');
  const [pilotCustomerConsentConfirmed, setPilotCustomerConsentConfirmed] = useState(false);
  const [pilotCustomerConsentNote, setPilotCustomerConsentNote] = useState('');
  const budgetNumber = Number(pilotBudgetDollars);
  const pilotBudgetCents = Number.isFinite(budgetNumber)
    ? Math.round(budgetNumber * 100)
    : 0;
  const validPilotBudget = pilotBudgetCents >= 1 && pilotBudgetCents <= 10_000;
  const pilotBudgetLabel = validPilotBudget
    ? `$${(pilotBudgetCents / 100).toFixed(2)}`
    : 'invalid cap';
  const trimmedPilotConsentNote = pilotCustomerConsentNote.trim();
  const validPilotCustomerConsent = pilotCustomerConsentConfirmed
    && trimmedPilotConsentNote.length >= 10
    && trimmedPilotConsentNote.length <= 500;
  const hasUnenrolledClientPilot = pilotQueue?.candidates.some(
    (candidate) => candidate.clientId !== null && !candidate.enrolled,
  ) === true;

  return (
    <div className={`glass-card rounded-2xl border p-4 sm:p-5 ${
      ready ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : 'border-amber-500/20 bg-amber-500/[0.03]'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit size={15} className={ready ? 'text-emerald-300' : 'text-amber-300'} />
            <h3 className="text-sm font-black text-white">Learning and Protected Autopilot operations</h3>
          </div>
          <p className="mt-1 text-xs text-white/35">
            Immutable release evidence, sampled audit labels, and global safety state.
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/40">
            <Loader2 size={11} className="animate-spin" /> Loading
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5 text-[9px] font-bold uppercase tracking-wider">
            <span className={`rounded-full border px-2 py-1 ${
              ready
                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-400/20 bg-amber-500/10 text-amber-200'
            }`}>
              {ready ? 'Release readiness passed' : 'Release readiness pending'}
            </span>
            <span className={`rounded-full border px-2 py-1 ${
              killSwitchEngaged
                ? 'border-rose-400/20 bg-rose-500/10 text-rose-200'
                : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
            }`}>
              {killSwitchEngaged ? 'Kill switch engaged' : 'Protected switch enabled'}
            </span>
          </div>
        )}
      </div>

      {operations && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
          <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-cyan-200/60">
                  Current-policy pilot
                </p>
                <p className="mt-1 text-lg font-black text-white/85">
                  {pilotDecisions} / {PILOT_DECISION_TARGET} decisions
                </p>
              </div>
              <p className="text-[10px] font-bold text-white/40">
                {pilotRemaining === 0 ? 'Decision gate met' : `${pilotRemaining} remaining`}
              </p>
            </div>
            <div
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
              role="progressbar"
              aria-label="Pilot decision progress"
              aria-valuemin={0}
              aria-valuemax={PILOT_DECISION_TARGET}
              aria-valuenow={Math.min(pilotDecisions, PILOT_DECISION_TARGET)}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                style={{ width: `${pilotProgress}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Workspaces', `${pilotWorkspaceCount} / ${PILOT_WORKSPACE_TARGET}`],
                ['User decisions', String(pilotUserDecisions)],
                ['Client decisions', String(pilotClientDecisions)],
                ['Adjudicated', `${adjudicatedDecisions} / ${PILOT_DECISION_TARGET}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/[0.05] bg-black/15 p-2.5">
                  <p className="text-[9px] leading-tight text-white/30">{label}</p>
                  <p className="mt-1 text-xs font-black text-white/70">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-xl border p-3.5 ${
            releaseEvidence.complete
              ? 'border-emerald-400/15 bg-emerald-500/[0.035]'
              : 'border-amber-400/15 bg-amber-500/[0.035]'
          }`}>
            <div className="flex items-center gap-1.5">
              <Clock size={12} className={
                releaseEvidence.complete ? 'text-emerald-300' : 'text-amber-300'
              } />
              <p className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                Immutable release evidence
              </p>
            </div>
            <p className="mt-2 text-lg font-black text-white/85">
              {releaseEvidence.validCount} / {releaseEvidence.requiredCount} valid receipts
            </p>
            <p className="mt-1 text-[10px] text-white/40">
              {releaseEvidenceExpiryLabel(releaseEvidence.nextExpiryAt)}
            </p>
            {!releaseEvidence.complete && (
              <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-100/70">
                {releaseEvidence.invalidOrMissingCount} current-policy receipt
                {releaseEvidence.invalidOrMissingCount === 1 ? '' : 's'} missing or invalid.
                {releaseEvidence.expiredCount > 0
                  ? ` ${releaseEvidence.expiredCount} expired.`
                  : ''}
              </p>
            )}
          </div>

          <div className="lg:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.05] bg-black/15 px-3 py-2 text-[9px] text-white/35">
            <span>Learning brain: {operations.globalSwitches.learningBrain ? 'on' : 'off'}</span>
            <span>Release enforcement: {operations.globalSwitches.releaseEnforcement ? 'on' : 'off'}</span>
            <span>Policy: {operations.policyVersion}</span>
            <span>{operations.workspaces.length} workspace{operations.workspaces.length === 1 ? '' : 's'}</span>
            <span className="font-bold text-rose-100/55">
              Read-only status: this panel cannot enable autopilot, schedule, or publish posts.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/[0.05] px-3 py-2 text-[10px] text-rose-200/75">
          {error}
        </div>
      )}

      {pilotQueue && (
        <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.035] p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <ClipboardCheck size={12} className="text-cyan-300" />
                <h4 className="text-xs font-black text-cyan-100/85">Approval pilot queue</h4>
              </div>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-white/35">
                Draft content, status, schedule, and publishing stay unchanged. No autopublish consent is recorded.
              </p>
            </div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-white/35">
              Monthly AI ceiling
              <span className="mt-1 flex items-center rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 normal-case tracking-normal">
                <span className="mr-1 text-white/35">$</span>
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={pilotBudgetDollars}
                  onChange={(event) => setPilotBudgetDollars(event.target.value)}
                  className="w-20 bg-transparent text-[11px] font-bold text-white/75 outline-none"
                  aria-label="Pilot monthly AI ceiling in dollars"
                />
              </span>
            </label>
          </div>

          {hasUnenrolledClientPilot && (
            <div className="mt-3 rounded-lg border border-amber-400/15 bg-amber-500/[0.035] p-3">
              <p className="text-[10px] font-black text-amber-100/80">
                Customer pilot consent attestation
              </p>
              <label className="mt-2 flex items-start gap-2 text-[10px] leading-relaxed text-white/45">
                <input
                  type="checkbox"
                  checked={pilotCustomerConsentConfirmed}
                  onChange={(event) => setPilotCustomerConsentConfirmed(event.target.checked)}
                  className="mt-0.5 accent-amber-400"
                />
                I have confirmed this customer agreed to record-only AI critique of their draft posts.
                This is not consent to publish.
              </label>
              <label className="mt-2 block text-[9px] font-bold uppercase tracking-wider text-white/35">
                Consent evidence note
                <textarea
                  maxLength={500}
                  value={pilotCustomerConsentNote}
                  onChange={(event) => setPilotCustomerConsentNote(event.target.value)}
                  placeholder="When and how the customer confirmed participation"
                  className="mt-1 min-h-16 w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-[10px] font-normal normal-case tracking-normal text-white/70 outline-none placeholder:text-white/20"
                />
              </label>
              <p className="mt-1 text-[9px] text-white/30">
                Client enrollment stays disabled until both are complete.
              </p>
            </div>
          )}

          {pilotQueue.candidates.length === 0 ? (
            <p className="mt-3 text-[10px] text-white/30">No eligible unvalidated drafts are available.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {pilotQueue.candidates.map((candidate) => {
                const actionKey = candidate.enrolled
                  ? `validate:${candidate.samplePostId}`
                  : `enroll:${candidate.clientId ?? '__owner__'}`;
                const busy = pilotActionKey === actionKey;
                return (
                  <div key={candidate.workspaceKey} className="rounded-lg border border-white/[0.07] bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-bold text-white/75">{candidate.label}</p>
                        <p className="mt-0.5 text-[9px] text-white/30">
                          {candidate.eligibleDraftCount} eligible real draft{candidate.eligibleDraftCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[8px] font-bold uppercase tracking-wider ${
                        candidate.enrolled
                          ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                          : 'border-white/10 bg-white/5 text-white/35'
                      }`}>
                        {candidate.enrolled ? 'Approval enrolled' : 'Not enrolled'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy || (
                        !candidate.enrolled
                        && (
                          !validPilotBudget
                          || (candidate.clientId !== null && !validPilotCustomerConsent)
                        )
                      )}
                      onClick={() => candidate.enrolled
                        ? onPilotValidate?.(candidate.samplePostId)
                        : onPilotEnroll?.(
                          candidate.clientId,
                          pilotBudgetCents,
                          candidate.clientId === null ? undefined : {
                            confirmed: true,
                            note: trimmedPilotConsentNote,
                          },
                        )}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-500/15 disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={10} className="animate-spin" /> : <ClipboardCheck size={10} />}
                      {candidate.enrolled
                        ? 'Validate next real draft'
                        : `Enroll with ${pilotBudgetLabel} cap`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loading && operations?.workspaces.length === 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-white/35">
          <CheckCircle size={13} className="text-emerald-300" /> No workspace learning rows yet.
        </div>
      )}

      {operations && operations.workspaces.length > 0 && (
        <div className="mt-4 space-y-3">
          {operations.workspaces.map((workspace) => {
            const currentConsent = workspace.consentAt != null
              && workspace.consentPolicyVersion === operations.policyVersion;
            return (
              <div key={`${workspace.ownerKind}:${workspace.ownerId}`} className="rounded-xl border border-white/[0.07] bg-black/15 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-white/75">{workspace.ownerId}</p>
                    <p className="mt-0.5 text-[9px] text-white/30">
                      {workspace.ownerKind} - {workspace.decisionCount} recent release decisions
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[9px] font-bold">
                    <span className="rounded-full border border-sky-400/15 bg-sky-500/10 px-2 py-1 text-sky-200">
                      {workspace.mode.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase())}
                    </span>
                    <span className={`rounded-full border px-2 py-1 ${
                      workspace.onHold
                        ? 'border-rose-400/20 bg-rose-500/10 text-rose-200'
                        : workspace.active
                          ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                          : 'border-white/10 bg-white/5 text-white/40'
                    }`}>
                      {workspace.onHold ? 'On hold' : workspace.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/40">
                      {currentConsent ? `Consent ${workspace.consentPolicyVersion}` : 'No current-policy consent'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['Hold rate', fmtRate(workspace.holdRate)],
                    ['Sampled false holds', fmtRate(workspace.sampledFalseHoldRate)],
                    ['Critic availability', fmtRate(workspace.criticAvailability)],
                    ['Judge receipt availability', fmtRate(workspace.judgeAvailability)],
                    ['Severe false passes', String(workspace.severeFalsePasses)],
                    ['Adjudication coverage', fmtRate(workspace.adjudicationCoverage)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/[0.05] bg-black/15 p-2.5">
                      <p className="text-[9px] leading-tight text-white/30">{label}</p>
                      <p className="mt-1 text-xs font-black text-white/70">{value}</p>
                    </div>
                  ))}
                </div>

                {workspace.sampleDecisionId ? (
                  <SampleAdjudicationForm
                    decisionId={workspace.sampleDecisionId}
                    postId={workspace.samplePostId ?? null}
                    evidenceStatus={workspace.sampleEvidenceStatus ?? null}
                    evidence={workspace.sampleEvidence ?? null}
                    saving={savingDecisionId === workspace.sampleDecisionId}
                    onAdjudicate={onAdjudicate}
                  />
                ) : (
                  <p className="mt-3 text-[10px] text-white/30">No unlabelled release receipt is available in the current sample.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const issueLabel: Record<AdminPrewarmReadiness['posts'][number]['issue'], string> = {
  missing_image: 'Missing image',
  video_pending: 'Video pending',
  video_failed: 'Video failed',
  video_missing: 'Missing video',
};

const fmtDue = (iso: string | null) => {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const PrewarmReadinessCard: React.FC<{
  readiness: AdminPrewarmReadiness | null;
  loading: boolean;
}> = ({ readiness, loading }) => {
  const rows = readiness?.posts.slice(0, 5) || [];
  const hasGaps = !!readiness && readiness.total > 0;

  return (
    <div className={`glass-card rounded-2xl border p-4 sm:p-5 ${hasGaps ? 'border-amber-500/20 bg-amber-500/[0.03]' : 'border-white/[0.06]'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Clock size={15} className={hasGaps ? 'text-amber-300' : 'text-emerald-300'} />
            <h3 className="text-sm font-black text-white">Prewarm readiness</h3>
          </div>
          <p className="text-xs text-white/35 mt-1">Scheduled posts due in the next 24 hours with missing media or video still not ready.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-white/40"><Loader2 size={11} className="animate-spin" /> Loading</span>
          ) : (
            <>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/55">{readiness?.total ?? 0} gaps</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/55">{readiness?.counts.missing_images ?? 0} images</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/55">{readiness?.counts.video_pending ?? 0} pending</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/55">{readiness?.counts.video_failed ?? 0} failed</span>
            </>
          )}
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300/75">
          <CheckCircle size={13} /> Due-soon scheduled posts look ready.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 divide-y divide-white/[0.05]">
          {rows.map(post => (
            <div key={post.id} className="grid grid-cols-1 sm:grid-cols-[110px_120px_1fr] gap-1 sm:gap-3 py-2.5 text-xs">
              <span className={`font-bold ${post.issue === 'video_failed' ? 'text-rose-300' : 'text-amber-300'}`}>{issueLabel[post.issue]}</span>
              <span className="text-white/35">{fmtDue(post.scheduled_for)}</span>
              <div className="min-w-0">
                <span className="text-white/60 line-clamp-1">{post.content_preview || 'No caption'}</span>
                <span className="text-[10px] text-white/25">
                  {post.workspace}{post.client_name && post.email ? ` - ${post.email}` : ''} - {post.platform || 'Platform unknown'}
                </span>
                {post.video_error && <span className="block text-[10px] text-rose-300/70 truncate">{post.video_error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const feedbackReasonLabel: Record<NonNullable<AdminPostFeedback['qa_feedback_reason']>, string> = {
  off_brand: 'Off brand',
  bad_image: 'Bad image',
  bad_caption: 'Bad caption',
  other: 'Other',
};

const feedbackTargetLabel: Record<NonNullable<AdminPostFeedback['qa_feedback_target']>, string> = {
  post: 'Post',
  image: 'Image',
  caption: 'Caption',
};

const PostFeedbackCard: React.FC<{
  feedback: AdminPostFeedback[] | null;
  loading: boolean;
}> = ({ feedback, loading }) => {
  const rows = feedback?.slice(0, 5) || [];
  const hasFeedback = rows.length > 0;

  return (
    <div className={`glass-card rounded-2xl border p-4 sm:p-5 ${hasFeedback ? 'border-sky-500/20 bg-sky-500/[0.03]' : 'border-white/[0.06]'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className={hasFeedback ? 'text-sky-300' : 'text-emerald-300'} />
            <h3 className="text-sm font-black text-white">Customer QA feedback</h3>
          </div>
          <p className="text-xs text-white/35 mt-1">Recent post, image, and caption feedback submitted from the editor.</p>
        </div>
        <div className="text-[10px] font-bold">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-white/40"><Loader2 size={11} className="animate-spin" /> Loading</span>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/55">{feedback?.length ?? 0} recent</span>
          )}
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300/75">
          <CheckCircle size={13} /> No recent customer QA feedback.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 divide-y divide-white/[0.05]">
          {rows.map(item => {
            const target = item.qa_feedback_target ? feedbackTargetLabel[item.qa_feedback_target] : 'Post';
            const reason = item.qa_feedback_reason ? feedbackReasonLabel[item.qa_feedback_reason] : 'Feedback';
            const workspace = item.client_name || item.email || item.client_id || item.user_id || 'Unknown workspace';

            return (
              <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[120px_140px_1fr] gap-1 sm:gap-3 py-2.5 text-xs">
                <div>
                  <span className="font-bold text-sky-300">{reason}</span>
                  <span className="block text-[10px] text-white/30">{target} - {item.platform || 'Platform unknown'}</span>
                </div>
                <div className="text-white/35">
                  <span className="block">{fmtDue(item.qa_feedback_at)}</span>
                  <span className="block text-[10px]">{item.status || 'Status unknown'}</span>
                </div>
                <div className="min-w-0">
                  {item.qa_feedback_note && <span className="block text-white/70 line-clamp-1">{item.qa_feedback_note}</span>}
                  <span className="block text-white/45 line-clamp-1">{item.content_preview || 'No caption preview'}</span>
                  <span className="text-[10px] text-white/25">{workspace}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

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
  <div className="glass-card border border-white/[0.06] rounded-xl p-3 space-y-2">
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
  <div className="glass-card border border-white/[0.06] rounded-xl p-3 space-y-2">
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

// PaymentList lives in ./PaymentList — extracted so AccountPanel can import
// it without dragging the whole AdminCustomers module into the eager bundle.
