### Task 34: funcoes de dominio — criar link, processar webhook, conciliar

**Arquivos**
- Criar `packages/payments/src/create-payment-link.ts`
- Criar `packages/payments/src/process-webhook.ts`
- Criar `packages/payments/src/reconcile.ts`
- Criar `packages/payments/src/rollup.ts`
- Modificar `packages/payments/src/index.ts`
- Criar `packages/payments/src/payments.int.test.ts`
- Criar `packages/payments/src/test-support.ts`

- [ ] Criar o seed de teste `packages/payments/src/test-support.ts`:

```ts
// packages/payments/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeFinanceiro {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string; procedureId: string;
  entryId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`',
    );
  }
  return url;
}

export async function semearFinanceiro(): Promise<SementeFinanceiro> {
  const s: SementeFinanceiro = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), procedureId: uuidv7(),
    entryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Financeiro', '98ABC76501DE43')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Fin', '7654321', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Fin')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '654321', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Joao Pagador Silva', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, clinic_id, patient_id, professional_id,
          kind, amount_cents, status, description, occurred_date, created_by)
       VALUES ($1, $2, $3, $4, $5,
               'receita', 25000, 'pendente', 'Consulta particular',
               '2026-08-04', $6)`,
      [s.tenantId, s.entryId, s.clinicId, s.patientId, s.professionalId, s.userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

- [ ] Criar `packages/payments/src/create-payment-link.ts`:

```ts
// packages/payments/src/create-payment-link.ts
import type { TxClient } from '@cadencia/db';
import { uuidv7, type Result, ok, err, DomainError } from '@cadencia/kernel';
import type { PaymentProvider, ProviderCtx, Rfc3339 } from '@cadencia/integrations';

export interface CreatePaymentLinkInput {
  readonly entryId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly expiresAt?: Rfc3339;
  readonly providerId: string;
}

export interface PaymentLinkCreated {
  readonly paymentLinkId: string;
  readonly url: string;
  readonly providerLinkId: string;
  readonly expiresAt: Rfc3339;
}

export async function createPaymentLink(
  tx: TxClient,
  provider: PaymentProvider,
  providerCtx: ProviderCtx,
  input: CreatePaymentLinkInput,
): Promise<Result<PaymentLinkCreated, DomainError>> {
  // Verificar que o entry existe e esta pendente
  const { rows: entryRows } = await tx.query<{ status: string; amount_cents: string }>(
    `SELECT status, amount_cents::text FROM fin.entry WHERE id = $1`,
    [input.entryId],
  );
  if (entryRows.length === 0) {
    return err(new DomainError('payment_link.entry_nao_encontrado',
      'lancamento financeiro nao encontrado'));
  }

  // Verificar se ja existe link pendente para este entry
  const { rows: existingRows } = await tx.query<{ id: string; url: string; provider_link_id: string }>(
    `SELECT id, url, provider_link_id FROM fin.payment_link
      WHERE entry_id = $1 AND status = 'pending'`,
    [input.entryId],
  );

  const idempotencyKey = `payment-link:${input.entryId}`;

  if (existingRows.length > 0) {
    const existing = existingRows[0]!;
    return ok({
      paymentLinkId: existing.id,
      url: existing.url,
      providerLinkId: existing.provider_link_id,
      expiresAt: providerCtx.idempotencyKey as Rfc3339,
    });
  }

  // Chamar o provedor
  const result = await provider.createPaymentLink(providerCtx, {
    amountCents: input.amountCents,
    description: input.description,
    expiresAt: input.expiresAt,
    idempotencyKey,
  });

  if (!result.ok) {
    return err(new DomainError('payment_link.provedor_falhou',
      `provedor de pagamento falhou: ${result.error.detail}`,
      { kind: result.error.kind }));
  }

  const paymentLinkId = uuidv7();
  await tx.query(
    `INSERT INTO fin.payment_link
       (tenant_id, id, entry_id, provider_link_id, url, status,
        amount_cents, provider_id, idempotency_key, created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'pending', $5, $6, $7, app.current_user_id())`,
    [paymentLinkId, input.entryId, result.value.linkId, result.value.url,
     input.amountCents, input.providerId, idempotencyKey],
  );

  return ok({
    paymentLinkId,
    url: result.value.url,
    providerLinkId: result.value.linkId,
    expiresAt: result.value.expiresAt,
  });
}
```

- [ ] Criar `packages/payments/src/process-webhook.ts`:

```ts
// packages/payments/src/process-webhook.ts
import type { TxClient } from '@cadencia/db';
import { DomainError, ok, err, type Result } from '@cadencia/kernel';
import type { PaymentProvider, PaymentSnapshot, ProviderCtx } from '@cadencia/integrations';

export interface WebhookPayload {
  readonly providerPaymentId: string;
  readonly status: string;
  readonly paidAt?: string;
  readonly feeCents?: number;
  readonly method?: string;
}

export interface WebhookProcessed {
  readonly paymentLinkId: string;
  readonly entryId: string;
  readonly newStatus: string;
}

export async function processPaymentWebhook(
  tx: TxClient,
  payload: WebhookPayload,
): Promise<Result<WebhookProcessed, DomainError>> {
  // Buscar o payment_link pelo provider_link_id
  const { rows } = await tx.query<{
    id: string; entry_id: string; status: string;
  }>(
    `SELECT id, entry_id, status FROM fin.payment_link
      WHERE provider_link_id = $1`,
    [payload.providerPaymentId],
  );

  if (rows.length === 0) {
    return err(new DomainError('webhook.link_nao_encontrado',
      `link de pagamento nao encontrado para provider_link_id: ${payload.providerPaymentId}`));
  }

  const link = rows[0]!;

  // Idempotencia: se ja esta pago, retorna sem erro
  if (link.status === 'paid' && payload.status === 'paid') {
    return ok({
      paymentLinkId: link.id,
      entryId: link.entry_id,
      newStatus: 'paid',
    });
  }

  // Atualizar o status do payment_link
  await tx.query(
    `UPDATE fin.payment_link
        SET status = $1,
            paid_at = CASE WHEN $1 = 'paid' THEN $2::timestamptz ELSE paid_at END,
            fee_cents = CASE WHEN $3::bigint IS NOT NULL THEN $3::bigint ELSE fee_cents END,
            method = CASE WHEN $4 IS NOT NULL THEN $4 ELSE method END,
            webhook_raw = $5::jsonb,
            updated_at = clock_timestamp()
      WHERE id = $6`,
    [
      payload.status,
      payload.paidAt ?? null,
      payload.feeCents ?? null,
      payload.method ?? null,
      JSON.stringify(payload),
      link.id,
    ],
  );

  // Se o pagamento foi confirmado, marcar paid_at no fin.entry
  if (payload.status === 'paid') {
    await tx.query(
      `UPDATE fin.entry
          SET paid_at = COALESCE(paid_at, $1::timestamptz),
              status = 'pago',
              external_ref = $2,
              updated_at = clock_timestamp()
        WHERE id = $3 AND paid_at IS NULL`,
      [payload.paidAt ?? new Date().toISOString(), payload.providerPaymentId, link.entry_id],
    );
  }

  return ok({
    paymentLinkId: link.id,
    entryId: link.entry_id,
    newStatus: payload.status,
  });
}
```

- [ ] Criar `packages/payments/src/reconcile.ts`:

```ts
// packages/payments/src/reconcile.ts
import type { TxClient } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { PaymentProvider, ProviderCtx, Settlement } from '@cadencia/integrations';

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
      // Pagamento existe no PSP mas nao no sistema
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

  // Verificar entries pagos que nao apareceram na liquidacao do PSP
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
```

- [ ] Criar `packages/payments/src/rollup.ts`:

```ts
// packages/payments/src/rollup.ts
import type { TxClient } from '@cadencia/db';

export interface RollupResult {
  readonly divergent: boolean;
  readonly oldTotal: number;
  readonly newTotal: number;
}

export async function refreshDailyRollup(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  day: string,
): Promise<RollupResult> {
  const { rows } = await tx.query<{
    divergent: boolean;
    old_total: string;
    new_total: string;
  }>(
    `SELECT divergent, old_total::text, new_total::text
       FROM fin.refresh_daily_rollup($1, $2, $3::date)`,
    [tenantId, clinicId, day],
  );
  const row = rows[0];
  if (row === undefined) {
    return { divergent: false, oldTotal: 0, newTotal: 0 };
  }
  return {
    divergent: row.divergent,
    oldTotal: Number(row.old_total),
    newTotal: Number(row.new_total),
  };
}
```

- [ ] Atualizar `packages/payments/src/index.ts`:

```ts
// packages/payments/src/index.ts
export { createPaymentLink, type CreatePaymentLinkInput, type PaymentLinkCreated } from './create-payment-link';
export { processPaymentWebhook, type WebhookPayload, type WebhookProcessed } from './process-webhook';
export { reconcileSettlements, type ReconcileInput, type ReconcileResult } from './reconcile';
export { refreshDailyRollup, type RollupResult } from './rollup';
```

- [ ] Rodar `npx tsc --noEmit -p packages/payments/tsconfig.json` (ou equivalente) — compila sem erro.

Commit: `feat(payments): domain functions for payment link, webhook, reconciliation and rollup`

---