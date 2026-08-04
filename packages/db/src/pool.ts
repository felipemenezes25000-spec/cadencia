import { Pool } from 'pg';

let business: Pool | undefined;
let audit: Pool | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`variavel de ambiente ausente: ${name}`);
  }
  return value;
}

/**
 * Pool de negocio. Toda transacao de dominio passa por withTenantTx, que e a
 * unica funcao do sistema autorizada a abrir transacao neste pool.
 */
export function businessPool(): Pool {
  business ??= new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cadencia-business',
  });
  return business;
}

/**
 * §2.1 e §3.7 canal B — auditoria de seguranca e acesso.
 * Duas conexoes, FORA da transacao de negocio: evento de negacao e o que o
 * auditor procura, e ele nasce dentro de uma transacao que vai dar ROLLBACK.
 * Se este pool fosse o mesmo do dominio, o registro sumiria junto com a falha.
 */
export function auditPool(): Pool {
  audit ??= new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cadencia-audit',
  });
  return audit;
}

/** Fecha os dois pools. Usado no shutdown do processo e entre arquivos de teste. */
export async function closePools(): Promise<void> {
  const pools = [business, audit].filter((p): p is Pool => p !== undefined);
  business = undefined;
  audit = undefined;
  await Promise.all(pools.map((p) => p.end()));
}
