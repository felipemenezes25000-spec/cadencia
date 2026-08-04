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

  it('a arvore real do repositorio esta limpa', () => {
    const arquivos = collectTerminologyFiles();
    // Se der zero, o glob esta errado e o invariante nao esta olhando para nada.
    expect(TERMINOLOGY_GLOBS.length).toBeGreaterThan(0);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(findClockUsages(arquivos)).toEqual([]);
  });
});
