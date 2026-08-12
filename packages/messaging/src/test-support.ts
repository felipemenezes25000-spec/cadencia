// packages/messaging/src/test-support.ts
//
// Semeia tenant, clínica, usuário, vínculo, paciente com telefone, identidade de
// canal e template para os testes de integração da mensageria.
//
// Roda com a conexão ADMINISTRATIVA pelo mesmo motivo de
// packages/scheduling/src/test-support.ts: cria o tenant, que é a raiz do
// isolamento e não tem transação de negócio capaz de criá-lo — app_rw só tem
// SELECT em app.tenant (0007).
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeMensageria {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientId: string;
  patientPhone: string;
  channelIdentityId: string;
  templateId: string;
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

export async function semearMensageria(): Promise<SementeMensageria> {
  const s: SementeMensageria = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    patientId: uuidv7(),
    patientPhone: '+5511999990001',
    channelIdentityId: uuidv7(),
    templateId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Mensageria', '12ABC34501DE35')`,
      [s.tenantId, `m-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Msg', '7654321', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Atendente')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, phone_primary, cadastro_status)
       VALUES ($1, $2, 'Joana Teste', $3, 'completo')`,
      [s.tenantId, s.patientId, s.patientPhone]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, provider_ref, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica WhatsApp', '+5511988880001', 'waba-fake-001', 'active')`,
      [s.tenantId, s.channelIdentityId]);
    await c.query(
      `INSERT INTO msg.template
         (tenant_id, id, channel_identity_id, channel, name, language, category,
          status, body_template, variables)
       VALUES ($1, $2, $3, 'whatsapp', 'confirmacao_consulta', 'pt_BR', 'utility',
               'approved', 'Ola {{1}}, sua consulta esta confirmada para {{2}} as {{3}}.', '["nome","data","hora"]'::jsonb)`,
      [s.tenantId, s.templateId, s.channelIdentityId]);
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
