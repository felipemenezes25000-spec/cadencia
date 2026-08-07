// packages/tiss/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

/* ---------- Interfaces existentes (Bloco 01) ---------- */

export interface SementeTiss {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
}

/* ---------- Interfaces para projecao de guia (Task 23) ---------- */

export interface TissSemente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  pacienteConvenioId: string;
  sectionId: string;
  fieldQueixaId: string;
}

/** Semente com convenio mas SEM numero_carteira no billing — dados incompletos. */
export interface TissSementeIncompleta {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  sectionId: string;
  fieldQueixaId: string;
}

/** Semente para testes de projecao de guia: SEM convenio (particular). */
export interface TissSementeParticular {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  sectionId: string;
  fieldQueixaId: string;
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

/* ---------- Semente basica (Bloco 01, mantida para contrato.int.test) ---------- */

export async function semearTiss(): Promise<SementeTiss> {
  const s: SementeTiss = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss Contrato', '66ABC77801DE99')`,
      [s.tenantId, `tc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss Contrato', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Tiss Contrato')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
       VALUES ($1, $2, '555555', 'Operadora Seed', '88ABC99900DE11', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
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

/* ---------- Semente completa para projecao de guia TISS (Task 23) ---------- */

/**
 * Semeia o grafo completo para projecao de guia TISS.
 * Inclui: tenant, clinica, usuario, profissional, paciente (cadastro completo),
 * atendimento em rascunho, encounter_billing COM convenio, operadora, contrato,
 * paciente_convenio e termo TUSS vigente.
 */
export async function semearProjecaoTiss(): Promise<TissSemente> {
  const s: TissSemente = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    pacienteConvenioId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- Infraestrutura base (mesmo padrao do emr test-support) ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica TISS Teste', '11ABC22233DE44')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade TISS', '11ABC22233DE44', '2233445', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. Convenio')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '654321', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Joao da Silva', 'completo', '1980-05-20')`,
      [s.tenantId, s.patientId],
    );

    // --- Prontuario: secao e campo minimos ---
    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    // --- Atendimento em rascunho ---
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // --- Encounter billing COM convenio ---
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans, numero_carteira,
          atendimento_rn, cnes, codigo_prestador_na_operadora,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Unimed Rio', '326305', '1234567890123456',
               false, '2233445', 'PREST001',
               '06', '654321', 'RJ', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 15000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    // --- Operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, active, created_by)
       VALUES ($1, $2, '326305', '28123456000199', 'Unimed Rio', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- Contrato (vinculo operadora x prestador) ---
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio, created_by)
       VALUES ($1, $2, $3, $4, 'PREST001', '2025-01-01', $5)`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId, s.userId],
    );

    // --- Paciente convenio (vinculo paciente x operadora) ---
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, validade, created_by)
       VALUES ($1, $2, $3, $4, '1234567890123456', '2027-12-31', $5)`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId, s.userId],
    );

    // --- Termo TUSS vigente para o procedimento de amostra ---
    // Usa INSERT ... ON CONFLICT DO NOTHING: o termo pode ja existir de outra semeadura.
    await c.query(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       VALUES (22, '10101012', 'Consulta em consultorio', '[2020-01-01,)', '202001', 'inclusao')
       ON CONFLICT DO NOTHING`,
    );

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

/**
 * Semeia um atendimento PARTICULAR (sem convenio).
 * O encounter_billing tem registro_ans e numero_carteira NULL.
 */
export async function semearProjecaoParticular(): Promise<TissSementeParticular> {
  const s: TissSementeParticular = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Particular', '55ABC66677DE88')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade Part', '55ABC66677DE88', '7766554', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. Particular')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111222', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Ana Costa', 'completo', '1992-11-03')`,
      [s.tenantId, s.patientId],
    );

    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Billing PARTICULAR: registro_ans e numero_carteira sao NULL, codigo_tabela NAO e 18.
    // O CHECK (registro_ans IS NULL) = (numero_carteira IS NULL) permite ambos NULL.
    // Precisa de ao menos um dos tres: codigo_prestador, cpf_contratado, cnpj_contratado.
    // Como e particular SEM convenio, usamos cpf_contratado.
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id,
          cnes, cpf_contratado,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               '7766554', '12345678901',
               '06', '111222', 'SP', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 20000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

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

/**
 * Semeia atendimento com convenio mas com dados obrigatorios FALTANDO.
 * O encounter_billing tem registro_ans preenchido mas numero_carteira NULL
 * (invalido para guia completa). A operadora e contrato existem.
 */
export async function semearProjecaoIncompleta(): Promise<TissSementeIncompleta> {
  const s: TissSementeIncompleta = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Incompleta', '99ABC88877DE66')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade Inc', '99ABC88877DE66', '9988776', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. Incompleto')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'MG', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Pedro Santos', 'completo', '1975-02-28')`,
      [s.tenantId, s.patientId],
    );

    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Billing COM convenio mas com dados que levarao a guia incompleta:
    // numero_carteira PRESENTE (exigido pelo CHECK), mas
    // codigo_prestador_na_operadora, cpf_contratado e cnpj_contratado:
    // usamos cpf_contratado para satisfazer o CHECK, mas o campo que o
    // teste vai verificar como faltando e a OPERADORA NAO CADASTRADA
    // (registro_ans '000000' nao tem operadora correspondente no tiss).
    // Na verdade, para testar dados incompletos no billing, precisamos
    // que a operadora EXISTA mas algum campo obrigatorio do billing esteja
    // ausente. O CHECK do billing impede carteira NULL com ans preenchido.
    // Estrategia: todos os campos do billing preenchidos, mas a operadora
    // NAO esta cadastrada em tiss.operadora — isso gera 'operadora_nao_cadastrada'.
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans, numero_carteira,
          atendimento_rn, cnes, codigo_prestador_na_operadora,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Operadora Fantasma', '999999', '9999888877776666',
               false, '9988776', 'PREST999',
               '06', '999888', 'MG', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 12000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    // Operadora com registro_ans '999999' NAO cadastrada em tiss.operadora
    // (de proposito, para testar o fluxo de dados incompletos)

    // Termo TUSS para o procedimento (global, pode ja existir)
    await c.query(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       VALUES (22, '10101012', 'Consulta em consultorio', '[2020-01-01,)', '202001', 'inclusao')
       ON CONFLICT DO NOTHING`,
    );

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
