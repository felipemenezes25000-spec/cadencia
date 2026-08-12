// apps/api/src/routes/notifications.ts
/**
 * Rotas de notificações in-app.
 * GET /v1/notifications - listar
 * PUT /v1/notifications/:id/read - marcar como lida
 * PUT /v1/notifications/read-all - marcar todas lidas
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /v1/notifications
  r.get('/v1/notifications', {
    schema: {
      querystring: z.object({
        unreadOnly: z.coerce.boolean().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            id: z.string().uuid(),
            kind: z.string(),
            title: z.string(),
            body: z.string(),
            data: z.record(z.string(), z.unknown()),
            readAt: z.string().nullable(),
            createdAt: z.string(),
            expiresAt: z.string().nullable(),
          })),
          nextCursor: z.string().nullable(),
          unreadCount: z.number().int(),
        }),
      },
    },
  }, async () => {
    // TODO: Implementar com @cadencia/notifications quando disponível
    return {
      itens: [],
      nextCursor: null,
      unreadCount: 0,
    };
  });

  // PUT /v1/notifications/:id/read
  r.put('/v1/notifications/:id/read', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ ok: z.boolean() }) },
    },
  }, async () => {
    return { ok: true };
  });

  // PUT /v1/notifications/read-all
  r.put('/v1/notifications/read-all', {
    schema: {
      response: { 200: z.object({ markedCount: z.number().int() }) },
    },
  }, async () => {
    return { markedCount: 0 };
  });
}
