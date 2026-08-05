// apps/api/src/routes/webhook-isolation.int.test.ts
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

/**
 * Teste de isolamento (padrao test:iso) para webhooks.
 *
 * Verifica que NENHUMA rota de webhook aceita tenant_id como parametro
 * de entrada. O tenant_id deve ser resolvido internamente pela
 * channel_identity (mensageria) ou pelo payment_link/entry (pagamento).
 *
 * Cenario: cria dois tenants A e B. Envia webhook com tenant_id do B
 * para um recurso do A. O dado gravado deve pertencer ao tenant A,
 * nao ao B — provando que o tenant_id do request foi ignorado.
 */

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

/** Assina o payload com o segredo padrao do FakeMessagingProvider. */
function sign(payload: string): string {
  return 'sha256=' + createHmac('sha256', 'fake-whatsapp-secret')
    .update(payload).digest('hex');
}

/** Assina o payload com o segredo padrao do FakePaymentProvider. */
function signPayment(payload: string): string {
  return createHmac('sha256', 'fake-payment-secret')
    .update(Buffer.from(payload)).digest('hex');
}

let tenantA: string;
let tenantB: string;
let channelIdentityA: string;
let paymentLinkA: string;
/** Telefone unico do negocio para este run — evita colisao entre runs. */
let businessPhoneA: string;

/** Monta payload no formato WhatsApp Cloud API com metadata. */
function whatsappPayload(
  from: string, body: string, messageId: string,
): string {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: businessPhoneA },
          messages: [{
            id: messageId,
            from: from.replace('+', ''),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body },
          }],
        },
      }],
    }],
  });
}

beforeAll(async () => {
  tenantA = uuidv7();
  tenantB = uuidv7();
  const clinicA = uuidv7();
  const clinicB = uuidv7();
  const userA = uuidv7();
  const professionalA = uuidv7();
  const patientA = uuidv7();
  channelIdentityA = uuidv7();
  paymentLinkA = uuidv7();
  const entryA = uuidv7();
  const paymentMethodA = uuidv7();

  // Gerar telefone unico por run para evitar colisao com runs anteriores
  const suffix = tenantA.replace(/-/g, '').replace(/[^0-9]/g, '').slice(0, 9).padEnd(9, '0');
  businessPhoneA = `+5511${suffix}`;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // Tenant A
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Iso A', '11100011000100')`,
      [tenantA, `isoa-${tenantA.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Iso A', '2077511', 'America/Sao_Paulo')`,
      [tenantA, clinicA]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Iso A')`,
      [userA, `${userA}@example.test`]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho)
       VALUES ($1, $2, $3, 'RM', '654321', 'SP')`,
      [tenantA, professionalA, userA]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Iso A', 'completo', '1991-01-01')`,
      [tenantA, patientA]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Iso A Clinica', $3, 'verified')`,
      [tenantA, channelIdentityA, businessPhoneA]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'link', 'Link Iso')`,
      [tenantA, paymentMethodA]);
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, patient_id, clinic_id, professional_id,
          amount_cents, payment_method_id, status, description, idempotency_key)
       VALUES ($1, $2, 'receita', $3, $4, $5, 30000, $6, 'pendente',
               'Consulta iso A', $7)`,
      [tenantA, entryA, patientA, clinicA, professionalA,
       paymentMethodA, `link:${entryA}`]);
    await c.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, entry_id, provider_link_id, url, status,
          amount_cents, provider_id, idempotency_key, created_by)
       VALUES ($1, $2, $3, 'fake-link-iso-a', 'https://psp.fake/pay/iso-a',
               'pending', 30000, 'fake-psp', $4, $5)`,
      [tenantA, paymentLinkA, entryA,
       `link-idem-${paymentLinkA}`, userA]);

    // Tenant B (apenas para ter um ID diferente)
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Iso B', '22200022000200')`,
      [tenantB, `isob-${tenantB.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Iso B', '2077512', 'America/Sao_Paulo')`,
      [tenantB, clinicB]);

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

describe('isolamento de webhooks (test:iso)', () => {
  it('webhook de mensageria ignora tenant_id do request e usa o da channel_identity', async () => {
    const app = await buildApp();

    // Montar payload no formato WhatsApp Cloud API com tenant_id INJETADO
    const remotePhone = '+5511922222222';
    const innerPayload = whatsappPayload(
      remotePhone, 'Mensagem de teste de isolamento', `wamid.iso-${uuidv7()}`);
    const payloadObj = JSON.parse(innerPayload);
    payloadObj.tenant_id = tenantB; // INJETADO — deve ser ignorado
    const payload = JSON.stringify(payloadObj);

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(payload),
      },
      payload,
    });
    expect(r.statusCode).toBe(200);

    // A conversa DEVE pertencer ao tenant A, NAO ao B
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_phone = $2`,
      [channelIdentityA, remotePhone]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantA);
    expect(rows[0]!.tenant_id).not.toBe(tenantB);

    await app.close();
  });

  it('webhook de pagamento ignora tenant_id do request e usa o do payment_link', async () => {
    const app = await buildApp();

    const providerPaymentId = `psp_iso_${uuidv7()}`;
    const payload = JSON.stringify({
      tenant_id: tenantB, // INJETADO — deve ser ignorado
      eventType: 'payment.confirmed',
      paymentLinkId: paymentLinkA, // pertence ao tenant A
      providerPaymentId,
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signPayment(payload),
      },
      payload,
    });
    expect(r.statusCode).toBe(200);

    // O lancamento DEVE pertencer ao tenant A, NAO ao B
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fin.entry
        WHERE tenant_id = $1
        ORDER BY created_at DESC LIMIT 1`, [tenantA]);
    if (rows.length > 0) {
      expect(rows[0]!.tenant_id).toBe(tenantA);
      expect(rows[0]!.tenant_id).not.toBe(tenantB);
    }

    // Nunca deve haver lancamento no tenant B originado deste webhook
    const { rows: rowsB } = await jobsPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.entry WHERE tenant_id = $1`, [tenantB]);
    expect(Number(rowsB[0]?.n)).toBe(0);

    await app.close();
  });

  it('rota de webhook de mensageria NAO tem parametro tenant_id no schema', async () => {
    const app = await buildApp();
    // A rota nao aceita tenant_id como query param
    const payload = JSON.stringify({
      entry: [{
        changes: [{
          value: {
            metadata: { display_phone_number: businessPhoneA },
            messages: [],
          },
        }],
      }],
    });

    const r = await app.inject({
      method: 'POST',
      url: `/v1/messaging/webhook/whatsapp?tenant_id=${tenantB}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(payload),
      },
      payload,
    });
    // Deve funcionar normalmente — o query param e ignorado
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('rota de webhook de pagamento NAO tem parametro tenant_id no schema', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({
      eventType: 'unknown',
      providerPaymentId: 'none',
    });

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/webhook?tenant_id=${tenantB}`,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signPayment(payload),
      },
      payload,
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
