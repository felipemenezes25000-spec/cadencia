import { randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import fp from 'fastify-plugin';
import type { FastifyReply } from 'fastify';
import {
  resolveSession, SESSION_IDLE_MINUTES,
  type Queryable, type ResolvedSession,
} from '../session';

/** Prefixo __Host-: o navegador so aceita com Secure, Path=/ e sem Domain. */
export const SESSION_COOKIE = '__Host-cadencia_sid';
export const CSRF_COOKIE = '__Host-cadencia_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const METODOS_INSEGUROS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Forma do evento de seguranca entregue ao canal B. Declarada aqui porque
 * `authn` nao importa `@cadencia/audit` (irmaos em L0, §2.2 regra 2): quem liga
 * as duas pontas e `apps/api`, passando `onSecurityEvent`.
 */
export interface SecurityEventInput {
  readonly eventType: string;
  readonly outcome: 'sucesso' | 'negado' | 'erro';
  readonly entitySchema: string;
  readonly entityTable: string;
  readonly actorKind: 'user' | 'system' | 'anon';
  readonly requestId: string;
  readonly ip?: string | null;
  readonly meta?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SessionPluginOptions {
  /** Pool que ja assume app_rw (appPool de @cadencia/db). */
  readonly db: Queryable;
  /** Gerador de id de requisicao (uuidv7 mora no kernel, que authn nao importa). */
  readonly newRequestId: () => string;
  /** Canal B da auditoria. Opcional para nao travar teste de rota isolada. */
  readonly onSecurityEvent?: (event: SecurityEventInput) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: ResolvedSession | null;
  }
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfMatches(
  cookieValue: string | undefined, headerValue: string | string[] | undefined,
): boolean {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookieValue || !header) return false;
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(header, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function issueSessionCookies(reply: FastifyReply, sessionToken: string): void {
  const base = {
    path: '/', secure: true, sameSite: 'lax' as const,
    maxAge: SESSION_IDLE_MINUTES * 60,
  };
  reply.setCookie(SESSION_COOKIE, sessionToken, { ...base, httpOnly: true });
  // Legivel por JS de proposito: o front le e reenvia no header (double-submit).
  reply.setCookie(CSRF_COOKIE, newCsrfToken(), { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export const sessionPlugin = fp<SessionPluginOptions>(async (app, opts) => {
  await app.register(cookie);

  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req, reply) => {
    if (METODOS_INSEGUROS.has(req.method)) {
      if (!csrfMatches(req.cookies[CSRF_COOKIE], req.headers[CSRF_HEADER])) {
        await opts.onSecurityEvent?.({
          eventType: 'CSRF_REJECTED',
          entitySchema: 'id', entityTable: 'session',
          outcome: 'negado', actorKind: 'anon',
          requestId: (req.headers['x-request-id'] as string | undefined) ?? opts.newRequestId(),
          ip: req.ip, meta: { method: req.method, route: req.url },
        });
        return reply.code(403).send({ error: 'csrf_invalido' });
      }
    }

    // Metodo seguro sem cookie de CSRF: emite um agora. Sem este caminho o
    // primeiro POST /v1/login de todo navegador cai no 403 acima -- o front nao
    // tem como fabricar um cookie __Host- para reenviar no header.
    if (!METODOS_INSEGUROS.has(req.method) && !req.cookies[CSRF_COOKIE]) {
      reply.setCookie(CSRF_COOKIE, newCsrfToken(), {
        path: '/', secure: true, sameSite: 'lax', httpOnly: false,
        maxAge: SESSION_IDLE_MINUTES * 60,
      });
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;

    const r = await resolveSession(opts.db, token);
    if (r.ok) {
      req.session = r.value;
      return;
    }
    // Sessao morta: limpa o cookie e segue como anonimo. Quem exige sessao e a
    // rota, via authz -- este hook nao decide autorizacao.
    clearSessionCookies(reply);
    await opts.onSecurityEvent?.({
      eventType: 'SESSION_REJECTED',
      entitySchema: 'id', entityTable: 'session',
      outcome: 'negado', actorKind: 'anon',
      requestId: (req.headers['x-request-id'] as string | undefined) ?? opts.newRequestId(),
      ip: req.ip, meta: { reason: r.error },
    });
  });
});
