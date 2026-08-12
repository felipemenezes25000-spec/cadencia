// packages/tiss/src/glosa-lifecycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveRecurso } from './resolve-recurso';

/* ------------------------------------------------------------------ */
/* Semente para teste de ciclo completo                               */
/* ------------------------------------------------------------------ */

interface SementeCiclo {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  versionId: string;
  guiaId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCiclo(): Promise<SementeCiclo> {
  const s: SementeCiclo = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    versionId: uuidv7(),
    guiaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Ciclo Glosa', '44ABC55667DE88')`,
      [s.tenantId, `cg-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ciclo', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Ciclo')`,
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
       VALUES ($1, $2, $3, '06', '667788', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Ciclo', 'completo')`,
      [s.tenantId, patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Ciclo', '99XYZ00007DE07', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-06-15T10:00:00Z', DATE '2026-06-15',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('ciclo-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'CG001', '00998877665544', false,
          '900123', '4455667', '06', '667788', 'SP', '225125', '9', '01',
          DATE '2026-06-15', '1', '22', '10101012', 300.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, s.versionId, s.operadoraId, s.userId],
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
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('ciclo completo: demonstrativo -> glosa -> recurso -> resolucao', () => {
  let s: SementeCiclo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearCiclo();
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

  it('ciclo: lote enviado -> demonstrativo importado -> glosa criada -> recurso -> deferido -> glosa revertida', async () => {
    // 1. Criar lote enviado
    const loteId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
            protocolo_operadora, sent_at, created_by)
         VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 30000,
                 'lote/ciclo.xml', 'aabbccdd00112233aabbccdd00112233',
                 'PROT-CG', TIMESTAMPTZ '2026-06-16T10:00:00Z', $4)`,
        [s.tenantId, loteId, s.operadoraId, s.userId],
      );
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s.tenantId, loteId, s.guiaId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    // 2. Importar demonstrativo com glosa
    const demoId = uuidv7();
    const demoItemId = uuidv7();
    const glosaId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-CG', 'analise',
                 DATE '2026-06-25', 'demo/ciclo.xml',
                 30000, 23000, 23000, 7000, $4)`,
        [demoId, s.operadoraId, loteId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.demonstrativo_item
           (id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, 'CG001',
                 30000, 23000, 23000, 7000,
                 'M010', 'Procedimento nao coberto pelo contrato')`,
        [demoItemId, demoId, s.guiaId],
      );
    });

    // 3. Criar glosa a partir do demonstrativo_item
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.glosa
           (id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, 'M010', 'Procedimento nao coberto', 7000)`,
        [glosaId, demoItemId, s.guiaId, s.versionId],
      );
    });

    // Verificar que a glosa está pendente
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      expect(rows[0]!.status).toBe('pendente');
    });

    // 4. Criar recurso de glosa e marcar como enviado
    const recursoId = uuidv7();
    const recursoItemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, justificativa_geral,
            encounter_version_id, status, protocolo_operadora, sent_at, created_by)
         VALUES ($1, $2, '1', 'Procedimento esta coberto pelo contrato vigente',
                 $3, 'enviado', 'PROT-REC-CG', clock_timestamp(), $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, 'Conforme clausula 3.1 do contrato 2026', 7000)`,
        [recursoItemId, recursoId, glosaId],
      );
      // Atualizar glosa para contestada
      await tx.query(
        `UPDATE tiss.glosa SET status = 'contestada' WHERE id = $1`,
        [glosaId],
      );
    });

    // 5. Resolver recurso como deferido
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(resolveResult.ok).toBe(true);

    // 6. Verificar que o recurso está deferido
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('deferido');
    });

    // 7. Verificar que a glosa transitou para revertida
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `SELECT status, resolved_at, resolved_by FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      expect(rows[0]!.status).toBe('revertida');
      expect(rows[0]!.resolved_at).not.toBeNull();
      expect(rows[0]!.resolved_by).toBe(s.userId);
    });
  });
});
