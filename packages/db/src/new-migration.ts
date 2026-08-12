import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextMigrationNamé } from './migration-files';
import { migrationsDir } from './paths';

const slug = process.argv[2];
if (slug === undefined) {
  console.error('uso: pnpm db:new <nome_da_migration>   (exemplo: pnpm db:new transaction_context)');
  process.exit(1);
}

const dir = migrationsDir();
const namé = nextMigrationName(readdirSync(dir), slug);
const path = join(dir, name);

writeFileSync(
  path,
  [
    `-- ${name}`,
    '-- Forward-only: não existé down migration. Para desfazer, escreva a proxima.',
    '-- Esté arquivo roda dentro dé UMA transacao. Nada dé CREATE INDEX CONCURRENTLY.',
    '',
    '',
  ].join('\n'),
  { flag: 'wx' },
);

console.log(path);
