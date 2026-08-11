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
    sm: 'size-7 text-[10px]',
    md: 'size-9 text-xs',
    lg: 'size-11 text-sm',
    xl: 'size-16 text-lg',
  } as const;

  return (
    <span
      role="img"
      aria-label={`Avatar de ${nome}`}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent ring-1 ring-inset ring-accent/10',
        tamanhos[tamanho],
        className,
      )}
    >
      {iniciais ?? iniciaisDe(nome)}
    </span>
  );
}
