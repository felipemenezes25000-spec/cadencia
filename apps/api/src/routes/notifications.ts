import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const NotificationSchema = z.object({
    id: z.string().uuid(), kind: z.string(), title: z.string(), body: z.string(),
    data: z.record(z.string(), z.unknown()), readAt: z.string().nullable(),
    createdAt: z.string(), expiresAt: z.string().nullable(),
  });

  r.get('/v1/notifications', {
    schema: {
      querystring: z.object({
        unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      response: { 200: z.object({
        itens: z.array(NotificationSchema), nextCursor: z.string().nullable(),
        unreadCount: z.number().int(),
      }) },
    },
  }, rota('notification.read', async (tx, ctx, req) => {
    const query = req.query as { unreadOnly?: boolean; cursor?: string; limit?: number };
    const limit = query.limit ?? 30;
    const { rows } = await tx.query<{
      id: string; kind: string; title: string; body: string;
      data: Record<string, unknown>; read_at: Date | null;
      created_at: Date; expires_at: Date | null;
    }>(
      `SELECT n.id, n.kind, n.title, n.body, n.data, n.read_at,
              n.created_at, n.expires_at
         FROM app.notification n
        WHERE n.user_id = $1
          AND (n.expires_at IS NULL OR n.expires_at > clock_timestamp())
          AND ($2::boolean = false OR n.read_at IS NULL)
          AND ($3::uuid IS NULL OR (n.created_at, n.id) < (
                SELECT c.created_at, c.id FROM app.notification c
                 WHERE c.id = $3 AND c.user_id = $1
              ))
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $4`,
      [ctx.actor.userId, query.unreadOnly ?? false, query.cursor ?? null, limit + 1],
    );
    const { rows: unread } = await tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM app.notification
        WHERE user_id = $1 AND read_at IS NULL
          AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
      [ctx.actor.userId],
    );
    const visible = rows.slice(0, limit);
    return {
      itens: visible.map((item) => ({
        id: item.id, kind: item.kind, title: item.title, body: item.body,
        data: item.data, readAt: item.read_at?.toISOString() ?? null,
        createdAt: item.created_at.toISOString(),
        expiresAt: item.expires_at?.toISOString() ?? null,
      })),
      nextCursor: rows.length > limit ? visible.at(-1)?.id ?? null : null,
      unreadCount: unread[0]?.count ?? 0,
    };
  }));

  r.put('/v1/notifications/:id/read', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ ok: z.boolean() }) },
    },
  }, rota('notification.read', async (tx, ctx, req) => {
    const params = req.params as { id: string };
    const result = await tx.query(
      `UPDATE app.notification SET read_at = coalesce(read_at, clock_timestamp())
        WHERE id = $1 AND user_id = $2`,
      [params.id, ctx.actor.userId],
    );
    return { ok: (result.rowCount ?? 0) > 0 };
  }));

  r.put('/v1/notifications/read-all', {
    schema: { response: { 200: z.object({ markedCount: z.number().int() }) } },
  }, rota('notification.read', async (tx, ctx) => {
    const result = await tx.query(
      `UPDATE app.notification SET read_at = clock_timestamp()
        WHERE user_id = $1 AND read_at IS NULL
          AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
      [ctx.actor.userId],
    );
    return { markedCount: result.rowCount ?? 0 };
  }));
}
