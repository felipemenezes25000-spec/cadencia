// packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import { importDemonstrativo } from './import-demonstrativo';

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------

interface SementeDemonstrativo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  loteId: string;
  guiaIds: string[];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearDemonstrativo(): Promise<SementeDemonstrativo> {
  const s: SementeDemonstrativo = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- Infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Demo', '77ABC88899DE00')`,
      [s.tenantId, `demo-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Demo', '7788990', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Admin Demo')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Demo', 'completo')`,
      [s.tenantId, s.patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Demo', '66XYZ00005DE05', '4.01', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- 3 encounters com guias (numero_guia_prestador CY-001, CY-002, CY-003) ---
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id,
            occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}',
                 'finalizado'::clin.encounter_status)`,
        [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId],
      );
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, s.professionalId, `demo-${idx}`],
      );
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes,
            conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00112233445566', false,
                '900123', '7788990', '06', '777888', 'SP', '225125', '9', '01',
                DATE '2026-08-${dia}', '1', '22', '10101012',
                ${(idx + 1) * 100}.00, true, $7)`,
        [
          s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
          `CY-${String(idx + 1).padStart(3, '0')}`, s.userId,
        ],
      );
    }

    // --- Lote em status 'enviado' com as 3 guias ---
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, protocolo_operadora, sent_at,
          xml_storage_key, xml_hash_md5, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '4.01', 3, 60000,
               'PROT-001', clock_timestamp(),
               'lote/demo/001.xml', 'aabbccddaabbccddaabbccddaabbccdd', $4)`,
      [s.tenantId, s.loteId, s.operadoraId, s.userId],
    );
    for (let idx = 0; idx < 3; idx++) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.loteId, s.guiaIds[idx], idx + 1],
      );
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

// ---------------------------------------------------------------------------
// Fixture XML de demonstrativo (3 guias: paga, glosa parcial, glosa total)
// ---------------------------------------------------------------------------

const DEMONSTRATIVO_XML = [
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
  '<ans:cabecalho>',
  '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
  '<ans:registroANS>999999</ans:registroANS>',
  '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
  '<ans:horaGeracao>10:30:00</ans:horaGeracao>',
  '<ans:sequencialTransacao>999</ans:sequencialTransacao>',
  '</ans:cabecalho>',
  '<ans:operadoraParaPrestador>',
  '<ans:demonstrativoAnaliseConta>',
  '<ans:cabecalhoDemonstrativo>',
  '<ans:registroANS>326305</ans:registroANS>',
  '<ans:numeroDemonstrativo>DEMO-INT-001</ans:numeroDemonstrativo>',
  '</ans:cabecalhoDemonstrativo>',
  '<ans:dadosProtocolo>',
  '<ans:numeroProtocolo>PROT-001</ans:numeroProtocolo>',
  '</ans:dadosProtocolo>',
  '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
  '<ans:relacaoGuias>',
  // Guia CY-001: paga integralmente (R$ 100,00)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-001</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>100.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>100.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
  '</ans:guiaCabecalho>',
  // Guia CY-002: glosa parcial (R$ 50 de R$ 200)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-002</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>200.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>150.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>150.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>A010</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Valor acima do autorizado</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  // Guia CY-003: glosa total (R$ 300)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-003</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>300.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>300.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>B015</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Procedimento nao coberto</ans:descricaoGlosa>',
  '</ans:glosa>',
  '<ans:glosa>',
  '<ans:codigoGlosa>C020</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Guia vencida</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  '</ans:relacaoGuias>',
  '</ans:demonstrativoAnaliseConta>',
  '</ans:operadoraParaPrestador>',
  '<ans:epilogo><ans:hash>abc</ans:hash></ans:epilogo>',
  '</ans:mensagemTISS>',
].join('\n');

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('importDemonstrativo', () => {
  let s: SementeDemonstrativo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearDemonstrativo();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('importa demonstrativo com 3 guias, vincula guias e transiciona lote para retornado', async () => {
    const xmlBytes = encodeIso8859(DEMONSTRATIVO_XML).bytes;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(
        tx,
        { xml: xmlBytes, operadoraId: s.operadoraId, xmlStorageKey: 'demo/int-001.xml', loteId: s.loteId },
        s.userId,
      ),
    );

    // Resultado de sucesso
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(3);
    expect(result.value.matchedCount).toBe(3);
    expect(result.value.totalGlosaCents).toBe(35000); // 0 + 5000 + 30000

    const demoId = result.value.demonstrativoId;

    // --- Verificar tiss.demonstrativo (colunas canonicas do bloco 01) ---
    const demoRow = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        lote_id: string;
        protocolo_operadora: string;
        kind: string;
        total_apresentado_cents: string;
        total_processado_cents: string;
        total_liberado_cents: string;
        total_glosa_cents: string;
      }>(
        `SELECT id, lote_id, protocolo_operadora, kind,
                total_apresentado_cents, total_processado_cents,
                total_liberado_cents, total_glosa_cents
           FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      return rows[0];
    });

    expect(demoRow).toBeDefined();
    expect(demoRow!.lote_id).toBe(s.loteId);
    expect(demoRow!.protocolo_operadora).toBe('PROT-001');
    expect(demoRow!.kind).toBe('analise');
    expect(Number(demoRow!.total_apresentado_cents)).toBe(60000);
    expect(Number(demoRow!.total_processado_cents)).toBe(25000);
    expect(Number(demoRow!.total_glosa_cents)).toBe(35000);

    // --- Verificar tiss.demonstrativo_item (colunas canonicas do bloco 01) ---
    const items = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        guia_id: string | null;
        numero_guia_prestador: string;
        valor_apresentado_cents: string;
        valor_processado_cents: string;
        valor_glosa_cents: string;
        glosa_codigo: string | null;
        glosa_descricao: string | null;
      }>(
        `SELECT guia_id, numero_guia_prestador, valor_apresentado_cents,
                valor_processado_cents, valor_glosa_cents,
                glosa_codigo, glosa_descricao
           FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1
          ORDER BY numero_guia_prestador`,
        [demoId],
      );
      return rows;
    });

    expect(items).toHaveLength(3);

    // CY-001: paga, sem glosa, vinculada
    expect(items[0]!.numero_guia_prestador).toBe('CY-001');
    expect(items[0]!.guia_id).toBe(s.guiaIds[0]);
    expect(Number(items[0]!.valor_apresentado_cents)).toBe(10000);
    expect(Number(items[0]!.valor_glosa_cents)).toBe(0);
    expect(items[0]!.glosa_codigo).toBeNull();

    // CY-002: glosa parcial, vinculada (primeiro codigo de glosa armazenado)
    expect(items[1]!.numero_guia_prestador).toBe('CY-002');
    expect(items[1]!.guia_id).toBe(s.guiaIds[1]);
    expect(Number(items[1]!.valor_apresentado_cents)).toBe(20000);
    expect(Number(items[1]!.valor_processado_cents)).toBe(15000);
    expect(Number(items[1]!.valor_glosa_cents)).toBe(5000);
    expect(items[1]!.glosa_codigo).toBe('A010');
    expect(items[1]!.glosa_descricao).toBe('Valor acima do autorizado');

    // CY-003: glosa total, vinculada (primeiro codigo de glosa armazenado)
    expect(items[2]!.numero_guia_prestador).toBe('CY-003');
    expect(items[2]!.guia_id).toBe(s.guiaIds[2]);
    expect(Number(items[2]!.valor_apresentado_cents)).toBe(30000);
    expect(Number(items[2]!.valor_processado_cents)).toBe(0);
    expect(Number(items[2]!.valor_glosa_cents)).toBe(30000);
    expect(items[2]!.glosa_codigo).toBe('B015');
    expect(items[2]!.glosa_descricao).toBe('Procedimento nao coberto');

    // --- Verificar transicao do lote para 'retornado' ---
    const loteStatus = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`,
        [s.loteId],
      );
      return rows[0]!.status;
    });

    expect(loteStatus).toBe('retornado');
  });

  it('importa demonstrativo sem loteId e nao altera nenhum lote', async () => {
    // Cria XML com guia que NAO existe no banco (sem vinculo)
    const xmlOrfa = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-06</ans:dataGeracao>',
      '<ans:horaGeracao>11:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>2</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>DEMO-ORFA</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-ORFA</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-06</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>INEXISTENTE-999</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>500.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>500.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>orfa</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const xmlBytes = encodeIso8859(xmlOrfa).bytes;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, { xml: xmlBytes, operadoraId: s.operadoraId, xmlStorageKey: 'demo/orfa.xml' }, s.userId),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(1);
    expect(result.value.matchedCount).toBe(0); // guia nao encontrada
    expect(result.value.totalGlosaCents).toBe(50000);

    // Item inserido com guia_id NULL
    const items = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ guia_id: string | null }>(
        `SELECT guia_id FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1`,
        [result.value.demonstrativoId],
      );
      return rows;
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.guia_id).toBeNull();
  });

  it('retorna erro xml_invalido para XML malformado', async () => {
    const xmlInvalido = new TextEncoder().encode('isso nao e xml');

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, { xml: xmlInvalido, operadoraId: s.operadoraId, xmlStorageKey: 'demo/invalid.xml' }, s.userId),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('xml_invalido');
  });
});
