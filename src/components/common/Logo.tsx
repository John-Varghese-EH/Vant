import React from 'react';

export interface LogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Logo: React.FC<LogoProps> = ({ size = 24, className = '', style }) => (
  <div
    className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
    style={{
      width: size,
      height: size,
      ...style,
    }}
  >
    <img
      src="/Vant_logo-icon.png"
      alt="Vant"
      className="w-full h-full object-contain"
      style={{
        imageRendering: 'auto',
      }}
    />
  </div>
);
