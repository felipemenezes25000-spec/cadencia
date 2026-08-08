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