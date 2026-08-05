// apps/worker/src/jobs/send-message.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakeMessagingProvider } from '@cadencia/integrations';
import { Pool } from 'pg';
import { sendMessage } from './send-message';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let messageId: string;
let conversationId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();
  const channelIdentityId = uuidv7();
  conversationId = uuidv7();
  messageId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Send Test', '88888888000198')`,
      [tenantId, `snd-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Snd', '2077509', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    // Coluna real: channel (nao channel_kind), phone (nao phone_number)
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Snd', '+5511999777666', 'verified')`,
      [tenantId, channelIdentityId]);
    // Coluna real: remote_phone (nao remote_address), sem unread_count
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id,
          remote_phone, status, last_message_at)
       VALUES ($1, $2, $3, '+5511988776655', 'active',
               clock_timestamp())`,
      [tenantId, conversationId, channelIdentityId]);
    // Coluna real: body_text (nao body), channel obrigatorio, sem provider_message_id
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, channel, body_text, status)
       VALUES ($1, $2, $3, 'outbound', 'whatsapp', 'Sua consulta esta confirmada', 'queued')`,
      [tenantId, messageId, conversationId]);
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

describe('envio de mensagem via worker', () => {
  it('envia a mensagem e atualiza o status para sent', async () => {
    const messaging = createFakeMessagingProvider();
    const r = await sendMessage({
      tenantId, messageId, conversationId,
    }, messaging);

    expect(r.status).toBe('sent');
    expect(r.providerMessageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status::text FROM msg.message WHERE id = $1`, [messageId]);
    expect(rows[0]?.status).toBe('sent');
  });
});
