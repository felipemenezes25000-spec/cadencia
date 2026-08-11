import type { AppointmentStatus } from './types';

export type AppointmentStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface AppointmentStatusDefinition {
  readonly label: string;
  readonly tone: AppointmentStatusTone;
  readonly glyph: 'calendar' | 'check' | 'clock' | 'play' | 'x';
}

/** Texto e semantica visual; transicoes continuam pertencendo ao backend. */
export const APPOINTMENT_STATUS: Record<AppointmentStatus, AppointmentStatusDefinition> = {
  agendado: { label: 'Agendado', tone: 'neutral', glyph: 'calendar' },
  confirmado: { label: 'Confirmado', tone: 'success', glyph: 'check' },
  aguardando: { label: 'Aguardando', tone: 'warning', glyph: 'clock' },
  atendendo: { label: 'Em atendimento', tone: 'info', glyph: 'play' },
  atendido: { label: 'Atendido', tone: 'success', glyph: 'check' },
  faltou: { label: 'Falta', tone: 'danger', glyph: 'x' },
  cancelado: { label: 'Cancelado', tone: 'neutral', glyph: 'x' },
};
