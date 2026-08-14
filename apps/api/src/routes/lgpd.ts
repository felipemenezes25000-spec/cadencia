import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const ConsentSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(['marketing', 'pesquisa', 'compartilhamento_terceiros', 'ia_analytics']),
  granted: z.boolean(),
  grantedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

const DataRequestSchema = z.object({
  id: z.string().uuid(),
  requestType: z.enum(['portabilidade', 'acesso', 'eliminacao']),
  status: z.enum(['pendente', 'em_andamento', 'concluido', 'recusado']),
  justification: z.string().nullable(),
  responseNote: z.string().nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
  expiresAt: z.string(),
});

export async function lgpdRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/pacientes/:id/consentimentos', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ itens: z.array(ConsentSchema) }) },
    },
  }, rota('lgpd.consent.read', async (tx, _ctx, req) => {
    const { id: patientId } = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; purpose: string; granted: boolean;
      granted_at: string | null; revoked_at: string | null;
    }>(
      `SELECT id, purpose::text, granted, granted_at, revoked_at
       FROM app.lgpd_consent
       WHERE patient_id = $1 AND revoked_at IS NULL
       ORDER BY purpose`,
      [patientId],
    );
    return {
      itens: rows.map((row) => ({
        id: row.id,
        purpose: row.purpose as 'marketing',
        granted: row.granted,
        grantedAt: row.granted_at,
        revokedAt: row.revoked_at,
      })),
    };
  }));

  r.put('/v1/pacientes/:id/consentimentos', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        purpose: z.enum(['marketing', 'pesquisa', 'compartilhamento_terceiros', 'ia_analytics']),
        granted: z.boolean(),
      }),
      response: { 200: z.object({ ok: z.boolean() }) },
    },
  }, rota('lgpd.consent.write', async (tx, ctx, req) => {
    const { id: patientId } = req.params as { id: string };
    const { purpose, granted } = req.body as { purpose: string; granted: boolean };

    if (granted) {
      await tx.query(
        `INSERT INTO app.lgpd_consent (tenant_id, patient_id, purpose, granted, granted_at, collected_by, ip_address)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2::app.lgpd_consent_purpose, true, now(), $3, $4::inet)
         ON CONFLICT (tenant_id, patient_id, purpose) WHERE revoked_at IS NULL
         DO UPDATE SET granted = true, granted_at = now(), collected_by = $3, updated_at = now()`,
        [patientId, purpose, ctx.actor.userId, req.ip],
      );

      await tx.query(
        `SELECT audit.log('LGPD_CONSENT_GRANTED', 'app', 'lgpd_consent', $1, 'sucesso',
                jsonb_build_object('patient_id', $2, 'purpose', $3), $4)`,
        [patientId, patientId, purpose, ctx.actor.clinicId],
      );
    } else {
      await tx.query(
        `UPDATE app.lgpd_consent
         SET revoked_at = now(), updated_at = now()
         WHERE patient_id = $1 AND purpose = $2::app.lgpd_consent_purpose
           AND revoked_at IS NULL`,
        [patientId, purpose],
      );

      await tx.query(
        `SELECT audit.log('LGPD_CONSENT_REVOKED', 'app', 'lgpd_consent', $1, 'sucesso',
                jsonb_build_object('patient_id', $2, 'purpose', $3), $4)`,
        [patientId, patientId, purpose, ctx.actor.clinicId],
      );
    }

    return { ok: true };
  }));

  r.get('/v1/pacientes/:id/lgpd/solicitacoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ itens: z.array(DataRequestSchema) }) },
    },
  }, rota('lgpd.data_request.read', async (tx, _ctx, req) => {
    const { id: patientId } = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; request_type: string; status: string;
      justification: string | null; response_note: string | null;
      created_at: string; processed_at: string | null; expires_at: string;
    }>(
      `SELECT id, request_type::text, status::text, justification, response_note,
              created_at, processed_at, expires_at
       FROM app.lgpd_data_request
       WHERE patient_id = $1
       ORDER BY created_at DESC`,
      [patientId],
    );
    return {
      itens: rows.map((row) => ({
        id: row.id,
        requestType: row.request_type as 'portabilidade',
        status: row.status as 'pendente',
        justification: row.justification,
        responseNote: row.response_note,
        createdAt: row.created_at,
        processedAt: row.processed_at,
        expiresAt: row.expires_at,
      })),
    };
  }));

  r.post('/v1/pacientes/:id/lgpd/solicitacoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        requestType: z.enum(['portabilidade', 'acesso', 'eliminacao']),
        justification: z.string().min(1).max(2000),
      }),
      response: { 201: z.object({ id: z.string().uuid() }) },
    },
  }, rota('lgpd.data_request.write', async (tx, ctx, req, reply) => {
    const { id: patientId } = req.params as { id: string };
    const { requestType, justification } = req.body as { requestType: string; justification: string };

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO app.lgpd_data_request (tenant_id, patient_id, request_type, requested_by, justification)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2::app.lgpd_request_type, $3, $4)
       RETURNING id`,
      [patientId, requestType, ctx.actor.userId, justification],
    );

    const requestId = rows[0]!.id;

    await tx.query(
      `SELECT audit.log('LGPD_DATA_REQUEST', 'app', 'lgpd_data_request', $1, 'sucesso',
              jsonb_build_object('patient_id', $2, 'request_type', $3), $4)`,
      [requestId, patientId, requestType, ctx.actor.clinicId],
    );

    void reply.status(201);
    return { id: requestId };
  }));

  r.put('/v1/lgpd/solicitacoes/:requestId/processar', {
    schema: {
      params: z.object({ requestId: z.string().uuid() }),
      body: z.object({
        status: z.enum(['em_andamento', 'concluido', 'recusado']),
        responseNote: z.string().max(2000).optional(),
      }),
      response: { 200: z.object({ ok: z.boolean() }) },
    },
  }, rota('lgpd.data_request.write', async (tx, ctx, req) => {
    const { requestId } = req.params as { requestId: string };
    const { status, responseNote } = req.body as { status: string; responseNote?: string };

    await tx.query(
      `UPDATE app.lgpd_data_request
       SET status = $1::app.lgpd_request_status,
           processed_by = $2,
           response_note = $3,
           processed_at = CASE WHEN $1 IN ('concluido', 'recusado') THEN now() ELSE processed_at END
       WHERE id = $4`,
      [status, ctx.actor.userId, responseNote ?? null, requestId],
    );

    await tx.query(
      `SELECT audit.log('LGPD_DATA_REQUEST_DONE', 'app', 'lgpd_data_request', $1, 'sucesso',
              jsonb_build_object('new_status', $2), $3)`,
      [requestId, status, ctx.actor.clinicId],
    );

    return { ok: true };
  }));
}
