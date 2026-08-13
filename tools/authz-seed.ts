/**
 * pnpm authz:seed         regenera ref.action e actions.lock.json a partir de actions.ts
 * pnpm authz:seed --check falha se o lock estiver desatualizado (invariante de CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIONS } from '../packages/authz/src/actions';
import { catalogRows, catalogChecksum } from '../packages/authz/src/catalog';
import { closePools, jobsPool } from '../packages/db/src/pool';
import { syncActionCatalog } from './sync-action-catalog';

// Este script roda em processo próprio (o teste o invoca por execFileSync) e
// não passa pelo setupFiles do vitest: sem isto, DATABASE_URL_JOBS não existe.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const LOCK = resolve(process.cwd(), 'packages/authz/actions.lock.json');

async function main(): Promise<void> {
  const rows = catalogRows(ACTIONS);
  const checksum = catalogChecksum(rows);
  const lockBody = `${JSON.stringify({ checksum, rows }, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const atual = existsSync(LOCK) ? readFileSync(LOCK, 'utf8') : '';
    if (atual !== lockBody) {
      console.error(
        'actions.lock.json esta desatualizado. Rode `pnpm authz:seed` e commite o resultado.',
      );
      process.exit(1);
    }
    console.log(`catalogo em dia: ${rows.length} acoes, checksum ${checksum}`);
    return;
  }

  writeFileSync(LOCK, lockBody, 'utf8');

  const client = await jobsPool().connect();
  try {
    await client.query('BEGIN');
    await syncActionCatalog(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`catalogo regenerado: ${rows.length} acoes, checksum ${checksum}`);
}

main()
  .then(() => closePools())
  .catch(async (e) => { console.error(e); await closePools(); process.exit(1); });
