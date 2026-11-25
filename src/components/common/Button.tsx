import { ButtonHTMLAttributes, forwardRef } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'ghost' | 'glass' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  children,
  className = '',
  style,
  ...props
}, ref) => {
  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs rounded-lg gap-1.5',
    md: 'px-4 py-2 text-xs font-semibold rounded-xl gap-2',
    lg: 'px-5 py-2.5 text-sm font-semibold rounded-2xl gap-2.5',
  }[size];

  const variantClasses = {
    primary: 'btn-primary shadow-sm hover:shadow-md',
    danger: 'btn-danger shadow-sm hover:shadow-md',
    ghost: 'btn-ghost hover:bg-white/5 active:bg-white/10',
    glass: 'btn-glass shadow-sm hover:shadow-md',
    secondary: 'btn-secondary',
  }[variant];

  return (
    <button
      ref={ref}
      className={`btn ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled || loading}
      style={style}
      {...props}
    >
      {loading ? (
        <span className="spinner" style={{ width: size === 'sm' ? 12 : 14, height: size === 'sm' ? 12 : 14 }} />
      ) : null}
      {children}
    </button>
  );
});

Button.displayName = 'Button';
