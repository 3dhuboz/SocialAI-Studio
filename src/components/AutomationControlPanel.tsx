import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArchiveRestore, Loader2, PauseCircle, PlayCircle, ShieldCheck } from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type { ClientAutomationState } from '../services/db';

export type { ClientAutomationState } from '../services/db';

interface AutomationControlProps {
  state: ClientAutomationState;
  saving: boolean;
  onPause: () => void;
  onResume: () => void;
  onReturnStaleToDraft: () => void;
}

export const AutomationControl: React.FC<AutomationControlProps> = ({
  state,
  saving,
  onPause,
  onResume,
  onReturnStaleToDraft,
}) => (
  <section className={`rounded-2xl border p-5 ${
    state.paused
      ? 'border-amber-500/30 bg-amber-500/[0.07]'
      : 'border-emerald-500/30 bg-emerald-500/[0.07]'
  }`} aria-label="Publishing automation">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          state.paused ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
        }`}>
          {state.paused ? <PauseCircle size={19} /> : <ShieldCheck size={19} />}
        </span>
        <div>
          <p className={`text-sm font-black ${state.paused ? 'text-amber-200' : 'text-emerald-200'}`}>
            {state.paused ? 'Automation paused' : 'Automation active'}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
            {state.paused
              ? 'Drafts remain safe for review and the publisher will skip this workspace.'
              : 'Only posts explicitly marked Scheduled are eligible to publish at their selected time.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-bold text-white/55">
        <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">{state.draftCount} drafts</span>
        <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">{state.scheduledCount} scheduled</span>
        <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">{state.postedCount} posted</span>
      </div>
    </div>

    {state.paused && state.staleScheduledCount > 0 && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] p-3.5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-300" />
          <div>
            <p className="text-xs font-bold text-rose-200">
              {state.staleScheduledCount} old queued post{state.staleScheduledCount === 1 ? '' : 's'} need review
            </p>
            <p className="mt-0.5 text-[11px] text-white/45">
              {state.overdueScheduledCount} overdue · {state.undatedScheduledCount} without a date. Resume stays locked until these return to Draft.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReturnStaleToDraft}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3.5 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
          Move old queue to Draft
        </button>
      </div>
    )}

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
      <p className="text-[11px] text-white/40">
        {state.paused && state.canResume
          ? 'Ready to resume. Future scheduled posts will publish automatically.'
          : state.paused
            ? 'Review the old queue before enabling publishing.'
            : 'Use Pause automation to stop future claims immediately.'}
      </p>
      {state.paused ? (
        <button
          type="button"
          onClick={onResume}
          disabled={saving || !state.canResume}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          Resume automation
        </button>
      ) : (
        <button
          type="button"
          onClick={onPause}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2 text-xs font-bold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />}
          Pause automation
        </button>
      )}
    </div>
  </section>
);

export const AutomationControlPanel: React.FC<{ clientId?: string | null }> = ({ clientId = null }) => {
  const db = useDb();
  const [state, setState] = useState<ClientAutomationState | null>(null);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!clientId) return;
    const next = await db.getClientAutomationState(clientId);
    setState(next);
  };

  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      setState(null);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    db.getClientAutomationState(clientId)
      .then((next) => { if (!cancelled) setState(next); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Automation status could not be loaded'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, db]);

  if (!clientId) return null;
  if (loading) {
    return (
      <div className="glass-card flex min-h-28 items-center justify-center rounded-2xl border border-white/[0.06]">
        <Loader2 size={17} className="animate-spin text-amber-300" />
        <span className="ml-2 text-xs text-white/35">Checking publishing safety…</span>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.07] p-4 text-xs text-rose-200">
        {error || 'Automation status is unavailable. Publishing controls remain closed.'}
      </div>
    );
  }

  const run = async (action: 'pause' | 'resume' | 'return-stale-to-draft') => {
    if (action === 'resume' && !window.confirm('Resume automated publishing for this workspace? Only Scheduled posts will be eligible to publish.')) return;
    setSaving(true);
    setError(null);
    try {
      const result = await db.updateClientAutomation(clientId, action);
      setState(result.automation);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Automation could not be updated');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AutomationControl
        state={state}
        saving={saving}
        onPause={() => void run('pause')}
        onResume={() => void run('resume')}
        onReturnStaleToDraft={() => void run('return-stale-to-draft')}
      />
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </>
  );
};
