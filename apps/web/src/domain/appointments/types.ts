export type AppointmentStatus =
  | 'scheduled'
  | 'confirmation_pending'
  | 'confirmed'
  | 'waiting'
  | 'called'
  | 'in_progress'
  | 'closing'
  | 'completed'
  | 'no_show'
  | 'blocked';

export interface Appointment {
  readonly id: string;
  readonly encounterId: string;
  readonly patientId: string;
  readonly time: string;
  readonly durationMinutes: number;
  readonly patientName: string;
  readonly patientInitials: string;
  readonly patientAge: number;
  readonly patientGender: string;
  readonly professional: string;
  readonly procedure: string;
  readonly insurer: string;
  readonly status: AppointmentStatus;
  readonly waitMinutes: number | null;
  readonly room: string | null;
  readonly telemedicine: boolean;
  readonly alert: string | null;
}
