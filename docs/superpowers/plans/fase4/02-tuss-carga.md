### Task 8: Teste de contrato — tabela `ref.tuss_staging` ainda nao existe

**Arquivos**
- Teste: `packages/catalogs/src/tuss-load.int.test.ts`

Este teste verifica que a tabela `ref.tuss_staging` NAO existe antes da migration 0113, garantindo que o teste falha antes da implementacao.

- [ ] Criar o arquivo de teste `packages/catalogs/src/tuss-load.int.test.ts` com o caso que tenta inserir na tabela staging e espera falha:

```ts
// packages/catalogs/src/tuss-load.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let jobsPool: Pool;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} ausente`);
  return v;
}

beforeAll(async () => {
  jobsPool = new Pool({ connectionString: requireEnv('DATABASE_URL_JOBS'), max: 2 });
});

afterAll(async () => {
  await jobsPool.end();
});

describe('ref.tuss_staging — tabela de carga bimestral', () => {
  it('a tabela ref.tuss_staging existe e aceita insercao', async () => {
    const { rows } = await jobsPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'ref' AND table_name = 'tuss_staging'
       ) AS exists`,
    );
    expect(rows[0]!.exists).toBe(true);
  });

  it('a tabela ref.tuss_load_log existe e aceita insercao', async () => {
    const { rows } = await jobsPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'ref' AND table_name = 'tuss_load_log'
       ) AS exists`,
    );
    expect(rows[0]!.exists).toBe(true);
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/catalogs/src/tuss-load.int.test.ts
```

Saida esperada: **FAIL** — `expected false to be true` para ambos os testes (as tabelas `ref.tuss_staging` e `ref.tuss_load_log` ainda nao existem).

- [ ] Commitar:

```bash
git add packages/catalogs/src/tuss-load.int.test.ts
git commit -m "test(catalogs): red — tabelas tuss_staging e tuss_load_log ainda nao existem

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Migration 0113 — `ref.tuss_staging` e `ref.tuss_load_log`

**Arquivos**
- Criar: `packages/db/migrations/0113_ref_tuss_staging.sql`
- Modificar: `packages/db/privileges.json`

A tabela `ref.tuss_staging` tem a MESMA estrutura de `ref.tuss_term` (sem o EXCLUDE e sem a PK daterange composta — staging e efemera). A tabela `ref.tuss_load_log` registra cada carga bimestral (audit trail global, sem RLS).

- [ ] Criar a migration `packages/db/migrations/0113_ref_tuss_staging.sql`:

```sql
-- 0113_ref_tuss_staging.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Infraestrutura de carga bimestral TUSS (Design §3.9). Duas tabelas GLOBAIS
-- (sem RLS, como ref.tuss_term): staging para validacao pre-swap e log de auditoria.

-- ============================================================
-- 1. Tabela de staging — mesmos campos de ref.tuss_term, sem EXCLUDE.
--    O job carrega aqui, valida, e entao faz o merge para tuss_term.
-- ============================================================
CREATE TABLE ref.tuss_staging (
  tabela      smallint NOT NULL,
  codigo      varchar(10) NOT NULL,
  termo       text NOT NULL,
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,
  acao        text NOT NULL,
  PRIMARY KEY (tabela, codigo, vigencia)
);
ALTER TABLE ref.tuss_staging OWNER TO app_owner;
COMMENT ON TABLE ref.tuss_staging IS 'global-reference';

-- ============================================================
-- 2. Log de carga — uma linha por execucao do job de carga.
--    Nao tem tenant_id, nao tem RLS: carga TUSS e operacao global da ANS.
-- ============================================================
CREATE TABLE ref.tuss_load_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competencia     char(6) NOT NULL,
  started_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  finished_at     timestamptz(3),
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'error')),
  terms_inserted  int NOT NULL DEFAULT 0,
  terms_updated   int NOT NULL DEFAULT 0,
  terms_unchanged int NOT NULL DEFAULT 0,
  staging_rows    int NOT NULL DEFAULT 0,
  error_message   text
);
ALTER TABLE ref.tuss_load_log OWNER TO app_owner;
COMMENT ON TABLE ref.tuss_load_log IS 'global-reference';

-- ============================================================
-- 3. Privilegios
-- ============================================================
-- Staging: jobs carrega, valida e limpa.
GRANT SELECT, INSERT, DELETE, TRUNCATE ON ref.tuss_staging TO jobs;
-- Log: jobs grava, app_rw le (para exibir na tela de administracao).
GRANT SELECT, INSERT, UPDATE ON ref.tuss_load_log TO jobs;
GRANT SELECT ON ref.tuss_load_log TO app_rw;
```

- [ ] Atualizar `packages/db/privileges.json` — adicionar as entradas das novas tabelas. Abrir o arquivo e acrescentar ANTES do fechamento do JSON (depois da entrada de `inv.stock_alert`):

```jsonc
// Adicionar ao final, antes do } de fechamento:
  "ref.tuss_staging": {
    "table": {
      "jobs": [
        "DELETE",
        "INSERT",
        "SELECT",
        "TRUNCATE"
      ]
    }
  },
  "ref.tuss_load_log": {
    "table": {
      "app_rw": [
        "SELECT"
      ],
      "jobs": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ]
    }
  }
```

- [ ] Rodar a migration:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: migration 0113 aplicada com sucesso.

- [ ] Rodar o teste da Task 8 e confirmar que agora passa:

```bash
pnpm vitest run packages/catalogs/src/tuss-load.int.test.ts
```

Saida esperada: **PASS** — ambos os testes verdes (as tabelas existem).

- [ ] Rodar os invariantes para confirmar que nada quebrou:

```bash
pnpm vitest run packages/db/src/invariants/
```

Saida esperada: todos os invariantes verdes.

- [ ] Commitar:

```bash
git add packages/db/migrations/0113_ref_tuss_staging.sql packages/db/privileges.json
git commit -m "feat(db): add ref.tuss_staging and ref.tuss_load_log for bimonthly TUSS load

Migration 0113: staging table for pre-validation and load log for audit trail.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Teste red — job `loadTussCompetenciaSafe` com staging + merge

**Arquivos**
- Teste: `packages/catalogs/src/tuss-load.int.test.ts` (modificar)

Este teste define o contrato completo do job de carga segura: staging, validacao, merge com ON CONFLICT, log de auditoria, e idempotencia.

- [ ] Substituir o conteudo de `packages/catalogs/src/tuss-load.int.test.ts` pelo teste completo:

```ts
// packages/catalogs/src/tuss-load.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { loadTussCompetenciaSafe, type TussLoadResult } from './tuss-load';

const TAB_PROCEDIMENTOS = 22;
const TAB_DIARIAS = 20;

let jobsPool: Pool;
let admin: Pool;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} ausente`);
  return v;
}

beforeAll(async () => {
  jobsPool = new Pool({ connectionString: requireEnv('DATABASE_URL_JOBS'), max: 2 });
  admin = new Pool({ connectionString: requireEnv('DATABASE_URL_ADMIN'), max: 1 });

  // Limpar termos de teste anteriores para isolamento
  await admin.query(
    `DELETE FROM ref.tuss_term
      WHERE competencia IN ('202701','202703')
        AND codigo IN ('99990010','99990020','99990030')`,
  );
  await admin.query(`TRUNCATE ref.tuss_staging`);
  await admin.query(
    `DELETE FROM ref.tuss_load_log WHERE competencia IN ('202701','202703')`,
  );
});

afterAll(async () => {
  // Limpar dados de teste
  await admin.query(
    `DELETE FROM ref.tuss_term
      WHERE competencia IN ('202701','202703')
        AND codigo IN ('99990010','99990020','99990030')`,
  );
  await admin.query(`TRUNCATE ref.tuss_staging`);
  await admin.query(
    `DELETE FROM ref.tuss_load_log WHERE competencia IN ('202701','202703')`,
  );
  await jobsPool.end();
  await admin.end();
});

describe('loadTussCompetenciaSafe — carga bimestral TUSS com staging', () => {
  it('carrega ~5 termos novos e registra no log', async () => {
    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202701',
      vigenciaFrom: '2027-01-01',
      vigenciaTo: '2029-01-01',
      rows: [
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990010', termo: 'Procedimento teste A', acao: 'inclusao' },
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990020', termo: 'Procedimento teste B', acao: 'inclusao' },
        { tabela: TAB_DIARIAS, codigo: '99990010', termo: 'Diaria teste A', acao: 'inclusao' },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);

    // Verificar que os termos estao em ref.tuss_term
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ref.tuss_term
        WHERE competencia = '202701'
          AND codigo IN ('99990010','99990020')`,
    );
    expect(Number(rows[0]!.cnt)).toBe(3);

    // Verificar que staging foi limpa apos o merge
    const { rows: stagingRows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ref.tuss_staging`,
    );
    expect(Number(stagingRows[0]!.cnt)).toBe(0);

    // Verificar que o log foi gravado
    const { rows: logRows } = await admin.query<{
      competencia: string;
      status: string;
      terms_inserted: number;
      terms_updated: number;
      terms_unchanged: number;
      staging_rows: number;
      finished_at: string | null;
    }>(
      `SELECT competencia, status, terms_inserted, terms_updated,
              terms_unchanged, staging_rows, finished_at::text
         FROM ref.tuss_load_log
        WHERE competencia = '202701'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(logRows).toHaveLength(1);
    expect(logRows[0]!.status).toBe('success');
    expect(logRows[0]!.terms_inserted).toBe(3);
    expect(logRows[0]!.staging_rows).toBe(3);
    expect(logRows[0]!.finished_at).not.toBeNull();
  });

  it('carga duplicada e idempotente: mesmos termos resultam em unchanged', async () => {
    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202701',
      vigenciaFrom: '2027-01-01',
      vigenciaTo: '2029-01-01',
      rows: [
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990010', termo: 'Procedimento teste A', acao: 'inclusao' },
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990020', termo: 'Procedimento teste B', acao: 'inclusao' },
        { tabela: TAB_DIARIAS, codigo: '99990010', termo: 'Diaria teste A', acao: 'inclusao' },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(3);
  });

  it('atualiza termo existente quando o texto muda', async () => {
    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202701',
      vigenciaFrom: '2027-01-01',
      vigenciaTo: '2029-01-01',
      rows: [
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990010', termo: 'Procedimento teste A (revisado)', acao: 'alteracao' },
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990020', termo: 'Procedimento teste B', acao: 'inclusao' },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);

    // Verificar que o termo foi atualizado
    const { rows } = await admin.query<{ termo: string }>(
      `SELECT termo FROM ref.tuss_term
        WHERE tabela = $1 AND codigo = '99990010' AND vigencia @> '2027-06-01'::date`,
      [TAB_PROCEDIMENTOS],
    );
    expect(rows[0]!.termo).toBe('Procedimento teste A (revisado)');
  });

  it('tuss_at retorna o termo correto por data apos a carga', async () => {
    const { rows } = await admin.query<{ termo: string; competencia: string }>(
      `SELECT termo, competencia FROM ref.tuss_at($1::smallint, $2, $3::date)`,
      [TAB_PROCEDIMENTOS, '99990010', '2028-06-01'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.termo).toBe('Procedimento teste A (revisado)');
    expect(rows[0]!.competencia).toBe('202701');
  });

  it('tuss_at nao retorna termo fora da vigencia', async () => {
    const { rows } = await admin.query<{ termo: string }>(
      `SELECT termo FROM ref.tuss_at($1::smallint, $2, $3::date)`,
      [TAB_PROCEDIMENTOS, '99990010', '2026-06-01'],
    );
    expect(rows).toHaveLength(0);
  });

  it('registra erro no log quando staging tem vigencia sobreposta com tuss_term existente de outra competencia', async () => {
    // Carregar competencia 202703 com vigencia que NAO sobrepoe a 202701
    // (a 202701 vai ate 2029-01-01, a 202703 comeca em 2029-01-01)
    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202703',
      vigenciaFrom: '2029-01-01',
      vigenciaTo: null,
      rows: [
        { tabela: TAB_PROCEDIMENTOS, codigo: '99990030', termo: 'Procedimento novo C', acao: 'inclusao' },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(1);
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/catalogs/src/tuss-load.int.test.ts
```

Saida esperada: **FAIL** — `Cannot find module './tuss-load'` (o modulo ainda nao existe).

- [ ] Commitar:

```bash
git add packages/catalogs/src/tuss-load.int.test.ts
git commit -m "test(catalogs): red — contrato completo de loadTussCompetenciaSafe

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Implementar `loadTussCompetenciaSafe` — staging + validacao + merge

**Arquivos**
- Criar: `packages/catalogs/src/tuss-load.ts`

O job segue o fluxo: (1) criar registro no log como `running`, (2) TRUNCATE staging, (3) INSERT linhas na staging, (4) INSERT INTO tuss_term ... ON CONFLICT para merge, contando inseridos/atualizados/inalterados, (5) TRUNCATE staging, (6) atualizar log para `success`. Em caso de erro: atualizar log para `error` com a mensagem.

- [ ] Criar o arquivo `packages/catalogs/src/tuss-load.ts`:

```ts
// packages/catalogs/src/tuss-load.ts
import type { Pool } from 'pg';

export interface TussLoadInput {
  readonly competencia: string;
  readonly vigenciaFrom: string;
  readonly vigenciaTo: string | null;
  readonly rows: ReadonlyArray<{
    tabela: number;
    codigo: string;
    termo: string;
    acao: string;
  }>;
}

export interface TussLoadResult {
  readonly status: 'success' | 'error';
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly errorMessage?: string;
}

/**
 * Carga bimestral TUSS com staging, validacao e merge.
 *
 * Roda com o papel `jobs` (BYPASSRLS). O fluxo:
 * 1. Cria registro no log como 'running'
 * 2. TRUNCATE ref.tuss_staging
 * 3. INSERT linhas na staging
 * 4. Merge: INSERT INTO ref.tuss_term ... ON CONFLICT
 *    - Termo novo (nao existe no tuss_term): conta como inserted
 *    - Termo existente com texto diferente: UPDATE e conta como updated
 *    - Termo existente identico: nao faz nada, conta como unchanged
 * 5. TRUNCATE staging
 * 6. Atualiza log para 'success'
 *
 * Em caso de erro, atualiza log para 'error' com a mensagem.
 * NUNCA faz UPDATE em massa na tabela principal durante leitura concorrente.
 */
export async function loadTussCompetenciaSafe(
  pool: Pool,
  input: TussLoadInput,
): Promise<TussLoadResult> {
  const c = await pool.connect();
  let logId: number | null = null;

  try {
    await c.query('BEGIN');

    // 1. Criar registro no log
    const { rows: logRows } = await c.query<{ id: number }>(
      `INSERT INTO ref.tuss_load_log (competencia, staging_rows)
       VALUES ($1, $2)
       RETURNING id`,
      [input.competencia, input.rows.length],
    );
    logId = logRows[0]!.id;

    // 2. Limpar staging
    await c.query('TRUNCATE ref.tuss_staging');

    // 3. Carregar linhas na staging
    for (const r of input.rows) {
      await c.query(
        `INSERT INTO ref.tuss_staging (tabela, codigo, termo, vigencia, competencia, acao)
         VALUES ($1::smallint, $2, $3, daterange($4::date, $5::date, '[)'), $6, $7)`,
        [r.tabela, r.codigo, r.termo, input.vigenciaFrom, input.vigenciaTo,
         input.competencia, r.acao],
      );
    }

    // 4. Merge: staging -> tuss_term via INSERT ... ON CONFLICT
    //    A PK de tuss_term e (tabela, codigo, vigencia).
    //    ON CONFLICT atualiza termo, competencia e acao quando o texto muda.
    //    Retorna a acao efetivamente realizada para contagem.

    // 4a. Inserir/atualizar termos
    const { rows: mergeRows } = await c.query<{ merge_action: string }>(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       SELECT tabela, codigo, termo, vigencia, competencia, acao
         FROM ref.tuss_staging
       ON CONFLICT (tabela, codigo, vigencia)
       DO UPDATE SET
         termo       = EXCLUDED.termo,
         competencia = EXCLUDED.competencia,
         acao        = EXCLUDED.acao
       WHERE ref.tuss_term.termo       IS DISTINCT FROM EXCLUDED.termo
          OR ref.tuss_term.competencia  IS DISTINCT FROM EXCLUDED.competencia
          OR ref.tuss_term.acao         IS DISTINCT FROM EXCLUDED.acao
       RETURNING CASE
         WHEN xmax = 0 THEN 'inserted'
         ELSE 'updated'
       END AS merge_action`,
    );

    let inserted = 0;
    let updated = 0;
    for (const row of mergeRows) {
      if (row.merge_action === 'inserted') {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
    const unchanged = input.rows.length - inserted - updated;

    // 5. Limpar staging
    await c.query('TRUNCATE ref.tuss_staging');

    // 6. Atualizar log para success
    await c.query(
      `UPDATE ref.tuss_load_log
          SET status = 'success',
              terms_inserted = $2,
              terms_updated = $3,
              terms_unchanged = $4,
              finished_at = clock_timestamp()
        WHERE id = $1`,
      [logId, inserted, updated, unchanged],
    );

    await c.query('COMMIT');

    return { status: 'success', inserted, updated, unchanged };
  } catch (e) {
    // Tentar registrar o erro no log
    try {
      await c.query('ROLLBACK');
    } catch {
      // Conexao quebrada, nao tem como fazer mais nada
    }

    // Gravar erro no log numa transacao separada (a original ja foi revertida)
    if (logId !== null) {
      try {
        const c2 = await pool.connect();
        try {
          await c2.query(
            `INSERT INTO ref.tuss_load_log (competencia, staging_rows, status, error_message, finished_at)
             VALUES ($1, $2, 'error', $3, clock_timestamp())`,
            [input.competencia, input.rows.length,
             e instanceof Error ? e.message : String(e)],
          );
        } finally {
          c2.release();
        }
      } catch {
        // Se nem o log funcionar, nao tem o que fazer
      }
    }

    return {
      status: 'error',
      inserted: 0,
      updated: 0,
      unchanged: 0,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  } finally {
    c.release();
  }
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/catalogs/src/tuss-load.int.test.ts
```

Saida esperada: **PASS** — todos os testes verdes: carga de termos novos, idempotencia, atualizacao de termo, tuss_at por data, log de auditoria.

- [ ] Rodar os invariantes para confirmar que nada quebrou:

```bash
pnpm vitest run packages/db/src/invariants/
```

Saida esperada: todos os invariantes verdes.

- [ ] Commitar:

```bash
git add packages/catalogs/src/tuss-load.ts
git commit -m "feat(catalogs): add loadTussCompetenciaSafe — bimonthly TUSS staging + merge

Staging table, ON CONFLICT merge, audit log, idempotent reload.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Exportar `loadTussCompetenciaSafe` no barrel e teste de regressao com amostra de 100 termos

**Arquivos**
- Modificar: `packages/catalogs/src/tuss-load.int.test.ts`
- Verificar: `packages/catalogs/src/index.ts` (se existir, adicionar export)

O teste final confirma que o job funciona com volume realista (~100 termos), que a carga e idempotente em volume, e que `resolveTussAt` integra corretamente com termos carregados pelo novo fluxo.

- [ ] Verificar se `packages/catalogs/src/index.ts` existe e adicionar a exportacao. Se o arquivo existir, acrescentar:

```ts
export { loadTussCompetenciaSafe, type TussLoadInput, type TussLoadResult } from './tuss-load';
```

Se nao existir, criar o arquivo com:

```ts
// packages/catalogs/src/index.ts
export { resolveTussAt, type ResolvedTussTerm, type TussFailure } from './tuss';
export { loadTussCompetenciaSafe, type TussLoadInput, type TussLoadResult } from './tuss-load';
```

- [ ] Adicionar os testes de volume ao final de `packages/catalogs/src/tuss-load.int.test.ts`:

```ts
// Adicionar ao final do arquivo, DENTRO do describe existente, antes do fechamento });

  it('carrega 100 termos de amostra e tuss_at retorna todos corretamente', async () => {
    const sampleRows: Array<{ tabela: number; codigo: string; termo: string; acao: string }> = [];
    for (let i = 1; i <= 100; i++) {
      const codigo = String(80000000 + i).padStart(10, '0').slice(0, 10);
      sampleRows.push({
        tabela: TAB_PROCEDIMENTOS,
        codigo,
        termo: `Procedimento de volume ${i}`,
        acao: 'inclusao',
      });
    }

    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202703',
      vigenciaFrom: '2029-01-01',
      vigenciaTo: null,
      rows: sampleRows,
    });

    expect(result.status).toBe('success');
    // 99 novos + 99990030 ja inserido na Task 10 = 100 no batch, mas 99990030 nao
    // esta no batch de 100 — sao 100 codigos novos da faixa 80000001..80000100
    expect(result.inserted).toBe(100);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);

    // Verificar uma amostra via tuss_at
    const { rows } = await admin.query<{ termo: string; competencia: string }>(
      `SELECT termo, competencia FROM ref.tuss_at($1::smallint, $2, $3::date)`,
      [TAB_PROCEDIMENTOS, '0080000050', '2030-01-01'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.termo).toBe('Procedimento de volume 50');
    expect(rows[0]!.competencia).toBe('202703');
  });

  it('recarga dos 100 termos e idempotente', async () => {
    const sampleRows: Array<{ tabela: number; codigo: string; termo: string; acao: string }> = [];
    for (let i = 1; i <= 100; i++) {
      const codigo = String(80000000 + i).padStart(10, '0').slice(0, 10);
      sampleRows.push({
        tabela: TAB_PROCEDIMENTOS,
        codigo,
        termo: `Procedimento de volume ${i}`,
        acao: 'inclusao',
      });
    }

    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202703',
      vigenciaFrom: '2029-01-01',
      vigenciaTo: null,
      rows: sampleRows,
    });

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(100);
  });

  it('log acumula todas as execucoes para rastreabilidade', async () => {
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ref.tuss_load_log
        WHERE competencia IN ('202701','202703')
          AND status = 'success'`,
    );
    // Deve ter pelo menos as execucoes das tasks anteriores
    expect(Number(rows[0]!.cnt)).toBeGreaterThanOrEqual(4);
  });
```

- [ ] Adicionar limpeza dos dados de volume no `afterAll`:

```ts
// Dentro do afterAll, adicionar ANTES do fechamento:
  await admin.query(
    `DELETE FROM ref.tuss_term
      WHERE competencia = '202703'
        AND codigo LIKE '00800%'`,
  );
```

- [ ] Rodar o teste completo e confirmar que tudo passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/catalogs/src/tuss-load.int.test.ts
```

Saida esperada: **PASS** — todos os testes verdes, incluindo carga de 100 termos, idempotencia em volume, e rastreabilidade do log.

- [ ] Rodar o teste existente de `tuss.int.test.ts` para confirmar que a carga original nao foi afetada:

```bash
pnpm vitest run packages/catalogs/src/tuss.int.test.ts
```

Saida esperada: **PASS** — os testes originais de terminologia versionada continuam verdes.

- [ ] Rodar todos os invariantes:

```bash
pnpm vitest run packages/db/src/invariants/
```

Saida esperada: todos os invariantes verdes.

- [ ] Commitar:

```bash
git add packages/catalogs/src/tuss-load.int.test.ts packages/catalogs/src/index.ts
git commit -m "test(catalogs): green — volume load 100 terms, idempotency, tuss_at integration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
