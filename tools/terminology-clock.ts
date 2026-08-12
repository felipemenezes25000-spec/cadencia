/**
 * Invariante de CI (§3.13 item 8, §3.9): terminologia se resolve pela DATA DO
 * EVENTO. Nenhuma leitura de relógio pode aparecer em código de terminologia --
 * nem no TypeScript de `catalogs`, nem no SQL das migrations de `ref`/`tiss`,
 * nem no TypeScript de `tiss` (que gera queries para tiss.*).
 *
 * clock_timestamp() continua permitido: é a fonte de tempo de created_at, que
 * registra QUANDO a linha foi gravada, não a competência consultada.
 *
 * O verificador NÃO distingue código de comentário, de propósito: mencionar o
 * token em prosa dentro de packages/catalogs/** ou de migration de ref/tiss
 * também reprova. Escreva "o relógio de quem executa", nunca o token literal.
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

/** Varre a árvore a partir do diretório corrente (o vitest roda na raiz). */
export function collectTerminologyFiles(
  raiz: string = process.cwd(),
): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const visitar = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      // `.claude` guarda os worktrees de agente — o repositório dentro do
      // repositório. Hoje os globs ancorados em `^packages/` já não casam com
      // `.claude/worktrees/<nome>/packages/...`, então a varredura sobrevive por
      // acidente da ancoragem. O lint irmão (session-guc) NÃO teve essa sorte e
      // reprovou a si mesmo através de uma cópia sua. Pular explicitamente custa
      // uma palavra e não depende de ninguém lembrar de ancorar o próximo glob.
      if (['node_modules', '.git', 'dist', '.next', 'coverage', '.claude'].includes(nome)) continue;
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
