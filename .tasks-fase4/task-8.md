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