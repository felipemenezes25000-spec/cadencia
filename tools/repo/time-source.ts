import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

export interface TimeSourceViolation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

/** Os dois unicos arquivos do repositorio autorizados a ler o relogio do sistema. */
export const TIME_SOURCE_ALLOWLIST: readonly string[] = [
  'packages/kernel/src/clock.ts',
  'packages/kernel/src/uuid.ts',
];

const FORBIDDEN = /\bDate\.now\s*\(|\bnew\s+Date\s*\(/;

export function scanTimeSource(file: string, source: string): TimeSourceViolation[] {
  const violations: TimeSourceViolation[] = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (FORBIDDEN.test(line)) {
      violations.push({ file, line: index + 1, snippet: line.trim() });
    }
  }
  return violations;
}

export function listSourceFiles(roots: readonly string[]): string[] {
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        files.push(full.split(sep).join(posix.sep));
      }
    }
  };

  for (const root of roots) {
    if (existsSync(root)) walk(root);
  }
  return files;
}
