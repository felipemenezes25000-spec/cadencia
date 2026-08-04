import { Client } from 'pg';

/**
 * Espelha o tipo Actor de packages/db/src/tx.ts, que so nasce na Task 15.
 * A duplicacao e deliberada: a suite de isolamento tem que existir ANTES da
 * funcao que abre transacao, e os dois tipos sao estruturalmente identicos —
 * na Task 16 os testes passam a importar o Actor de verdade.
 */
export type IsoActor =
  | { kind: 'user'; tenantId: string; userId: string; clinicId: string; requestId: string }
  | { kind: 'system'; tenantId: string; reason: string; requestId: string }
  | { kind: 'anon'; tenantId: string; requestId: string };

export async function openClient(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

/**
 * Replica, byte a byte, o preambulo que packages/db/src/tx.ts emite.
 * O terceiro argumento TRUE de set_config e o item mais importante do desenho:
 * torna a variavel LOCAL a transacao. Fora de uma transacao ele nao gruda,
 * por isso todo helper daqui abre BEGIN antes.
 */
export const PREAMBULO_SQL = `
  SELECT set_config('app.tenant_id',  $1, TRUE),
         set_config('app.user_id',    $2, TRUE),
         set_config('app.clinic_id',  $3, TRUE),
         set_config('app.actor_kind', $4, TRUE),
         set_config('app.request_id', $5, TRUE)`;

export async function aplicarPreambulo(client: Client, actor: IsoActor): Promise<void> {
  await client.query(PREAMBULO_SQL, [
    actor.tenantId,
    actor.kind === 'user' ? actor.userId : '',
    actor.kind === 'user' ? actor.clinicId : '',
    actor.kind,
    actor.requestId,
  ]);
}

/**
 * Abre transacao, aplica o preambulo, roda o corpo e SEMPRE faz ROLLBACK.
 * A suite de isolamento nunca deixa rastro: o canario da Task 18 depende disso.
 */
export async function comoAtor<T>(
  client: Client,
  actor: IsoActor,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await aplicarPreambulo(client, actor);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Transacao SEM preambulo nenhum: e o cenario do teste T5. */
export async function semContexto<T>(
  client: Client,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

/**
 * Contexto FORJADO: aceita tenantId e userId que nao combinam entre si.
 * Existe so para o teste T6 — nenhum codigo de producao pode montar isso.
 */
export async function comContextoForjado<T>(
  client: Client,
  ctx: { tenantId: string; userId: string; clinicId: string },
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(PREAMBULO_SQL, [
      ctx.tenantId,
      ctx.userId,
      ctx.clinicId,
      'user',
      '01930000-0000-7000-8000-0000000000ff',
    ]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

export interface ErroPg {
  code: string;
  message: string;
}

/** Executa fn esperando erro do PostgreSQL e devolve SQLSTATE + mensagem. */
export async function erroPg(fn: () => Promise<unknown>): Promise<ErroPg> {
  try {
    await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? 'sem-sqlstate', message: err.message ?? String(e) };
  }
  throw new Error('esperava erro do PostgreSQL, mas a operacao foi ACEITA');
}
