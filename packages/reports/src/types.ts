// packages/reports/src/types.ts

/** Linha de rpt.mv_atendimentos exposta via app_rpt.atendimentos */
export interface AtendimentoRow {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly occurredDate: string;
  readonly durationMinutes: number | null;
  readonly procedureCodes: readonly string[];
  readonly diagnosisCodes: readonly string[];
  readonly versionCount: number;
  readonly status: string;
}

/** Linha de rpt.mv_financeiro exposta via app_rpt.financeiro */
export interface FinanceiroRow {
  readonly entryId: string;
  readonly kind: string;
  readonly category: string | null;
  readonly method: string | null;
  readonly amountCents: number;
  readonly paidAt: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly bankAccountId: string | null;
  readonly costCenterId: string | null;
}

/** Linha de rpt.mv_agenda exposta via app_rpt.agenda */
export interface AgendaRow {
  readonly appointmentDate: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly totalSlots: number;
  readonly booked: number;
  readonly confirmed: number;
  readonly attended: number;
  readonly noShows: number;
  readonly cancelled: number;
  readonly occupancyPct: number;
}

/** Linha de rpt.mv_pacientes exposta via app_rpt.pacientes */
export interface PacienteRow {
  readonly patientId: string;
  readonly ageBracket: string;
  readonly gender: string;
  readonly source: string | null;
  readonly firstVisit: string | null;
  readonly lastVisit: string | null;
  readonly visitCount: number;
}

/** Linha de rpt.mv_satisfacao exposta via app_rpt.satisfacao */
export interface SatisfacaoRow {
  readonly npsResponseId: string;
  readonly score: number;
  readonly category: 'promoter' | 'passive' | 'detractor';
  readonly professionalId: string | null;
  readonly clinicId: string | null;
  readonly respondedAt: string;
}

/** Registro de refresh em rpt.refresh_log */
export interface RefreshLogEntry {
  readonly id: number;
  readonly matviewName: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly rowCount: number;
  readonly success: boolean;
  readonly errorMessage: string | null;
}
