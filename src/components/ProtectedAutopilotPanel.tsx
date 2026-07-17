import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Gauge,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type {
  LearningReadinessChecks,
  LearningReadinessResponse,
  LearningSettingsResponse,
} from '../services/db';

interface ProtectedAutopilotPanelProps {
  clientId?: string | null;
}

interface ProtectedAutopilotControlProps {
  settings: LearningSettingsResponse;
  readiness: LearningReadinessResponse;
  budgetDollars: string;
  saving: boolean;
  error?: string | null;
  onBudgetChange: (value: string) => void;
  onRequestProtected: () => void;
  onUseApproval: () => void;
}

type BooleanCheckKey = Exclude<keyof LearningReadinessChecks, 'tenancyProofs'>;

function formatMoney(cents: number | null): string {
  if (cents == null) return 'Unavailable';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPercent(value: number | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : `${(value * 100).toFixed(digits)}%`;
}

function positiveBudget(value: string): boolean {
  return dollarsToCents(value) !== null;
}

function gateRows(readiness: LearningReadinessResponse): Array<{
  key: string;
  label: string;
  detail: string;
  passed: boolean;
}> {
  const checks = readiness.checks;
  const metrics = readiness.metrics;
  const rows: Array<[BooleanCheckKey, string, string]> = [
    ['pilot', 'Pilot decisions', `${metrics.pilotDecisions ?? 0} of 30`],
    [
      'pilotCohort',
      'Owner + client pilot cohort',
      `${metrics.pilotWorkspaceCount ?? 0} of 2 workspaces; owner ${metrics.pilotUserDecisions ?? 0} / client ${metrics.pilotClientDecisions ?? 0}`,
    ],
    ['adjudications', 'Adjudicated decisions', `${metrics.adjudicatedDecisions ?? 0} of 30`],
    ['severeFalsePasses', 'Severe false passes', `${metrics.severeFalsePasses ?? 0} recorded`],
    ['falseHolds', 'Sampled false holds', `${formatPercent(metrics.falseHoldRate)} (must stay below 5%)`],
    ['availability', 'Required critic and media availability', `${formatPercent(metrics.requiredAvailability, 2)} (minimum 99.5%)`],
    ['releaseJudgeAvailability', 'Release Judge availability', `${formatPercent(metrics.releaseJudgeAvailability, 2)} across ${metrics.releaseJudgeInvocations ?? 0} calls (minimum 99.5%)`],
    ['releaseJudgeTelemetry', 'Release Judge telemetry coverage', `${formatPercent(metrics.releaseJudgeTelemetryCoverage)} (must be 100%)`],
    ['receipts', 'Decision receipt coverage', `${formatPercent(metrics.decisionReceiptCoverage)} (must be 100%)`],
    ['predictionLift', 'Prediction lift', `${formatPercent(metrics.predictionLift)} (minimum 15%)`],
    ['rankCorrelation', 'Prediction rank correlation', `${metrics.rankCorrelation ?? 0} (must be positive)`],
    ['criticalBypasses', 'Critical bypasses', `${metrics.criticalBypasses ?? 0} recorded`],
    [
      'publishingRegressions',
      'Publishing regressions',
      checks.publishRegression
        ? `${metrics.publishingRegressions ?? 0} recorded`
        : 'Validated regression proof pending or failed',
    ],
    ['cost', 'AI cost ceiling', readiness.cost.withinBudget ? 'Within monthly ceiling' : 'Not proven within ceiling'],
    ['killSwitch', 'Kill-switch proof', metrics.killSwitchTested ? 'Tested' : 'Not tested'],
    ['replayRedTeam', 'Replay and red-team suite', checks.replayRedTeam ? 'Passed' : 'Pending'],
    ['publishRegression', 'Publish regression proof', checks.publishRegression ? 'Passed' : 'Pending'],
  ];
  const tenancy = checks.tenancyProofs ?? {};
  return [
    ...rows.map(([key, label, detail]) => ({
      key,
      label,
      detail,
      passed: checks[key] === true,
    })),
    {
      key: 'tenancyProofs',
      label: 'Tenant isolation proofs',
      detail: `User ${tenancy.user ? 'pass' : 'pending'} / Client ${tenancy.client ? 'pass' : 'pending'} / Shopify ${tenancy.shop ? 'pass' : 'pending'}`,
      passed: tenancy.user === true && tenancy.client === true && tenancy.shop === true,
    },
  ];
}

export const ProtectedAutopilotControl: React.FC<ProtectedAutopilotControlProps> = ({
  settings,
  readiness,
  budgetDollars,
  saving,
  error = null,
  onBudgetChange,
  onRequestProtected,
  onUseApproval,
}) => {
  const switches = readiness.globalSwitches;
  const requested = settings.settings.mode === 'protected_autopilot'
    && settings.settings.autopublishConsentAt != null
    && settings.settings.autopublishPolicyVersion === readiness.policyVersion;
  const active = requested
    && settings.effectiveMode === 'protected_autopilot'
    && readiness.effectiveMode === 'protected_autopilot'
    && readiness.ready
    && !readiness.stale
    && switches.learningBrain
    && switches.releaseEnforcement
    && switches.protectedAutopilot;
  const isOff = settings.effectiveMode === 'off' || readiness.effectiveMode === 'off';
  const blockers = [
    isOff ? 'This workspace is not eligible for learning release mode' : null,
    !switches.learningBrain ? 'Learning Brain is globally disabled' : null,
    !switches.releaseEnforcement ? 'Release enforcement is not enabled' : null,
    !switches.protectedAutopilot ? 'Protected Autopilot is globally disabled' : null,
    readiness.stale ? 'Readiness evidence is stale' : null,
    !readiness.ready ? 'Release readiness has not passed' : null,
    readiness.cost.monthlyAiSpendUsdCents == null
      ? 'Spend telemetry unavailable; Protected Autopilot cannot activate'
      : null,
    !positiveBudget(budgetDollars) ? 'A positive monthly AI ceiling is required' : null,
    readiness.cost.monthlyAiSpendUsdCents != null && !readiness.cost.withinBudget
      ? 'AI spend is not proven below the monthly ceiling'
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  const gates = gateRows(readiness);
  const budgetCents = dollarsToCents(budgetDollars);

  return (
    <section className={`glass-card overflow-hidden rounded-2xl border ${
      active
        ? 'border-emerald-400/25 bg-emerald-500/[0.035]'
        : requested
          ? 'border-amber-400/25 bg-amber-500/[0.035]'
          : 'border-sky-400/15 bg-sky-500/[0.025]'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            active ? 'bg-emerald-500/12 text-emerald-300' : 'bg-sky-500/10 text-sky-300'
          }`}>
            {active ? <ShieldCheck size={17} /> : <LockKeyhole size={17} />}
          </div>
          <div>
            <p className="text-sm font-black text-white">
              {active
                ? 'Protected Autopilot active'
                : requested
                  ? 'Protected Autopilot pending'
                  : isOff
                    ? 'Learning safety mode off'
                    : 'Approval mode'}
            </p>
            <p className="mt-0.5 text-[11px] text-white/35">
              {active
                ? 'Safe posts can publish unattended; uncertain posts are held automatically.'
                : isOff
                  ? 'Posting access is unchanged, but this workspace cannot enter a learning release mode.'
                  : 'Protected publishing stays off until every independent safety gate passes.'}
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
          active
            ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
            : requested
              ? 'border-amber-400/25 bg-amber-500/10 text-amber-200'
              : 'border-sky-400/20 bg-sky-500/10 text-sky-200'
        }`}>
          {active ? 'Green' : requested ? 'Pending' : isOff ? 'Learning off' : 'Protected off'}
        </span>
      </div>

      <div className="space-y-5 p-5">
        {!active && blockers.length > 0 && (
          <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] p-3.5">
            <div className="flex items-center gap-2 text-amber-200/80">
              <AlertTriangle size={13} />
              <p className="text-[11px] font-bold">Why it cannot activate yet</p>
            </div>
            <ul className="mt-2.5 space-y-1.5">
              {blockers.map((reason) => (
                <li key={reason} className="flex items-start gap-2 text-[10px] text-white/45">
                  <XCircle size={10} className="mt-0.5 shrink-0 text-amber-300/70" /> {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
            <div className="flex items-center gap-2 text-white/45">
              <DollarSign size={13} />
              <p className="text-[10px] font-bold uppercase tracking-wider">Current month AI spend</p>
            </div>
            <p className="mt-2 text-xl font-black text-white">
              {formatMoney(readiness.cost.monthlyAiSpendUsdCents)}
            </p>
            <p className="mt-1 text-[10px] text-white/30">
              {readiness.cost.telemetryCount} metered event{readiness.cost.telemetryCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
            <div className="flex items-center justify-between gap-2 text-white/45">
              <div className="flex items-center gap-2">
                <Gauge size={13} />
                <label htmlFor="learning-ai-budget" className="text-[10px] font-bold uppercase tracking-wider">
                  Monthly AI ceiling (USD)
                </label>
              </div>
              <span className="text-[10px] text-white/30">
                Ceiling {budgetCents == null ? 'invalid' : formatMoney(budgetCents)}
              </span>
            </div>
            <div className="mt-2 flex items-center rounded-lg border border-white/10 bg-black/20 px-3">
              <span className="text-sm font-bold text-white/35">$</span>
              <input
                id="learning-ai-budget"
                inputMode="decimal"
                value={budgetDollars}
                onChange={(event) => onBudgetChange(event.target.value)}
                disabled={saving || active}
                aria-label="Monthly AI spend ceiling in US dollars"
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-bold text-white outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Permanent release gates</p>
            <span className="text-[10px] text-white/25">
              {gates.filter((gate) => gate.passed).length}/{gates.length} passed
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {gates.map((gate) => (
              <div key={gate.key} className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                {gate.passed
                  ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-300" />
                  : <XCircle size={12} className="mt-0.5 shrink-0 text-rose-300" />}
                <div>
                  <p className="text-[10px] font-bold text-white/60">{gate.label}</p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-white/30">{gate.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-400/20 bg-rose-500/[0.05] px-3.5 py-3 text-[11px] text-rose-200/75">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
          <p className="max-w-2xl text-[10px] leading-relaxed text-white/35">
            Your request will not activate until every release gate passes. Unsafe, uncertain, or unavailable-critic posts are held automatically.
          </p>
          {requested ? (
            <button
              type="button"
              onClick={onUseApproval}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-[11px] font-bold text-white/65 transition hover:bg-white/[0.08] disabled:opacity-40"
            >
              {saving && <Loader2 size={11} className="animate-spin" />}
              Switch to Approval mode
            </button>
          ) : (
            <button
              type="button"
              onClick={onRequestProtected}
              disabled={saving || isOff || !positiveBudget(budgetDollars)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-500/15 px-4 py-2 text-[11px] font-black text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
              Consent and request Protected Autopilot
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

function dollarsToCents(value: string): number | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export const ProtectedAutopilotPanel: React.FC<ProtectedAutopilotPanelProps> = ({
  clientId = null,
}) => {
  const db = useDb();
  const [settings, setSettings] = useState<LearningSettingsResponse | null>(null);
  const [readiness, setReadiness] = useState<LearningReadinessResponse | null>(null);
  const [budgetDollars, setBudgetDollars] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [nextSettings, nextReadiness] = await Promise.all([
      db.getLearningSettings(clientId),
      db.getLearningReadiness(clientId),
    ]);
    setSettings(nextSettings);
    setReadiness(nextReadiness);
    setBudgetDollars(nextSettings.settings.monthlyAiBudgetUsdCents == null
      ? ''
      : (nextSettings.settings.monthlyAiBudgetUsdCents / 100).toFixed(2));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      db.getLearningSettings(clientId),
      db.getLearningReadiness(clientId),
    ]).then(([nextSettings, nextReadiness]) => {
      if (cancelled) return;
      setSettings(nextSettings);
      setReadiness(nextReadiness);
      setBudgetDollars(nextSettings.settings.monthlyAiBudgetUsdCents == null
        ? ''
        : (nextSettings.settings.monthlyAiBudgetUsdCents / 100).toFixed(2));
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Protected Autopilot status could not be loaded');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [db, clientId]);

  const updateMode = async (mode: 'approval' | 'protected_autopilot') => {
    const budget = dollarsToCents(budgetDollars);
    if (mode === 'protected_autopilot' && budget == null) {
      setError('Enter a positive monthly AI ceiling with no more than two decimal places.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.updateLearningSettings({
        clientId,
        mode,
        consent: mode === 'protected_autopilot' ? true : undefined,
        monthlyAiBudgetUsdCents: mode === 'protected_autopilot' ? budget : undefined,
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Protected Autopilot settings could not be saved');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card flex min-h-40 items-center justify-center rounded-2xl border border-white/[0.06]">
        <Loader2 size={18} className="animate-spin text-sky-300" />
        <span className="ml-2 text-xs text-white/35">Checking permanent safety gates...</span>
      </div>
    );
  }
  if (!settings || !readiness) {
    return (
      <div className="glass-card rounded-2xl border border-rose-400/15 p-5">
        <p className="text-xs font-bold text-rose-300">Protected Autopilot status is unavailable</p>
        <p className="mt-1 text-[11px] text-white/35">{error ?? 'No readiness response was returned.'}</p>
      </div>
    );
  }
  return (
    <ProtectedAutopilotControl
      settings={settings}
      readiness={readiness}
      budgetDollars={budgetDollars}
      saving={saving}
      error={error}
      onBudgetChange={setBudgetDollars}
      onRequestProtected={() => { void updateMode('protected_autopilot'); }}
      onUseApproval={() => { void updateMode('approval'); }}
    />
  );
};
