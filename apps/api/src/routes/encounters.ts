import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { openDraft, saveDraft, finalizeEncounter, amendEncounter,
  type FinalizeInput, type AmendInput } from '@cadencia/emr';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ValorSchema = z.discriminatedUnion('slot', [
  z.object({ slot: z.literal('value_text'), text: z.string() }),
  z.object({ slot: z.literal('value_num'), num: z.string() }),
  z.object({ slot: z.literal('value_bool'), bool: z.boolean() }),
  z.object({ slot: z.literal('value_date'), date: z.string() }),
  z.object({ slot: z.literal('value_ts'), ts: z.string() }),
  z.object({ slot: z.literal('value_json'), json: z.unknown() }),
  z.object({ slot: z.literal('value_ref_code'), source: z.string(), code: z.string() }),
]);

const PayloadClinico = z.object({
  fields: z.array(z.object({
    fieldId: z.string().uuid(), fieldGeneration: z.number().int(),
    labelSnapshot: z.string(), displaySnapshot: z.string().nullable(),
    terminologyVersion: z.string().nullable(),
    sectionInstance: z.number().int(), ordinal: z.number().int(),
    value: ValorSchema,
  })),
  diagnoses: z.array(z.object({
    codeSystem: z.string(), code: z.string(), displaySnapshot: z.string(),
    terminologyVersion: z.string(), isPrincipal: z.boolean() })),
  observations: z.array(z.object({
    observationCode: z.string(), valueNum: z.string(), unit: z.string().nullable(),
    componentOrdinal: z.number().int() })),
  findings: z.array(z.object({
    fieldCode: z.string(), optionCode: z.string(),
    displaySnapshot: z.string(), ordinal: z.number().int() })),
  procedures: z.array(z.object({
    codeSystem: z.string(), tabela: z.number().int().nullable(), code: z.string(),
    displaySnapshot: z.string(), terminologyVersion: z.string().nullable(),
    quantidade: z.number().int(), valorCentavos: z.number().int() })),
  ai: z.array(z.object({
    provider: z.string(), modelId: z.string(), modelVersion: z.string(),
    purpose: z.string(), riskClass: z.string(), residency: z.string(),
    inputHash: z.string(), outputHash: z.string(), clinicianDecision: z.string() })),
});

export async function encounterRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/atendimentos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        appointmentId: z.string().uuid().optional(),
        occurredAt: z.string().datetime().optional(),
      }),
      response: {
        201: z.object({ encounterId: z.string().uuid(), status: z.literal('rascunho'),
                        rev: z.number().int(), payload: z.record(z.string(), z.unknown()) }),
      },
    },
  }, rota('encounter.write', async (tx, ctx, req, reply) => {
    const b = req.body as { patientId: string; appointmentId?: string; occurredAt?: string };
    const encounterId = uuidv7();
    await tx.query(
      `INSERT INTO clin.encounter
         (id, patient_id, professional_id, clinic_id, appointment_id, occurred_at, occurred_date)
       VALUES ($1, $2, app.current_professional_id(), $3, $4,
               coalesce($5::timestamptz, clock_timestamp()),
               app.local_date(coalesce($5::timestamptz, clock_timestamp()),
                 (SELECT c.timezone FROM app.clinic c WHERE c.id = $3)))`,
      [encounterId, b.patientId, ctx.actor.clinicId, b.appointmentId ?? null,
       b.occurredAt ?? null]);
    const aberto = await openDraft(tx, encounterId);
    if (!aberto.ok) erroDominio(aberto.error.kind, 422);
    void reply.code(201);
    return { encounterId, status: 'rascunho' as const,
             rev: aberto.value.rev, payload: aberto.value.payload };
  }));

  r.get('/v1/atendimentos/:id/rascunho', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ encounterId: z.string(), rev: z.number().int(),
                                  payload: z.record(z.string(), z.unknown()) }) },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const aberto = await openDraft(tx, p.id);
    if (!aberto.ok) erroDominio(aberto.error.kind, 404);
    return aberto.value;
  }));

  r.put('/v1/atendimentos/:id/rascunho', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ expectedRev: z.number().int().min(1), payload: z.record(z.string(), z.unknown()) }),
      response: { 200: z.object({ rev: z.number().int() }) },
    },
  }, rota('encounter.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { expectedRev: number; payload: Record<string, unknown> };
    const salvo = await saveDraft(tx, { encounterId: p.id, ...b });
    if (!salvo.ok) {
      if (salvo.error.kind === 'conflito_de_revisao') {
        erroDominio('conflito_de_revisao', 409, {
          currentRev: salvo.error.currentRev, currentPayload: salvo.error.currentPayload });
      }
      erroDominio(salvo.error.kind, 422);
    }
    return salvo.value;
  }));

  r.post('/v1/atendimentos/:id/finalizar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: PayloadClinico,
      response: { 200: z.object({ versionId: z.string().uuid(), versionNo: z.number().int() }) },
    },
  }, rota('encounter.finalize', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await finalizeEncounter(tx, {
      encounterId: p.id, ...(req.body as Omit<FinalizeInput, 'encounterId'>) });
    if (!resultado.ok) {
      if (resultado.error.kind === 'cadastro_preliminar_bloqueia_finalizacao') {
        erroDominio(resultado.error.kind, 422, { faltando: resultado.error.faltando });
      }
      erroDominio(resultado.error.kind, 422);
    }
    return resultado.value;
  }));

  r.post('/v1/atendimentos/:id/versoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: PayloadClinico.extend({
        kind: z.enum(['retificacao', 'adendo', 'transferencia', 'anulacao']),
        supersedesVersionId: z.string().uuid().nullable(),
        justificativa: z.string().nullable(),
      }),
      response: { 200: z.object({ versionId: z.string().uuid(), versionNo: z.number().int() }) },
    },
  }, rota('encounter.amend', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await amendEncounter(tx, {
      encounterId: p.id, ...(req.body as Omit<AmendInput, 'encounterId'>) });
    if (!resultado.ok) erroDominio(resultado.error.kind, 422);
    return resultado.value;
  }));
}
