// packages/tiss/src/fase5-e2e.int.test.ts
//
// Demonstracao end-to-end da Fase 5: do encounter finalizado ao recurso de glosa
// deferido com valor recuperado. Percorre o ciclo completo:
//
//   tenant -> operadora -> contrato -> paciente -> convenio -> encounter finalizado ->
//   guia projetada -> lote criado -> lote enviado -> demonstrativo importado com
//   glosa parcial -> glosa verificada -> recurso de glosa criado -> recurso marcado
//   pronto -> recurso submetido (fake transport) -> recurso resolvido como deferido ->
//   glosa revertida e valor recuperado.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { projectGuiaConsulta } from './project-guia';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent } from './lote-lifecycle';
import { importDemonstrativo } from './import-demonstrativo';
import { createRecursoGlosa } from './recurso-glosa/create-recurso';
import { markRecursoReady, submitRecurso } from './recurso-glosa/recurso-lifecycle';
import { resolveRecurso } from './resolve-recurso';
import { createFakeTissArquivoTransport } from './transport/tiss-arquivo-fake';

interface SementeE2E {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  versionId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  pacienteConvenioId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

/**
 * Semeia o grafo completo para o teste end-to-end da Fase 5:
 * tenant -> clinica -> usuario -> profissional -> paciente -> operadora ->
 * contrato -> paciente_convenio -> encounter finalizado com billing de convenio ->
 * encounter_version -> termo TUSS vigente.
 */
async function semearFase5E2E(): Promise<SementeE2E> {
  const s: SementeE2E = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    versionId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    pacienteConvenioId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // Tenant
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica E2E Fase5', '50ABC60770DE80')`,
      [s.tenantId, `e2e5-${s.tenantId}`],
    );

    // Clinica
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade E2E F5', '50ABC60770DE80', '5506677', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );

    // Usuario
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. E2E Fase5')`,
      [s.userId, `${s.userId}@e2e.test`],
    );

    // Membership
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );

    // Profissional
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '550667', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );

    // Paciente
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Maria E2E Fase5', 'completo', '1985-03-15')`,
      [s.tenantId, s.patientId],
    );

    // Operadora (tiss_version varchar(5) -> '3.05')
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', '28E2E456000199', 'Operadora E2E', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // Contrato
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio, created_by)
       VALUES ($1, $2, $3, $4, 'E2E001', DATE '2025-01-01', $5)`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId, s.userId],
    );

    // Paciente convenio
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, validade, created_by)
       VALUES ($1, $2, $3, $4, '5500667788990011', '2028-12-31', $5)`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId, s.userId],
    );

    // Encounter finalizado
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Encounter version (original)
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('e2e-fase5-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, s.encounterId, s.userId, s.professionalId],
    );

    // Atualizar head_version_id
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1
        WHERE id = $2`,
      [s.versionId, s.encounterId],
    );

    // Encounter billing com convenio
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans,
          numero_carteira, atendimento_rn, codigo_prestador_na_operadora, cnes,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Operadora E2E', '326305', '5500667788990011',
               false, 'E2E001', '5506677',
               '06', '550667', 'SP', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 15000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    // Termo TUSS vigente
    await c.query(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       VALUES (22, '10101012', 'Consulta em consultorio', '[2020-01-01,)', '202001', 'inclusao')
       ON CONFLICT DO NOTHING`,
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

describe('demonstracao end-to-end Fase 5 — do encounter ao recurso de glosa deferido', () => {
  let s: SementeE2E;
  let actor: Actor;
  let providerCtx: ProviderCtx;
  let guiaId: string;
  let loteId: string;
  let glosaId: string;
  let recursoId: string;

  beforeAll(async () => {
    s = await semearFase5E2E();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    providerCtx = {
      tenantId: s.tenantId,
      actorUserId: s.userId,
      requestId: uuidv7(),
      idempotencyKey: uuidv7(),
      deadlineMs: 3000,
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('1. projetar guia de consulta a partir do encounter finalizado', async () => {
    const result = await withTenantTx(actor, (tx) =>
      projectGuiaConsulta(tx, s.encounterId, s.versionId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('projected');
    if (result.value.kind !== 'projected') return;
    guiaId = result.value.guiaId;
    expect(guiaId).toBeDefined();
    expect(result.value.status).toBe('completa');
  });

  it('2. criar lote em rascunho para a operadora', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    loteId = result.value.loteId;
    expect(result.value.tissVersion).toBe('3.05');
  });

  it('3. adicionar guia ao lote', async () => {
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sequencialItem).toBe(1);
    expect(result.value.guiaCount).toBe(1);
  });

  it('4. marcar lote como pronto', async () => {
    const result = await withTenantTx(actor, (tx) =>
      markLoteReady(tx, loteId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiaCount).toBe(1);
  });

  it('5. enviar lote com protocolo', async () => {
    const result = await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-E2E-F5-001',
        xmlStorageKey: 'tiss/e2e/f5/001.xml',
        xmlHashMd5: 'e2e5aabbccdd11223344e2e5aabbccdd',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.protocoloOperadora).toBe('PROT-E2E-F5-001');
  });

  it('6. importar demonstrativo com glosa parcial — valor apresentado 150, processado 100, glosa 50', async () => {
    // Buscar o numero_guia_prestador gerado pela projecao
    const guiaRow = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ numero_guia_prestador: string }>(
        `SELECT numero_guia_prestador FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guiaId],
      );
      return rows[0];
    });
    expect(guiaRow).toBeDefined();
    const numeroGuia = guiaRow!.numero_guia_prestador;

    // Importar demonstrativo (importedBy dentro do input, items com guiaId)
    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId,
        protocoloOperadora: 'PROT-E2E-F5-001',
        kind: 'analise',
        dataProcessamento: '2026-08-05',
        xmlStorageKey: 'tiss/e2e/f5/demo-001.xml',
        totalApresentadoCents: 15000,
        totalProcessadoCents: 10000,
        totalLiberadoCents: 10000,
        totalGlosaCents: 5000,
        importedBy: s.userId,
        items: [
          {
            guiaId,
            numeroGuiaPrestador: numeroGuia,
            valorApresentadoCents: 15000,
            valorProcessadoCents: 10000,
            valorLiberadoCents: 10000,
            valorGlosaCents: 5000,
            glosaCodigo: 'A017',
            glosaDescricao: 'Procedimento nao compativel com o diagnostico',
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.demonstrativoId).toBeDefined();
    expect(result.value.itemCount).toBe(1);

    // importDemonstrativo nao cria tiss.glosa automaticamente.
    // Criamos a glosa manualmente a partir do demonstrativo_item.
    const demonstrativoId = result.value.demonstrativoId;

    await withTenantTx(actor, async (tx) => {
      // Buscar o demonstrativo_item inserido
      const { rows: diRows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1 AND guia_id = $2`,
        [demonstrativoId, guiaId],
      );
      expect(diRows).toHaveLength(1);
      const demonstrativoItemId = diRows[0]!.id;

      // Criar glosa vinculando demonstrativo_item, guia e encounter_version
      glosaId = uuidv7();
      await tx.query(
        `INSERT INTO tiss.glosa
           (id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, 'A017',
                 'Procedimento nao compativel com o diagnostico', 5000)`,
        [glosaId, demonstrativoItemId, guiaId, s.versionId],
      );
    });
  });

  it('7. verificar que a glosa foi criada com status pendente e valor correto', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        codigo_glosa: string;
        valor_glosado_cents: string;
        status: string;
        encounter_version_id: string;
      }>(
        `SELECT id, codigo_glosa, valor_glosado_cents::text, status, encounter_version_id
           FROM tiss.glosa
          WHERE guia_id = $1`,
        [guiaId],
      );
      return rows;
    });
    expect(resultado).toHaveLength(1);
    const glosa = resultado[0]!;
    expect(glosa.codigo_glosa).toBe('A017');
    expect(Number(glosa.valor_glosado_cents)).toBe(5000);
    expect(glosa.status).toBe('pendente');
    // S3.9: a glosa cita a encounter_version_id usada na guia
    expect(glosa.encounter_version_id).toBe(s.versionId);
  });

  it('8. verificar que o lote foi atualizado para retornado', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`, [loteId],
      );
      return rows[0];
    });
    expect(resultado?.status).toBe('retornado');
  });

  it('9. criar recurso de glosa, marcar pronto, submeter e resolver como deferido', async () => {
    // 9a. Criar recurso de glosa com a glosa pendente como item
    //     (createRecursoGlosa exige ao menos 1 item na criacao)
    const createResult = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          {
            glosaId,
            justificativa: 'Diagnostico Z00.0 justifica consulta completa conforme protocolo clinico.',
            valorRecursadoCents: 5000,
          },
        ],
      }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    recursoId = createResult.value.recursoId;
    expect(createResult.value.itemCount).toBe(1);
    expect(createResult.value.totalRecursadoCents).toBe(5000);

    // 9b. Preencher justificativa geral (createRecursoGlosa nao a define)
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [recursoId, 'O procedimento esta de acordo com o diagnostico CID-10 registrado no prontuario.'],
      ),
    );

    // 9c. Marcar recurso como pronto
    const readyResult = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.itemCount).toBe(1);

    // 9d. Submeter recurso com fake transport
    const fakeTransport = createFakeTissArquivoTransport();
    const submitResult = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, fakeTransport, providerCtx),
    );
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.recursoId).toBe(recursoId);

    // Verificar status enviado no banco
    const sentRow = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string; sent_at: string | null }>(
        `SELECT status, sent_at::text FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      return rows[0];
    });
    expect(sentRow?.status).toBe('enviado');
    expect(sentRow?.sent_at).toBeTruthy();

    // 9e. Resolver recurso como deferido — operadora acatou a contestacao
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.recursoId).toBe(recursoId);

    // 9f. Verificar que o recurso transitou para deferido
    const recursoFinal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string; resolved_at: string | null }>(
        `SELECT status, resolved_at::text FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      return rows[0];
    });
    expect(recursoFinal?.status).toBe('deferido');
    expect(recursoFinal?.resolved_at).not.toBeNull();

    // 9g. Verificar que a glosa mudou de status pendente para revertida
    const glosaFinal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        valor_glosado_cents: string;
        resolved_at: string | null;
      }>(
        `SELECT status, valor_glosado_cents::text, resolved_at::text
           FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      return rows[0];
    });
    expect(glosaFinal?.status).toBe('revertida');
    expect(Number(glosaFinal?.valor_glosado_cents)).toBe(5000);
    expect(glosaFinal?.resolved_at).not.toBeNull();
  });

  it('10. valor recuperado: a soma de glosas revertidas para esta guia iguala o valor originalmente glosado', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        total_revertido: string;
        total_pendente: string;
        total_aceito: string;
      }>(
        `SELECT
           coalesce(sum(CASE WHEN status = 'revertida' THEN valor_glosado_cents ELSE 0 END), 0)::text AS total_revertido,
           coalesce(sum(CASE WHEN status = 'pendente' THEN valor_glosado_cents ELSE 0 END), 0)::text AS total_pendente,
           coalesce(sum(CASE WHEN status = 'aceita' THEN valor_glosado_cents ELSE 0 END), 0)::text AS total_aceito
         FROM tiss.glosa
         WHERE guia_id = $1`,
        [guiaId],
      );
      return rows[0];
    });
    expect(Number(resultado?.total_revertido)).toBe(5000);
    expect(Number(resultado?.total_pendente)).toBe(0);
    expect(Number(resultado?.total_aceito)).toBe(0);
  });

  it('11. a encounter_version_id no recurso de glosa bate com a versao da guia (S3.9)', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        recurso_version_id: string;
        glosa_version_id: string;
      }>(
        `SELECT rg.encounter_version_id AS recurso_version_id,
                g.encounter_version_id AS glosa_version_id
           FROM tiss.recurso_glosa rg
           JOIN tiss.recurso_glosa_item rgi ON rgi.recurso_id = rg.id
           JOIN tiss.glosa g ON g.id = rgi.glosa_id
          WHERE rg.encounter_version_id = $1
          LIMIT 1`,
        [s.versionId],
      );
      return rows[0];
    });
    expect(resultado).toBeDefined();
    expect(resultado!.recurso_version_id).toBe(s.versionId);
    expect(resultado!.glosa_version_id).toBe(s.versionId);
  });
});
