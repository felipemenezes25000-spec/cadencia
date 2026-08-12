'use client';

import { CalendarBlank } from '@phosphor-icons/react';
import { Campo } from '../../ui/Campo';

interface CatalogReferenceDateProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ajuda: string;
  readonly min?: string;
}

/**
 * Catálogos clínicos são versionados pela data do evento. Tornar a data visível
 * evita que uma resposta vazia pareça falha de busca ou que um termo futuro
 * seja usado silenciosamente num atendimento antigo.
 */
export function CatalogReferenceDate({
  value, onChange, ajuda, min,
}: CatalogReferenceDateProps) {
  return (
    <Campo
      type="date"
      rotulo="Data de referência"
      ajuda={ajuda}
      value={value}
      {...(min ? { min } : {})}
      onChange={(event) => onChange(event.target.value)}
      prefixo={<CalendarBlank size={17} aria-hidden />}
      className="max-w-sm"
    />
  );
}
