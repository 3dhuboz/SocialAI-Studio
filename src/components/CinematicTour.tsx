import React from 'react';
import { CLIENT } from '../client.config';
import { Play, Sparkles } from 'lucide-react';

/**
 * CinematicTour — atmospheric "movie poster" moment between the gallery
 * and the close. Large 16:9 video frame with cinematic shadow + glow.
 *
 * Two render paths:
 *   • If CLIENT.youtubeVideoId is set, shows the maxres thumbnail with a
 *     play button. Click bubbles to onPlay so the parent can open the
 *     existing lightbox.
 *   • If no video is configured, renders an animated CSS placeholder so
 *     the section doesn't read as broken — slow gradient shift, grain
 *     overlay, "coming soon" chip in the corner. Drop a real video into
 *     CLIENT.youtubeVideoId and this slot becomes the production tour.
 *
 * Props:
 *   onPlay — fires when the user clicks the frame. Parent owns lightbox state.
 */
interface Props {
  onPlay: () => void;
}

export const CinematicTour: React.FC<Props> = ({ onPlay }) => {
  const hasVideo = !!CLIENT.youtubeVideoId;

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
          <button
            onClick={onPlay}
            className="group relative w-full aspect-video rounded-3xl overflow-hidden border border-white/10 shadow-[0_50px_140px_-40px_rgba(0,0,0,0.9),0_0_80px_-20px_rgba(245,158,11,0.18)] block bg-[#0a0a14]"
            aria-label={hasVideo ? 'Play 90-second tour' : 'Tour video coming soon'}
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
              // Cinematic placeholder — meant to feel like a behind-the-scenes
              // "the AI is assembling your tour" moment, not a broken video
              // slot. Layered: dot-grid backdrop (Figma-board feel), floating
              // mini post mockups (the work being done), warm radial glow,
              // slow vertical scanline, top-left "AI assembling" badge.
              <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a18] via-[#15121f] to-[#0d0d18]">
                {/* Dot grid — design-tool aesthetic */}
                <div
                  className="absolute inset-0 opacity-30"
                  style={{
                    backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
                    backgroundSize: '22px 22px',
                  }}
                />
                {/* Warm radial glow centred on play button */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(245,158,11,0.18),transparent_55%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_25%,rgba(168,85,247,0.16),transparent_50%)]" />
                {/* Floating mini-mockup cards — three corners, leaving the
                    centre clear for the play button. Each tilts a few degrees
                    and bobs on its own offset float timing. */}
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
                {/* Vertical scanline — slow film-leader sweep across the
                    frame. 1px bar animates `left: 0 -> 100%` over 6s. */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-amber-400/60 to-transparent"
                  style={{ animation: 'scanline 6s linear infinite' }}
                />
                {/* Top-left "assembling" badge — frames the placeholder as
                    intentional ("AI is preparing your tour") not broken. */}
                <div className="absolute top-5 left-5 inline-flex items-center gap-2 bg-black/40 border border-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full">
                  <Sparkles size={11} className="text-amber-300 animate-pulse" />
                  <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.16em] text-white/65 uppercase">
                    AI assembling tour
                  </span>
                </div>
                {/* Bottom-right "coming soon" chip */}
                <div className="absolute bottom-5 right-5 text-[10px] sm:text-[11px] text-white/55 bg-black/50 border border-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm tracking-[0.12em] font-bold uppercase">
                  Tour video · coming soon
                </div>
                {/* Subtle grain overlay so the whole frame doesn't feel like
                    flat vector art */}
                <div className="absolute inset-0 grain-bg opacity-40 pointer-events-none" />
              </div>
            )}
            {/* Play button — large, weighty, cinematic shadow */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white/95 group-hover:scale-110 transition-transform duration-500 flex items-center justify-center shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7)]">
                <Play size={32} className="text-black ml-1.5" fill="black" />
              </div>
            </div>
          </button>
          {/* Soft amber reflection underneath the frame — gives it weight */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-40 bg-amber-500/15 blur-3xl rounded-full pointer-events-none" />
        </div>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// MiniPostCard — tiny post-mockup chip used inside the placeholder. Just
// a gradient square with an emoji + faux caption lines. Animated with
// `float` so the whole composition feels alive.
// ──────────────────────────────────────────────────────────────────────────

const MiniPostCard: React.FC<{
  pos: string;        // Tailwind absolute-positioning class
  rot: string;        // Tailwind rotate class
  gradient: string;   // Tailwind gradient color stops
  emoji: string;
  delay: string;      // CSS animation-delay (e.g. '-2s')
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
