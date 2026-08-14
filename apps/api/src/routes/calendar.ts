import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

const CalendarProviderEnum = z.enum(['google', 'apple', 'outlook']);

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/calendar/connections', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            id: z.string().uuid(),
            provider: CalendarProviderEnum,
            externalId: z.string().nullable(),
            lastSyncAt: z.string().nullable(),
            enabled: z.boolean(),
            createdAt: z.string(),
          })),
        }),
      },
    },
  }, rota('tenant.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; provider: string; external_id: string | null;
      last_sync_at: Date | null; enabled: boolean; created_at: Date;
    }>(
      `SELECT id, provider, external_id, last_sync_at, enabled, created_at
         FROM app.calendar_sync
        WHERE user_id = $1
        ORDER BY provider`,
      [ctx.actor.userId],
    );
    return {
      itens: rows.map((row) => ({
        id: row.id,
        provider: row.provider as 'google' | 'apple' | 'outlook',
        externalId: row.external_id,
        lastSyncAt: row.last_sync_at?.toISOString() ?? null,
        enabled: row.enabled,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }));

  r.post('/v1/calendar/connect', {
    schema: {
      body: z.object({
        provider: CalendarProviderEnum,
        accessToken: z.string().min(1),
        refreshToken: z.string().optional(),
      }),
      response: {
        201: z.object({ id: z.string().uuid(), provider: CalendarProviderEnum }),
        409: z.object({ erro: z.literal('conexao_ja_existe') }),
      },
    },
  }, rota('tenant.write', async (tx, ctx, req, reply) => {
    const body = req.body as { provider: string; accessToken: string; refreshToken?: string };

    const { rows: existing } = await tx.query<{ id: string }>(
      `SELECT id FROM app.calendar_sync
        WHERE user_id = $1 AND provider = $2`,
      [ctx.actor.userId, body.provider],
    );
    if (existing[0]) {
      return reply.code(409).send({ erro: 'conexao_ja_existe' as const });
    }

    const id = uuidv7();
    await tx.query(
      `INSERT INTO app.calendar_sync
         (id, tenant_id, user_id, provider, access_token_enc, refresh_token_enc)
       VALUES ($1, app.require_tenant_id(), $2, $3, $4, $5)`,
      [
        id,
        ctx.actor.userId,
        body.provider,
        Buffer.from(body.accessToken, 'utf8'),
        body.refreshToken !== undefined ? Buffer.from(body.refreshToken, 'utf8') : null,
      ],
    );

    void reply.code(201);
    return { id, provider: body.provider as 'google' | 'apple' | 'outlook' };
  }));

  r.delete('/v1/calendar/disconnect/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('conexao_nao_encontrada') }),
      },
    },
  }, rota('tenant.write', async (tx, ctx, req, reply) => {
    const { id } = req.params as { id: string };

    const { rowCount } = await tx.query(
      `DELETE FROM app.calendar_sync WHERE id = $1 AND user_id = $2`,
      [id, ctx.actor.userId],
    );
    if (rowCount === 0) {
      return reply.code(404).send({ erro: 'conexao_nao_encontrada' as const });
    }

    return { ok: true as const };
  }));

  r.post('/v1/calendar/sync', {
    schema: {
      response: {
        200: z.object({ synced: z.number().int() }),
      },
    },
  }, rota('tenant.write', async (tx, ctx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE app.calendar_sync
          SET last_sync_at = clock_timestamp()
        WHERE user_id = $1 AND enabled = true
        RETURNING id`,
      [ctx.actor.userId],
    );
    return { synced: rows.length };
  }));
}
