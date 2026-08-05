### Task 28: domain logic — recordPayment, cancelPayment, refundPayment

**Arquivos**

- Criar `packages/payments/src/record-payment.ts`
- Criar `packages/payments/src/record-payment.int.test.ts`
- Criar `packages/payments/src/test-support.ts`
- Modificar `packages/payments/src/index.ts`

**Passos**

- [ ] Criar o suporte de teste em `packages/payments/src/test-support.ts`:

```ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementePagamento {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  appointmentId: string;
  categoryId: string;
  paymentMethodDinheiroId: string;
  paymentMethodPixId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearPagamento(): Promise<SementePagamento> {
  const s: SementePagamento = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), appointmentId: uuidv7(),
    categoryId: uuidv7(),
    paymentMethodDinheiroId: uuidv7(), paymentMethodPixId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Pagamento', '12ABC34501DE35')`,
      [s.tenantId, `p-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Pag')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Pagamento', 'completo')`,
      [s.tenantId, s.patientId]);

    // Procedimento e agendamento para vincular ao pagamento
    const procedureId = uuidv7();
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, procedureId]);
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-10-15T14:00:00Z', '2026-10-15T14:30:00Z', '2026-10-15',
               'atendendo', $7)`,
      [s.appointmentId, s.tenantId, s.patientId, s.professionalId,
       s.clinicId, procedureId, s.userId]);

    // Categoria e metodos de pagamento
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta', 'receita')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro'),
              ($1, $3, 'pix', 'Pix')`,
      [s.tenantId, s.paymentMethodDinheiroId, s.paymentMethodPixId]);

    // Provisiona o contador de recibo
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);

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

- [ ] Criar a logica de dominio em `packages/payments/src/record-payment.ts`:

```ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type PaymentFailure =
  | { kind: 'lancamento_nao_encontrado' }
  | { kind: 'metodo_nao_encontrado' }
  | { kind: 'ja_pago' }
  | { kind: 'ja_cancelado' }
  | { kind: 'ja_estornado' }
  | { kind: 'nao_pode_estornar'; status: string }
  | { kind: 'nao_pode_cancelar'; status: string };

export interface RecordPaymentInput {
  readonly patientId?: string;
  readonly appointmentId?: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly categoryId?: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paymentMethodId: string;
  readonly paidNow: boolean;
  readonly dueDate?: string;
  readonly externalRef?: string;
  readonly idempotencyKey: string;
}

export interface RecordedPayment {
  readonly entryId: string;
  readonly receiptId: string | null;
  readonly receiptNumber: number | null;
  readonly status: string;
}

/**
 * Registra pagamento no atendimento. Se paidNow=true, marca como pago e gera
 * recibo automaticamente. O recibo usa numero sequencial por tenant via
 * fin.receipt_counter. A geracao de PDF do recibo e injetada em L3 (via
 * callback), NAO importa documents diretamente — mesmo padrao de exportRecord.
 */
export async function recordPayment(
  tx: TxClient,
  i: RecordPaymentInput,
  generateReceiptPdf?: (entryId: string, receiptNumber: number) => Promise<string | null>,
): Promise<Result<RecordedPayment, PaymentFailure>> {
  // Valida que o metodo de pagamento existe
  const { rows: methodRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method WHERE id = $1`, [i.paymentMethodId]);
  if (methodRows.length === 0) return err({ kind: 'metodo_nao_encontrado' });

  const entryId = uuidv7();
  const status = i.paidNow ? 'pago' : 'pendente';

  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, patient_id, appointment_id,
        professional_id, clinic_id, description, amount_cents,
        payment_method_id, paid_at, due_date, status, external_ref,
        idempotency_key, created_by)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
             $5, $6, $7, $8, $9,
             CASE WHEN $10::boolean THEN clock_timestamp() ELSE NULL END,
             $11::date, $12::fin.entry_status, $13, $14, app.current_user_id())`,
    [entryId, i.categoryId ?? null, i.patientId ?? null, i.appointmentId ?? null,
     i.professionalId, i.clinicId, i.description, i.amountCents,
     i.paymentMethodId, i.paidNow, i.dueDate ?? null, status,
     i.externalRef ?? null, i.idempotencyKey]);

  await tx.query(
    `SELECT audit.log('PAYMENT_RECORD', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'payment_method', $3::text,
                                         'status', $4::text), $5)`,
    [entryId, i.amountCents, 'receita', status, i.clinicId]);

  let receiptId: string | null = null;
  let receiptNumber: number | null = null;

  if (i.paidNow) {
    // Auto-provisiona e consome o proximo numero de recibo
    const { rows: counterRows } = await tx.query<{ consumed: string }>(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value)
       VALUES (app.require_tenant_id(), 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = fin.receipt_counter.next_value + 1
       RETURNING next_value - 1 AS consumed`);
    receiptNumber = Number(counterRows[0]?.consumed);

    receiptId = uuidv7();
    let pdfStorageKey: string | null = null;
    if (generateReceiptPdf) {
      pdfStorageKey = await generateReceiptPdf(entryId, receiptNumber);
    }

    await tx.query(
      `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number, pdf_storage_key)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
      [receiptId, entryId, receiptNumber, pdfStorageKey]);

    await tx.query(
      `SELECT audit.log('RECEIPT_ISSUE', 'fin', 'receipt', $1, 'sucesso',
                        jsonb_build_object('receipt_number', $2::bigint,
                                           'amount_cents', $3::bigint), $4)`,
      [receiptId, receiptNumber, i.amountCents, i.clinicId]);
  }

  return ok({ entryId, receiptId, receiptNumber, status });
}

export interface CancelPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function cancelPayment(
  tx: TxClient,
  i: CancelPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status !== 'pendente') {
    return err({ kind: 'nao_pode_cancelar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'cancelado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_CANCEL', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'cancelado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'cancelado' });
}

export interface RefundPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function refundPayment(
  tx: TxClient,
  i: RefundPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status !== 'pago') {
    return err({ kind: 'nao_pode_estornar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'estornado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'estornado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'estornado' });
}
```

- [ ] Atualizar o barrel `packages/payments/src/index.ts`:

```ts
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
```

- [ ] Criar o teste de integracao em `packages/payments/src/record-payment.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment, cancelPayment, refundPayment } from './record-payment';
import { semearPagamento, type SementePagamento } from './test-support';

let s: SementePagamento;
let actor: Actor;

beforeAll(async () => {
  s = await semearPagamento();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('recordPayment — registra pagamento no atendimento', () => {
  it('registra pagamento em dinheiro com recibo automatico', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        categoryId: s.categoryId,
        description: 'Consulta particular',
        amountCents: 25000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `rec-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pago');
    expect(r.value.receiptId).not.toBeNull();
    expect(r.value.receiptNumber).toBe(1);
  });

  it('registra pagamento pendente sem recibo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Retorno',
        amountCents: 15000,
        paymentMethodId: s.paymentMethodPixId,
        paidNow: false,
        dueDate: '2026-11-01',
        idempotencyKey: `pend-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pendente');
    expect(r.value.receiptId).toBeNull();
    expect(r.value.receiptNumber).toBeNull();
  });

  it('recibo sequencial incrementa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Procedimento',
        amountCents: 50000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `seq-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.receiptNumber).toBe(2);
  });

  it('rejeita metodo de pagamento inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Teste',
        amountCents: 10000,
        paymentMethodId: uuidv7(),
        paidNow: false,
        idempotencyKey: `bad-method-${uuidv7()}`,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('metodo_nao_encontrado');
  });

  it('grava evento de auditoria PAYMENT_RECORD', async () => {
    const key = `audit-${uuidv7()}`;
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Auditoria',
        amountCents: 5000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: key,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'PAYMENT_RECORD' AND entity_id = $1`,
        [r.value.entryId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('cancelPayment — cancela lancamento pendente', () => {
  let pendingEntryId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Para cancelar',
        amountCents: 8000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: false,
        idempotencyKey: `cancel-${uuidv7()}`,
      }));
    if (r.ok) pendingEntryId = r.value.entryId;
  });

  it('cancela lancamento pendente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: pendingEntryId, reason: 'paciente desistiu' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('cancelado');
  });

  it('recusa cancelar lancamento ja cancelado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: pendingEntryId, reason: 'tentativa dupla' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_cancelado');
  });

  it('recusa cancelar lancamento pago — deve estornar', async () => {
    const paid = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Pago para cancelar',
        amountCents: 12000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `paid-cancel-${uuidv7()}`,
      }));
    if (!paid.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: paid.value.entryId, reason: 'teste' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nao_pode_cancelar');
  });
});

describe('refundPayment — estorna lancamento pago', () => {
  let paidEntryId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Para estornar',
        amountCents: 20000,
        paymentMethodId: s.paymentMethodPixId,
        paidNow: true,
        idempotencyKey: `refund-${uuidv7()}`,
      }));
    if (r.ok) paidEntryId = r.value.entryId;
  });

  it('estorna lancamento pago', async () => {
    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paidEntryId, reason: 'cobranca indevida' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('estornado');
  });

  it('recusa estornar lancamento ja estornado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paidEntryId, reason: 'tentativa dupla' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_estornado');
  });

  it('recusa estornar lancamento pendente', async () => {
    const pendR = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Pendente para estornar',
        amountCents: 7000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: false,
        idempotencyKey: `refund-pend-${uuidv7()}`,
      }));
    if (!pendR.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: pendR.value.entryId, reason: 'teste' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nao_pode_estornar');
  });

  it('grava evento de auditoria PAYMENT_REFUND', async () => {
    const paid = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Estorno auditoria',
        amountCents: 3000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `refund-audit-${uuidv7()}`,
      }));
    if (!paid.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paid.value.entryId, reason: 'auditoria' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'PAYMENT_REFUND' AND entity_id = $1`,
        [paid.value.entryId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar os testes de integracao:

```bash
pnpm vitest run packages/payments/src/record-payment.int.test.ts
```

Saida esperada: 12 testes passando.

---