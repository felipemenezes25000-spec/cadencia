// packages/tiss/src/glosa-model.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

/* ------------------------------------------------------------------ */
/* Semente para testes de glosa                                       */
/* ------------------------------------------------------------------ */

interface SementeGlosa {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  guiaId: string;
  versionId: string;
  demonstrativoId: string;
  demonstrativoItemId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearGlosa(): Promise<SementeGlosa> {
  const s: SementeGlosa = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(),
    versionId: uuidv7(),
    demonstrativoId: uuidv7(),
    demonstrativoItemId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clínica, usuário, membership, profissional, paciente ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Glosa Teste', '33ABC44556DE77')`,
      [s.tenantId, `gl-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Glosa', '3344556', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Glosa')`,
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
       VALUES ($1, $2, $3, '06', '334455', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Glosa', 'completo')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Glosa', '66XYZ00003DE03', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter finalizado + version ---
    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-07-15T10:00:00Z', DATE '2026-07-15',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('glosa-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    // --- guia de consulta ---
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'GL001', '00998877665544', false,
          '900123', '3344556', '06', '334455', 'SP', '225125', '9', '01',
          DATE '2026-07-15', '1', '22', '10101012', 250.00, true, $6)`,
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
               'lote/glosa.xml', 'aabbccdd00112233aabbccdd00112233',
               'PROT-GL-001', TIMESTAMPTZ '2026-07-16T10:00:00Z', $4)`,
      [s.tenantId, loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, loteId, s.guiaId],
    );

    // --- demonstrativo + demonstrativo_item ---
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-GL-001', 'analise',
               DATE '2026-07-20', 'demonstrativo/glosa.xml',
               25000, 18000, 18000, 7000, $5)`,
      [s.tenantId, s.demonstrativoId, s.operadoraId, loteId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, 'GL001',
               25000, 18000, 18000, 7000,
               'M010', 'Procedimento nao coberto pelo contrato')`,
      [s.tenantId, s.demonstrativoItemId, s.demonstrativoId, s.guiaId],
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

describe('modelo de dados tiss.glosa', () => {
  let s: SementeGlosa;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearGlosa();
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

  // -- INSERT válido --

  it('insere glosa com todos os campos obrigatorios', async () => {
    const glosaId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.glosa
           (id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, 'M010', 'Procedimento nao coberto', 7000)`,
        [glosaId, s.demonstrativoItemId, s.guiaId, s.versionId],
      );

      const { rows } = await tx.query<{
        id: string;
        status: string;
        valor_glosado_cents: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `SELECT id, status, valor_glosado_cents, resolved_at, resolved_by
           FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('pendente');
      expect(Number(rows[0]!.valor_glosado_cents)).toBe(7000);
      expect(rows[0]!.resolved_at).toBeNull();
      expect(rows[0]!.resolved_by).toBeNull();
    });
  });

  // -- CHECK valor_glosado_cents > 0 --

  it('rejeita glosa com valor_glosado_cents = 0', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'Zero', 0)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejeita glosa com valor_glosado_cents negativo', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'Negativo', -100)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // -- CHECK resolved_at / resolved_by consistência --

  it('rejeita glosa pendente com resolved_at preenchido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents,
              status, resolved_at, resolved_by)
           VALUES ($1, $2, $3, $4, 'M010', 'Invalido', 1000,
                   'pendente', clock_timestamp(), $5)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId, s.userId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejeita glosa aceita sem resolved_at', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents,
              status, resolved_at, resolved_by)
           VALUES ($1, $2, $3, $4, 'M010', 'Sem data', 1000,
                   'aceita', NULL, NULL)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // -- FK demonstrativo_item inexistente --

  it('rejeita FK para demonstrativo_item inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'FK invalida', 500)`,
          [uuidv7(), uuidv7(), s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // -- FK guia inexistente --

  it('rejeita FK para guia inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'FK guia invalida', 500)`,
          [uuidv7(), s.demonstrativoItemId, uuidv7(), s.versionId],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // -- FK encounter_version inexistente --

  it('rejeita FK para encounter_version inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'FK version invalida', 500)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, uuidv7()],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // -- RLS: tenant B não vê glosa do tenant A --

  it('glosa de outro tenant e invisivel via RLS', async () => {
    // Insere glosa no tenant A (via admin, sem RLS)
    const glosaId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, $5, 'M010', 'RLS teste', 5000)`,
        [s.tenantId, glosaId, s.demonstrativoItemId, s.guiaId, s.versionId],
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
         VALUES ($1, $2, 'Outro Tenant Glosa', '11ABC99888DE77')`,
        [otherTenantId, `otg-${otherTenantId}`],
      );
      await c2.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Outra Unidade', '1199887', 'America/Sao_Paulo')`,
        [otherTenantId, otherClinicId],
      );
      await c2.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro User Glosa')`,
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
        `SELECT id FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      ),
    );
    expect(rows).toHaveLength(0);
  });
});
