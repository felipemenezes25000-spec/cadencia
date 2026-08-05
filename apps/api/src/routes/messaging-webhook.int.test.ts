// apps/api/src/routes/messaging-webhook.int.test.ts
import { createHmac } from 'node:crypto';
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

/** Assina o payload com o segredo padrao do FakeMessagingProvider. */
function sign(payload: string): string {
  return 'sha256=' + createHmac('sha256', 'fake-whatsapp-secret')
    .update(payload).digest('hex');
}

let tenantId: string;
let channelIdentityId: string;
/** Telefone unico do negocio para este run — evita colisao entre runs. */
let businessPhone: string;

/** Monta payload no formato WhatsApp Cloud API com metadata. */
function whatsappPayload(
  from: string, body: string, messageId: string,
): string {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: businessPhone },
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
  tenantId = uuidv7();
  channelIdentityId = uuidv7();
  const clinicId = uuidv7();

  // Gerar telefone unico por run para evitar colisao com runs anteriores
  const suffix = tenantId.replace(/-/g, '').replace(/[^0-9]/g, '').slice(0, 9).padEnd(9, '0');
  businessPhone = `+5511${suffix}`;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Wh Test', '55555555000195')`,
      [tenantId, `wh-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Wh', '2077506', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Wh', $3, 'verified')`,
      [tenantId, channelIdentityId, businessPhone]);
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

describe('webhook de mensageria', () => {
  it('POST /v1/messaging/webhook/whatsapp grava inbound_event e mensagem', async () => {
    const app = await buildApp();
    const payload = whatsappPayload(
      '+5511977776666', 'Quero confirmar minha consulta', 'wamid.abc123');

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
    expect(r.json()).toEqual({ accepted: true });

    // Verificar que o inbound_event foi gravado
    const { rows: events } = await jobsPool().query<{ id: string }>(
      `SELECT id FROM msg.inbound_event WHERE channel_identity_id = $1`,
      [channelIdentityId]);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verificar que a conversa foi criada
    const { rows: convs } = await jobsPool().query<{ id: string; remote_phone: string }>(
      `SELECT id, remote_phone FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_phone = '+5511977776666'`,
      [channelIdentityId]);
    expect(convs.length).toBe(1);

    await app.close();
  });

  it('webhook nao aceita tenant_id como parametro — resolve pelo channel_identity', async () => {
    const app = await buildApp();
    const payload = whatsappPayload(
      '+5511966665555', 'Tentativa com tenant_id injetado', 'wamid.inject1');
    // Injetar tenant_id no payload — deve ser ignorado
    const payloadObj = JSON.parse(payload);
    payloadObj.tenant_id = '00000000-0000-0000-0000-000000000000';
    const modifiedPayload = JSON.stringify(payloadObj);

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(modifiedPayload),
      },
      payload: modifiedPayload,
    });

    expect(r.statusCode).toBe(200);

    // A conversa deve ter sido criada com o tenant correto, nao o injetado
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_phone = '+5511966665555'`,
      [channelIdentityId]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantId);
    expect(rows[0]!.tenant_id).not.toBe('00000000-0000-0000-0000-000000000000');

    await app.close();
  });

  it('webhook com assinatura invalida devolve 401', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({ entry: [] });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=INVALIDA',
      },
      payload,
    });

    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ erro: 'assinatura_invalida' });
    await app.close();
  });

  it('GET /v1/messaging/webhook/whatsapp responde o desafio do Meta', async () => {
    const app = await buildApp();
    process.env['WHATSAPP_VERIFY_TOKEN'] = 'meu-token-secreto';

    const r = await app.inject({
      method: 'GET',
      url: '/v1/messaging/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=meu-token-secreto&hub.challenge=desafio123',
    });

    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('desafio123');

    delete process.env['WHATSAPP_VERIFY_TOKEN'];
    await app.close();
  });
});
