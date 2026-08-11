import type { AppointmentStatus } from './types';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface AppointmentStatusDefinition {
  readonly label: string;
  readonly tone: StatusTone;
}

export const APPOINTMENT_STATUS: Record<AppointmentStatus, AppointmentStatusDefinition> = {
  scheduled: { label: 'Agendado', tone: 'neutral' },
  confirmation_pending: { label: 'Confirmação pendente', tone: 'warning' },
  confirmed: { label: 'Confirmado', tone: 'success' },
  waiting: { label: 'Aguardando', tone: 'warning' },
  called: { label: 'Chamado', tone: 'info' },
  in_progress: { label: 'Em atendimento', tone: 'info' },
  closing: { label: 'Finalização', tone: 'warning' },
  completed: { label: 'Atendido', tone: 'success' },
  no_show: { label: 'Falta', tone: 'danger' },
  blocked: { label: 'Pendência', tone: 'danger' },
};
