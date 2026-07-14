import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  Loader2,
  MapPin,
  Pencil,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useDb } from '../hooks/useDb';
import type {
  OrganicReachPlatform,
  ReachAudienceSegment,
  ReachProfile,
  ReachProfileDraft,
} from '../services/db';

interface ReachProfilePanelProps {
  clientId?: string | null;
}

interface ReachProfileSummaryProps {
  profile: ReachProfile;
  segments: ReachAudienceSegment[];
  busy: boolean;
  onEdit: () => void;
  onConfirmProfile: () => void;
  onPredictSegments: () => void;
  onConfirmSegment: (segmentId: string) => void;
}

const DEFAULT_DRAFT: ReachProfileDraft = {
  timezone: 'Australia/Brisbane',
  baseLocation: { country: 'Australia', region: 'Queensland', locality: '' },
  serviceArea: { radiusKm: 40, included: [] },
  excludedLocations: [],
  platforms: ['facebook', 'instagram'],
};

function listText(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

function parseList(value: string): string[] {
  return [...new Set(value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function draftFromProfile(profile: ReachProfile): ReachProfileDraft {
  return {
    timezone: profile.timezone,
    baseLocation: { ...profile.baseLocation },
    serviceArea: {
      radiusKm: profile.serviceArea.radiusKm,
      included: [...profile.serviceArea.included],
    },
    excludedLocations: [...profile.excludedLocations],
    platforms: [...profile.platforms],
    cadence: profile.cadence ? { ...profile.cadence } : undefined,
  };
}

function platformLabel(platform: OrganicReachPlatform): string {
  return platform === 'facebook' ? 'Facebook' : 'Instagram';
}

export const ReachProfileSummary: React.FC<ReachProfileSummaryProps> = ({
  profile,
  segments,
  busy,
  onEdit,
  onConfirmProfile,
  onPredictSegments,
  onConfirmSegment,
}) => {
  const confirmed = profile.confirmationStatus === 'confirmed';
  return (
    <div className="glass-card overflow-hidden rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
            <Globe2 size={17} />
          </div>
          <div>
            <p className="text-sm font-black text-white">Organic reach profile</p>
            <p className="mt-0.5 text-[11px] text-white/35">
              {confirmed ? `Confirmed version ${profile.version}` : `Proposed version ${profile.version}`}
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
          confirmed
            ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
            : 'border-amber-400/25 bg-amber-500/10 text-amber-300'
        }`}>
          {confirmed ? 'Confirmed' : 'Review required'}
        </span>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ProfileFact
            label="Base location"
            value={`${profile.baseLocation.locality}, ${profile.baseLocation.region}, ${profile.baseLocation.country}`}
          />
          <ProfileFact label="Timezone" value={profile.timezone} />
          <ProfileFact
            label="Service radius"
            value={profile.serviceArea.radiusKm == null ? 'Defined areas only' : `${profile.serviceArea.radiusKm} km`}
          />
          <ProfileFact
            label="Platforms"
            value={profile.platforms.map(platformLabel).join(' + ')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <AreaList label="Included areas" values={profile.serviceArea.included} tone="emerald" />
          <AreaList label="Excluded areas" values={profile.excludedLocations} tone="rose" />
        </div>

        <div className="rounded-xl border border-sky-400/15 bg-sky-500/[0.04] px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-sky-300" />
            <p className="text-[11px] leading-relaxed text-sky-100/60">
              Reach advice is read-only shadow guidance. It cannot change scheduling or publishing.
            </p>
          </div>
        </div>

        {confirmed && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-white/75">Predicted commercial audiences</p>
                <p className="text-[10px] text-white/30">Broad buying contexts only. Protected traits are blocked.</p>
              </div>
              <button
                type="button"
                onClick={onPredictSegments}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-300 transition hover:bg-amber-500/15 disabled:opacity-40"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {segments.length ? 'Refresh prediction' : 'Predict audiences'}
              </button>
            </div>
            {segments.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {segments.map((segment) => (
                  <div key={segment.id} className="rounded-xl border border-white/[0.07] bg-black/15 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-bold text-white/75">{segment.label}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                          {segment.needs.join(', ') || 'Commercial intent pending review'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[9px] font-semibold text-white/25">
                        {Math.round(segment.confidence * 100)}% confidence
                      </span>
                    </div>
                    <div className="mt-2.5">
                      {segment.status === 'confirmed' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300">
                          <CheckCircle2 size={10} /> Confirmed audience
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onConfirmSegment(segment.id)}
                          disabled={busy}
                          className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300 transition hover:bg-emerald-500/15 disabled:opacity-40"
                        >
                          Confirm audience
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.06] pt-4">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-white/55 transition hover:text-white disabled:opacity-40"
          >
            <Pencil size={11} /> {confirmed ? 'Create updated version' : 'Edit proposal'}
          </button>
          {!confirmed && (
            <button
              type="button"
              onClick={onConfirmProfile}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 py-2 text-[11px] font-black text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Confirm reviewed profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const ReachProfilePanel: React.FC<ReachProfilePanelProps> = ({ clientId = null }) => {
  const db = useDb();
  const [profile, setProfile] = useState<ReachProfile | null>(null);
  const [segments, setSegments] = useState<ReachAudienceSegment[]>([]);
  const [draft, setDraft] = useState<ReachProfileDraft>(DEFAULT_DRAFT);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    db.getReachProfile(clientId)
      .then((setup) => {
        if (cancelled) return;
        setProfile(setup.profile);
        setSegments(setup.segments);
        if (setup.profile) setDraft(draftFromProfile(setup.profile));
        setEditing(!setup.profile);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Reach profile could not be loaded');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [db, clientId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Reach setup could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const saveProposal = () => run(async () => {
    const proposed = await db.proposeReachProfile({ ...draft, clientId });
    setProfile(proposed);
    setSegments([]);
    setEditing(false);
  });

  const confirmProfile = () => profile && run(async () => {
    const confirmed = await db.confirmReachProfile(profile.id, clientId);
    setProfile(confirmed);
    setSegments([]);
    setDraft(draftFromProfile(confirmed));
  });

  const predictSegments = () => run(async () => {
    setSegments(await db.proposeReachSegments(clientId));
  });

  const confirmSegment = (segmentId: string) => run(async () => {
    await db.confirmReachSegment(segmentId, clientId);
    setSegments((current) => current.map((segment) => (
      segment.id === segmentId ? { ...segment, status: 'confirmed' } : segment
    )));
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-xs text-white/35">
        <Loader2 size={13} className="animate-spin text-emerald-300" /> Loading organic reach profile...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/[0.07] px-3 py-2.5 text-[11px] text-rose-200/80">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {editing ? (
        <ReachProfileEditor
          draft={draft}
          busy={busy}
          hasExistingProfile={Boolean(profile)}
          onChange={setDraft}
          onCancel={() => {
            if (profile) setDraft(draftFromProfile(profile));
            setEditing(false);
          }}
          onSave={saveProposal}
        />
      ) : profile ? (
        <ReachProfileSummary
          profile={profile}
          segments={segments}
          busy={busy}
          onEdit={() => setEditing(true)}
          onConfirmProfile={confirmProfile}
          onPredictSegments={predictSegments}
          onConfirmSegment={confirmSegment}
        />
      ) : null}
    </div>
  );
};

const ProfileFact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
    <p className="text-[9px] font-bold uppercase tracking-wider text-white/25">{label}</p>
    <p className="mt-1 text-[11px] font-semibold text-white/65">{value}</p>
  </div>
);

const AreaList: React.FC<{
  label: string;
  values: string[];
  tone: 'emerald' | 'rose';
}> = ({ label, values, tone }) => (
  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
    <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-white/25">{label}</p>
    <div className="flex flex-wrap gap-1.5">
      {values.length ? values.map((value) => (
        <span
          key={value}
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            tone === 'emerald'
              ? 'border-emerald-400/15 bg-emerald-500/[0.07] text-emerald-200/70'
              : 'border-rose-400/15 bg-rose-500/[0.07] text-rose-200/70'
          }`}
        >
          {value}
        </span>
      )) : <span className="text-[10px] text-white/25">None</span>}
    </div>
  </div>
);

const ReachProfileEditor: React.FC<{
  draft: ReachProfileDraft;
  busy: boolean;
  hasExistingProfile: boolean;
  onChange: (draft: ReachProfileDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}> = ({ draft, busy, hasExistingProfile, onChange, onCancel, onSave }) => {
  const updateBase = (field: keyof ReachProfile['baseLocation'], value: string) => {
    onChange({ ...draft, baseLocation: { ...draft.baseLocation, [field]: value } });
  };
  const togglePlatform = (platform: OrganicReachPlatform) => {
    const current = draft.platforms ?? [];
    onChange({
      ...draft,
      platforms: current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    });
  };

  return (
    <div className="glass-card rounded-2xl border border-amber-400/15 bg-amber-500/[0.025] p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
          <MapPin size={17} />
        </div>
        <div>
          <p className="text-sm font-black text-white">Review organic reach details</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
            Save creates a proposed version. Nothing is used until you confirm it.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReachInput label="Locality" value={draft.baseLocation.locality} onChange={(value) => updateBase('locality', value)} />
        <ReachInput label="State / region" value={draft.baseLocation.region} onChange={(value) => updateBase('region', value)} />
        <ReachInput label="Country" value={draft.baseLocation.country} onChange={(value) => updateBase('country', value)} />
        <ReachInput label="Timezone" value={draft.timezone} onChange={(value) => onChange({ ...draft, timezone: value })} />
        <ReachInput
          label="Radius (km)"
          type="number"
          value={draft.serviceArea.radiusKm == null ? '' : String(draft.serviceArea.radiusKm)}
          onChange={(value) => onChange({
            ...draft,
            serviceArea: {
              ...draft.serviceArea,
              radiusKm: value === '' ? null : Math.max(0, Number(value)),
            },
          })}
        />
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/30">Platforms</p>
          <div className="flex h-[38px] items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3">
            {(['facebook', 'instagram'] as OrganicReachPlatform[]).map((platform) => (
              <label key={platform} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/55">
                <input
                  type="checkbox"
                  checked={(draft.platforms ?? []).includes(platform)}
                  onChange={() => togglePlatform(platform)}
                  className="accent-emerald-500"
                />
                {platformLabel(platform)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ReachTextArea
          label="Included service areas"
          hint="Comma separated"
          value={listText(draft.serviceArea.included)}
          onChange={(value) => onChange({
            ...draft,
            serviceArea: { ...draft.serviceArea, included: parseList(value) },
          })}
        />
        <ReachTextArea
          label="Excluded areas"
          hint="Never target these locations"
          value={listText(draft.excludedLocations)}
          onChange={(value) => onChange({ ...draft, excludedLocations: parseList(value) })}
        />
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-white/[0.06] pt-4">
        {hasExistingProfile && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-bold text-white/45 transition hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/15 px-3 py-2 text-[11px] font-black text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
          Create reviewed proposal
        </button>
      </div>
    </div>
  );
};

const ReachInput: React.FC<{
  label: string;
  value: string;
  type?: 'text' | 'number';
  onChange: (value: string) => void;
}> = ({ label, value, type = 'text', onChange }) => (
  <label className="space-y-1.5">
    <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-xs text-white outline-none transition focus:border-emerald-400/35"
    />
  </label>
);

const ReachTextArea: React.FC<{
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, hint, value, onChange }) => (
  <label className="space-y-1.5">
    <span className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{label}</span>
      <span className="text-[9px] text-white/20">{hint}</span>
    </span>
    <textarea
      rows={2}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-xs text-white outline-none transition focus:border-emerald-400/35"
    />
  </label>
);
