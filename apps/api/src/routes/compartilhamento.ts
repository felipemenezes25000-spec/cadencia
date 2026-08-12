import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

/**
 * Compartilhar o prontuário de um paciente com outro profissional.
 *
 * A política RESTRICTIVE `clinical_scope` em `clin.encounter` só libera o
 * atendimento para quem o atendeu, para quem tem escopo amplo, ou para quem
 * consta em `clin.record_share`. Sem esta rota a terceira porta existia no banco
 * e não existia no produto: o colega via 404 e não havia como liberar — o que
 * parece defeito e é, na verdade, a garantia funcionando sem interruptor.
 *
 * O motivo é obrigatório porque a pergunta que a auditoria faz não é "quem
 * acessou", e sim "por que este médico viu este paciente".
 */
export async function compartilhamentoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/compartilhamentos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        granteeProfessionalId: z.string().uuid(),
        // Mínimo real, não decorativo: "ok" cumpre a coluna e não explica nada.
        reason: z.string().trim().min(5).max(500),
        expiraEm: z.string().datetime().optional(),
      }),
      response: {
        201: z.object({ shareId: z.string().uuid() }),
      },
    },
  }, rota('record.share', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      patientId: string; granteeProfessionalId: string;
      reason: string; expiraEm?: string };

    const shareId = uuidv7();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO clin.record_share
         (id, patient_id, grantee_professional_id, granted_by_professional_id,
          reason, expires_at, break_glass)
       VALUES ($1, $2, $3, app.current_professional_id(), $4, $5::timestamptz, false)
       RETURNING id`,
      [shareId, b.patientId, b.granteeProfessionalId, b.reason.trim(),
       b.expiraEm ?? null]);

    if (rows[0] === undefined) erroDominio('compartilhamento_recusado', 422);
    void reply.code(201);
    return { shareId };
  }));

  r.get('/v1/pacientes/:id/compartilhamentos', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            shareId: z.string().uuid(),
            granteeProfessionalId: z.string().uuid(),
            granteeNome: z.string(),
            concedidoPor: z.string(),
            motivo: z.string(),
            concedidoEm: z.string(),
            expiraEm: z.string().nullable(),
            quebraVidro: z.boolean(),
          })),
        }),
      },
    },
  }, rota('record.share', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; grantee_professional_id: string; grantee_nome: string | null;
      concedido_por: string | null; reason: string; concedido_em: string;
      expira_em: string | null; break_glass: boolean;
    }>(
      `SELECT s.id, s.grantee_professional_id,
              ug.full_name AS grantee_nome,
              uc.full_name AS concedido_por,
              s.reason,
              to_char(s.granted_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS concedido_em,
              to_char(s.expires_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS expira_em,
              s.break_glass
         FROM clin.record_share s
         JOIN app.professional pg
              ON (pg.tenant_id, pg.id) = (s.tenant_id, s.grantee_professional_id)
         JOIN id."user" ug ON ug.id = pg.user_id
         LEFT JOIN app.professional pc
              ON (pc.tenant_id, pc.id) = (s.tenant_id, s.granted_by_professional_id)
         LEFT JOIN id."user" uc ON uc.id = pc.user_id
        WHERE s.patient_id = $1
          AND s.revoked_at IS NULL
          -- Compartilhamento vencido não é acesso: suma da lista pelo mesmo
          -- critério que a policy usa, senão a tela mostra permissão que o
          -- banco já não concede.
          AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())
        ORDER BY s.granted_at DESC`,
      [p.id]);

    return {
      itens: rows.map((x) => ({
        shareId: x.id,
        granteeProfessionalId: x.grantee_professional_id,
        granteeNome: x.grantee_nome ?? '',
        concedidoPor: x.concedido_por ?? '',
        motivo: x.reason,
        concedidoEm: x.concedido_em,
        expiraEm: x.expira_em,
        quebraVidro: x.break_glass,
      })),
    };
  }));

  r.delete('/v1/compartilhamentos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 204: z.null() },
    },
  }, rota('record.share', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    // UPDATE e não DELETE: quem teve acesso e por quanto tempo é material de
    // auditoria. Apagar a linha apagaria a resposta de "quem viu este
    // prontuário em março".
    const { rowCount } = await tx.query(
      `UPDATE clin.record_share
          SET revoked_at = clock_timestamp()
        WHERE id = $1 AND revoked_at IS NULL`,
      [p.id]);
    if (rowCount === 0) erroDominio('compartilhamento_nao_encontrado', 404);
    void reply.code(204);
    return null;
  }));
}
