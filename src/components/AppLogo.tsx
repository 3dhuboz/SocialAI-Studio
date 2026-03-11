import React from 'react';

interface Props {
  size?: number;
  className?: string;
  /** Use 'badge' (white rounded bg, good for dark screens) or 'raw' (transparent, good if PNG has alpha) */
  variant?: 'badge' | 'raw';
}

export const AppLogo: React.FC<Props> = ({ size = 36, className = '', variant = 'badge' }) => {
  const img = (
    <img
      src="/logo-brand.png"
      alt="SocialAI Studio"
      style={{ height: size, width: 'auto', display: 'block' }}
      className={variant === 'raw' ? className : ''}
    />
  );

  if (variant === 'raw') return img;

  return (
    <div
      className={`bg-white rounded-2xl flex items-center justify-center overflow-hidden ${className}`}
      style={{ padding: Math.round(size * 0.1), display: 'inline-flex' }}
    >
      {img}
    </div>
  );
};
