import React from 'react';

interface Props {
  size?: number;
  className?: string;
}

export const AppLogo: React.FC<Props> = ({ size = 36, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <defs>
      <linearGradient id="lAmber" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fcd34d"/>
        <stop offset="50%" stopColor="#f59e0b"/>
        <stop offset="100%" stopColor="#ea580c"/>
      </linearGradient>
      <linearGradient id="lBg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1c1c2e"/>
        <stop offset="100%" stopColor="#0a0a14"/>
      </linearGradient>
      <radialGradient id="lGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.18"/>
        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0"/>
      </radialGradient>
      <filter id="lBlur" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3"/>
      </filter>
      <filter id="lSoft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5"/>
      </filter>
    </defs>

    <rect x="3" y="3" width="94" height="94" rx="24" fill="url(#lBg)"/>
    <rect x="3" y="3" width="94" height="94" rx="24" fill="none" stroke="url(#lAmber)" strokeWidth="1.5" opacity="0.25"/>
    <circle cx="50" cy="50" r="38" fill="url(#lGlow)"/>

    {/* Glow behind S */}
    <path d="M 63 41 C 63 27, 37 27, 37 41 C 37 51, 63 51, 63 59 C 63 73, 37 73, 37 59"
      stroke="#f59e0b" strokeWidth="11" strokeLinecap="round" fill="none"
      filter="url(#lBlur)" opacity="0.45"/>

    {/* Main S */}
    <path d="M 63 41 C 63 27, 37 27, 37 41 C 37 51, 63 51, 63 59 C 63 73, 37 73, 37 59"
      stroke="url(#lAmber)" strokeWidth="7" strokeLinecap="round" fill="none"/>

    {/* Network nodes */}
    <circle cx="63" cy="41" r="4" fill="#fcd34d" filter="url(#lSoft)" opacity="0.6"/>
    <circle cx="63" cy="41" r="2.8" fill="#fcd34d"/>
    <circle cx="37" cy="41" r="4" fill="#f59e0b" filter="url(#lSoft)" opacity="0.5"/>
    <circle cx="37" cy="41" r="2.5" fill="#f59e0b"/>
    <circle cx="63" cy="59" r="4" fill="#f59e0b" filter="url(#lSoft)" opacity="0.5"/>
    <circle cx="63" cy="59" r="2.5" fill="#f59e0b"/>
    <circle cx="37" cy="59" r="4" fill="#fcd34d" filter="url(#lSoft)" opacity="0.6"/>
    <circle cx="37" cy="59" r="2.8" fill="#fcd34d"/>

    {/* Diagonal neural lines */}
    <line x1="63" y1="41" x2="37" y2="59" stroke="#f59e0b" strokeWidth="0.6" opacity="0.15"/>
    <line x1="37" y1="41" x2="63" y2="59" stroke="#f59e0b" strokeWidth="0.6" opacity="0.15"/>

    {/* Sparkles top-right */}
    <path d="M 78 21 L 79.3 25 L 83 21 L 79.3 17 Z" fill="#fcd34d" opacity="0.95"/>
    <path d="M 73 17 L 73.9 19.8 L 76.5 17 L 73.9 14.2 Z" fill="#fcd34d" opacity="0.65"/>
    <circle cx="83.5" cy="28" r="1.3" fill="#fbbf24" opacity="0.75"/>

    {/* Sparkles bottom-left */}
    <path d="M 22 79 L 22.9 81.8 L 25.5 79 L 22.9 76.2 Z" fill="#f97316" opacity="0.55"/>
    <circle cx="17" cy="73" r="1.1" fill="#f59e0b" opacity="0.5"/>
  </svg>
);
