import React, { useEffect, useRef, ReactNode } from 'react';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      className="double-bezel animate-fade-in"
      style={{
        margin: 'auto',
        padding: '5px',
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        color: 'var(--gc-text)',
        border: '1px solid var(--gc-border-light)',
        borderRadius: 'var(--gc-radius-xl)',
        width: 'calc(100% - 2.5rem)',
        maxWidth: '480px',
        boxShadow: 'var(--gc-shadow-lg), 0 0 0 1px rgba(255, 255, 255, 0.06)',
        outline: 'none',
        backdropFilter: 'blur(36px) saturate(190%) contrast(105%)',
        WebkitBackdropFilter: 'blur(36px) saturate(190%) contrast(105%)',
      }}
    >
      <div className="double-bezel-inner flex flex-col gap-md" style={{ padding: '22px' }}>
        <div className="flex items-center justify-between" style={{ borderBottom: '1px solid var(--gc-border)', paddingBottom: '14px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            title="Close modal"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ padding: '6px 0' }}>{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-sm" style={{ marginTop: 'var(--gc-space-sm)', paddingTop: '14px', borderTop: '1px solid var(--gc-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
};
