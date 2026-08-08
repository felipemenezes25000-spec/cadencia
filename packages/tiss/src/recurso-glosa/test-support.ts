// packages/tiss/src/recurso-glosa/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeRecurso {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  loteId: string;
  demonstrativoId: string;
  glosaIds: [string, string, string];
  guiaIds: [string, string, string];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

/**
 * Semeia o grafo completo para testes de recurso de glosa:
 * - tenant, clinica, usuario, profissional, paciente
 * - operadora
 * - 3 encounters finalizados, cada um com encounter_version e guia
 * - 1 lote retornado contendo as 3 guias
 * - 1 demonstrativo de analise vinculado ao lote
 * - 3 demonstrativo_items com glosa (valor_glosa_cents > 0, glosa_codigo preenchido)
 * - 3 tiss.glosa em status pendente vinculando demonstrativo_item, guia e version
 *
 * Os 3 tiss.glosa servem como "glosas pendentes" para vincular ao recurso.
 */
export async function semearRecursoGlosa(): Promise<SementeRecurso> {
  const s: SementeRecurso = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    demonstrativoId: uuidv7(),
    glosaIds: [uuidv7(), uuidv7(), uuidv7()],
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const profId = uuidv7();
  const patientId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clinica, usuario, membership, profissional, paciente ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Recurso Glosa', '33ABC44556DE77')`,
      [s.tenantId, `rg-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade RG', '33ABC44556DE77', '3344556', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin RG')`,
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
       VALUES ($1, $2, $3, '06', '334455', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente RG', 'completo', '1985-03-10')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora RG', '66XYZ00003DE03', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- 3 encounters finalizados com guias ---
    const versionIds: string[] = [];
    const demoItemIds: string[] = [];
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      versionIds.push(verId);
      const dia = String(idx + 1).padStart(2, '0');
      const valorProcedimento = (idx + 1) * 100; // 100, 200, 300 reais

      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id,
            occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-07-${dia}T14:00:00Z', DATE '2026-07-${dia}',
                 'finalizado'::clin.encounter_status)`,
        [s.tenantId, encId, patientId, profId, s.clinicId],
      );
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, profId, `rg-${idx}`],
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
            '900123', '3344556', '06', '334455', 'SP', '225125', '9', '01',
            DATE '2026-07-${dia}', '1', '22', '10101012',
            ${valorProcedimento}.00, true, $7)`,
        [s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
         `RG-${String(idx + 1).padStart(3, '0')}`, s.userId],
      );
    }

    // --- lote retornado com as 3 guias ---
    const totalCents = (100 + 200 + 300) * 100; // 60000 centavos
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'retornado'::tiss.lote_status, '3.05', 3, $4,
               'lote/rg.xml', 'aabb0011223344556677889900aabbcc',
               'PROT-RG-001', TIMESTAMPTZ '2026-07-10T10:00:00Z', $5)`,
      [s.tenantId, s.loteId, s.operadoraId, totalCents, s.userId],
    );
    for (let idx = 0; idx < 3; idx++) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.loteId, s.guiaIds[idx], idx + 1],
      );
    }

    // --- demonstrativo de analise ---
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RG-001', 'analise'::tiss.demonstrativo_kind,
               DATE '2026-07-15', 'demonstrativo/rg.xml',
               60000, 45000, 45000, 15000, $5)`,
      [s.tenantId, s.demonstrativoId, s.operadoraId, s.loteId, s.userId],
    );

    // --- 3 demonstrativo_items com glosa ---
    for (let idx = 0; idx < 3; idx++) {
      const demoItemId = uuidv7();
      demoItemIds.push(demoItemId);
      const valorApresentado = (idx + 1) * 10000; // 10000, 20000, 30000 centavos
      const valorGlosa = (idx + 1) * 1000; // 1000, 2000, 3000 centavos de glosa
      const valorLiberado = valorApresentado - valorGlosa;
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $6, $7, $8,
                 $9, $10)`,
        [
          s.tenantId, demoItemId, s.demonstrativoId, s.guiaIds[idx],
          `RG-${String(idx + 1).padStart(3, '0')}`,
          valorApresentado, valorLiberado, valorGlosa,
          `M01${idx}`, `Motivo de glosa ${idx + 1}`,
        ],
      );
    }

    // --- 3 tiss.glosa em status pendente ---
    for (let idx = 0; idx < 3; idx++) {
      const valorGlosa = (idx + 1) * 1000;
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          s.tenantId, s.glosaIds[idx], demoItemIds[idx], s.guiaIds[idx],
          versionIds[idx], `M01${idx}`, `Motivo de glosa ${idx + 1}`, valorGlosa,
        ],
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
