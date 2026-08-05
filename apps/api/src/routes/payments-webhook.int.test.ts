// apps/api/src/routes/payments-webhook.int.test.ts
//
// ADAPTACAO: o plano original referenciava `fin.payment` e colunas
// fantasma. O repositorio real usa `fin.entry` (0077) e `fin.payment_link`
// com entry_id (0079). Veja 00-CONTRATOS.md secoes A3 e A7.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;
let patientId: string;
let entryId: string;
let paymentLinkId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  patientId = uuidv7();
  entryId = uuidv7();
  paymentLinkId = uuidv7();
  const userId = uuidv7();
  const paymentMethodId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Pay Wh', '66666666000196')`,
      [tenantId, `pwh-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade PayWh', '2077507', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User PayWh')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente PayWh', 'completo', '1988-03-15')`,
      [tenantId, patientId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'link', 'Link de Pagamento')`,
      [tenantId, paymentMethodId]);
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, patient_id, clinic_id, professional_id,
          amount_cents, payment_method_id, status, description, idempotency_key)
       VALUES ($1, $2, 'receita', $3, $4, $5, 20000, $6, 'pendente',
               'Consulta via link', $7)`,
      [tenantId, entryId, patientId, clinicId, userId,
       paymentMethodId, `link:${entryId}`]);
    await c.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, entry_id, provider_link_id, url, status,
          amount_cents, provider_id, idempotency_key, created_by)
       VALUES ($1, $2, $3, 'fake-link-1', 'https://psp.fake/pay/1',
               'pending', 20000, 'fake-psp', $4, $5)`,
      [tenantId, paymentLinkId, entryId,
       `link-idem-${paymentLinkId}`, userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('webhook de pagamento', () => {
  it('POST /v1/payments/webhook processa pagamento confirmado via link', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({
      eventType: 'payment.confirmed',
      paymentLinkId,
      providerPaymentId: 'psp_pay_abc123',
      status: 'paid',
      amountCents: 20000,
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-psp-signature': 'valid-sig',
      },
      payload,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accepted: true });

    // Verificar que o webhook_event foi gravado
    const { rows: events } = await jobsPool().query<{ id: string }>(
      `SELECT id FROM fin.webhook_event
        WHERE event_type = 'payment.confirmed' AND tenant_id = $1
        ORDER BY received_at DESC LIMIT 1`, [tenantId]);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verificar que o lancamento foi marcado como pago com external_ref
    const { rows: entries } = await jobsPool().query<{
      external_ref: string; status: string;
    }>(
      `SELECT external_ref, status::text
         FROM fin.entry WHERE external_ref = 'psp_pay_abc123'
         AND tenant_id = $1`, [tenantId]);
    expect(entries.length).toBe(1);
    expect(entries[0]!.status).toBe('pago');

    // Verificar que o link foi marcado como pago
    const { rows: links } = await jobsPool().query<{ status: string }>(
      `SELECT status FROM fin.payment_link WHERE id = $1`, [paymentLinkId]);
    expect(links[0]!.status).toBe('paid');

    await app.close();
  });

  it('webhook nao aceita tenant_id como parametro — resolve pelo payment_link', async () => {
    const entryId2 = uuidv7();
    const linkId2 = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, patient_id, clinic_id, professional_id,
            amount_cents, payment_method_id, status, description, idempotency_key)
         VALUES ($1, $2, 'receita', $3, $4,
                 (SELECT id FROM id."user" LIMIT 1), 10000,
                 (SELECT id FROM fin.payment_method WHERE tenant_id = $1 LIMIT 1),
                 'pendente', 'Segundo link', $5)`,
        [tenantId, entryId2, patientId, clinicId, `link:${entryId2}`]);
      await c.query(
        `INSERT INTO fin.payment_link
           (tenant_id, id, entry_id, provider_link_id, url, status,
            amount_cents, provider_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, 'fake-link-2', 'https://psp.fake/pay/2',
                 'pending', 10000, 'fake-psp', $4,
                 (SELECT id FROM id."user" LIMIT 1))`,
        [tenantId, linkId2, entryId2, `link-idem-${linkId2}`]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    await admin.end();

    const app = await buildApp();
    const payload = JSON.stringify({
      tenant_id: '00000000-0000-0000-0000-000000000000',
      eventType: 'payment.confirmed',
      paymentLinkId: linkId2,
      providerPaymentId: 'psp_pay_inject2',
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-psp-signature': 'valid-sig' },
      payload,
    });

    expect(r.statusCode).toBe(200);

    // Lancamento atualizado com o tenant correto (via entry, nao o injetado)
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fin.entry WHERE external_ref = 'psp_pay_inject2'
       AND tenant_id = $1`, [tenantId]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantId);
    expect(rows[0]!.tenant_id).not.toBe('00000000-0000-0000-0000-000000000000');

    await app.close();
  });
});
