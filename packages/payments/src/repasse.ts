// packages/payments/src/repasse.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// closeRepassePeriod
// ---------------------------------------------------------------------------

export type CloseRepasseFailure =
  | { kind: 'sem_splits_pendentes' }
  | { kind: 'periodo_ja_fechado' };

export interface CloseRepasseInput {
  readonly tenantId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface CloseRepasseResult {
  readonly statementId: string;
  readonly totalEntries: number;
  readonly totalProfessionalShare: number;
  readonly totalClinicShare: number;
}

export async function closeRepassePeriod(
  tx: TxClient,
  i: CloseRepasseInput,
): Promise<Result<CloseRepasseResult, CloseRepasseFailure>> {
  // Buscar splits pendentes do profissional no período
  const { rows: pendingSplits } = await tx.query<{
    id: string;
    professional_share_cents: string;
    clinic_share_cents: string;
  }>(
    `SELECT s.id, s.professional_share_cents::text, s.clinic_share_cents::text
       FROM fin.split s
       JOIN fin.entry e ON e.tenant_id = s.tenant_id AND e.id = s.entry_id
      WHERE s.professional_id = $1
        AND s.status = 'pendente'
        AND s.statement_id IS NULL
        -- O split nasce quando o lancamento e pago, mas o lancamento pode ser
        -- ESTORNADO depois — e o split fica 'pendente' do mesmo jeito. Sem este
        -- filtro a clinica devolve o dinheiro ao paciente e ainda repassa a
        -- parte do profissional sobre uma receita que deixou de existir.
        AND e.status = 'pago'
        -- O extrato é gravado com clinic_id, então os splits têm de ser DESTA
        -- unidade. Sem o filtro, fechar o período numa unidade arrastava junto o
        -- que o profissional produziu em todas as outras do mesmo tenant, e o
        -- extrato afirmava uma origem que não era a verdadeira.
        AND e.clinic_id = $4
        AND e.paid_at >= $2::date
        AND e.paid_at < ($3::date + 1)`,
    [i.professionalId, i.periodStart, i.periodEnd, i.clinicId]);

  if (pendingSplits.length === 0) {
    return err({ kind: 'sem_splits_pendentes' });
  }

  const totalProfessionalShare = pendingSplits.reduce(
    (acc, s) => acc + Number(s.professional_share_cents), 0);
  const totalClinicShare = pendingSplits.reduce(
    (acc, s) => acc + Number(s.clinic_share_cents), 0);

  const statementId = uuidv7();

  // Criar o extrato
  await tx.query(
    `INSERT INTO fin.repasse_statement
       (tenant_id, id, professional_id, clinic_id, period_start, period_end,
        total_entries, total_professional_share, total_clinic_share, status)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4::date, $5::date,
             $6, $7, $8, 'fechado')`,
    [statementId, i.professionalId, i.clinicId,
     i.periodStart, i.periodEnd,
     pendingSplits.length, totalProfessionalShare, totalClinicShare]);

  // Atualizar os splits: vincular ao extrato e marcar como creditado
  const splitIds = pendingSplits.map((s) => s.id);
  await tx.query(
    `UPDATE fin.split
        SET status = 'creditado', statement_id = $1
      WHERE id = ANY($2::uuid[])`,
    [statementId, splitIds]);

  await tx.query(
    `SELECT audit.log('REPASSE_CLOSE', 'fin', 'repasse_statement', $1, 'sucesso',
                      jsonb_build_object('professional_id', $2::text,
                                         'amount_cents', $3::bigint,
                                         'status', 'fechado'::text), $4)`,
    [statementId, i.professionalId, totalProfessionalShare, null]);

  return ok({
    statementId,
    totalEntries: pendingSplits.length,
    totalProfessionalShare,
    totalClinicShare,
  });
}

// ---------------------------------------------------------------------------
// payRepasse
// ---------------------------------------------------------------------------

export type PayRepasseFailure =
  | { kind: 'extrato_nao_encontrado' }
  | { kind: 'ja_pago' }
  | { kind: 'nao_fechado' };

export interface PayRepasseInput {
  readonly statementId: string;
}

export interface PayRepasseResult {
  readonly statementId: string;
  readonly status: string;
}

export async function payRepasse(
  tx: TxClient,
  i: PayRepasseInput,
): Promise<Result<PayRepasseResult, PayRepasseFailure>> {
  const { rows } = await tx.query<{ status: string; professional_id: string }>(
    `SELECT status::text, professional_id::text
       FROM fin.repasse_statement WHERE id = $1`,
    [i.statementId]);

  if (rows.length === 0) {
    return err({ kind: 'extrato_nao_encontrado' });
  }

  const stmt = rows[0]!;
  if (stmt.status === 'pago') return err({ kind: 'ja_pago' });
  if (stmt.status !== 'fechado') return err({ kind: 'nao_fechado' });

  // Marcar extrato como pago
  await tx.query(
    `UPDATE fin.repasse_statement
        SET status = 'pago', paid_at = clock_timestamp()
      WHERE id = $1`,
    [i.statementId]);

  // Atualizar splits vinculados para 'pago'
  await tx.query(
    `UPDATE fin.split SET status = 'pago' WHERE statement_id = $1`,
    [i.statementId]);

  await tx.query(
    `SELECT audit.log('REPASSE_PAY', 'fin', 'repasse_statement', $1, 'sucesso',
                      jsonb_build_object('professional_id', $2::text,
                                         'status', 'pago'::text), NULL)`,
    [i.statementId, stmt.professional_id]);

  return ok({ statementId: i.statementId, status: 'pago' });
}
