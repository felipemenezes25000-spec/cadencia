import type { Client } from 'pg';
import * as F from './fixtures';

/**
 * Dois tenants reais e conflitantes de propósito:
 * - Aurora (A): rede com unidade em São Paulo e em Manaus. Ana é admin_clinico em
 *   SP e apenas profissional em Manaus. Carla é recepcao (não é profissional).
 * - Boreal (B): unidade em Rio Branco, com o MESMO CPF cadastrado que o tenant A.
 * Roda como superusuário, antes de qualquer teste, uma única vez.
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

  // Bruno não é admin: só enxerga identificador de paciente compartilhado com ele.
  await admin.query(
    `INSERT INTO clin.record_share
       (tenant_id, id, patient_id, grantee_professional_id,
        granted_by_professional_id, reason) VALUES
       ($1, $2, $3, $4, $5, 'segunda opiniao solicitada pela paciente')`,
    [F.TENANT_A, F.SHARE_A_JOANA_PARA_BRUNO, F.PATIENT_A_JOANA,
     F.PROF_A_BRUNO, F.PROF_A_ANA],
  );

  // O tenant B PRECISA de linha aqui também: o teste "o seed realmente criou linha do
  // tenant B em toda tabela multi-tenant" descobre as tabelas do catálogo, e sem esta
  // linha o T1 passaria a toa em clin.record_share — não há o que vazar.
  await admin.query(
    `INSERT INTO clin.record_share
       (tenant_id, id, patient_id, grantee_professional_id,
        granted_by_professional_id, reason) VALUES
       ($1, $2, $3, $4, $4, 'acompanhamento proprio na unidade de Rio Branco')`,
    [F.TENANT_B, F.SHARE_B_MARCOS_PARA_DIEGO, F.PATIENT_B_MARCOS, F.PROF_B_DIEGO],
  );

  // ── Definição de prontuário ────────────────────────────────────────────────
  //
  // clin.record_section e clin.record_field nasceram na Task 4 da Fase 1. Como
  // toda tabela multi-tenant, precisam de linha do tenant B: sem ela o teste meta
  // ("o seed realmente criou linha do tenant B em toda tabela multi-tenant")
  // reprova, e o T1 passaria a toa nelas — não haveria o que vazar.
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

  // 'PA' é um campo COMPOSTO: um campo, DUAS observações. clin.record_field_component
  // nasceu na Task 5 da Fase 1 e também é multi-tenant — precisa de linha do tenant B.
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

  // O layout do prontuário é POR PROFISSIONAL: clin.record_layout_item nasceu na
  // Task 6 da Fase 1 e também é multi-tenant — precisa de linha do tenant B, senão
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
  // occurred_date vem de app.local_date com o fuso da CLÍNICA, nunca de um cast.
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

  // clin.encounter_draft nasceu na Task 10 da Fase 1 e é a ÚNICA superfície
  // mutável do sistema. Como toda tabela multi-tenant, precisa de linha do tenant
  // B: sem ela o teste meta ("o seed realmente criou linha do tenant B em toda
  // tabela multi-tenant") reprova, e o T1 passaria a toa. rev fica no padrão 1 —
  // é o banco, não o seed, quem conduz a revisão.
  await admin.query(
    `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, updated_by) VALUES
       ($1, $3, '{"queixa":"cefaleia ha 3 dias"}'::jsonb, $5),
       ($2, $4, '{"queixa":"dor lombar"}'::jsonb, $6)`,
    [F.TENANT_A, F.TENANT_B, F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // clin.encounter_version nasceu na Task 14 da Fase 1: a versão é a unidade
  // assinável do registro. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senão o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa. A inserção vai
  // como superusuário: app_rw NÃO tem INSERT nesta tabela, de propósito.
  // version_no 1 obriga kind = 'original'; prev_hash fica NULL porque é o elo
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

  // clin.encounter_field_value nasceu na Task 15 da Fase 1 e é PARTICIONADA por
  // finalized_at. Como toda tabela multi-tenant, precisa de linha do tenant B,
  // senão o teste meta ("o seed realmente criou linha do tenant B em toda tabela
  // multi-tenant") reprova e o T1 passaria a toa. A inserção vai como
  // superusuário: app_rw NÃO tem INSERT nesta tabela, de propósito.
  //
  // finalized_at vem da PRÓPRIA versão, nunca de um literal: é a chave de
  // partição, e copiar o valor da versão é o que garante que o valor cai na mesma
  // faixa que o registro assinado. label_snapshot congela 'Peso' — se a clínica
  // renomear o campo amanhã, este atendimento continua mostrando o que o médico viu.
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

  // As quatro tabelas de primeira classe nasceram na Task 16 da Fase 1. Como toda
  // tabela multi-tenant, precisam de linha do tenant B, senão o teste meta ("o seed
  // realmente criou linha do tenant B em toda tabela multi-tenant") reprova e o T1
  // passaria a toa. A inserção vai como superusuário: app_rw só tem SELECT nelas.
  //
  // encounter_id, patient_id, professional_id, clinic_id e occurred_date são lidos
  // do PRÓPRIO atendimento em vez de repetidos como literal: são colunas
  // desnormalizadas, e copiar da origem é o que impede o seed de inventar uma
  // combinação que o sistema real nunca produziria.
  await admin.query(
    `INSERT INTO clin.diagnosis
       (tenant_id, id, encounter_id, version_id, patient_id, professional_id,
        clinic_id, occurred_date, code_system, code, display_snapshot,
        terminology_version, is_principal)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, 'CID10', 'J45', 'Asma', '202601', true
       FROM clin.encounter e WHERE e.id = $7::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, 'CID10', 'M54', 'Dorsalgia', '202601', true
       FROM clin.encounter e WHERE e.id = $8::uuid`,
    [F.TENANT_A, F.TENANT_B, F.DIAGNOSIS_A_JOANA, F.DIAGNOSIS_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  await admin.query(
    `INSERT INTO clin.observation
       (tenant_id, id, encounter_id, version_id, patient_id, professional_id,
        clinic_id, occurred_date, observation_code, value_num, unit, field_id)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, 'PESO', 68.400, 'kg', $9::uuid
       FROM clin.encounter e WHERE e.id = $7::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, 'PESO', 81.200, 'kg', $10::uuid
       FROM clin.encounter e WHERE e.id = $8::uuid`,
    [F.TENANT_A, F.TENANT_B, F.OBSERVATION_A_JOANA_PESO, F.OBSERVATION_B_MARCOS_PESO,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.FIELD_A_PESO, F.FIELD_B_PESO],
  );

  await admin.query(
    `INSERT INTO clin.encounter_finding
       (tenant_id, id, encounter_id, version_id, patient_id, professional_id,
        clinic_id, occurred_date, field_id, field_code, option_code, display_snapshot)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, $9::uuid, 'peso', 'aferido', 'Aferido'
       FROM clin.encounter e WHERE e.id = $7::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, $10::uuid, 'peso', 'aferido', 'Aferido'
       FROM clin.encounter e WHERE e.id = $8::uuid`,
    [F.TENANT_A, F.TENANT_B, F.FINDING_A_JOANA, F.FINDING_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.FIELD_A_PESO, F.FIELD_B_PESO],
  );

  // TUSS exige `tabela`: o CHECK da migration 0035 amarra code_system = 'TUSS' a
  // tabela IS NOT NULL. 22 é a tabela de procedimentos e eventos em saúde.
  await admin.query(
    `INSERT INTO clin.procedure
       (tenant_id, id, encounter_id, version_id, patient_id, professional_id,
        clinic_id, occurred_date, code_system, tabela, code, display_snapshot,
        terminology_version, quantidade, valor_centavos)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, 'TUSS', 22::smallint, '10101012',
            'Consulta em consultorio', '202601', 1, 25000
       FROM clin.encounter e WHERE e.id = $7::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, e.patient_id, e.professional_id,
            e.clinic_id, e.occurred_date, 'TUSS', 22::smallint, '10101012',
            'Consulta em consultorio', '202601', 1, 30000
       FROM clin.encounter e WHERE e.id = $8::uuid`,
    [F.TENANT_A, F.TENANT_B, F.PROCEDURE_A_JOANA, F.PROCEDURE_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // clin.ai_assistance nasceu na Task 17 da Fase 1: o apoio por IA é parte do
  // prontuário, não um log paralelo. Como toda tabela multi-tenant, precisa de
  // linha do tenant B, senão o teste meta ("o seed realmente criou linha do tenant
  // B em toda tabela multi-tenant") reprova e o T1 passaria a toa. A inserção vai
  // como superusuário: app_rw só tem SELECT nela.
  //
  // encounter_id e patient_id são lidos do PRÓPRIO atendimento em vez de repetidos
  // como literal, no mesmo espírito das tabelas de primeira classe. Os dois hashes
  // são sha256 de verdade porque o CHECK exige 32 bytes; o output fica em texto
  // legível porque a auditoria de alucinação precisa ler o que a IA escreveu.
  await admin.query(
    `INSERT INTO clin.ai_assistance
       (tenant_id, id, encounter_id, version_id, patient_id, purpose, risk_class,
        provider, model_id, model_version, residency, input_hash, output, output_hash)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, e.patient_id,
            'transcricao_anamnese', 'IIa', 'provedor-br', 'modelo-transcricao', '2026.07',
            'br', sha256('entrada do tenant A'::bytea),
            'Paciente relata cefaleia ha tres dias, sem febre.',
            sha256('saida do tenant A'::bytea)
       FROM clin.encounter e WHERE e.id = $7::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, e.patient_id,
            'resumo_historico', 'I', 'provedor-br', 'modelo-resumo', '2026.07',
            'br', sha256('entrada do tenant B'::bytea),
            'Paciente com dor lombar recorrente ha dois anos.',
            sha256('saida do tenant B'::bytea)
       FROM clin.encounter e WHERE e.id = $8::uuid`,
    [F.TENANT_A, F.TENANT_B, F.AI_ASSISTANCE_A_JOANA, F.AI_ASSISTANCE_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // clin.encounter_billing nasceu na Task 24 da Fase 1: os campos da guia de
  // consulta são capturados NO atendimento, com o módulo tiss ainda inexistente.
  // Como toda tabela multi-tenant, precisa de linha do tenant B, senão o teste
  // meta ("o seed realmente criou linha do tenant B em toda tabela multi-tenant")
  // reprova e o T1 passaria a toa.
  //
  // cnes vem da CLÍNICA e conselho/numero/uf/cbos vêm do PROFISSIONAL do próprio
  // atendimento, nunca repetidos como literal: são exatamente os tipos de origem,
  // e copiar da origem é o que prova que a projeção não precisa converter nada.
  // data_atendimento vem de e.occurred_date — a data do evento no fuso da clínica,
  // nunca um cast de occurred_at.
  //
  // Aurora atende por convênio: tem registro_ans, carteirinha e EXATAMENTE um
  // identificador de prestador. Boreal atende particular: sem registro_ans e sem
  // carteirinha, que é o que o CHECK amarra um ao outro.
  await admin.query(
    `INSERT INTO clin.encounter_billing
       (tenant_id, id, encounter_id, operadora_nome, registro_ans, numero_carteira,
        codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
        uf_conselho, cbos, tipo_consulta, data_atendimento, codigo_tabela,
        codigo_procedimento, valor_centavos, created_by)
     SELECT $1::uuid, $3::uuid, e.id, 'Operadora Meridiano Saude', '326305', '00998877665544',
            '900123', c.cnes, p.conselho_profissional, p.numero_conselho, p.uf_conselho,
            p.cbos, '1', e.occurred_date, '22', '10101012', 25000, $7::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $5::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, NULL, NULL, NULL,
            NULL, c.cnes, p.conselho_profissional, p.numero_conselho, p.uf_conselho,
            p.cbos, '2', e.occurred_date, '22', '10101012', 30000, $8::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $6::uuid`,
    [F.TENANT_A, F.TENANT_B, F.BILLING_A_JOANA, F.BILLING_B_MARCOS,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS, F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // clin.signature nasceu na Task 42 da Fase 1: os bytes que fazem o documento
  // sobreviver a nós e ao PSC. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senão o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa. A inserção vai como
  // superusuário: app_rw só tem SELECT e INSERT nesta tabela, e o trigger
  // no_mutate bloqueia UPDATE de colunas de conteúdo e DELETE.
  await admin.query(
    `INSERT INTO clin.signature
       (tenant_id, id, subject_kind, subject_id, canonical_key, canonical_version,
        hash, policy_oid, standard, psc, signer_user_id, signer_cpf, cert_serial,
        cert_not_after, pkcs7, timestamp_token, ltv_material_key,
        verified_status, verified_at, signed_at) VALUES
       ($1, $3, 'encounter_version', $5, gen_random_uuid(), 'jcs-1',
        sha256('assinatura tenant A'::bytea), '2.16.76.1.7.1.2.2.3', 'AD_RT',
        'fake', $7, '00000000000', 'SEED-A', TIMESTAMPTZ '2046-01-01',
        '\\x01'::bytea, '\\x02'::bytea, gen_random_uuid(),
        'valida', clock_timestamp(), clock_timestamp()),
       ($2, $4, 'encounter_version', $6, gen_random_uuid(), 'jcs-1',
        sha256('assinatura tenant B'::bytea), '2.16.76.1.7.1.2.2.3', 'AD_RT',
        'fake', $8, '00000000000', 'SEED-B', TIMESTAMPTZ '2046-01-01',
        '\\x01'::bytea, '\\x02'::bytea, gen_random_uuid(),
        'valida', clock_timestamp(), clock_timestamp())`,
    [F.TENANT_A, F.TENANT_B, F.SIGNATURE_A_JOANA, F.SIGNATURE_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // clin.document nasceu na Task 44 da Fase 1: o documento nato-digital. Como
  // toda tabela multi-tenant, precisa de linha do tenant B, senão o teste meta
  // ("o seed realmente criou linha do tenant B em toda tabela multi-tenant")
  // reprova e o T1 passaria a toa. A inserção vai como superusuário.
  //
  // encounter_id e version_id são opcionais (um documento pode existir fora de
  // atendimento), mas no seed preenchemos para cobrir o FK composite.
  await admin.query(
    `INSERT INTO clin.document
       (tenant_id, id, kind, patient_id, professional_id, clinic_id,
        encounter_id, version_id, issued_date, payload, content_hash,
        canonical_version, signature_id, created_by) VALUES
       ($1, $3, 'atestado', $5, $7, $9,
        $11, $13, DATE '2026-08-01', '{"texto":"Atesto para fins"}'::jsonb,
        sha256('documento tenant A'::bytea), 'jcs-1', $15, $7::uuid),
       ($2, $4, 'pedido_exame', $6, $8, $10,
        $12, $14, DATE '2026-08-01', '{"itens":["hemograma"]}'::jsonb,
        sha256('documento tenant B'::bytea), 'jcs-1', $16, $8::uuid)`,
    [F.TENANT_A, F.TENANT_B,
     F.DOCUMENT_A_JOANA, F.DOCUMENT_B_MARCOS,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.SIGNATURE_A_JOANA, F.SIGNATURE_B_MARCOS],
  );

  // clin.attachment nasceu na Task 47 da Fase 1: o anexo clínico com chave opaca
  // e referência de chave de dados para crypto-shredding. Como toda tabela
  // multi-tenant, precisa de linha do tenant B, senão o teste meta ("o seed
  // realmente criou linha do tenant B em toda tabela multi-tenant") reprova e o
  // T1 passaria a toa. A inserção vai como superusuário.
  //
  // storage_key é um UUID opaco (NGS1.06.01): o caminho no objeto NÃO revela o
  // conteúdo. original_name mora no banco, sob RLS. sha256 é 32 bytes de verdade
  // porque o CHECK exige octet_length = 32.
  await admin.query(
    `INSERT INTO clin.attachment
       (tenant_id, id, patient_id, encounter_id, version_id, kind, storage_key,
        original_name, content_type, size_bytes, sha256, dek_ref, occurred_date,
        created_by) VALUES
       ($1, $3, $5, $7, $9,  'resultado_exame', gen_random_uuid(),
        'hemograma_20260801.pdf', 'application/pdf', 204800,
        sha256('attachment tenant A'::bytea), 'dek:tenant-a:2026-08',
        DATE '2026-07-28', $11),
       ($2, $4, $6, $8, $10, 'imagem', gen_random_uuid(),
        'rx_torax.dcm', 'application/dicom', 1048576,
        sha256('attachment tenant B'::bytea), 'dek:tenant-b:2026-08',
        DATE '2026-07-30', $12)`,
    [F.TENANT_A, F.TENANT_B,
     F.ATTACHMENT_A_JOANA, F.ATTACHMENT_B_MARCOS,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // clin.record_export nasceu na Task 48 da Fase 1: a exportação do prontuário
  // é uma ENTIDADE (ECF.18), não um efeito colateral. version_ids, attachment_ids
  // e document_ids congelam o CONJUNTO exportado. receipt_json guarda o recibo
  // indissociável. Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO clin.record_export
       (tenant_id, id, patient_id, requested_by, requester_kind, version_ids,
        attachment_ids, document_ids, page_count, pdf_key, pdf_sha256,
        receipt_json) VALUES
       ($1, $3, $5, $7, 'titular',
        ARRAY[$9]::uuid[], ARRAY[$11]::uuid[], ARRAY[$13]::uuid[],
        3, gen_random_uuid(), sha256('export tenant A'::bytea),
        '{"paciente":"Joana","emitido_por":"Ana","paginas":3}'::jsonb),
       ($2, $4, $6, $8, 'profissional',
        ARRAY[$10]::uuid[], ARRAY[$12]::uuid[], ARRAY[$14]::uuid[],
        2, gen_random_uuid(), sha256('export tenant B'::bytea),
        '{"paciente":"Marcos","emitido_por":"Diego","paginas":2}'::jsonb)`,
    [F.TENANT_A, F.TENANT_B,
     F.RECORD_EXPORT_A_JOANA, F.RECORD_EXPORT_B_MARCOS,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.USER_A_ANA, F.USER_B_DIEGO,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.ATTACHMENT_A_JOANA, F.ATTACHMENT_B_MARCOS,
     F.DOCUMENT_A_JOANA, F.DOCUMENT_B_MARCOS],
  );

  // clin.prescription nasceu na Task 53 da Fase 1: persistimos do NOSSO lado
  // id, link, código, PDF e bytes assinados desde a primeira prescrição. Itens
  // normalizados em tabela própria, não um blob do parceiro.
  await admin.query(
    `INSERT INTO clin.prescription
       (tenant_id, id, patient_id, professional_id, clinic_id, encounter_id,
        issued_date, provider, provider_prescription_id, patient_link_url,
        validation_code, created_by) VALUES
       ($1, $3, $5, $7, $9, $11,
        CURRENT_DATE, 'memed', 'memed-rx-a', 'https://parceiro.fake/r/a',
        '123456', $7),
       ($2, $4, $6, $8, $10, $12,
        CURRENT_DATE, 'memed', 'memed-rx-b', 'https://parceiro.fake/r/b',
        '654321', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.PRESCRIPTION_A_JOANA, F.PRESCRIPTION_B_MARCOS,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  await admin.query(
    `INSERT INTO clin.prescription_item
       (tenant_id, id, prescription_id, ordinal, nome, posologia) VALUES
       ($1, $3, $5, 1, 'Losartana 50mg', '1 cp manha'),
       ($2, $4, $6, 1, 'Metformina 850mg', '1 cp almoco e jantar')`,
    [F.TENANT_A, F.TENANT_B,
     F.PRESCRIPTION_ITEM_A, F.PRESCRIPTION_ITEM_B,
     F.PRESCRIPTION_A_JOANA, F.PRESCRIPTION_B_MARCOS],
  );

  // clin.signature_pending nasceu na Task 43 da Fase 1: a fila de pendências
  // quando o PSC não responde. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senão o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa.
  //
  // subject_id usa gen_random_uuid() porque não há FK: a mesma tabela serve
  // encounter_version, document e prescription.
  await admin.query(
    `INSERT INTO clin.signature_pending
       (tenant_id, id, clinic_id, subject_kind, subject_id, canonical_key,
        hash, signer_user_id, motivo, detalhe, precisa_reconciliar) VALUES
       ($1, $3, $5, 'document', gen_random_uuid(), gen_random_uuid(),
        sha256('pendente tenant A'::bytea), $7, 'unavailable',
        'PSC fake indisponivel', false),
       ($2, $4, $6, 'document', gen_random_uuid(), gen_random_uuid(),
        sha256('pendente tenant B'::bytea), $8, 'timeout',
        'deadline de 3s estourou', true)`,
    [F.TENANT_A, F.TENANT_B, F.SIGNATURE_PENDING_A, F.SIGNATURE_PENDING_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO, F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // app.outbox nasceu na Task 2 da Fase 2: o outbox transacional garante que o
  // evento só existe se o efeito de domínio existir. Como toda tabela multi-tenant,
  // precisa de linha do tenant B, senão o teste meta ("o seed realmente criou
  // linha do tenant B em toda tabela multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO app.outbox
       (tenant_id, id, event_type, aggregate_id, payload) VALUES
       ($1, $3, 'APPOINTMENT_CONFIRMED', $5, '{"appointmentId":"seed-a"}'::jsonb),
       ($2, $4, 'APPOINTMENT_CONFIRMED', $6, '{"appointmentId":"seed-b"}'::jsonb)`,
    [F.TENANT_A, F.TENANT_B, F.OUTBOX_A, F.OUTBOX_B,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // ── Trilha de auditoria ────────────────────────────────────────────────────
  //
  // As quatro tabelas de `audit` nasceram nas Tasks 25-31, DEPOIS deste seed. Sem
  // linha do tenant B aqui, o teste meta ("o seed realmente criou linha do tenant B
  // em toda tabela multi-tenant") reprova — e reprova com razão: sem linha de B, o
  // T1 passaria a toa nessas tabelas, porque não havia o que vazar.
  //
  // A inserção vai direto, como superusuário. A policy `writer` de audit.event só
  // permite INSERT ao audit_owner, e a RLS é FORÇADA — mas FORCE sujeita o DONO da
  // tabela, não o superusuário, que continua com bypass. O trigger no_mutate recusa
  // UPDATE e DELETE para todo mundo, e não interfere no INSERT.

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

  // Selo de um dia já fechado. chain_hash e prev_chain_hash são bytea arbitrários:
  // a verificação de cadeia tem teste próprio; aqui a linha existe para o T1 ter o
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

  // fin.category nasceu na Task 24 da Fase 2: categorias de lançamento financeiro.
  // Como toda tabela multi-tenant, precisa de linha do tenant B, senão o teste meta
  // ("o seed realmente criou linha do tenant B em toda tabela multi-tenant") reprova
  // e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO fin.category (tenant_id, id, name, kind) VALUES
       ($1, $3, 'Consulta particular', 'receita'),
       ($2, $4, 'Consulta particular', 'receita')`,
    [F.TENANT_A, F.TENANT_B, F.CATEGORY_A, F.CATEGORY_B],
  );

  // fin.payment_method nasceu na Task 24 da Fase 2: métodos de pagamento do tenant.
  // Como toda tabela multi-tenant, precisa de linha do tenant B, senão o teste meta
  // ("o seed realmente criou linha do tenant B em toda tabela multi-tenant") reprova
  // e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO fin.payment_method (tenant_id, id, kind, name) VALUES
       ($1, $3, 'dinheiro', 'Dinheiro'),
       ($2, $4, 'dinheiro', 'Dinheiro')`,
    [F.TENANT_A, F.TENANT_B, F.PAYMENT_METHOD_A, F.PAYMENT_METHOD_B],
  );

  // fin.entry nasceu na Task 25 da Fase 2: lançamento financeiro. Como toda tabela
  // multi-tenant, precisa de linha do tenant B, senão o teste meta ("o seed realmente
  // criou linha do tenant B em toda tabela multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
        description, amount_cents, payment_method_id, paid_at, status, idempotency_key) VALUES
       ($1, $3, 'receita', $5, $7, $9,  $11,
        'Consulta particular', 25000, $13, clock_timestamp(), 'pago', 'seed-entry-a'),
       ($2, $4, 'receita', $6, $8, $10, $12,
        'Consulta particular', 30000, $14, clock_timestamp(), 'pago', 'seed-entry-b')`,
    [F.TENANT_A, F.TENANT_B,
     F.ENTRY_A, F.ENTRY_B,
     F.CATEGORY_A, F.CATEGORY_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.PAYMENT_METHOD_A, F.PAYMENT_METHOD_B],
  );

  // fin.receipt_counter nasceu na Task 25 da Fase 2: sequência de recibo por tenant.
  // Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES
       ($1, 2),
       ($2, 2)`,
    [F.TENANT_A, F.TENANT_B],
  );

  // fin.receipt nasceu na Task 25 da Fase 2: recibo vinculado ao lançamento.
  // Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number) VALUES
       ($1, $3, $5, 1),
       ($2, $4, $6, 1)`,
    [F.TENANT_A, F.TENANT_B,
     F.RECEIPT_A, F.RECEIPT_B,
     F.ENTRY_A, F.ENTRY_B],
  );

  // fin.daily_rollup nasceu na Task 26 da Fase 2: resumo diário do financeiro com
  // duas bases (competência e caixa). Como toda tabela multi-tenant, precisa de
  // linha do tenant B, senão o teste meta ("o seed realmente criou linha do tenant
  // B em toda tabela multi-tenant") reprova e o T1 passaria a toa. A PK é composta
  // sem coluna id; o sentinel UUID substitui NULL em category_id.
  await admin.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries) VALUES
       ($1, $3, DATE '2026-08-01', 'competencia', 'receita', $5, 'pago', 25000, 1),
       ($2, $4, DATE '2026-08-01', 'competencia', 'receita', $6, 'pago', 30000, 1)`,
    [F.TENANT_A, F.TENANT_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.CATEGORY_A, F.CATEGORY_B],
  );

  // fin.payment_link nasceu na Task 32 da Fase 2: vincula um link do PSP a um
  // lançamento financeiro. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senão o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO fin.payment_link
       (tenant_id, id, entry_id, provider_link_id, url, status, amount_cents,
        provider_id, idempotency_key, created_by) VALUES
       ($1, $3, $5, 'psp-link-a', 'https://pay.fake/a', 'pending', 25000,
        'fake-psp', 'seed-plink-a', $7),
       ($2, $4, $6, 'psp-link-b', 'https://pay.fake/b', 'pending', 30000,
        'fake-psp', 'seed-plink-b', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.PAYMENT_LINK_A, F.PAYMENT_LINK_B,
     F.ENTRY_A, F.ENTRY_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // fin.webhook_event nasceu na Task 39 da Fase 2: evento bruto do PSP. Como toda
  // tabela multi-tenant, precisa de linha do tenant B, senão o teste meta reprova
  // e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO fin.webhook_event
       (tenant_id, id, event_type, raw_payload) VALUES
       ($1, $3, 'payment.confirmed', '{"paymentLinkId":"seed-a"}'::jsonb),
       ($2, $4, 'payment.confirmed', '{"paymentLinkId":"seed-b"}'::jsonb)`,
    [F.TENANT_A, F.TENANT_B, F.WEBHOOK_EVENT_A, F.WEBHOOK_EVENT_B],
  );

  // fin.reconciliation_log nasceu na Task 32 da Fase 2: divergências detectadas
  // pela conciliação. Como toda tabela multi-tenant, precisa de linha do tenant B,
  // senão o teste meta reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO fin.reconciliation_log
       (tenant_id, id, reconciled_date, provider_payment_id, entry_id, kind,
        expected_cents, actual_cents, detail) VALUES
       ($1, $3, DATE '2026-08-01', 'psp-pay-a', $5, 'amount_mismatch',
        25000, 24500, 'taxa nao esperada'),
       ($2, $4, DATE '2026-08-01', 'psp-pay-b', $6, 'fee_mismatch',
        500, 600, 'taxa divergente')`,
    [F.TENANT_A, F.TENANT_B,
     F.RECONCILIATION_LOG_A, F.RECONCILIATION_LOG_B,
     F.ENTRY_A, F.ENTRY_B],
  );

  // ── Agenda (sched) ─────────────────────────────────────────────────────────
  //
  // As tabelas sched.* nasceram na Fase 1 (Tasks 37-41). Como toda tabela
  // multi-tenant, precisam de linha do tenant B, senão o teste meta reprova
  // e o T1 passaria a toa.

  await admin.query(
    `INSERT INTO sched.procedure
       (tenant_id, id, code, nome, cor, duracao_min, valor_centavos) VALUES
       ($1, $3, 'CONS-001', 'Consulta padrao', '#4f46e5', 30, 25000),
       ($2, $4, 'CONS-001', 'Consulta padrao', '#4f46e5', 30, 30000)`,
    [F.TENANT_A, F.TENANT_B, F.SCHED_PROCEDURE_A, F.SCHED_PROCEDURE_B],
  );

  await admin.query(
    `INSERT INTO sched.appointment
       (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
        starts_at, ends_at, appointment_date, created_by) VALUES
       ($1, $3, $5, $7, $9,  $11,
        TIMESTAMPTZ '2026-08-02T09:00:00Z', TIMESTAMPTZ '2026-08-02T09:30:00Z',
        app.local_date(TIMESTAMPTZ '2026-08-02T09:00:00Z',
          (SELECT timezone FROM app.clinic WHERE id = $9)),
        $7),
       ($2, $4, $6, $8, $10, $12,
        TIMESTAMPTZ '2026-08-02T09:00:00Z', TIMESTAMPTZ '2026-08-02T09:30:00Z',
        app.local_date(TIMESTAMPTZ '2026-08-02T09:00:00Z',
          (SELECT timezone FROM app.clinic WHERE id = $10)),
        $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.SCHED_APPOINTMENT_A, F.SCHED_APPOINTMENT_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.SCHED_PROCEDURE_A, F.SCHED_PROCEDURE_B],
  );

  await admin.query(
    `INSERT INTO sched.block
       (tenant_id, id, clinic_id, starts_at, ends_at, kind, motivo, created_by) VALUES
       ($1, $3, $5,
        TIMESTAMPTZ '2026-08-02T12:00:00Z', TIMESTAMPTZ '2026-08-02T13:00:00Z',
        'almoco', 'Horario de almoco', $7),
       ($2, $4, $6,
        TIMESTAMPTZ '2026-08-02T12:00:00Z', TIMESTAMPTZ '2026-08-02T13:00:00Z',
        'almoco', 'Horario de almoco', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.SCHED_BLOCK_A, F.SCHED_BLOCK_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO sched.recurrence
       (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
        freq, first_starts_at, duracao_min, horizonte_ate, created_by) VALUES
       ($1, $3, $5, $7, $9,  $11,
        'semanal', TIMESTAMPTZ '2026-08-02T09:00:00Z', 30, DATE '2026-12-31', $7),
       ($2, $4, $6, $8, $10, $12,
        'semanal', TIMESTAMPTZ '2026-08-02T09:00:00Z', 30, DATE '2026-12-31', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.SCHED_RECURRENCE_A, F.SCHED_RECURRENCE_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.SCHED_PROCEDURE_A, F.SCHED_PROCEDURE_B],
  );

  // closed_at e close_reason preenchidos de propósito: a entrada já "saiu da fila"
  // para não interferir nos testes de 25-waitlist que criam os próprios candidatos.
  // O índice parcial ux_waitlist_ativa só cobre closed_at IS NULL.
  await admin.query(
    `INSERT INTO sched.waitlist
       (tenant_id, id, patient_id, clinic_id, procedure_id, created_by,
        closed_at, close_reason) VALUES
       ($1, $3, $5, $7, $9,  $11, clock_timestamp(), 'atendido pelo seed'),
       ($2, $4, $6, $8, $10, $12, clock_timestamp(), 'atendido pelo seed')`,
    [F.TENANT_A, F.TENANT_B,
     F.SCHED_WAITLIST_A, F.SCHED_WAITLIST_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.SCHED_PROCEDURE_A, F.SCHED_PROCEDURE_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // ── Mensageria (msg) ──────────────────────────────────────────────────────
  //
  // As tabelas msg.* nasceram na Fase 2 (Tasks do bloco 01-07). Como toda tabela
  // multi-tenant, precisam de linha do tenant B.

  await admin.query(
    `INSERT INTO msg.channel_identity
       (tenant_id, id, channel, display_name, phone, status) VALUES
       ($1, $3, 'whatsapp', 'Aurora WhatsApp', '+5511999990001', 'active'),
       ($2, $4, 'whatsapp', 'Boreal WhatsApp', '+5568999990002', 'active')`,
    [F.TENANT_A, F.TENANT_B, F.CHANNEL_A, F.CHANNEL_B],
  );

  await admin.query(
    `INSERT INTO msg.template
       (tenant_id, id, channel_identity_id, channel, name, category, status,
        body_template) VALUES
       ($1, $3, $5, 'whatsapp', 'lembrete_consulta', 'utility', 'approved',
        'Ola {{1}}, sua consulta e amanha as {{2}}.'),
       ($2, $4, $6, 'whatsapp', 'lembrete_consulta', 'utility', 'approved',
        'Ola {{1}}, sua consulta e amanha as {{2}}.')`,
    [F.TENANT_A, F.TENANT_B,
     F.MSG_TEMPLATE_A, F.MSG_TEMPLATE_B,
     F.CHANNEL_A, F.CHANNEL_B],
  );

  await admin.query(
    `INSERT INTO msg.conversation
       (tenant_id, id, channel_identity_id, patient_id, remote_phone) VALUES
       ($1, $3, $5, $7, '+5511988880001'),
       ($2, $4, $6, $8, '+5568988880002')`,
    [F.TENANT_A, F.TENANT_B,
     F.CONVERSATION_A, F.CONVERSATION_B,
     F.CHANNEL_A, F.CHANNEL_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS],
  );

  await admin.query(
    `INSERT INTO msg.message
       (tenant_id, id, conversation_id, direction, channel, body_text, status) VALUES
       ($1, $3, $5, 'outbound', 'whatsapp', 'Ola Joana, sua consulta e amanha.', 'sent'),
       ($2, $4, $6, 'outbound', 'whatsapp', 'Ola Marcos, sua consulta e amanha.', 'sent')`,
    [F.TENANT_A, F.TENANT_B,
     F.MESSAGE_A, F.MESSAGE_B,
     F.CONVERSATION_A, F.CONVERSATION_B],
  );

  await admin.query(
    `INSERT INTO msg.inbound_event
       (tenant_id, id, channel_identity_id, raw_payload) VALUES
       ($1, $3, $5, '{"type":"message","from":"+5511988880001"}'::jsonb),
       ($2, $4, $6, '{"type":"message","from":"+5568988880002"}'::jsonb)`,
    [F.TENANT_A, F.TENANT_B,
     F.INBOUND_EVENT_A, F.INBOUND_EVENT_B,
     F.CHANNEL_A, F.CHANNEL_B],
  );

  await admin.query(
    `INSERT INTO msg.automation_rule
       (tenant_id, id, channel_identity_id, trigger, template_id, channel) VALUES
       ($1, $3, $5, 'appointment_reminder', $7, 'whatsapp'),
       ($2, $4, $6, 'appointment_reminder', $8, 'whatsapp')`,
    [F.TENANT_A, F.TENANT_B,
     F.AUTOMATION_RULE_A, F.AUTOMATION_RULE_B,
     F.CHANNEL_A, F.CHANNEL_B,
     F.MSG_TEMPLATE_A, F.MSG_TEMPLATE_B],
  );

  await admin.query(
    `INSERT INTO msg.nps_response
       (tenant_id, id, patient_id, score, comment) VALUES
       ($1, $3, $5, 9, 'Excelente atendimento'),
       ($2, $4, $6, 8, 'Muito bom')`,
    [F.TENANT_A, F.TENANT_B,
     F.NPS_RESPONSE_A, F.NPS_RESPONSE_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS],
  );

  await admin.query(
    `INSERT INTO msg.sent_reminder
       (tenant_id, id, appointment_id, rule_id) VALUES
       ($1, $3, $5, $7),
       ($2, $4, $6, $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.SENT_REMINDER_A, F.SENT_REMINDER_B,
     F.SCHED_APPOINTMENT_A, F.SCHED_APPOINTMENT_B,
     F.AUTOMATION_RULE_A, F.AUTOMATION_RULE_B],
  );

  // ── Financeiro Fase 3 ─────────────────────────────────────────────────────
  //
  // As tabelas fin.* da Fase 3 (contas bancárias, centros de custo, fornecedores,
  // parcelamento, recorrência, transferência, split, repasse). Como toda tabela
  // multi-tenant, precisam de linha do tenant B.

  await admin.query(
    `INSERT INTO fin.cost_center (tenant_id, id, code, name) VALUES
       ($1, $3, 'CC-001', 'Administrativo'),
       ($2, $4, 'CC-001', 'Administrativo')`,
    [F.TENANT_A, F.TENANT_B, F.COST_CENTER_A, F.COST_CENTER_B],
  );

  await admin.query(
    `INSERT INTO fin.supplier (tenant_id, id, name) VALUES
       ($1, $3, 'Distribuidora Medicamentos Ltda'),
       ($2, $4, 'Farmaceutica Norte SA')`,
    [F.TENANT_A, F.TENANT_B, F.FIN_SUPPLIER_A, F.FIN_SUPPLIER_B],
  );

  // Segunda conta bancária por tenant (a primeira, "Caixa Geral", foi criada
  // pelo trigger de provisioning na migration 0088). Necessária para fin.transfer
  // que exige from <> to.
  await admin.query(
    `INSERT INTO fin.bank_account
       (tenant_id, id, name, bank_code, agency, account_number, account_type) VALUES
       ($1, $3, 'Conta Corrente Itau', '341', '1234', '56789-0', 'corrente'),
       ($2, $4, 'Conta Corrente Bradesco', '237', '5678', '12345-0', 'corrente')`,
    [F.TENANT_A, F.TENANT_B, F.BANK_ACCOUNT_2_A, F.BANK_ACCOUNT_2_B],
  );

  // Lançamentos extras para a transferência (débito e crédito).
  await admin.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key) VALUES
       ($1, $3, 'despesa', $7, $9,  'Transferencia saida', 5000, $11, 'pago', 'seed-xfer-debit-a'),
       ($2, $4, 'despesa', $8, $10, 'Transferencia saida', 5000, $12, 'pago', 'seed-xfer-debit-b'),
       ($1, $5, 'receita', $7, $9,  'Transferencia entrada', 5000, $11, 'pago', 'seed-xfer-credit-a'),
       ($2, $6, 'receita', $8, $10, 'Transferencia entrada', 5000, $12, 'pago', 'seed-xfer-credit-b')`,
    [F.TENANT_A, F.TENANT_B,
     F.ENTRY_XFER_DEBIT_A, F.ENTRY_XFER_DEBIT_B,
     F.ENTRY_XFER_CREDIT_A, F.ENTRY_XFER_CREDIT_B,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.PAYMENT_METHOD_A, F.PAYMENT_METHOD_B],
  );

  await admin.query(
    `INSERT INTO fin.installment_plan
       (tenant_id, id, mother_entry_id, total_installments) VALUES
       ($1, $3, $5, 3),
       ($2, $4, $6, 3)`,
    [F.TENANT_A, F.TENANT_B,
     F.INSTALLMENT_PLAN_A, F.INSTALLMENT_PLAN_B,
     F.ENTRY_A, F.ENTRY_B],
  );

  await admin.query(
    `INSERT INTO fin.recurring_template
       (tenant_id, id, description, kind, category_id, amount_cents, clinic_id,
        frequency, next_due_date) VALUES
       ($1, $3, 'Aluguel mensal', 'despesa', $5, 500000, $7,
        'monthly', DATE '2026-09-01'),
       ($2, $4, 'Aluguel mensal', 'despesa', $6, 400000, $8,
        'monthly', DATE '2026-09-01')`,
    [F.TENANT_A, F.TENANT_B,
     F.RECURRING_TEMPLATE_A, F.RECURRING_TEMPLATE_B,
     F.CATEGORY_A, F.CATEGORY_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO],
  );

  // A transferência precisa de from <> to e de dois lançamentos (débito e crédito).
  // O "Caixa Geral" (criado pelo trigger) é a origem; a segunda conta é o destino.
  // Usamos subquery para pegar o id da conta default (gen_random_uuid pelo trigger).
  await admin.query(
    `INSERT INTO fin.transfer
       (tenant_id, id, from_bank_account_id, to_bank_account_id,
        amount_cents, description, debit_entry_id, credit_entry_id) VALUES
       ($1, $3,
        (SELECT id FROM fin.bank_account WHERE tenant_id = $1 AND is_default LIMIT 1),
        $5, 5000, 'Transferencia seed', $7, $9),
       ($2, $4,
        (SELECT id FROM fin.bank_account WHERE tenant_id = $2 AND is_default LIMIT 1),
        $6, 5000, 'Transferencia seed', $8, $10)`,
    [F.TENANT_A, F.TENANT_B,
     F.TRANSFER_A, F.TRANSFER_B,
     F.BANK_ACCOUNT_2_A, F.BANK_ACCOUNT_2_B,
     F.ENTRY_XFER_DEBIT_A, F.ENTRY_XFER_DEBIT_B,
     F.ENTRY_XFER_CREDIT_A, F.ENTRY_XFER_CREDIT_B],
  );

  await admin.query(
    `INSERT INTO fin.split_rule
       (tenant_id, id, professional_id, percentage) VALUES
       ($1, $3, $5, 60.00),
       ($2, $4, $6, 55.00)`,
    [F.TENANT_A, F.TENANT_B,
     F.SPLIT_RULE_A, F.SPLIT_RULE_B,
     F.PROF_A_ANA, F.PROF_B_DIEGO],
  );

  // O trigger check_split_sum exige clinic_share + professional_share = entry.amount.
  // ENTRY_A = 25000, ENTRY_B = 30000.
  await admin.query(
    `INSERT INTO fin.split
       (tenant_id, id, entry_id, split_rule_id, professional_id,
        clinic_share_cents, professional_share_cents) VALUES
       ($1, $3, $5, $7, $9,  10000, 15000),
       ($2, $4, $6, $8, $10, 13500, 16500)`,
    [F.TENANT_A, F.TENANT_B,
     F.SPLIT_A, F.SPLIT_B,
     F.ENTRY_A, F.ENTRY_B,
     F.SPLIT_RULE_A, F.SPLIT_RULE_B,
     F.PROF_A_ANA, F.PROF_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO fin.repasse_statement
       (tenant_id, id, professional_id, clinic_id, period_start, period_end,
        total_entries, total_professional_share, total_clinic_share) VALUES
       ($1, $3, $5, $7, DATE '2026-08-01', DATE '2026-08-31', 1, 15000, 10000),
       ($2, $4, $6, $8, DATE '2026-08-01', DATE '2026-08-31', 1, 16500, 13500)`,
    [F.TENANT_A, F.TENANT_B,
     F.REPASSE_STATEMENT_A, F.REPASSE_STATEMENT_B,
     F.PROF_A_ANA, F.PROF_B_DIEGO,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO],
  );

  // ── Estoque (inv) ─────────────────────────────────────────────────────────
  //
  // As tabelas inv.* nasceram na Fase 3 (Bloco 09). Como toda tabela
  // multi-tenant, precisam de linha do tenant B.

  await admin.query(
    `INSERT INTO inv.supplier (tenant_id, id, name) VALUES
       ($1, $3, 'Distribuidora Medica Aurora'),
       ($2, $4, 'Farmacia Norte Ltda')`,
    [F.TENANT_A, F.TENANT_B, F.INV_SUPPLIER_A, F.INV_SUPPLIER_B],
  );

  await admin.query(
    `INSERT INTO inv.product
       (tenant_id, id, name, sku, unit, min_stock, supplier_id) VALUES
       ($1, $3, 'Luva descartavel M', 'LUV-M-001', 'cx', 5, $5),
       ($2, $4, 'Luva descartavel M', 'LUV-M-001', 'cx', 5, $6)`,
    [F.TENANT_A, F.TENANT_B,
     F.PRODUCT_A, F.PRODUCT_B,
     F.INV_SUPPLIER_A, F.INV_SUPPLIER_B],
  );

  // O trigger fn_update_current_stock atualiza inv.product.current_stock
  // após cada INSERT em stock_movement.
  await admin.query(
    `INSERT INTO inv.stock_movement
       (tenant_id, id, product_id, kind, quantity, reason,
        reference_type, moved_by) VALUES
       ($1, $3, $5, 'entrada', 10, 'Compra inicial', 'compra', $7),
       ($2, $4, $6, 'entrada', 10, 'Compra inicial', 'compra', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.STOCK_MOVEMENT_A, F.STOCK_MOVEMENT_B,
     F.PRODUCT_A, F.PRODUCT_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO inv.stock_alert
       (tenant_id, id, product_id, threshold) VALUES
       ($1, $3, $5, 5),
       ($2, $4, $6, 5)`,
    [F.TENANT_A, F.TENANT_B,
     F.STOCK_ALERT_A, F.STOCK_ALERT_B,
     F.PRODUCT_A, F.PRODUCT_B],
  );

  // tiss.operadora nasceu na Task 1 da Fase 4: cadastro da operadora de plano de
  // saúde por tenant. Como toda tabela multi-tenant, precisa de linha do tenant B,
  // senão o teste meta ("o seed realmente criou linha do tenant B em toda tabela
  // multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.operadora
       (tenant_id, id, registro_ans, razao_social, nome_fantasia, cnpj, created_by) VALUES
       ($1, $3, '326305', 'Operadora Meridiano Saude Ltda', 'Meridiano Saude',
        '11ABC22233DE44', $5),
       ($2, $4, '412589', 'Cooperativa Norte Saude', 'Norte Saude',
        '55XYZ66677DE88', $6)`,
    [F.TENANT_A, F.TENANT_B, F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.contrato nasceu na Task 2 da Fase 4: vínculo operadora x prestador.
  // Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO tiss.contrato
       (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora,
        vigencia_inicio, created_by) VALUES
       ($1, $3, $5, $7, '900123', DATE '2026-01-01', $9),
       ($2, $4, $6, $8, '800456', DATE '2026-01-01', $10)`,
    [F.TENANT_A, F.TENANT_B, F.CONTRATO_A, F.CONTRATO_B,
     F.OPERADORA_A, F.OPERADORA_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.paciente_convenio nasceu na Task 3 da Fase 4: vínculo paciente x operadora
  // (carteirinha). Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO tiss.paciente_convenio
       (tenant_id, id, patient_id, operadora_id, numero_carteira,
        validade, nome_plano, created_by) VALUES
       ($1, $3, $5, $7, '00998877665544', DATE '2027-12-31',
        'Meridiano Essencial', $9),
       ($2, $4, $6, $8, '11223344556677', DATE '2028-06-30',
        'Norte Basico', $10)`,
    [F.TENANT_A, F.TENANT_B, F.PACIENTE_CONVENIO_A, F.PACIENTE_CONVENIO_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.encounter_guia_consulta nasceu na Fase 4 (bloco 03, migration 0115):
  // guia de consulta TISS como projeção do atendimento. Como toda tabela
  // multi-tenant, precisa de linha do tenant B, senão o teste meta reprova e o
  // T1 passaria a toa. A inserção vai como superusuário.
  //
  // Os campos do prestador (cnes, conselho, numero, uf, cbos) vêm do
  // PROFISSIONAL e da CLÍNICA do atendimento, nunca repetidos como literal.
  // data_atendimento vem de e.occurred_date. numero_guia_prestador usa um
  // literal porque o seed não passa pela função de contador.
  await admin.query(
    `INSERT INTO tiss.encounter_guia_consulta
       (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
        registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
        codigo_prestador_na_operadora, cnes, conselho_profissional,
        numero_conselho, uf_conselho, cbos, indicacao_acidente,
        regime_atendimento, tipo_consulta, data_atendimento,
        codigo_tabela, codigo_procedimento, valor_procedimento,
        created_by)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, $7::uuid,
            '326305', '1', '00998877665544', false,
            '900123', c.cnes, p.conselho_profissional, p.numero_conselho,
            p.uf_conselho, p.cbos, '9', '01', '1', e.occurred_date,
            '22', '10101012', 250.00, $9::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $11::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, $8::uuid,
            '412589', '1', '00112233445566', false,
            '800456', c.cnes, p.conselho_profissional, p.numero_conselho,
            p.uf_conselho, p.cbos, '9', '01', '2', e.occurred_date,
            '22', '10101012', 300.00, $10::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $12::uuid`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // tiss.guia_ajuste nasceu na Fase 4 (bloco 03, migration 0116): ajuste de
  // faturamento append-only. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senão o teste meta reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.guia_ajuste
       (tenant_id, id, guia_id, campo_alterado, valor_anterior, valor_novo,
        motivo, created_by)
     VALUES
       ($1, $3, $5, 'codigo_procedimento', '10101012', '10101039',
        'Operadora usa tabela propria', $7),
       ($2, $4, $6, 'valor_procedimento', '300.00', '280.00',
        'Reajuste contratual vigente', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_AJUSTE_A, F.GUIA_AJUSTE_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.guia_counter nasceu na Fase 4 (bloco 03, migration 0117): contador de
  // numero_guia_prestador por tenant. next_value = 3 porque o seed consome DOIS
  // números: o '1' da guia de consulta e o '2' da guia SP/SADT, mais abaixo.
  await admin.query(
    `INSERT INTO tiss.guia_counter (tenant_id, next_value) VALUES
       ($1, 3),
       ($2, 3)`,
    [F.TENANT_A, F.TENANT_B],
  );

  // tiss.guia_pendencia nasceu na Fase 4 (bloco 05, migration 0120): pendência
  // criada quando guia pertence a lote já enviado e o prontuário é retificado.
  // Como toda tabela multi-tenant, precisa de linha do tenant B, senão o teste
  // meta ("o seed realmente criou linha do tenant B em toda tabela multi-tenant")
  // reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.guia_pendencia
       (tenant_id, id, guia_id, encounter_version_id, tipo)
     VALUES
       ($1, $3, $5, $7, 'reprojecao_pos_envio'),
       ($2, $4, $6, $8, 'reprojecao_pos_envio')`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_PENDENCIA_A, F.GUIA_PENDENCIA_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL],
  );

  // tiss.lote_number_counter nasceu na Fase 4 (bloco 06, migration 0121):
  // contador de número de lote por operadora. Como toda tabela multi-tenant,
  // precisa de linha do tenant B.
  //
  // next_value = 3 porque o seed consome DOIS números de lote: o '1' do lote de
  // consulta e o '2' do lote de SP/SADT, mais abaixo. Contador que não reflete o
  // que já foi gasto entrega número repetido na primeira criação real.
  await admin.query(
    `INSERT INTO tiss.lote_number_counter
       (tenant_id, operadora_id, next_value) VALUES
       ($1, $3, 3),
       ($2, $4, 3)`,
    [F.TENANT_A, F.TENANT_B, F.OPERADORA_A, F.OPERADORA_B],
  );

  // tiss.lote nasceu na Fase 4 (bloco 06, migration 0121): agrupamento de guias
  // para envio a operadora. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senão o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.lote
       (tenant_id, id, operadora_id, numero_lote, tiss_version,
        created_by) VALUES
       ($1, $3, $5, '1', '3.05', $7),
       ($2, $4, $6, '1', '3.05', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.LOTE_A, F.LOTE_B,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.lote_guia nasceu na Fase 4 (bloco 06, migration 0122): junção
  // many-to-many entre lote e guia de consulta com ordem. Como toda tabela
  // multi-tenant, precisa de linha do tenant B, senão o teste meta reprova e
  // o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.lote_guia
       (tenant_id, lote_id, guia_id, sequencial_item) VALUES
       ($1, $3, $5, 1),
       ($2, $4, $6, 1)`,
    [F.TENANT_A, F.TENANT_B,
     F.LOTE_A, F.LOTE_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B],
  );

  // ── Fase 4, blocos 07-09 — SP/SADT, retorno, glosa e recurso ─────────────
  //
  // Nove tabelas multi-tenant tinham linha do tenant A e NENHUMA do tenant B.
  // O canário de 04-t1-t2 ("o seed realmente criou linha do tenant B em toda
  // tabela multi-tenant") reprovava, e reprovava com razão: sem linha do B, o
  // T1 daquelas tabelas passava por vacuidade — não existia dado alheio para
  // vazar, então a RLS nunca chegou a ser exercitada ali. São justamente as
  // tabelas de valor a receber e de contestação de glosa.
  //
  // Onde um CHECK tem dois ramos, o seed usa um em cada tenant de propósito:
  // demonstrativo A é 'pagamento' (exige data_pagamento) e B é 'analise' (exige
  // data_pagamento nula); a guia SADT de A vai sem autorização e a de B com
  // senha e data. Assim uma linha não passa a valer pela outra.

  // tiss.encounter_guia_sadt (migration 0151): guia de serviço profissional /
  // SADT projetada do atendimento. Os dados do prestador saem da CLÍNICA e do
  // PROFISSIONAL do atendimento, nunca repetidos como literal — mesmo padrão da
  // guia de consulta.
  await admin.query(
    `INSERT INTO tiss.encounter_guia_sadt
       (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
        registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
        data_autorizacao, senha_autorizacao,
        sol_codigo_prestador, sol_nome_contratado, sol_conselho_profissional,
        sol_numero_conselho, sol_uf_conselho, sol_cbos,
        carater_atendimento, exe_codigo_prestador, exe_cnes,
        tipo_atendimento, indicacao_acidente, regime_atendimento, created_by)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, $7::uuid,
            '326305', '2', '00998877665544', false,
            NULL::date, NULL,
            '900123', c.nome, p.conselho_profissional,
            p.numero_conselho, p.uf_conselho, p.cbos,
            '1', '900123', c.cnes,
            '05', '9', '01', $9::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $11::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, $8::uuid,
            '412589', '2', '00112233445566', false,
            DATE '2026-08-01', 'AUT-778899',
            '800456', c.nome, p.conselho_profissional,
            p.numero_conselho, p.uf_conselho, p.cbos,
            '2', '800456', c.cnes,
            '05', '9', '01', $10::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $12::uuid`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_SADT_A, F.GUIA_SADT_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // tiss.encounter_guia_sadt_item (migration 0151): os procedimentos da guia
  // SADT. `codigo_tabela` nunca é '18' (CHECK): 18 é a tabela de pacotes, que
  // não se detalha item a item.
  await admin.query(
    `INSERT INTO tiss.encounter_guia_sadt_item
       (tenant_id, guia_id, sequencial_item, data_execucao, codigo_tabela,
        codigo_procedimento, descricao_procedimento, quantidade_executada,
        reducao_acrescimo, valor_unitario)
     SELECT $1::uuid, $3::uuid, 1, e.occurred_date, '22',
            '40304361', 'Hemograma completo', 1, 1.00, 35.00
       FROM clin.encounter e WHERE e.id = $5::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, 1, e.occurred_date, '22',
            '40304361', 'Hemograma completo', 1, 1.00, 42.00
       FROM clin.encounter e WHERE e.id = $6::uuid`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_SADT_A, F.GUIA_SADT_B,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // Lote SÓ de SP/SADT. Ver o comentário de LOTE_SADT_A em fixtures.ts: o XSD
  // trata `guiasTISS` como choice, então lote não mistura consulta com SADT.
  await admin.query(
    `INSERT INTO tiss.lote
       (tenant_id, id, operadora_id, numero_lote, tiss_version, created_by) VALUES
       ($1, $3, $5, '2', '3.05', $7),
       ($2, $4, $6, '2', '3.05', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.LOTE_SADT_A, F.LOTE_SADT_B,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.lote_guia_sadt (migration 0152): junção lote x guia SADT.
  await admin.query(
    `INSERT INTO tiss.lote_guia_sadt
       (tenant_id, lote_id, guia_id, sequencial_item) VALUES
       ($1, $3, $5, 1),
       ($2, $4, $6, 1)`,
    [F.TENANT_A, F.TENANT_B,
     F.LOTE_SADT_A, F.LOTE_SADT_B,
     F.GUIA_SADT_A, F.GUIA_SADT_B],
  );

  // tiss.demonstrativo (migration 0123): o retorno da operadora. O CHECK amarra
  // `kind` a `data_pagamento` — 'pagamento' exige a data, 'analise' exige nula.
  await admin.query(
    `INSERT INTO tiss.demonstrativo
       (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
        data_processamento, data_pagamento, xml_storage_key,
        total_apresentado_cents, total_processado_cents,
        total_liberado_cents, total_glosa_cents, imported_by) VALUES
       ($1, $3, $5, $7, 'PROT-2026-000123', 'pagamento',
        DATE '2026-08-05', DATE '2026-08-12', 'demonstrativos/a-000123.xml',
        25000, 25000, 20000, 5000, $9),
       ($2, $4, $6, $8, 'PROT-2026-000456', 'analise',
        DATE '2026-08-06', NULL, 'demonstrativos/b-000456.xml',
        30000, 30000, 25000, 5000, $10)`,
    [F.TENANT_A, F.TENANT_B,
     F.DEMONSTRATIVO_A, F.DEMONSTRATIVO_B,
     F.OPERADORA_A, F.OPERADORA_B,
     F.LOTE_A, F.LOTE_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.demonstrativo_item (migration 0124): a linha do demonstrativo que
  // corresponde a uma guia. `glosa_codigo` e `glosa_descricao` andam juntos —
  // o CHECK aceita os dois nulos ou os dois preenchidos, nunca um só.
  await admin.query(
    `INSERT INTO tiss.demonstrativo_item
       (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
        valor_apresentado_cents, valor_processado_cents,
        valor_liberado_cents, valor_glosa_cents,
        glosa_codigo, glosa_descricao) VALUES
       ($1, $3, $5, $7, '1', 25000, 25000, 20000, 5000,
        '1707', 'Procedimento nao coberto pelo plano contratado'),
       ($2, $4, $6, $8, '1', 30000, 30000, 25000, 5000,
        '1902', 'Falta de autorizacao previa para o procedimento')`,
    [F.TENANT_A, F.TENANT_B,
     F.DEMONSTRATIVO_ITEM_A, F.DEMONSTRATIVO_ITEM_B,
     F.DEMONSTRATIVO_A, F.DEMONSTRATIVO_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B],
  );

  // tiss.glosa (migration 0125): o valor recusado, já individualizado. Status
  // 'contestada' nos dois porque cada um recebe um recurso logo abaixo — o
  // CHECK exige resolved_at/resolved_by NULOS fora de 'aceita'/'revertida'.
  await admin.query(
    `INSERT INTO tiss.glosa
       (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
        codigo_glosa, descricao_glosa, valor_glosado_cents, status) VALUES
       ($1, $3, $5, $7, $9, '1707',
        'Procedimento nao coberto pelo plano contratado', 5000, 'contestada'),
       ($2, $4, $6, $8, $10, '1902',
        'Falta de autorizacao previa para o procedimento', 5000, 'contestada')`,
    [F.TENANT_A, F.TENANT_B,
     F.GLOSA_A, F.GLOSA_B,
     F.DEMONSTRATIVO_ITEM_A, F.DEMONSTRATIVO_ITEM_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL],
  );

  // tiss.recurso_glosa (migration 0126): a contestação. 'rascunho' satisfaz os
  // três CHECKs de estado de uma vez — sent_at, protocolo_operadora e
  // resolved_at todos nulos.
  await admin.query(
    `INSERT INTO tiss.recurso_glosa
       (tenant_id, id, operadora_id, numero_recurso, status,
        justificativa_geral, encounter_version_id,
        item_count, total_recursado_cents, created_by) VALUES
       ($1, $3, $5, '1', 'rascunho',
        'Procedimento consta no rol da ANS vigente na data do atendimento',
        $7, 1, 5000, $9),
       ($2, $4, $6, '1', 'rascunho',
        'Autorizacao previa foi concedida por telefone, protocolo em anexo',
        $8, 1, 5000, $10)`,
    [F.TENANT_A, F.TENANT_B,
     F.RECURSO_GLOSA_A, F.RECURSO_GLOSA_B,
     F.OPERADORA_A, F.OPERADORA_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.recurso_glosa_item (migration 0126): a glosa específica que o recurso
  // contesta, com o valor pedido de volta.
  await admin.query(
    `INSERT INTO tiss.recurso_glosa_item
       (tenant_id, id, recurso_id, glosa_id,
        justificativa_item, valor_recursado_cents) VALUES
       ($1, $3, $5, $7,
        'Cobertura obrigatoria conforme rol da ANS vigente', 5000),
       ($2, $4, $6, $8,
        'Autorizacao concedida sob protocolo 99887, anexado ao recurso', 5000)`,
    [F.TENANT_A, F.TENANT_B,
     F.RECURSO_GLOSA_ITEM_A, F.RECURSO_GLOSA_ITEM_B,
     F.RECURSO_GLOSA_A, F.RECURSO_GLOSA_B,
     F.GLOSA_A, F.GLOSA_B],
  );

  // tiss.recurso_number_counter (migration 0126): contador de número de recurso
  // por operadora. next_value = 2 porque o recurso '1' acima já foi consumido.
  await admin.query(
    `INSERT INTO tiss.recurso_number_counter
       (tenant_id, operadora_id, next_value) VALUES
       ($1, $3, 2),
       ($2, $4, 2)`,
    [F.TENANT_A, F.TENANT_B, F.OPERADORA_A, F.OPERADORA_B],
  );

  // Configurações e templates adicionados nas migrations 0164, 0166 e 0167.
  // O canário de isolamento precisa de uma linha real do tenant B em cada tabela
  // multi-tenant para provar que a RLS não passa por vacuidade.
  await admin.query(
    `INSERT INTO app.clinic_print_config
       (tenant_id, clinic_id, header_line1) VALUES ($1, $2, 'Clínica Rio Branco')`,
    [F.TENANT_B, F.CLINIC_B_RIO_BRANCO],
  );

  await admin.query(
    `INSERT INTO app.professional_config
       (tenant_id, professional_id, especialidade) VALUES ($1, $2, 'Clínica médica')`,
    [F.TENANT_B, F.PROF_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO clin.document_template
       (tenant_id, clinic_id, professional_id, kind, titulo, corpo) VALUES
       ($1, $2, $3, 'atestado', 'Atestado do tenant B', 'Conteúdo isolado do tenant B')`,
    [F.TENANT_B, F.CLINIC_B_RIO_BRANCO, F.PROF_B_DIEGO],
  );

  // Configuracao operacional adicionada na migration 0174. O canario descobre
  // essas tabelas pelo catalogo; por isso cada uma precisa de dado alheio real.
  await admin.query(
    `INSERT INTO app.notification
       (tenant_id, id, user_id, clinic_id, kind, title, body) VALUES
       ($1, $2, $3, $4, 'appointment_attention',
        'Notificacao do tenant B', 'Conteudo isolado do tenant B')`,
    [F.TENANT_B, F.NOTIFICATION_B, F.USER_B_DIEGO, F.CLINIC_B_RIO_BRANCO],
  );

  await admin.query(
    `INSERT INTO msg.channel_config
       (tenant_id, id, channel, status, rate_limit_per_minute) VALUES
       ($1, $2, 'whatsapp', 'active', 60)`,
    [F.TENANT_B, F.CHANNEL_CONFIG_B],
  );

  await admin.query(
    `INSERT INTO ref.action (key, description, roles)
     VALUES ('patient.read', 'Ler cadastro de paciente', ARRAY['recepcao'])`,
  );

  await admin.query(
    `INSERT INTO app.permission_override
       (tenant_id, clinic_id, role, action_key, allowed) VALUES
       ($1, $2, 'recepcao', 'patient.read', false)`,
    [F.TENANT_B, F.CLINIC_B_RIO_BRANCO],
  );

  // clin.teleconsulta nasceu na migration 0178. Como toda tabela multi-tenant,
  // precisa de linha do tenant B, senao o teste meta reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO clin.teleconsulta
       (tenant_id, id, clinic_id, appointment_id, provider, room_id, room_url) VALUES
       ($1, $3, $5, $7,  'jitsi', 'seed-room-a', 'https://meet.fake/seed-a'),
       ($2, $4, $6, $8, 'jitsi', 'seed-room-b', 'https://meet.fake/seed-b')`,
    [F.TENANT_A, F.TENANT_B,
     F.TELECONSULTA_A, F.TELECONSULTA_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.SCHED_APPOINTMENT_A, F.SCHED_APPOINTMENT_B],
  );

  // app.calendar_sync nasceu na migration 0179. Como toda tabela multi-tenant,
  // precisa de linha do tenant B, senao o teste meta reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO app.calendar_sync
       (tenant_id, id, user_id, provider) VALUES
       ($1, $3, $5, 'google'),
       ($2, $4, $6, 'google')`,
    [F.TENANT_A, F.TENANT_B,
     F.CALENDAR_SYNC_A, F.CALENDAR_SYNC_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // app.lgpd_consent e app.lgpd_data_request nasceram na migration 0181. Como
  // toda tabela multi-tenant, precisam de linha do tenant B, senao o teste meta
  // reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO app.lgpd_consent
       (tenant_id, id, patient_id, purpose, granted, granted_at, collected_by) VALUES
       ($1, $3, $5, 'marketing', true,  now(), $7),
       ($2, $4, $6, 'marketing', false, NULL,  $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.LGPD_CONSENT_A, F.LGPD_CONSENT_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO app.lgpd_data_request
       (tenant_id, id, patient_id, request_type, status, requested_by, justification) VALUES
       ($1, $3, $5, 'portabilidade', 'pendente',     $7, 'seed A'),
       ($2, $4, $6, 'acesso',        'em_andamento', $8, 'seed B')`,
    [F.TENANT_A, F.TENANT_B,
     F.LGPD_REQUEST_A, F.LGPD_REQUEST_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );
}
