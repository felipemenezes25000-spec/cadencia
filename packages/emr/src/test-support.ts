// Semeia tenant, clinica, usuario, vinculo, profissional, paciente e dois
// atendimentos (um em rascunho, um finalizado) para os testes de integracao do
// emr. Roda com a conexao ADMINISTRATIVA porque cria o tenant — que e a raiz do
// isolamento e nao existe transacao de negocio capaz de cria-lo: `app_rw` so tem
// SELECT em app.tenant (0007) e o papel `jobs` nunca recebeu GRANT em
// app.professional, clin.patient nem clin.encounter.
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface Semente {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string;
  encounterId: string; finalizedEncounterId: string;
  sectionId: string; fieldQueixaId: string; fieldPaId: string; fieldCidId: string;
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

export async function semearAtendimento(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    encounterId: uuidv7(), finalizedEncounterId: uuidv7(),
    sectionId: uuidv7(), fieldQueixaId: uuidv7(), fieldPaId: uuidv7(), fieldCidId: uuidv7(),
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
       VALUES ($1, $2, 'Clinica de Teste', '12ABC34501DE35')`,
      [s.tenantId, `t-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade Centro', '12ABC34501DE35', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dra. Teste')`, [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Maria Souza Lima', 'completo', '1988-03-14')`,
      [s.tenantId, s.patientId]);

    // Definicao minima de prontuario: um texto, um composto e uma busca de tabela.
    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`, [s.tenantId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field
         (tenant_id, id, section_id, code, label, kind, is_reportable, ordinal)
       VALUES ($1, $2, $3, 'pa', 'Pressao arterial', 'composto', true, 2)`,
      [s.tenantId, s.fieldPaId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field_component
         (tenant_id, id, field_id, ordinal, observation_code, label, unit)
       VALUES ($1, gen_random_uuid(), $2, 1, 'PA_SIS', 'Sistolica', 'mmHg'),
              ($1, gen_random_uuid(), $2, 2, 'PA_DIA', 'Diastolica', 'mmHg')`,
      [s.tenantId, s.fieldPaId]);
    await c.query(
      `INSERT INTO clin.record_field
         (tenant_id, id, section_id, code, label, kind, ref_source, ordinal)
       VALUES ($1, $2, $3, 'cid', 'CID-10', 'busca_tabela', 'CID10', 3)`,
      [s.tenantId, s.fieldCidId, s.sectionId]);

    for (const [id, status] of
         [[s.encounterId, 'rascunho'], [s.finalizedEncounterId, 'finalizado']] as const) {
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
                 app.local_date(clock_timestamp(), 'America/Sao_Paulo'), $6::clin.encounter_status)`,
        [s.tenantId, id, s.patientId, s.professionalId, s.clinicId, status]);
    }
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
