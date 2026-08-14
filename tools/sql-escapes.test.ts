import { describe, expect, it } from 'vitest';
import { findSqlEscapeViolations } from './sql-escapes';

const arq = 'teste.sql';

describe('findSqlEscapeViolations', () => {
  it('acusa \\n dentro de string de aspas simples', () => {
    const v = findSqlEscapeViolations("INSERT INTO t VALUES ('linha1\\nlinha2');", arq);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it('aceita E-string, onde a barra invertida e escape de verdade', () => {
    expect(findSqlEscapeViolations("SELECT E'linha1\\nlinha2';", arq)).toEqual([]);
  });

  it('aceita dollar-quoting usado como dado', () => {
    expect(findSqlEscapeViolations('INSERT INTO t VALUES ($$a\\nb$$);', arq)).toEqual([]);
  });

  it('entra em bloco DO $$, cujo corpo volta a ser SQL', () => {
    /* Este e o caso da 0169: a bula quebrada mora dentro de um DO. Um scanner
       que trata todo dollar-quote como opaco passa direto por ela. */
    const sql = [
      'DO $$',
      'BEGIN',
      "  INSERT INTO t VALUES ('TYLENOL\\n\\nCOMPOSICAO');",
      'END $$;',
    ].join('\n');
    const v = findSqlEscapeViolations(sql, arq);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
  });

  it('entra em corpo de funcao (AS $$)', () => {
    const sql = "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT 'a\\nb' $$;";
    expect(findSqlEscapeViolations(sql, arq)).toHaveLength(1);
  });

  it('ignora comentario de linha e de bloco', () => {
    expect(findSqlEscapeViolations("-- exemplo: 'a\\nb'\nSELECT 1;", arq)).toEqual([]);
    expect(findSqlEscapeViolations("/* 'a\\nb' */ SELECT 1;", arq)).toEqual([]);
  });

  it('trata aspa duplicada como continuacao da mesma string', () => {
    /* Sem isto, `''` fecharia a string cedo e o resto do texto seria lido como
       codigo — o scanner perderia o rastro do arquivo inteiro a partir dali. */
    const v = findSqlEscapeViolations("SELECT 'nao''e o fim\\nainda dentro';", arq);
    expect(v).toHaveLength(1);
  });

  it('reporta uma vez por string, nao uma por escape', () => {
    const v = findSqlEscapeViolations("SELECT 'a\\nb\\nc\\nd';", arq);
    expect(v).toHaveLength(1);
  });

  it('reporta a linha de abertura da string, nao a do escape', () => {
    const sql = ["SELECT 1;", "INSERT INTO t VALUES ('inicio", "meio\\nfim');"].join('\n');
    expect(findSqlEscapeViolations(sql, arq)[0]?.line).toBe(2);
  });

  it('nao acusa barra invertida sem escape reconhecivel', () => {
    expect(findSqlEscapeViolations("SELECT 'caminho\\\\servidor';", arq)).toEqual([]);
  });
});
