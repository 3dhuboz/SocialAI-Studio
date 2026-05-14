/**
 * SocialAI Studio — Poster Maker Brand Kit Editor.
 *
 * Inline collapsible editor for the active workspace's brand kit. Edits
 * palette (11 swatches), voice (register + signature + banned phrases),
 * QR defaults, and the full preset CRUD (add / edit / reorder / remove
 * + "reset to compiled defaults").
 *
 * Reads + writes via `useBrandKit()` — the context handles fetch on
 * mount + workspace switch, applies overrides to `BASE_BRAND_KIT`, and
 * persists via the worker. No localStorage, no direct API calls here.
 *
 * Differs from the hughesysque-origin editor in three ways:
 *   1. No "newer-on-server" sync banner — context re-fetches on
 *      workspace switch so divergence can't happen at the editor layer.
 *   2. No window.location.reload() after save — context is reactive, the
 *      whole PosterManager subtree re-renders with the new kit.
 *   3. No localStorage helpers — overrides are workspace-scoped server
 *      state, not per-device.
 */

import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Palette, ChevronDown, ChevronUp, Check, RotateCcw, AlertCircle, Loader2,
  Plus, ArrowUp, ArrowDown, Trash2,
} from 'lucide-react';
import { useBrandKit } from '../contexts/BrandKitContext';
import type {
  PosterBrandKit, PosterPreset, BrandKitOverrides,
} from '../utils/posterBrandKit';

// ── Shared chrome ──────────────────────────────────────────────────────────
//
// Mirrors the input styling pattern from PosterManager.tsx — colours come
// from CSS variables the parent page sets at the root, layout-only Tailwind
// utilities here. Keeps the editor visually consistent with the rest of the
// Poster Maker without a circular dep on the page module.

const inputCls =
  'w-full px-3 py-2 rounded-md text-white text-sm placeholder-gray-600 focus:outline-none transition-colors ' +
  'bg-[color:var(--pm-input-bg)] border border-[color:var(--pm-input-border)] focus:border-[color:var(--pm-focus-border)]';

function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</span>
        {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/** Hex → rgba() for surface tinting. Copy of the PosterManager helper. */
function withHexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

interface BrandKitEditorProps {
  /** Brand-coloured inline styles for buttons + accents. Passed by PosterManager
   *  so the editor inherits the same accent treatment as everywhere else. */
  primary: CSSProperties;
  primaryFg: CSSProperties;
}

export function BrandKitEditor({ primary, primaryFg }: BrandKitEditorProps) {
  const { baseKit, activeKit, overrides, loading, error, save, reset } = useBrandKit();

  const [expanded, setExpanded] = useState(false);

  // Local edit state — initialised from the workspace's current overrides
  // (NOT from activeKit) so unchanged fields stay blank in storage and the
  // admin always sees the BASE kit defaults as placeholders.
  const [paletteEdits, setPaletteEdits] = useState<Partial<PosterBrandKit['palette']>>(overrides.palette || {});
  const [voiceEdits, setVoiceEdits] = useState<Partial<NonNullable<PosterBrandKit['voice']>>>(overrides.voice || {});
  const [defaultsEdits, setDefaultsEdits] = useState<NonNullable<BrandKitOverrides['defaults']>>(overrides.defaults || {});

  // Presets are total-replace, not deep-merge. Three states:
  //   - presetsOverriding = false: list is just a working display copy of
  //     base.presets; save() won't include presets in the override blob.
  //   - presetsOverriding = true: list is the workspace's own; save() writes
  //     it verbatim into overrides.presets.
  const [presetsOverriding, setPresetsOverriding] = useState(overrides.presets !== undefined);
  const [presetsList, setPresetsList] = useState<PosterPreset[]>(
    overrides.presets ?? activeKit.presets ?? [],
  );
  const [expandedPreset, setExpandedPreset] = useState<number | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Mutators ─────────────────────────────────────────────────────────────
  const setPaletteKey = (key: keyof PosterBrandKit['palette'], value: string) => {
    setPaletteEdits(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const setVoiceKey = <K extends keyof NonNullable<PosterBrandKit['voice']>>(
    key: K, value: NonNullable<PosterBrandKit['voice']>[K],
  ) => {
    setVoiceEdits(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const markPresetsDirty = () => { setPresetsOverriding(true); setDirty(true); };
  const updatePresetMeta = (idx: number, patch: Partial<Pick<PosterPreset, 'label' | 'description'>>) => {
    setPresetsList(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
    markPresetsDirty();
  };
  const updatePresetCopy = (idx: number, patch: Partial<PosterPreset['copy']>) => {
    setPresetsList(prev => prev.map((p, i) => (i === idx ? { ...p, copy: { ...p.copy, ...patch } } : p)));
    markPresetsDirty();
  };
  const movePreset = (idx: number, dir: -1 | 1) => {
    setPresetsList(prev => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setExpandedPreset(cur => (cur === idx ? idx + dir : cur === idx + dir ? idx : cur));
    markPresetsDirty();
  };
  const removePreset = (idx: number) => {
    const target = presetsList[idx];
    if (!confirm(`Delete the "${target?.label || 'untitled'}" preset? This can't be undone unless you reset to compiled defaults.`)) return;
    setPresetsList(prev => prev.filter((_, i) => i !== idx));
    setExpandedPreset(null);
    markPresetsDirty();
  };
  const addPreset = () => {
    const id = `preset-${Date.now().toString(36)}`;
    setPresetsList(prev => [...prev, { id, label: 'New preset', description: '', copy: {} }]);
    setExpandedPreset(presetsList.length);
    markPresetsDirty();
  };
  const resetPresetsToBase = () => {
    if (!confirm('Reset every preset back to the compiled defaults? Your edits, additions and deletions to the preset list will be discarded.')) return;
    setPresetsList(baseKit.presets ?? []);
    setPresetsOverriding(false);
    setExpandedPreset(null);
    setDirty(true);
  };

  // ── Save / reset ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const next: BrandKitOverrides = {};
      if (Object.keys(paletteEdits).length)  next.palette  = paletteEdits;
      if (Object.keys(voiceEdits).length)    next.voice    = voiceEdits;
      if (Object.keys(defaultsEdits).length) next.defaults = defaultsEdits;
      // Total-replace semantics: only write presets if the admin took
      // ownership of the list. Otherwise the base kit's presets keep
      // showing (and any future updates to the base list propagate).
      if (presetsOverriding) next.presets = presetsList;

      await save(next);
      setDirty(false);
      // No reload needed — context is reactive; activeKit refreshes
      // immediately and every consumer re-renders.
    } catch {
      // Error surfaced via ctx.error in the banner below; leave dirty
      // so the admin can retry.
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (!confirm('Reset every brand-kit override back to the compiled defaults? This affects every poster you make in this workspace until you change it again.')) return;
    setSaving(true);
    try {
      await reset();
      // Re-seed local edit state from the now-cleared overrides.
      setPaletteEdits({});
      setVoiceEdits({});
      setDefaultsEdits({});
      setPresetsList(baseKit.presets ?? []);
      setPresetsOverriding(false);
      setExpandedPreset(null);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // The 11 palette keys in display order — same order as the type def.
  const paletteKeys = useMemo<(keyof PosterBrandKit['palette'])[]>(() => [
    'primary', 'primaryDark', 'accent',
    'background', 'backgroundDark', 'surface',
    'text', 'textMuted',
    'emberHot', 'emberWarm', 'emberGlow',
  ], []);

  return (
    <section
      className="mb-6 rounded-lg border border-gray-800"
      style={{ backgroundColor: withHexAlpha(activeKit.palette.surface, 0.3) }}
    >
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <Palette size={16} style={primaryFg} />
          <span className="text-sm font-bold uppercase tracking-wide text-white">
            Brand kit · colors + voice
          </span>
          <span className="text-[10px] text-gray-500 normal-case font-normal">
            {Object.keys(overrides).length > 0 ? 'workspace overrides active' : 'using compiled defaults'}
            {loading && ' · loading…'}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-2 space-y-5 border-t border-gray-800">
          <p className="text-xs text-gray-400 leading-relaxed">
            Tweak the brand colours, AI voice, and quick-start presets for every poster you make
            in this workspace. Changes apply immediately on save — no reload needed. Click reset
            to drop back to the compiled defaults at any time.
          </p>

          {error && (
            <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Palette ───────────────────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">Palette</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {paletteKeys.map(key => {
                const currentValue = paletteEdits[key] ?? activeKit.palette[key];
                return (
                  <label key={key} className="block">
                    <span className="text-[10px] text-gray-400 block mb-1 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={currentValue}
                        onChange={e => setPaletteKey(key, e.target.value)}
                        className="w-9 h-9 rounded border border-gray-700 bg-transparent cursor-pointer"
                        title={`${key} colour`}
                      />
                      <input
                        type="text"
                        value={currentValue}
                        onChange={e => {
                          const v = e.target.value.trim();
                          if (/^#[0-9a-fA-F]{6}$/.test(v) || v === '') setPaletteKey(key, v);
                        }}
                        placeholder={activeKit.palette[key]}
                        className={`${inputCls} flex-1 font-mono text-xs`}
                        spellCheck={false}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── Voice ─────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">AI voice</h3>
            <FormField label="Register" hint="One short descriptor of the brand's tone.">
              <input
                type="text"
                value={voiceEdits.register ?? activeKit.voice?.register ?? ''}
                onChange={e => setVoiceKey('register', e.target.value)}
                placeholder="e.g. friendly, professional, plain-spoken"
                className={inputCls}
              />
            </FormField>
            <FormField label="Signature phrases" hint="One per line. AI may use one per poster/caption.">
              <textarea
                value={(voiceEdits.signaturePhrases ?? activeKit.voice?.signaturePhrases ?? []).join('\n')}
                onChange={e => setVoiceKey('signaturePhrases', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                rows={4}
                placeholder={`OPEN FOR YOU\nLOCAL SINCE 2014\nREAL ARTISTRY`}
                className={`${inputCls} resize-y font-mono text-xs`}
              />
            </FormField>
            <FormField label="Banned phrases" hint="One per line. AI must NEVER produce these.">
              <textarea
                value={(voiceEdits.bannedPhrases ?? activeKit.voice?.bannedPhrases ?? []).join('\n')}
                onChange={e => setVoiceKey('bannedPhrases', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                rows={4}
                placeholder={`delicious\ntasty\nyummy\nelevate\nartisanal`}
                className={`${inputCls} resize-y font-mono text-xs`}
              />
            </FormField>
          </div>

          {/* ── Presets ───────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                Quick-start presets
                <span className="text-[10px] font-normal text-gray-600 normal-case tracking-normal ml-2">
                  ({presetsList.length} · {presetsOverriding ? 'custom' : 'compiled defaults'})
                </span>
              </h3>
              <button
                type="button"
                onClick={addPreset}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-200 hover:border-[color:var(--pm-focus-border)] hover:text-white transition-colors"
                title="Add a new preset chip"
              >
                <Plus size={11} /> Add preset
              </button>
            </div>
            <p className="text-[11px] text-gray-500 leading-snug">
              One-click templates shown as chips at the top of Quick Start. Each loads its
              headline / hashtags / hero prompt into the form so the admin can hit Download
              in two taps. Keep labels under 14 characters.
            </p>

            {presetsList.length === 0 && (
              <p className="text-xs text-gray-500 italic">
                No presets yet. Click <span className="font-semibold text-gray-300">Add preset</span> to seed your first chip.
              </p>
            )}

            <div className="space-y-2">
              {presetsList.map((preset, idx) => {
                const isExpanded = expandedPreset === idx;
                const hashtagsText = (preset.copy.hashtags ?? []).join(' ');
                return (
                  <div
                    key={`${preset.id}-${idx}`}
                    className="rounded-md border border-gray-800 bg-black/20"
                  >
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => setExpandedPreset(cur => (cur === idx ? null : idx))}
                        className="flex-1 text-left min-w-0"
                        aria-expanded={isExpanded}
                      >
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-sm font-semibold text-white truncate">
                            {preset.label || '(no label)'}
                          </span>
                          <span className="text-[10px] text-gray-500 truncate">
                            {preset.description || 'No description'}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => movePreset(idx, -1)}
                        disabled={idx === 0}
                        title="Move up"
                        className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePreset(idx, 1)}
                        disabled={idx === presetsList.length - 1}
                        title="Move down"
                        className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePreset(idx)}
                        title="Remove this preset"
                        className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedPreset(cur => (cur === idx ? null : idx))}
                        title={isExpanded ? 'Collapse' : 'Expand'}
                        className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="px-2.5 pb-3 pt-1 border-t border-gray-800 space-y-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <FormField label="Label" hint="≤14 chars reads best">
                            <input
                              type="text"
                              value={preset.label}
                              onChange={e => updatePresetMeta(idx, { label: e.target.value.slice(0, 24) })}
                              maxLength={24}
                              className={inputCls}
                            />
                          </FormField>
                          <FormField label="Description" hint="Tooltip on hover">
                            <input
                              type="text"
                              value={preset.description}
                              onChange={e => updatePresetMeta(idx, { description: e.target.value })}
                              className={inputCls}
                            />
                          </FormField>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <FormField label="Headline (optional)" hint="ALL-CAPS, max 28 chars">
                            <input
                              type="text"
                              value={preset.copy.headline ?? ''}
                              onChange={e => updatePresetCopy(idx, { headline: e.target.value ? e.target.value.slice(0, 40) : undefined })}
                              maxLength={40}
                              className={inputCls}
                            />
                          </FormField>
                          <FormField label="Subhead (optional)" hint="ALL-CAPS, max 22 chars">
                            <input
                              type="text"
                              value={preset.copy.subhead ?? ''}
                              onChange={e => updatePresetCopy(idx, { subhead: e.target.value ? e.target.value.slice(0, 30) : undefined })}
                              maxLength={30}
                              className={inputCls}
                            />
                          </FormField>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <FormField label="Trading hours (optional)">
                            <input
                              type="text"
                              value={preset.copy.pickupTime ?? ''}
                              onChange={e => updatePresetCopy(idx, { pickupTime: e.target.value || undefined })}
                              className={inputCls}
                            />
                          </FormField>
                          <FormField label="QR label (optional)">
                            <input
                              type="text"
                              value={preset.copy.qrLabel ?? ''}
                              onChange={e => updatePresetCopy(idx, { qrLabel: e.target.value ? e.target.value.slice(0, 24) : undefined })}
                              maxLength={24}
                              className={inputCls}
                            />
                          </FormField>
                        </div>
                        <FormField label="Body copy (optional)" hint="Sentence case, 1-3 sentences">
                          <textarea
                            value={preset.copy.body ?? ''}
                            onChange={e => updatePresetCopy(idx, { body: e.target.value || undefined })}
                            rows={2}
                            className={`${inputCls} resize-none`}
                          />
                        </FormField>
                        <FormField label="Hashtags (optional)" hint="Space-separated. # is optional.">
                          <input
                            type="text"
                            value={hashtagsText}
                            onChange={e => {
                              const v = e.target.value;
                              const tags = v.split(/\s+/).map(t => t.replace(/^#+/, '').trim()).filter(Boolean);
                              updatePresetCopy(idx, { hashtags: tags.length ? tags.map(t => `#${t}`) : undefined });
                            }}
                            className={inputCls}
                          />
                        </FormField>
                        <FormField label="AI hero prompt (optional)" hint="Phone-snapshot cues — keep it specific.">
                          <textarea
                            value={preset.copy.heroPrompt ?? ''}
                            onChange={e => updatePresetCopy(idx, { heroPrompt: e.target.value ? e.target.value.slice(0, 1000) : undefined })}
                            rows={3}
                            className={`${inputCls} resize-y text-xs`}
                          />
                        </FormField>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {presetsOverriding && (
              <button
                type="button"
                onClick={resetPresetsToBase}
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-white underline transition-colors"
              >
                <RotateCcw size={11} /> Reset presets to compiled defaults
              </button>
            )}
          </div>

          {/* ── QR defaults ──────────────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">QR code defaults</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <FormField label="Default QR URL" hint="Where the QR resolves to.">
                <input
                  type="text"
                  value={defaultsEdits.qrCodeUrl ?? activeKit.defaults.qrCodeUrl}
                  onChange={e => { setDefaultsEdits(prev => ({ ...prev, qrCodeUrl: e.target.value })); setDirty(true); }}
                  placeholder={activeKit.defaults.qrCodeUrl}
                  className={inputCls}
                />
              </FormField>
              <FormField label="Default QR label" hint="ALL-CAPS, under the QR on the poster.">
                <input
                  type="text"
                  value={defaultsEdits.qrCodeLabel ?? activeKit.defaults.qrCodeLabel}
                  onChange={e => { setDefaultsEdits(prev => ({ ...prev, qrCodeLabel: e.target.value.toUpperCase().slice(0, 24) })); setDirty(true); }}
                  placeholder={activeKit.defaults.qrCodeLabel}
                  maxLength={24}
                  className={inputCls}
                />
              </FormField>
            </div>
          </div>

          {/* ── Actions ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-800">
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              style={dirty && !saving ? primary : undefined}
              className={
                dirty && !saving
                  ? 'inline-flex items-center gap-2 px-4 py-2 rounded-lg hover:opacity-90 text-sm font-semibold transition-opacity'
                  : 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gray-800 text-gray-500 cursor-not-allowed'
              }
            >
              {saving ? (
                <><Loader2 size={14} className="animate-spin" /> Saving…</>
              ) : (
                <><Check size={14} /> Save brand kit</>
              )}
            </button>
            <button
              type="button"
              onClick={handleResetAll}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 disabled:opacity-50 transition-colors"
            >
              <RotateCcw size={13} /> Reset all to compiled defaults
            </button>
            <span className="text-[10px] text-gray-500 italic ml-auto">
              Saved per workspace. Applies immediately — no reload.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
