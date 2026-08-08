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