### Task 56: invariante 1 cobre as 5 novas tabelas TISS da Fase 5

**Arquivos**

- Modificar `packages/db/src/invariants/inv01-rls.int.test.ts`

**Passos**

- [ ] Adicionar testes que verificam que as 5 novas tabelas do schema tiss criadas na Fase 5 (demonstrativo, demonstrativo_item, glosa, recurso_glosa, recurso_glosa_item) sao descobertas pelo invariante 1 e passam todas as verificacoes de RLS.

```ts
// packages/db/src/invariants/inv01-rls.int.test.ts
// Adicionar ao final do describe existente, ANTES do fechamento '});'

  it('as 5 tabelas da Fase 5 em tiss existem e passam o invariante de RLS', async () => {
    const relacoes = await readRelations(catalogPool());
    const tissFase5 = [
      'demonstrativo',
      'demonstrativo_item',
      'glosa',
      'recurso_glosa',
      'recurso_glosa_item',
    ];
    for (const tabela of tissFase5) {
      const rel = relacoes.find((r) => r.schema === 'tiss' && r.relation === tabela);
      expect(rel, `tiss.${tabela} nao encontrada — a migration da Fase 5 nao foi aplicada`).toBeDefined();
      expect(rel!.hasDiscriminator, `tiss.${tabela} sem coluna tenant_id`).toBe(true);
      expect(rel!.rlsEnabled, `tiss.${tabela} com RLS desabilitada`).toBe(true);
      expect(rel!.rlsForced, `tiss.${tabela} com RLS nao forcada`).toBe(true);
      expect(rel!.policies, `tiss.${tabela} sem nenhuma policy`).toBeGreaterThanOrEqual(1);
    }
  });

  it('nenhuma das 5 tabelas da Fase 5 aparece nas violacoes de RLS', async () => {
    const relacoes = await readRelations(catalogPool());
    const violacoes = rlsViolations(relacoes);
    const tissFase5 = [
      'tiss.demonstrativo',
      'tiss.demonstrativo_item',
      'tiss.glosa',
      'tiss.recurso_glosa',
      'tiss.recurso_glosa_item',
    ];
    for (const tabela of tissFase5) {
      const violacao = violacoes.find((v) => v.startsWith(tabela));
      expect(violacao, `violacao encontrada para ${tabela}: ${violacao}`).toBeUndefined();
    }
  });
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts` e confirmar que os novos testes passam (as tabelas foram criadas pelos blocos 01 e 03 da Fase 5).

Saida esperada: todos os testes passando, incluindo os 2 novos.

- [ ] Commitar: `test(db): assert Fase 5 tiss tables pass RLS invariant`

---

### Task 57: invariante 8 reprova relogio no schema tiss incluindo novas queries da Fase 5

**Arquivos**

- Modificar `packages/db/src/invariants/inv08-ddl-lint.int.test.ts`

**Passos**

- [ ] Adicionar testes que verificam que o invariante 8 continua limpo apos a Fase 5 (nenhum now()/current_date no schema tiss, incluindo as novas funcoes/defaults/views do demonstrativo, glosa e recurso).

```ts
// packages/db/src/invariants/inv08-ddl-lint.int.test.ts
// Adicionar ao final do describe existente, ANTES do fechamento '});'

  it('nenhuma violacao de relogio no schema tiss apos a Fase 5 — demonstrativo, glosa e recurso nao usam now()', async () => {
    const violacoes = await ddlLintViolations(catalogPool());
    const tissClock = violacoes.filter((v) => v.includes('tiss.') && v.includes('le o relogio'));
    expect(tissClock, `violacoes de relogio no schema tiss: ${tissClock.join('; ')}`).toEqual([]);
  });

  it('nenhuma violacao de DDL lint no schema inteiro apos a Fase 5', async () => {
    const violacoes = await ddlLintViolations(catalogPool());
    expect(violacoes).toEqual([]);
  });

  it('reprova default now() em tabela demonstrativo — clock_timestamp() e a fonte correta', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE tiss.__demo_com_now (
        tenant_id uuid NOT NULL, id uuid NOT NULL,
        importado_em timestamptz NOT NULL DEFAULT now())`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__demo_com_now.importado_em (default): le o relogio dentro do schema tiss');
  });

  it('reprova funcao que usa current_date dentro de tiss para calcular prazo de recurso', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION tiss.__prazo_recurso() RETURNS date
                     LANGUAGE sql STABLE AS $fn$ SELECT current_date + 30 $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__prazo_recurso (function): le o relogio dentro do schema tiss');
  });
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/inv08-ddl-lint.int.test.ts` e confirmar que todos os testes passam.

Saida esperada: todos os testes passando, incluindo os 4 novos.

- [ ] Commitar: `test(db): assert Fase 5 tiss DDL passes clock lint invariant`

---

### Task 58: atualizar invariante de registry para aceitar tiss-soap apos Fase 5

**Arquivos**

- Modificar `packages/tiss/src/transport/registry-invariant.test.ts`

**Passos**

- [ ] Atualizar o teste de invariante do registry para refletir o estado pos-Fase 5: `tiss-arquivo` e `tiss-soap` sao os dois transports registrados. O bloco 06 da Fase 5 adicionou `tiss-soap` ao registry condicionalmente. O invariante agora ACEITA ambos.

```ts
// packages/tiss/src/transport/registry-invariant.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap existe a partir da Fase 5 (§7.5)', () => {
  it('o diretorio packages/tiss/src/transport/tiss-soap/ existe no repositorio', () => {
    const soapDir = resolve(import.meta.dirname, 'tiss-soap');
    expect(existsSync(soapDir)).toBe(true);
  });

  it('o registry exporta tiss-arquivo e tiss-soap como transports disponiveis', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    const ids = getTransportIds();
    expect(ids).toContain('tiss-arquivo');
    expect(ids).toContain('tiss-soap');
    expect(ids).toHaveLength(2);
    expect(getTransportFactory('tiss-arquivo')).toBeDefined();
    expect(getTransportFactory('tiss-soap')).toBeDefined();
  });

  it('nenhum transport fantasma no registry — so tiss-arquivo e tiss-soap', async () => {
    const { getTransportIds } = await import('./registry');
    const ids = getTransportIds();
    for (const id of ids) {
      expect(['tiss-arquivo', 'tiss-soap']).toContain(id);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/registry-invariant.test.ts` e confirmar que todos os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Commitar: `test(tiss): update registry invariant to accept tiss-soap after Fase 5`

---

### Task 59: demonstracao end-to-end Fase 5 — do encounter ao recurso de glosa deferido

**Arquivos**

- Criar `packages/tiss/src/fase5-e2e.int.test.ts`

**Passos**

- [ ] Escrever o teste de integracao end-to-end que percorre o ciclo completo da Fase 5: tenant → operadora → contrato → paciente → convenio → encounter finalizado → guia projetada → lote criado → lote enviado → demonstrativo importado com glosa parcial → glosa verificada → recurso de glosa criado → recurso marcado pronto → recurso submetido (fake transport) → recurso resolvido como deferido → glosa revertida e valor recuperado.

```ts
// packages/tiss/src/fase5-e2e.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent } from './lote-lifecycle';
import { importDemonstrativo } from './demonstrativo/import-demonstrativo';
import { createRecursoGlosa } from './recurso-glosa/create-recurso-glosa';
import { addGlosaToRecurso } from './recurso-glosa/add-glosa-to-recurso';
import { markRecursoReady } from './recurso-glosa/mark-recurso-ready';
import { submitRecurso } from './recurso-glosa/submit-recurso';
import { resolveRecurso } from './recurso-glosa/resolve-recurso';
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
 * tenant → clinica → usuario → profissional → paciente → operadora →
 * contrato → paciente_convenio → encounter finalizado com billing de convenio →
 * encounter_version → termo TUSS vigente.
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

    // Operadora
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', '28E2E456000199', 'Operadora E2E', '4.01.00', true, $3)`,
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
  let guiaId: string;
  let loteId: string;
  let glosaIds: string[];

  beforeAll(async () => {
    s = await semearFase5E2E();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
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
    expect(result.value.tissVersion).toBe('4.01.00');
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

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId,
        protocoloOperadora: 'PROT-E2E-F5-001',
        kind: 'analise',
        dataProcessamento: '2026-08-05',
        dataPagamento: null,
        xmlStorageKey: 'tiss/e2e/f5/demo-001.xml',
        totalApresentadoCents: 15000,
        totalProcessadoCents: 10000,
        totalLiberadoCents: 10000,
        totalGlosaCents: 5000,
        itens: [
          {
            numeroGuiaPrestador: numeroGuia,
            valorApresentadoCents: 15000,
            valorProcessadoCents: 10000,
            valorLiberadoCents: 10000,
            valorGlosaCents: 5000,
            glosaCodigo: 'A017',
            glosaDescricao: 'Procedimento nao compativel com o diagnostico',
          },
        ],
      }, s.userId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.demonstrativoId).toBeDefined();
    expect(result.value.itensImportados).toBe(1);
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
    // §3.9: a glosa cita a encounter_version_id usada na guia
    expect(glosa.encounter_version_id).toBe(s.versionId);
    glosaIds = [glosa.id];
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

  it('9. criar recurso de glosa para contestar a glosa', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        encounterVersionId: s.versionId,
        justificativaGeral: 'O procedimento esta de acordo com o diagnostico CID-10 registrado no prontuario.',
        createdBy: s.userId,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recursoId).toBeDefined();
    expect(result.value.status).toBe('rascunho');

    // Guardar recursoId para os proximos passos
    const recursoId = result.value.recursoId;

    // 10. adicionar a glosa ao recurso com justificativa individual
    const addResult = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, {
        recursoId,
        glosaId: glosaIds[0]!,
        justificativa: 'Diagnostico Z00.0 justifica consulta completa conforme protocolo clinico.',
        valorRecursadoCents: 5000,
      }),
    );
    expect(addResult.ok).toBe(true);

    // 11. marcar recurso como pronto
    const readyResult = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.status).toBe('pronto');
    expect(readyResult.value.itemCount).toBe(1);

    // 12. submeter recurso com fake transport
    const fakeTransport = createFakeTissArquivoTransport();
    const submitResult = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, fakeTransport),
    );
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.status).toBe('enviado');

    // 13. resolver recurso como deferido — operadora acatou a contestacao
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, {
        recursoId,
        resultado: 'deferido',
        resolvedBy: s.userId,
      }),
    );
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.status).toBe('deferido');

    // 14. verificar que a glosa mudou de status pendente para revertida
    const glosaFinal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        valor_glosado_cents: string;
        resolved_at: string | null;
      }>(
        `SELECT status, valor_glosado_cents::text, resolved_at::text
           FROM tiss.glosa WHERE id = $1`,
        [glosaIds[0]!],
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

  it('11. a encounter_version_id no recurso de glosa bate com a versao da guia (§3.9)', async () => {
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
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/fase5-e2e.int.test.ts --config vitest.int.config.ts` e confirmar que todos os 11 testes passam.

Saida esperada: 11 testes passando. O fluxo completo: encounter → guia → lote → envio → demonstrativo → glosa → recurso → deferimento → valor recuperado.

- [ ] Commitar: `test(tiss): add Fase 5 end-to-end integration test`

---

### Task 60: gate de definition-of-done da Fase 5

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar FASE_ATUAL para 5 e os testes da barra de navegacao. Na Fase 5 nenhum item novo e adicionado a barra — os mesmos 6 itens da Fase 3 continuam. O update e so a constante.

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuicao de variacao chegam na Fase 3' },
];

export const FASE_ATUAL = 5 as const;
```

- [ ] Atualizar o teste da barra de navegacao para refletir a Fase 5.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV, FASE_ATUAL } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('na Fase 5 nenhum item esta marcado como futuro', () => {
    expect(FASE_ATUAL).toBe(5);
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > FASE_ATUAL);
    expect(futuros).toEqual([]);
  });

  it('todos os itens sao links navegaveis', () => {
    render(<BarraDeNavegacao />);
    for (const item of ITENS_NAV) {
      expect(screen.getByRole('link', { name: item.rotulo })).toBeInTheDocument();
    }
  });

  it('nenhum item aparece como botao desabilitado', () => {
    render(<BarraDeNavegacao />);
    const botoesDesabilitados = screen.queryAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'));
    expect(botoesDesabilitados).toHaveLength(0);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegacao principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que falha porque FASE_ATUAL ainda e 3.

Saida esperada: 1 falha — `FASE_ATUAL` e 3, o teste espera 5.

- [ ] Aplicar a mudanca de `FASE_ATUAL = 5` em `nav.ts`.

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 5 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam
pnpm test:int           # todos os testes de integracao passam (fase5-e2e + fase3-e2e + fase2-e2e)
pnpm test:iso           # todos os testes de isolamento passam
pnpm db:invariants      # todos verdes — incluindo as 5 novas tabelas tiss
pnpm db:privileges      # novas relacoes declaradas
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 5 definition-of-done gate and end-to-end demonstration`
