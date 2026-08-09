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
        Pressione espaco para arrastar. Use as setas para mover. Pressione espaco para soltar.
        Pressione escape para cancelar.
      </div>

      {children}

      <DragOverlay>
        {activeAgendamento ? (
          <div
            data-testid="drag-overlay"
            className="pointer-events-none min-w-[210px] rounded-2xl border border-accent/35 bg-surface/95 px-3.5 py-3 shadow-[var(--elev-float)] backdrop-blur-xl ring-1 ring-white/50"
          >
            <div className="mb-2 h-0.5 w-10 rounded-full bg-[linear-gradient(90deg,var(--brand-cyan),var(--accent),var(--brand-violet))]" /><p className="text-sm font-semibold tracking-[-.02em] text-text">
              {activeAgendamento.displayName}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-text-muted">
              {formatarHorario(activeAgendamento.startsAt)}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
