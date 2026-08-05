import { Client, Pool, type PoolClient } from 'pg';

export type { Queryable } from '../queryable';

/**
 * Os schemas sujeitos ao regime multi-tenant (§3.13 item 1).
 * `ref`, `id`, `rpt` e `pgboss` ficam de fora por construcao: referencia global,
 * identidade global, relatorio (exposto so por view) e fila de jobs.
 * `sched` entrou na Fase 1 junto com a agenda: schema fora desta lista e schema
 * sem RLS obrigatoria, sem FK composta exigida e fora da matriz CRUD.
 */
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg'] as const;

let pool: Pool | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `variavel de ambiente ausente: ${name} — rode \`cp .env.example .env\`, \`pnpm db:up\` e \`pnpm db:migrate\``,
    );
  }
  return value;
}

/**
 * Conexao administrativa: enxerga o catalogo inteiro e ignora RLS de proposito.
 * Um invariante que rodasse sob RLS veria o schema pela fresta e aprovaria o que
 * nao consegue enxergar.
 */
export function catalogPool(): Pool {
  pool ??= new Pool({
    connectionString: requireEnv('DATABASE_URL_ADMIN'),
    max: 4,
    application_name: 'cadencia-invariants',
  });
  return pool;
}

export async function closeCatalogPool(): Promise<void> {
  const atual = pool;
  pool = undefined;
  await atual?.end();
}

/**
 * Conexao como o papel `api` — o mesmo papel de runtime, com os mesmos privilegios
 * e a mesma RLS. Usada pela matriz CRUD do invariante 10 (Task 45).
 */
export async function apiClient(): Promise<Client> {
  const client = new Client({
    connectionString: requireEnv('DATABASE_URL'),
    application_name: 'cadencia-invariants-api',
  });
  await client.connect();
  return client;
}

/**
 * Executa `fn` numa transacao SEMPRE revertida. DDL no PostgreSQL e transacional,
 * entao a violacao proposital nasce e morre dentro do teste, sem sujar o banco de
 * desenvolvimento nem o do CI.
 */
export async function inRollbackTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await catalogPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
