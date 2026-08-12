import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { SchedulingFailure } from './appointments';

export interface CheckInResult {
  readonly appointmentId: string;
  readonly status: 'aguardando';
  /** A dívida de dados a cobrar AGORA, com a pessoa na frente. */
  readonly pendentes: readonly string[];
}

/**
 * §5.5 — o check-in é o MOMENTO CERTO de cobrar CPF, nascimento e sexo: a pessoa
 * está na frente e o dado sai correto. Ele NÃO bloqueia: quem bloqueia é a
 * finalização do atendimento e o faturamento de convênio, que são os momentos em
 * que o dado é de fato obrigatório. Cobrar no agendamento por telefone é o que
 * faz nascer o 000.000.000-00.
 *
 * A função NÃO importa @cadencia/patients: scheduling e patients são de camadas
 * diferentes (L2 e L1) e a seta desce, mas a consulta aqui é de três colunas —
 * criar dependência entre módulos por causa disso é o início do acoplamento que
 * o §2.2 existe para evitar.
 */
export async function checkIn(
  tx: TxClient, i: { appointmentId: string },
): Promise<Result<CheckInResult, SchedulingFailure>> {
  const { rows } = await tx.query<{
    patient_id: string; clinic_id: string;
    birth_date: string | null; sex_at_birth: string | null; tem_doc: boolean }>(
    `UPDATE sched.appointment a
        SET status = 'aguardando', arrived_at = clock_timestamp()
      WHERE a.id = $1 AND a.status IN ('agendado','confirmado')
    RETURNING a.patient_id, a.clinic_id,
              (SELECT p.birth_date::text FROM clin.patient p
                WHERE (p.tenant_id, p.id) = (a.tenant_id, a.patient_id)) AS birth_date,
              (SELECT p.sex_at_birth FROM clin.patient p
                WHERE (p.tenant_id, p.id) = (a.tenant_id, a.patient_id)) AS sex_at_birth,
              EXISTS (SELECT 1 FROM clin.patient_identifier i
                       WHERE i.tenant_id = a.tenant_id AND i.patient_id = a.patient_id
                         AND i.kind IN ('CPF','CNS','DNV','PASSAPORTE','SEM_DOCUMENTO')) AS tem_doc`,
    [i.appointmentId]);

  const r = rows[0];
  if (!r) return err({ kind: 'agendamento_nao_encontrado' });

  const pendentes: string[] = [];
  if (r.birth_date === null) pendentes.push('birth_date');
  if (!r.tem_doc) pendentes.push('cpf');
  if (r.sex_at_birth === null) pendentes.push('sex_at_birth');

  await tx.query(
    `SELECT audit.log('APPOINTMENT_CHECKIN', 'sched', 'appointment', $1, 'sucesso',
                      jsonb_build_object('pendencias', $2::int), $3)`,
    [i.appointmentId, pendentes.length, r.clinic_id]);

  return ok({ appointmentId: i.appointmentId, status: 'aguardando', pendentes });
}
