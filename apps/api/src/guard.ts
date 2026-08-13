import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TxClient } from '@cadencia/db';
import { canWithOverrides, type AuthzSubject, type Role } from '@cadencia/authz';
import { comTransacao, type RequestContext } from './context';

interface RouteOptions {
  readonly clinicId?: (req: FastifyRequest) => string;
}

export function rota<T>(
  acao: string,
  handler: (tx: TxClient, ctx: RequestContext, req: FastifyRequest, reply: FastifyReply) => Promise<T>,
  options: RouteOptions = {},
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<T | void> => {
    const r = await comTransacao(req, reply, async (tx, ctx) => {
      const sujeito: AuthzSubject = {
        userId: ctx.actor.userId, tenantId: ctx.actor.tenantId,
        memberships: ctx.memberships.map((m) => ({ clinicId: m.clinicId, role: m.role })),
        mfaAt: ctx.mfaAt,
      };
      const clinicId = options.clinicId?.(req) ?? ctx.actor.clinicId;
      const roles = sujeito.memberships
        .filter((membership) => membership.clinicId === clinicId)
        .map((membership) => membership.role);
      const { rows: overrides } = roles.length === 0
        ? { rows: [] as { role: Role; allowed: boolean }[] }
        : await tx.query<{ role: Role; allowed: boolean }>(
          `SELECT role, allowed
             FROM app.permission_override
            WHERE clinic_id = $1 AND action_key = $2
              AND role = ANY($3::text[])`,
          [clinicId, acao, roles],
        );
      const d = canWithOverrides(sujeito, acao, { clinicId }, overrides);
      if (!d.allowed) {
        await tx.query(
          `SELECT audit.log('AUTHZ_DENY', 'ref', 'action', NULL, 'negado',
                            jsonb_build_object('acao', $1::text, 'motivo', $2::text), $3)`,
          [acao, d.reason, clinicId]);
        void reply.code(403).send({ erro: 'sem_permissao', acao, motivo: d.reason });
        return undefined;
      }
      return handler(tx, ctx, req, reply);
    });
    if (r === undefined) return;
    return r;
  };
}
