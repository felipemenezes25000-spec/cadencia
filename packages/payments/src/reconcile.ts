// packages/payments/src/reconcile.ts
import type { TxClient } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { PaymentProvider, ProviderCtx } from '@cadencia/integrations';

export interface ReconcileInput {
  readonly clinicId: string;
  readonly from: string;
  readonly to: string;
  readonly reconciledDate: string;
}

export interface ReconcileResult {
  readonly settlementsProcessed: number;
  readonly divergencesFound: number;
}

export async function reconcileSettlements(
  tx: TxClient,
  provider: PaymentProvider,
  providerCtx: ProviderCtx,
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const result = await provider.fetchSettlements(providerCtx, {
    from: input.from as any,
    to: input.to as any,
  });

  if (!result.ok) {
    throw new Error(`fetchSettlements falhou: ${result.error.detail}`);
  }

  const settlements = result.value;
  let divergencesFound = 0;

  for (const s of settlements) {
    // Buscar o entry correspondente pelo external_ref
    const { rows } = await tx.query<{
      id: string; amount_cents: string; status: string;
    }>(
      `SELECT id, amount_cents::text, status::text
         FROM fin.entry
        WHERE external_ref = $1`,
      [s.providerPaymentId],
    );

    if (rows.length === 0) {
      // Pagamento existe no PSP mas não no sistema
      await tx.query(
        `INSERT INTO fin.reconciliation_log
           (tenant_id, id, reconciled_date, provider_payment_id, kind,
            expected_cents, actual_cents, detail)
         VALUES (app.require_tenant_id(), $1, $2, $3, 'missing_in_system',
                 NULL, $4, 'pagamento encontrado no PSP sem correspondente no sistema')`,
        [uuidv7(), input.reconciledDate, s.providerPaymentId, s.grossCents],
      );
      divergencesFound += 1;
      continue;
    }

    const entry = rows[0]!;
    const entryAmountCents = Number(entry.amount_cents);

    // Comparar valor bruto
    if (entryAmountCents !== s.grossCents) {
      await tx.query(
        `INSERT INTO fin.reconciliation_log
           (tenant_id, id, reconciled_date, provider_payment_id, entry_id, kind,
            expected_cents, actual_cents, detail)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'amount_mismatch',
                 $5, $6, 'valor no sistema difere do valor bruto no PSP')`,
        [uuidv7(), input.reconciledDate, s.providerPaymentId, entry.id,
         entryAmountCents, s.grossCents],
      );
      divergencesFound += 1;
    }

    // Atualizar a taxa REAL do PSP no payment_link (a taxa vem do PSP, nunca calculamos)
    await tx.query(
      `UPDATE fin.payment_link
          SET fee_cents = $1, updated_at = clock_timestamp()
        WHERE provider_link_id = $2`,
      [s.feeCents, s.providerPaymentId],
    );
  }

  // Verificar entries pagos que não apareceram na liquidação do PSP
  const { rows: missingInPsp } = await tx.query<{ id: string; external_ref: string }>(
    `SELECT e.id, e.external_ref
       FROM fin.entry e
      WHERE e.clinic_id = $1
        AND e.status = 'pago'
        AND e.external_ref IS NOT NULL
        AND e.paid_at >= $2::timestamptz
        AND e.paid_at < $3::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM unnest($4::text[]) AS psp_id
           WHERE psp_id = e.external_ref
        )`,
    [
      input.clinicId,
      input.from,
      input.to,
      settlements.map((s) => s.providerPaymentId),
    ],
  );

  for (const missing of missingInPsp) {
    await tx.query(
      `INSERT INTO fin.reconciliation_log
         (tenant_id, id, reconciled_date, provider_payment_id, entry_id, kind, detail)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'missing_in_psp',
               'pagamento marcado como pago no sistema mas ausente na liquidacao do PSP')`,
      [uuidv7(), input.reconciledDate, missing.external_ref, missing.id],
    );
    divergencesFound += 1;
  }

  return { settlementsProcessed: settlements.length, divergencesFound };
}
