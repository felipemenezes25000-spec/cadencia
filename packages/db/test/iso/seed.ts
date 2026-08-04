import type { Client } from 'pg';
import * as F from './fixtures';

/**
 * Dois tenants reais e conflitantes de proposito:
 * - Aurora (A): rede com unidade em Sao Paulo e em Manaus. Ana e admin_clinico em
 *   SP e apenas profissional em Manaus. Carla e recepcao (nao e profissional).
 * - Boreal (B): unidade em Rio Branco, com o MESMO CPF cadastrado que o tenant A.
 * Roda como superusuario, antes de qualquer teste, uma unica vez.
 */
export async function seedDoisTenants(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos) VALUES
       ($1, 'aurora', 'Clinica Aurora Ltda', $3, NULL),
       ($2, 'boreal', 'Clinica Boreal Ltda', $4, 25)`,
    [F.TENANT_A, F.TENANT_B, F.CNPJ_A, F.CNPJ_B],
  );

  await admin.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone) VALUES
       ($1, $3, 'Aurora Paulista',   '2077485', 'America/Sao_Paulo'),
       ($1, $4, 'Aurora Manaus',     '2077493', 'America/Manaus'),
       ($2, $5, 'Boreal Rio Branco', '2077507', 'America/Rio_Branco')`,
    [F.TENANT_A, F.TENANT_B, F.CLINIC_A_SP, F.CLINIC_A_MANAUS, F.CLINIC_B_RIO_BRANCO],
  );

  await admin.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'ana.medica@aurora.test',    'Ana Ribeiro'),
       ($2, 'bruno.medico@aurora.test',  'Bruno Tavares'),
       ($3, 'carla.recepcao@aurora.test','Carla Nogueira'),
       ($4, 'diego.medico@boreal.test',  'Diego Sales')`,
    [F.USER_A_ANA, F.USER_A_BRUNO, F.USER_A_CARLA, F.USER_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role) VALUES
       ($1, $6,  $3, $8,  'admin_clinico'),
       ($1, $7,  $3, $9,  'profissional'),
       ($1, $10, $4, $8,  'profissional'),
       ($1, $11, $5, $8,  'recepcao'),
       ($2, $12, $13, $14,'admin_clinico')`,
    [
      F.TENANT_A, F.TENANT_B, F.USER_A_ANA, F.USER_A_BRUNO, F.USER_A_CARLA,
      F.MEMBERSHIP_ANA_SP, F.MEMBERSHIP_ANA_MANAUS, F.CLINIC_A_SP, F.CLINIC_A_MANAUS,
      F.MEMBERSHIP_BRUNO_SP, F.MEMBERSHIP_CARLA_SP, F.MEMBERSHIP_DIEGO_RB,
      F.USER_B_DIEGO, F.CLINIC_B_RIO_BRANCO,
    ],
  );

  await admin.query(
    `INSERT INTO app.professional
       (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos) VALUES
       ($1, $3, $5, '06', '123456', 'SP', '225125'),
       ($1, $4, $6, '06', '654321', 'AM', '225125'),
       ($2, $7, $8, '06', '111222', 'AC', '225125')`,
    [
      F.TENANT_A, F.TENANT_B, F.PROF_A_ANA, F.PROF_A_BRUNO, F.USER_A_ANA,
      F.USER_A_BRUNO, F.PROF_B_DIEGO, F.USER_B_DIEGO,
    ],
  );

  await admin.query(
    `INSERT INTO clin.patient (tenant_id, id, full_name, nome_social, birth_date,
                               cadastro_status, search_digits) VALUES
       ($1, $3, 'Joao Ferreira da Silva', 'Joana Ferreira da Silva', '1988-03-14',
            'completo', $6),
       ($1, $4, 'RN de Joana Ferreira', NULL, NULL, 'preliminar', NULL),
       ($2, $5, 'Marcos Andrade Lima', NULL, '1975-11-02', 'completo', $6)`,
    [F.TENANT_A, F.TENANT_B, F.PATIENT_A_JOANA, F.PATIENT_A_RECEM_NASCIDO,
     F.PATIENT_B_MARCOS, F.CPF_VALIDO],
  );

  await admin.query(
    `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
       ($1, $3, $6, 'CPF', $9),
       ($1, $4, $7, 'SEM_DOCUMENTO', 'sem documento apresentado'),
       ($2, $5, $8, 'CPF', $9)`,
    [F.TENANT_A, F.TENANT_B, F.PID_A_JOANA_CPF, F.PID_A_RN_SEM_DOCUMENTO,
     F.PID_B_MARCOS_CPF, F.PATIENT_A_JOANA, F.PATIENT_A_RECEM_NASCIDO,
     F.PATIENT_B_MARCOS, F.CPF_VALIDO],
  );

  // Bruno nao e admin: so enxerga identificador de paciente compartilhado com ele.
  await admin.query(
    `INSERT INTO clin.record_share
       (tenant_id, id, patient_id, grantee_professional_id,
        granted_by_professional_id, reason) VALUES
       ($1, $2, $3, $4, $5, 'segunda opiniao solicitada pela paciente')`,
    [F.TENANT_A, F.SHARE_A_JOANA_PARA_BRUNO, F.PATIENT_A_JOANA,
     F.PROF_A_BRUNO, F.PROF_A_ANA],
  );

  // O tenant B PRECISA de linha aqui tambem: o teste "o seed realmente criou linha do
  // tenant B em toda tabela multi-tenant" descobre as tabelas do catalogo, e sem esta
  // linha o T1 passaria a toa em clin.record_share — nao ha o que vazar.
  await admin.query(
    `INSERT INTO clin.record_share
       (tenant_id, id, patient_id, grantee_professional_id,
        granted_by_professional_id, reason) VALUES
       ($1, $2, $3, $4, $4, 'acompanhamento proprio na unidade de Rio Branco')`,
    [F.TENANT_B, F.SHARE_B_MARCOS_PARA_DIEGO, F.PATIENT_B_MARCOS, F.PROF_B_DIEGO],
  );

  // ── Definicao de prontuario ────────────────────────────────────────────────
  //
  // clin.record_section e clin.record_field nasceram na Task 4 da Fase 1. Como
  // toda tabela multi-tenant, precisam de linha do tenant B: sem ela o teste meta
  // ("o seed realmente criou linha do tenant B em toda tabela multi-tenant")
  // reprova, e o T1 passaria a toa nelas — nao haveria o que vazar.
  await admin.query(
    `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal) VALUES
       ($1, $3, 'sinais_vitais', 'Sinais vitais', 1),
       ($2, $4, 'sinais_vitais', 'Sinais vitais', 1)`,
    [F.TENANT_A, F.TENANT_B, F.SECTION_A_SINAIS_VITAIS, F.SECTION_B_SINAIS_VITAIS],
  );

  await admin.query(
    `INSERT INTO clin.record_field
       (tenant_id, id, section_id, code, label, kind, observation_code, unit,
        is_reportable, ordinal, generation) VALUES
       ($1, $3, $5, 'peso', 'Peso', 'numerico', 'PESO', 'kg', true, 1, 1),
       ($2, $4, $6, 'peso', 'Peso', 'numerico', 'PESO', 'kg', true, 1, 1)`,
    [F.TENANT_A, F.TENANT_B, F.FIELD_A_PESO, F.FIELD_B_PESO,
     F.SECTION_A_SINAIS_VITAIS, F.SECTION_B_SINAIS_VITAIS],
  );

  // 'PA' e um campo COMPOSTO: um campo, DUAS observacoes. clin.record_field_component
  // nasceu na Task 5 da Fase 1 e tambem e multi-tenant — precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO clin.record_field
       (tenant_id, id, section_id, code, label, kind, is_reportable, ordinal, generation) VALUES
       ($1, $3, $5, 'pa', 'Pressao arterial', 'composto', true, 2, 1),
       ($2, $4, $6, 'pa', 'Pressao arterial', 'composto', true, 2, 1)`,
    [F.TENANT_A, F.TENANT_B, F.FIELD_A_PA, F.FIELD_B_PA,
     F.SECTION_A_SINAIS_VITAIS, F.SECTION_B_SINAIS_VITAIS],
  );

  await admin.query(
    `INSERT INTO clin.record_field_component
       (tenant_id, id, field_id, ordinal, observation_code, label, unit) VALUES
       ($1, $3, $7, 1, 'PA_SIS', 'Sistolica',  'mmHg'),
       ($1, $4, $7, 2, 'PA_DIA', 'Diastolica', 'mmHg'),
       ($2, $5, $8, 1, 'PA_SIS', 'Sistolica',  'mmHg'),
       ($2, $6, $8, 2, 'PA_DIA', 'Diastolica', 'mmHg')`,
    [F.TENANT_A, F.TENANT_B,
     F.COMPONENT_A_PA_SIS, F.COMPONENT_A_PA_DIA,
     F.COMPONENT_B_PA_SIS, F.COMPONENT_B_PA_DIA,
     F.FIELD_A_PA, F.FIELD_B_PA],
  );

  // O layout do prontuario e POR PROFISSIONAL: clin.record_layout_item nasceu na
  // Task 6 da Fase 1 e tambem e multi-tenant — precisa de linha do tenant B, senao
  // o teste meta reprova e o T1 passaria a toa nela.
  await admin.query(
    `INSERT INTO clin.record_layout_item
       (tenant_id, id, professional_id, section_id, ordinal, visible) VALUES
       ($1, $3, $5, $7, 1, true),
       ($2, $4, $6, $8, 1, true)`,
    [F.TENANT_A, F.TENANT_B,
     F.LAYOUT_A_ANA_SINAIS_VITAIS, F.LAYOUT_B_DIEGO_SINAIS_VITAIS,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.SECTION_A_SINAIS_VITAIS, F.SECTION_B_SINAIS_VITAIS],
  );

  // clin.encounter nasceu na Task 9 da Fase 1. Como toda tabela multi-tenant,
  // precisa de linha do tenant B: sem ela o teste meta ("o seed realmente criou
  // linha do tenant B em toda tabela multi-tenant") reprova, e o T1 passaria a toa.
  // occurred_date vem de app.local_date com o fuso da CLINICA, nunca de um cast.
  await admin.query(
    `INSERT INTO clin.encounter
       (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
     VALUES ($1, $3, $5, $7, $9,  TIMESTAMPTZ '2026-08-01T14:00:00Z',
             app.local_date(TIMESTAMPTZ '2026-08-01T14:00:00Z',
                            (SELECT timezone FROM app.clinic WHERE id = $9))),
            ($2, $4, $6, $8, $10, TIMESTAMPTZ '2026-08-01T14:00:00Z',
             app.local_date(TIMESTAMPTZ '2026-08-01T14:00:00Z',
                            (SELECT timezone FROM app.clinic WHERE id = $10)))`,
    [F.TENANT_A, F.TENANT_B, F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS, F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO],
  );

  // clin.encounter_draft nasceu na Task 10 da Fase 1 e e a UNICA superficie
  // mutavel do sistema. Como toda tabela multi-tenant, precisa de linha do tenant
  // B: sem ela o teste meta ("o seed realmente criou linha do tenant B em toda
  // tabela multi-tenant") reprova, e o T1 passaria a toa. rev fica no padrao 1 —
  // e o banco, nao o seed, quem conduz a revisao.
  await admin.query(
    `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, updated_by) VALUES
       ($1, $3, '{"queixa":"cefaleia ha 3 dias"}'::jsonb, $5),
       ($2, $4, '{"queixa":"dor lombar"}'::jsonb, $6)`,
    [F.TENANT_A, F.TENANT_B, F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // clin.encounter_version nasceu na Task 14 da Fase 1: a versao e a unidade
  // assinavel do registro. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senao o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa. A insercao vai
  // como superusuario: app_rw NAO tem INSERT nesta tabela, de proposito.
  // version_no 1 obriga kind = 'original'; prev_hash fica NULL porque e o elo
  // inicial da cadeia de hash daquele atendimento.
  await admin.query(
    `INSERT INTO clin.encounter_version
       (tenant_id, id, encounter_id, version_no, kind, author_user_id,
        author_professional_id, content_hash, serializer_version) VALUES
       ($1, $3, $5, 1, 'original', $7, $9,  sha256('versao original do tenant A'::bytea), 'jcs-1'),
       ($2, $4, $6, 1, 'original', $8, $10, sha256('versao original do tenant B'::bytea), 'jcs-1')`,
    [F.TENANT_A, F.TENANT_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.USER_A_ANA, F.USER_B_DIEGO,
     F.PROF_A_ANA, F.PROF_B_DIEGO],
  );

  // clin.encounter_field_value nasceu na Task 15 da Fase 1 e e PARTICIONADA por
  // finalized_at. Como toda tabela multi-tenant, precisa de linha do tenant B,
  // senao o teste meta ("o seed realmente criou linha do tenant B em toda tabela
  // multi-tenant") reprova e o T1 passaria a toa. A insercao vai como
  // superusuario: app_rw NAO tem INSERT nesta tabela, de proposito.
  //
  // finalized_at vem da PROPRIA versao, nunca de um literal: e a chave de
  // particao, e copiar o valor da versao e o que garante que o valor cai na mesma
  // faixa que o registro assinado. label_snapshot congela 'Peso' — se a clinica
  // renomear o campo amanha, este atendimento continua mostrando o que o medico viu.
  await admin.query(
    `INSERT INTO clin.encounter_field_value
       (tenant_id, id, version_id, finalized_at, field_id, field_generation,
        label_snapshot, value_num)
     SELECT $1::uuid, $3::uuid, $5::uuid, v.finalized_at, $7::uuid, 1, 'Peso', 68.400
       FROM clin.encounter_version v WHERE v.id = $5::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, $6::uuid, v.finalized_at, $8::uuid, 1, 'Peso', 81.200
       FROM clin.encounter_version v WHERE v.id = $6::uuid`,
    [F.TENANT_A, F.TENANT_B,
     F.FIELD_VALUE_A_JOANA_PESO, F.FIELD_VALUE_B_MARCOS_PESO,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.FIELD_A_PESO, F.FIELD_B_PESO],
  );

  // ── Trilha de auditoria ────────────────────────────────────────────────────
  //
  // As quatro tabelas de `audit` nasceram nas Tasks 25-31, DEPOIS deste seed. Sem
  // linha do tenant B aqui, o teste meta ("o seed realmente criou linha do tenant B
  // em toda tabela multi-tenant") reprova — e reprova com razao: sem linha de B, o
  // T1 passaria a toa nessas tabelas, porque nao havia o que vazar.
  //
  // A insercao vai direto, como superusuario. A policy `writer` de audit.event so
  // permite INSERT ao audit_owner, e a RLS e FORCADA — mas FORCE sujeita o DONO da
  // tabela, nao o superusuario, que continua com bypass. O trigger no_mutate recusa
  // UPDATE e DELETE para todo mundo, e nao interfere no INSERT.

  await admin.query(
    `INSERT INTO audit.event
       (tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
        entity_schema, entity_table, entity_id, outcome, meta) VALUES
       ($1, $3, $5, 'user', 'PATIENT_RECORD_READ',
        'clin', 'encounter', $7, 'sucesso', '{"use_case":"linha_do_tempo"}'::jsonb),
       ($2, $4, $6, 'user', 'PATIENT_RECORD_READ',
        'clin', 'encounter', $8, 'sucesso', '{"use_case":"linha_do_tempo"}'::jsonb)`,
    [F.TENANT_A, F.TENANT_B, F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.USER_A_ANA, F.USER_B_DIEGO, F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS],
  );

  await admin.query(
    `INSERT INTO audit.read_dedup
       (tenant_id, actor_user_id, entity_id, use_case, last_logged_at) VALUES
       ($1, $3, $5, 'linha_do_tempo', clock_timestamp()),
       ($2, $4, $6, 'linha_do_tempo', clock_timestamp())`,
    [F.TENANT_A, F.TENANT_B, F.USER_A_ANA, F.USER_B_DIEGO,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS],
  );

  // Selo de um dia ja fechado. chain_hash e prev_chain_hash sao bytea arbitrarios:
  // a verificacao de cadeia tem teste proprio; aqui a linha existe para o T1 ter o
  // que tentar ler do tenant alheio.
  await admin.query(
    `INSERT INTO audit.seal
       (tenant_id, seal_date, first_id, last_id, row_count,
        chain_hash, prev_chain_hash, snapshot_xmin) VALUES
       ($1, DATE '2026-08-01', 1, 1, 1, '\\x01'::bytea, NULL, 100),
       ($2, DATE '2026-08-01', 2, 2, 1, '\\x02'::bytea, NULL, 100)`,
    [F.TENANT_A, F.TENANT_B],
  );

  await admin.query(
    `INSERT INTO audit.seal_run (tenant_id, seal_date, finished_at, outcome) VALUES
       ($1, DATE '2026-08-01', clock_timestamp(), 'sucesso'),
       ($2, DATE '2026-08-01', clock_timestamp(), 'sucesso')`,
    [F.TENANT_A, F.TENANT_B],
  );
}
