import { beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { uuidv7 } from '@cadencia/kernel';
import { appPool, jobsPool } from '@cadencia/db';
import { createSession } from '../session';
import {
  sessionPlugin, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, issueSessionCookies,
  type SecurityEventInput,
} from './session-plugin';

const eventos: SecurityEventInput[] = [];

async function seedUser(): Promise<string> {
  const userId = uuidv7();
  // O email leva o uuid INTEIRO, nunca um prefixo: os 12 primeiros digitos hex
  // de um uuidv7 sao o timestamp em milissegundos, entao dois seedUser da mesma
  // rodada cairiam no mesmo prefixo e o segundo INSERT quebraria em
  // user_email_key (23505). Mesma razao documentada em session.int.test.ts.
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId}@exemplo.com.br`, 'Dra. Ana Ribeiro'],
  );
  return userId;
}

function buildApp(): FastifyInstance {
  const app = Fastify();
  // L3 e quem compoe: o pool vem de @cadencia/db, o id vem de @cadencia/kernel
  // e o canal de auditoria viria de @cadencia/audit. `authn` nao importa nenhum.
  app.register(sessionPlugin, {
    db: appPool(),
    newRequestId: () => uuidv7(),
    onSecurityEvent: async (e) => { eventos.push(e); },
  });
  app.get('/v1/ping', async (req) => ({ userId: req.session?.userId ?? null }));
  app.post('/v1/echo', async (req) => ({ userId: req.session?.userId ?? null }));
  app.post('/v1/login', async (_req, reply) => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    issueSessionCookies(reply, token);
    return { userId };
  });
  return app;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const bruto = res.headers['set-cookie'] as string[] | string | undefined;
  if (bruto === undefined) return [];
  return Array.isArray(bruto) ? bruto : [bruto];
}

describe('cookie de sessao e protecao CSRF', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = buildApp(); await app.ready(); });

  it('GET anonimo ja recebe o cookie de CSRF: senao o primeiro login e impossivel', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    const csrf = setCookies(res).find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    expect(csrf).toBeDefined();
    expect(csrf).toContain('Secure');
    expect(csrf).toContain('Path=/');
    expect(csrf).not.toContain('HttpOnly');   // o front precisa ler para reenviar
  });

  it('o cookie de sessao e HttpOnly, Secure, SameSite=Lax e usa o prefixo __Host-', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/login',
      headers: { [CSRF_HEADER]: 'x'.repeat(43) },
      cookies: { [CSRF_COOKIE]: 'x'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    const sid = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sid).toContain('HttpOnly');
    expect(sid).toContain('Secure');
    expect(sid).toContain('SameSite=Lax');
    expect(sid).toContain('Path=/');
    expect(sid).not.toContain('Domain=');
    const csrf = setCookies(res).find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Lax');
  });

  it('GET nao exige token CSRF e resolve a sessao do cookie', async () => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const res = await app.inject({
      method: 'GET', url: '/v1/ping', cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(userId);
  });

  it('POST com cookie de sessao valido e SEM header CSRF e recusado com 403', async () => {
    // E o formulario escondido num site de terceiro: o navegador manda o cookie,
    // mas nao consegue ler o cookie de CSRF para montar o header.
    eventos.length = 0;
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const res = await app.inject({
      method: 'POST', url: '/v1/echo',
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: 'a'.repeat(43) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf_invalido');
    // A recusa vira evento de seguranca: e o que o auditor procura.
    expect(eventos.map((e) => e.eventType)).toContain('CSRF_REJECTED');
  });

  it('POST com header CSRF diferente do cookie e recusado com 403', async () => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const res = await app.inject({
      method: 'POST', url: '/v1/echo',
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: 'a'.repeat(43) },
      headers: { [CSRF_HEADER]: 'b'.repeat(43) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST com header CSRF igual ao cookie passa', async () => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const csrf = 'c'.repeat(43);
    const res = await app.inject({
      method: 'POST', url: '/v1/echo',
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(userId);
  });

  it('sessao revogada nao chega na rota: request.session fica nulo', async () => {
    const userId = await seedUser();
    const { token, sessionId } = await createSession(appPool(), { userId });
    await appPool().query(
      `UPDATE id.session SET revoked_at = clock_timestamp(), revoked_reason = 'teste' WHERE id = $1`,
      [sessionId],
    );
    const res = await app.inject({
      method: 'GET', url: '/v1/ping', cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBeNull();
  });
});
