// packages/scheduling/src/criar-recorrencia.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { expandirRecorrencia, type FrequenciaRecorrencia } from './recorrencia';

export interface CriarRecorrenciaInput {
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly procedureId: string;
  /** Data da primeira ocorrencia no fuso da CLINICA, 'AAAA-MM-DD'. */
  readonly primeiraData: string;
  /** Hora de parede, 'HH:MM'. */
  readonly hora: string;
  readonly freq: FrequenciaRecorrencia;
  readonly intervalo: number;
  readonly horizonteAte: string;
  readonly observacao?: string;
}

export interface OcorrenciaCriada {
  readonly quando: string;
  readonly appointmentId: string;
}

export interface OcorrenciaRecusada {
  readonly quando: string;
  readonly motivo: 'horario_ocupado' | 'sala_ocupada' | 'erro';
}

export interface RecorrenciaCriada {
  readonly recurrenceId: string;
  readonly criadas: readonly OcorrenciaCriada[];
  /**
   * Ocorrencias que NAO couberam.
   *
   * A serie nao e tudo-ou-nada de proposito: numa fisioterapia de 12 sessoes,
   * uma colidir com feriado nao pode impedir as outras onze. Mas a recepcao
   * PRECISA ver quais falharam — recusar em silencio deixaria o paciente
   * achando que tem consulta num dia em que nao tem.
   */
  readonly recusadas: readonly OcorrenciaRecusada[];
}

export type RecorrenciaFailure =
  | { kind: 'unidade_nao_encontrada' }
  | { kind: 'procedimento_nao_encontrado' }
  | { kind: 'serie_muito_longa'; mensagem: string };

const EXCLUSION_VIOLATION = '23P01';

function sqlstateDe(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code) : '';
}

function restricaoDe(e: unknown): string {
  return typeof e === 'object' && e !== null && 'constraint' in e
    ? String((e as { constraint: unknown }).constraint) : '';
}

/**
 * Cria a serie recorrente e os agendamentos dela.
 *
 * A hora de parede vira instante no POSTGRES, com o fuso da unidade:
 * `($1 || ' ' || $2)::timestamp AT TIME ZONE tz`. Converter em JavaScript usaria
 * as regras de fuso do runtime, que sao as do sistema operacional de quem roda —
 * e uma serie de seis meses atravessa mudanca de regra com facilidade.
 */
export async function criarRecorrencia(
  tx: TxClient, i: CriarRecorrenciaInput,
): Promise<Result<RecorrenciaCriada, RecorrenciaFailure>> {
  const { rows: cl } = await tx.query<{ timezone: string }>(
    `SELECT timezone FROM app.clinic WHERE id = $1`, [i.clinicId]);
  const tz = cl[0]?.timezone;
  if (tz === undefined) return err({ kind: 'unidade_nao_encontrada' });

  const { rows: proc } = await tx.query<{ duracao_min: number }>(
    `SELECT duracao_min FROM sched.procedure WHERE id = $1`, [i.procedureId]);
  const duracao = proc[0]?.duracao_min;
  if (duracao === undefined) return err({ kind: 'procedimento_nao_encontrado' });

  let quandos: string[];
  try {
    quandos = expandirRecorrencia({
      primeiraData: i.primeiraData, hora: i.hora, freq: i.freq,
      intervalo: i.intervalo, horizonteAte: i.horizonteAte,
    });
  } catch (e) {
    return err({ kind: 'serie_muito_longa', mensagem: (e as Error).message });
  }

  const recurrenceId = uuidv7();
  await tx.query(
    `INSERT INTO sched.recurrence (
       id, patient_id, professional_id, clinic_id, procedure_id, freq,
       intervalo, first_starts_at, duracao_min, horizonte_ate, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::sched.recurrence_freq, $7,
             ($8 || ' ' || $9)::timestamp AT TIME ZONE $10,
             $11, $12::date, app.current_user_id())`,
    [recurrenceId, i.patientId, i.professionalId, i.clinicId, i.procedureId,
     i.freq, i.intervalo, i.primeiraData, i.hora, tz, duracao, i.horizonteAte]);

  const criadas: OcorrenciaCriada[] = [];
  const recusadas: OcorrenciaRecusada[] = [];

  for (const quando of quandos) {
    const [data, hora] = quando.split('T') as [string, string];
    const appointmentId = uuidv7();
    try {
      // SAVEPOINT por ocorrencia: sem ele, a primeira colisao aborta a
      // transacao inteira no Postgres e as ocorrencias seguintes nem sao
      // tentadas — a serie de 12 sessoes morreria na terceira.
      await tx.query('SAVEPOINT ocorrencia');
      await tx.query(
        `INSERT INTO sched.appointment (
           id, patient_id, professional_id, clinic_id, procedure_id,
           recurrence_id, starts_at, ends_at, appointment_date, observacao,
           primeira_vez, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 ($7 || ' ' || $8)::timestamp AT TIME ZONE $9,
                 (($7 || ' ' || $8)::timestamp AT TIME ZONE $9)
                   + make_interval(mins => $10),
                 $7::date, $11,
                 NOT EXISTS (SELECT 1 FROM sched.appointment a
                              WHERE a.patient_id = $2 AND a.status = 'atendido'),
                 app.current_user_id())`,
        [appointmentId, i.patientId, i.professionalId, i.clinicId, i.procedureId,
         recurrenceId, data, hora, tz, duracao, i.observacao ?? null]);
      await tx.query('RELEASE SAVEPOINT ocorrencia');
      criadas.push({ quando, appointmentId });
    } catch (e) {
      await tx.query('ROLLBACK TO SAVEPOINT ocorrencia');
      const motivo = sqlstateDe(e) === EXCLUSION_VIOLATION
        ? (restricaoDe(e).includes('room') ? 'sala_ocupada' : 'horario_ocupado')
        : 'erro';
      recusadas.push({ quando, motivo });
    }
  }

  await tx.query(
    `SELECT audit.log('RECURRENCE_CREATE', 'sched', 'recurrence', $1, 'sucesso',
                      jsonb_build_object('ocorrencias', $2::int), $3)`,
    [recurrenceId, criadas.length, i.clinicId]);

  return ok({ recurrenceId, criadas, recusadas });
}

/**
 * Cancela as ocorrencias FUTURAS de uma serie.
 *
 * Nunca toca no passado: consulta que ja aconteceu e fato, e apagar o registro
 * dela apagaria o motivo de uma cobranca. O que a recepcao quer ao "cancelar a
 * recorrencia" e parar o que ainda vem.
 */
export async function cancelarRecorrenciaFutura(
  tx: TxClient, recurrenceId: string, clinicId: string,
): Promise<number> {
  const { rows } = await tx.query<{ n: string }>(
    `WITH alvo AS (
       UPDATE sched.appointment a
          -- cancelled_at anda JUNTO do status: existe um CHECK ligando os dois
          -- para que nao haja agendamento cancelado sem hora de cancelamento.
          -- Sem ela ninguem responde "quando isso foi desmarcado" numa
          -- reclamacao de paciente.
          SET status = 'cancelado', cancelled_at = clock_timestamp()
         FROM sched.recurrence r, app.clinic c
        WHERE a.recurrence_id = r.id
          AND r.id = $1
          AND c.id = r.clinic_id
          -- Compara INSTANTE, nao data.
          --
          -- Era appointment_date > local_date(...), que joga o dia de hoje
          -- inteiro no passado: a recepcao cancelava a serie de manha e a
          -- consulta de hoje as 16h continuava marcada — o paciente aparecia.
          -- Trocar para >= inverteria o erro e cancelaria a consulta das 8h
          -- que ja tinha acontecido, que e justamente o que o comentario acima
          -- proibe. Por instante, "futura" quer dizer futura de verdade, e a
          -- fronteira e o horario da consulta, nao a meia-noite da clinica.
          AND a.starts_at > clock_timestamp()
          AND a.status IN ('agendado', 'confirmado')
        RETURNING a.id)
     SELECT count(*)::text AS n FROM alvo`,
    [recurrenceId]);

  await tx.query(
    `SELECT audit.log('RECURRENCE_CANCEL', 'sched', 'recurrence', $1, 'sucesso',
                      jsonb_build_object('ocorrencias', $2::int), $3)`,
    [recurrenceId, Number(rows[0]?.n ?? 0), clinicId]);

  return Number(rows[0]?.n ?? 0);
}
