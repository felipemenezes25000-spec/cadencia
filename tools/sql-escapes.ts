import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Procura `\n` (e demais escapes de barra invertida) dentro de string SQL de
 * ASPAS SIMPLES em migrations.
 *
 * Por que isso e um bug e nao estilo: com `standard_conforming_strings` ligado
 * — default do PostgreSQL desde a 9.1, e o que este banco usa — a barra
 * invertida dentro de aspas simples NAO e escape. `'a\nb'` sao os quatro
 * caracteres `a`, `\`, `n`, `b`, e nao `a`, quebra de linha, `b`. Para escape
 * seria preciso a sintaxe `E'a\nb'`.
 *
 * O sintoma nao aparece na migration: aparece meses depois, na tela que
 * renderiza o texto. Foi assim que as bulas de Tylenol, Advil e Amoxil (0169)
 * chegaram a producao como um paragrafo unico e corrido, com `\n\n` visivel no
 * meio da bula, enquanto a de Losartana (0177), escrita com dollar-quoting,
 * saia certa. Ninguem le 180 arquivos de migration procurando isso — o gate le.
 *
 * O scanner acompanha o estado lexico do arquivo porque um `\n` e legitimo em
 * comentario, em bloco dollar-quoted (onde nao ha escape nenhum e a barra e
 * literal de verdade) e em string com prefixo `E`.
 */
export interface SqlEscapeViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

type Estado =
  | { readonly tipo: 'codigo' }
  | { readonly tipo: 'aspas'; readonly comE: boolean }
  | { readonly tipo: 'dollar'; readonly tag: string }
  | { readonly tipo: 'comentario-linha' }
  | { readonly tipo: 'comentario-bloco' };

/** Casa a abertura de um bloco dollar-quoted: `$$` ou `$tag$`. */
const ABRE_DOLLAR = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Um bloco dollar-quoted precedido de `DO` ou de `AS` e CORPO DE CODIGO: o que
 * esta dentro dele volta a ser SQL, e as strings de aspas simples ali dentro
 * tem exatamente o mesmo problema de escape. Foi assim que a 0169 escapou de
 * uma primeira versao deste lint — as bulas quebradas moram dentro de um
 * `DO $$ ... END $$`, entao um scanner que trata dollar-quote como opaco passa
 * direto por elas.
 *
 * Precedido de qualquer outra coisa, o bloco e DADO (texto de bula, template,
 * termo de consentimento). Ali a barra invertida e literal de verdade e nao ha
 * nada a corrigir — varrer o conteudo so produziria falso positivo.
 */
const CORPO_DE_CODIGO = /\b(DO|AS)\s*$/i;

export function findSqlEscapeViolations(
  sql: string, arquivo: string, offsetDeLinha = 0,
): SqlEscapeViolation[] {
  const violacoes: SqlEscapeViolation[] = [];
  let estado: Estado = { tipo: 'codigo' };
  let linha = 1;
  /* Linha onde a string atual comeca. A violacao e reportada nela, e nao na
     linha do `\n`, porque strings de bula tem dezenas de linhas e o que o autor
     precisa achar e a abertura da string. */
  let linhaDaString = 1;
  let jaReportadaNestaString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i]!;
    const proximo = sql[i + 1];
    if (c === '\n') linha += 1;

    switch (estado.tipo) {
      case 'codigo': {
        if (c === '-' && proximo === '-') { estado = { tipo: 'comentario-linha' }; i += 1; break; }
        if (c === '/' && proximo === '*') { estado = { tipo: 'comentario-bloco' }; i += 1; break; }
        if (c === '$') {
          const m = ABRE_DOLLAR.exec(sql.slice(i));
          if (m) {
            const tag = m[0];
            const fim = sql.indexOf(tag, i + tag.length);
            /* Bloco sem fechamento e SQL invalido; deixar o banco reclamar. */
            if (fim !== -1 && CORPO_DE_CODIGO.test(sql.slice(0, i))) {
              const corpo = sql.slice(i + tag.length, fim);
              violacoes.push(...findSqlEscapeViolations(
                corpo, arquivo, offsetDeLinha + linha - 1,
              ));
              linha += corpo.split('\n').length - 1;
              i = fim + tag.length - 1;
              break;
            }
            estado = { tipo: 'dollar', tag };
            i += tag.length - 1;
            break;
          }
        }
        if (c === "'") {
          /* `E'...'` liga o escape de barra invertida. O `E` pode vir colado
             na aspa; espaco entre os dois nao e aceito pelo parser, entao
             olhar o caractere anterior basta. */
          const anterior = sql[i - 1];
          const comE = anterior === 'E' || anterior === 'e';
          estado = { tipo: 'aspas', comE };
          linhaDaString = linha;
          jaReportadaNestaString = false;
        }
        break;
      }

      case 'aspas': {
        if (c === '\\' && !estado.comE && !jaReportadaNestaString) {
          /* `\\` dentro de string sem `E` tambem e literal, mas so acusamos os
             escapes que o autor claramente quis: `\n`, `\t`, `\r`. */
          if (proximo === 'n' || proximo === 't' || proximo === 'r') {
            violacoes.push({
              file: arquivo,
              line: offsetDeLinha + linhaDaString,
              text: `string de aspas simples com \\${proximo} — barra invertida aqui e literal`,
            });
            jaReportadaNestaString = true;
          }
        }
        if (c === "'") {
          /* `''` e aspa escapada, continua na mesma string. */
          if (proximo === "'") { i += 1; break; }
          estado = { tipo: 'codigo' };
        }
        break;
      }

      case 'dollar': {
        if (c === '$' && sql.startsWith(estado.tag, i)) {
          i += estado.tag.length - 1;
          estado = { tipo: 'codigo' };
        }
        break;
      }

      case 'comentario-linha': {
        if (c === '\n') estado = { tipo: 'codigo' };
        break;
      }

      case 'comentario-bloco': {
        if (c === '*' && proximo === '/') { i += 1; estado = { tipo: 'codigo' }; }
        break;
      }
    }
  }

  return violacoes;
}

export function findSqlEscapeViolationsInDir(dir: string): SqlEscapeViolation[] {
  const violacoes: SqlEscapeViolation[] = [];
  for (const nome of readdirSync(dir).sort()) {
    if (!nome.endsWith('.sql')) continue;
    violacoes.push(...findSqlEscapeViolations(readFileSync(join(dir, nome), 'utf8'), nome));
  }
  return violacoes;
}
