'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, DotsSixVertical, ClockCounterClockwise } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { EstadoVazio } from '../ui/EstadoVazio';

/* ── tipos exportados (backward compat) ───────────────────────────── */

export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente';

export interface ItemDeEspera {
  readonly waitlistId: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly prioridade: Prioridade;
  readonly esperandoDesde: string;
  readonly observacao: string | null;
}

/* ── helpers (preservados) ────────────────────────────────────────── */

const PESO: Record<Prioridade, number> = {
  urgente: 3,
  alta: 2,
  normal: 1,
  baixa: 0,
};

function ordenarPorPrioridade(itens: readonly ItemDeEspera[]): ItemDeEspera[] {
  return [...itens].sort(
    (a, b) =>
      PESO[b.prioridade] - PESO[a.prioridade] ||
      a.esperandoDesde.localeCompare(b.esperandoDesde),
  );
}

function formatarDesde(iso: string): string {
  return `desde ${new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso))}`;
}

/* ── item arrastavel ──────────────────────────────────────────────── */

function ItemEspera({
  item,
  posicao,
  aoChamar,
}: {
  readonly item: ItemDeEspera;
  readonly posicao: number;
  readonly aoChamar: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.waitlistId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-[18px] border border-line/75 bg-surface/94 shadow-elev-1 px-4 py-3',
        'transition-shadow duration-[var(--dur-2)]',
        isDragging && 'shadow-elev-2 opacity-75 z-10 relative',
      )}
    >
      {/* Alca de arraste */}
      <button
        {...attributes}
        {...listeners}
        className={cn(
          'cursor-grab active:cursor-grabbing text-text-muted hover:text-text',
          'rounded p-0.5 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        )}
        aria-label={`Arrastar ${item.displayName}`}
      >
        <Icone icon={DotsSixVertical} size="md" />
      </button>

      {/* Numero da posicao */}
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          'bg-accent-soft text-xs font-bold text-accent',
        )}
        aria-label={`Posicao ${posicao}`}
      >
        {posicao}
      </span>

      {/* Informacoes do paciente */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">
          {item.displayName}
        </p>
        <p className="text-xs text-text-muted">
          {item.prioridade} · {formatarDesde(item.esperandoDesde)}
          {item.observacao != null ? ` · ${item.observacao}` : ''}
        </p>
      </div>

      {/* Acao */}
      <Botao
        variante="fantasma"
        tamanho="sm"
        iconeEsquerda={Check}
        aria-label={`Chamar ${item.displayName} para a vaga`}
        onClick={() => aoChamar(item.waitlistId)}
      >
        Chamar
      </Botao>
    </li>
  );
}

/* ── componente principal ─────────────────────────────────────────── */

export function ListaDeEspera({
  itens,
  aoChamar,
}: {
  readonly itens: readonly ItemDeEspera[];
  readonly aoChamar: (waitlistId: string) => void;
}) {
  const [ordenados, setOrdenados] = useState<ItemDeEspera[]>(() =>
    ordenarPorPrioridade(itens),
  );

  // Atualizar quando props mudam
  useEffect(() => {
    setOrdenados(ordenarPorPrioridade(itens));
  }, [itens]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over != null && active.id !== over.id) {
      setOrdenados((prev) => {
        const oldIndex = prev.findIndex((i) => i.waitlistId === active.id);
        const newIndex = prev.findIndex((i) => i.waitlistId === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <aside
      aria-label="Lista de espera"
      className={cn(
        'w-[300px] border-l border-line bg-bg',
        'p-5 flex flex-col gap-4',
      )}
    >
      <h2 className="text-[length:var(--fs-15)] font-semibold text-text m-0">
        Lista de espera
      </h2>

      {ordenados.length === 0 ? (
        <EstadoVazio
          icone={ClockCounterClockwise}
          titulo="Lista de espera vazia"
          descricao="Nenhum paciente na lista de espera"
          compacto
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ordenados.map((i) => i.waitlistId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="list-none m-0 p-0 flex flex-col gap-3">
              {ordenados.map((item, index) => (
                <ItemEspera
                  key={item.waitlistId}
                  item={item}
                  posicao={index + 1}
                  aoChamar={aoChamar}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </aside>
  );
}
