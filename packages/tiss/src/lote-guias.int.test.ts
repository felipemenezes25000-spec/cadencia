import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';
import { addGuiaToLote, removeGuiaFromLote } from './lote-guias';

interface SementeGuias {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  operadoraBId: string;
  // Cada guia é usada por UM único teste para evitar conflito entre testes
  guiaAddSingle: string;       // test 1: add single
  guiaSeqA: string;            // test 2: primeira guia do par
  guiaSeqB: string;            // test 2: segunda guia do par
  guiaInativaId: string;       // test 3: guia inativa
  guiaOutraOperadoraId: string;// test 4: operadora divergente
  guiaJaEmLote: string;        // test 5: guia ja em lote
  guiaRemove: string;          // test 6: add then remove
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearGuias(): Promise<SementeGuias> {
  const s: SementeGuias = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    operadoraId: uuidv7(), operadoraBId: uuidv7(),
    guiaAddSingle: uuidv7(),
    guiaSeqA: uuidv7(), guiaSeqB: uuidv7(),
    guiaInativaId: uuidv7(), guiaOutraOperadoraId: uuidv7(),
    guiaJaEmLote: uuidv7(), guiaRemove: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Guias', '22ABC33445DE66')`,
      [s.tenantId, `g-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Guias', '2223344', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Guias')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '222333', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Guias', 'completo')`,
      [s.tenantId, s.patientId]);

    // Duas operadoras
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Meridiano Saude', '99XYZ00001DE01', '3.05', true, $4),
              ($1, $3, '111222', 'Outra Operadora', '77XYZ00003DE03', '3.05', true, $4)`,
      [s.tenantId, s.operadoraId, s.operadoraBId, s.userId]);

    // 7 encounters (um por guia) para evitar conflito no índice único ux_guia_live
    const eIds: string[] = [];
    const vIds: string[] = [];
    for (let k = 0; k < 7; k++) {
      eIds.push(uuidv7());
      vIds.push(uuidv7());
    }

    for (let k = 0; k < 7; k++) {
      const day = String(k + 1).padStart(2, '0');
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-08-${day}T14:00:00Z', DATE '2026-08-${day}')`,
        [s.tenantId, eIds[k], s.patientId, s.professionalId, s.clinicId]);
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, vIds[k], eIds[k], s.userId, s.professionalId,
         `v${k + 1}`]);
    }

    // 7 guias: 5 ativas operadora A, 1 inativa operadora A, 1 ativa operadora B
    const guiaIds = [
      s.guiaAddSingle, s.guiaSeqA, s.guiaSeqB,
      s.guiaInativaId, s.guiaOutraOperadoraId,
      s.guiaJaEmLote, s.guiaRemove,
    ];
    const guiaOperadoras = [
      s.operadoraId, s.operadoraId, s.operadoraId,
      s.operadoraId, s.operadoraBId,
      s.operadoraId, s.operadoraId,
    ];
    const guiaAns = [
      '326305', '326305', '326305',
      '326305', '111222',
      '326305', '326305',
    ];
    const guiaCodPrest = [
      '900123', '900123', '900123',
      '900123', '800456',
      '900123', '900123',
    ];
    const guiaLive = [true, true, true, false, true, true, true];
    const guiaValor = [250.00, 180.00, 120.00, 300.00, 200.00, 90.00, 160.00];

    for (let k = 0; k < 7; k++) {
      const day = String(k + 1).padStart(2, '0');
      const num = `G${String(k + 1).padStart(3, '0')}`;
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '00998877665544', false,
                 $8, '2223344', '06', '222333', 'SP', '225125', '9', '01',
                 DATE '2026-08-${day}', '1', '22', '10101012', $9, $10, $11)`,
        [s.tenantId, guiaIds[k], eIds[k], vIds[k], guiaOperadoras[k],
         guiaAns[k], num, guiaCodPrest[k], guiaValor[k], guiaLive[k], s.userId]);
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

describe('addGuiaToLote e removeGuiaFromLote', () => {
  let s: SementeGuias;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearGuias();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('adiciona guia ativa a lote rascunho e atualiza contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaAddSingle }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sequencialItem).toBe(1);
    expect(result.value.guiaCount).toBe(1);
    expect(result.value.totalValueCents).toBe(25000);
  });

  it('adiciona segunda guia e incrementa sequencial e contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaSeqA }),
    );
    const r2 = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaSeqB }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.sequencialItem).toBe(2);
    expect(r2.value.guiaCount).toBe(2);
    expect(r2.value.totalValueCents).toBe(30000); // 18000 + 12000
  });

  it('recusa guia inativa (live=false)', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: loteResult.value.loteId, guiaId: s.guiaInativaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_inativa');
  });

  it('recusa guia de operadora diferente da do lote', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: loteResult.value.loteId, guiaId: s.guiaOutraOperadoraId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_operadora_divergente');
  });

  it('recusa guia ja inclusa em outro lote', async () => {
    const l1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    const l2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(l1.ok && l2.ok).toBe(true);
    if (!l1.ok || !l2.ok) return;

    // Adiciona guia ao primeiro lote
    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: l1.value.loteId, guiaId: s.guiaJaEmLote }),
    );

    // Tenta adicionar a mesma guia ao segundo lote
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: l2.value.loteId, guiaId: s.guiaJaEmLote }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_ja_em_lote');
  });

  it('remove guia de lote rascunho e atualiza contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaRemove }),
    );

    const result = await withTenantTx(actor, (tx) =>
      removeGuiaFromLote(tx, { loteId, guiaId: s.guiaRemove }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiaCount).toBe(0);
    expect(result.value.totalValueCents).toBe(0);
  });

  it('recusa remocao de guia de lote inexistente', async () => {
    const result = await withTenantTx(actor, (tx) =>
      removeGuiaFromLote(tx, { loteId: uuidv7(), guiaId: s.guiaAddSingle }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_nao_encontrado');
  });
});
