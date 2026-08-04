import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
// O Vitest 4 removeu `GlobalSetupContext`: o global setup recebe o proprio
// TestProject, que expoe o mesmo `provide` usado abaixo.
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    isoAdminUrl: string;
    isoApiUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

// packages/db/test/iso/ -> packages/db/migrations/
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

async function aplicarMigrationsReais(admin: Client): Promise<string[]> {
  const arquivos = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (arquivos.length === 0) {
    throw new Error(`nenhuma migration encontrada em ${MIGRATIONS_DIR}`);
  }
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(MIGRATIONS_DIR, arquivo), 'utf8');
    try {
      await admin.query(sql);
    } catch (e) {
      throw new Error(`migration ${arquivo} falhou: ${(e as Error).message}`);
    }
  }
  return arquivos;
}

export default async function setup({ provide }: TestProject) {
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('cadencia')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const adminUrl = container.getConnectionUri();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  const aplicadas = await aplicarMigrationsReais(admin);
  // eslint-disable-next-line no-console
  console.log(`[test:iso] migrations aplicadas: ${aplicadas.join(', ')}`);

  // O papel `api` nasce LOGIN sem senha na migration 0001; o container precisa de uma.
  await admin.query(`ALTER ROLE api LOGIN PASSWORD 'api'`);
  await admin.query(`GRANT CONNECT ON DATABASE cadencia TO api`);

  // §3.1 torna `api` NOINHERIT: sem assumir app_rw a conexao nao tem GRANT nenhum e
  // nenhuma policy `TO app_rw` se aplica — tudo daria 42501. `options=-c role=app_rw`
  // faz o proprio servidor entrar em `SET ROLE app_rw` a cada conexao nova, o que vale
  // igualmente para o Client do harness e para o Pool do withTenantTx, sem codigo extra.
  const apiUrl =
    `postgresql://api:api@${container.getHost()}:${container.getPort()}/cadencia` +
    `?options=-c%20role%3Dapp_rw`;

  await admin.end();

  provide('isoAdminUrl', adminUrl);
  provide('isoApiUrl', apiUrl);

  return async () => {
    await container?.stop();
  };
}
