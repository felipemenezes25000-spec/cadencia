// apps/worker/src/jobs/payment-reconciliation.ts
import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, isoFromMs, systemClock } from '@cadencia/kernel';
import type { PaymentProvider } from '@cadencia/integrations';
import { asRfc3339 } from '@cadencia/integrations';

export interface ReconciliationResult {
  readonly tenantsProcessed: number;
  readonly settlementsFound: number;
  readonly divergences: number;
}

/**
 * Reconciliacao noturna — busca settlements do PSP e compara com o nosso banco.
 *
 * Roda como job noturno. Para cada tenant com payment_link pago nos ultimos 30 dias,
 * busca os settlements do dia anterior e marca divergencias.
 *
 * NAO existe fin.payment — usa fin.payment_link vinculado a fin.entry (00-CONTRATOS.md §3.6).
 */
export async function reconcilePayments(
  payment: PaymentProvider,
): Promise<ReconciliationResult> {
  // Buscar tenants com payment_links pagos nos ultimos 30 dias
  // fin.payment_link tem provider_link_id que conecta ao PSP
  const { rows: tenants } = await jobsPool().query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM fin.payment_link
      WHERE status = 'paid'
        AND paid_at > clock_timestamp() - interval '30 days'`);

  let settlementsFound = 0;
  let divergences = 0;

  // Calcular o dia anterior via isoFromMs do kernel (regra de fonte de tempo §5).
  const yesterdayMs = systemClock.nowMs() - 86_400_000;
  const yesterdayIso = isoFromMs(yesterdayMs);        // "2026-08-04T12:34:56.789Z"
  const yesterdayDate = yesterdayIso.slice(0, 10);     // "2026-08-04"
  const from = asRfc3339(`${yesterdayDate}T00:00:00.000Z`);
  const to = asRfc3339(`${yesterdayDate}T23:59:59.999Z`);

  if (from === null || to === null) {
    return { tenantsProcessed: 0, settlementsFound: 0, divergences: 0 };
  }

  for (const t of tenants) {
    const actor: Actor = {
      kind: 'system',
      tenantId: t.tenant_id,
      reason: 'payment-reconciliation',
      requestId: uuidv7(),
    };

    const ctx = {
      tenantId: t.tenant_id,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `recon-${t.tenant_id}-${isoFromMs(systemClock.nowMs()).slice(0, 10)}`,
      deadlineMs: 30_000,
    };

    const resultado = await payment.fetchSettlements(ctx, { from, to });
    if (!resultado.ok) continue;

    for (const settlement of resultado.value) {
      settlementsFound += 1;

      await withTenantTx(actor, async (tx) => {
        // Verificar se o payment_link existe com o valor correto
        // O provider_link_id no payment_link corresponde ao providerPaymentId do settlement
        const { rows } = await tx.query<{
          id: string; amount_cents: string; entry_id: string; fee_cents: string | null;
        }>(
          `SELECT id, amount_cents::text, entry_id,
                  fee_cents::text
             FROM fin.payment_link WHERE provider_link_id = $1`,
          [settlement.providerPaymentId]);

        if (rows.length === 0) {
          // Pagamento no PSP que nao esta no nosso banco — divergencia
          divergences += 1;
          const today = isoFromMs(systemClock.nowMs()).slice(0, 10);
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, tenant_id, reconciled_date, provider_payment_id, kind, detail, created_at)
             VALUES ($1, $2, $3::date, $4, 'missing_in_system', $5, clock_timestamp())`,
            [uuidv7(), t.tenant_id, today, settlement.providerPaymentId,
             `Pagamento ${settlement.providerPaymentId} encontrado no PSP mas ausente no banco`]);
          return;
        }

        const pay = rows[0]!;
        const localCents = Number(pay.amount_cents);
        if (localCents !== settlement.grossCents) {
          divergences += 1;
          const today = isoFromMs(systemClock.nowMs()).slice(0, 10);
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, tenant_id, reconciled_date, provider_payment_id, entry_id, kind,
                expected_cents, actual_cents, detail, created_at)
             VALUES ($1, $2, $3::date, $4, $5, 'amount_mismatch', $6, $7, $8, clock_timestamp())`,
            [uuidv7(), t.tenant_id, today, settlement.providerPaymentId, pay.entry_id,
             localCents, settlement.grossCents,
             `Local: ${localCents}, PSP gross: ${settlement.grossCents}, taxa: ${settlement.feeCents}`]);
        }

        // Gravar a taxa real do PSP no payment_link
        await tx.query(
          `UPDATE fin.payment_link
              SET fee_cents = $2, method = $3, updated_at = clock_timestamp()
            WHERE id = $1`,
          [pay.id, settlement.feeCents, 'psp']);
      });
    }
  }

  return { tenantsProcessed: tenants.length, settlementsFound, divergences };
}
