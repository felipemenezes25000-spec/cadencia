import type { AppointmentStatus } from './types';

export interface PrimaryAppointmentAction {
  readonly label: string;
  readonly intent: 'default' | 'clinical' | 'warning';
}

const ACTIONS: Record<AppointmentStatus, PrimaryAppointmentAction> = {
  scheduled: { label: 'Confirmar', intent: 'default' },
  confirmation_pending: { label: 'Enviar lembrete', intent: 'warning' },
  confirmed: { label: 'Check-in', intent: 'default' },
  waiting: { label: 'Chamar', intent: 'clinical' },
  called: { label: 'Iniciar atendimento', intent: 'clinical' },
  in_progress: { label: 'Continuar', intent: 'clinical' },
  closing: { label: 'Finalizar', intent: 'clinical' },
  completed: { label: 'Ver atendimento', intent: 'default' },
  no_show: { label: 'Reagendar', intent: 'warning' },
  blocked: { label: 'Resolver pendência', intent: 'warning' },
};

export function getPrimaryAction(status: AppointmentStatus): PrimaryAppointmentAction {
  return ACTIONS[status];
}
