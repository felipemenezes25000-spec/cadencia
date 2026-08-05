// apps/api/src/test-support-messaging.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { createSession, newCsrfToken, type Role } from '@cadencia/authn';

export interface SementeSessaoMsg {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientId: string;
  conversationId: string;
  channelIdentityId: string;
  templateId: string;
  token: string;
  csrf: string;
}

export function auth(s: SementeSessaoMsg) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

export async function semearSessaoMensageria(
  opts: { role?: Role } = {},
): Promise<SementeSessaoMsg> {
  const role = opts.role ?? 'admin_clinico';
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const userId = uuidv7();
  const professionalId = uuidv7();
  const patientId = uuidv7();
  const conversationId = uuidv7();
  const messageId = uuidv7();
  const channelIdentityId = uuidv7();
  const templateId = uuidv7();
  const csrf = newCsrfToken();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Msg', '44444444000194')`,
      [tenantId, `msg-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Msg', '2077505', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Msg')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, $4)`,
      [tenantId, userId, clinicId, role]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [tenantId, professionalId, userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Msg', 'completo', '1990-05-10')`,
      [tenantId, patientId]);

    // Canal de mensageria
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Teste', '+5511999999999', 'verified')`,
      [tenantId, channelIdentityId]);

    // Template para testes de automacao
    await c.query(
      `INSERT INTO msg.template
         (tenant_id, id, channel_identity_id, channel, name, category,
          body_template, variables, status)
       VALUES ($1, $2, $3, 'whatsapp', 'confirmacao_padrao', 'utility',
               'Ola {{nome}}, sua consulta esta marcada.', '["nome"]'::jsonb, 'approved')`,
      [tenantId, templateId, channelIdentityId]);

    // Conversa
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, patient_id,
          remote_phone, status, last_message_at)
       VALUES ($1, $2, $3, $4, '+5511988887777',
               'active', clock_timestamp())`,
      [tenantId, conversationId, channelIdentityId, patientId]);

    // Mensagem na conversa
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, channel, body_text, status)
       VALUES ($1, $2, $3, 'inbound', 'whatsapp',
               'Boa tarde, gostaria de confirmar minha consulta', 'delivered')`,
      [tenantId, messageId, conversationId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  const { token } = await createSession(admin, {
    userId, activeTenantId: tenantId, activeClinicId: clinicId,
  });

  await admin.query(
    `UPDATE id.session SET mfa_at = clock_timestamp()
      WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

  await admin.end();

  return { tenantId, clinicId, userId, patientId, conversationId,
           channelIdentityId, templateId, token, csrf };
}
