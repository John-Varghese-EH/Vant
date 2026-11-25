import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './Icon';
import { useTheme, ACCENT_PRESETS } from '../../hooks/useTheme';

interface AccentSelectorProps {
  className?: string;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
}

export const AccentSelector: React.FC<AccentSelectorProps> = ({
  className = '',
  size = 'md',
  align = 'right',
}) => {
  const { accentHex, activePreset, setAccent, resetAccent } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [customHex, setCustomHex] = useState(accentHex);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync customHex state if external accent changes
  useEffect(() => {
    setCustomHex(accentHex);
  }, [accentHex]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const isSmall = size === 'sm';

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let clean = customHex.trim();
    if (!clean.startsWith('#')) clean = `#${clean}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
      setAccent(clean);
    }
  };

  return (
    <div className={`relative inline-block ${className}`} ref={dropdownRef}>
      {/* Trigger Button with Glowing Swatch */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Customize accent and window titlebar color"
        title="Customize window accent & titlebar color"
        className={`
          relative inline-flex items-center justify-center
          transition-all duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.15)]
          rounded-full cursor-pointer select-none
          border border-[var(--gc-border)]
          bg-[var(--gc-surface-elevated)]
          hover:border-[var(--gc-border-light)]
          hover:scale-105 active:scale-95
          shadow-sm
          ${isSmall ? 'w-7 h-7' : 'w-8 h-8'}
        `}
      >
        <span
          className="w-3.5 h-3.5 rounded-full transition-transform duration-200"
          style={{
            backgroundColor: activePreset.hex,
            boxShadow: `0 0 8px ${activePreset.hex}88`,
          }}
        />
      </button>

      {/* Flyout Popover */}
      {isOpen && (
        <div
          className={`
            absolute top-full mt-2 z-50
            w-[290px] sm:w-[320px] p-4
            rounded-2xl border border-[var(--gc-border-light)]
            bg-[var(--gc-surface)]/95 backdrop-blur-2xl
            shadow-2xl animate-fade-in flex flex-col gap-3.5
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
          style={{
            boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.7), 0 0 1px 1px rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[var(--gc-border)]">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{
                  background: activePreset.muted,
                  color: activePreset.hex,
                  border: `1px solid ${activePreset.hex}33`,
                }}
              >
                <Icon name="palette" size={14} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-[var(--gc-text)] tracking-tight">
                  Accent & Window Theme
                </h4>
                <p className="text-[10px] text-[var(--gc-text-muted)] font-medium">
                  Windows 11 titlebar, border & UI
                </p>
              </div>
            </div>
            <span
              className="text-[9.5px] font-mono px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider"
              style={{
                background: 'var(--gc-surface-sunken)',
                color: activePreset.hex,
                border: '1px solid var(--gc-border)',
              }}
            >
              {activePreset.name.split(' ')[0]}
            </span>
          </div>

          {/* Preset Grid */}
          <div className="grid grid-cols-4 gap-2">
            {ACCENT_PRESETS.map((preset) => {
              const isSelected = activePreset.hex.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setAccent(preset.hex);
                  }}
                  className={`
                    group relative flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-150 cursor-pointer
                    border text-center
                    ${
                      isSelected
                        ? 'border-[var(--gc-accent)] bg-[var(--gc-surface-elevated)] shadow-sm'
                        : 'border-transparent hover:border-[var(--gc-border)] hover:bg-[var(--gc-surface-sunken)]'
                    }
                  `}
                  title={`${preset.name} - ${preset.description}`}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm"
                    style={{
                      backgroundColor: preset.hex,
                      boxShadow: isSelected ? `0 0 12px ${preset.hex}99` : 'none',
                    }}
                  >
                    {isSelected && (
                      <Icon name="check" size={14} className="text-white drop-shadow-md" />
                    )}
                  </div>
                  <span
                    className={`text-[10px] leading-tight truncate w-full ${
                      isSelected ? 'font-bold text-[var(--gc-text)]' : 'text-[var(--gc-text-muted)] font-medium'
                    }`}
                  >
                    {preset.name.split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom Color Input & Reset */}
          <div className="pt-2.5 border-t border-[var(--gc-border)] flex flex-col gap-2">
            <form onSubmit={handleCustomSubmit} className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <input
                  type="color"
                  value={activePreset.hex}
                  onChange={(e) => setAccent(e.target.value)}
                  className="w-7 h-7 rounded-lg border-0 bg-transparent cursor-pointer p-0 mr-1.5 shrink-0"
                  title="Pick custom color"
                />
                <input
                  type="text"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value)}
                  placeholder="#8b5cf6"
                  maxLength={7}
                  className="input font-mono text-xs py-1 px-2.5 flex-1 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary text-[11px] px-3 py-1 rounded-lg shrink-0"
              >
                Apply
              </button>
            </form>

            <div className="flex items-center justify-between text-[10px] text-[var(--gc-text-dim)] pt-0.5">
              <span>Syncs to Windows DWM caption</span>
              <button
                type="button"
                onClick={resetAccent}
                className="text-muted hover:text-[var(--gc-text)] underline cursor-pointer"
              >
                Reset Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
