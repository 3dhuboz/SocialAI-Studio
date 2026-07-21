import React from 'react';
import { CLIENT } from '../client.config';

interface Props {
  size?: number;
  className?: string;
  /** Use 'badge' (white rounded bg, good for dark screens) or 'raw' (transparent, good if PNG has alpha) */
  variant?: 'badge' | 'raw';
}

export const AppLogo: React.FC<Props> = ({ size = 36, className = '', variant = 'raw' }) => {
  const isPickleNick = CLIENT.clientId === 'picklenick';

  return (
    <img
      src={isPickleNick ? '/pickle-nick-logo.jpg' : '/logo-brand.png'}
      alt={`${CLIENT.appName} logo`}
      style={{
        height: size,
        width: isPickleNick ? size : 'auto',
        objectFit: 'cover',
        display: 'block',
        borderRadius: isPickleNick ? '50%' : undefined,
        filter: variant === 'raw'
          ? isPickleNick
            ? 'drop-shadow(0 1px 0 rgba(231, 192, 112, 0.75)) drop-shadow(0 9px 18px rgba(0, 0, 0, 0.42))'
            : 'drop-shadow(0 0 8px rgb(var(--accent-rgb) / 0.55)) drop-shadow(0 0 18px rgb(var(--accent-rgb) / 0.25))'
          : undefined,
      }}
      className={className}
    />
  );
};
