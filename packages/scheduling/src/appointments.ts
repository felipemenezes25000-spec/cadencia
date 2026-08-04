import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type AppointmentStatus =
  | 'agendado' | 'confirmado' | 'aguardando' | 'atendendo'
  | 'atendido' | 'faltou' | 'cancelado';

export interface CreateAppointmentInput {
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly startsAt: string;            // RFC 3339
  readonly endsAt?: string;
  readonly procedureId?: string;
  readonly roomId?: string;
  readonly operadoraNome?: string;
  readonly encaixe?: boolean;
  readonly teleconsulta?: boolean;
  readonly observacao?: string;
}

export type SchedulingFailure =
  | { kind: 'unidade_nao_encontrada' }
  | { kind: 'duracao_desconhecida' }
  | { kind: 'horario_ocupado'; encaixePossivel: boolean }
  | { kind: 'sala_ocupada' }
  | { kind: 'agendamento_nao_encontrado' };

export interface CreatedAppointment {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly appointmentDate: string;
  readonly avisos: readonly ('horario_bloqueado')[];
}

/** 23P01 = exclusion_violation. E o SQLSTATE do encaixe negado e da sala ocupada. */
const EXCLUSION_VIOLATION = '23P01';

function sqlstateDe(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
}

function restricaoDe(e: unknown): string {
  return typeof e === 'object' && e !== null && 'constraint' in e
    ? String((e as { constraint: unknown }).constraint) : '';
}

export async function createAppointment(
  tx: TxClient, i: CreateAppointmentInput,
): Promise<Result<CreatedAppointment, SchedulingFailure>> {
  const clinica = await tx.query<{ timezone: string }>(
    `SELECT timezone FROM app.clinic WHERE id = $1`, [i.clinicId]);
  const tz = clinica.rows[0]?.timezone;
  if (tz === undefined) return err({ kind: 'unidade_nao_encontrada' });

  let fim = i.endsAt;
  if (fim === undefined) {
    if (i.procedureId === undefined) return err({ kind: 'duracao_desconhecida' });
    const p = await tx.query<{ fim: string }>(
      `SELECT to_char(($2::timestamptz + make_interval(mins => duracao_min)) AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fim
         FROM sched.procedure WHERE id = $1`, [i.procedureId, i.startsAt]);
    fim = p.rows[0]?.fim;
    if (fim === undefined) return err({ kind: 'duracao_desconhecida' });
  }

  // Bloqueio AVISA, nao impede: quem decide encaixar sobre o almoco e a recepcao,
  // com a pessoa na frente. Software que impede vira caderno na mesa.
  const bloq = await tx.query<{ bloqueado: boolean }>(
    `SELECT sched.is_blocked($1, $2::timestamptz, $3::timestamptz) AS bloqueado`,
    [i.professionalId, i.startsAt, fim]);
  const avisos = bloq.rows[0]?.bloqueado === true ? (['horario_bloqueado'] as const) : ([] as const);

  const appointmentId = uuidv7();
  try {
    const { rows } = await tx.query<{ starts: string; ends: string; d: string }>(
      `INSERT INTO sched.appointment (
          id, patient_id, professional_id, clinic_id, room_id, procedure_id,
          operadora_nome, starts_at, ends_at, appointment_date, encaixe, teleconsulta,
          observacao, primeira_vez, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz,
               app.local_date($8::timestamptz, $10), $11, $12, $13,
               NOT EXISTS (SELECT 1 FROM sched.appointment a
                            WHERE a.patient_id = $2 AND a.status = 'atendido'),
               app.current_user_id())
       RETURNING to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts,
                 to_char(ends_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends,
                 appointment_date::text AS d`,
      [appointmentId, i.patientId, i.professionalId, i.clinicId, i.roomId ?? null,
       i.procedureId ?? null, i.operadoraNome ?? null, i.startsAt, fim, tz,
       i.encaixe ?? false, i.teleconsulta ?? false, i.observacao ?? null]);
    const linha = rows[0];
    if (!linha) return err({ kind: 'agendamento_nao_encontrado' });

    await tx.query(
      `SELECT audit.log('APPOINTMENT_CREATE', 'sched', 'appointment', $1, 'sucesso',
                        jsonb_build_object('encaixe', $2::boolean), $3)`,
      [appointmentId, i.encaixe ?? false, i.clinicId]);

    return ok({
      appointmentId,
      startsAt: linha.starts, endsAt: linha.ends, appointmentDate: linha.d, avisos,
    });
  } catch (e) {
    if (sqlstateDe(e) === EXCLUSION_VIOLATION) {
      if (restricaoDe(e) === 'ex_appointment_sala') return err({ kind: 'sala_ocupada' });
      // encaixePossivel diz para a tela oferecer "Encaixar mesmo assim" em vez de
      // um erro seco. E o gesto que a recepcao brasileira faz o dia inteiro.
      return err({ kind: 'horario_ocupado', encaixePossivel: true });
    }
    throw e;
  }
}

export interface MoveInput {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly professionalId?: string;
  readonly roomId?: string | null;
}

/** Arrastar na agenda. Mantem a DURACAO e recalcula a data no fuso da unidade. */
export async function moveAppointment(
  tx: TxClient, i: MoveInput,
): Promise<Result<{ appointmentId: string; startsAt: string; endsAt: string;
                   appointmentDate: string }, SchedulingFailure>> {
  try {
    const { rows } = await tx.query<{ starts: string; ends: string; d: string }>(
      `UPDATE sched.appointment a
          SET starts_at = $2::timestamptz,
              ends_at   = $2::timestamptz + (a.ends_at - a.starts_at),
              professional_id = coalesce($3::uuid, a.professional_id),
              room_id   = CASE WHEN $4::boolean THEN $5::uuid ELSE a.room_id END,
              appointment_date = app.local_date($2::timestamptz,
                                   (SELECT c.timezone FROM app.clinic c WHERE c.id = a.clinic_id))
        WHERE a.id = $1
      RETURNING to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts,
                to_char(a.ends_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends,
                a.appointment_date::text AS d`,
      [i.appointmentId, i.startsAt, i.professionalId ?? null,
       i.roomId !== undefined, i.roomId ?? null]);
    const linha = rows[0];
    if (!linha) return err({ kind: 'agendamento_nao_encontrado' });
    return ok({ appointmentId: i.appointmentId, startsAt: linha.starts,
                endsAt: linha.ends, appointmentDate: linha.d });
  } catch (e) {
    if (sqlstateDe(e) === EXCLUSION_VIOLATION) {
      if (restricaoDe(e) === 'ex_appointment_sala') return err({ kind: 'sala_ocupada' });
      return err({ kind: 'horario_ocupado', encaixePossivel: true });
    }
    throw e;
  }
}

const CARIMBO: Readonly<Record<AppointmentStatus, string | null>> = {
  agendado: null, confirmado: 'confirmed_at', aguardando: 'arrived_at',
  atendendo: 'started_at', atendido: 'finished_at', faltou: null, cancelado: 'cancelled_at',
};

export interface SetStatusInput {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
  readonly cancelReason?: string;
}

export async function setStatus(
  tx: TxClient, i: SetStatusInput,
): Promise<Result<{ appointmentId: string; status: AppointmentStatus }, SchedulingFailure>> {
  const coluna = CARIMBO[i.status];
  // O nome da coluna vem de um mapa fechado sobre o tipo, nunca da entrada:
  // interpolar identificador vindo do cliente e injecao de SQL.
  const setExtra = coluna === null ? '' : `, ${coluna} = clock_timestamp()`;
  const { rowCount } = await tx.query(
    `UPDATE sched.appointment
        SET status = $2::sched.appointment_status,
            cancel_reason = CASE WHEN $2 = 'cancelado' THEN $3 ELSE cancel_reason END
            ${setExtra}
      WHERE id = $1`,
    [i.appointmentId, i.status, i.cancelReason ?? null]);
  if (rowCount === 0) return err({ kind: 'agendamento_nao_encontrado' });

  await tx.query(
    `SELECT audit.log('APPOINTMENT_STATUS', 'sched', 'appointment', $1, 'sucesso',
                      jsonb_build_object('status', $2::text), NULL)`,
    [i.appointmentId, i.status]);
  return ok({ appointmentId: i.appointmentId, status: i.status });
}
