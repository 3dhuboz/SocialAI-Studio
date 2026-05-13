/**
 * SocialAI Studio — Poster Maker (ported from hughesysque).
 *
 * Workspace-scoped: D1 posters + R2 PNG bytes + brand-kit overrides are all
 * keyed on (Clerk userId × activeClientId). Steve in Agency mode switches
 * client → the BrandKitContext refetches and this component re-renders with
 * that workspace's gallery and kit.
 *
 * v1 port intentionally drops the inline Brand Kit Editor that ships in the
 * hughesysque origin (palette swatches, voice fields, preset CRUD). The
 * BrandKitContext.save() method is wired so adding the editor later is a
 * drop-in addition — base kit derived from client.config.ts ships sane
 * defaults until then.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC, RefObject, PointerEvent as ReactPointerEvent, CSSProperties, ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  Image as ImageIcon, Download, Loader2, Sparkles, AlertCircle,
  RotateCcw, Camera, Trash2, History, Check, QrCode, Wand2, Copy, MessageSquare,
  MessageCircle, Smartphone, Mail, Clock,
  Search, X, CalendarClock, CalendarX,
} from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useBrandKit } from '../contexts/BrandKitContext';
import {
  composeCookDayPoster,
  ensurePosterFontsLoaded,
  loadPosterImage,
  LAYOUT_LIMITS,
  POSTER_SIZES,
  type CookDayPosterInputs,
  type PosterLayout,
  type PosterSize,
} from '../utils/posterComposer';
import {
  buildPosterCopySystemPrompt,
  buildCaptionSystemPrompt,
  buildPostTimeSystemPrompt,
  type PosterPreset,
} from '../utils/posterBrandKit';
import {
  createPosterApi, posterImageUrl,
  type SavedPoster,
} from '../services/posters';
import {
  generatePosterArt, expandPosterBrief, generateSocialCaption, suggestPostTime,
  type PostTimeSuggestion,
} from '../services/posterAi';
import { BrandKitEditor } from '../components/BrandKitEditor';

interface PosterManagerProps {
  /** Active workspace id (null = agency owner's own workspace). Comes from App.tsx. */
  activeClientId: string | null;
  /** 'clerk' for the main site; 'portal' for white-label client portals. */
  authMode?: 'clerk' | 'portal';
}

interface FormState {
  headline: string;
  subhead: string;
  venue: string;
  date: string;          // display string e.g. "SAT 17 MAY"
  pickupTime: string;
  body: string;
  hashtagsText: string;  // comma-or-space-separated, parsed at render time
  heroPrompt: string;
  // QR code (Phase 2.1) — when enabled, an 80×80 black-on-white QR
  // appears on the right edge of the info panel, encoding qrUrl.
  qrEnabled: boolean;
  qrUrl: string;
  qrLabel: string;
}

// Format a Date as "WED 13 MAY" so it slots into the date pill cleanly.
function formatPosterDate(d: Date): string {
  const day  = d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
  const dnum = d.getDate();
  const mon  = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();
  return `${day} ${dnum} ${mon}`;
}

const PosterManager: FC<PosterManagerProps> = ({ activeClientId, authMode = 'clerk' }) => {
  // Active brand kit — flows from BrandKitProvider, which refetches on
  // workspace switch. KIT is reactive: when Steve switches client in
  // Agency mode, this component re-renders with the new workspace's kit
  // (palette, voice, presets, QR defaults).
  const { activeKit: KIT } = useBrandKit();

  // Workspace-aware API client. We hold getToken in a stable closure via
  // useAuth() and rebuild the api wrapper only when authMode flips —
  // activeClientId is passed per-call so a workspace switch never invalidates
  // an in-flight save.
  const { getToken } = useAuth();
  const stableGetToken = useCallback(async () => getToken(), [getToken]);
  const posterApi = useMemo(
    () => createPosterApi(stableGetToken, authMode),
    [stableGetToken, authMode],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initial form state — uses the active brand kit defaults. SocialAi
  // Studio doesn't have hughesysque's calendarEvents/nextCookDay smart-
  // default, so the form starts with KIT.defaults filled in and the user
  // edits venue/date for the specific announcement.
  const initialForm = useMemo<FormState>(() => ({
    headline:     KIT.defaults.headline,
    subhead:      KIT.defaults.subhead,
    venue:        KIT.brandName,
    date:         formatPosterDate(new Date()),
    pickupTime:   KIT.defaults.pickupTime,
    body:         '',
    hashtagsText: KIT.defaults.hashtags.join(' '),
    heroPrompt:   KIT.defaults.heroPrompt,
    qrEnabled:    Boolean(KIT.defaults.qrCodeUrl),
    qrUrl:        KIT.defaults.qrCodeUrl,
    qrLabel:      KIT.defaults.qrCodeLabel,
  }), [KIT]);

  const [form, setForm] = useState<FormState>(initialForm);
  // Re-seed defaults when the active brand kit changes (workspace switch).
  // Only fires when KIT identity changes — useBrandKit memoises so it's
  // stable across regular renders.
  useEffect(() => { setForm(initialForm); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [KIT]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // ── Hero image state ───────────────────────────────────────────────
  const [heroDataUrl, setHeroDataUrl] = useState<string | null>(null);
  const [heroImage, setHeroImage] = useState<HTMLImageElement | null>(null);
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [isGeneratingHero, setGeneratingHero] = useState(false);
  const [heroError, setHeroError] = useState<string | null>(null);

  // Load the brand logo once per workspace switch. logoUrl comes from the
  // active brand kit (derived from client.config.ts in BASE_BRAND_KIT, or
  // overridden per-workspace via the editor). Failing silently is fine —
  // the compositor draws a shortHandle monogram in that case.
  useEffect(() => {
    loadPosterImage(KIT.logoUrl).then(setLogoImage);
  }, [KIT.logoUrl]);

  // Materialise the hero data URL into an HTMLImageElement whenever it
  // changes. Drawing the poster needs the decoded image, not just the
  // bytes.
  useEffect(() => {
    if (!heroDataUrl) { setHeroImage(null); return; }
    let cancelled = false;
    loadPosterImage(heroDataUrl).then(img => {
      if (!cancelled) setHeroImage(img);
    });
    return () => { cancelled = true; };
  }, [heroDataUrl]);

  // ── Active size + per-size layout state ──────────────────────────
  // Macca makes the same poster for Instagram feed (Square), Story
  // (1080×1920 tall) and Facebook cover (1200×630 wide). Each size has
  // its own DEFAULT_LAYOUT and lives in its own coordinate space, so
  // dragging the headline in Square doesn't move it in Story.
  //
  // `size` is the currently-previewed format; switching the chip
  // re-renders the canvas at that size. `layouts` holds a Required-
  // PosterLayout for each size so per-size drag positions persist
  // across switches. Single Reset button resets the ACTIVE size only.
  const [size, setSize] = useState<PosterSize>(POSTER_SIZES.square);
  const [layouts, setLayouts] = useState<Record<PosterSize['id'], Required<PosterLayout>>>({
    square: POSTER_SIZES.square.defaultLayout,
    story:  POSTER_SIZES.story.defaultLayout,
    wide:   POSTER_SIZES.wide.defaultLayout,
  });
  const layout = layouts[size.id];

  /**
   * Drag/resize handler helper. Reads the CURRENT layout via the
   * setLayouts functional updater rather than the closed-over `layout`
   * variable.
   *
   * Why functional-updater (and not the simpler `updateLayoutPart(key,
   * patch)` style this file used pre-fix): drag/resize fires many
   * pointermoves per second. React doesn't always re-render between
   * them (especially under pointer capture, which can dispatch a
   * flurry of moves in one tick). If the callback reads
   * `layout.subhead.scale` from a stale closure, every move in that
   * burst computes `cur + delta` from the SAME base and ends up
   * writing the same value — the resize appears stuck.
   *
   * Reading from `prev[size.id][key]` here means each move sees the
   * latest scale/position the previous move just wrote, so deltas
   * actually accumulate. This was the "still can't resize" bug Macca
   * was hitting after PR #28.
   */
  const mutateLayoutPart = useCallback(<K extends keyof PosterLayout>(
    key: K,
    mutator: (cur: Required<PosterLayout>[K]) => Partial<Required<PosterLayout>[K]>,
  ) => {
    setLayouts(prev => {
      const currentSize = prev[size.id];
      const currentPart = currentSize[key] as Required<PosterLayout>[K];
      const patch = mutator(currentPart);
      return {
        ...prev,
        [size.id]: { ...currentSize, [key]: { ...(currentPart as any), ...patch } },
      };
    });
  }, [size]);

  const resetLayout = useCallback(() => {
    setLayouts(prev => ({ ...prev, [size.id]: size.defaultLayout }));
  }, [size]);

  // ── QR code state ─────────────────────────────────────────────────
  // The qrcode lib produces a data URL; we materialise it as an Image
  // so the synchronous canvas compositor can drawImage() it without
  // needing to await anything per render. Regenerated whenever the
  // user-typed URL changes (debounced by react's render batching, so
  // typing fast doesn't burn many CPU cycles).
  const [qrImage, setQrImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!form.qrEnabled || !form.qrUrl.trim()) {
      setQrImage(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(form.qrUrl.trim(), {
      // Slightly larger than the on-poster size (90px) so the rendered
      // PNG stays sharp at 1x display and at 2x retina.
      width: 240,
      // Quiet zone — the qrcode lib's default is 4 modules; we already
      // pad with our white plate, so we can shrink to 1 to maximise
      // module size at our small render target.
      margin: 1,
      // Medium error correction (15%) — enough to survive the film
      // grain we're NOT applying to QRs but also a print scuff or two.
      errorCorrectionLevel: 'M',
      color: {
        dark:  '#000000',
        light: '#ffffff',
      },
    })
      .then(dataUrl => loadPosterImage(dataUrl))
      .then(img => { if (!cancelled) setQrImage(img); })
      .catch(err => {
        console.error('[PosterManager] QR generation failed:', err);
        if (!cancelled) setQrImage(null);
      });
    return () => { cancelled = true; };
  }, [form.qrEnabled, form.qrUrl]);

  // ── Live preview redraw ────────────────────────────────────────────
  // Every form change or hero/logo/QR swap triggers a re-paint. The
  // canvas stays 1080×1080 intrinsically; CSS scales the display.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const inputs: CookDayPosterInputs = {
      headline: form.headline,
      subhead: form.subhead,
      venue: form.venue,
      date: form.date,
      pickupTime: form.pickupTime,
      body: form.body,
      hashtags: form.hashtagsText.split(/[,\s]+/).filter(Boolean),
      heroImage,
      logoImage,
      qrImage: form.qrEnabled ? qrImage : null,
      qrLabel: form.qrLabel,
    };
    composeCookDayPoster(canvas, inputs, KIT, size, layout).catch(err => {
      console.error('[PosterManager] compose failed:', err);
    });
  }, [form, heroImage, logoImage, qrImage, size, layout]);

  // Force-load the brand fonts on first mount so the first paint after
  // the page becomes visible isn't using a fallback typeface.
  useEffect(() => { ensurePosterFontsLoaded(KIT); }, []);

  // ── Saved-posters gallery state ───────────────────────────────────
  // Holds the most recent 30 posters by default. Refreshed after every
  // save / delete so the admin sees their own action reflected without
  // a manual page reload.
  const [gallery, setGallery] = useState<SavedPoster[]>([]);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Filter input for the gallery. Macca regularly has 30+ posters in the
  // gallery (one every cook day for a year is ~100) — scrolling for the
  // brisket one from last August stops being fun fast. Client-side
  // filtering on the already-loaded list keeps the round-trip count down
  // and the UI snappy.
  const [galleryFilter, setGalleryFilter] = useState('');
  const filteredGallery = useMemo(() => {
    const q = galleryFilter.trim().toLowerCase();
    if (!q) return gallery;
    return gallery.filter(p => {
      const c = (p.contentInputs || {}) as Record<string, any>;
      // Searchable haystack: headline + subhead + venue + date + body.
      // Hashtags are joined too so "lunchspecial" finds the catering pitch
      // even when the headline doesn't say it.
      const hay = [
        c.headline, c.subhead, c.venue, c.date, c.body,
        Array.isArray(c.hashtags) ? c.hashtags.join(' ') : '',
        p.brandName,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [gallery, galleryFilter]);

  // Split filtered gallery into "Upcoming" (future-scheduled, sorted by
  // post time ascending) + "All posters" (everything else, server's
  // newest-first order preserved). The split shows Macca his planned
  // post cadence at a glance instead of mixing future plans with
  // historical record.
  const { upcomingGallery, restGallery } = useMemo(() => {
    const now = Date.now();
    const upcoming: SavedPoster[] = [];
    const rest:     SavedPoster[] = [];
    // scheduledAt is an ISO string from the worker. Parse to ms for the
    // "is this in the future?" check and the ASC sort.
    const ms = (p: SavedPoster): number => (p.scheduledAt ? Date.parse(p.scheduledAt) : 0);
    for (const p of filteredGallery) {
      const t = ms(p);
      if (t && t > now) upcoming.push(p);
      else rest.push(p);
    }
    upcoming.sort((a, b) => ms(a) - ms(b));
    return { upcomingGallery: upcoming, restGallery: rest };
  }, [filteredGallery]);

  const refreshGallery = useCallback(async () => {
    setGalleryError(null);
    setGalleryLoading(true);
    try {
      const items = await posterApi.listPosters(activeClientId, { limit: 30 });
      setGallery(items);
    } catch (err: any) {
      setGalleryError(err?.message || 'Could not load past posters');
    } finally {
      setGalleryLoading(false);
    }
  }, [posterApi, activeClientId]);

  // Load the gallery on first mount AND when the workspace switches. Failures
  // surface as a small
  // inline notice rather than blocking the rest of the page — the
  // composer + form still work even if R2/D1 is misconfigured.
  useEffect(() => { refreshGallery(); }, [refreshGallery]);

  // ── Actions ────────────────────────────────────────────────────────
  const handleGenerateHero = async () => {
    setHeroError(null);
    setGeneratingHero(true);
    try {
      // generatePosterArt(), NOT generateMarketingImage() — the latter
      // forces "professional / cinematic / BBQ themed" onto every prompt
      // which is exactly the stock-photo aesthetic we're trying to dodge.
      // Pass the active size's aspect ratio so the AI frames the subject
      // for the format being previewed (square → 1:1 centre crop, story
      // → tall portrait, wide → left-half hero with room for a text
      // column). Without this every generation is 1:1 and looks squished
      // when the user switches to Story or Wide.
      const aspectRatio: '1:1' | '9:16' | '16:9' =
        size.id === 'story' ? '9:16' : size.id === 'wide' ? '16:9' : '1:1';
      const result = await generatePosterArt(stableGetToken, form.heroPrompt, aspectRatio, authMode);
      if (!result) {
        setHeroError(
          'AI image generation failed. Check the OpenRouter key in Settings — or upload your own photo instead (which will look better anyway).',
        );
        return;
      }
      setHeroDataUrl(result);
    } catch (err: any) {
      setHeroError(err?.message || 'Unknown error generating hero image');
    } finally {
      setGeneratingHero(false);
    }
  };

  const handleUploadHero = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setHeroError('That file isn\'t an image. Try a JPG or PNG.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setHeroDataUrl(reader.result);
    };
    reader.onerror = () => setHeroError('Could not read that file. Try a different one.');
    reader.readAsDataURL(file);
  };

  /** Build a download filename like "hughesys-que-2026-05-13-curtis-park-square-1080.png". */
  const filenameFor = useCallback((sz: PosterSize): string => {
    const stamp = new Date().toISOString().slice(0, 10);
    const brandSlug = KIT.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const venueSlug = form.venue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cook-day';
    return `${brandSlug}-${stamp}-${venueSlug}-${sz.shortLabel}.png`;
  }, [form.venue]);

  /** Build the form snapshot stored alongside the saved poster blob. */
  const buildSnapshot = useCallback((sz: PosterSize, ly: Required<PosterLayout>) => ({
    headline:   form.headline,
    subhead:    form.subhead,
    venue:      form.venue,
    date:       form.date,
    pickupTime: form.pickupTime,
    body:       form.body,
    hashtags:   form.hashtagsText.split(/[,\s]+/).filter(Boolean),
    heroPrompt: form.heroPrompt,
    heroDataUrl,
    qrEnabled:  form.qrEnabled,
    qrUrl:      form.qrUrl,
    qrLabel:    form.qrLabel,
    sizeId:     sz.id,
    layout:     ly,
  }), [form, heroDataUrl]);

  /** Trigger an immediate browser download for a blob with the given filename. */
  const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async blob => {
      if (!blob) return;

      // 1. Trigger the immediate download. User-perceived latency stays
      //    at zero — the save-to-gallery happens in parallel after.
      downloadBlob(blob, filenameFor(size));

      // 2. Persist a copy to R2 + D1 so the admin can re-download it
      //    later. Errors here don't disrupt the user — they got their
      //    PNG already; the gallery is a nice-to-have. Surface as a
      //    small notice instead of an alert.
      setSavingStatus('saving');
      setSaveError(null);
      try {
        // Capture the form + size + layout snapshot. Including sizeId
        // means "Use as base" can restore the user looking at the same
        // size they last downloaded.
        await posterApi.savePoster({
          blob,
          contentInputs: buildSnapshot(size, layout),
          brandName: KIT.brandName,
          clientId: activeClientId,
        });
        setSavingStatus('saved');
        refreshGallery();
        setTimeout(() => setSavingStatus(s => (s === 'saved' ? 'idle' : s)), 4000);
      } catch (err: any) {
        console.error('[PosterManager] save-to-gallery failed:', err);
        setSavingStatus('error');
        setSaveError(err?.message || 'Could not save to gallery — the PNG download still worked.');
      }
    }, 'image/png');
  };

  /**
   * Render the poster at every supported size in turn and trigger a
   * download for each. Uses a hidden off-DOM canvas so the visible
   * preview doesn't flash through three formats. The active size's
   * gallery save (R2 + D1) is skipped for this path — the gallery is
   * for ONE primary poster per cook day, not 3 copies of the same
   * thing in different aspect ratios.
   */
  const [isDownloadingAll, setDownloadingAll] = useState(false);
  const handleDownloadAll = useCallback(async () => {
    setDownloadingAll(true);
    try {
      const inputs: CookDayPosterInputs = {
        headline: form.headline,
        subhead: form.subhead,
        venue: form.venue,
        date: form.date,
        pickupTime: form.pickupTime,
        body: form.body,
        hashtags: form.hashtagsText.split(/[,\s]+/).filter(Boolean),
        heroImage,
        logoImage,
        qrImage: form.qrEnabled ? qrImage : null,
        qrLabel: form.qrLabel,
      };
      // Render each size into a temp canvas (kept off-DOM so the
      // visible preview doesn't repaint), then trigger a download for
      // its blob. Small delay between downloads avoids the browser
      // collapsing them into a single click-jacking-style prompt.
      for (const targetSize of [POSTER_SIZES.square, POSTER_SIZES.story, POSTER_SIZES.wide]) {
        const temp = document.createElement('canvas');
        await composeCookDayPoster(temp, inputs, KIT, targetSize, layouts[targetSize.id]);
        const blob = await new Promise<Blob | null>(resolve => temp.toBlob(resolve, 'image/png'));
        if (!blob) continue;
        downloadBlob(blob, filenameFor(targetSize));
        await new Promise(r => setTimeout(r, 400));
      }
    } catch (err: any) {
      console.error('[PosterManager] download-all failed:', err);
      alert(err?.message || 'Download-all failed — try the per-size buttons.');
    } finally {
      setDownloadingAll(false);
    }
  }, [form, heroImage, logoImage, qrImage, layouts, filenameFor]);

  /** Repopulate the form from a saved poster — the "use as base" flow. */
  const handleUseAsBase = useCallback(async (saved: SavedPoster) => {
    const c = (saved.contentInputs || {}) as Record<string, any>;
    setForm({
      headline:     c.headline   ?? '',
      subhead:      c.subhead    ?? '',
      venue:        c.venue      ?? '',
      date:         c.date       ?? '',
      pickupTime:   c.pickupTime ?? '',
      body:         c.body       ?? '',
      hashtagsText: Array.isArray(c.hashtags) ? c.hashtags.join(' ') : '',
      heroPrompt:   c.heroPrompt ?? KIT.defaults.heroPrompt,
      // QR fields gracefully default for older posters saved before the
      // QR feature shipped (their contentInputs JSON has no qr* keys).
      qrEnabled:    typeof c.qrEnabled === 'boolean' ? c.qrEnabled : true,
      qrUrl:        c.qrUrl      ?? KIT.defaults.qrCodeUrl,
      qrLabel:      c.qrLabel    ?? KIT.defaults.qrCodeLabel,
    });
    // Restore the saved layout into the SQUARE size's layout slot. Older
    // saved posters were all 1080×1080 (pre-multi-size feature), so their
    // layout JSON is in square-space coordinates. New posters that get
    // saved at story/wide size carry a `sizeId` field — when that's
    // present we restore into the matching slot. Either way, switch the
    // active size to match what was saved so "reuse" lands the user
    // looking at the same composition.
    const savedSizeId: PosterSize['id'] = (c.sizeId === 'story' || c.sizeId === 'wide') ? c.sizeId : 'square';
    const sizeForRestore = POSTER_SIZES[savedSizeId];
    const fallbackLayout = sizeForRestore.defaultLayout;
    setSize(sizeForRestore);
    if (c.layout && typeof c.layout === 'object') {
      const restored: Required<PosterLayout> = {
        subhead:       { ...fallbackLayout.subhead,       ...c.layout.subhead },
        headline:      { ...fallbackLayout.headline,      ...c.layout.headline },
        body:          { ...fallbackLayout.body,          ...c.layout.body },
        infoPanel:     { ...fallbackLayout.infoPanel,     ...c.layout.infoPanel },
        qrBlock:       { ...fallbackLayout.qrBlock,       ...c.layout.qrBlock },
        logo:          { ...fallbackLayout.logo,          ...c.layout.logo },
        hashtagFooter: { ...fallbackLayout.hashtagFooter, ...c.layout.hashtagFooter },
      };
      setLayouts(prev => ({ ...prev, [savedSizeId]: restored }));
    } else {
      setLayouts(prev => ({ ...prev, [savedSizeId]: fallbackLayout }));
    }
    // Re-hydrate the hero image too if we stashed the data URL in the snapshot.
    if (c.heroDataUrl) {
      setHeroDataUrl(c.heroDataUrl);
    } else if (saved.imageUrl) {
      // Fallback: use the saved poster's image as the hero. Looks
      // weird but better than nothing and the admin will re-upload.
      setHeroDataUrl(null);
    }
    // A restored gallery poster isn't a preset — clear the active chip
    // so the UI doesn't keep claiming a template is loaded.
    setActivePresetId(null);
    // Scroll to the top so the form is in view.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ── Quick start: turn a casual brief into form fields via LLM ─────
  // Macca types "back at curtis park sat morning, brisket and ribs,
  // 7-12, pre-orders open" and the LLM expands it into headline +
  // subhead + venue + date + pickupTime + body + hashtags + heroPrompt
  // in his voice. He then tweaks anything wrong and uploads his real
  // photo — much faster than starting from blank fields.
  const [brief, setBrief] = useState('');
  const [isExpanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [expandedFlash, setExpandedFlash] = useState(false);

  // ── Preset chips: one-click templates seeded from the brand kit ───
  // Each preset bundles copy seeds (headline, subhead, body, hashtags,
  // hero prompt, qr label) for a recurring poster shape — fastest path
  // to a working poster (one click vs the brief flow's typing + AI
  // round trip). The active chip tints to show "this preset is loaded",
  // and clears when the brief expander overwrites those same fields so
  // the UI doesn't lie.
  const presets = KIT.presets ?? [];
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const applyPreset = useCallback((preset: PosterPreset) => {
    const c = preset.copy;
    setForm(prev => ({
      ...prev,
      ...(c.headline   !== undefined ? { headline:     c.headline   } : null),
      ...(c.subhead    !== undefined ? { subhead:      c.subhead    } : null),
      ...(c.pickupTime !== undefined ? { pickupTime:   c.pickupTime } : null),
      ...(c.body       !== undefined ? { body:         c.body       } : null),
      ...(c.hashtags   !== undefined ? { hashtagsText: c.hashtags.join(' ') } : null),
      ...(c.heroPrompt !== undefined ? { heroPrompt:   c.heroPrompt } : null),
      ...(c.qrLabel    !== undefined ? { qrLabel:      c.qrLabel    } : null),
    }));
    setActivePresetId(preset.id);
    // Clear any stale brief-expand error — they're orthogonal paths and
    // we don't want a previous AI failure dimming the screen after a
    // successful preset click.
    setExpandError(null);
  }, []);

  const systemPrompt = useMemo(() => buildPosterCopySystemPrompt(KIT), []);
  const captionSystemPrompt = useMemo(() => buildCaptionSystemPrompt(KIT), []);
  const postTimeSystemPrompt = useMemo(() => buildPostTimeSystemPrompt(KIT), []);

  // ── Instagram / Facebook caption generation ───────────────────────
  // The poster is the image; this gives Macca the matching caption to
  // paste alongside it. Generated on-demand (button click) rather than
  // alongside every download so we don't burn an AI call he didn't
  // ask for. The caption text is editable in the textarea before he
  // copies — gives him a moment to tweak the AI's phrasing without
  // having to do it inside the IG app on his thumbs.
  const [caption, setCaption] = useState('');
  const [isCaptioning, setCaptioning] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [captionCopied, setCaptionCopied] = useState(false);

  const handleGenerateCaption = useCallback(async () => {
    setCaptionError(null);
    setCaptioning(true);
    try {
      const text = await generateSocialCaption(stableGetToken, {
        brandName:  KIT.brandName,
        headline:   form.headline.trim(),
        subhead:    form.subhead.trim() || undefined,
        venue:      form.venue.trim(),
        date:       form.date.trim(),
        pickupTime: form.pickupTime.trim() || undefined,
        body:       form.body.trim() || undefined,
        hashtags:   form.hashtagsText.split(/\s+/).map(s => s.trim()).filter(Boolean),
        qrUrl:      form.qrEnabled && form.qrUrl.trim() ? form.qrUrl.trim() : undefined,
      }, captionSystemPrompt, authMode);
      if (!text) {
        setCaptionError('AI returned nothing — try again, or write the caption yourself.');
        return;
      }
      setCaption(text);
      setCaptionCopied(false);
    } catch (err: any) {
      setCaptionError(err?.message || 'AI caption generation failed');
    } finally {
      setCaptioning(false);
    }
  }, [form, captionSystemPrompt]);

  // ── Best-time-to-post suggestion ──────────────────────────────────
  // After the poster is made, Macca often wonders "when should I drop
  // this?". This is a one-tap AI suggestion using AU-food-business
  // posting heuristics (lunch posts 2-3h before, weekend cooks announced
  // Friday morning, catering pitches Tuesday daytime, etc.) baked into
  // the system prompt, returned with a brand-voice reasoning line.
  // On-demand only — no auto-call.
  const [postTime, setPostTime] = useState<PostTimeSuggestion | null>(null);
  const [isSuggestingPostTime, setSuggestingPostTime] = useState(false);
  const [postTimeError, setPostTimeError] = useState<string | null>(null);

  const handleSuggestPostTime = useCallback(async () => {
    setPostTimeError(null);
    setSuggestingPostTime(true);
    try {
      const suggestion = await suggestPostTime(stableGetToken, {
        brandName:  KIT.brandName,
        headline:   form.headline.trim(),
        subhead:    form.subhead.trim() || undefined,
        venue:      form.venue.trim(),
        date:       form.date.trim(),
        pickupTime: form.pickupTime.trim() || undefined,
        body:       form.body.trim() || undefined,
      }, postTimeSystemPrompt, authMode);
      if (!suggestion) {
        setPostTimeError('AI returned nothing — try again.');
        return;
      }
      setPostTime(suggestion);
    } catch (err: any) {
      setPostTimeError(err?.message || 'AI post-time suggestion failed');
    } finally {
      setSuggestingPostTime(false);
    }
  }, [form, postTimeSystemPrompt]);

  const handleCopyCaption = useCallback(async () => {
    const text = caption.trim();
    if (!text) return;
    try {
      // Modern browsers' Clipboard API requires HTTPS or localhost,
      // which our admin always is, so we don't bother with the legacy
      // execCommand fallback. If clipboard write fails for any reason
      // (permission, ancient browser) we surface the error rather than
      // silently looking like the copy worked.
      await navigator.clipboard.writeText(text);
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 3000);
    } catch (err: any) {
      setCaptionError(err?.message || 'Could not copy — select the text manually.');
    }
  }, [caption]);

  const handleExpandBrief = useCallback(async () => {
    const text = brief.trim();
    if (!text) {
      setExpandError('Type a few words about the cook day first.');
      return;
    }
    setExpandError(null);
    setExpanding(true);
    try {
      const fields = await expandPosterBrief(stableGetToken, text, systemPrompt, authMode);
      if (!fields) {
        setExpandError('AI returned nothing — try rewording your brief.');
        return;
      }
      // Merge into the form. Any field the LLM omitted falls back to
      // what's already there (so a partial brief doesn't blank the
      // venue Macca already typed).
      setForm(prev => ({
        ...prev,
        headline:     fields.headline   ?? prev.headline,
        subhead:      fields.subhead    ?? prev.subhead,
        venue:        fields.venue      ?? prev.venue,
        date:         fields.date       ?? prev.date,
        pickupTime:   fields.pickupTime ?? prev.pickupTime,
        body:         fields.body       ?? prev.body,
        hashtagsText: fields.hashtags   ? fields.hashtags.join(' ') : prev.hashtagsText,
        heroPrompt:   fields.heroPrompt ?? prev.heroPrompt,
      }));
      // Brief expand and preset are mutually exclusive entry paths —
      // clear the active preset so the chip row stops claiming a
      // template is loaded when the AI has rewritten its fields.
      setActivePresetId(null);
      // Visual confirmation flash on the form fields.
      setExpandedFlash(true);
      setTimeout(() => setExpandedFlash(false), 2400);
    } catch (err: any) {
      setExpandError(err?.message || 'AI brief expansion failed');
    } finally {
      setExpanding(false);
    }
  }, [brief, systemPrompt]);

  /** Permanently delete a saved poster after a quick confirm. */
  const handleDeleteSaved = useCallback(async (id: string) => {
    if (!confirm('Delete this poster permanently? This cannot be undone.')) return;
    try {
      await posterApi.deletePoster(id);
      // Optimistically drop the row, then refresh from server for consistency.
      setGallery(g => g.filter(p => p.id !== id));
      refreshGallery();
    } catch (err: any) {
      alert(err?.message || 'Delete failed');
    }
  }, [refreshGallery]);

  /** Stamp (or clear) the post-to-socials schedule on a saved poster.
   *  Optimistically updates the gallery so the badge appears immediately
   *  without waiting for the round trip to D1.
   *
   *  scheduledAt is an ISO string (the worker stores it as TEXT — date
   *  arithmetic in the UI parses on read). null clears the schedule. */
  const handleScheduleSaved = useCallback(async (id: string, scheduledAt: string | null) => {
    setGallery(g => g.map(p => (p.id === id ? { ...p, scheduledAt } : p)));
    try {
      await posterApi.updatePosterSchedule(id, scheduledAt);
    } catch (err: any) {
      alert(err?.message || 'Could not update schedule');
      refreshGallery();
    }
  }, [posterApi, refreshGallery]);

  const handleResetHero = () => {
    setHeroDataUrl(null);
    setHeroImage(null);
    setHeroError(null);
  };

  // Brand-driven inline styles for the chrome. Using inline styles
  // rather than Tailwind classes here means the page rethemes with the
  // active brand kit and doesn't depend on the host app's Tailwind
  // config defining `bbq-*` tokens (other clients won't have those).
  // Neutral Tailwind utilities (gray-*, white, etc.) are still used
  // for layout — they exist in every Tailwind install.
  const styles = {
    primary:   { backgroundColor: KIT.palette.primary, color: '#fff' },
    primaryFg: { color: KIT.palette.primary },
    accent:    { backgroundColor: KIT.palette.accent, color: KIT.palette.background },
    accentSh:  { boxShadow: `0 10px 24px ${withHexAlpha(KIT.palette.accent, 0.2)}` },
    surface:   { backgroundColor: withHexAlpha(KIT.palette.surface, 0.4) },
    inputBg:   { backgroundColor: KIT.palette.surface, borderColor: '#374151' /* gray-700 */ },
  };

  // CSS variables drive the input chrome below — set on the page root
  // so all inputs/textareas inherit them via Tailwind arbitrary-value
  // utilities like `bg-[var(--pm-input-bg)]`. Changing the brand kit
  // changes the input look without touching any input markup.
  const cssVars = {
    ['--pm-input-bg']     : KIT.palette.surface,
    ['--pm-input-border'] : '#374151',
    ['--pm-focus-border'] : KIT.palette.primary,
  } as React.CSSProperties;

  return (
    <div className="max-w-7xl mx-auto" style={cssVars}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ImageIcon size={22} style={styles.primaryFg} />
          Posters
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Type what you want, AI fills the form, you tweak it and add your photo.
          Or skip the AI and edit the form directly — your call.
        </p>
      </header>

      {/* ── Brand Kit Editor ─────────────────────────────────────────
          Workspace-scoped editor — palette (11 swatches), voice
          (register + signature + banned phrases), full preset CRUD, and
          QR defaults. Collapsed by default. Saves to D1 via the
          BrandKitContext; activeKit updates reactively (no reload). */}
      <BrandKitEditor primary={styles.primary} primaryFg={styles.primaryFg} />

      {/* ── Quick start: free-text brief → LLM → fills the form ──────
          Macca's preferred entry point. He types the cook day in his
          own words ("back at curtis park sat morning, brisket and ribs,
          7-12, pre-orders open"); the LLM expands it into headline,
          subhead, venue, date, hours, body, hashtags, hero prompt —
          all in his voice. Then he edits anything wrong + uploads a
          real photo. The manual form below still works exactly as
          before for anyone who wants to skip this. */}
      <section
        className="mb-6 rounded-lg border border-gray-800 p-4 space-y-3"
        style={styles.surface}
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white flex items-center gap-2">
            <Wand2 size={14} style={styles.primaryFg} /> Quick start
          </h2>
          <span className="text-[10px] text-gray-500">
            Type a brief · AI fills form · you tweak + add photo · download
          </span>
        </div>

        <p className="text-xs text-gray-400 leading-relaxed">
          Tell me about the cook day in your own words. I'll fill in the headline,
          subhead, venue, date, hours, body copy, hashtags and a hero-photo prompt.
          Anything wrong? Edit it in the form below.
        </p>

        {/* ── Preset chips ────────────────────────────────────────────
            One-click templates seeded from the active brand kit. Sit
            above the brief textarea because they're the FASTER path
            (one click vs typing + AI round-trip). The brief flow below
            still works for everything not covered by a preset. */}
        {presets.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
              Or start from a template
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map(p => {
                const isActive = activePresetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    title={p.description}
                    style={isActive ? styles.primary : undefined}
                    className={
                      isActive
                        ? 'px-3 py-2 rounded-md text-xs font-semibold border border-transparent transition-colors'
                        : 'px-3 py-2 rounded-md text-xs font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-200 hover:border-[color:var(--pm-focus-border)] hover:text-white transition-colors'
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 italic leading-snug">
              Loads headline, subhead, hours, body, hashtags &amp; hero prompt for that
              kind of cook day. Tweak anything below before downloading.
            </p>
          </div>
        )}

        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={3}
          placeholder={`e.g. "back at curtis park sat morning, brisket and ribs, 7-12 till sold out, pre-orders open tonight"`}
          className={`${inputCls} resize-none`}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExpandBrief}
            disabled={isExpanding || !brief.trim()}
            style={styles.primary}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-opacity"
          >
            {isExpanding ? (
              <><Loader2 size={16} className="animate-spin" /> Filling form…</>
            ) : (
              <><Wand2 size={16} /> Fill the form for me</>
            )}
          </button>
          {expandedFlash && (
            <span className="text-xs text-green-500 inline-flex items-center gap-1.5">
              <Check size={14} /> Form populated — review &amp; edit below
            </span>
          )}
        </div>

        {expandError && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{expandError}</span>
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-[1fr_auto] gap-6">
        {/* ── Form column ── */}
        <div className="space-y-5">
          <FormField label="Headline" hint="Max 28 characters. Will render ALL-CAPS.">
            <input
              type="text"
              value={form.headline}
              onChange={e => update('headline', e.target.value.slice(0, 40))}
              maxLength={40}
              className={inputCls}
              placeholder={KIT.defaults.headline}
            />
          </FormField>

          <FormField label="Subhead" hint="Accent-colour tagline above the headline. Optional.">
            <input
              type="text"
              value={form.subhead}
              onChange={e => update('subhead', e.target.value.slice(0, 30))}
              maxLength={30}
              className={inputCls}
              placeholder={KIT.defaults.subhead}
            />
          </FormField>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Venue">
              <input
                type="text"
                value={form.venue}
                onChange={e => update('venue', e.target.value)}
                className={inputCls}
                placeholder={KIT.brandName}
              />
            </FormField>
            <FormField label="Date" hint="e.g. SAT 17 MAY">
              <input
                type="text"
                value={form.date}
                onChange={e => update('date', e.target.value)}
                className={inputCls}
                placeholder="SAT 17 MAY"
              />
            </FormField>
          </div>

          <FormField label="Trading hours" hint="e.g. 8AM-8PM or BREAKFAST 8-12, DINNER 5-8">
            <input
              type="text"
              value={form.pickupTime}
              onChange={e => update('pickupTime', e.target.value)}
              className={inputCls}
              placeholder={KIT.defaults.pickupTime}
            />
          </FormField>

          <FormField label="Body copy (optional)" hint="Max 3 lines. Sentence case is fine.">
            <textarea
              value={form.body}
              onChange={e => update('body', e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder={KIT.voice?.signaturePhrases?.[0] || 'A short tagline.'}
            />
          </FormField>

          <FormField label="Hashtags" hint="Space or comma separated. # is optional.">
            <input
              type="text"
              value={form.hashtagsText}
              onChange={e => update('hashtagsText', e.target.value)}
              className={inputCls}
            />
          </FormField>

          {/* QR code controls — defaults to ON pointing at the order page
              so customers can scan straight from a poster on Macca's
              truck or in his Instagram feed and land in the cart. */}
          <div className="rounded-lg border border-gray-800 p-4 space-y-3" style={styles.surface}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.qrEnabled}
                onChange={e => update('qrEnabled', e.target.checked)}
                className="mt-0.5 accent-current"
                style={{ accentColor: KIT.palette.primary }}
              />
              <div className="flex-1">
                <div className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
                  <QrCode size={14} /> QR code on poster
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Black-and-white QR sits on the right side of the info panel. Scans from
                  Instagram, printed posters, or the truck itself.
                </p>
              </div>
            </label>

            {form.qrEnabled && (
              <div className="space-y-3 pt-2 pl-7">
                <FormField label="QR target URL" hint="What scanning the code opens.">
                  <input
                    type="url"
                    value={form.qrUrl}
                    onChange={e => update('qrUrl', e.target.value)}
                    className={inputCls}
                    placeholder={KIT.defaults.qrCodeUrl}
                    inputMode="url"
                    autoComplete="url"
                  />
                </FormField>
                <FormField label="Label under QR" hint="Short, ALL-CAPS reads best.">
                  <input
                    type="text"
                    value={form.qrLabel}
                    onChange={e => update('qrLabel', e.target.value.slice(0, 24))}
                    maxLength={24}
                    className={inputCls}
                    placeholder={KIT.defaults.qrCodeLabel}
                  />
                </FormField>
              </div>
            )}
          </div>

          {/* Hero image controls — real photo is the default path; AI is
              the escape hatch. AI images still smell like AI no matter
              the prompt; a phone snap of the actual cook always wins. */}
          <div className="rounded-lg border border-gray-800 p-4 space-y-3" style={styles.surface}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Hero photo</h3>
              {heroImage && (
                <button
                  type="button"
                  onClick={handleResetHero}
                  className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1"
                >
                  <RotateCcw size={12} /> Remove
                </button>
              )}
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Best result: snap a quick photo of today's cook on your phone — even a
              messy iPhone shot of the brisket on the tray will look more real than
              the best AI render. Use AI as the backup when you don't have one handy.
            </p>

            {/* Primary path: upload your own photo */}
            <label
              style={styles.primary}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg hover:opacity-90 text-sm font-semibold cursor-pointer transition-opacity"
            >
              <Camera size={18} /> Upload your photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadHero(f);
                }}
              />
            </label>

            {/* Divider */}
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-gray-600">
              <div className="flex-1 h-px bg-gray-800" />
              or, if you're stuck
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            {/* Secondary path: AI generation */}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-white inline-flex items-center gap-1.5 select-none">
                <Sparkles size={14} /> Generate one with AI instead
              </summary>
              <div className="mt-3 space-y-3">
                <FormField label="What's in the shot?" hint="Be specific — generic prompts produce generic photos.">
                  <textarea
                    value={form.heroPrompt}
                    onChange={e => update('heroPrompt', e.target.value)}
                    rows={3}
                    className={`${inputCls} resize-none text-xs`}
                  />
                </FormField>
                <button
                  type="button"
                  onClick={handleGenerateHero}
                  disabled={isGeneratingHero}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                >
                  {isGeneratingHero ? (
                    <><Loader2 size={14} className="animate-spin" /> Generating…</>
                  ) : (
                    <><Sparkles size={14} /> Generate</>
                  )}
                </button>
                <p className="text-[11px] text-gray-500 leading-snug">
                  Heads up — AI photos still read as AI even with a good prompt. We
                  apply a film grain + vignette to soften it, but a real shot from
                  your phone always beats this.
                </p>
                <p className="text-[11px] text-gray-500 leading-snug">
                  Framed for <span className="text-gray-300 font-semibold">{size.label}</span> ({size.id === 'square' ? '1:1' : size.id === 'story' ? '9:16' : '16:9'}).
                  Switch sizes above + re-generate if you want a hero re-framed for a different format.
                </p>
              </div>
            </details>

            {heroError && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{heroError}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleDownload}
              style={{ ...styles.accent, ...styles.accentSh }}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg hover:opacity-90 text-base font-bold uppercase tracking-wide transition-opacity shadow-lg"
            >
              <Download size={18} /> Download {size.label.split(' · ')[0]}
            </button>
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-300 hover:border-[color:var(--pm-focus-border)] hover:text-white disabled:opacity-50 transition-colors"
              title="Render and download all three sizes (Square, Story, Wide) in one go"
            >
              {isDownloadingAll ? (
                <><Loader2 size={13} className="animate-spin" /> Rendering all 3 sizes…</>
              ) : (
                <><Download size={13} /> Or download all 3 sizes at once</>
              )}
            </button>
          </div>

          {/* Save-status line — only visible right after Download tap.
              Lives under the button so it doesn't push the layout. */}
          {savingStatus !== 'idle' && (
            <div className="text-xs flex items-center gap-1.5 -mt-2">
              {savingStatus === 'saving' && (
                <><Loader2 size={12} className="animate-spin text-gray-400" />
                  <span className="text-gray-400">Saving copy to gallery…</span></>
              )}
              {savingStatus === 'saved' && (
                <><Check size={12} className="text-green-500" />
                  <span className="text-green-500">Saved to gallery</span></>
              )}
              {savingStatus === 'error' && (
                <><AlertCircle size={12} className="text-amber-400" />
                  <span className="text-amber-400">{saveError || 'Could not save to gallery (download still worked)'}</span></>
              )}
            </div>
          )}

          {/* ── Instagram / Facebook caption ─────────────────────────
              Once the poster's right, this gives Macca the matching
              caption to paste alongside it. Generated on click (not
              auto, so we don't burn an AI call every render), shown
              in an editable textarea, then one tap to copy to
              clipboard. The IG/FB workflow is: drop the PNG, paste
              the caption, hit post. */}
          <section
            className="rounded-lg border border-gray-800 p-4 space-y-3"
            style={styles.surface}
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-bold uppercase tracking-wide text-white flex items-center gap-2">
                <MessageSquare size={14} style={styles.primaryFg} /> Caption for Instagram &amp; Facebook
              </h2>
              <span className="text-[10px] text-gray-500">
                Drop the PNG · paste the caption · post
              </span>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              One tap to write the caption in your voice using everything you've already filled in
              above. Edit it inline if you want, then copy and paste straight into Instagram or Facebook.
            </p>

            {!caption && (
              <button
                type="button"
                onClick={handleGenerateCaption}
                disabled={isCaptioning || !form.headline.trim() || !form.venue.trim() || !form.date.trim()}
                style={styles.primary}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-opacity"
              >
                {isCaptioning ? (
                  <><Loader2 size={16} className="animate-spin" /> Writing your caption…</>
                ) : (
                  <><Wand2 size={16} /> Write the caption</>
                )}
              </button>
            )}

            {caption && (
              <>
                <textarea
                  value={caption}
                  onChange={e => { setCaption(e.target.value); setCaptionCopied(false); }}
                  rows={8}
                  className={`${inputCls} resize-y leading-relaxed font-mono text-[13px]`}
                  spellCheck
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCaption}
                    style={styles.primary}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg hover:opacity-90 text-sm font-semibold transition-opacity"
                  >
                    <Copy size={14} /> Copy to clipboard
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateCaption}
                    disabled={isCaptioning}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 disabled:opacity-50 transition-colors"
                  >
                    {isCaptioning ? (
                      <><Loader2 size={14} className="animate-spin" /> Re-writing…</>
                    ) : (
                      <><RotateCcw size={14} /> Re-write</>
                    )}
                  </button>
                  {captionCopied && (
                    <span className="text-xs text-green-500 inline-flex items-center gap-1.5">
                      <Check size={14} /> Copied — paste it in Instagram
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500 ml-auto">
                    {caption.length} chars · {caption.trim().split(/\s+/).filter(Boolean).length} words
                  </span>
                </div>

                {/* ── Direct share to WhatsApp / SMS / Email ──────────
                    Beyond posting on IG/FB, Macca also blasts the same
                    announcement to his WhatsApp groups (HQ Nation),
                    his loyalty SMS list, and his email subscribers.
                    These buttons open the platform's native composer
                    with the caption already filled — no copy-paste
                    dance, no app-switching.
                    URL schemes:
                      wa.me — works on iOS, Android, WhatsApp Web
                      sms:  — opens default messaging app on mobile
                              (the &body= form works on iOS + modern Android)
                      mailto — opens default mail client everywhere
                    No backend, no JS state — pure href anchors, the OS
                    handles the rest. */}
                <div className="pt-1">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                    Or send the caption straight to
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(caption)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-200 hover:border-[color:var(--pm-focus-border)] hover:text-white transition-colors"
                      title="Open WhatsApp with the caption pre-filled (works on web + mobile)"
                    >
                      <MessageCircle size={13} /> WhatsApp
                    </a>
                    <a
                      href={`sms:?&body=${encodeURIComponent(caption)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-200 hover:border-[color:var(--pm-focus-border)] hover:text-white transition-colors"
                      title="Open Messages on your phone with the caption pre-filled (mobile only)"
                    >
                      <Smartphone size={13} /> SMS
                    </a>
                    <a
                      href={`mailto:?subject=${encodeURIComponent(`${KIT.brandName} — ${form.headline || 'Cook day update'}`)}&body=${encodeURIComponent(caption)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-200 hover:border-[color:var(--pm-focus-border)] hover:text-white transition-colors"
                      title="Open your default mail client with the caption as the body"
                    >
                      <Mail size={13} /> Email
                    </a>
                  </div>
                </div>

                {/* ── Best time to post ────────────────────────────────
                    AU-food-business posting heuristics baked into a
                    system prompt — one-tap "when should I drop this?"
                    suggestion in the brand voice. Sits below the share
                    row because it's the last step before he actually
                    posts. Falls back gracefully if AI is offline. */}
                <div className="pt-2 border-t border-gray-800">
                  {!postTime && (
                    <button
                      type="button"
                      onClick={handleSuggestPostTime}
                      disabled={isSuggestingPostTime}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-200 hover:border-[color:var(--pm-focus-border)] hover:text-white disabled:opacity-50 transition-colors"
                      title="Get an AI suggestion for the best time to post this on Instagram and Facebook"
                    >
                      {isSuggestingPostTime ? (
                        <><Loader2 size={13} className="animate-spin" /> Working out the slot…</>
                      ) : (
                        <><Clock size={13} /> When should I post this?</>
                      )}
                    </button>
                  )}

                  {postTime && (
                    <div className="space-y-1.5">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                          Best time to post
                        </span>
                        <button
                          type="button"
                          onClick={handleSuggestPostTime}
                          disabled={isSuggestingPostTime}
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline disabled:opacity-50"
                          title="Get a different suggestion"
                        >
                          {isSuggestingPostTime ? 'thinking…' : 'try again'}
                        </button>
                      </div>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <Clock size={14} style={styles.primaryFg} />
                        <span className="text-base font-bold text-white">{postTime.time}</span>
                      </div>
                      {postTime.reasoning && (
                        <p className="text-xs text-gray-400 italic leading-snug">
                          {postTime.reasoning}
                        </p>
                      )}
                    </div>
                  )}

                  {postTimeError && (
                    <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2 flex items-start gap-2 mt-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <span>{postTimeError}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {captionError && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2 flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{captionError}</span>
              </div>
            )}
          </section>
        </div>

        {/* ── Preview column ── */}
        <div className="lg:w-[480px]">
          <div className="sticky top-4">
            {/* Size picker — pick which format you're previewing. Each
                size has its own per-element layout that persists across
                switches, so re-arranging Square doesn't blow away the
                Story arrangement. */}
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="flex gap-1.5">
                {(Object.values(POSTER_SIZES) as PosterSize[]).map(sz => {
                  const isActive = size.id === sz.id;
                  return (
                    <button
                      key={sz.id}
                      type="button"
                      onClick={() => setSize(sz)}
                      title={`Preview at ${sz.width} × ${sz.height}`}
                      style={isActive ? styles.primary : undefined}
                      className={
                        isActive
                          ? 'px-2.5 py-1 rounded-md text-[11px] font-semibold border border-transparent transition-colors'
                          : 'px-2.5 py-1 rounded-md text-[11px] font-semibold border border-[color:var(--pm-input-border)] bg-[color:var(--pm-input-bg)] text-gray-300 hover:border-[color:var(--pm-focus-border)] hover:text-white transition-colors'
                      }
                    >
                      {sz.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={resetLayout}
                title={`Reset every dragged element on the ${size.label} layout back to its default position`}
                className="text-[10px] text-gray-500 hover:text-white inline-flex items-center gap-1 transition-colors"
              >
                <RotateCcw size={10} /> Reset {size.id} layout
              </button>
            </div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
              {size.width} × {size.height} · live preview
            </p>
            {/* The canvas plus an overlay layer of draggable element
                handles. The handles are absolutely positioned in
                percentage units so they scale with whatever CSS width
                the canvas ends up at. */}
            <div
              className="relative rounded-lg overflow-hidden border border-gray-800 shadow-2xl"
              style={{ backgroundColor: KIT.palette.backgroundDark, touchAction: 'none' }}
            >
              <canvas
                ref={canvasRef}
                className="block w-full h-auto select-none"
                aria-label="Cook day poster preview"
              />
              <div className="absolute inset-0">
                {/* Subhead — text scale via diagonal corner drag. */}
                <DragHandle
                  label="Subhead"
                  canvasRef={canvasRef}
                  canvasW={size.width}
                  canvasH={size.height}
                  bounds={{ x: layout.subhead.cx - 200, y: layout.subhead.cy - 22, w: 400, h: 44 }}
                  primaryColor={KIT.palette.primary}
                  onDrag={(dx, dy) => mutateLayoutPart('subhead', cur => ({
                    cx: cur.cx + dx,
                    cy: cur.cy + dy,
                  }))}
                  onResize={(dx, dy) => mutateLayoutPart('subhead', cur => ({
                    scale: clamp((cur.scale ?? 1) + (dx + dy) / 200, LAYOUT_LIMITS.textScaleMin, LAYOUT_LIMITS.textScaleMax),
                  }))}
                />
                {/* Headline — text scale. */}
                <DragHandle
                  label="Headline"
                  canvasRef={canvasRef}
                  canvasW={size.width}
                  canvasH={size.height}
                  bounds={{
                    x: layout.headline.cx - 480 * (layout.headline.scale ?? 1) * 0.5,
                    y: layout.headline.cy - 70 * (layout.headline.scale ?? 1),
                    w: 960 * (layout.headline.scale ?? 1) * 0.5,
                    h: 140 * (layout.headline.scale ?? 1),
                  }}
                  primaryColor={KIT.palette.primary}
                  onDrag={(dx, dy) => mutateLayoutPart('headline', cur => ({
                    cx: cur.cx + dx,
                    cy: cur.cy + dy,
                  }))}
                  onResize={(dx, dy) => mutateLayoutPart('headline', cur => ({
                    scale: clamp((cur.scale ?? 1) + (dx + dy) / 300, LAYOUT_LIMITS.textScaleMin, LAYOUT_LIMITS.textScaleMax),
                  }))}
                />
                {form.body.trim() && (
                  <DragHandle
                    label="Body"
                    canvasRef={canvasRef}
                    canvasW={size.width}
                    canvasH={size.height}
                    bounds={{
                      x: layout.body.cx - layout.body.maxWidth / 2,
                      y: layout.body.yTop - 4,
                      w: layout.body.maxWidth,
                      h: Math.max(60, 96 * (layout.body.scale ?? 1)),
                    }}
                    primaryColor={KIT.palette.primary}
                    onDrag={(dx, dy) => mutateLayoutPart('body', cur => ({
                      cx:   cur.cx + dx,
                      yTop: cur.yTop + dy,
                    }))}
                    onResize={(dx, dy) => mutateLayoutPart('body', cur => ({
                      scale: clamp((cur.scale ?? 1) + (dx + dy) / 200, LAYOUT_LIMITS.textScaleMin, LAYOUT_LIMITS.textScaleMax),
                    }))}
                  />
                )}
                {/* Info panel — independent w/h resize via corner drag. */}
                <DragHandle
                  label="Info panel"
                  canvasRef={canvasRef}
                  canvasW={size.width}
                  canvasH={size.height}
                  bounds={{ x: layout.infoPanel.x, y: layout.infoPanel.y, w: layout.infoPanel.w, h: layout.infoPanel.h }}
                  primaryColor={KIT.palette.primary}
                  onDrag={(dx, dy) => mutateLayoutPart('infoPanel', cur => ({
                    x: cur.x + dx,
                    y: cur.y + dy,
                  }))}
                  onResize={(dx, dy) => mutateLayoutPart('infoPanel', cur => ({
                    w: clamp(cur.w + dx, LAYOUT_LIMITS.panelWMin, size.width - 40),
                    h: clamp(cur.h + dy, LAYOUT_LIMITS.panelHMin, LAYOUT_LIMITS.panelHMax),
                  }))}
                />
                {form.qrEnabled && qrImage && (
                  <DragHandle
                    label="QR"
                    canvasRef={canvasRef}
                    canvasW={size.width}
                    canvasH={size.height}
                    bounds={{ x: layout.qrBlock.x - 4, y: layout.qrBlock.y - 4, w: layout.qrBlock.size + 8, h: layout.qrBlock.size + 24 }}
                    primaryColor={KIT.palette.primary}
                    onDrag={(dx, dy) => mutateLayoutPart('qrBlock', cur => ({
                      x: cur.x + dx,
                      y: cur.y + dy,
                    }))}
                    onResize={(dx, dy) => mutateLayoutPart('qrBlock', cur => ({
                      // Keep QR square — average dx + dy so it scales evenly.
                      size: clamp(cur.size + (dx + dy) / 2, LAYOUT_LIMITS.qrSizeMin, LAYOUT_LIMITS.qrSizeMax),
                    }))}
                  />
                )}
                <DragHandle
                  label="Logo"
                  canvasRef={canvasRef}
                  canvasW={size.width}
                  canvasH={size.height}
                  bounds={{
                    x: layout.logo.cx - layout.logo.r,
                    y: layout.logo.cy - layout.logo.r,
                    w: layout.logo.r * 2,
                    h: layout.logo.r * 2,
                  }}
                  primaryColor={KIT.palette.primary}
                  onDrag={(dx, dy) => mutateLayoutPart('logo', cur => ({
                    cx: cur.cx + dx,
                    cy: cur.cy + dy,
                  }))}
                  onResize={(dx, dy) => mutateLayoutPart('logo', cur => ({
                    r: clamp(cur.r + (dx + dy) / 4, LAYOUT_LIMITS.logoRMin, LAYOUT_LIMITS.logoRMax),
                  }))}
                />
                {form.hashtagsText.trim() && (
                  <DragHandle
                    label="Hashtags"
                    canvasRef={canvasRef}
                    canvasW={size.width}
                    canvasH={size.height}
                    bounds={{ x: layout.hashtagFooter.cx - 430, y: layout.hashtagFooter.cy - 14, w: 860, h: 28 }}
                    primaryColor={KIT.palette.primary}
                    onDrag={(dx, dy) => mutateLayoutPart('hashtagFooter', cur => ({
                      cx: cur.cx + dx,
                      cy: cur.cy + dy,
                    }))}
                    onResize={(dx, dy) => mutateLayoutPart('hashtagFooter', cur => ({
                      scale: clamp((cur.scale ?? 1) + (dx + dy) / 250, LAYOUT_LIMITS.textScaleMin, LAYOUT_LIMITS.textScaleMax),
                    }))}
                  />
                )}
              </div>
            </div>
            <p className="text-[10px] text-gray-600 mt-2 text-center leading-relaxed">
              Dashed outlines show every element you can drag · click anywhere inside to move · grab the
              <span
                className="inline-flex items-center justify-center align-middle mx-1"
                style={{
                  width: 12, height: 12, borderRadius: 2,
                  backgroundColor: KIT.palette.primary,
                  border: '1px solid #fff',
                }}
                aria-hidden="true"
              />
              corner to resize · <button onClick={resetLayout} className="underline hover:text-gray-400">reset</button> any time<br />
              Download produces the full 1080×1080 PNG with your layout baked in
            </p>
          </div>
        </div>
      </div>

      {/* ── Recent posters gallery ────────────────────────────────────
          Every Download tap also persists a copy to R2 + D1, so this
          row builds up over time. Click any thumb to re-download the
          original PNG; "Reuse" loads the inputs back into the form
          above; "Delete" removes it permanently after a confirm. */}
      <section className="mt-10">
        <header className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
            <History size={14} />
            Recent posters
            {gallery.length > 0 && (
              <span className="text-xs font-normal text-gray-500 normal-case tracking-normal">
                ({galleryFilter.trim() ? `${filteredGallery.length}/${gallery.length}` : gallery.length})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            {gallery.length > 3 && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                <input
                  type="search"
                  value={galleryFilter}
                  onChange={e => setGalleryFilter(e.target.value)}
                  placeholder="Find a poster…"
                  className={`${inputCls} pl-7 pr-7 py-1.5 text-xs w-44 sm:w-56`}
                  aria-label="Filter saved posters by headline, venue, date, or hashtag"
                />
                {galleryFilter && (
                  <button
                    type="button"
                    onClick={() => setGalleryFilter('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-1"
                    aria-label="Clear filter"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
            {galleryLoading && (
              <span className="text-[10px] text-gray-500 inline-flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" /> Loading…
              </span>
            )}
          </div>
        </header>

        {galleryError && (
          <div className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              {galleryError}
              {' — '}
              <button onClick={refreshGallery} className="underline">retry</button>
            </span>
          </div>
        )}

        {!galleryError && gallery.length === 0 && !galleryLoading && (
          <p className="text-xs text-gray-500 italic">
            Nothing saved yet. Every poster you download lands here so you can grab it again later.
          </p>
        )}

        {gallery.length > 0 && filteredGallery.length === 0 && galleryFilter.trim() && (
          <p className="text-xs text-gray-500 italic">
            No posters match <span className="font-semibold text-gray-300">&ldquo;{galleryFilter}&rdquo;</span>.
            {' '}
            <button type="button" onClick={() => setGalleryFilter('')} className="underline hover:text-white">
              Clear filter
            </button>
          </p>
        )}

        {upcomingGallery.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-400 flex items-center gap-1.5 mb-2">
              <CalendarClock size={12} style={styles.primaryFg} />
              Upcoming
              <span className="text-[10px] font-normal text-gray-500">
                ({upcomingGallery.length} · scheduled to post)
              </span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {upcomingGallery.map(p => (
                <GalleryCard
                  key={p.id}
                  poster={p}
                  brandSlug={KIT.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
                  onUseAsBase={() => handleUseAsBase(p)}
                  onDelete={() => handleDeleteSaved(p.id)}
                  onSchedule={(at) => handleScheduleSaved(p.id, at)}
                />
              ))}
            </div>
          </div>
        )}

        {restGallery.length > 0 && (
          <>
            {upcomingGallery.length > 0 && (
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-400 mb-2">
                All posters
                <span className="text-[10px] font-normal text-gray-500 ml-1.5">
                  ({restGallery.length})
                </span>
              </h3>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {restGallery.map(p => (
                <GalleryCard
                  key={p.id}
                  poster={p}
                  brandSlug={KIT.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
                  onUseAsBase={() => handleUseAsBase(p)}
                  onDelete={() => handleDeleteSaved(p.id)}
                  onSchedule={(at) => handleScheduleSaved(p.id, at)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
};

// ── Gallery card component ────────────────────────────────────────────

interface GalleryCardProps {
  poster: SavedPoster;
  brandSlug: string;
  onUseAsBase: () => void;
  onDelete: () => void;
  /** Stamp or clear the post-to-socials schedule. ISO datetime string or null. */
  onSchedule: (scheduledAt: string | null) => void;
}
const GalleryCard: FC<GalleryCardProps> = ({ poster, brandSlug, onUseAsBase, onDelete, onSchedule }) => {
  const headline = poster.contentInputs?.headline || 'Untitled poster';
  const date = poster.contentInputs?.date || '';
  const venueSlug = (poster.contentInputs?.venue || 'cook-day')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cook-day';
  // createdAt is an ISO string from the worker; Date.parse handles it.
  const stamp = new Date(poster.createdAt).toISOString().slice(0, 10);
  const filename = `${brandSlug}-${stamp}-${venueSlug}.png`;
  const imageUrl = poster.imageUrl || posterImageUrl(poster.id);

  const [editingSchedule, setEditingSchedule] = useState(false);
  // Worker stores scheduled_at as TEXT (ISO). The <input type="datetime-local">
  // needs "YYYY-MM-DDTHH:mm" in LOCAL time — convert via Date object.
  const scheduledMs = poster.scheduledAt ? Date.parse(poster.scheduledAt) : 0;
  const scheduledInputValue = scheduledMs ? toDatetimeLocal(scheduledMs) : '';
  const isUpcoming = scheduledMs > 0 && scheduledMs > Date.now();
  const isPast     = scheduledMs > 0 && scheduledMs <= Date.now();

  return (
    <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-950 flex flex-col">
      {/* Thumbnail — same-origin so the browser caches and the auth
          cookie applies. aspect-square keeps the grid tidy. */}
      <img
        src={imageUrl}
        alt={`Poster: ${headline}`}
        className="w-full aspect-square object-cover bg-black"
        loading="lazy"
      />
      <div className="p-2 space-y-1.5 flex-1 flex flex-col">
        <div className="text-[10px] text-gray-500 flex items-center justify-between gap-1">
          <span>{timeAgo(poster.createdAt)}</span>
          {date && <span className="truncate">{date}</span>}
        </div>
        <div className="text-xs text-white truncate font-semibold" title={headline}>
          {headline}
        </div>
        {/* Schedule badge — green for upcoming, muted for past. Only
            renders when scheduledAt is set so unscheduled posters stay
            visually quiet. */}
        {poster.scheduledAt && (
          <div
            className={`text-[10px] inline-flex items-center gap-1 truncate ${
              isUpcoming ? 'text-emerald-400' : 'text-gray-500'
            }`}
            title={isUpcoming ? 'Scheduled to post' : 'Was scheduled for'}
          >
            <CalendarClock size={10} />
            <span className="truncate">{formatScheduleBadge(scheduledMs)}</span>
          </div>
        )}
        {editingSchedule && (
          <div className="space-y-1 pt-1">
            <input
              type="datetime-local"
              defaultValue={scheduledInputValue}
              onChange={e => {
                const v = e.target.value;
                if (!v) return;
                const dt = new Date(v);
                if (!Number.isFinite(dt.getTime()) || dt.getTime() <= 0) return;
                // Worker stores ISO; produce one in UTC so server-side
                // comparisons (date('now') / Date.parse) are consistent.
                onSchedule(dt.toISOString());
              }}
              className="w-full px-1.5 py-1 rounded text-[10px] text-white bg-gray-900 border border-gray-700 focus:border-gray-500 focus:outline-none"
              aria-label="Post date and time"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setEditingSchedule(false)}
                className="flex-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-white"
              >
                Done
              </button>
              {poster.scheduledAt && (
                <button
                  type="button"
                  onClick={() => { onSchedule(null); setEditingSchedule(false); }}
                  title="Clear schedule"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-red-900/40 text-red-400"
                >
                  <CalendarX size={10} />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-1 mt-auto pt-1">
          <a
            href={imageUrl}
            download={filename}
            title="Download original PNG"
            className="flex-1 text-[10px] text-center px-1.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-white inline-flex items-center justify-center gap-1"
          >
            <Download size={10} /> PNG
          </a>
          <button
            type="button"
            onClick={onUseAsBase}
            title="Load inputs back into the form above"
            className="flex-1 text-[10px] px-1.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-white inline-flex items-center justify-center gap-1"
          >
            <RotateCcw size={10} /> Reuse
          </button>
          <button
            type="button"
            onClick={() => setEditingSchedule(s => !s)}
            title={poster.scheduledAt ? 'Edit schedule' : 'Schedule this poster for a date and time'}
            className={`text-[10px] px-1.5 py-1 rounded inline-flex items-center justify-center ${
              isUpcoming ? 'bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-300'
              : isPast    ? 'bg-gray-800 hover:bg-gray-700 text-gray-400'
              :             'bg-gray-800 hover:bg-gray-700 text-white'
            }`}
          >
            <CalendarClock size={10} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete permanently"
            className="text-[10px] px-1.5 py-1 rounded bg-gray-800 hover:bg-red-900/40 text-red-400 inline-flex items-center justify-center"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    </div>
  );
};

/** Format a unix-ms as "YYYY-MM-DDTHH:mm" for a <input type="datetime-local">.
 *  Uses local time components (not UTC) so the picker shows the time the
 *  admin actually intended. */
function toDatetimeLocal(unixMs: number): string {
  const d = new Date(unixMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Compact "Fri 17 May, 6:30pm" badge for the gallery card. */
function formatScheduleBadge(unixMs: number): string {
  const d = new Date(unixMs);
  const day  = d.toLocaleDateString('en-AU', { weekday: 'short' });
  const date = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, '').toLowerCase();
  return `${day} ${date}, ${time}`;
}

// ── Drag handle overlay ───────────────────────────────────────────────

interface DragHandleProps {
  /** Short label shown in the top-left chip when hovered. */
  label: string;
  /** Element's bounding box in canvas pixels (1080-space). */
  bounds: { x: number; y: number; w: number; h: number };
  /** Brand primary colour — used for the dashed outline + handle chip. */
  primaryColor: string;
  /** Ref to the canvas — used to compute the screen-to-canvas scale on each drag. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Active canvas width in pixels (POSTER_SIZES.{id}.width). */
  canvasW: number;
  /** Active canvas height in pixels. Used for the % positioning of the DOM overlay. */
  canvasH: number;
  /** Called with canvas-coord deltas during a body drag (move). */
  onDrag: (dxCanvas: number, dyCanvas: number) => void;
  /** Optional — called with canvas-coord deltas during a corner drag (resize). */
  onResize?: (dxCanvas: number, dyCanvas: number) => void;
}

/** Clamp a value to a [min, max] range. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Convert a screen-pixel pointer delta into canvas-pixel delta. Reads the
 *  canvas's intrinsic width (set by composeCookDayPoster from the active
 *  PosterSize) so the scale is right at any size. */
function screenToCanvas(
  canvas: HTMLCanvasElement | null,
  dxScreen: number, dyScreen: number,
): { dx: number; dy: number } | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return null;
  const scale = canvas.width / rect.width;
  return { dx: dxScreen * scale, dy: dyScreen * scale };
}

/**
 * Per-element draggable handle that lives in the DOM overlay above the
 * canvas. Position + size are expressed in canvas pixels and converted
 * to % units so the handle stays attached to its element regardless of
 * the canvas's CSS-rendered size.
 *
 * Two interactions in one component:
 *   - Body drag → pointerdown anywhere except the corner triggers move
 *   - Corner drag → pointerdown on the bottom-right square triggers resize
 *
 * Both use setPointerCapture so a drag that slides off the handle
 * keeps firing pointermove until release. Touch works via pointer
 * events natively.
 */
const DragHandle: React.FC<DragHandleProps> = ({ label, bounds, primaryColor, canvasRef, canvasW, canvasH, onDrag, onResize }) => {
  const lastRef = useRef<{ x: number; y: number; mode: 'move' | 'resize' } | null>(null);
  const [interaction, setInteraction] = useState<'idle' | 'move' | 'resize'>('idle');
  const active = interaction !== 'idle';

  // Always-on faint dashed outline so users can see WHAT'S draggable
  // without having to hover-hunt. Brighter on hover, full brand-primary
  // when active. The previous "invisible until you find it" version was
  // a discoverability dead-end — Steve couldn't find the resize handle
  // at all in production.
  const style: React.CSSProperties = {
    position: 'absolute',
    left:     `${(bounds.x / canvasW) * 100}%`,
    top:      `${(bounds.y / canvasH) * 100}%`,
    width:    `${(bounds.w / canvasW) * 100}%`,
    height:   `${(bounds.h / canvasH) * 100}%`,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: active ? primaryColor : 'rgba(255, 255, 255, 0.18)',
    backgroundColor: active ? 'rgba(255,255,255,0.04)' : 'transparent',
    cursor: interaction === 'resize' ? 'nwse-resize' : 'move',
    touchAction: 'none',
    // Active handle bumps to a high stack so it stays in front of any
    // sibling drag bodies that overlap (logo over info panel, hashtags
    // over logo, etc.) — fixes the previous bug where the info panel's
    // resize corner was unreachable because the logo's body covered it.
    zIndex: active ? 30 : 1,
    transition: 'border-color 120ms ease, background-color 120ms ease',
  };

  const handlePointerDown = (mode: 'move' | 'resize') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (mode === 'resize' && !onResize) return;
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    lastRef.current = { x: e.clientX, y: e.clientY, mode };
    setInteraction(mode);
    e.preventDefault();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lastRef.current) return;
    const delta = screenToCanvas(canvasRef.current, e.clientX - lastRef.current.x, e.clientY - lastRef.current.y);
    if (!delta) return;
    lastRef.current = { x: e.clientX, y: e.clientY, mode: lastRef.current.mode };
    if (lastRef.current.mode === 'resize' && onResize) {
      onResize(delta.dx, delta.dy);
    } else {
      onDrag(delta.dx, delta.dy);
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    lastRef.current = null;
    setInteraction('idle');
  };

  return (
    <div
      style={style}
      className="group hover:!border-white/60"
      onPointerDown={handlePointerDown('move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {/* Label chip — invisible until hover or drag. */}
      <span
        className={`absolute top-0.5 left-0.5 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold text-white pointer-events-none ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
        style={{ backgroundColor: primaryColor }}
      >
        {label}{interaction === 'resize' ? ' · resizing' : ''}
      </span>

      {/* Resize handle — bottom-right square. Two big changes vs v1:
          1. INSET into the element instead of translating half-outside
             the parent. Previously the wrapper's `overflow-hidden` (used
             for the rounded canvas corner) clipped the handle for
             corner elements like the logo / info panel / hashtags.
          2. ALWAYS visible at low alpha — discoverability fix. The
             previous opacity-0 → group-hover meant the user couldn't
             see the resize affordance until their cursor was already
             on it. Macca reported "still won't rescale" because the
             handle was effectively invisible.
          z-index is bumped above the body so an overlapping sibling
          drag body (e.g. logo over info panel) can never eat the
          resize pointerdown event. */}
      {onResize && (
        <div
          onPointerDown={handlePointerDown('resize')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          className={`absolute ${active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'} transition-opacity flex items-end justify-end`}
          style={{
            width: 20,
            height: 20,
            right: 2,
            bottom: 2,
            backgroundColor: primaryColor,
            border: '2px solid #fff',
            borderRadius: 4,
            cursor: 'nwse-resize',
            touchAction: 'none',
            boxShadow: '0 2px 6px rgba(0,0,0,0.55)',
            zIndex: 40,
          }}
          aria-label={`Resize ${label}`}
        >
          {/* Tiny ↘ glyph so the affordance is obvious at a glance. */}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            style={{ marginRight: 2, marginBottom: 2, opacity: 0.9, pointerEvents: 'none' }}
            aria-hidden="true"
          >
            <path d="M2 9 L9 2 M5 9 L9 5 M9 9" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
};

/** Compact "5 minutes ago" / "2 days ago" / "Mar 15" rendering. Accepts the
 *  ISO string the worker stores; bad input returns 'just now' rather than
 *  blowing up the gallery. */
function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return 'just now';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7)    return `${days}d ago`;
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ── shared field component ────────────────────────────────────────────

// Input chrome — surface and focus colours come from CSS variables set
// at the page root from the active brand kit. Layout-only Tailwind
// classes here; the colour values are brand-driven.
const inputCls =
  'w-full px-3 py-2 rounded-md text-white text-sm placeholder-gray-600 focus:outline-none transition-colors ' +
  'bg-[color:var(--pm-input-bg)] border border-[color:var(--pm-input-border)] focus:border-[color:var(--pm-focus-border)]';

/** Convert a hex colour to rgba() with the given alpha, for use in inline styles. */
function withHexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

interface FormFieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}
const FormField: React.FC<FormFieldProps> = ({ label, hint, children }) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</span>
      {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
    </div>
    {children}
  </label>
);


export default PosterManager;
