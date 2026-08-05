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
