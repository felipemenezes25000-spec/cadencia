import { resolve } from 'node:path';
import { findSqlEscapeViolationsInDir } from './sql-escapes';

/**
 * Migration ja aplicada NAO pode ser editada: `assertForwardOnly` compara o
 * checksum do arquivo com o que ficou gravado em `public.schema_migration`, e
 * qualquer alteracao derruba a proxima migracao de todo banco existente. Onde o
 * defeito ja foi corrigido por uma migration posterior, o arquivo antigo fica
 * como esta e entra aqui — com o numero da migration que consertou, para que a
 * excecao seja auditavel e nao um silenciamento.
 */
const EXCECOES: Record<string, string> = {
  '0169_drug_seed.sql':
    'Bulas gravadas com \\n literal; reescritas pela 0183. O arquivo e imutavel '
    + '(checksum em schema_migration), entao a correcao veio por migration nova.',
};

const migrations = resolve(import.meta.dirname, '..', 'packages', 'db', 'migrations');
const violations = findSqlEscapeViolationsInDir(migrations)
  .filter((v) => EXCECOES[v.file] === undefined);

if (violations.length === 0) {
  console.log(
    'lint:sql-escapes — nenhuma migration nova usa \\n em string de aspas simples '
    + `(${Object.keys(EXCECOES).length} excecao historica justificada)`,
  );
  process.exit(0);
}

console.error(
  'lint:sql-escapes — `\\n` dentro de aspas simples NAO e quebra de linha.\n' +
    'Com standard_conforming_strings ligado (default), a barra invertida e literal:\n' +
    "  '...\\n...'   grava os caracteres  \\  n\n" +
    "  E'...\\n...'  grava a quebra de linha\n" +
    '  $$...$$      grava a quebra de linha escrita no proprio arquivo\n' +
    'Para texto longo (bula, template, termo) prefira dollar-quoting: o texto fica\n' +
    'legivel no diff e nao ha escape para errar.\n',
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
process.exit(1);
