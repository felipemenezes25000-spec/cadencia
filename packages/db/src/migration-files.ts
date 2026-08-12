import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationFile {
  readonly version: string; // '0001'
  readonly name: string; // '0001_roles.sql'
  readonly sql: string;
  readonly checksum: string; // sha256 hex do conteúdo
}

const MIGRATION_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function isMigrationName(name: string): boolean {
  return MIGRATION_NAME.test(name);
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function readMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter(isMigrationName)
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { version: name.slice(0, 4), name, sql, checksum: checksumOf(sql) };
    });
}

export function nextMigrationName(existing: readonly string[], slug: string): string {
  if (!SLUG.test(slug)) {
    throw new Error(
      `nome de migration invalido: "${slug}" (use apenas a-z, 0-9 e _, por exemplo transaction_context)`,
    );
  }
  const versions = existing.filter(isMigrationName).map((n) => Number(n.slice(0, 4)));
  const next = (versions.length === 0 ? 0 : Math.max(...versions)) + 1;
  if (next > 9999) {
    throw new Error('limite de 9999 migrations atingido');
  }
  return `${String(next).padStart(4, '0')}_${slug}.sql`;
}

/**
 * Regras forward-only, verificadas antes de qualquer escrita no banco:
 * 1. migration aplicada nunca muda de conteúdo (checksum);
 * 2. arquivo novo nunca entra com número menor que uma migration já aplicada
 *    (senão ele roda em produção numa ordem diferente da que rodou no dev);
 * 3. migration aplicada nunca some do repositório.
 */
export function assertForwardOnly(
  files: readonly MigrationFile[],
  applied: ReadonlyMap<string, string>,
): MigrationFile[] {
  const pending: MigrationFile[] = [];
  let lastApplied = '0000';

  for (const file of files) {
    const previousChecksum = applied.get(file.version);
    if (previousChecksum === undefined) {
      pending.push(file);
      continue;
    }
    if (previousChecksum !== file.checksum) {
      throw new Error(
        `migration ${file.name} foi alterada depois de aplicada: migrations sao forward-only, crie uma nova`,
      );
    }
    lastApplied = file.version;
  }

  for (const file of pending) {
    if (file.version <= lastApplied) {
      throw new Error(
        `migration ${file.name} e anterior a ${lastApplied} ja aplicada: renomeie para o proximo numero livre`,
      );
    }
  }

  const known = new Set(files.map((f) => f.version));
  const missing = [...applied.keys()].filter((v) => !known.has(v)).sort();
  if (missing.length > 0) {
    throw new Error(`migrations aplicadas e ausentes do repositorio: ${missing.join(', ')}`);
  }

  return pending;
}
