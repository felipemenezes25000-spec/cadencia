// apps/api/src/routes/tenancy.ts
/**
 * Rotas de administração: clínicas, membros, permissões.
 * GET /v1/tenants/current - dados do tenant
 * GET /v1/clinics - listar clínicas
 * POST /v1/clinics - criar clínica
 * GET /v1/clinics/:id/members - membros
 * POST /v1/clinics/:id/members/invite - convidar usuário
 * DELETE /v1/clinics/:id/members/:userId - revogar acesso
 * GET /v1/permissions - matriz de permissões
 * PUT /v1/clinics/:id/permissions - override de permissões
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { systemClock } from '@cadencia/kernel/src/clock';

export async function tenancyRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /v1/tenants/current
  r.get('/v1/tenants/current', {
    schema: {
      response: {
        200: z.object({
          id: z.string().uuid(),
          nome: z.string(),
          slug: z.string(),
          createdAt: z.string(),
        }),
      },
    },
  }, async () => {
    // TODO: Implementar com ctx.actor.tenantId
    return {
      id: '00000000-0000-0000-0000-000000000001',
      nome: 'Clínica Demo',
      slug: 'demo',
      createdAt: new Date(systemClock.nowMs()).toISOString(),
    };
  });

  // GET /v1/clinics
  r.get('/v1/clinics', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            id: z.string().uuid(),
            nome: z.string(),
            cnpj: z.string().nullable(),
            cnes: z.string().nullable(),
            endereco: z.string().nullable(),
            fusoHorario: z.string(),
            ativo: z.boolean(),
            principal: z.boolean(),
          })),
        }),
      },
    },
  }, async () => {
    return { itens: [] };
  });

  // POST /v1/clinics
  r.post('/v1/clinics', {
    schema: {
      body: z.object({
        nome: z.string().min(1).max(128),
        cnpj: z.string().optional(),
        cnes: z.string().optional(),
        endereco: z.string().optional(),
        fusoHorario: z.string().optional(),
      }),
      response: { 201: z.object({ id: z.string().uuid() }) },
    },
  }, async (_req, reply) => {
    const id = uuidv7();
    return reply.code(201).send({ id });
  });

  // GET /v1/clinics/:id/members
  r.get('/v1/clinics/:id/members', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            userId: z.string().uuid(),
            email: z.string().email(),
            nome: z.string(),
            papel: z.enum(['admin', 'medico', 'recepcionista', 'enfermeiro']),
            ativo: z.boolean(),
            mfaAtivo: z.boolean(),
          })),
        }),
      },
    },
  }, async () => {
    return { itens: [] };
  });

  // POST /v1/clinics/:id/members/invite
  r.post('/v1/clinics/:id/members/invite', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        email: z.string().email(),
        papel: z.enum(['admin', 'medico', 'recepcionista', 'enfermeiro']),
        nome: z.string().optional(),
      }),
      response: { 201: z.object({ conviteId: z.string().uuid(), email: z.string() }) },
    },
  }, async (req, reply) => {
    const conviteId = uuidv7();
    const body = req.body as { email: string };
    return reply.code(201).send({ conviteId, email: body.email });
  });

  // DELETE /v1/clinics/:id/members/:userId
  r.delete('/v1/clinics/:id/members/:userId', {
    schema: {
      params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
      response: { 200: z.object({ ok: z.boolean() }) },
    },
  }, async () => {
    return { ok: true };
  });

  // GET /v1/permissions
  r.get('/v1/permissions', {
    schema: {
      response: {
        200: z.object({
          matriz: z.array(z.object({
            papel: z.string(),
            acao: z.string(),
            permitido: z.boolean().nullable(),
            clinicaOverride: z.string().uuid().nullable(),
          })),
        }),
      },
    },
  }, async () => {
    return { matriz: [] };
  });

  // PUT /v1/clinics/:id/permissions
  r.put('/v1/clinics/:id/permissions', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        overrides: z.array(z.object({
          papel: z.string(),
          acao: z.string(),
          permitido: z.boolean(),
        })),
      }),
      response: { 200: z.object({ saved: z.number().int() }) },
    },
  }, async (req) => {
    const body = req.body as { overrides: unknown[] };
    return { saved: body.overrides.length };
  });
}
