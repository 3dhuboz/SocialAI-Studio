/**
 * Penny Wise IT — Poster Maker Add-On
 * Cook Day Announcement compositor (brand-agnostic).
 *
 * This file is one of three you copy into a target client repo when
 * white-labelling the poster builder. It contains zero brand-specific
 * literals — every colour, font and label is read from the
 * `PosterBrandKit` passed in by the caller. See `posterBrandKit.ts`
 * for the kit interface, the Hughesys Que default, and the install
 * checklist.
 *
 * The compositor renders a 1080×1080 square poster onto a Canvas
 * element. Text is rendered by the browser using the brand-kit fonts
 * (which MUST already be loaded in the page via CSS), never by the AI
 * model. That's why prices / dates / venue names are byte-exact every
 * render — Macca's #1 ChatGPT pain.
 */

import type { PosterBrandKit } from './posterBrandKit';

export interface CookDayPosterInputs {
  /** ALL-CAPS shout headline — "WE ARE BACK!" / "OPEN TOMORROW" etc. */
  headline: string;
  /** Optional accent-colour subhead — "HQ NATION 🔥" / "REAL FIRE. REAL SMOKE." */
  subhead?: string;
  /** Venue name. Rendered ALL-CAPS in the info panel. */
  venue: string;
  /** Date display string. E.g. "SAT 17 MAY". Pre-formatted, no parsing here. */
  date: string;
  /** Optional pickup/trading window — "8AM-8PM" / "BREAKFAST 8-12, DINNER 5-8". */
  pickupTime?: string;
  /** Optional 1-3 line body copy in the brand body font, sentence-case. */
  body?: string;
  /** Hashtag stack for the footer. Rendered space-separated, muted grey. */
  hashtags?: string[];
  /** AI-generated or user-uploaded hero photo. Null = ember-texture fallback. */
  heroImage?: HTMLImageElement | null;
  /** Brand logo (already loaded). If null we draw a monogram fallback. */
  logoImage?: HTMLImageElement | null;
  /**
   * QR code image (already loaded). Generated upstream by the qrcode lib
   * and passed in here as an HTMLImageElement so the compositor stays
   * synchronous + dependency-free. Null = no QR, info panel falls back
   * to its no-QR layout. Black-on-white QRs work best on the dark info
   * panel; the compositor draws them on a white rounded plate so the
   * brand background doesn't interfere with scanning.
   */
  qrImage?: HTMLImageElement | null;
  /** Short ALL-CAPS label rendered under the QR (e.g. "SCAN TO ORDER"). */
  qrLabel?: string;
}

/**
 * Per-element layout override for the draggable layout editor. Each
 * field is optional; missing values fall back to the active size's
 * defaultLayout so a caller that doesn't care about layout still gets
 * a sensible composition.
 *
 * Coordinates are in canvas pixels in whatever PosterSize's coordinate
 * space the caller is rendering at. The DOM overlay in PosterManager
 * scales pointer events accordingly before writing back into this
 * shape.
 */
export interface PosterLayout {
  // Text elements: position + optional `scale` multiplier on their base
  // font size (so dragging a corner resizes the text). 1 = default.
  subhead?:       { cx: number; cy: number; scale?: number };
  headline?:      { cx: number; cy: number; scale?: number };
  body?:          { cx: number; yTop: number; maxWidth: number; scale?: number };
  hashtagFooter?: { cx: number; cy: number; scale?: number };
  // Box elements: explicit size dimensions (resized via corner drag).
  infoPanel?:     { x: number; y: number; w: number; h: number };
  qrBlock?:       { x: number; y: number; size: number };
  logo?:          { cx: number; cy: number; r: number };
}

/**
 * A poster size variant — Macca posts the same announcement to multiple
 * social formats, and each one wants a fundamentally different layout
 * (square IG feed vs tall IG story vs wide FB cover). Each size carries
 * its own width × height, hero band rectangle, coal-bed strip and
 * default layout positions so the composer can render the same content
 * at any aspect ratio without conditional ratio-detection sprinkled
 * through every draw function.
 *
 * To add a new size: define the entry in POSTER_SIZES below. Aim for
 * each element to read well at the chosen aspect — don't just stretch
 * the square layout to fit, design positions for the new shape.
 */
export interface PosterSize {
  id: 'square' | 'story' | 'wide';
  /** Human label shown in the size picker chip. */
  label: string;
  /** Compact label used in download filenames + status lines. */
  shortLabel: string;
  /** Canvas pixel dimensions — also the coordinate space for layout. */
  width: number;
  height: number;
  /** Hero band rectangle. Top of canvas for square + story, left half for wide. */
  heroRect:     { x: number; y: number; w: number; h: number };
  /** Bottom-fade gradient over the hero band — smooths into the dark background. */
  heroFadeRect: { x: number; y: number; w: number; h: number };
  /** Coal-bed glow strip at the bottom (or far edge) of the canvas. */
  coalBedRect:  { x: number; y: number; w: number; h: number };
  /** Default positions for every draggable element at this size. */
  defaultLayout: Required<PosterLayout>;
  /** Ember spark positions in canvas-space coords (not normalised). */
  emberSparks: ReadonlyArray<readonly [x: number, y: number, r: number, a: number]>;
}

/**
 * All supported poster sizes. Each one has been hand-tuned for its
 * aspect — different aspects want fundamentally different compositions
 * (Story's huge centered QR vs Wide's hero-on-the-left), not just
 * stretched versions of the square.
 *
 * If you add a fourth size (e.g. LinkedIn 1200×627, A4 print), do it
 * here — every consumer reads sizes via this constant so the new
 * format slots into the picker automatically.
 */
export const POSTER_SIZES = {
  // 1080×1080 — the canonical Instagram feed format. This is the
  // composition the brand kit was originally tuned against; the others
  // are derivatives.
  square: {
    id:           'square',
    label:        'Square · IG feed',
    shortLabel:   'square-1080',
    width:        1080,
    height:       1080,
    heroRect:     { x: 0, y: 0, w: 1080, h: 580 },
    heroFadeRect: { x: 0, y: 380, w: 1080, h: 200 },
    coalBedRect:  { x: 0, y: 1020, w: 1080, h: 60 },
    defaultLayout: {
      subhead:       { cx: 540, cy: 632, scale: 1 },
      headline:      { cx: 540, cy: 720, scale: 1 },
      body:          { cx: 540, yTop: 800, maxWidth: 880, scale: 1 },
      infoPanel:     { x: 60, y: 870, w: 960, h: 110 },
      qrBlock:       { x: 910, y: 860, size: 130 },
      logo:          { cx: 970, cy: 1020, r: 70 },
      hashtagFooter: { cx: 540, cy: 1010, scale: 1 },
    },
    emberSparks: [
      [137,  82, 1.4, 0.42],
      [763, 104, 1.2, 0.36],
      [442, 178, 1.6, 0.45],
      [193, 612, 1.8, 0.50],
      [854, 657, 1.3, 0.38],
      [517, 988, 1.4, 0.30],
    ],
  },

  // 1080×1920 — Instagram + Facebook Story. Tall portrait. The QR
  // becomes huge and centered because Stories are scrolled fast and
  // the order-CTA needs to read at thumbnail size.
  story: {
    id:           'story',
    label:        'Story · IG/FB story',
    shortLabel:   'story-1080x1920',
    width:        1080,
    height:       1920,
    heroRect:     { x: 0, y: 0, w: 1080, h: 980 },
    heroFadeRect: { x: 0, y: 780, w: 1080, h: 200 },
    coalBedRect:  { x: 0, y: 1880, w: 1080, h: 40 },
    defaultLayout: {
      subhead:       { cx: 540, cy: 1060, scale: 1 },
      headline:      { cx: 540, cy: 1180, scale: 1.05 },
      body:          { cx: 540, yTop: 1290, maxWidth: 920, scale: 1 },
      infoPanel:     { x: 60, y: 1430, w: 960, h: 110 },
      qrBlock:       { x: 410, y: 1570, size: 260 },
      // Logo sits center-bottom, small (Story is a vertical scroll
      // and stories already get a profile-pic logo from the app
      // chrome). Hashtags above it with a clear gap. The coal bed
      // glow at y=1880 sits cleanly under both.
      hashtagFooter: { cx: 540, cy: 1800, scale: 0.95 },
      logo:          { cx: 540, cy: 1856, r: 22 },
    },
    emberSparks: [
      [137, 120, 1.4, 0.42],
      [763, 140, 1.2, 0.36],
      [442, 280, 1.6, 0.45],
      [193, 940, 1.8, 0.50],
      [854, 990, 1.3, 0.38],
      [517, 1850, 1.4, 0.25],
    ],
  },

  // 1200×630 — Facebook cover, LinkedIn share, blog hero. Wide
  // landscape. Hero takes the LEFT half rather than the top because
  // a thin top-band hero in a 1.9:1 looks like a banner ad, and the
  // brand voice lands better when the photo is a full-height story
  // frame next to a stacked text column.
  wide: {
    id:           'wide',
    label:        'Wide · FB cover',
    shortLabel:   'wide-1200x630',
    width:        1200,
    height:       630,
    heroRect:     { x: 0, y: 0, w: 540, h: 630 },
    heroFadeRect: { x: 380, y: 0, w: 160, h: 630 },
    coalBedRect:  { x: 540, y: 605, w: 660, h: 25 },
    defaultLayout: {
      subhead:       { cx: 870, cy: 90, scale: 0.95 },
      headline:      { cx: 870, cy: 170, scale: 0.95 },
      body:          { cx: 870, yTop: 250, maxWidth: 600, scale: 0.95 },
      infoPanel:     { x: 560, y: 380, w: 540, h: 85 },
      qrBlock:       { x: 1090, y: 380, size: 90 },
      logo:          { cx: 1145, cy: 545, r: 40 },
      hashtagFooter: { cx: 870, cy: 595, scale: 0.85 },
    },
    emberSparks: [
      [820,  72, 1.2, 0.30],
      [1080, 50, 1.0, 0.28],
      [580, 580, 1.4, 0.32],
      [200, 540, 1.6, 0.42],
      [420, 110, 1.2, 0.32],
    ],
  },
} as const satisfies Record<string, PosterSize>;

/**
 * Square format width — used internally as the default for several draw
 * functions whose signatures pre-date the multi-size refactor. Kept
 * private (no `export`) since every external consumer reads dimensions
 * via the active PosterSize now.
 */
const CANVAS_SIZE = POSTER_SIZES.square.width;

/**
 * Per-element clamps so a frantic drag-resize can't shrink the QR to
 * an unscannable speck or blow the headline past the canvas. The
 * info-panel's MAX width is per-size — applied at the call site against
 * the active size's width (size.width - 40) so the panel can't be
 * dragged wider than the canvas it's currently on.
 */
export const LAYOUT_LIMITS = {
  textScaleMin: 0.5,
  textScaleMax: 2.5,
  qrSizeMin:    60,
  qrSizeMax:    320,
  logoRMin:     20,
  logoRMax:     140,
  panelWMin:    260,
  panelHMin:    60,
  panelHMax:    200,
} as const;

/**
 * Make sure the brand kit's display + body fonts are actually loaded
 * before we paint text — if Canvas tries to use a font that hasn't
 * loaded yet it silently falls back to a system serif and the whole
 * poster looks wrong.
 */
export async function ensurePosterFontsLoaded(kit: PosterBrandKit): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const display = kit.fonts.display;
  const body = kit.fonts.body;
  try {
    await Promise.all([
      document.fonts.load(`700 96px "${display}"`),
      document.fonts.load(`700 32px "${display}"`),
      document.fonts.load(`400 20px "${body}"`),
      document.fonts.load(`600 16px "${body}"`),
      document.fonts.ready,
    ]);
  } catch {
    // Best-effort — if the browser can't tell us about font loading we
    // still attempt to paint. Worst case the first paint looks slightly
    // off and a second paint cleans it up.
  }
}

/**
 * Loads an image from a URL or data URL. Resolves with the loaded image,
 * or null if it fails to load (so the compositor can substitute a
 * fallback rather than blow up the whole poster).
 */
export function loadPosterImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Draw the full Cook Day Announcement poster onto the provided canvas
 * at the supplied size, using the brand kit and (optional) per-element
 * layout overrides. The canvas's intrinsic dimensions are set from the
 * PosterSize so callers don't have to manage width/height themselves.
 *
 * @param size   Which size variant to render at. POSTER_SIZES.square is
 *               the canonical Instagram-feed shape. Defaults to square
 *               so pre-refactor callers don't break.
 * @param layout Per-element position overrides from the draggable
 *               layout editor. Missing fields fall back to the active
 *               size's defaultLayout (NOT the legacy DEFAULT_LAYOUT
 *               constant — different sizes have different defaults).
 */
export async function composeCookDayPoster(
  canvas: HTMLCanvasElement,
  inputs: CookDayPosterInputs,
  kit: PosterBrandKit,
  size: PosterSize = POSTER_SIZES.square,
  layout?: PosterLayout,
): Promise<void> {
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context not available');

  await ensurePosterFontsLoaded(kit);

  // Resolve each layout slot against the active size's defaults so a
  // partial layout JSON (e.g. only headline overridden) keeps the rest
  // of the size-tuned positions.
  const D = size.defaultLayout;
  const L = {
    subhead:       layout?.subhead       ?? D.subhead,
    headline:      layout?.headline      ?? D.headline,
    body:          layout?.body          ?? D.body,
    infoPanel:     layout?.infoPanel     ?? D.infoPanel,
    qrBlock:       layout?.qrBlock       ?? D.qrBlock,
    logo:          layout?.logo          ?? D.logo,
    hashtagFooter: layout?.hashtagFooter ?? D.hashtagFooter,
  };

  // 1. Solid brand-background base — every layer composites on top so
  //    nothing can ever bleed through to white on a failed render.
  ctx.fillStyle = kit.palette.background;
  ctx.fillRect(0, 0, size.width, size.height);

  // 2. Hero band — full top for square/story, left half for wide.
  //    Fixed (you can't drag the hero photo).
  const HR = size.heroRect;
  drawHeroBand(ctx, kit, inputs.heroImage, HR.x, HR.y, HR.w, HR.h);
  const HF = size.heroFadeRect;
  // The fade direction depends on the hero placement — square/story
  // fade vertically (top→bottom), wide fades horizontally (left→right).
  // The placement check is "is the hero band as tall as the canvas?"
  // — if yes, this is the wide layout.
  const horizontalFade = HR.h >= size.height - 1;
  drawHeroFade(ctx, kit, HF.x, HF.y, HF.w, HF.h, horizontalFade);

  // 3. Accent-colour subhead strip. DRAGGABLE + RESIZABLE.
  drawAccentSubhead(ctx, kit, inputs.subhead || kit.defaults.subhead,
    L.subhead.cx, L.subhead.cy, L.subhead.scale ?? 1);

  // 4. Big shout headline. DRAGGABLE + RESIZABLE.
  //    Headline auto-shrinks to fit a max-width. For wide where the
  //    headline lives in the right column, clamp to that column's
  //    width so it doesn't bleed back over the hero photo on the left.
  const headlineMaxWidth = size.id === 'wide' ? 620 : (size.width - 120);
  drawHeadline(ctx, kit, inputs.headline || kit.defaults.headline,
    L.headline.cx, L.headline.cy, L.headline.scale ?? 1, headlineMaxWidth);

  // 5. Body copy (optional). DRAGGABLE + RESIZABLE.
  if (inputs.body && inputs.body.trim()) {
    drawBodyCopy(ctx, kit, inputs.body.trim(),
      L.body.cx, L.body.yTop, L.body.maxWidth, L.body.scale ?? 1);
  }

  // 6. Info panel — venue + date + pickup window. DRAGGABLE.
  drawInfoPanel(ctx, kit, {
    venue: inputs.venue,
    date: inputs.date,
    pickupTime: inputs.pickupTime,
  }, L.infoPanel.x, L.infoPanel.y, L.infoPanel.w, L.infoPanel.h);

  // 7. QR block — DRAGGABLE, independent of the info panel.
  if (inputs.qrImage && inputs.qrImage.complete && inputs.qrImage.naturalWidth > 0) {
    drawQrBlock(ctx, kit, inputs.qrImage, inputs.qrLabel || '',
      L.qrBlock.x, L.qrBlock.y, L.qrBlock.size);
  }

  // 8. Hashtag footer. DRAGGABLE + RESIZABLE.
  drawHashtagFooter(ctx, kit, inputs.hashtags || [],
    L.hashtagFooter.cx, L.hashtagFooter.cy, L.hashtagFooter.scale ?? 1, size.width);

  // 9. Coal-bed glow anchoring the bottom (or right edge for wide).
  //    Fixed brand chrome.
  const CR = size.coalBedRect;
  drawCoalBed(ctx, kit, CR.x, CR.y, CR.w, CR.h);

  // 10. Logo lockup. DRAGGABLE.
  drawLogoLockup(ctx, kit, inputs.logoImage, L.logo.cx, L.logo.cy, L.logo.r);

  // 11. Floating ember sparks — fixed brand chrome. Positions come
  //     from the active size (each size has its own spark distribution
  //     so the chrome stays balanced at any aspect).
  drawEmberSparks(ctx, kit, size.emberSparks);

  // 12. Whole-canvas paper grain — drawn last so it sits on top of
  //     everything for the printed-and-scanned look.
  drawPaperGrain(ctx, size.width, size.height);
}

// ─── individual layer helpers ──────────────────────────────────────────

function drawHeroBand(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  img: HTMLImageElement | null | undefined,
  x: number, y: number, w: number, h: number,
): void {
  if (img && img.complete && img.naturalWidth > 0) {
    // Object-fit cover crop maths — fill the band without distortion.
    const targetRatio = w / h;
    const sourceRatio = img.naturalWidth / img.naturalHeight;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (sourceRatio > targetRatio) {
      sw = img.naturalHeight * targetRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / targetRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    // Narrow the AI uncanny valley: pull saturation down a touch, push
    // a warm tone in (a tiny sepia bias), and bump contrast slightly.
    // The Canvas filter applies to drawImage only, not to subsequent
    // ops. Applied even to uploaded photos so AI and real share a look.
    ctx.save();
    ctx.filter = 'saturate(0.86) contrast(1.06) sepia(0.06)';
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();

    // Vignette + film grain over the hero — these soften the
    // "AI-render" smoothness that betrays the source. Skipped for the
    // fallback ember texture (it's not photographic).
    drawHeroVignette(ctx, x, y, w, h);
    applyFilmGrain(ctx, x, y, w, h, 0.08);
    return;
  }

  // Fallback ember-texture in brand colours: bottom-anchored radial
  // gradient pulsing primary against the brand background. Reads as
  // "photo step didn't finish" rather than a blank rectangle.
  ctx.fillStyle = kit.palette.backgroundDark;
  ctx.fillRect(x, y, w, h);

  const grad = ctx.createRadialGradient(w / 2, h, 50, w / 2, h, w * 0.7);
  grad.addColorStop(0, withAlpha(kit.palette.primary, 0.55));
  grad.addColorStop(0.5, withAlpha(kit.palette.primaryDark, 0.25));
  grad.addColorStop(1, withAlpha(kit.palette.background, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Warm flecks scattered higher up so the fallback doesn't read as
  // just a single bottom-anchored gradient.
  const flecks = [
    [0.22, 0.78, 80], [0.78, 0.72, 70], [0.45, 0.55, 60],
    [0.15, 0.45, 40], [0.85, 0.40, 50], [0.62, 0.30, 35],
  ] as const;
  for (const [fx, fy, fr] of flecks) {
    const g = ctx.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, fr);
    g.addColorStop(0, withAlpha(kit.palette.emberGlow, 0.40));
    g.addColorStop(1, withAlpha(kit.palette.emberHot, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  // Centred "AI hero will land here" placeholder so admin testing
  // without a hero call doesn't look broken.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.font = `700 28px "${kit.fonts.display}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HERO IMAGE', w / 2, h / 2);
}

function drawHeroFade(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  x: number, y: number, w: number, h: number,
  horizontal = false,
): void {
  // Vertical fade (square/story): top of rect → bottom transparent →
  // background. Horizontal fade (wide): left of rect transparent →
  // right of rect background. Same colour stops, different axis.
  const grad = horizontal
    ? ctx.createLinearGradient(x, 0, x + w, 0)
    : ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, withAlpha(kit.palette.background, 0));
  grad.addColorStop(0.7, withAlpha(kit.palette.background, 0.85));
  grad.addColorStop(1, kit.palette.background);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

function drawAccentSubhead(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  text: string,
  cx: number,
  cy: number,
  scale: number = 1,
): void {
  if (!text) return;
  const upper = text.toUpperCase();
  const fontSize = Math.round(26 * scale);
  const tracking = Math.max(2, Math.round(6 * scale));
  ctx.font = `700 ${fontSize}px "${kit.fonts.display}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = kit.palette.accent;
  drawTrackedText(ctx, upper, cx, cy, tracking);

  // Hairline length scales gently with the subhead so the strip stays
  // visually balanced at any size.
  const hairlineLen = Math.round(120 * scale);
  const hairlineGap = Math.round(20 * scale);
  const halfWidth = measureTrackedText(ctx, upper, tracking) / 2;
  ctx.strokeStyle = withAlpha(kit.palette.accent, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth - hairlineGap - hairlineLen, cy);
  ctx.lineTo(cx - halfWidth - hairlineGap, cy);
  ctx.moveTo(cx + halfWidth + hairlineGap, cy);
  ctx.lineTo(cx + halfWidth + hairlineGap + hairlineLen, cy);
  ctx.stroke();
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  text: string,
  cx: number,
  cy: number,
  scale: number = 1,
  maxWidth: number = CANVAS_SIZE - 120,
): void {
  const upper = text.toUpperCase();

  // Start from the user's chosen size (120 × scale) and only auto-
  // shrink if the headline still doesn't fit. So scale=1.5 with a
  // 3-word headline gives 180px text; scale=1 with a long headline
  // still autoshrinks to fit.
  const startSize = Math.round(120 * scale);
  let size = startSize;
  const minSize = Math.max(56, Math.round(56 * scale * 0.5));
  while (size > minSize) {
    ctx.font = `700 ${size}px "${kit.fonts.display}"`;
    if (ctx.measureText(upper).width <= maxWidth) break;
    size -= 4;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Softer outer glow — the heavy 40-blur stroke read like a design
  // system marketing poster. 18-blur at ~38% reads more like ink
  // bleeding into paper than a digital effect.
  ctx.save();
  ctx.shadowColor = withAlpha(kit.palette.primary, 0.38);
  ctx.shadowBlur = 18;
  ctx.fillStyle = 'rgba(0,0,0,0.001)';
  ctx.fillText(upper, cx, cy);
  ctx.restore();

  // Thinner primary stroke under the text fill. 3px reads as ink-edge
  // rather than the previous 6px which was unmistakably "digital
  // outline filter applied".
  ctx.strokeStyle = kit.palette.primary;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(upper, cx, cy);

  // Slightly warm off-white fill rather than pure #ffffff — pure white
  // is the AI-render giveaway; #f6f1ea reads as printed-on-paper.
  ctx.fillStyle = warmWhite(kit.palette.text);
  ctx.fillText(upper, cx, cy);

  // Dark drop-shadow for legibility on busy hero photos.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillText(upper, cx, cy);
  ctx.restore();
}

function drawBodyCopy(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  text: string,
  cx: number,
  yTop: number,
  maxWidth: number,
  scale: number = 1,
): void {
  const fontSize = Math.round(22 * scale);
  ctx.font = `400 ${fontSize}px "${kit.fonts.body}"`;
  ctx.fillStyle = kit.palette.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, text, maxWidth).slice(0, 3);
  const lineHeight = Math.round(30 * scale);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, yTop + i * lineHeight);
  }
}

function drawInfoPanel(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  info: { venue: string; date: string; pickupTime?: string },
  x: number, y: number, w: number, h: number,
): void {
  // Glass panel — semi-transparent surface with a hairline border.
  ctx.save();
  ctx.fillStyle = withAlpha(kit.palette.surface, 0.55);
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = withAlpha(kit.palette.text, 0.06);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Date pill on the left, accent-coloured.
  ctx.font = `700 20px "${kit.fonts.display}"`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = kit.palette.accent;
  ctx.textAlign = 'left';
  ctx.fillText(info.date.toUpperCase(), x + 24, y + 32);

  // Venue ALL-CAPS underneath the date.
  ctx.font = `700 32px "${kit.fonts.display}"`;
  ctx.fillStyle = kit.palette.text;
  ctx.fillText(info.venue.toUpperCase(), x + 24, y + 72);

  // Pickup window — right-aligned, primary-coloured. QR is no longer
  // rendered inside this panel; it's a separate draggable element that
  // can sit anywhere. So the pickup time always uses the panel's full
  // right edge.
  if (info.pickupTime) {
    ctx.font = `700 22px "${kit.fonts.display}"`;
    ctx.fillStyle = kit.palette.primary;
    ctx.textAlign = 'right';
    ctx.fillText(info.pickupTime.toUpperCase(), x + w - 24, y + h / 2);
  }
}

/**
 * Render a QR code on a white rounded plate with a small ALL-CAPS label
 * underneath. The white plate matters: dark backgrounds + transparent
 * QRs scan unreliably from printed posters and even some phone cameras.
 *
 * @param qrPx Side length of the QR image area in pixels (square).
 */
function drawQrBlock(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  qrImage: HTMLImageElement,
  label: string,
  x: number, y: number, qrPx: number,
): void {
  // White rounded plate behind the QR — 4px padding inset for breathing
  // room around the quiet zone the qrcode lib already produces.
  const platePad = 4;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x - platePad, y - platePad, qrPx + platePad * 2, qrPx + platePad * 2, 6);
  ctx.fill();
  ctx.restore();

  // The QR itself — drawn unfiltered (a film-grain overlay on a QR
  // would break scannability).
  ctx.drawImage(qrImage, x, y, qrPx, qrPx);

  // Tiny accent-coloured label below the plate. Falls back to no label
  // if the brand passed an empty string (some brands won't want one).
  if (label) {
    ctx.font = `700 11px "${kit.fonts.display}"`;
    ctx.fillStyle = kit.palette.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), x + qrPx / 2, y + qrPx + platePad + 4);
  }
}

function drawHashtagFooter(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  tags: string[],
  cx: number,
  cy: number,
  scale: number = 1,
  canvasWidth: number = CANVAS_SIZE,
): void {
  if (!tags.length) return;
  const cleaned = tags
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => (t.startsWith('#') ? t : `#${t}`))
    .slice(0, 12);

  ctx.fillStyle = kit.palette.textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const line = cleaned.join('  ');

  // Start from scaled size, only auto-shrink if still overflowing.
  // The 220px gutter (110 each side) leaves room for the logo on the
  // right and a small breathing space on the left — narrower canvases
  // (wide-format right column) get a proportionally smaller gutter.
  const gutter = canvasWidth < 800 ? 80 : 220;
  const startSize = Math.round(14 * scale);
  const minSize = Math.max(8, Math.round(10 * scale * 0.5));
  let fontSize = startSize;
  while (fontSize > minSize) {
    ctx.font = `600 ${fontSize}px "${kit.fonts.body}"`;
    if (ctx.measureText(line).width <= canvasWidth - gutter) break;
    fontSize -= 1;
  }
  ctx.fillText(line, cx, cy);
}

function drawCoalBed(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  x: number, y: number, w: number, h: number,
): void {
  const layer = (cx: number, cy: number, rx: number, ry: number, color: string) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };
  layer(w * 0.50, y + h, w * 0.60, h * 1.4, withAlpha(kit.palette.primaryDark, 0.55));
  layer(w * 0.30, y + h, w * 0.40, h * 1.0, withAlpha(kit.palette.emberWarm, 0.35));
  layer(w * 0.70, y + h, w * 0.35, h * 0.9, withAlpha(kit.palette.emberGlow, 0.30));
}

function drawLogoLockup(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  img: HTMLImageElement | null | undefined,
  cx: number, cy: number, r: number,
): void {
  // Ember halo behind the logo — three concentric soft glows in brand
  // ember colours.
  const halos: [number, string][] = [
    [r * 1.7, withAlpha(kit.palette.emberHot, 0.18)],
    [r * 1.4, withAlpha(kit.palette.emberWarm, 0.22)],
    [r * 1.1, withAlpha(kit.palette.emberGlow, 0.28)],
  ];
  for (const [radius, colour] of halos) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Brand-background plate.
  ctx.fillStyle = kit.palette.background;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = kit.palette.primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.clip();
    const size = (r - 4) * 2;
    const ratio = img.naturalWidth / img.naturalHeight;
    let dw = size, dh = size;
    if (ratio > 1) dw = size * ratio; else dh = size / ratio;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  } else {
    // Fallback brand-handle monogram if logo failed to load.
    ctx.fillStyle = kit.palette.primary;
    ctx.font = `700 28px "${kit.fonts.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(kit.shortHandle, cx, cy);
  }
}

function drawEmberSparks(
  ctx: CanvasRenderingContext2D,
  kit: PosterBrandKit,
  sparks: ReadonlyArray<readonly [number, number, number, number]>,
): void {
  // Fewer, smaller, lower-alpha sparks than v1 — 14 evenly-distributed
  // sparks read as procedural ("a designer drew this in After Effects").
  // 5-6 with irregular positions read as "the wind caught the pit".
  // Positions are now per-size (passed in from POSTER_SIZES) so the
  // sparks stay balanced at any aspect ratio.
  for (const [x, y, r, a] of sparks) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, withAlpha(kit.palette.emberGlow, a));
    g.addColorStop(0.5, withAlpha(kit.palette.emberHot, a * 0.5));
    g.addColorStop(1, withAlpha(kit.palette.emberHot, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 200, 100, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Hero-band-only vignette. Darkens the corners so the eye lands on
 * whatever the AI photo cared about, AND it kills the over-uniform
 * lighting that AI photos default to.
 */
function drawHeroVignette(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.25, cx, cy, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(0.7, 'rgba(0, 0, 0, 0.18)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// Cache the noise tile across calls — generating ImageData is the
// expensive bit; drawing the same tile repeatedly across a region is
// cheap. Lazy-initialised on first use.
let _noiseTile: HTMLCanvasElement | null = null;
function getNoiseTile(size = 128): HTMLCanvasElement {
  if (_noiseTile && _noiseTile.width === size) return _noiseTile;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const tctx = c.getContext('2d');
  if (!tctx) return c;
  const img = tctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // Random gray pixel with semi-random opacity — gives a non-uniform
    // grain that breaks up smooth gradients. Slight warm tilt so it
    // blends with the brand background rather than reading as a colder
    // digital noise.
    const g = 120 + Math.random() * 70;
    img.data[i]     = g + 8;   // R, slightly warmer
    img.data[i + 1] = g;       // G
    img.data[i + 2] = g - 6;   // B, slightly cooler so the warmth wins
    img.data[i + 3] = Math.random() * 60 + 30;
  }
  tctx.putImageData(img, 0, 0);
  _noiseTile = c;
  return c;
}

/**
 * Tile a low-opacity noise pattern over a rectangle. Adds the
 * imperfection of a printed-and-scanned poster without the cost of
 * generating noise at full image size.
 */
function applyFilmGrain(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  intensity: number,
): void {
  const tile = getNoiseTile(128);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, intensity));
  ctx.globalCompositeOperation = 'overlay';
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/**
 * Whole-canvas paper-grain overlay. Subtler than the hero grain — this
 * is the "printed on actual paper, not rendered" tell. Defaults to
 * 1080×1080 for the legacy API; the multi-size compose function passes
 * the active size's dims so the grain tiles correctly at any aspect.
 */
function drawPaperGrain(ctx: CanvasRenderingContext2D, w: number = CANVAS_SIZE, h: number = CANVAS_SIZE): void {
  applyFilmGrain(ctx, 0, 0, w, h, 0.04);
}

/**
 * Convert a pure-white text colour to a slightly warm off-white. Pure
 * #ffffff is the AI render giveaway. Returns the input unchanged if
 * the brand text colour isn't pure white (i.e. the brand already
 * chose a tinted text colour, respect it).
 */
function warmWhite(hex: string): string {
  return hex.toLowerCase() === '#ffffff' ? '#f6f1ea' : hex;
}

// ─── small primitives ─────────────────────────────────────────────────

/** Draw text with per-character tracking (Canvas has no letter-spacing). */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number, cy: number,
  trackPx: number,
): void {
  const width = measureTrackedText(ctx, text, trackPx);
  let x = cx - width / 2;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    ctx.textAlign = 'left';
    ctx.fillText(ch, x, cy);
    x += w + trackPx;
  }
}

function measureTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  trackPx: number,
): number {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + trackPx;
  return total - trackPx;
}

/** Greedy word-wrap for body copy. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Path a rounded rectangle for fill or stroke. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Convert a `#rrggbb` hex string to `rgba(r, g, b, a)`. Used everywhere
 * the compositor needs to apply an opacity to a brand-kit colour.
 */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
