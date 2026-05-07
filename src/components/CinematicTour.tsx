import React, { useState, useEffect, useRef } from 'react';
import { CLIENT } from '../client.config';
import {
  Play, Sparkles, FastForward, RotateCcw, ArrowRight, Check,
  Heart, MessageCircle, Building2, MapPin, Tag,
} from 'lucide-react';

/**
 * CinematicTour — atmospheric "movie poster" frame between the gallery and
 * the close. Three render modes inside the frame:
 *
 *   1. YouTube — if CLIENT.youtubeVideoId is set, shows the maxres thumbnail
 *      and bubbles the click to onPlay so the parent opens its lightbox.
 *
 *   2. Idle placeholder — the design-tool dot-grid + floating mini-mockups
 *      composition. Shown until the user clicks Play.
 *
 *   3. Interactive tour — when the user clicks Play and there's no video,
 *      the frame transforms into a scripted 4-scene walk-through:
 *        01 · "Tell us about your business" — form fields type themselves in
 *        02 · "AI writes captions" — three post cards materialise
 *        03 · "Scheduled across the week" — pins drop into a 7-day grid
 *        04 · "Goes live, engagement rolls in" — likes counter ticks up
 *      Then an end-screen with Replay + Start-trial CTAs. ~18s total.
 *
 * The point: clicking Play actually does something even before there's a
 * recorded video. The product demonstrates itself.
 */

const SCENE_DURATIONS_MS = [4500, 5500, 4000, 4500] as const;
const TOTAL_SCENES = SCENE_DURATIONS_MS.length;

interface Props {
  /** Called when the user clicks Play AND a YouTube video is configured. */
  onPlay: () => void;
  /** Called when the end-screen CTA fires — typically routes to sign-up. */
  onSignIn?: () => void;
}

export const CinematicTour: React.FC<Props> = ({ onPlay, onSignIn }) => {
  const hasVideo = !!CLIENT.youtubeVideoId;
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = () => {
    if (hasVideo) onPlay();
    else setIsPlaying(true);
  };

  return (
    <section className="relative py-20 sm:py-28 px-6 overflow-hidden">
      {/* Atmospheric dual-radial backdrop. Wider than the hero's, more
          purple than orange — gives the section a different mood. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(60,30,110,0.32),transparent_65%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_85%,rgba(245,158,11,0.08),transparent_55%)]" />

      <div className="relative max-w-5xl mx-auto">
        {/* Editorial label + headline */}
        <div className="text-center mb-10 sm:mb-14">
          <div className="inline-flex items-center justify-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.22em] text-white/45 uppercase mb-5">
            <span className="w-8 h-px bg-white/25" />
            See it in motion
            <span className="w-8 h-px bg-white/25" />
          </div>
          <h2 className="text-3xl sm:text-5xl md:text-[3.5rem] font-black tracking-[-0.02em] leading-[1.04]">
            <span className="block text-white">A 90-second</span>
            <span className="block italic font-serif font-light text-white/55 pt-1">
              walk-through.
            </span>
          </h2>
        </div>

        {/* Video frame — big cinematic shadow + warm glow ring underneath */}
        <div className="relative">
          <div
            className="relative w-full aspect-video rounded-3xl overflow-hidden border border-white/10 shadow-[0_50px_140px_-40px_rgba(0,0,0,0.9),0_0_80px_-20px_rgba(245,158,11,0.18)] bg-[#0a0a14]"
          >
            {isPlaying && !hasVideo ? (
              <TourPlayer
                onExit={() => setIsPlaying(false)}
                onCTA={() => {
                  setIsPlaying(false);
                  onSignIn?.();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={handlePlay}
                className="group absolute inset-0 cursor-pointer"
                aria-label={hasVideo ? 'Play 90-second tour' : 'Start interactive product tour'}
              >
                {hasVideo ? (
                  <>
                    <img
                      src={`https://img.youtube.com/vi/${CLIENT.youtubeVideoId}/maxresdefault.jpg`}
                      alt="Tour video"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/35 group-hover:bg-black/15 transition" />
                  </>
                ) : (
                  <PlaceholderArt />
                )}
                {/* Play button — large, weighty, cinematic shadow */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white/95 group-hover:scale-110 transition-transform duration-500 flex items-center justify-center shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7)]">
                    <Play size={32} className="text-black ml-1.5" fill="black" />
                  </div>
                </div>
              </button>
            )}
          </div>
          {/* Soft amber reflection underneath the frame — gives it weight */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-40 bg-amber-500/15 blur-3xl rounded-full pointer-events-none" />
        </div>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// PlaceholderArt — the idle "AI assembling tour" composition. Shown before
// the user clicks Play. Layered: dot-grid backdrop, three floating mini
// mockups, warm radial glow, scanline sweep, top-left badge.
// ──────────────────────────────────────────────────────────────────────────

const PlaceholderArt: React.FC = () => (
  <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a18] via-[#15121f] to-[#0d0d18]">
    {/* Dot grid — design-tool aesthetic */}
    <div
      className="absolute inset-0 opacity-30"
      style={{
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    />
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(245,158,11,0.18),transparent_55%)]" />
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_25%,rgba(168,85,247,0.16),transparent_50%)]" />
    {/* Floating mini-mockup cards — three corners, leaving the centre clear
        for the play button. Each tilts a few degrees and bobs on its own
        offset float timing. */}
    <MiniPostCard
      pos="top-[10%] left-[6%]"
      rot="-rotate-6"
      gradient="from-amber-200 via-orange-200 to-rose-300"
      emoji="🥐"
      delay="0s"
    />
    <MiniPostCard
      pos="bottom-[10%] right-[6%] hidden sm:block"
      rot="rotate-6"
      gradient="from-pink-300 via-rose-300 to-purple-300"
      emoji="✂️"
      delay="-2s"
    />
    <MiniPostCard
      pos="top-[12%] right-[8%] hidden md:block"
      rot="rotate-3"
      gradient="from-sky-300 via-blue-300 to-cyan-200"
      emoji="🔧"
      delay="-4s"
    />
    {/* Vertical scanline sweep */}
    <div
      className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-amber-400/60 to-transparent"
      style={{ animation: 'scanline 6s linear infinite' }}
    />
    {/* Top-left "click to start" badge — flips the framing from "loading"
        to "press play". */}
    <div className="absolute top-5 left-5 inline-flex items-center gap-2 bg-black/40 border border-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full">
      <Sparkles size={11} className="text-amber-300 animate-pulse" />
      <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.16em] text-white/65 uppercase">
        Click to start tour
      </span>
    </div>
    {/* Bottom-right "interactive · ~18s" — sets expectation: it's a real
        thing that runs, not a coming-soon stub. */}
    <div className="absolute bottom-5 right-5 text-[10px] sm:text-[11px] text-white/55 bg-black/50 border border-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm tracking-[0.12em] font-bold uppercase">
      Interactive · ~18s
    </div>
    <div className="absolute inset-0 grain-bg opacity-40 pointer-events-none" />
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// MiniPostCard — tiny post-mockup chip used inside the placeholder.
// ──────────────────────────────────────────────────────────────────────────

const MiniPostCard: React.FC<{
  pos: string;
  rot: string;
  gradient: string;
  emoji: string;
  delay: string;
}> = ({ pos, rot, gradient, emoji, delay }) => (
  <div
    className={`absolute ${pos} ${rot} w-[110px] sm:w-[130px] bg-white rounded-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] overflow-hidden border border-white/40`}
    style={{ animation: 'float 6s ease-in-out infinite', animationDelay: delay }}
  >
    <div className={`w-full aspect-square bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
      <span className="text-3xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.15)]">{emoji}</span>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.4),transparent_50%)]" />
    </div>
    <div className="px-2 py-2 space-y-1">
      <div className="h-1.5 w-full bg-gray-200 rounded-full" />
      <div className="h-1.5 w-3/4 bg-gray-200 rounded-full" />
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// TourPlayer — drives scene scheduling, chrome (counter, skip, progress),
// and renders the active scene. ESC exits.
// ──────────────────────────────────────────────────────────────────────────

const TourPlayer: React.FC<{ onExit: () => void; onCTA: () => void }> = ({ onExit, onCTA }) => {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [ended, setEnded] = useState(false);

  // Auto-advance: each scene runs for SCENE_DURATIONS_MS[sceneIdx], then
  // either advances or flips to ended.
  useEffect(() => {
    if (ended) return;
    const t = setTimeout(() => {
      setSceneIdx(i => {
        if (i >= TOTAL_SCENES - 1) {
          setEnded(true);
          return i;
        }
        return i + 1;
      });
    }, SCENE_DURATIONS_MS[sceneIdx]);
    return () => clearTimeout(t);
  }, [sceneIdx, ended]);

  // ESC to exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const replay = () => {
    setEnded(false);
    setSceneIdx(0);
  };

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a18] via-[#15121f] to-[#0d0d18]">
      {/* Subtle dot-grid backdrop — same language as placeholder so the
          transition into the tour feels like the same world, not a context
          switch. */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(245,158,11,0.10),transparent_60%)]" />

      {/* Scene counter (top-left) + Skip (top-right) — always visible while
          the tour runs so the user knows where they are and how to bail. */}
      {!ended && (
        <div className="absolute top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 flex items-start justify-between gap-3 z-20">
          <div className="flex items-center gap-2 bg-black/55 backdrop-blur-sm border border-white/10 rounded-full pl-1.5 pr-3 py-1">
            <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-400/15 rounded-full w-5 h-5 inline-flex items-center justify-center">
              {String(sceneIdx + 1).padStart(2, '0')}
            </span>
            <span className="text-[10px] font-bold tracking-[0.14em] text-white/55 uppercase">
              of {String(TOTAL_SCENES).padStart(2, '0')}
            </span>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 bg-black/55 backdrop-blur-sm border border-white/10 hover:border-white/30 transition rounded-full px-3 py-1 text-[10px] font-bold tracking-[0.12em] text-white/60 hover:text-white uppercase"
            aria-label="Skip tour"
          >
            <FastForward size={11} /> Skip
          </button>
        </div>
      )}

      {/* Scene stage — all four scenes mounted, cross-fade between active.
          Mounting all of them up-front means animations stay aligned with
          the scene's own clock (we don't depend on remount timing). */}
      <div className="absolute inset-0">
        <SceneFillForm isActive={!ended && sceneIdx === 0} />
        <SceneAIWrites isActive={!ended && sceneIdx === 1} />
        <SceneScheduleWeek isActive={!ended && sceneIdx === 2} />
        <ScenePostsLive isActive={!ended && sceneIdx === 3} />
        {ended && <EndScreen onReplay={replay} onCTA={onCTA} />}
      </div>

      {/* Per-scene progress bar — fills over the scene's duration. The `key`
          prop forces a fresh CSS animation on every scene change. */}
      {!ended && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/5 z-20 overflow-hidden">
          <div
            key={sceneIdx}
            className="h-full bg-gradient-to-r from-amber-400 to-orange-400 origin-left"
            style={{
              animation: `tour-progress ${SCENE_DURATIONS_MS[sceneIdx]}ms linear both`,
            }}
          />
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Scene shell — every scene fades + slightly scales between active states.
// Inactive scenes stay mounted (so internal timers run from "scene start")
// but are hidden from screen readers and cannot be interacted with.
// ──────────────────────────────────────────────────────────────────────────

const SceneShell: React.FC<{ isActive: boolean; children: React.ReactNode }> = ({ isActive, children }) => (
  <div
    className="absolute inset-0 flex items-center justify-center transition-all duration-700 ease-out"
    style={{
      opacity: isActive ? 1 : 0,
      transform: isActive ? 'scale(1)' : 'scale(0.96)',
      pointerEvents: isActive ? 'auto' : 'none',
    }}
    aria-hidden={!isActive}
  >
    {children}
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// Scene 01 — "Tell us about your business"
// Three form fields type themselves in, then a green "Saved" pill appears.
// ──────────────────────────────────────────────────────────────────────────

const SceneFillForm: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <SceneShell isActive={isActive}>
    <div className="w-full max-w-md sm:max-w-lg px-6 sm:px-8 text-center">
      <SceneEyebrow tone="amber" icon={Sparkles}>Step 01</SceneEyebrow>
      <h3 className="text-xl sm:text-3xl font-black tracking-tight text-white mb-1.5">
        Tell us about your business.
      </h3>
      <p className="text-xs sm:text-sm text-white/45 mb-6 sm:mb-8">60 seconds. Once.</p>

      <div className="space-y-2.5 text-left">
        <FormFieldTyping
          isActive={isActive}
          icon={Building2}
          label="Business name"
          value="Bella's Cafe"
          startDelayMs={300}
          durationMs={650}
        />
        <FormFieldTyping
          isActive={isActive}
          icon={Tag}
          label="Industry"
          value="Cafe & Bakery"
          startDelayMs={1100}
          durationMs={700}
        />
        <FormFieldTyping
          isActive={isActive}
          icon={MapPin}
          label="Location"
          value="Byron Bay, NSW"
          startDelayMs={2000}
          durationMs={750}
        />
      </div>

      <div
        className="mt-6 sm:mt-7 inline-flex items-center gap-2 bg-emerald-500/95 text-black font-black px-4 py-2 rounded-full text-xs sm:text-sm transition-all duration-500 ease-out"
        style={{
          opacity: isActive ? 1 : 0,
          transform: isActive ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.96)',
          transitionDelay: isActive ? '3500ms' : '0ms',
        }}
      >
        <Check size={14} strokeWidth={3} /> Saved
      </div>
    </div>
  </SceneShell>
);

const FormFieldTyping: React.FC<{
  isActive: boolean;
  icon: React.ElementType;
  label: string;
  value: string;
  startDelayMs: number;
  durationMs: number;
}> = ({ isActive, icon: Icon, label, value, startDelayMs, durationMs }) => {
  const typed = useTypewriter(isActive ? value : '', durationMs, startDelayMs);
  const showCursor = isActive && typed.length < value.length;
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.14em] text-white/40 uppercase mb-1">
        <Icon size={10} /> {label}
      </div>
      <div className="font-mono text-sm sm:text-[15px] text-white min-h-[1.25rem] flex items-center">
        <span>{typed || ' '}</span>
        {showCursor && (
          <span className="inline-block w-[1px] h-4 bg-amber-300 ml-0.5 animate-pulse" />
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Scene 02 — "AI writes captions"
// Three real post mockups materialise in sequence with stagger.
// ──────────────────────────────────────────────────────────────────────────

const TOUR_POSTS = [
  {
    gradient: 'from-amber-200 via-orange-200 to-rose-300',
    emoji: '🥐',
    caption: "Sunday treat — cinnamon scrolls fresh from the oven, open till 2.",
    img: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=320&h=320&fit=crop&q=70&auto=format',
  },
  {
    gradient: 'from-pink-300 via-rose-300 to-purple-300',
    emoji: '✂️',
    caption: "Sarah's July diary is open — gloss, balayage, the lot.",
    img: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=320&h=320&fit=crop&q=70&auto=format',
  },
  {
    gradient: 'from-sky-300 via-blue-300 to-cyan-200',
    emoji: '🔧',
    caption: 'Hot water gone? Same-day callouts across Brisbane. No callout fee.',
    img: 'https://images.unsplash.com/photo-1607400201515-c2c41c07d307?w=320&h=320&fit=crop&q=70&auto=format',
  },
];

const SceneAIWrites: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <SceneShell isActive={isActive}>
    <div className="w-full max-w-3xl px-6 text-center">
      <SceneEyebrow tone="amber" icon={Sparkles} pulse>Step 02</SceneEyebrow>
      <h3 className="text-xl sm:text-3xl font-black tracking-tight text-white mb-1.5">
        AI writes captions, designs images.
      </h3>
      <p className="text-xs sm:text-sm text-white/45 mb-6 sm:mb-8">
        In your tone. Across every industry.
      </p>

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {TOUR_POSTS.map((post, i) => (
          <TourMiniPost
            key={i}
            isActive={isActive}
            delayMs={300 + i * 700}
            {...post}
          />
        ))}
      </div>
    </div>
  </SceneShell>
);

const TourMiniPost: React.FC<{
  isActive: boolean;
  delayMs: number;
  gradient: string;
  emoji: string;
  caption: string;
  img: string;
}> = ({ isActive, delayMs, gradient, emoji, caption, img }) => (
  <div
    className="bg-white rounded-xl overflow-hidden text-gray-900 text-left shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] transition-all duration-500 ease-out"
    style={{
      opacity: isActive ? 1 : 0,
      transform: isActive ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.94)',
      transitionDelay: isActive ? `${delayMs}ms` : '0ms',
    }}
  >
    <div className={`relative aspect-square bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
      <span className="text-4xl sm:text-5xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.15)]">{emoji}</span>
      <img
        src={img}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
    <div className="px-2.5 pt-2 pb-2.5">
      <div className="flex items-center gap-2 mb-1.5 text-gray-700">
        <Heart size={11} className="text-rose-500 fill-rose-500" />
        <MessageCircle size={11} strokeWidth={1.8} />
      </div>
      <p className="text-[9.5px] sm:text-[10.5px] leading-snug text-gray-700 line-clamp-2">{caption}</p>
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// Scene 03 — "Scheduled across the week"
// 7-day grid, four days fill with pins + timestamps in sequence.
// ──────────────────────────────────────────────────────────────────────────

const SCHEDULE_DAYS: { day: string; time: string; emoji: string; filled: boolean; delayMs: number }[] = [
  { day: 'Mon', time: '9:00 am',  emoji: '🥐', filled: true,  delayMs: 400 },
  { day: 'Tue', time: '',         emoji: '',   filled: false, delayMs: 0 },
  { day: 'Wed', time: '12:30 pm', emoji: '✂️', filled: true,  delayMs: 900 },
  { day: 'Thu', time: '',         emoji: '',   filled: false, delayMs: 0 },
  { day: 'Fri', time: '4:15 pm',  emoji: '🔧', filled: true,  delayMs: 1400 },
  { day: 'Sat', time: '',         emoji: '',   filled: false, delayMs: 0 },
  { day: 'Sun', time: '8:00 am',  emoji: '☕', filled: true,  delayMs: 1900 },
];

const SceneScheduleWeek: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <SceneShell isActive={isActive}>
    <div className="w-full max-w-3xl px-6 text-center">
      <SceneEyebrow tone="amber" icon={Sparkles}>Step 03</SceneEyebrow>
      <h3 className="text-xl sm:text-3xl font-black tracking-tight text-white mb-1.5">
        Scheduled across the week.
      </h3>
      <p className="text-xs sm:text-sm text-white/45 mb-6 sm:mb-8">
        When your customers actually scroll.
      </p>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {SCHEDULE_DAYS.map((d, i) => (
          <div
            key={i}
            className={`relative aspect-[3/4] rounded-lg border flex flex-col items-center justify-between p-1.5 sm:p-2.5 ${
              d.filled
                ? 'border-amber-400/40 bg-amber-400/[0.06]'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <div className="text-[8.5px] sm:text-[10px] font-bold tracking-[0.12em] text-white/55 uppercase">
              {d.day}
            </div>
            {d.filled ? (
              <div
                className="flex flex-col items-center gap-0.5 sm:gap-1 transition-all duration-500 ease-out"
                style={{
                  opacity: isActive ? 1 : 0,
                  transform: isActive ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(0.5)',
                  transitionDelay: isActive ? `${d.delayMs}ms` : '0ms',
                }}
              >
                <span className="text-base sm:text-2xl">{d.emoji}</span>
                <span className="text-[7.5px] sm:text-[10px] font-mono text-amber-200/85 whitespace-nowrap">
                  {d.time}
                </span>
              </div>
            ) : (
              <span className="text-white/15 text-xs sm:text-base font-mono">·</span>
            )}
          </div>
        ))}
      </div>
    </div>
  </SceneShell>
);

// ──────────────────────────────────────────────────────────────────────────
// Scene 04 — "Goes live, engagement rolls in"
// One post card, "Posted to Facebook" badge slides in, likes/comments tick.
// ──────────────────────────────────────────────────────────────────────────

const ScenePostsLive: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const likes = useCountUp(isActive, 0, 47, 2200, 800);
  const comments = useCountUp(isActive, 0, 8, 1800, 1400);

  return (
    <SceneShell isActive={isActive}>
      <div className="w-full max-w-md px-6 text-center">
        <SceneEyebrow tone="emerald" icon={Check}>Step 04</SceneEyebrow>
        <h3 className="text-xl sm:text-3xl font-black tracking-tight text-white mb-1.5">
          Goes live. Engagement rolls in.
        </h3>
        <p className="text-xs sm:text-sm text-white/45 mb-5 sm:mb-7">
          You sleep. We post. They scroll.
        </p>

        <div className="relative bg-white rounded-2xl overflow-hidden text-gray-900 text-left shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] mx-auto max-w-[260px] sm:max-w-[300px]">
          {/* "Posted to Facebook ✓" badge — slides in from above */}
          <div
            className="absolute -top-3 right-3 z-10 inline-flex items-center gap-1.5 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full shadow-[0_8px_24px_-6px_rgba(16,185,129,0.5)] transition-all duration-500 ease-out"
            style={{
              opacity: isActive ? 1 : 0,
              transform: isActive ? 'translateY(0) scale(1)' : 'translateY(-12px) scale(0.6)',
              transitionDelay: isActive ? '400ms' : '0ms',
            }}
          >
            <Check size={11} strokeWidth={3} /> Posted
          </div>

          <div className="aspect-square bg-gradient-to-br from-amber-200 via-orange-200 to-rose-300 relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center text-6xl sm:text-7xl">🥐</div>
            <img
              src="https://images.unsplash.com/photo-1551024601-bec78aea704b?w=520&h=520&fit=crop&q=70&auto=format"
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>

          <div className="px-3 pt-2.5 pb-3">
            <div className="flex items-center gap-3 mb-1.5">
              <div className="flex items-center gap-1">
                <Heart size={15} className="text-rose-500 fill-rose-500" />
                <span className="text-[12px] font-bold text-gray-900 tabular-nums">{likes}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-700">
                <MessageCircle size={15} strokeWidth={1.8} />
                <span className="text-[12px] font-bold text-gray-900 tabular-nums">{comments}</span>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-gray-700">
              Sunday treat — cinnamon scrolls fresh from the oven, open till 2.
            </p>
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// EndScreen — appears after the last scene. Stays until the user acts.
// "Start your free trial" routes to onCTA; "Replay" restarts the tour.
// ──────────────────────────────────────────────────────────────────────────

const EndScreen: React.FC<{ onReplay: () => void; onCTA: () => void }> = ({ onReplay, onCTA }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_55%,rgba(245,158,11,0.18),transparent_60%)] animate-fadeSlideUp">
    <div className="text-center px-6 max-w-md">
      <div className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] text-emerald-300/85 uppercase mb-4">
        <Check size={12} strokeWidth={3} /> That's it
      </div>
      <h3 className="text-2xl sm:text-4xl font-black tracking-tight text-white mb-2.5 leading-tight">
        Your social,<br className="sm:hidden" /> on autopilot.
      </h3>
      <p className="text-xs sm:text-sm text-white/55 mb-6 max-w-sm mx-auto">
        {CLIENT.freeTrialPosts ?? 3} free posts. No card. No setup fee.
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onCTA}
          className="group inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-5 sm:px-6 py-3 rounded-2xl text-xs sm:text-sm hover:opacity-90 transition shadow-[0_20px_50px_-10px_rgba(245,158,11,0.5)]"
        >
          Start your free trial
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="inline-flex items-center gap-1.5 border border-white/15 hover:border-white/35 transition rounded-2xl px-4 py-3 text-xs sm:text-sm font-bold text-white/65 hover:text-white"
        >
          <RotateCcw size={13} /> Replay
        </button>
      </div>
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────────

const SceneEyebrow: React.FC<{
  tone: 'amber' | 'emerald';
  icon: React.ElementType;
  pulse?: boolean;
  children: React.ReactNode;
}> = ({ tone, icon: Icon, pulse, children }) => {
  const colour = tone === 'amber' ? 'text-amber-300/85' : 'text-emerald-300/85';
  return (
    <div className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] uppercase mb-3.5 ${colour}`}>
      <Icon size={11} className={pulse ? 'animate-pulse' : ''} strokeWidth={tone === 'emerald' ? 3 : 2} />
      {children}
    </div>
  );
};

/** Typewriter — reveals `text` one character at a time over `durationMs`,
 *  starting after `startDelayMs`. Resets when `text` becomes empty (which
 *  happens when the parent scene becomes inactive). */
function useTypewriter(text: string, durationMs: number, startDelayMs = 0): string {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    if (!text) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      const charDelay = Math.max(20, durationMs / Math.max(1, text.length));
      let i = 0;
      interval = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          if (interval) clearInterval(interval);
          interval = null;
        }
      }, charDelay);
    }, startDelayMs);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, durationMs, startDelayMs]);
  return displayed;
}

/** CountUp — animates `from → to` over `durationMs` with easeOutCubic,
 *  starting after `startDelayMs`. Resets to `from` when inactive. */
function useCountUp(active: boolean, from: number, to: number, durationMs: number, startDelayMs = 0): number {
  const [val, setVal] = useState(from);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    setVal(from);
    if (!active) return;
    const start = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        setVal(Math.round(from + (to - from) * eased));
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, startDelayMs);
    return () => {
      clearTimeout(start);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, from, to, durationMs, startDelayMs]);
  return val;
}
