import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting'>('entering');

  useEffect(() => {
    const enterTimer = setTimeout(() => setPhase('visible'), 30);
    const exitTimer = setTimeout(() => setPhase('exiting'), 950);
    const unmountTimer = setTimeout(() => onComplete(), 1400);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(unmountTimer);
    };
  }, [onComplete]);

  const dismissNow = () => {
    setPhase('exiting');
    setTimeout(onComplete, 250);
  };

  const isVisible = phase === 'visible';
  const isExiting = phase === 'exiting';

  return (
    <div
      onClick={dismissNow}
      className="flex flex-col items-center justify-center cursor-pointer"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#040407',
        zIndex: 99999,
        opacity: isExiting ? 0 : 1,
        transition: 'opacity 0.45s cubic-bezier(0.32, 0.72, 0, 1)',
        pointerEvents: isExiting ? 'none' : 'auto',
      }}
    >
      {/* Ambient Radial Aura */}
      <div
        className="absolute w-[420px] h-[420px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.16) 0%, transparent 70%)',
          opacity: isVisible && !isExiting ? 1 : 0,
          transition: 'opacity 0.6s ease',
        }}
      />

      {/* Main Logo & Title */}
      <div
        className="flex flex-col items-center relative z-10"
        style={{
          opacity: isVisible && !isExiting ? 1 : 0,
          transform: isVisible && !isExiting ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(4px)',
          transition:
            'opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1), transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)',
          gap: '20px',
        }}
      >
        <div className="relative">
          <div className="absolute -inset-2 rounded-full bg-violet-500/20 blur-2xl opacity-75 pointer-events-none" />
          <img
            src="/Vant_logo-icon.png"
            alt="Vant"
            className="relative w-24 h-24 object-contain select-none"
          />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: '#ffffff',
              fontFamily: 'var(--font-sans, "Plus Jakarta Sans", sans-serif)',
            }}
          >
            Vant
          </h1>
          <p
            style={{
              fontSize: '10.5px',
              fontWeight: 600,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#a1a1aa',
            }}
          >
            Distributed GPU &amp; AI Compute Mesh
          </p>
        </div>
      </div>

      {/* Credits */}
      <div
        className="flex flex-col items-end"
        style={{
          position: 'absolute',
          bottom: '36px',
          right: '44px',
          opacity: isVisible && !isExiting ? 1 : 0,
          transform: isVisible && !isExiting ? 'translateY(0)' : 'translateY(8px)',
          transition: 'all 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.12s',
          gap: '4px',
          textAlign: 'right',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: '#a1a1aa',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          JOHN VARGHESE (J0X)
        </span>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 500,
            color: '#71717a',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          GITHUB: JOHN-VARGHESE-EH
        </span>
      </div>
    </div>
  );
};
