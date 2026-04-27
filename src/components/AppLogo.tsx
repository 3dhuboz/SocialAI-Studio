import React from 'react';

interface Props {
  size?: number;
  className?: string;
  /** Use 'badge' (white rounded bg, good for dark screens) or 'raw' (transparent, good if PNG has alpha) */
  variant?: 'badge' | 'raw';
}

export const AppLogo: React.FC<Props> = ({ size = 36, className = '', variant = 'raw' }) => (
  <img
    src="/logo-brand.png"
    alt="App logo"
    style={{
      height: size,
      width: 'auto',
      display: 'block',
      filter: variant === 'raw'
        ? 'drop-shadow(0 0 8px rgb(var(--accent-rgb) / 0.55)) drop-shadow(0 0 18px rgb(var(--accent-rgb) / 0.25))'
        : undefined,
    }}
    className={className}
  />
);
