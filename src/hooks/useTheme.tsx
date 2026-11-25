import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { setWindowAccent } from '../lib/tauri';

export type Theme = 'dark' | 'light';

export interface AccentPreset {
  id: string;
  name: string;
  hex: string;
  hover: string;
  dark: string;
  muted: string;
  description: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'violet',
    name: 'Electric Violet',
    hex: '#8b5cf6',
    hover: '#a78bfa',
    dark: '#7c3aed',
    muted: 'rgba(139, 92, 246, 0.14)',
    description: 'Vant Signature Obsidian',
  },
  {
    id: 'cyan',
    name: 'Hyper Cyan',
    hex: '#06b6d4',
    hover: '#22d3ee',
    dark: '#0891b2',
    muted: 'rgba(6, 182, 212, 0.14)',
    description: 'Quantum Ice & Zero Latency',
  },
  {
    id: 'emerald',
    name: 'Cyber Emerald',
    hex: '#10b981',
    hover: '#34d399',
    dark: '#059669',
    muted: 'rgba(16, 185, 129, 0.14)',
    description: 'Hacker Terminal & Neural Mesh',
  },
  {
    id: 'azure',
    name: 'Cobalt Azure',
    hex: '#3b82f6',
    hover: '#60a5fa',
    dark: '#2563eb',
    muted: 'rgba(59, 130, 246, 0.14)',
    description: 'Deep Tech & Cloudflare Edge',
  },
  {
    id: 'amber',
    name: 'Sunset Amber',
    hex: '#f59e0b',
    hover: '#fbbf24',
    dark: '#d97706',
    muted: 'rgba(245, 158, 11, 0.14)',
    description: 'Solar Flare & Warm Gold',
  },
  {
    id: 'rose',
    name: 'Neon Rose',
    hex: '#ec4899',
    hover: '#f472b6',
    dark: '#db2777',
    muted: 'rgba(236, 72, 153, 0.14)',
    description: 'Synthwave & Cyberpunk Glow',
  },
  {
    id: 'crimson',
    name: 'Crimson Peak',
    hex: '#ef4444',
    hover: '#f87171',
    dark: '#dc2626',
    muted: 'rgba(239, 68, 68, 0.14)',
    description: 'High Performance & Redline',
  },
  {
    id: 'titanium',
    name: 'Obsidian Slate',
    hex: '#94a3b8',
    hover: '#cbd5e1',
    dark: '#64748b',
    muted: 'rgba(148, 163, 184, 0.14)',
    description: 'Apple Industrial Minimal',
  },
];

const THEME_STORAGE_KEY = 'vant_theme';
const ACCENT_STORAGE_KEY = 'vant_accent_color';
const DEFAULT_ACCENT_HEX = '#8b5cf6';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const val = parseInt(clean, 16);
  if (isNaN(val)) return { r: 139, g: 92, b: 246 };
  return {
    r: (val >> 16) & 255,
    g: (val >> 8) & 255,
    b: val & 255,
  };
}

function adjustBrightness(r: number, g: number, b: number, percent: number): string {
  const clamp = (num: number) => Math.min(255, Math.max(0, Math.round(num)));
  const adj = (channel: number) => clamp(channel + (percent / 100) * 255);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
}

export function computeAccentTokens(hex: string): AccentPreset {
  const matched = ACCENT_PRESETS.find(p => p.hex.toLowerCase() === hex.toLowerCase());
  if (matched) {
    return matched;
  }
  const rgb = hexToRgb(hex);
  return {
    id: 'custom',
    name: 'Custom Accent',
    hex: hex.startsWith('#') ? hex : `#${hex}`,
    hover: adjustBrightness(rgb.r, rgb.g, rgb.b, 16),
    dark: adjustBrightness(rgb.r, rgb.g, rgb.b, -16),
    muted: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`,
    description: 'Custom user defined palette',
  };
}

export interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (nextTheme: Theme) => void;
  accentHex: string;
  activePreset: AccentPreset;
  setAccent: (hex: string) => void;
  resetAccent: () => void;
  presets: AccentPreset[];
}

const defaultContextValue: ThemeContextValue = {
  theme: 'dark',
  isDark: true,
  toggleTheme: () => {},
  setTheme: () => {},
  accentHex: DEFAULT_ACCENT_HEX,
  activePreset: ACCENT_PRESETS[0],
  setAccent: () => {},
  resetAccent: () => {},
  presets: ACCENT_PRESETS,
};

const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = (localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem('gc_theme')) as Theme | null;
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    } catch {
      // Fallback if localStorage is inaccessible
    }
    return 'dark';
  });

  const [accentHex, setAccentHex] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) {
        return saved;
      }
    } catch {
      // Fallback
    }
    return DEFAULT_ACCENT_HEX;
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore
    }

    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [theme]);

  // Apply accent color to document root and Windows 11 DWM
  useEffect(() => {
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, accentHex);
    } catch {}

    const tokens = computeAccentTokens(accentHex);
    const root = document.documentElement;

    // Standard CSS Variables
    root.style.setProperty('--color-accent', tokens.hex);
    root.style.setProperty('--color-accent-light', tokens.hover);
    root.style.setProperty('--color-accent-dark', tokens.dark);
    root.style.setProperty('--color-accent-muted', tokens.muted);

    // Vant Design System Tokens
    root.style.setProperty('--gc-accent', tokens.hex);
    root.style.setProperty('--gc-accent-hover', tokens.hover);
    root.style.setProperty('--gc-accent-dark', tokens.dark);
    root.style.setProperty('--gc-accent-muted', tokens.muted);
    root.style.setProperty('--gc-border-focus', `${tokens.hex}99`);

    // Synchronize Windows 11 DWM titlebar and border
    setWindowAccent(tokens.hex).catch(() => {});
  }, [accentHex]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const setAccent = useCallback((hex: string) => {
    let clean = hex.trim();
    if (!clean.startsWith('#')) clean = `#${clean}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
      setAccentHex(clean);
    }
  }, []);

  const resetAccent = useCallback(() => {
    setAccentHex(DEFAULT_ACCENT_HEX);
  }, []);

  const activePreset = useMemo(() => computeAccentTokens(accentHex), [accentHex]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isDark: theme === 'dark',
      toggleTheme,
      setTheme,
      accentHex,
      activePreset,
      setAccent,
      resetAccent,
      presets: ACCENT_PRESETS,
    }),
    [theme, toggleTheme, setTheme, accentHex, activePreset, setAccent, resetAccent]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
