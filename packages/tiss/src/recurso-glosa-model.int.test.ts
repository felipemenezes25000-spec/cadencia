// packages/tiss/src/recurso-glosa-model.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

/* ------------------------------------------------------------------ */
/* Semente para testes de recurso de glosa                            */
/* ------------------------------------------------------------------ */

interface SementeRecurso {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  guiaId: string;
  versionId: string;
  glosaId: string;
  glosaId2: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRecurso(): Promise<SementeRecurso> {
  const s: SementeRecurso = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(),
    versionId: uuidv7(),
    glosaId: uuidv7(),
    glosaId2: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Recurso Teste', '22ABC33445DE66')`,
      [s.tenantId, `rc-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Recurso', '2233445', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Recurso')`,
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
       VALUES ($1, $2, $3, '06', '223344', 'RJ', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Recurso', 'completo')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Recurso', '44XYZ00005DE05', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter finalizado + version ---
    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-07-10T10:00:00Z', DATE '2026-07-10',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('rec-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    // --- guia ---
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'RC001', '00998877665544', false,
          '900123', '2233445', '06', '223344', 'RJ', '225125', '9', '01',
          DATE '2026-07-10', '1', '22', '10101012', 250.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, s.versionId, s.operadoraId, s.userId],
    );

    // --- lote enviado ---
    const loteId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 25000,
               'lote/rec.xml', 'aabbccdd00112233aabbccdd00112233',
               'PROT-RC-001', TIMESTAMPTZ '2026-07-11T10:00:00Z', $4)`,
      [s.tenantId, loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, loteId, s.guiaId],
    );

    // --- demonstrativo + 2 itens com glosa ---
    const demoId = uuidv7();
    const demoItemId1 = uuidv7();
    const demoItemId2 = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RC-001', 'analise',
               DATE '2026-07-15', 'demonstrativo/rec.xml',
               25000, 15000, 15000, 10000, $5)`,
      [s.tenantId, demoId, s.operadoraId, loteId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, 'RC001', 15000, 10000, 10000, 5000, 'M010', 'Nao coberto'),
              ($1, $5, $3, $4, 'RC001', 10000, 5000, 5000, 5000, 'A015', 'Fora de prazo')`,
      [s.tenantId, demoItemId1, demoId, s.guiaId, demoItemId2],
    );

    // --- 2 glosas pendentes ---
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents)
       VALUES ($1, $2, $3, $6, $7, 'M010', 'Procedimento nao coberto', 5000),
              ($1, $4, $5, $6, $7, 'A015', 'Guia fora do prazo', 5000)`,
      [s.tenantId, s.glosaId, demoItemId1, s.glosaId2, demoItemId2,
       s.guiaId, s.versionId],
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

describe('modelo de dados tiss.recurso_glosa e tiss.recurso_glosa_item', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecurso();
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

  // -- Contador sequencial -------------------------------------------

  it('contador retorna 1 na primeira chamada e incrementa', async () => {
    await withTenantTx(actor, async (tx) => {
      const { rows: r1 } = await tx.query<{ next_recurso_number: string }>(
        `SELECT tiss.next_recurso_number($1, $2) AS next_recurso_number`,
        [s.tenantId, s.operadoraId],
      );
      expect(Number(r1[0]!.next_recurso_number)).toBe(1);

      const { rows: r2 } = await tx.query<{ next_recurso_number: string }>(
        `SELECT tiss.next_recurso_number($1, $2) AS next_recurso_number`,
        [s.tenantId, s.operadoraId],
      );
      expect(Number(r2[0]!.next_recurso_number)).toBe(2);
    });
  });

  // -- INSERT recurso_glosa ------------------------------------------

  it('insere recurso de glosa em rascunho', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, justificativa_geral,
            encounter_version_id, created_by)
         VALUES ($1, $2, '3', 'Procedimento esta dentro da cobertura contratual',
                 $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );

      const { rows } = await tx.query<{
        id: string;
        status: string;
        sent_at: string | null;
        protocolo_operadora: string | null;
      }>(
        `SELECT id, status, sent_at, protocolo_operadora
           FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('rascunho');
      expect(rows[0]!.sent_at).toBeNull();
      expect(rows[0]!.protocolo_operadora).toBeNull();
    });
  });

  // -- CHECK sent_at em rascunho -------------------------------------

  it('rejeita recurso rascunho com sent_at preenchido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.recurso_glosa
             (id, operadora_id, numero_recurso, encounter_version_id,
              status, sent_at, created_by)
           VALUES ($1, $2, '99', $3, 'rascunho', clock_timestamp(), $4)`,
          [uuidv7(), s.operadoraId, s.versionId, s.userId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // -- CHECK enviado sem sent_at -------------------------------------

  it('rejeita recurso enviado sem sent_at', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.recurso_glosa
             (id, operadora_id, numero_recurso, encounter_version_id,
              status, sent_at, created_by)
           VALUES ($1, $2, '98', $3, 'enviado', NULL, $4)`,
          [uuidv7(), s.operadoraId, s.versionId, s.userId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // -- UNIQUE numero_recurso por operadora ---------------------------

  it('rejeita numero_recurso duplicado na mesma operadora', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, 'UNICO01', $3, $4)`,
        [uuidv7(), s.operadoraId, s.versionId, s.userId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa
             (id, operadora_id, numero_recurso, encounter_version_id, created_by)
           VALUES ($1, $2, 'UNICO01', $3, $4)`,
          [uuidv7(), s.operadoraId, s.versionId, s.userId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  // -- INSERT recurso_glosa_item -------------------------------------

  it('insere item de recurso vinculando glosa', async () => {
    const recursoId = uuidv7();
    const itemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '4', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, 'Procedimento coberto conforme clausula 5.2 do contrato', 5000)`,
        [itemId, recursoId, s.glosaId],
      );

      const { rows } = await tx.query<{
        id: string;
        justificativa_item: string;
        valor_recursado_cents: string;
      }>(
        `SELECT id, justificativa_item, valor_recursado_cents
           FROM tiss.recurso_glosa_item WHERE id = $1`,
        [itemId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.justificativa_item).toContain('clausula 5.2');
      expect(Number(rows[0]!.valor_recursado_cents)).toBe(5000);
    });
  });

  // -- CHECK valor_recursado_cents > 0 -------------------------------

  it('rejeita item com valor_recursado_cents = 0', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '5', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'Zero', 0)`,
          [uuidv7(), recursoId, s.glosaId],
        ),
      ).rejects.toThrow(/check/i);
    });
  });

  // -- UNIQUE recurso_id + glosa_id ----------------------------------

  it('rejeita mesma glosa duplicada no mesmo recurso', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '6', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, 'Primeira inclusao', 3000)`,
        [uuidv7(), recursoId, s.glosaId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'Duplicata', 2000)`,
          [uuidv7(), recursoId, s.glosaId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  // -- FK recurso inexistente ----------------------------------------

  it('rejeita FK para recurso inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'FK invalida', 1000)`,
          [uuidv7(), uuidv7(), s.glosaId],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // -- FK glosa inexistente ------------------------------------------

  it('rejeita FK para glosa inexistente', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '7', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'FK glosa invalida', 1000)`,
          [uuidv7(), recursoId, uuidv7()],
        ),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  // -- RLS: tenant B nao ve recurso do tenant A ----------------------

  it('recurso de outro tenant e invisivel via RLS', async () => {
    const recursoId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO tiss.recurso_glosa
           (tenant_id, id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, $3, '8', $4, $5)`,
        [s.tenantId, recursoId, s.operadoraId, s.versionId, s.userId],
      );
    } finally {
      c.release();
      await admin.end();
    }

    // Cria tenant B
    const otherTenantId = uuidv7();
    const otherUserId = uuidv7();
    const otherClinicId = uuidv7();
    const admin2 = new Pool({ connectionString: adminUrl(), max: 1 });
    const c2 = await admin2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant Recurso', '88ABC77666DE55')`,
        [otherTenantId, `otr-${otherTenantId}`],
      );
      await c2.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Outra Unidade R', '8877665', 'America/Sao_Paulo')`,
        [otherTenantId, otherClinicId],
      );
      await c2.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro User Recurso')`,
        [otherUserId, `${otherUserId}@example.test`],
      );
      await c2.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenantId, otherUserId, otherClinicId],
      );
      await c2.query('COMMIT');
    } catch (e) {
      await c2.query('ROLLBACK');
      throw e;
    } finally {
      c2.release();
      await admin2.end();
    }

    const otherActor: Actor = {
      kind: 'user',
      tenantId: otherTenantId,
      userId: otherUserId,
      clinicId: otherClinicId,
      requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows).toHaveLength(0);
  });
});
