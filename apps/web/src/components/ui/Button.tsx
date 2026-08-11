'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { SpinnerGap } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly iconLeft?: PhosphorIcon;
  readonly iconRight?: PhosphorIcon;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover',
  secondary: 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-subtle',
  ghost: 'border-transparent bg-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
  danger: 'border-danger bg-danger text-white hover:brightness-95',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-10 gap-2 px-4 text-sm',
};

const iconSizes: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  iconLeft: IconLeft,
  iconRight: IconRight,
  loading = false,
  fullWidth = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border font-semibold',
        'transition-colors-fast disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <SpinnerGap size={iconSizes[size]} className="animate-spin" aria-hidden /> : null}
      {!loading && IconLeft ? <IconLeft size={iconSizes[size]} aria-hidden /> : null}
      {children}
      {IconRight ? <IconRight size={iconSizes[size]} aria-hidden /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: PhosphorIcon;
  readonly label: string;
  readonly size?: 'sm' | 'md';
}

export function IconButton({ icon: Icon, label, size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-lg border border-border bg-surface text-text-secondary',
        'transition-colors-fast hover:border-border-strong hover:bg-surface-subtle hover:text-text-primary',
        size === 'sm' ? 'size-8' : 'size-9',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden />
    </button>
  );
}
