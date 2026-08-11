import { cn } from '../../lib/cn';

export function Avatar({ initials, name, size = 'md', className }: {
  readonly initials: string;
  readonly name: string;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl';
  readonly className?: string;
}) {
  const sizes = {
    sm: 'size-7 text-[10px]',
    md: 'size-9 text-xs',
    lg: 'size-11 text-sm',
    xl: 'size-16 text-lg',
  } as const;
  return (
    <span
      role="img"
      aria-label={`Avatar de ${name}`}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand ring-1 ring-inset ring-brand/10',
        sizes[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
