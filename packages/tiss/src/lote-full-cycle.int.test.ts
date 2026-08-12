import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent, receiveLoteReturn, cancelLote } from './lote-lifecycle';

interface SementeCiclo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  guiaIds: string[];
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
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    operadoraId: uuidv7(),
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Ciclo', '44ABC55667DE88')`,
      [s.tenantId, `cy-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ciclo', '4445566', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Ciclo')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '444555', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Ciclo', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Meridiano Ciclo', '66XYZ00005DE05', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId]);

    // Três encounters e três guias
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}')`,
        [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId]);
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, s.professionalId, `ciclo-${idx}`]);
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '4445566', '06', '444555', 'SP', '225125', '9', '01',
            DATE '2026-08-${dia}', '1', '22', '10101012', ${(idx + 1) * 100}.00,
            true, $7)`,
        [s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
         `CY-${String(idx + 1).padStart(3, '0')}`, s.userId]);
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

describe('ciclo completo do lote TISS', () => {
  let s: SementeCiclo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearCiclo();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('percorre o ciclo completo: criar -> adicionar guias -> pronto -> enviar -> retornar', async () => {
    // 1. Criar lote em rascunho
    const createResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const loteId = createResult.value.loteId;
    expect(createResult.value.tissVersion).toBe('3.05');

    // 2. Adicionar 3 guias
    for (let idx = 0; idx < 3; idx++) {
      const addResult = await withTenantTx(actor, (tx) =>
        addGuiaToLote(tx, { loteId, guiaId: s.guiaIds[idx]! }),
      );
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;
      expect(addResult.value.sequencialItem).toBe(idx + 1);
    }

    // Verifica contadores após as 3 guias
    const lastAdd = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ guia_count: number; total_value_cents: string }>(
        `SELECT guia_count, total_value_cents FROM tiss.lote WHERE id = $1`, [loteId],
      );
      return rows[0];
    });
    expect(lastAdd?.guia_count).toBe(3);
    // 100 + 200 + 300 = 600 reais = 60000 centavos
    expect(Number(lastAdd?.total_value_cents)).toBe(60000);

    // 3. Marcar como pronto
    const readyResult = await withTenantTx(actor, (tx) =>
      markLoteReady(tx, loteId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.guiaCount).toBe(3);
    expect(readyResult.value.totalValueCents).toBe(60000);

    // 3b. Não pode adicionar guia a lote pronto (já não está em rascunho)
    // Esta verificação usa uma guia que não existe, mas o erro retornado
    // será 'lote_nao_rascunho' porque a validação de status vem primeiro.
    const addAfterReady = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: uuidv7() }),
    );
    expect(addAfterReady.ok).toBe(false);
    if (addAfterReady.ok) return;
    expect(addAfterReady.error.kind).toBe('lote_nao_rascunho');

    // 4. Enviar com protocolo
    const sentResult = await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-CICLO-001',
        xmlStorageKey: 'lote/ciclo/001.xml',
        xmlHashMd5: 'aabbccdd11223344aabbccdd11223344',
      }),
    );
    expect(sentResult.ok).toBe(true);
    if (!sentResult.ok) return;
    expect(sentResult.value.protocoloOperadora).toBe('PROT-CICLO-001');

    // 4b. Não pode cancelar lote enviado
    const cancelAfterSent = await withTenantTx(actor, (tx) =>
      cancelLote(tx, loteId),
    );
    expect(cancelAfterSent.ok).toBe(false);
    if (cancelAfterSent.ok) return;
    expect(cancelAfterSent.error.kind).toBe('lote_ja_enviado');

    // 5. Receber retorno
    const returnResult = await withTenantTx(actor, (tx) =>
      receiveLoteReturn(tx, loteId),
    );
    expect(returnResult.ok).toBe(true);

    // 6. Verificar estado final no banco
    const finalState = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        protocolo_operadora: string;
        xml_storage_key: string;
        xml_hash_md5: string;
        guia_count: number;
      }>(
        `SELECT status, protocolo_operadora, xml_storage_key, xml_hash_md5, guia_count
           FROM tiss.lote WHERE id = $1`, [loteId],
      );
      return rows[0];
    });
    expect(finalState?.status).toBe('retornado');
    expect(finalState?.protocolo_operadora).toBe('PROT-CICLO-001');
    expect(finalState?.xml_storage_key).toBe('lote/ciclo/001.xml');
    expect(finalState?.xml_hash_md5).toBe('aabbccdd11223344aabbccdd11223344');
    expect(finalState?.guia_count).toBe(3);
  });

  it('cancelamento libera guias para reutilizacao em outro lote', async () => {
    // Cria guias dedicadas para este sub-teste
    const freshGuiaIds = [uuidv7(), uuidv7()];
    const freshAdmin = new Pool({ connectionString: adminUrl(), max: 1 });
    const fc = await freshAdmin.connect();
    try {
      await fc.query('BEGIN');
      for (let idx = 0; idx < 2; idx++) {
        const encId = uuidv7();
        const verId = uuidv7();
        const dia = String(10 + idx).padStart(2, '0');
        await fc.query(
          `INSERT INTO clin.encounter
             (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
           VALUES ($1, $2, $3, $4, $5,
                   TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}')`,
          [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId]);
        await fc.query(
          `INSERT INTO clin.encounter_version
             (tenant_id, id, encounter_id, version_no, kind, author_user_id,
              author_professional_id, content_hash, serializer_version)
           VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
          [s.tenantId, verId, encId, s.userId, s.professionalId, `reuse-${idx}`]);
        await fc.query(
          `INSERT INTO tiss.encounter_guia_consulta
             (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
              registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
              codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
              uf_conselho, cbos, indicacao_acidente, regime_atendimento,
              data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
              valor_procedimento, live, created_by)
           VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
              '900123', '4445566', '06', '444555', 'SP', '225125', '9', '01',
              DATE '2026-08-${dia}', '1', '22', '10101012', 500.00, true, $7)`,
          [s.tenantId, freshGuiaIds[idx], encId, verId, s.operadoraId,
           `REUSE-${String(idx + 1).padStart(3, '0')}`, s.userId]);
      }
      await fc.query('COMMIT');
    } finally {
      fc.release();
      await freshAdmin.end();
    }

    // Cria lote, adiciona guias, cancela
    const lote1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote1.ok).toBe(true);
    if (!lote1.ok) return;

    for (const gid of freshGuiaIds) {
      await withTenantTx(actor, (tx) =>
        addGuiaToLote(tx, { loteId: lote1.value.loteId, guiaId: gid }),
      );
    }

    const cancelResult = await withTenantTx(actor, (tx) =>
      cancelLote(tx, lote1.value.loteId),
    );
    expect(cancelResult.ok).toBe(true);
    if (!cancelResult.ok) return;
    expect(cancelResult.value.guiasLiberadas).toBe(2);

    // Cria novo lote e reutiliza as mesmas guias
    const lote2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote2.ok).toBe(true);
    if (!lote2.ok) return;

    for (const gid of freshGuiaIds) {
      const addResult = await withTenantTx(actor, (tx) =>
        addGuiaToLote(tx, { loteId: lote2.value.loteId, guiaId: gid }),
      );
      expect(addResult.ok).toBe(true);
    }
  });
});
