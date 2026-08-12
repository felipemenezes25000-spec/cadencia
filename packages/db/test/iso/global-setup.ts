import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { seedDoisTenants } from './seed';
import { impressaoDigitalDoTenantB } from './impressao-digital';
// O Vitest 4 removeu `GlobalSetupContext`: o global setup recebe o próprio
// TestProject, que expõe o mesmo `provide` usado abaixo.
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    isoAdminUrl: string;
    isoApiUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;
let impressaoAntes = '';

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

  await seedDoisTenants(admin);
  impressaoAntes = await impressaoDigitalDoTenantB(admin);

  // O papel `api` nasce LOGIN sem senha na migration 0001; o container precisa de uma.
  await admin.query(`ALTER ROLE api LOGIN PASSWORD 'api'`);
  await admin.query(`GRANT CONNECT ON DATABASE cadencia TO api`);

  // §3.1 torna `api` NOINHERIT: sem assumir app_rw a conexão não tem GRANT nenhum e
  // nenhuma policy `TO app_rw` se aplica — tudo daria 42501. `options=-c role=app_rw`
  // faz o próprio servidor entrar em `SET ROLE app_rw` a cada conexão nova, o que vale
  // igualmente para o Client do harness e para o Pool do withTenantTx, sem código extra.
  const apiUrl =
    `postgresql://api:api@${container.getHost()}:${container.getPort()}/cadencia` +
    `?options=-c%20role%3Dapp_rw`;

  await admin.end();

  provide('isoAdminUrl', adminUrl);
  provide('isoApiUrl', apiUrl);

  return async () => {
    // T7 — canário. A suite inteira rodou como tenant A. Nada do tenant B pode
    // ter mudado: nem linha nova, nem coluna alterada, nem linha removida.
    const conferencia = new Client({ connectionString: adminUrl });
    await conferencia.connect();
    let depois: string;
    try {
      depois = await impressaoDigitalDoTenantB(conferencia);
    } finally {
      await conferencia.end();
    }
    await container?.stop();

    if (depois !== impressaoAntes) {
      // O Vitest 4 apenas LOGA o erro do teardown ('error during close') e ainda
      // sai com código 0. Sem esta linha o canário viraria decoração: o pre-push
      // imprimiria o alarme e deixaria o push passar assim mesmo.
      process.exitCode = 1;
      throw new Error(
        'T7 CANARIO REPROVADO: a suite rodou inteira como tenant A e o estado do ' +
          `tenant B mudou (antes=${impressaoAntes.slice(0, 16)} ` +
          `depois=${depois.slice(0, 16)}). Isto e um vazamento entre clinicas.`,
      );
    }
  };
}
