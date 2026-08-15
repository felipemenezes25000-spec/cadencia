import { cn } from '../lib/cn';

export interface AvatarProps {
  readonly nome: string;
  readonly iniciais?: string;
  readonly tamanho?: 'sm' | 'md' | 'lg' | 'xl';
  readonly className?: string;
}

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '—';
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? partes.at(-1)?.[0] ?? '' : '';
  return `${primeira}${ultima}`.toLocaleUpperCase('pt-BR');
}

/** Avatar textual compartilhado. Fotos podem ser adicionadas sem mudar a geometria. */
export function Avatar({ nome, iniciais, tamanho = 'md', className }: AvatarProps) {
  const tamanhos = {
    sm: 'size-8 text-[10px]',
    md: 'size-10 text-xs',
    lg: 'size-12 text-sm',
    xl: 'size-16 text-lg',
  } as const;

  return (
    <span
      role="img"
      aria-label={`Avatar de ${nome}`}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full border border-accent/12 bg-[linear-gradient(145deg,var(--brand-soft),var(--surface))] font-bold text-accent shadow-[inset_0_1px_0_rgb(255_255_255_/_0.8),0_4px_12px_rgb(7_118_111_/_0.06)] ring-1 ring-inset ring-accent/5',
        tamanhos[tamanho],
        className,
      )}
    >
      {iniciais ?? iniciaisDe(nome)}
    </span>
  );
}
