'use client';

import { useDraggable } from '@dnd-kit/core';
import { Botao } from '../ui/Botao';

export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente';

export interface ItemDeEspera {
  readonly waitlistId: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly prioridade: Prioridade;
  readonly esperandoDesde: string;
  readonly observacao: string | null;
}

const PESO: Record<Prioridade, number> = { urgente: 3, alta: 2, normal: 1, baixa: 0 };

function Arrastavel({ item, aoChamar }: { item: ItemDeEspera; aoChamar: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: item.waitlistId });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform === null ? undefined
          : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        border: 'var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)',
        padding: 'var(--s-4)', display: 'grid', gap: 'var(--s-2)', minHeight: 44,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <span {...attributes} {...listeners}
          aria-label={`Arrastar ${item.displayName}`}
          style={{ cursor: 'grab', userSelect: 'none', fontSize: 'var(--fs-12)',
                   color: 'var(--text-muted)' }}>
          ⠿
        </span>
        <strong style={{ fontWeight: 'var(--fw-medium)' }}>{item.displayName}</strong>
      </div>
      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
        {`${item.prioridade} · desde ${new Intl.DateTimeFormat('pt-BR',
          { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
          .format(new Date(item.esperandoDesde))}`}
        {item.observacao === null ? '' : ` · ${item.observacao}`}
      </span>
      <Botao variante="secundario" altura={28}
        aria-label={`Chamar ${item.displayName} para a vaga`}
        onClick={() => aoChamar(item.waitlistId)}>
        Chamar
      </Botao>
    </li>
  );
}

export function ListaDeEspera({
  itens, aoChamar,
}: { itens: readonly ItemDeEspera[]; aoChamar: (waitlistId: string) => void }) {
  const ordenados = [...itens].sort((a, b) =>
    PESO[b.prioridade] - PESO[a.prioridade]
    || a.esperandoDesde.localeCompare(b.esperandoDesde));

  return (
    <aside aria-label="Lista de espera"
      style={{
        width: 300, borderInlineStart: 'var(--border)', background: 'var(--bg)',
        padding: 'var(--s-5)', display: 'grid', gap: 'var(--s-4)', alignContent: 'start',
      }}>
      <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Lista de espera
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                   gap: 'var(--s-3)' }}>
        {ordenados.map((i) => (
          <Arrastavel key={i.waitlistId} item={i} aoChamar={aoChamar} />
        ))}
      </ul>
    </aside>
  );
}
