import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { searchPatients, createMinimalPatient, completePatient, dataDebt } from '@cadencia/patients';
import { rota } from '../guard';

const HitSchema = z.object({
  patientId: z.string().uuid(),
  displayName: z.string(),
  legalName: z.string(),
  hasSocialName: z.boolean(),
  birthDate: z.string().nullable(),
  cadastroStatus: z.enum(['preliminar', 'completo']),
  phonePrimary: z.string().nullable(),
});

export async function patientRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/pacientes', {
    schema: {
      querystring: z.object({ termo: z.string().min(1), limit: z.coerce.number().int().optional() }),
      response: { 200: z.object({ itens: z.array(HitSchema) }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { termo: string; limit?: number };
    const itens = await searchPatients(tx, {
      termo: q.termo, ...(q.limit === undefined ? {} : { limit: q.limit }) });
    return { itens };
  }));

  r.get('/v1/pacientes/existe', {
    schema: {
      querystring: z.object({
        kind: z.enum(['CPF', 'CNS', 'DNV', 'PASSAPORTE', 'RG', 'CARTEIRINHA']),
        value: z.string().min(1),
      }),
      response: { 200: z.object({ existe: z.boolean() }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { kind: string; value: string };
    const { rows } = await tx.query<{ existe: boolean }>(
      `SELECT clin.patient_exists_by_identifier($1, $2) AS existe`, [q.kind, q.value]);
    return { existe: rows[0]?.existe ?? false };
  }));

  r.post('/v1/pacientes', {
    schema: {
      body: z.object({
        fullName: z.string().min(2),
        nomeSocial: z.string().optional(),
        phonePrimary: z.string().optional(),
        email: z.string().email().optional(),
        cpf: z.string().optional(),
      }),
      response: {
        201: z.object({ patientId: z.string().uuid(), cadastroStatus: z.literal('preliminar') }),
      },
    },
  }, rota('patient.write', async (tx, _ctx, req, reply) => {
    const resultado = await createMinimalPatient(tx, req.body as never);
    if (!resultado.ok) {
      throw Object.assign(new Error(resultado.error.kind), {
        statusCode: 422, dominio: resultado.error.kind });
    }
    void reply.code(201);
    return resultado.value;
  }));

  r.patch('/v1/pacientes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sexAtBirth: z.enum(['M', 'F', 'I']),
        cpf: z.string().optional(),
      }),
      response: { 200: z.object({ patientId: z.string().uuid() }) },
    },
  }, rota('patient.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { birthDate: string; sexAtBirth: 'M' | 'F' | 'I'; cpf?: string };
    const resultado = await completePatient(tx, { patientId: p.id, ...b });
    if (!resultado.ok) {
      throw Object.assign(new Error(resultado.error.kind), {
        statusCode: 422, dominio: resultado.error.kind });
    }
    return resultado.value;
  }));

  r.get('/v1/pacientes/:id/pendencias', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ patientId: z.string(), pendentes: z.array(z.string()) }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    return dataDebt(tx, p.id);
  }));

  r.get('/v1/pacientes/:id/prontuario', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      encounterId: string; occurredDate: string; status: string;
      professionalId: string; clinicId: string;
      headVersionId: string | null; versionCount: number;
    }>(
      `SELECT id AS "encounterId", occurred_date::text AS "occurredDate",
              status::text AS status, professional_id AS "professionalId",
              clinic_id AS "clinicId", head_version_id AS "headVersionId",
              version_count AS "versionCount"
         FROM clin.encounter
        WHERE patient_id = $1
        ORDER BY occurred_date DESC, created_at DESC
        LIMIT 200`, [p.id]);
    return { itens: rows };
  }));
}
