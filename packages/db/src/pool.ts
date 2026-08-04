import { Pool } from 'pg';

let business: Pool | undefined;
let audit: Pool | undefined;
let jobs: Pool | undefined;
let app: Pool | undefined;

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

/**
 * Pool do papel `jobs` — o UNICO do cluster com BYPASSRLS (§3.1). Existe para
 * selo diario, detector de divergencia do financeiro, carga bimestral da TUSS e
 * montagem de cenario nos testes. NUNCA serve caminho de requisicao: aqui a RLS
 * nao filtra nada, e o isolamento entre clinicas deixa de existir.
 *
 * BYPASSRLS ignora POLICY, nao ignora GRANT: cada migration que cria tabela usada
 * por job ou por fixture precisa conceder privilegio a `jobs` explicitamente.
 */
export function jobsPool(): Pool {
  jobs ??= new Pool({
    connectionString: requireEnv('DATABASE_URL_JOBS'),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cadencia-jobs',
  });
  return jobs;
}

/**
 * Pool da aplicacao para o que acontece FORA de uma transacao de negocio:
 * resolucao de sessao (que precisa rodar ANTES de existir tenant) e consulta de
 * terminologia global (`ref.*`, sem RLS). Nunca substitui withTenantTx — nada
 * que leia tabela com tenant_id passa por aqui.
 *
 * `api` foi criado NOINHERIT na 0001: sem o SET ROLE abaixo, toda query retorna
 * 42501. A query e enfileirada na conexao antes de qualquer outra, porque o `pg`
 * mantem uma fila FIFO por cliente.
 */
export function appPool(): Pool {
  if (app === undefined) {
    const created = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'cadencia-app',
    });
    created.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });
    app = created;
  }
  return app;
}

/** Fecha todos os pools. Usado no shutdown do processo e entre arquivos de teste. */
export async function closePools(): Promise<void> {
  const pools = [business, audit, jobs, app].filter((p): p is Pool => p !== undefined);
  business = undefined;
  audit = undefined;
  jobs = undefined;
  app = undefined;
  await Promise.all(pools.map((p) => p.end()));
}
