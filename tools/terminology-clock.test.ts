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
