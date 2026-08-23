'use client';

import { cn } from '../lib/cn';
import { APPOINTMENT_STATUS } from '../domain/appointments/states';
import type { AppointmentStatus } from '../domain/appointments/types';

export type StatusAgenda =
  | AppointmentStatus
  | 'em_atendimento' | 'pendente' | 'pago' | 'vencido';

interface ConfigDoChip {
  readonly rotulo: string;
  readonly glifo: string;
  readonly classes: string;
  readonly descricao: string;
}

const CHIP: Record<StatusAgenda, ConfigDoChip> = {
  agendado: {
    rotulo: APPOINTMENT_STATUS.agendado.label, glifo: '◷',
    classes: 'bg-surface-sunken text-st-agendado border border-line',
    descricao: 'Horário reservado; a presença ainda pode precisar de confirmação.',
  },
  confirmado: {
    rotulo: APPOINTMENT_STATUS.confirmado.label, glifo: '✓',
    classes: 'bg-ok-soft/60 text-ok border border-ok/20',
    descricao: 'Presença confirmada para o horário programado.',
  },
  aguardando: {
    rotulo: APPOINTMENT_STATUS.aguardando.label, glifo: '◷',
    classes: 'bg-warn-soft/60 text-warn border border-warn/20',
    descricao: 'Check-in realizado; o cidadão está na fila para atendimento.',
  },
  atendendo: {
    rotulo: APPOINTMENT_STATUS.atendendo.label, glifo: '▶',
    classes: 'bg-accent-soft/70 text-accent border border-accent/20',
    descricao: 'Atendimento clínico em andamento neste momento.',
  },
  em_atendimento: {
    rotulo: APPOINTMENT_STATUS.atendendo.label, glifo: '▶',
    classes: 'bg-accent-soft/70 text-accent border border-accent/20',
    descricao: 'Atendimento clínico em andamento neste momento.',
  },
  atendido: {
    rotulo: APPOINTMENT_STATUS.atendido.label, glifo: '✓',
    classes: 'bg-ok-soft/60 text-ok border border-ok/20',
    descricao: 'Atendimento concluído e registrado.',
  },
  faltou: {
    rotulo: APPOINTMENT_STATUS.faltou.label, glifo: '✕',
    classes: 'bg-danger-soft/60 text-danger border border-danger/20',
    descricao: 'O cidadão não compareceu ao atendimento.',
  },
  cancelado: {
    rotulo: APPOINTMENT_STATUS.cancelado.label, glifo: '✕',
    classes: 'bg-surface-sunken text-text-muted border border-line',
    descricao: 'Agendamento cancelado; não integra a fila ativa.',
  },
  pendente: {
    rotulo: 'Pendente', glifo: '●',
    classes: 'bg-warn-soft/40 text-warn border border-warn/20',
    descricao: 'Existe uma ação ou validação aguardando conclusão.',
  },
  pago: {
    rotulo: 'Pago', glifo: '✓',
    classes: 'bg-ok-soft/40 text-ok border border-ok/20',
    descricao: 'Pagamento ou registro financeiro concluído.',
  },
  vencido: {
    rotulo: 'Vencido', glifo: '✕',
    classes: 'bg-danger-soft/40 text-danger border border-danger/20',
    descricao: 'Prazo ultrapassado; requer atenção antes de prosseguir.',
  },
};

export interface ChipDeStatusProps {
  readonly status: StatusAgenda;
  readonly className?: string;
}

export function ChipDeStatus({ status, className }: ChipDeStatusProps) {
  const c = CHIP[status] ?? {
    rotulo: status,
    glifo: '●',
    classes: 'bg-surface-sunken text-text-muted border border-line',
    descricao: 'Estado atual deste registro.',
  };

  return (
    <span
      title={c.descricao}
      aria-label={`${c.rotulo}. ${c.descricao}`}
      className={cn(
        'inline-flex items-center gap-[var(--s-2)]',
        'text-[10px] font-bold tracking-[-0.005em]',
        'px-2.5 py-1.5',
        'rounded-full shadow-[inset_0_1px_0_rgb(255_255_255_/_0.55)]',
        c.classes,
        className,
      )}
    >
      <span aria-hidden="true">{c.glifo}</span>
      {c.rotulo}
    </span>
  );
}

export { CHIP as CHIPS_DE_STATUS };
