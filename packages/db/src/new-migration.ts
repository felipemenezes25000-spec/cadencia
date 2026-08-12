import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextMigrationName } from './migration-files';
import { migrationsDir } from './paths';

const slug = process.argv[2];
if (slug === undefined) {
  console.error('uso: pnpm db:new <nome_da_migration>   (exemplo: pnpm db:new transaction_context)');
  process.exit(1);
}

const dir = migrationsDir();
const name = nextMigrationName(readdirSync(dir), slug);
const path = join(dir, name);

writeFileSync(
  path,
  [
    `-- ${name}`,
    '-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.',
    '-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.',
    '',
    '',
  ].join('\n'),
  { flag: 'wx' },
);

console.log(path);
