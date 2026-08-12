// packages/tiss/src/demonstrativo.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

/* ------------------------------------------------------------------ */
/* Semente mínima para demonstrativo                                  */
/* ------------------------------------------------------------------ */

interface SementeDemonstrativo {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  loteId: string;
  guiaId: string;
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
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    guiaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clínica, usuário, membership ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Demonstrativo', '44ABC55667DE88')`,
      [s.tenantId, `demo-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Demo', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Demo')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Demo', '77XYZ00001DE01', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter + version + guia (mínimo para FK) ---
    const encId = uuidv7();
    const verId = uuidv7();
    const profId = uuidv7();

    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '112233', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, gen_random_uuid(), 'Paciente Demo', 'completo')`,
      [s.tenantId],
    );
    // Precisamos do patient_id real
    const { rows: patRows } = await c.query<{ id: string }>(
      `SELECT id FROM clin.patient WHERE tenant_id = $1 LIMIT 1`,
      [s.tenantId],
    );
    const patientId = patRows[0]!.id;

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
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('demo1'::bytea), 'jcs-1')`,
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
       VALUES ($1, $2, $3, $4, $5, '326305', 'DM001', '00998877665544', false,
          '900123', '4455667', '06', '112233', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, verId, s.operadoraId, s.userId],
    );

    // --- lote enviado (pré-requisito para vincular demonstrativo) ---
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 25000,
               'lote/demo.xml', '01234567890123456789012345678901',
               'PROT-DEMO-001', TIMESTAMPTZ '2026-08-02T10:00:00Z', $4)`,
      [s.tenantId, s.loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, s.loteId, s.guiaId],
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

describe('modelo de dados do demonstrativo TISS', () => {
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

  // ── INSERT demonstrativo ────────────────────────────────────────────

  it('insere demonstrativo de analise vinculado a lote', async () => {
    const demoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'analise',
                 DATE '2026-08-05', 'demonstrativo/2026/08/demo-analise.xml',
                 25000, 24000, 24000, 1000, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      const { rows } = await tx.query<{
        id: string;
        kind: string;
        total_glosa_cents: string;
        data_pagamento: string | null;
      }>(
        `SELECT id, kind, total_glosa_cents, data_pagamento
           FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('analise');
      expect(Number(rows[0]!.total_glosa_cents)).toBe(1000);
      expect(rows[0]!.data_pagamento).toBeNull();
    });
  });

  it('insere demonstrativo de pagamento com data_pagamento', async () => {
    const demoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, data_pagamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'pagamento',
                 DATE '2026-08-10', DATE '2026-08-15',
                 'demonstrativo/2026/08/demo-pag.xml',
                 25000, 25000, 25000, 0, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      const { rows } = await tx.query<{
        kind: string;
        data_pagamento: string;
      }>(
        `SELECT kind, data_pagamento FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('pagamento');
      expect(rows[0]!.data_pagamento).toBeTruthy();
    });
  });

  it('insere demonstrativo avulso (lote_id null)', async () => {
    const demoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, 'PROT-AVULSO', 'analise',
                 DATE '2026-08-06', 'demonstrativo/2026/08/avulso.xml',
                 10000, 9000, 9000, 1000, $3)`,
        [demoId, s.operadoraId, s.userId],
      );

      const { rows } = await tx.query<{ lote_id: string | null }>(
        `SELECT lote_id FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.lote_id).toBeNull();
    });
  });

  // ── INSERT demonstrativo_item ───────────────────────────────────────

  it('insere item de demonstrativo vinculado a guia', async () => {
    const demoId = uuidv7();
    const itemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      // Primeiro insere o demonstrativo pai
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'analise',
                 DATE '2026-08-05', 'demonstrativo/2026/08/item-test.xml',
                 25000, 24000, 24000, 1000, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      // Insere item
      await tx.query(
        `INSERT INTO tiss.demonstrativo_item
           (id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, 'DM001',
                 25000, 24000, 24000, 1000,
                 'M010', 'Procedimento nao coberto')`,
        [itemId, demoId, s.guiaId],
      );

      const { rows } = await tx.query<{
        id: string;
        glosa_codigo: string;
        valor_glosa_cents: string;
      }>(
        `SELECT id, glosa_codigo, valor_glosa_cents
           FROM tiss.demonstrativo_item WHERE id = $1`,
        [itemId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.glosa_codigo).toBe('M010');
      expect(Number(rows[0]!.valor_glosa_cents)).toBe(1000);
    });
  });

  it('insere item sem glosa (glosa_codigo e glosa_descricao null)', async () => {
    const demoId = uuidv7();
    const itemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'analise',
                 DATE '2026-08-05', 'demonstrativo/2026/08/sem-glosa.xml',
                 25000, 25000, 25000, 0, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      await tx.query(
        `INSERT INTO tiss.demonstrativo_item
           (id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents)
         VALUES ($1, $2, $3, 'DM001',
                 25000, 25000, 25000, 0)`,
        [itemId, demoId, s.guiaId],
      );

      const { rows } = await tx.query<{
        glosa_codigo: string | null;
        glosa_descricao: string | null;
      }>(
        `SELECT glosa_codigo, glosa_descricao
           FROM tiss.demonstrativo_item WHERE id = $1`,
        [itemId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.glosa_codigo).toBeNull();
      expect(rows[0]!.glosa_descricao).toBeNull();
    });
  });

  // ── RLS ─────────────────────────────────────────────────────────────

  it('demonstrativo de outro tenant e invisivel via RLS', async () => {
    const demoId = uuidv7();
    // Insere como admin (sem RLS) em s.tenantId
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO tiss.demonstrativo
           (tenant_id, id, operadora_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-RLS', 'analise',
                 DATE '2026-08-07', 'demonstrativo/rls.xml',
                 5000, 5000, 5000, 0, $4)`,
        [s.tenantId, demoId, s.operadoraId, s.userId],
      );
    } finally {
      c.release();
      await admin.end();
    }

    // Cria actor de OUTRO tenant e tenta ler
    const otherTenantId = uuidv7();
    const otherUserId = uuidv7();
    const otherClinicId = uuidv7();
    const admin2 = new Pool({ connectionString: adminUrl(), max: 1 });
    const c2 = await admin2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant', '99ABC11222DE33')`,
        [otherTenantId, `ot-${otherTenantId}`],
      );
      await c2.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Outra Unidade', '9911223', 'America/Sao_Paulo')`,
        [otherTenantId, otherClinicId],
      );
      await c2.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro User')`,
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
        `SELECT id FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      ),
    );
    expect(rows).toHaveLength(0);
  });
});
