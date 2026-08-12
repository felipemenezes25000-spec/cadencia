import type { AppointmentStatus } from './types';

/** Leitura operacional devolvida por GET /v1/agenda/dia. */
export interface OperationalAppointment {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly professionalId: string;
  readonly professionalNome?: string;
  readonly procedureNome: string | null;
  readonly procedureCor: string | null;
  readonly operadoraNome: string | null;
  readonly status: AppointmentStatus;
  readonly encaixe: boolean;
  readonly teleconsulta: boolean;
  readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean;
  readonly encounterId: string | null;
  readonly valorSugeridoCentavos?: number;
  readonly mensagensNaoLidas: number;
  readonly pagamentoPendente: boolean;
}
