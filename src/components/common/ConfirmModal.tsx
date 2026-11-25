import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Icon } from './Icon';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3 py-1">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
            variant === 'danger'
              ? 'bg-rose-500/10 border-rose-500/25 text-rose-400'
              : 'bg-violet-500/10 border-violet-500/25 text-violet-400'
          }`}
        >
          <Icon name={variant === 'danger' ? 'warning' : 'info'} size={20} />
        </div>
        <p className="text-xs text-[var(--gc-text-muted)] leading-relaxed pt-0.5">{description}</p>
      </div>
    </Modal>
  );
};
