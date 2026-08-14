'use client';

import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { type ReactNode, useState } from 'react';
import type { LinhaDaFila } from './Hoje';

export interface AgendaDragContextProps {
  readonly children: ReactNode;
  readonly onMover: (agendamentoId: string, novoHorario: string) => void;
  readonly agendamentos: LinhaDaFila[];
  readonly timezone: string;
}

export function AgendaDragContext({
  children,
  onMover,
  agendamentos,
  timezone,
}: AgendaDragContextProps) {
  const [_activeId, setActiveId] = useState<string | null>(null);
  const [activeAgendamento, setActiveAgendamento] = useState<LinhaDaFila | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    setActiveId(id);
    const found = agendamentos.find((a) => a.appointmentId === id) ?? null;
    setActiveAgendamento(found);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onMover(active.id as string, over.id as string);
    }
    setActiveId(null);
    setActiveAgendamento(null);
  }

  function handleDragCancel() {
    setActiveId(null);
    setActiveAgendamento(null);
  }

  function formatarHorario(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).format(Date.parse(iso));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div id="dnd-instrucoes" className="sr-only">
        Pressione espaço para arrastar. Use as setas para mover. Pressione espaço para soltar.
        Pressione escape para cancelar.
      </div>

      {children}

      <DragOverlay>
        {activeAgendamento ? (
          <div
            data-testid="drag-overlay"
            className="rounded-[var(--r-md)] border border-[var(--accent)] bg-[var(--surface)] px-3 py-2 shadow-[var(--elev-2)] opacity-90 pointer-events-none"
          >
            <p className="text-[var(--fs-14)] font-[var(--fw-medium)] text-[var(--text)]">
              {activeAgendamento.displayName}
            </p>
            <p className="text-[var(--fs-12)] text-[var(--text-muted)]">
              {formatarHorario(activeAgendamento.startsAt)}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
