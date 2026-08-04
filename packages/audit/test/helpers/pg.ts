import { Client } from 'pg';

const ROLE_RE = /^[a-z_][a-z0-9_]*$/;

function adminUrl(): string {
  const connectionString = process.env.DATABASE_URL_ADMIN;
  if (!connectionString) {
    throw new Error('DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`');
  }
  return connectionString;
}

/**
 * Abre uma conexao no banco local e assume o papel pedido.
 * A URL administrativa e a do superusuario do container; o SET ROLE e o que faz
 * a RLS valer, porque um superusuario que assume papel comum passa a ser filtrado.
 */
export async function connectAs(role: string): Promise<Client> {
  if (!ROLE_RE.test(role)) {
    throw new Error(`invalid role name: ${role}`);
  }
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  await client.query(`SET ROLE ${role}`);
  return client;
}

/**
 * Abre uma conexao SEM SET ROLE: continua superusuario. Usado para ler a trilha
 * nos testes (a RLS forcada da Task 26 nao deixa nem o dono da tabela ler) e,
 * na Task 27, para provar que o trigger detem inclusive o superusuario.
 */
export async function connectSuperuser(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  return client;
}

/**
 * Preambulo de contexto. O terceiro argumento de set_config e sempre TRUE:
 * o escopo e a TRANSACAO, nunca a sessao. Com PgBouncer em transaction mode a
 * conexao e reciclada entre tenants e um SET de sessao vazaria o tenant anterior.
 * Chame sempre depois de um BEGIN.
 */
export async function setContext(
  client: Client,
  ctx: {
    tenantId?: string;
    userId?: string;
    actorKind: 'user' | 'system' | 'anon';
    requestId?: string;
    sessionId?: string;
  },
): Promise<void> {
  await client.query(
    `SELECT set_config('app.tenant_id',  $1, TRUE),
            set_config('app.user_id',    $2, TRUE),
            set_config('app.actor_kind', $3, TRUE),
            set_config('app.request_id', $4, TRUE),
            set_config('app.session_id', $5, TRUE)`,
    [
      ctx.tenantId ?? '',
      ctx.userId ?? '',
      ctx.actorKind,
      ctx.requestId ?? '',
      ctx.sessionId ?? '',
    ],
  );
}
