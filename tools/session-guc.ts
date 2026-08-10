import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface GucViolation {
  readonly file: string; // caminho relativo a raiz, com '/'
  readonly line: number; // 1-based
  readonly text: string; // a linha ofensora, sem espaco a esquerda
}

/**
 * Pega `SET app.x`, `SET LOCAL app.x` e `SET SESSION app.x`.
 * NAO pega `set_config('app.x', ..., TRUE)` (a forma correta) nem
 * `SET LOCAL ROLE app_rw` (nao ha ponto depois de `app`).
 */
const FORBIDDEN = /\bset\s+(?:local\s+|session\s+)?app\./i;

/**
 * Arquivos autorizados a conter a string proibida.
 * `packages/db/src/tx.ts` e o unico lugar do sistema que monta o preambulo (§3.2).
 * Os outros quatro sao os que documentam ou testam a propria regra: se ficarem de
 * fora, o lint reprova a si mesmo e o engenheiro desliga a regra em vez de arrumar.
 */
const ALLOWED_FILES = new Set([
  'packages/db/src/tx.ts',
  'packages/db/src/tx.int.test.ts',
  'tools/session-guc.ts',
  'tools/session-guc.test.ts',
  'tools/check-session-guc.ts',
]);

/**
 * `.claude` entra aqui porque abriga os worktrees de agente — o repositorio
 * clonado DENTRO do repositorio. Sem pular, o lint acha a copia dos arquivos que
 * ele proprio autoriza (`tools/session-guc.ts` vira
 * `.claude/worktrees/<nome>/tools/session-guc.ts`, ausente de ALLOWED_FILES) e
 * reprova a si mesmo. Nao e hipotese: derrubou um `git push` com typecheck,
 * arch, as tres suites e o build todos verdes, e a mensagem apontava para
 * arquivos que ninguem tinha editado.
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.claude',
]);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql'];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
}

export function findSessionGucViolations(root: string): GucViolation[] {
  const files: string[] = [];
  walk(root, files);

  const violations: GucViolation[] = [];
  for (const absolute of files.sort()) {
    const file = relative(root, absolute).split(sep).join('/');
    if (ALLOWED_FILES.has(file)) continue;

    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      if (FORBIDDEN.test(text)) {
        violations.push({ file, line: index + 1, text: text.trim() });
      }
    });
  }
  return violations;
}
