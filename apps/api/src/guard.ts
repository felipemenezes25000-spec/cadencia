import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TxClient } from '@cadencia/db';
import { can, type AuthzSubject } from '@cadencia/authz';
import { comTransacao, type RequestContext } from './context';

export function rota<T>(
  acao: string,
  handler: (tx: TxClient, ctx: RequestContext, req: FastifyRequest, reply: FastifyReply) => Promise<T>,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<T | void> => {
    const r = await comTransacao(req, reply, async (tx, ctx) => {
      const sujeito: AuthzSubject = {
        userId: ctx.actor.userId, tenantId: ctx.actor.tenantId,
        memberships: ctx.memberships.map((m) => ({ clinicId: m.clinicId, role: m.role })),
        mfaAt: ctx.mfaAt,
      };
      const d = can(sujeito, acao, { clinicId: ctx.actor.clinicId });
      if (!d.allowed) {
        await tx.query(
          `SELECT audit.log('AUTHZ_DENY', 'ref', 'action', NULL, 'negado',
                            jsonb_build_object('acao', $1::text, 'motivo', $2::text), $3)`,
          [acao, d.reason, ctx.actor.clinicId]);
        void reply.code(403).send({ erro: 'sem_permissao', acao, motivo: d.reason });
        return undefined;
      }
      return handler(tx, ctx, req, reply);
    });
    if (r === undefined) return;
    return r;
  };
}
