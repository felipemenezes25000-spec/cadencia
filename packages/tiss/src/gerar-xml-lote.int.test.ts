import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { gerarXmlDoLote } from './gerar-xml-lote';
import { validarContraXsdTiss } from '../test/xsd';

/**
 * O caminho inteiro: linhas do banco -> XML que o XSD OFICIAL da ANS aceita.
 *
 * Os testes de unidade do serializer provam que dados BEM FORMADOS viram XML
 * valido. Este prova o elo que faltava — que o que esta gravado nas tabelas
 * chega ao serializer na forma certa. Era exatamente aqui que a sigla 'SP' do
 * cadastro encontrava o `dm_UF` numerico da norma.
 */

interface Semente {
  tenantId: string; clinicId: string; userId: string; professionalId: string;
  patientId: string; operadoraId: string;
  encounterId: string; versionId: string;
  loteConsultaId: string; loteSadtId: string;
  guiaConsultaId: string; guiaSadtId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), operadoraId: uuidv7(),
    encounterId: uuidv7(), versionId: uuidv7(),
    loteConsultaId: uuidv7(), loteSadtId: uuidv7(),
    guiaConsultaId: uuidv7(), guiaSadtId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica XML', '11ABC22334DE55')`,
      [s.tenantId, `x-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade XML', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dra XML')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES ($1, $2, 'Paciente XML')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora XML', '99XYZ00001DE01', '4.03.00', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId]);
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('xml-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, s.encounterId, s.userId, s.professionalId]);

    // Guia de consulta. `uf_conselho` guarda a SIGLA, como o cadastro real.
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          cnpj_contratado, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, observacao, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', '00000000000000000001',
               '12345678901234567', false, '99XYZ00001DE01', '1112233',
               '06', '123456', 'SP', '225125', '9', '01',
               DATE '2026-08-09', '1', '22', '10101012', 150.00,
               'Paciente com pressão elevada', $6)`,
      [s.tenantId, s.guiaConsultaId, s.encounterId, s.versionId, s.operadoraId,
       s.userId]);

    // Guia SP/SADT com dois itens.
    await c.query(
      `INSERT INTO tiss.encounter_guia_sadt
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          sol_cnpj_contratado, sol_nome_contratado, sol_conselho_profissional,
          sol_numero_conselho, sol_uf_conselho, sol_cbos, carater_atendimento,
          exe_cnpj_contratado, exe_cnes, tipo_atendimento, indicacao_acidente,
          regime_atendimento, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', '00000000000000000900',
               '12345678901234567', false, '99XYZ00001DE01',
               'Clinica XML Unidade Centro', '06', '123456', 'SP', '225125',
               '1', '99XYZ00001DE01', '1112233', '04', '9', '01', $6)`,
      [s.tenantId, s.guiaSadtId, s.encounterId, s.versionId, s.operadoraId,
       s.userId]);
    await c.query(
      `INSERT INTO tiss.encounter_guia_sadt_item
         (tenant_id, guia_id, sequencial_item, data_execucao, codigo_tabela,
          codigo_procedimento, descricao_procedimento, quantidade_executada,
          reducao_acrescimo, valor_unitario)
       VALUES ($1, $2, 1, DATE '2026-08-09', '22', '40304361',
               'Hemograma completo', 2, 1.00, 45.00),
              ($1, $2, 2, DATE '2026-08-09', '22', '40302040',
               'Glicemia de jejum', 1, 1.00, 30.00)`,
      [s.tenantId, s.guiaSadtId]);

    for (const [loteId, guiaId, numero, vinculo] of [
      [s.loteConsultaId, s.guiaConsultaId, '000000000001', 'tiss.lote_guia'],
      [s.loteSadtId, s.guiaSadtId, '000000000002', 'tiss.lote_guia_sadt'],
    ] as const) {
      await c.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, $4, 'rascunho', '4.03.00', 1, 0, $5)`,
        [s.tenantId, loteId, s.operadoraId, numero, s.userId]);
      // Tabela de vinculo por TIPO: a de consulta tem FK para a guia de
      // consulta, a de SADT para a de SADT. Lote misto nao existe.
      await c.query(
        `INSERT INTO ${vinculo} (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s.tenantId, loteId, guiaId]);
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

describe('gerarXmlDoLote', () => {
  let s: Semente;
  let actor: Actor;

  beforeAll(async () => {
    s = await semear();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => { await closePools(); });

  it('lote de consulta sai do banco ja valido pelo XSD da ANS', async () => {
    const r = await withTenantTx(actor, (tx) => gerarXmlDoLote(tx, s.loteConsultaId));
    expect(r.tipo).toBe('consulta');
    expect(r.quantidadeDeGuias).toBe(1);

    const v = validarContraXsdTiss(r.xml);
    expect(v.erros.join('\n')).toBe('');
    expect(v.valido).toBe(true);
  });

  it('a sigla do cadastro vira codigo IBGE no XML', async () => {
    const r = await withTenantTx(actor, (tx) => gerarXmlDoLote(tx, s.loteConsultaId));
    const texto = new TextDecoder('iso-8859-1').decode(r.xml);
    // O banco guarda 'SP'; a norma exige '35'. Sem a traducao no carregador, a
    // operadora recusaria o lote inteiro — e o teste de unidade do serializer
    // nao pegaria, porque ele ja recebe o valor pronto.
    expect(texto).toContain('<ans:UF>35</ans:UF>');
    expect(texto).not.toContain('<ans:UF>SP</ans:UF>');
  });

  it('acento gravado no banco chega intacto em ISO-8859-1', async () => {
    const r = await withTenantTx(actor, (tx) => gerarXmlDoLote(tx, s.loteConsultaId));
    expect(r.warnings).toEqual([]);
    const texto = new TextDecoder('iso-8859-1').decode(r.xml);
    expect(texto).toContain('pressão elevada');
  });

  it('lote SP/SADT sai valido e soma os itens do banco', async () => {
    const r = await withTenantTx(actor, (tx) => gerarXmlDoLote(tx, s.loteSadtId));
    expect(r.tipo).toBe('sadt');

    const v = validarContraXsdTiss(r.xml);
    expect(v.erros.join('\n')).toBe('');

    const texto = new TextDecoder('iso-8859-1').decode(r.xml);
    // 2 x 45,00 + 1 x 30,00 = 120,00, somado a partir das linhas gravadas.
    expect(texto).toContain('<ans:valorTotalGeral>120.00</ans:valorTotalGeral>');
    expect(texto).toContain('<ans:descricaoProcedimento>Hemograma completo</ans:descricaoProcedimento>');
  });

  it('lote sem guia recusa em vez de emitir envelope vazio', async () => {
    const vazioId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000000000009', 'rascunho', '4.03.00', 0, 0, $4)`,
        [s.tenantId, vazioId, s.operadoraId, s.userId]);
    });
    // Lote vazio e ACEITO pela operadora e nao paga nada — parece sucesso ate o
    // demonstrativo chegar zerado semanas depois.
    await expect(withTenantTx(actor, (tx) => gerarXmlDoLote(tx, vazioId)))
      .rejects.toThrow(/lote_sem_guias/);
  });
});
