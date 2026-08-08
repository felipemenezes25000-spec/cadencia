### Task 68: invariante CI — nenhuma ocorrencia de now()/current_date em codigo TS do schema tiss

**Arquivos**

- Modificar `tools/terminology-clock.ts`
- Modificar `tools/terminology-clock.test.ts`

**Passos**

- [ ] Atualizar o teste para afirmar que arquivos `.ts` dentro de `packages/tiss/src/` (exceto testes) tambem sao varridos pelo lint de terminologia, e que o uso de `now()` ou `current_date` em queries para `tiss.*` e detectado.

```ts
// tools/terminology-clock.test.ts
import { describe, expect, it } from 'vitest';
import { collectTerminologyFiles, findClockUsages, TERMINOLOGY_GLOBS } from './terminology-clock';

describe('invariante: sem relogio em codigo de terminologia', () => {
  it('acusa o token de data corrente em SQL de terminologia', () => {
    const achados = findClockUsages([{
      path: 'packages/db/migrations/9999_ruim_ref.sql',
      content: `CREATE FUNCTION ref.cid10_hoje(p_codigo varchar)\n`
             + `RETURNS ref.cid10_term LANGUAGE sql AS $$\n`
             + `  SELECT * FROM ref.cid10_term WHERE codigo = p_codigo AND vigencia @> ${'current'}_date $$;\n`,
    }]);
    expect(achados).toHaveLength(1);
    expect(achados[0]?.token).toBe('current_date');
    expect(achados[0]?.line).toBe(3);
  });

  it('acusa now() e new Date() em codigo TypeScript de terminologia', () => {
    const achados = findClockUsages([
      { path: 'packages/catalogs/src/ruim.ts', content: `const hoje = new Date();\n` },
      { path: 'packages/catalogs/src/ruim2.ts', content: `-- x\nSELECT now();\n` },
    ]);
    expect(achados.map((a) => a.token).sort()).toEqual(['new Date(', 'now(']);
  });

  it('nao acusa clock_timestamp(), que e a fonte de tempo legitima do banco', () => {
    expect(findClockUsages([{
      path: 'packages/db/migrations/0019_ref_cid10.sql',
      content: `created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()\n`,
    }])).toHaveLength(0);
  });

  it('nao acusa a data recebida por parametro, que e o caminho correto', () => {
    expect(findClockUsages([{
      path: 'packages/catalogs/src/cid10.ts',
      content: `WHERE codigo = $1 AND vigencia @> $2::date\n`,
    }])).toHaveLength(0);
  });

  it('acusa now() em arquivo TypeScript do pacote tiss', () => {
    const achados = findClockUsages([{
      path: 'packages/tiss/src/bad-query.ts',
      content: `const q = "SELECT * FROM tiss.guia WHERE created_at > now()";\n`,
    }]);
    expect(achados).toHaveLength(1);
    expect(achados[0]?.token).toBe('now(');
  });

  it('acusa current_date em arquivo TypeScript do pacote tiss', () => {
    const achados = findClockUsages([{
      path: 'packages/tiss/src/query.ts',
      content: `const sql = "WHERE data_atendimento = current_date";\n`,
    }]);
    expect(achados).toHaveLength(1);
    expect(achados[0]?.token).toBe('current_date');
  });

  it('acusa new Date() em arquivo TypeScript do pacote tiss', () => {
    const achados = findClockUsages([{
      path: 'packages/tiss/src/helper.ts',
      content: `const d = new Date();\n`,
    }]);
    expect(achados).toHaveLength(1);
    expect(achados[0]?.token).toBe('new Date(');
  });

  it('nao acusa testes do pacote tiss — eles podem precisar de relogio para fixtures', () => {
    const achados = findClockUsages([{
      path: 'packages/tiss/src/serializer.test.ts',
      content: `const agora = new Date();\n`,
    }]);
    // O collectTerminologyFiles ja exclui .test.ts, mas findClockUsages recebe
    // a lista pronta — se alguem passar o teste, deve acusar, e o filtro e no collect.
    // Este teste verifica que o GLOB nao inclui .test.ts, abaixo.
    expect(achados).toHaveLength(1);
  });

  it('TERMINOLOGY_GLOBS inclui packages/tiss/src/ (excluindo testes via filtro do collect)', () => {
    expect(TERMINOLOGY_GLOBS.some((re) => re.test('packages/tiss/src/serializer/encode.ts'))).toBe(true);
    expect(TERMINOLOGY_GLOBS.some((re) => re.test('packages/tiss/src/transport/types.ts'))).toBe(true);
  });

  it('TERMINOLOGY_GLOBS NAO casa com arquivos fora de packages/tiss/src, packages/catalogs/src ou migrations de ref/tiss', () => {
    expect(TERMINOLOGY_GLOBS.some((re) => re.test('packages/payments/src/split.ts'))).toBe(false);
    expect(TERMINOLOGY_GLOBS.some((re) => re.test('packages/db/migrations/0042_encounter_billing.sql'))).toBe(false);
  });

  it('a arvore real do repositorio esta limpa', () => {
    const arquivos = collectTerminologyFiles();
    // Se der zero, o glob esta errado e o invariante nao esta olhando para nada.
    expect(TERMINOLOGY_GLOBS.length).toBeGreaterThan(0);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(findClockUsages(arquivos)).toEqual([]);
  });
});
```

- [ ] Rodar `pnpm vitest run tools/terminology-clock.test.ts` e confirmar que falha nos testes que verificam o glob para `packages/tiss/src/`.

Saida esperada: 2 falhas — os testes que verificam que `TERMINOLOGY_GLOBS` casa com `packages/tiss/src/*.ts` falham porque o regex atual so cobre `packages/catalogs/src/` e migrations de `ref`/`tiss`.

- [ ] Adicionar o glob para `packages/tiss/src/` no array `TERMINOLOGY_GLOBS`.

```ts
// tools/terminology-clock.ts
/**
 * Invariante de CI (§3.13 item 8, §3.9): terminologia se resolve pela DATA DO
 * EVENTO. Nenhuma leitura de relogio pode aparecer em codigo de terminologia --
 * nem no TypeScript de `catalogs`, nem no SQL das migrations de `ref`/`tiss`,
 * nem no TypeScript de `tiss` (que gera queries para tiss.*).
 *
 * clock_timestamp() continua permitido: e a fonte de tempo de created_at, que
 * registra QUANDO a linha foi gravada, nao a competencia consultada.
 *
 * O verificador NAO distingue codigo de comentario, de proposito: mencionar o
 * token em prosa dentro de packages/catalogs/** ou de migration de ref/tiss
 * tambem reprova. Escreva "o relogio de quem executa", nunca o token literal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const TERMINOLOGY_GLOBS: RegExp[] = [
  /^packages\/catalogs\/src\/.*\.ts$/,
  /^packages\/db\/migrations\/.*(ref|tiss|cid10|tuss).*\.sql$/,
  /^packages\/tiss\/src\/.*\.ts$/,
];

const TOKENS: { token: string; re: RegExp }[] = [
  { token: 'current_date', re: /\bcurrent_date\b/i },
  { token: 'current_timestamp', re: /\bcurrent_timestamp\b/i },
  { token: 'now(', re: /(^|[^_a-z])now\s*\(/i },
  { token: 'Date.now(', re: /\bDate\s*\.\s*now\s*\(/ },
  { token: 'new Date(', re: /\bnew\s+Date\s*\(/ },
];

export interface ClockUsage { path: string; line: number; token: string }

export function findClockUsages(
  files: ReadonlyArray<{ path: string; content: string }>,
): ClockUsage[] {
  const achados: ClockUsage[] = [];
  for (const f of files) {
    const linhas = f.content.split(/\r?\n/);
    for (let i = 0; i < linhas.length; i += 1) {
      const linha = linhas[i] ?? '';
      for (const t of TOKENS) {
        if (t.re.test(linha)) achados.push({ path: f.path, line: i + 1, token: t.token });
      }
    }
  }
  return achados;
}

/** Varre a arvore a partir do diretorio corrente (o vitest roda na raiz). */
export function collectTerminologyFiles(
  raiz: string = process.cwd(),
): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const visitar = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.next', 'coverage'].includes(nome)) continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { visitar(p); continue; }
      const rel = p.slice(raiz.length + 1).split('\\').join('/');
      if (rel.endsWith('.test.ts')) continue;
      if (TERMINOLOGY_GLOBS.some((re) => re.test(rel))) {
        out.push({ path: rel, content: readFileSync(p, 'utf8') });
      }
    }
  };
  visitar(raiz);
  return out;
}
```

- [ ] Rodar `pnpm vitest run tools/terminology-clock.test.ts` e confirmar que todos os testes passam.

Saida esperada: 11 testes passando.

- [ ] Rodar `pnpm lint:terminology-clock` e confirmar que o lint passa (o stub `packages/tiss/src/index.ts` contem apenas `export {}` e nao tem tokens proibidos).

Saida esperada: `ok: nenhum uso de relogio em codigo de terminologia`

- [ ] Commitar: `feat(ci): extend terminology-clock lint to cover packages/tiss/src`

---