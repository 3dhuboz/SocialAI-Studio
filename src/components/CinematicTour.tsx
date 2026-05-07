import React from 'react';
import { CLIENT } from '../client.config';
import { Play } from 'lucide-react';

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
              // CSS-only cinematic placeholder. Slow gradient shift + grain
              // suggests "footage loading" without looking broken.
              <div className="absolute inset-0">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-rose-500/10 to-purple-500/30" style={{ animation: 'float 10s ease-in-out infinite' }} />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgba(255,255,255,0.12),transparent_55%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_70%,rgba(245,158,11,0.18),transparent_55%)]" />
                <div className="absolute inset-0 grain-bg opacity-50" />
                <div className="absolute bottom-5 right-5 text-[10px] sm:text-[11px] text-white/45 bg-black/40 px-3 py-1.5 rounded-lg backdrop-blur-sm tracking-[0.12em] font-bold uppercase">
                  Tour video · coming soon
                </div>
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
