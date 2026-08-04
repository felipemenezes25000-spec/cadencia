/**
 * Invariante de CI (§3.13 item 8, §3.9): terminologia se resolve pela DATA DO
 * EVENTO. Nenhuma leitura de relogio pode aparecer em codigo de terminologia --
 * nem no TypeScript de `catalogs`, nem no SQL das migrations de `ref`/`tiss`.
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
