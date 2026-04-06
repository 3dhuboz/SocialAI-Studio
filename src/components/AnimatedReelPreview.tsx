import React from 'react';

interface AnimatedReelPreviewProps {
  hookText?: string;
  mood?: string;
  size?: 'sm' | 'md';
  onClick?: () => void;
  className?: string;
}

export const AnimatedReelPreview: React.FC<AnimatedReelPreviewProps> = ({
  hookText = '',
  mood,
  size = 'md',
  onClick,
  className = '',
}) => {
  const w = size === 'sm' ? 'w-20' : 'w-24';
  const h = size === 'sm' ? 'h-32' : 'h-40';

  return (
    <div
      className={`${w} ${h} rounded-xl flex-shrink-0 overflow-hidden relative border border-purple-500/30 shadow-lg shadow-purple-900/30 glass ${onClick ? 'cursor-pointer group/reel' : ''} ${className}`}
      style={{ background: 'linear-gradient(160deg,#2d1b69 0%,#1a0a3a 40%,#0d0d1a 100%)' }}
      onClick={onClick}
    >
      <style>{`
        @keyframes reel-bg-shift {
          0%   { opacity: 0.55; transform: scale(1)    translateY(0); }
          50%  { opacity: 0.80; transform: scale(1.06) translateY(-4px); }
          100% { opacity: 0.55; transform: scale(1)    translateY(0); }
        }
        @keyframes reel-scan {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(200%); }
        }
        @keyframes reel-text-in {
          0%,100% { opacity: 0;   transform: translateY(6px); }
          20%,80% { opacity: 1;   transform: translateY(0); }
        }
        @keyframes reel-pulse {
          0%,100% { transform: scale(1);    opacity: 0.7; }
          50%      { transform: scale(1.15); opacity: 1; }
        }
        @keyframes reel-bar {
          0%   { width: 0%; }
          100% { width: 100%; }
        }
        @keyframes reel-dot {
          0%,100% { opacity: 0.3; transform: scaleY(0.4); }
          50%     { opacity: 1;   transform: scaleY(1); }
        }
      `}</style>

      {/* Animated gradient background blob */}
      <div
        className="absolute inset-0 rounded-xl"
        style={{
          background: 'radial-gradient(ellipse at 30% 40%, rgba(147,51,234,0.45) 0%, transparent 70%), radial-gradient(ellipse at 70% 70%, rgba(79,70,229,0.35) 0%, transparent 60%)',
          animation: 'reel-bg-shift 3s ease-in-out infinite',
        }}
      />

      {/* Scanline sweep */}
      <div
        className="absolute left-0 right-0 h-8 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.06), transparent)',
          animation: 'reel-scan 3s linear infinite',
        }}
      />

      {/* Top bar */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20">
        <span className="text-[8px] bg-purple-500/70 text-white font-black px-1.5 py-0.5 rounded-full backdrop-blur-sm">REEL</span>
        <div className="flex gap-0.5 items-end">
          {[1, 2, 3, 4].map(n => (
            <div
              key={n}
              className="w-0.5 bg-white/60 rounded-full"
              style={{
                height: `${4 + n * 2}px`,
                animation: `reel-dot ${0.6 + n * 0.15}s ease-in-out ${n * 0.1}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Centre play button (pulsing) */}
      <div className="absolute inset-0 flex items-center justify-center z-20">
        <div
          className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm border border-white/30 flex items-center justify-center"
          style={{ animation: 'reel-pulse 3s ease-in-out infinite' }}
        >
          <span className="text-white text-sm ml-0.5">▶</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-10 left-0 right-0 h-0.5 bg-white/10 z-20">
        <div
          className="h-full bg-purple-400/80 rounded-full"
          style={{ animation: 'reel-bar 3s linear infinite' }}
        />
      </div>

      {/* Bottom caption */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-5 z-20">
        {hookText && (
          <p
            className="text-[7px] text-white/90 leading-tight font-semibold line-clamp-2"
            style={{ animation: 'reel-text-in 3s ease-in-out infinite' }}
          >
            {hookText.substring(0, 60)}
          </p>
        )}
        {mood && (
          <p className="text-[6px] text-purple-300/70 mt-0.5 flex items-center gap-0.5">
            <span>♪</span> {mood}
          </p>
        )}
      </div>
    </div>
  );
};
