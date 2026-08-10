import type { TxClient } from '@cadencia/db';
import type { AppointmentStatus } from './appointments';

export interface DayCounters {
  readonly agendados: number;
  readonly confirmados: number;
  readonly aguardando: number;
  readonly atendidos: number;
  readonly faltas: number;
}

export interface DayQuery {
  readonly clinicId: string;
  readonly dia: string;                  // AAAA-MM-DD no fuso da clinica
  readonly professionalId?: string;
  readonly status?: AppointmentStatus;
}

/**
 * §3.8 e §5.3 — contadores do dia por CONSULTA VIVA sobre indice parcial,
 * NUNCA matview. Contador defasado e lido como "travou", que e exatamente a
 * queixa que o produto existe para resolver. Alvo publicado: < 20 ms.
 *
 * `agendados` e o TOTAL do dia (todo mundo que esta na fila), nao o subconjunto
 * ainda em status 'agendado' — e o numero que a recepcao le como "quantos hoje".
 */
export async function dayCounters(tx: TxClient, q: DayQuery): Promise<DayCounters> {
  const { rows } = await tx.query<{
    agendados: string; confirmados: string; aguardando: string;
    atendidos: string; faltas: string }>(
    `SELECT count(*)                                            AS agendados,
            count(*) FILTER (WHERE status = 'confirmado')        AS confirmados,
            count(*) FILTER (WHERE status IN ('aguardando','atendendo')) AS aguardando,
            count(*) FILTER (WHERE status = 'atendido')          AS atendidos,
            count(*) FILTER (WHERE status = 'faltou')            AS faltas
       FROM sched.appointment
      WHERE clinic_id = $1 AND appointment_date = $2::date
        AND status <> 'cancelado'
        AND ($3::uuid IS NULL OR professional_id = $3::uuid)`,
    [q.clinicId, q.dia, q.professionalId ?? null]);
  const r = rows[0];
  return {
    agendados: Number(r?.agendados ?? 0),
    confirmados: Number(r?.confirmados ?? 0),
    aguardando: Number(r?.aguardando ?? 0),
    atendidos: Number(r?.atendidos ?? 0),
    faltas: Number(r?.faltas ?? 0),
  };
}

export interface QueueRow {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly professionalId: string;
  readonly professionalNome: string;
  readonly procedureNome: string | null;
  readonly procedureCor: string | null;
  readonly operadoraNome: string | null;
  readonly status: AppointmentStatus;
  readonly encaixe: boolean;
  readonly teleconsulta: boolean;
  readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean;
  readonly encounterId: string | null;
}

/**
 * A fila do dia. Traz os quatro SINAIS que a linha mostra (§5.3): cadastro
 * preliminar, 1a vez, teleconsulta e encaixe. O `encounterId` diz se o
 * atendimento ja foi aberto — e o que decide entre "Abrir atendimento" e
 * "Continuar".
 */
export async function dayQueue(tx: TxClient, q: DayQuery): Promise<QueueRow[]> {
  const { rows } = await tx.query<{
    id: string; starts: string; ends: string; patient_id: string; display_name: string;
    professional_id: string; professional_nome: string;
    proc_nome: string | null; proc_cor: string | null;
    operadora_nome: string | null; status: AppointmentStatus; encaixe: boolean;
    teleconsulta: boolean; primeira_vez: boolean; cadastro_status: string;
    encounter_id: string | null;
  }>(
    `SELECT a.id,
            to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts,
            to_char(a.ends_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends,
            a.patient_id, p.display_name, a.professional_id,
            -- O nome vem de id."user" porque a identidade e GLOBAL (§10 item 2):
            -- app.professional carrega o vinculo e o conselho, nao o nome.
            coalesce(u.full_name, '') AS professional_nome,
            pr.nome AS proc_nome, pr.cor AS proc_cor, a.operadora_nome,
            a.status::text AS status, a.encaixe, a.teleconsulta, a.primeira_vez,
            p.cadastro_status,
            (SELECT e.id FROM clin.encounter e
              WHERE e.tenant_id = a.tenant_id AND e.appointment_id = a.id LIMIT 1) AS encounter_id
       FROM sched.appointment a
       JOIN clin.patient p ON (p.tenant_id, p.id) = (a.tenant_id, a.patient_id)
       LEFT JOIN sched.procedure pr ON (pr.tenant_id, pr.id) = (a.tenant_id, a.procedure_id)
       LEFT JOIN app.professional prof
              ON (prof.tenant_id, prof.id) = (a.tenant_id, a.professional_id)
       LEFT JOIN id."user" u ON u.id = prof.user_id
      WHERE a.clinic_id = $1 AND a.appointment_date = $2::date
        AND a.status <> 'cancelado'
        AND ($3::uuid IS NULL OR a.professional_id = $3::uuid)
        AND ($4::text IS NULL OR a.status::text = $4::text)
      ORDER BY a.starts_at, a.encaixe, a.id`,
    [q.clinicId, q.dia, q.professionalId ?? null, q.status ?? null]);

  return rows.map((r) => ({
    appointmentId: r.id, startsAt: r.starts, endsAt: r.ends,
    patientId: r.patient_id, displayName: r.display_name,
    professionalId: r.professional_id, professionalNome: r.professional_nome,
    procedureNome: r.proc_nome, procedureCor: r.proc_cor,
    operadoraNome: r.operadora_nome, status: r.status,
    encaixe: r.encaixe, teleconsulta: r.teleconsulta, primeiraVez: r.primeira_vez,
    cadastroPreliminar: r.cadastro_status === 'preliminar',
    encounterId: r.encounter_id,
  }));
}
