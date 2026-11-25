import React, { ReactNode } from 'react';

export interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'glass';
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  className = '',
  style,
  dot = false,
}) => {
  const dotColor = {
    success: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
    warning: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]',
    danger: 'bg-rose-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]',
    info: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]',
    neutral: 'bg-slate-400',
    glass: 'bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.4)]',
  }[variant];

  return (
    <span className={`badge badge-${variant} ${className}`} style={style}>
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      )}
      {children}
    </span>
  );
};
