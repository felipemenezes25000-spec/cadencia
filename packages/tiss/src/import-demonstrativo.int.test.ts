import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { importDemonstrativo } from './import-demonstrativo';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent } from './lote-lifecycle';

interface SementeImport {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  guiaId: string;
  guiaNumero: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearImport(): Promise<SementeImport> {
  const s: SementeImport = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(),
    guiaNumero: `IMP-${uuidv7().slice(0, 10)}`,
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Import Demo', '55ABC66778DE99')`,
      [s.tenantId, `imp-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Import', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Import')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    const profId = uuidv7();
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '445566', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Import', 'completo')`,
      [s.tenantId, patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Import', '88XYZ00002DE02', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    const encId = uuidv7();
    const verId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T10:00:00Z', DATE '2026-08-01')`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('imp1'::bytea), 'jcs-1')`,
      [s.tenantId, verId, encId, s.userId, profId],
    );
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
          '900123', '5566778', '06', '445566', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $7)`,
      [s.tenantId, s.guiaId, encId, verId, s.operadoraId, s.guiaNumero, s.userId],
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

describe('importacao de demonstrativo TISS', () => {
  let s: SementeImport;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearImport();
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

  it('importa demonstrativo vinculado a lote e transita lote para retornado', async () => {
    // Cria lote, adiciona guia, marca pronto, marca enviado
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;
    const loteId = lote.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaId }),
    );
    await withTenantTx(actor, (tx) => markLoteReady(tx, loteId));
    await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-IMP-001',
        xmlStorageKey: 'lote/imp.xml',
        xmlHashMd5: 'aabbccddee0011223344556677889900',
      }),
    );

    // Importa demonstrativo
    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId,
        protocoloOperadora: 'PROT-IMP-001',
        kind: 'analise',
        dataProcessamento: '2026-08-05',
        xmlStorageKey: 'demonstrativo/2026/08/imp.xml',
        totalApresentadoCents: 25000,
        totalProcessadoCents: 24000,
        totalLiberadoCents: 24000,
        totalGlosaCents: 1000,
        importedBy: s.userId,
        items: [
          {
            guiaId: s.guiaId,
            numeroGuiaPrestador: s.guiaNumero,
            valorApresentadoCents: 25000,
            valorProcessadoCents: 24000,
            valorLiberadoCents: 24000,
            valorGlosaCents: 1000,
            glosaCodigo: 'M010',
            glosaDescricao: 'Procedimento nao coberto',
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.demonstrativoId).toBeTruthy();
    expect(result.value.loteRetornado).toBe(true);

    // Verifica que o lote transitou para retornado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`,
        [loteId],
      ),
    );
    expect(rows[0]!.status).toBe('retornado');
  });

  it('importa demonstrativo avulso sem transitar lote', async () => {
    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId: null,
        protocoloOperadora: 'PROT-AVULSO-IMP',
        kind: 'analise',
        dataProcessamento: '2026-08-06',
        xmlStorageKey: 'demonstrativo/2026/08/avulso-imp.xml',
        totalApresentadoCents: 10000,
        totalProcessadoCents: 9000,
        totalLiberadoCents: 9000,
        totalGlosaCents: 1000,
        importedBy: s.userId,
        items: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loteRetornado).toBe(false);
  });

  it('recusa importacao quando lote nao esta em status enviado', async () => {
    // Cria lote em rascunho (sem enviar)
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId: lote.value.loteId,
        protocoloOperadora: 'PROT-FAIL',
        kind: 'analise',
        dataProcessamento: '2026-08-07',
        xmlStorageKey: 'demonstrativo/2026/08/fail.xml',
        totalApresentadoCents: 5000,
        totalProcessadoCents: 5000,
        totalLiberadoCents: 5000,
        totalGlosaCents: 0,
        importedBy: s.userId,
        items: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_nao_enviado');
  });
});
