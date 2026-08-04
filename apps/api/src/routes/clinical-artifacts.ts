import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { issueDocument } from '@cadencia/documents';
import { openPrescriberSession, confirmPrescription } from '@cadencia/prescriptions';
import { exportRecord } from '@cadencia/export';
import { rota } from '../guard';
import { providers } from '../providers';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

export async function clinicalArtifactRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/documentos', {
    schema: {
      body: z.object({
        kind: z.enum(['atestado', 'pedido_exame', 'relatorio', 'declaracao_comparecimento']),
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        versionId: z.string().uuid().optional(),
        payload: z.record(z.unknown()),
      }),
      response: {
        201: z.object({
          documentId: z.string().uuid(), contentHashHex: z.string(),
          assinatura: z.union([
            z.object({ estado: z.literal('assinado'), signatureId: z.string(),
                       verifiedStatus: z.string() }),
            z.object({ estado: z.literal('pendente'), motivo: z.string() })]),
        }),
      },
    },
  }, rota('document.issue', async (tx, ctx, req, reply) => {
    const b = req.body as {
      kind: 'atestado' | 'pedido_exame' | 'relatorio' | 'declaracao_comparecimento';
      patientId: string; encounterId?: string; versionId?: string;
      payload: Record<string, unknown> };
    const { rows } = await tx.query<{ pid: string; dia: string }>(
      `SELECT app.current_professional_id()::text AS pid,
              app.local_date(clock_timestamp(),
                (SELECT c.timezone FROM app.clinic c WHERE c.id = $1))::text AS dia`,
      [ctx.actor.clinicId]);
    const cab = rows[0];
    if (!cab) erroDominio('profissional_nao_encontrado', 422);
    const resultado = await issueDocument(tx, {
      provider: providers().signature,
      kind: b.kind, patientId: b.patientId, professionalId: cab.pid,
      clinicId: ctx.actor.clinicId,
      ...(b.encounterId === undefined ? {} : { encounterId: b.encounterId }),
      ...(b.versionId === undefined ? {} : { versionId: b.versionId }),
      issuedDate: cab.dia,
      payload: b.payload as never,
      signerRef: `signer-${ctx.actor.userId}`, signerCpf: '00000000000',
    });
    if (!resultado.ok) erroDominio('emissao_falhou', 422);
    void reply.code(201);
    return resultado.value;
  }));

  r.post('/v1/prescricoes/sessao', {
    schema: {
      body: z.object({ encounterId: z.string().uuid(), patientId: z.string().uuid() }),
      response: {
        200: z.object({
          mode: z.literal('embedded'), scriptUrl: z.string(), token: z.string(),
          expiresAt: z.string(), patientPayload: z.record(z.string()),
          correlationId: z.string() }),
      },
    },
  }, rota('prescription.write', async (tx, _ctx, req) => {
    const b = req.body as { encounterId: string; patientId: string };
    const { rows } = await tx.query<{ pid: string }>(
      `SELECT app.current_professional_id()::text AS pid`);
    const resultado = await openPrescriberSession(tx, {
      provider: providers().prescription,
      encounterId: b.encounterId, patientId: b.patientId,
      professionalId: rows[0]?.pid ?? '' });
    if (!resultado.ok) erroDominio(resultado.error.kind, 503);
    return resultado.value;
  }));

  r.post('/v1/prescricoes', {
    schema: {
      body: z.object({
        providerPrescriptionId: z.string().min(1),
        encounterId: z.string().uuid(),
        versionId: z.string().uuid().optional(),
        patientId: z.string().uuid(),
      }),
      response: {
        201: z.object({ prescriptionId: z.string().uuid(), itens: z.number().int(),
                        assinaturaVerificada: z.boolean() }),
      },
    },
  }, rota('prescription.write', async (tx, ctx, req, reply) => {
    const b = req.body as { providerPrescriptionId: string; encounterId: string;
                            versionId?: string; patientId: string };
    const { rows } = await tx.query<{ pid: string }>(
      `SELECT app.current_professional_id()::text AS pid`);
    const resultado = await confirmPrescription(tx, {
      prescriptionProvider: providers().prescription,
      signatureProvider: providers().signature,
      providerPrescriptionId: b.providerPrescriptionId,
      encounterId: b.encounterId,
      ...(b.versionId === undefined ? {} : { versionId: b.versionId }),
      patientId: b.patientId, professionalId: rows[0]?.pid ?? '',
      clinicId: ctx.actor.clinicId,
      signerRef: `signer-${ctx.actor.userId}`, signerCpf: '00000000000' });
    if (!resultado.ok) {
      erroDominio(resultado.error.kind,
        resultado.error.kind === 'parceiro_indisponivel' ? 503 : 422);
    }
    void reply.code(201);
    return resultado.value;
  }));

  r.post('/v1/pacientes/:id/exportacoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        requesterKind: z.enum(['titular', 'representante', 'profissional',
                               'judicial', 'fiscalizacao']),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        requesterNote: z.string().optional(),
      }),
      response: {
        201: z.object({ exportId: z.string().uuid(), pageCount: z.number().int(),
                        pdfSha256Hex: z.string(), durationMs: z.number().int() }),
      },
    },
  }, rota('record.export', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { requesterKind: never; from?: string; to?: string;
                            requesterNote?: string };
    const resultado = await exportRecord(tx, { patientId: p.id, ...b });
    if (!resultado.ok) erroDominio(resultado.error.kind, 404);
    void reply.code(201);
    return {
      exportId: resultado.value.exportId, pageCount: resultado.value.pageCount,
      pdfSha256Hex: resultado.value.pdfSha256Hex, durationMs: resultado.value.durationMs };
  }));
}
