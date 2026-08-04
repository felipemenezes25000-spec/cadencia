import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenantTx, appPool, type Actor, type TxClient } from '@cadencia/db';
import {
  resolveSession, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER,
  csrfMatches, resolveMemberships, type MembershipRow,
} from '@cadencia/authn';

export interface RequestContext {
  readonly actor: Extract<Actor, { kind: 'user' }>;
  readonly memberships: readonly MembershipRow[];
  readonly sessionId: string;
}

export type ContextFailure =
  | { status: 401; erro: 'sem_sessao' }
  | { status: 403; erro: 'sem_vinculo_na_unidade' }
  | { status: 400; erro: 'unidade_nao_informada' }
  | { status: 403; erro: 'csrf_invalido' };

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function resolveContext(
  req: FastifyRequest,
): Promise<{ ok: true; value: RequestContext } | { ok: false; error: ContextFailure }> {
  if (METODOS_MUTANTES.has(req.method)) {
    const cookieCsrf = req.cookies[CSRF_COOKIE];
    const headerCsrf = req.headers[CSRF_HEADER];
    if (!csrfMatches(cookieCsrf, typeof headerCsrf === 'string' ? headerCsrf : undefined)) {
      return { ok: false, error: { status: 403, erro: 'csrf_invalido' } };
    }
  }

  const token = req.cookies[SESSION_COOKIE];
  if (token === undefined || token === '') {
    return { ok: false, error: { status: 401, erro: 'sem_sessao' } };
  }

  const sessao = await resolveSession(appPool(), token);
  if (!sessao.ok) {
    return { ok: false, error: { status: 401, erro: 'sem_sessao' } };
  }

  const clinicIdHeader = req.headers['x-clinic-id'];
  const clinicId = typeof clinicIdHeader === 'string' ? clinicIdHeader : '';
  if (clinicId === '') {
    return { ok: false, error: { status: 400, erro: 'unidade_nao_informada' } };
  }

  const tenantId = sessao.value.activeTenantId;
  if (!tenantId) {
    return { ok: false, error: { status: 401, erro: 'sem_sessao' } };
  }

  const preAtor: Extract<Actor, { kind: 'user' }> = {
    kind: 'user', tenantId, userId: sessao.value.userId,
    clinicId, requestId: String(req.id),
  };
  const memberships = await withTenantTx(preAtor, (tx: TxClient) =>
    resolveMemberships(tx as unknown as Parameters<typeof resolveMemberships>[0],
                       sessao.value.userId, tenantId));

  if (!memberships.some((m) => m.clinicId === clinicId)) {
    return { ok: false, error: { status: 403, erro: 'sem_vinculo_na_unidade' } };
  }

  return { ok: true, value: {
    actor: preAtor, memberships, sessionId: sessao.value.sessionId } };
}

export async function comTransacao<T>(
  req: FastifyRequest, reply: FastifyReply,
  fn: (tx: TxClient, ctx: RequestContext) => Promise<T>,
): Promise<T | undefined> {
  const ctx = await resolveContext(req);
  if (!ctx.ok) {
    await reply.code(ctx.error.status).send({ erro: ctx.error.erro });
    return undefined;
  }
  return withTenantTx(ctx.value.actor, (tx) => fn(tx, ctx.value));
}
