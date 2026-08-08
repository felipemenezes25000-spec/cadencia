// packages/tiss/src/resolve-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveRecurso } from './resolve-recurso';

/* ------------------------------------------------------------------ */
/* Semente para testes de resolucao de recurso                        */
/* ------------------------------------------------------------------ */

interface SementeResolve {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  versionId: string;
  glosaIdA: string;
  glosaIdB: string;
  glosaIdC: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearResolve(): Promise<SementeResolve> {
  const s: SementeResolve = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    versionId: uuidv7(),
    glosaIdA: uuidv7(),
    glosaIdB: uuidv7(),
    glosaIdC: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Resolve', '55ABC66778DE99')`,
      [s.tenantId, `rv-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Resolve', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Resolve')`,
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
       VALUES ($1, $2, $3, '06', '556677', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Resolve', 'completo')`,
      [s.tenantId, patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Resolve', '77XYZ00006DE06', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter + version ---
    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-07-01T10:00:00Z', DATE '2026-07-01',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('resolve-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    // --- guia ---
    const guiaId = uuidv7();
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'RV001', '00998877665544', false,
          '900123', '5566778', '06', '556677', 'SP', '225125', '9', '01',
          DATE '2026-07-01', '1', '22', '10101012', 300.00, true, $6)`,
      [s.tenantId, guiaId, encId, s.versionId, s.operadoraId, s.userId],
    );

    // --- lote + demonstrativo + 3 itens + 3 glosas ---
    const loteId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 30000,
               'lote/rv.xml', 'aabbccdd00112233aabbccdd00112233',
               'PROT-RV', TIMESTAMPTZ '2026-07-02T10:00:00Z', $4)`,
      [s.tenantId, loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, loteId, guiaId],
    );

    const demoId = uuidv7();
    const diA = uuidv7();
    const diB = uuidv7();
    const diC = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RV', 'analise',
               DATE '2026-07-10', 'demo/rv.xml',
               30000, 15000, 15000, 15000, $5)`,
      [s.tenantId, demoId, s.operadoraId, loteId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $5, $6, 'RV001', 10000, 5000, 5000, 5000, 'M010', 'Nao coberto'),
              ($1, $3, $5, $6, 'RV001', 10000, 5000, 5000, 5000, 'A015', 'Fora de prazo'),
              ($1, $4, $5, $6, 'RV001', 10000, 5000, 5000, 5000, 'B001', 'Duplicidade')`,
      [s.tenantId, diA, diB, diC, demoId, guiaId],
    );

    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents)
       VALUES ($1, $2, $5, $8, $9, 'M010', 'Nao coberto', 5000),
              ($1, $3, $6, $8, $9, 'A015', 'Fora de prazo', 5000),
              ($1, $4, $7, $8, $9, 'B001', 'Duplicidade', 5000)`,
      [s.tenantId, s.glosaIdA, s.glosaIdB, s.glosaIdC,
       diA, diB, diC, guiaId, s.versionId],
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

/* ------------------------------------------------------------------ */
/* Funcao auxiliar: cria recurso enviado com itens                     */
/* ------------------------------------------------------------------ */

async function criarRecursoEnviado(
  actor: Actor,
  s: SementeResolve,
  glosaIds: string[],
  numero: string,
): Promise<string> {
  const recursoId = uuidv7();
  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO tiss.recurso_glosa
         (id, operadora_id, numero_recurso, justificativa_geral,
          encounter_version_id, status, protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, 'Justificativa geral do recurso',
               $4, 'enviado', 'PROT-REC-001', clock_timestamp(), $5)`,
      [recursoId, s.operadoraId, numero, s.versionId, s.userId],
    );
    for (let i = 0; i < glosaIds.length; i++) {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, $4, 5000)`,
        [uuidv7(), recursoId, glosaIds[i], `Justificativa item ${i + 1}`],
      );
    }
    // Marca glosas como contestada
    for (const glosaId of glosaIds) {
      await tx.query(
        `UPDATE tiss.glosa SET status = 'contestada' WHERE id = $1`,
        [glosaId],
      );
    }
  });
  return recursoId;
}

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('resolveRecurso — transicao de status das glosas', () => {
  let s: SementeResolve;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearResolve();
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

  it('deferido — todas as glosas vinculadas transitam para revertida', async () => {
    const recursoId = await criarRecursoEnviado(
      actor, s, [s.glosaIdA, s.glosaIdB], 'DEF01',
    );

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(r.ok).toBe(true);

    // Verifica status do recurso
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('deferido');
    });

    // Verifica status das glosas
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        status: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `SELECT id, status, resolved_at, resolved_by FROM tiss.glosa
          WHERE id IN ($1, $2) ORDER BY id`,
        [s.glosaIdA, s.glosaIdB],
      );
      for (const row of rows) {
        expect(row.status).toBe('revertida');
        expect(row.resolved_at).not.toBeNull();
        expect(row.resolved_by).toBe(s.userId);
      }
    });
  });

  it('indeferido — todas as glosas vinculadas transitam para aceita', async () => {
    // Precisa de novas glosas para este teste (as anteriores ja foram resolvidas)
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    const glosaD = uuidv7();
    const glosaE = uuidv7();
    const diD = uuidv7();
    const diE = uuidv7();
    try {
      // Reusar a guia existente para FK; criar novos demonstrativo_items e glosas
      // Buscar guia_id existente do tenant
      const { rows: guiaRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingGuiaId = guiaRows[0]!.id;

      // Buscar demonstrativo existente
      const { rows: demoRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.demonstrativo WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingDemoId = demoRows[0]!.id;

      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $4, $5, 'RV001', 8000, 3000, 3000, 5000, 'X001', 'Motivo D'),
                ($1, $3, $4, $5, 'RV001', 8000, 3000, 3000, 5000, 'X002', 'Motivo E')`,
        [s.tenantId, diD, diE, existingDemoId, existingGuiaId],
      );
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $4, $6, $7, 'X001', 'Motivo D', 5000),
                ($1, $3, $5, $6, $7, 'X002', 'Motivo E', 5000)`,
        [s.tenantId, glosaD, glosaE, diD, diE, existingGuiaId, s.versionId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const recursoId = await criarRecursoEnviado(
      actor, s, [glosaD, glosaE], 'IND01',
    );

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'indeferido' }, s.userId),
    );
    expect(r.ok).toBe(true);

    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('indeferido');
    });

    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id IN ($1, $2) ORDER BY id`,
        [glosaD, glosaE],
      );
      for (const row of rows) {
        expect(row.status).toBe('aceita');
      }
    });
  });

  it('parcial — cada glosa marcada individualmente', async () => {
    // Reusar glosaIdC que ainda esta pendente
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    const glosaF = uuidv7();
    const diF = uuidv7();
    try {
      const { rows: guiaRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingGuiaId = guiaRows[0]!.id;
      const { rows: demoRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.demonstrativo WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingDemoId = demoRows[0]!.id;

      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, $4, 'RV001', 6000, 2000, 2000, 4000, 'Y001', 'Motivo F')`,
        [s.tenantId, diF, existingDemoId, existingGuiaId],
      );
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, $5, 'Y001', 'Motivo F', 4000)`,
        [s.tenantId, glosaF, diF, existingGuiaId, s.versionId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const recursoId = await criarRecursoEnviado(
      actor, s, [s.glosaIdC, glosaF], 'PAR01',
    );

    // Buscar os item ids
    const itemIds = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string; glosa_id: string }>(
        `SELECT id, glosa_id FROM tiss.recurso_glosa_item
          WHERE recurso_id = $1 ORDER BY glosa_id`,
        [recursoId],
      );
      return rows;
    });

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(
        tx,
        recursoId,
        {
          resultado: 'parcial',
          itens: [
            { recursoItemId: itemIds.find((i) => i.glosa_id === s.glosaIdC)!.id, deferido: true },
            { recursoItemId: itemIds.find((i) => i.glosa_id === glosaF)!.id, deferido: false },
          ],
        },
        s.userId,
      ),
    );
    expect(r.ok).toBe(true);

    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('parcial');
    });

    // glosaIdC deferida -> revertida
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id = $1`,
        [s.glosaIdC],
      );
      expect(rows[0]!.status).toBe('revertida');
    });

    // glosaF indeferida -> aceita
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id = $1`,
        [glosaF],
      );
      expect(rows[0]!.status).toBe('aceita');
    });
  });

  it('retorna erro para recurso nao encontrado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, uuidv7(), { resultado: 'deferido' }, s.userId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('recurso_nao_encontrado');
  });

  it('retorna erro para recurso que nao esta em status enviado', async () => {
    // Criar recurso em rascunho (nao enviado)
    const recursoId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, 'RASC01', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      ),
    );

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('transicao_invalida');
  });
});
