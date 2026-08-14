import { businessPool } from '@cadencia/db';

export interface InvoiceGenerationResult {
  readonly generated: number;
  readonly skipped: number;
}

export async function generateInvoices(): Promise<InvoiceGenerationResult> {
  const pool = businessPool();

  const { rows: assinaturas } = await pool.query<{
    id: string; tenant_id: string; plano_id: string; valor_por_profissional_cents: number;
  }>(
    `SELECT a.id, a.tenant_id, a.plano_id, p.valor_por_profissional_cents
       FROM com.assinatura a
       JOIN com.plano p ON p.id = a.plano_id
      WHERE a.status = 'ativa'`,
  );

  let generated = 0;

  for (const assinatura of assinaturas) {
    const { rows: countRows } = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM app.professional
        WHERE tenant_id = $1`,
      [assinatura.tenant_id],
    );
    const profissionais = parseInt(countRows[0]?.total ?? '0', 10);
    if (profissionais === 0) continue;

    const valorCents = profissionais * assinatura.valor_por_profissional_cents;

    await pool.query(
      `INSERT INTO com.fatura
         (tenant_id, assinatura_id, valor_cents, status, data_vencimento)
       VALUES ($1, $2, $3, 'pendente', (date_trunc('month', CURRENT_DATE) + interval '9 days')::date)`,
      [assinatura.tenant_id, assinatura.id, valorCents],
    );

    generated += 1;
  }

  return { generated, skipped: assinaturas.length - generated };
}
