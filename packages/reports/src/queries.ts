// packages/reports/src/queries.ts
import type { TxClient } from '@cadencia/db';
import type { AtendimentoRow, AgendaRow, RefreshLogEntry } from './types';

/**
 * Lista atendimentos no período, filtrados pela view security_barrier.
 * A view app_rpt.atendimentos já aplica tenant e escopo clínico.
 *
 * packages/reports NÃO lê matview diretamente — sempre via app_rpt (§3.8, §2.2).
 */
export async function listAtendimentos(
  tx: TxClient,
  dateFrom: string,
  dateTo: string,
): Promise<AtendimentoRow[]> {
  const { rows } = await tx.query<{
    encounter_id: string;
    patient_id: string;
    professional_id: string;
    clinic_id: string;
    occurred_date: Date;
    duration_minutes: number | null;
    procedure_codes: string[];
    diagnosis_codes: string[];
    version_count: number;
    status: string;
  }>(
    `SELECT encounter_id, patient_id, professional_id, clinic_id,
            occurred_date, duration_minutes, procedure_codes,
            diagnosis_codes, version_count, status
       FROM app_rpt.atendimentos
      WHERE occurred_date >= $1::date AND occurred_date <= $2::date
      ORDER BY occurred_date DESC`,
    [dateFrom, dateTo],
  );

  return rows.map((r) => ({
    encounterId: r.encounter_id,
    patientId: r.patient_id,
    professionalId: r.professional_id,
    clinicId: r.clinic_id,
    occurredDate: r.occurred_date.toISOString().slice(0, 10),
    durationMinutes: r.duration_minutes,
    procedureCodes: r.procedure_codes,
    diagnosisCodes: r.diagnosis_codes,
    versionCount: r.version_count,
    status: r.status,
  }));
}

/**
 * Resumo da agenda no período. A view app_rpt.agenda já filtra por tenant.
 */
export async function listAgenda(
  tx: TxClient,
  dateFrom: string,
  dateTo: string,
): Promise<AgendaRow[]> {
  const { rows } = await tx.query<{
    appointment_date: Date;
    professional_id: string;
    clinic_id: string;
    total_slots: number;
    booked: number;
    confirmed: number;
    attended: number;
    no_shows: number;
    cancelled: number;
    occupancy_pct: number;
  }>(
    `SELECT appointment_date, professional_id, clinic_id,
            total_slots, booked, confirmed, attended,
            no_shows, cancelled, occupancy_pct
       FROM app_rpt.agenda
      WHERE appointment_date >= $1::date AND appointment_date <= $2::date
      ORDER BY appointment_date DESC`,
    [dateFrom, dateTo],
  );

  return rows.map((r) => ({
    appointmentDate: r.appointment_date.toISOString().slice(0, 10),
    professionalId: r.professional_id,
    clinicId: r.clinic_id,
    totalSlots: r.total_slots,
    booked: r.booked,
    confirmed: r.confirmed,
    attended: r.attended,
    noShows: r.no_shows,
    cancelled: r.cancelled,
    occupancyPct: r.occupancy_pct,
  }));
}

/**
 * Último refresh de cada matview. Usado pelo front para exibir
 * "dados ate HH:MM" (§3.8). Lê diretamente de rpt.refresh_log
 * via app_rw (que tem SELECT na tabela).
 */
export async function getRefreshTimestamps(
  tx: TxClient,
): Promise<RefreshLogEntry[]> {
  const { rows } = await tx.query<{
    id: string;
    matview_name: string;
    started_at: Date;
    finished_at: Date | null;
    row_count: string;
    success: boolean;
    error_message: string | null;
  }>(`
    SELECT DISTINCT ON (matview_name)
           id, matview_name, started_at, finished_at,
           row_count, success, error_message
      FROM rpt.refresh_log
     ORDER BY matview_name, started_at DESC`);

  return rows.map((r) => ({
    id: Number(r.id),
    matviewName: r.matview_name,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    rowCount: Number(r.row_count),
    success: r.success,
    errorMessage: r.error_message,
  }));
}
