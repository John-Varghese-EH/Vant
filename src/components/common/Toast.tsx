import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Icon } from './Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (options: { type?: ToastType; title: string; message?: string; durationMs?: number }) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    if (timers.current[id]) {
      window.clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const toast = useCallback(
    ({
      type = 'info',
      title,
      message,
      durationMs = 4200,
    }: {
      type?: ToastType;
      title: string;
      message?: string;
      durationMs?: number;
    }) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts(prev => [...prev.slice(-3), { id, type, title, message }]);
      timers.current[id] = window.setTimeout(() => {
        dismiss(id);
      }, durationMs);
    },
    [dismiss]
  );

  const success = useCallback((title: string, message?: string) => toast({ type: 'success', title, message }), [toast]);
  const error = useCallback((title: string, message?: string) => toast({ type: 'error', title, message, durationMs: 6000 }), [toast]);
  const info = useCallback((title: string, message?: string) => toast({ type: 'info', title, message }), [toast]);
  const warning = useCallback((title: string, message?: string) => toast({ type: 'warning', title, message, durationMs: 5200 }), [toast]);

  const iconFor = (type: ToastType) => {
    switch (type) {
      case 'success':
        return { name: 'check_circle', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' };
      case 'error':
        return { name: 'error', color: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10' };
      case 'warning':
        return { name: 'warning', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' };
      default:
        return { name: 'info', color: 'text-violet-400', border: 'border-violet-500/30', bg: 'bg-violet-500/10' };
    }
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning }}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 pointer-events-none max-w-sm w-[calc(100vw-2.5rem)]"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map(item => {
          const meta = iconFor(item.type);
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl border ${meta.border} bg-[var(--gc-surface)]/95 backdrop-blur-2xl shadow-2xl animate-fade-in transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]`}
            >
              <div className={`w-8 h-8 rounded-xl ${meta.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon name={meta.name} size={17} className={meta.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[var(--gc-text)] tracking-tight">{item.title}</div>
                {item.message && (
                  <div className="text-[11px] text-[var(--gc-text-muted)] mt-0.5 leading-relaxed break-words">
                    {item.message}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="p-1 rounded-lg text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-[var(--gc-border)] transition-colors cursor-pointer shrink-0"
                aria-label="Dismiss notification"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
    };
  }
  return ctx;
}
