### Task 51: Migration 0128 — matview rpt.mv_glosas + refresh function

**Arquivos:**
- `packages/db/migrations/0128_rpt_mv_glosas.sql` (novo)

**Depende de:** tiss.glosa (definida por bloco anterior da Fase 5), tiss.encounter_guia_consulta (0115), clin.encounter (0030), rpt_owner com BYPASSRLS (0104), schema rpt (0002), rpt.refresh_log (0104).

- [ ] Criar o arquivo de migration `packages/db/migrations/0128_rpt_mv_glosas.sql` com o conteudo abaixo.

```sql
-- 0128_rpt_mv_glosas.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5, bloco 09 — matview de glosas aceitas para Desempenho.
-- Uma linha por glosa aceita (nao recuperada). Usada pelo Explorar e pela
-- decomposicao de variacao (ss5.5 fator "glosas nao recuperadas").
--
-- Propriedade de rpt_owner, SEM GRANT para app_rw (regra ss3.8).

-- ---------------------------------------------------------------------------
-- 1. GRANT USAGE no schema tiss para rpt_owner. Necessario para que a
--    matview (pertencente a rpt_owner, que tem BYPASSRLS) consiga ler as
--    tabelas-fonte no schema tiss. As migrations 0115, 0116 e 0120 ja
--    concedem SELECT tabela a tabela, mas faltava USAGE no schema.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA tiss TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 2. GRANT SELECT na tabela-fonte de glosas para rpt_owner.
--    A tabela tiss.glosa e criada por bloco anterior da Fase 5.
-- ---------------------------------------------------------------------------
GRANT SELECT ON tiss.glosa TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 3. Matview: uma linha por glosa aceita (status = 'aceita').
--    Campos de dimensao: data_atendimento (periodo), operadora_id,
--    professional_id, clinic_id. Campo de medida: valor_glosado_cents.
-- ---------------------------------------------------------------------------
SET ROLE rpt_owner;

CREATE MATERIALIZED VIEW rpt.mv_glosas AS
SELECT
  rg.id                         AS glosa_id,
  rg.valor_glosado_cents,
  gc.data_atendimento,
  gc.operadora_id,
  enc.professional_id,
  enc.clinic_id,
  rg.created_at                 AS glosa_created_at,
  rg.tenant_id
FROM tiss.glosa rg
JOIN tiss.encounter_guia_consulta gc
  ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
JOIN clin.encounter enc
  ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
WHERE rg.status = 'aceita'
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_glosas
  ON rpt.mv_glosas (tenant_id, glosa_id);
CREATE INDEX ix_mv_glosas_data
  ON rpt.mv_glosas (tenant_id, clinic_id, data_atendimento DESC);

-- ---------------------------------------------------------------------------
-- 4. Funcao de refresh (mesmo padrao de 0107_rpt_refresh_functions.sql).
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_glosas() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_glosas') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_glosas;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_glosas;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_glosas;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_glosas', v_start, clock_timestamp(), v_count, true);
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. GRANTs de execucao para o worker (papel jobs).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_glosas() TO jobs;
```

- [ ] Rodar a migration e verificar que aplica sem erro:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: termina em `0128_rpt_mv_glosas.sql` sem erro.

- [ ] Verificar que o invariant de CI (sem GRANT de matview para app_rw) continua passando:

```bash
pnpm db:invariants
```

Saida esperada: todos OK.

- [ ] Commitar:

```bash
git add packages/db/migrations/0128_rpt_mv_glosas.sql
git commit -m "feat(db): add matview rpt.mv_glosas for accepted glosa aggregation

Migration 0128: materialized view with one row per accepted glosa,
refresh function for worker, and GRANT USAGE ON SCHEMA tiss to rpt_owner.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 52: Migration 0129 — app_rpt.glosas security_barrier view

**Arquivos:**
- `packages/db/migrations/0129_app_rpt_glosas.sql` (novo)
- `packages/db/privileges.json` (editar — adicionar entrada para app_rpt.glosas)

**Depende de:** rpt.mv_glosas (0128), app_rpt schema (0104), app.current_tenant_id() e app.is_member() (0002/0003).

- [ ] Criar o arquivo de migration `packages/db/migrations/0129_app_rpt_glosas.sql` com o conteudo abaixo.

```sql
-- 0129_app_rpt_glosas.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5, bloco 09 — view security_barrier em app_rpt para expor dados de
-- glosa ao modulo reports. Segue o padrao de 0108_app_rpt_barrier_views.sql:
-- rpt_owner e dono, app_rw le, matview nunca recebe GRANT direto.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- app_rpt.glosas — dado financeiro de glosa, sem restricao de escopo clinico.
-- Inclui data_atendimento para filtragem por periodo na variacao.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.glosas WITH (security_barrier = true) AS
  SELECT m.glosa_id, m.valor_glosado_cents, m.data_atendimento,
         m.operadora_id, m.professional_id, m.clinic_id,
         m.glosa_created_at
    FROM rpt.mv_glosas m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANT: app_rw le a view, nunca a matview diretamente.
-- ---------------------------------------------------------------------------
GRANT SELECT ON app_rpt.glosas TO app_rw;
```

- [ ] Adicionar a entrada `app_rpt.glosas` em `packages/db/privileges.json`. Localizar o final do objeto JSON e adicionar:

```jsonc
// Em packages/db/privileges.json, adicionar a entrada:
  "app_rpt.glosas": {
    "view": {
      "app_rw": ["SELECT"]
    }
  }
```

- [ ] Rodar a migration e verificar que aplica sem erro:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: termina em `0129_app_rpt_glosas.sql` sem erro.

- [ ] Verificar invariantes:

```bash
pnpm db:invariants
```

Saida esperada: todos OK. Nenhum GRANT de matview para app_rw.

- [ ] Commitar:

```bash
git add packages/db/migrations/0129_app_rpt_glosas.sql packages/db/privileges.json
git commit -m "feat(db): add security_barrier view app_rpt.glosas

Migration 0129: exposes rpt.mv_glosas through app_rpt.glosas with
tenant isolation via security_barrier predicate.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 53: Test helper para glosas e teste que falha — glosas no periodo A

**Arquivos:**
- `packages/reports/src/test-support.ts` (editar — adicionar `criarOperadora` e `criarGlosaAceita`)
- `packages/reports/src/compute-variation.int.test.ts` (editar — adicionar bloco de testes de glosa)

**Depende de:** tiss.operadora (0110), tiss.encounter_guia_consulta (0115), tiss.glosa (bloco anterior Fase 5), clin.encounter (0030), clin.encounter_version (0033), semearVariacao (test-support.ts).

- [ ] Adicionar `operadoraId` a `SementeVariacao` e os helpers `criarOperadora` e `criarGlosaAceita` em `packages/reports/src/test-support.ts`. Ao final do arquivo, antes da ultima linha em branco, acrescentar:

```typescript
// No topo do arquivo, junto aos outros imports, nao e necessario adicionar nada:
// uuidv7 ja esta importado.

// Adicionar campo ao SementeVariacao:
// Editar a interface SementeVariacao adicionando:
//   operadoraId: string;
// e no corpo de semearVariacao, gerar o id e inserir a operadora.
```

Editar a interface `SementeVariacao` adicionando o campo `operadoraId`:

```typescript
export interface SementeVariacao {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalIdA: string;
  professionalIdB: string;
  patientIds: string[];
  procedureIdConsulta: string;
  procedureIdRetorno: string;
  paymentMethodId: string;
  categoryId: string;
  operadoraId: string;
}
```

Editar a funcao `semearVariacao` para gerar o `operadoraId` e inserir a operadora. No corpo do objeto `s`, adicionar `operadoraId: uuidv7()`. Dentro do bloco `try`, apos a insercao de `fin.category`, adicionar:

```typescript
    // Operadora (para testes de glosa)
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, created_by)
       VALUES ($1, $2, '123456', 'Operadora Var', '11ABC22301DE44',
               '4.01', 'arquivo', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
```

Ao final do arquivo, antes da linha em branco final, adicionar a funcao `criarGlosaAceita`:

```typescript
/**
 * Cria um encounter finalizado, uma guia de consulta e uma glosa aceita.
 * Retorna os IDs criados para verificacao no teste.
 */
export async function criarGlosaAceita(opts: {
  tenantId: string;
  clinicId: string;
  patientId: string;
  professionalId: string;
  userId: string;
  operadoraId: string;
  valorGlosadoCents: number;
  dataAtendimento: string; // 'YYYY-MM-DD'
}): Promise<{ encounterId: string; guiaId: string; glosaId: string }> {
  const encounterId = uuidv7();
  const versionId = uuidv7();
  const guiaId = uuidv7();
  const glosaId = uuidv7();
  const guiaNumero = `G${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // 1. Encounter finalizado
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status, version_count)
       VALUES ($1, $2, $3, $4, $5,
               ($6::date)::timestamptz, $6::date, 'finalizado', 1)`,
      [opts.tenantId, encounterId, opts.patientId, opts.professionalId,
       opts.clinicId, opts.dataAtendimento]);

    // 2. Encounter version (original)
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id, finalized_at,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original',
               $4, $5, clock_timestamp(),
               decode(lpad('', 64, 'ab'), 'hex'), 'test-v1')`,
      [opts.tenantId, versionId, encounterId, opts.userId,
       opts.professionalId]);

    // Atualizar head_version_id do encounter
    await c.query(
      `UPDATE clin.encounter
          SET head_version_id = $2
        WHERE tenant_id = $1 AND id = $3`,
      [opts.tenantId, versionId, encounterId]);

    // 3. Guia de consulta
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira,
          atendimento_rn, cnpj_contratado, cnes,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, data_atendimento,
          tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, created_by, status)
       VALUES ($1, $2, $3, $4, $5,
               '123456', $6, 'CART001',
               false, '11ABC22301DE44', '1112233',
               '06', '111111', 'SP', '225125',
               '9', '01', $7::date,
               '1', '22', '10101012',
               ($8::numeric / 100.0), $9, 'completa')`,
      [opts.tenantId, guiaId, encounterId, versionId, opts.operadoraId,
       guiaNumero, opts.dataAtendimento, opts.valorGlosadoCents, opts.userId]);

    // 4. Lote + demonstrativo + demonstrativo_item (pre-requisitos para tiss.glosa)
    const loteId = uuidv7();
    const demoId = uuidv7();
    const demoItemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $5, '1', 'retornado', '4.01', 1, $8,
               'lote/glosa-var.xml', 'aabb00112233445566778899aabbccdd',
               'PROT-VAR', clock_timestamp(), $9)`,
      [opts.tenantId, loteId, null, null, opts.operadoraId,
       null, null, opts.valorGlosadoCents, opts.userId]);
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [opts.tenantId, loteId, guiaId]);
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-VAR', 'analise',
               $5::date, 'demo/glosa-var.xml',
               $6, 0, 0, $6, $7)`,
      [opts.tenantId, demoId, opts.operadoraId, loteId,
       opts.dataAtendimento, opts.valorGlosadoCents, opts.userId]);
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'M001', 'Glosa de teste')`,
      [opts.tenantId, demoItemId, demoId, guiaId, guiaNumero, opts.valorGlosadoCents]);

    // 5. Glosa aceita (todas as colunas NOT NULL preenchidas)
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents,
          status, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5,
               'M001', 'Glosa de teste', $6,
               'aceita', clock_timestamp(), $7)`,
      [opts.tenantId, glosaId, demoItemId, guiaId, versionId,
       opts.valorGlosadoCents, opts.userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return { encounterId, guiaId, glosaId };
}
```

- [ ] Adicionar o bloco de testes de glosa em `packages/reports/src/compute-variation.int.test.ts`. Ao final do arquivo, antes do ultimo `});` que fecha o `describe('computeVariation')`, adicionar:

```typescript
  describe('fator de glosas nao recuperadas', () => {
    let sGlosa: SementeVariacao;
    let poolGlosa: Pool;

    beforeAll(async () => {
      sGlosa = await semearVariacao();
      poolGlosa = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 2,
      });
      poolGlosa.on('connect', (client) => {
        void client.query('SET ROLE app_rw').catch(() => undefined);
      });

      // Periodo A (junho 2026): 3 consultas pagas + 1 glosa aceita de R$200
      for (let i = 0; i < 3; i++) {
        await criarAtendimentoComLancamento({
          tenantId: sGlosa.tenantId, clinicId: sGlosa.clinicId,
          patientId: sGlosa.patientIds[i]!,
          professionalId: sGlosa.professionalIdA,
          procedureId: sGlosa.procedureIdConsulta,
          userId: sGlosa.userId, paymentMethodId: sGlosa.paymentMethodId,
          categoryId: sGlosa.categoryId,
          amountCents: 25000, date: `2026-06-${String(10 + i).padStart(2, '0')}`,
          status: 'atendido', operadoraNome: 'Operadora Var', pago: true,
        });
      }
      await criarGlosaAceita({
        tenantId: sGlosa.tenantId, clinicId: sGlosa.clinicId,
        patientId: sGlosa.patientIds[3]!,
        professionalId: sGlosa.professionalIdA,
        userId: sGlosa.userId, operadoraId: sGlosa.operadoraId,
        valorGlosadoCents: 20000, dataAtendimento: '2026-06-15',
      });

      // Periodo B (julho 2026): 3 consultas pagas, sem glosas
      for (let i = 0; i < 3; i++) {
        await criarAtendimentoComLancamento({
          tenantId: sGlosa.tenantId, clinicId: sGlosa.clinicId,
          patientId: sGlosa.patientIds[i]!,
          professionalId: sGlosa.professionalIdA,
          procedureId: sGlosa.procedureIdConsulta,
          userId: sGlosa.userId, paymentMethodId: sGlosa.paymentMethodId,
          categoryId: sGlosa.categoryId,
          amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
          status: 'atendido', operadoraNome: 'Operadora Var', pago: true,
        });
      }
    });

    afterAll(async () => {
      await poolGlosa.end();
    });

    it('glosas no periodo A e nenhuma no B → fator positivo (glosas reduziram)', async () => {
      const actor: Actor = {
        kind: 'user', tenantId: sGlosa.tenantId, userId: sGlosa.userId,
        clinicId: sGlosa.clinicId, requestId: 'test-glosa-1',
      };
      const result = await withTenantTx(actor, async (tx) => {
        return computeVariation(tx, sGlosa.tenantId, sGlosa.clinicId,
          { start: '2026-06-01', end: '2026-06-30' },
          { start: '2026-07-01', end: '2026-07-31' },
        );
      }, poolGlosa);

      // Glosas: A teve R$200 aceita, B teve R$0
      // Fator = -(0 - 20000) = +20000 (reducao de glosas e positivo)
      expect(result.factors.glosas_cents).toBe(20000);
      // Propriedade matematica ainda vale
      expect(factorsAddUp(result.factors)).toBe(true);
    });
  });
```

- [ ] Atualizar o import no topo de `compute-variation.int.test.ts` para incluir `criarGlosaAceita`:

```typescript
import {
  semearVariacao, criarAtendimentoComLancamento, criarGlosaAceita,
  type SementeVariacao,
} from './test-support';
```

- [ ] Rodar o teste e confirmar que FALHA (glosas_cents retorna 0, esperava 20000):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: o teste `glosas no periodo A e nenhuma no B` FALHA com `expected 20000, received 0`.

- [ ] Commitar o teste que falha:

```bash
git add packages/reports/src/test-support.ts packages/reports/src/compute-variation.int.test.ts
git commit -m "test(reports): add failing test for glosas factor in variation decomposition

Adds criarGlosaAceita helper and test scenario: accepted glosas in period A,
none in period B. Test expects positive glosas_cents but currently gets 0.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 54: Implementar consulta de glosas em compute-variation.ts

**Arquivos:**
- `packages/reports/src/compute-variation.ts` (editar)

**Depende de:** tiss.glosa (bloco anterior Fase 5), tiss.encounter_guia_consulta (0115), clin.encounter (0030), Task 53 (teste que falha).

- [ ] Em `packages/reports/src/compute-variation.ts`, substituir o comentario e a linha `const glosasCents = 0;` pela consulta real de glosas aceitas. Localizar o bloco:

```typescript
  // Glosas: zero ate Fase 4 (TISS)
  const glosasCents = 0;
```

e substituir por:

```typescript
  // -----------------------------------------------------------------------
  // 5b. Glosas nao recuperadas (aceitas) por periodo
  // -----------------------------------------------------------------------
  const glosas = await tx.query<{
    periodo: string; total_glosado_cents: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(sum(rg.valor_glosado_cents), 0)::text AS total_glosado_cents
       FROM tiss.glosa rg
       JOIN tiss.encounter_guia_consulta gc
         ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
       JOIN clin.encounter enc
         ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
      WHERE rg.tenant_id = $1
        AND enc.clinic_id = $2
        AND gc.data_atendimento >= $3::date
        AND gc.data_atendimento <= $4::date
        AND rg.status = 'aceita'
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(sum(rg.valor_glosado_cents), 0)::text AS total_glosado_cents
       FROM tiss.glosa rg
       JOIN tiss.encounter_guia_consulta gc
         ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
       JOIN clin.encounter enc
         ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
      WHERE rg.tenant_id = $1
        AND enc.clinic_id = $2
        AND gc.data_atendimento >= $5::date
        AND gc.data_atendimento <= $6::date
        AND rg.status = 'aceita'`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let glosasACents = 0;
  let glosasBCents = 0;
  for (const row of glosas.rows) {
    if (row.periodo === 'A') {
      glosasACents = Number(row.total_glosado_cents);
    } else {
      glosasBCents = Number(row.total_glosado_cents);
    }
  }

  // Glosas: receita perdida por glosas aceitas (nao recuperadas).
  // Mais glosas em B do que em A = fator negativo (perda).
  // Menos glosas em B do que em A = fator positivo (recuperacao).
  const glosasCents = -(glosasBCents - glosasACents);
```

- [ ] Atualizar o comentario do docblock no topo da funcao. Substituir:

```typescript
 * 6. Glosas: zero ate a Fase 4 (TISS).
```

por:

```typescript
 * 6. Glosas: valor de glosas aceitas (nao recuperadas) por periodo,
 *    consultando tiss.glosa via encounter_guia_consulta.
```

- [ ] Rodar os testes e confirmar que TODOS passam (inclusive o novo da Task 53 e os antigos):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: todos os testes passam. O teste `glosas sao zero (TISS nao implementado)` continua passando porque naquele cenario nao ha dados de glosa (a query retorna 0 para ambos os periodos). O teste novo `glosas no periodo A e nenhuma no B` agora passa com `glosas_cents === 20000`.

- [ ] Commitar:

```bash
git add packages/reports/src/compute-variation.ts
git commit -m "feat(reports): implement glosas factor in variation decomposition

Replaces hardcoded glosas_cents=0 with live query against
tiss.glosa joined with encounter_guia_consulta.
Factor is negative when accepted glosas increase, positive when they decrease.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 55: Teste de cenario inverso — glosas no periodo B geram fator negativo

**Arquivos:**
- `packages/reports/src/compute-variation.int.test.ts` (editar — adicionar segundo cenario)

**Depende de:** Task 54 (implementacao funcional).

- [ ] Adicionar um segundo cenario dentro do `describe('fator de glosas nao recuperadas')` em `packages/reports/src/compute-variation.int.test.ts`. Apos o `it('glosas no periodo A...')` e antes do `});` que fecha o `describe('fator de glosas nao recuperadas')`, adicionar:

```typescript
    it('glosas no periodo B e nenhuma no A → fator negativo (glosas aumentaram)', async () => {
      // Cenario: usar tenant separado para isolamento
      const sInv = await semearVariacao();
      const poolInv = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 2,
      });
      poolInv.on('connect', (client) => {
        void client.query('SET ROLE app_rw').catch(() => undefined);
      });

      try {
        // Periodo A (junho 2026): 3 consultas pagas, sem glosas
        for (let i = 0; i < 3; i++) {
          await criarAtendimentoComLancamento({
            tenantId: sInv.tenantId, clinicId: sInv.clinicId,
            patientId: sInv.patientIds[i]!,
            professionalId: sInv.professionalIdA,
            procedureId: sInv.procedureIdConsulta,
            userId: sInv.userId, paymentMethodId: sInv.paymentMethodId,
            categoryId: sInv.categoryId,
            amountCents: 25000, date: `2026-06-${String(10 + i).padStart(2, '0')}`,
            status: 'atendido', operadoraNome: null, pago: true,
          });
        }

        // Periodo B (julho 2026): 3 consultas pagas + 1 glosa aceita de R$150
        for (let i = 0; i < 3; i++) {
          await criarAtendimentoComLancamento({
            tenantId: sInv.tenantId, clinicId: sInv.clinicId,
            patientId: sInv.patientIds[i]!,
            professionalId: sInv.professionalIdA,
            procedureId: sInv.procedureIdConsulta,
            userId: sInv.userId, paymentMethodId: sInv.paymentMethodId,
            categoryId: sInv.categoryId,
            amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
            status: 'atendido', operadoraNome: 'Operadora Var', pago: true,
          });
        }
        await criarGlosaAceita({
          tenantId: sInv.tenantId, clinicId: sInv.clinicId,
          patientId: sInv.patientIds[4]!,
          professionalId: sInv.professionalIdA,
          userId: sInv.userId, operadoraId: sInv.operadoraId,
          valorGlosadoCents: 15000, dataAtendimento: '2026-07-20',
        });

        const actor: Actor = {
          kind: 'user', tenantId: sInv.tenantId, userId: sInv.userId,
          clinicId: sInv.clinicId, requestId: 'test-glosa-inv-1',
        };
        const result = await withTenantTx(actor, async (tx) => {
          return computeVariation(tx, sInv.tenantId, sInv.clinicId,
            { start: '2026-06-01', end: '2026-06-30' },
            { start: '2026-07-01', end: '2026-07-31' },
          );
        }, poolInv);

        // Glosas: A teve R$0, B teve R$150 aceita
        // Fator = -(15000 - 0) = -15000 (aumento de glosas e negativo)
        expect(result.factors.glosas_cents).toBe(-15000);
        // Propriedade matematica: soma dos fatores = delta
        expect(factorsAddUp(result.factors)).toBe(true);
        // O fator "glosas nao recuperadas" esta destacado (nao absorvido pelo ticket)
        expect(result.factors.glosas_cents).not.toBe(0);
      } finally {
        await poolInv.end();
      }
    });

    it('sem glosas em nenhum periodo → fator continua zero', async () => {
      // Reutiliza o dataset original (s) que nao tem glosas
      const actor: Actor = {
        kind: 'user', tenantId: s.tenantId, userId: s.userId,
        clinicId: s.clinicId, requestId: 'test-glosa-zero',
      };
      const result = await withTenantTx(actor, async (tx) => {
        return computeVariation(tx, s.tenantId, s.clinicId,
          { start: '2026-06-01', end: '2026-06-30' },
          { start: '2026-07-01', end: '2026-07-31' },
        );
      }, pool);

      expect(result.factors.glosas_cents).toBe(0);
      expect(factorsAddUp(result.factors)).toBe(true);
    });
```

- [ ] Rodar todos os testes do arquivo e confirmar que TODOS passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: todos os 7 testes passam (4 antigos + 3 novos):
1. `soma dos fatores iguala delta total` — passa
2. `fator de faltas reflete aumento` — passa
3. `glosas sao zero (TISS nao implementado)` — passa (dataset sem glosas)
4. `periodos sem dados retornam delta zero` — passa
5. `glosas no periodo A e nenhuma no B → fator positivo` — passa
6. `glosas no periodo B e nenhuma no A → fator negativo` — passa
7. `sem glosas em nenhum periodo → fator continua zero` — passa

- [ ] Commitar:

```bash
git add packages/reports/src/compute-variation.int.test.ts
git commit -m "test(reports): add inverse and zero glosa scenarios for variation

Verifies that accepted glosas in period B produce negative factor,
and that absence of glosas in both periods keeps the factor at zero.
Additive property holds in all scenarios.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
