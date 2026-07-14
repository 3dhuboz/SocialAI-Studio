import React, { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  FlaskConical,
  Globe2,
  Hash,
  Image,
  Loader2,
  Megaphone,
  MousePointerClick,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type {
  LearningSignal,
  LearningSummary,
  ReachAudienceSegment,
  ReachProfile,
} from '../services/db';

interface WhatsWorkingPanelProps {
  clientId?: string | null;
}

interface WhatsWorkingSummaryProps {
  summary: LearningSummary;
  profile: ReachProfile | null;
  segments: ReachAudienceSegment[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signalValue(signal: LearningSignal): string {
  if (signal.variableKey === 'posting_hour') {
    const hour = Number(signal.variableValue);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      const displayHour = hour % 12 || 12;
      return `${displayHour}:00 ${hour >= 12 ? 'pm' : 'am'}`;
    }
  }
  if (signal.variableKey === 'weekday') {
    const day = Number(signal.variableValue);
    if (Number.isInteger(day) && day >= 0 && day < WEEKDAYS.length) return WEEKDAYS[day];
  }
  if (signal.variableKey === 'media_format') {
    const labels: Record<string, string> = {
      image: 'Image posts',
      video: 'Video posts',
      reel: 'Reels',
      generated_image: 'Generated images',
      approved_asset: 'Approved brand images',
      text: 'Text posts',
    };
    return labels[signal.variableValue] ?? titleCase(signal.variableValue);
  }
  return titleCase(signal.variableValue);
}

function signalCategory(signal: LearningSignal): string {
  if (signal.variableKey === 'posting_hour' || signal.variableKey === 'weekday') return 'Posting window';
  if (signal.variableKey === 'media_format') return 'Media format';
  return titleCase(signal.variableKey);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date unavailable';
}

const EvidenceGap: React.FC<{ icon: React.ElementType; label: string }> = ({ icon: Icon, label }) => (
  <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3.5">
    <div className="flex items-center gap-2 text-white/55">
      <Icon size={13} />
      <p className="text-[11px] font-bold">{label}</p>
    </div>
    <p className="mt-2 text-[11px] text-white/30">Not enough evidence yet</p>
  </div>
);

const SignalCard: React.FC<{ signal: LearningSignal }> = ({ signal }) => {
  const positive = signal.effect > 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={`rounded-xl border p-3.5 ${
      positive
        ? 'border-emerald-400/15 bg-emerald-500/[0.04]'
        : 'border-rose-400/15 bg-rose-500/[0.04]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/30">
            {signalCategory(signal)}
          </p>
          <p className="mt-1 text-sm font-black text-white/85">{signalValue(signal)}</p>
        </div>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          positive ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
        }`}>
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/40">
        <span>{Math.round(signal.confidence * 100)}% confidence</span>
        <span>{signal.sampleCount} post{signal.sampleCount === 1 ? '' : 's'}</span>
        <span>{signal.evidenceKind === 'experiment' ? 'Isolated experiment' : 'Observed association'}</span>
      </div>
      <p className="mt-2 text-[10px] text-white/25">Updated {formatDate(signal.freshnessAt)}</p>
    </div>
  );
};

export const WhatsWorkingSummary: React.FC<WhatsWorkingSummaryProps> = ({
  summary,
  profile,
  segments,
}) => {
  const strong = summary.signals.filter((signal) => signal.effect > 0);
  const weak = summary.signals.filter((signal) => signal.effect < 0);
  const latest = [...summary.signals]
    .sort((left, right) => Date.parse(right.freshnessAt) - Date.parse(left.freshnessAt))
    .slice(0, 3);
  const noMeasuredEvidence = summary.signals.length === 0 && summary.outcomes.length === 0;
  const predictedOffers = [...new Set(segments.flatMap((segment) => segment.suitableOffers))];

  return (
    <section className="glass-card overflow-hidden rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <BarChart3 size={17} />
          </div>
          <div>
            <p className="text-sm font-black text-white">What's working</p>
            <p className="mt-0.5 text-[11px] text-white/35">
              Measured account learning, kept separate from predictions
            </p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
          {summary.outcomes.length} recent outcome{summary.outcomes.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-5 p-5">
        {noMeasuredEvidence && (
          <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-4 py-3">
            <div className="flex items-start gap-2.5">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-amber-300" />
              <div>
                <p className="text-xs font-bold text-amber-100/80">Learning safely from published results</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/35">
                  No measured winners or weak spots yet. The app will show evidence only after real outcomes arrive.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <ArrowUpRight size={13} className="text-emerald-300" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Strong signals</p>
            </div>
            <div className="space-y-2.5">
              {strong.length > 0
                ? strong.map((signal) => <SignalCard key={`${signal.objective}:${signal.variableKey}:${signal.variableValue}`} signal={signal} />)
                : <p className="rounded-xl border border-white/[0.06] bg-black/10 p-4 text-[11px] text-white/30">No positive measured signals yet.</p>}
            </div>
          </div>
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <ArrowDownRight size={13} className="text-rose-300" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Weak signals to avoid</p>
            </div>
            <div className="space-y-2.5">
              {weak.length > 0
                ? weak.map((signal) => <SignalCard key={`${signal.objective}:${signal.variableKey}:${signal.variableValue}`} signal={signal} />)
                : <p className="rounded-xl border border-white/[0.06] bg-black/10 p-4 text-[11px] text-white/30">No weak measured signals yet.</p>}
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-white/40">Evidence still being built</p>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <EvidenceGap icon={Target} label="Topic performance" />
            <EvidenceGap icon={Megaphone} label="Offer performance" />
            <EvidenceGap icon={MousePointerClick} label="CTA performance" />
            <EvidenceGap icon={Hash} label="Hashtag performance" />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
            <div className="flex items-center gap-2 text-sky-300">
              <Users size={14} />
              <p className="text-[11px] font-bold uppercase tracking-wider">Predicted audiences</p>
            </div>
            <div className="mt-3 space-y-3">
              {segments.length > 0 ? segments.map((segment) => (
                <div key={segment.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-xs font-bold text-white/75">{segment.label}</p>
                    <span className="text-[9px] text-sky-200/55">Predicted audience</span>
                  </div>
                  <p className="mt-1 text-[10px] text-white/35">{Math.round(segment.confidence * 100)}% confidence</p>
                </div>
              )) : <p className="text-[11px] text-white/30">No reviewed audience prediction yet.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
            <div className="flex items-center gap-2 text-emerald-300">
              <Globe2 size={14} />
              <p className="text-[11px] font-bold uppercase tracking-wider">Geographic focus</p>
            </div>
            {profile ? (
              <div className="mt-3 text-[11px] text-white/45">
                <p className="font-bold text-white/75">
                  {profile.baseLocation.locality}, {profile.baseLocation.region}
                </p>
                <p className="mt-1">
                  {profile.serviceArea.radiusKm == null ? 'Reviewed service areas' : `${profile.serviceArea.radiusKm} km service radius`}
                </p>
                <p className="mt-1">{profile.serviceArea.included.join(', ') || 'No included areas recorded'}</p>
              </div>
            ) : <p className="mt-3 text-[11px] text-white/30">No reviewed geographic profile yet.</p>}
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
            <div className="flex items-center gap-2 text-amber-300">
              <Megaphone size={14} />
              <p className="text-[11px] font-bold uppercase tracking-wider">Predicted offer fit</p>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-white/45">
              {predictedOffers.length > 0 ? predictedOffers.join(', ') : 'No reviewed offer prediction yet.'}
            </p>
            <p className="mt-2 text-[9px] text-white/25">Planning guidance, not measured performance.</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-black/10 p-4">
          <div className="flex items-center gap-2 text-white/55">
            <Clock3 size={13} />
            <p className="text-[11px] font-bold uppercase tracking-wider">Recent changes</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-[10px] text-white/40">
              {summary.profile
                ? `Profile version ${summary.profile.version} created ${formatDate(summary.profile.createdAt)}`
                : 'No learning profile version yet'}
            </p>
            {latest.map((signal) => (
              <p key={`recent:${signal.objective}:${signal.variableKey}:${signal.variableValue}`} className="text-[10px] text-white/40">
                {signalValue(signal)} updated {formatDate(signal.freshnessAt)}
              </p>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-violet-400/15 bg-violet-500/[0.04] px-3.5 py-3">
          <FlaskConical size={13} className="mt-0.5 shrink-0 text-violet-300" />
          <p className="text-[10px] leading-relaxed text-violet-100/55">
            Associations are not proof of causation. Only items marked Isolated experiment were separated from normal posting variables.
          </p>
        </div>
      </div>
    </section>
  );
};

export const WhatsWorkingPanel: React.FC<WhatsWorkingPanelProps> = ({ clientId = null }) => {
  const db = useDb();
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [profile, setProfile] = useState<ReachProfile | null>(null);
  const [segments, setSegments] = useState<ReachAudienceSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      db.getLearningSummary(clientId),
      db.getReachProfile(clientId),
    ]).then(([learning, reach]) => {
      if (cancelled) return;
      setSummary(learning);
      setProfile(reach.profile);
      setSegments(reach.segments);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Learning evidence could not be loaded');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [db, clientId]);

  if (loading) {
    return (
      <div className="glass-card flex min-h-40 items-center justify-center rounded-2xl border border-white/[0.06]">
        <Loader2 size={18} className="animate-spin text-cyan-300" />
        <span className="ml-2 text-xs text-white/35">Loading measured learning...</span>
      </div>
    );
  }
  if (error || !summary) {
    return (
      <div className="glass-card rounded-2xl border border-rose-400/15 p-5">
        <p className="text-xs font-bold text-rose-300">Learning evidence is temporarily unavailable</p>
        <p className="mt-1 text-[11px] text-white/35">{error ?? 'No learning response was returned.'}</p>
      </div>
    );
  }
  return <WhatsWorkingSummary summary={summary} profile={profile} segments={segments} />;
};
