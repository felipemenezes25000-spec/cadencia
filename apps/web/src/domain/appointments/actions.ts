import type { AppointmentPrimaryActionId, AppointmentStatus } from './types';

export interface PrimaryAppointmentAction {
  readonly id: AppointmentPrimaryActionId;
  readonly label: string;
  readonly intent: 'default' | 'clinical' | 'warning';
}

const ACTIONS: Record<AppointmentStatus, PrimaryAppointmentAction> = {
  agendado: { id: 'confirmar', label: 'Confirmar', intent: 'default' },
  confirmado: { id: 'checkin', label: 'Fazer check-in', intent: 'default' },
  aguardando: { id: 'abrir_atendimento', label: 'Iniciar', intent: 'clinical' },
  atendendo: { id: 'abrir_atendimento', label: 'Continuar', intent: 'clinical' },
  atendido: { id: 'ver_atendimento', label: 'Ver atendimento', intent: 'default' },
  faltou: { id: 'reagendar', label: 'Reagendar', intent: 'warning' },
  cancelado: { id: 'ver_detalhes', label: 'Ver detalhes', intent: 'default' },
};

/** Uma unica fonte de verdade para a CTA de cada estado persistido. */
export function getPrimaryAction(status: AppointmentStatus): PrimaryAppointmentAction {
  return ACTIONS[status];
}
