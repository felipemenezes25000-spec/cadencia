// Semeia tenant, clinica, usuario de recepcao, vinculo, profissional, paciente,
// um procedimento de 30 minutos e um bloqueio de almoco para os testes de
// integracao da agenda.
//
// Roda com a conexao ADMINISTRATIVA pelo mesmo motivo de
// packages/emr/src/test-support.ts: cria o tenant, que e a raiz do isolamento e
// nao tem transacao de negocio capaz de cria-lo — `app_rw` so tem SELECT em
// app.tenant (0007).
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeAgenda {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string; procedureId: string;
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

export async function semearAgenda(): Promise<SementeAgenda> {
  const s: SementeAgenda = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), procedureId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    // O slug leva o uuid INTEIRO, nunca um prefixo: os 8 primeiros digitos hex de
    // um uuidv7 sao `ms >> 16`, um balde de ~65 segundos, entao duas semeaduras
    // da mesma rodada cairiam no mesmo slug e a segunda quebraria em
    // tenant_slug_key (23505).
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Agenda', '12ABC34501DE35')`,
      [s.tenantId, `a-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`, [s.tenantId, s.clinicId]);
    await c.query(`INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`, [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Maria Souza Lima', 'completo')`, [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`, [s.tenantId, s.procedureId]);
    // Almoco das 15h as 16h UTC de 2026-10-06: o horario que o teste do aviso usa.
    await c.query(
      `INSERT INTO sched.block
         (tenant_id, id, professional_id, clinic_id, starts_at, ends_at, kind, motivo, created_by)
       VALUES ($1, gen_random_uuid(), $2, $3,
               '2026-10-06T15:00:00Z', '2026-10-06T16:00:00Z', 'almoco', 'Almoco', $4)`,
      [s.tenantId, s.professionalId, s.clinicId, s.userId]);
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
