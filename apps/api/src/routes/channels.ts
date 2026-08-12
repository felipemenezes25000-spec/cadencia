// apps/api/src/routes/channels.ts
/**
 * Rotas de gestão de canais de comunicação.
 * GET /v1/channels - listar canais
 * POST /v1/channels - criar canal
 * GET /v1/channels/:id/identity - identidades
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /v1/channels
  r.get('/v1/channels', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            id: z.string().uuid(),
            channel: z.enum(['whatsapp', 'sms', 'email']),
            status: z.enum(['inactive', 'active', 'suspended', 'pending_verification']),
            rateLimitPerMinute: z.number().int(),
            hasCredentials: z.boolean(),
            createdAt: z.string(),
            updatedAt: z.string(),
          })),
        }),
      },
    },
  }, async () => {
    // TODO: Implementar com tabela chan.channel_config
    return { itens: [] };
  });

  // POST /v1/channels
  r.post('/v1/channels', {
    schema: {
      body: z.object({
        channel: z.enum(['whatsapp', 'sms', 'email']),
        config: z.record(z.string(), z.unknown()).optional(),
        credentials: z.record(z.string(), z.string()).optional(),
        rateLimitPerMinute: z.number().int().optional(),
      }),
      response: { 201: z.object({ id: z.string().uuid(), status: z.string() }) },
    },
  }, async (_req, reply) => {
    const id = uuidv7();
    return reply.code(201).send({ id, status: 'pending_verification' });
  });

  // GET /v1/channels/:id/identity
  r.get('/v1/channels/:id/identity', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            id: z.string().uuid(),
            displayName: z.string(),
            phone: z.string().nullable(),
            emailDomain: z.string().nullable(),
            externalRef: z.string().nullable(),
            status: z.enum(['active', 'inactive']),
            createdAt: z.string(),
          })),
        }),
      },
    },
  }, async () => {
    return { itens: [] };
  });
}
