import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogPool, closeCatalogPool } from './catalog';
import { PRIVILEGES_FILE, readEffectiveGrants, writeDeclaredGrants } from './inv07-privileges';

/**
 * `pnpm db:privileges` — regrava packages/db/privileges.json a partir do catalogo.
 * O arquivo gerado e RASCUNHO: ele descreve o estado atual do banco. O que o
 * invariante 7 garante daqui em diante e que ninguem muda esse estado sem revisao.
 */
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const grants = await readEffectiveGrants(catalogPool());
writeDeclaredGrants(grants);
await closeCatalogPool();

console.log(`${PRIVILEGES_FILE}: ${Object.keys(grants).length} relacoes declaradas`);
