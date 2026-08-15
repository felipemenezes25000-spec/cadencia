import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { aes256KeyFromBase64, sealSecret, uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

const CalendarProviderEnum = z.enum(['google', 'apple', 'outlook']);
const ConnectProviderEnum = z.literal('google');

function integrationTokenKey(): Buffer {
  const raw = process.env['CADENCIA_INTEGRATION_TOKEN_KEY'];
  if (raw === undefined || raw === '') {
    throw new Error(
      'CADENCIA_INTEGRATION_TOKEN_KEY ausente — tokens de integracao nao podem ser persistidos',
    );
  }
  return aes256KeyFromBase64(raw, 'CADENCIA_INTEGRATION_TOKEN_KEY');
}

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
        // Só Google tem adapter contratado no backend. Aceitar Apple/Outlook
        // aqui era sucesso fictício: a conexão era salva e nunca sincronizada.
        provider: ConnectProviderEnum,
        accessToken: z.string().min(1),
        refreshToken: z.string().optional(),
        calendarId: z.string().min(1).max(1024).optional(),
      }),
      response: {
        201: z.object({ id: z.string().uuid(), provider: ConnectProviderEnum }),
        409: z.object({ erro: z.literal('conexao_ja_existe') }),
      },
    },
  }, rota('tenant.write', async (tx, ctx, req, reply) => {
    const body = req.body as {
      provider: 'google'; accessToken: string; refreshToken?: string; calendarId?: string };

    const { rows: existing } = await tx.query<{ id: string }>(
      `SELECT id FROM app.calendar_sync
        WHERE user_id = $1 AND provider = $2`,
      [ctx.actor.userId, body.provider],
    );
    if (existing[0]) {
      return reply.code(409).send({ erro: 'conexao_ja_existe' as const });
    }

    const key = integrationTokenKey();
    const id = uuidv7();
    await tx.query(
      `INSERT INTO app.calendar_sync
         (id, tenant_id, user_id, provider, external_id,
          access_token_enc, refresh_token_enc)
       VALUES ($1, app.require_tenant_id(), $2, $3, $4, $5, $6)`,
      [
        id,
        ctx.actor.userId,
        body.provider,
        body.calendarId ?? 'primary',
        sealSecret(body.accessToken, key),
        body.refreshToken !== undefined ? sealSecret(body.refreshToken, key) : null,
      ],
    );

    // A primeira sincronização segue o mesmo caminho assíncrono e observável do
    // botão "sincronizar agora". Salvar uma conexão não carimba sucesso antes do
    // provider criar os eventos.
    await tx.query(
      `INSERT INTO app.outbox (event_type, aggregate_id, payload)
       VALUES ('calendar_sync_requested', $1::uuid,
               jsonb_build_object('userId', $1::text, 'force', true))`,
      [ctx.actor.userId],
    );

    void reply.code(201);
    return { id, provider: body.provider };
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
        202: z.object({ queued: z.literal(true) }),
      },
    },
  }, rota('tenant.write', async (tx, ctx, _req, reply) => {
    const { rows } = await tx.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM app.calendar_sync
          WHERE user_id = $1 AND enabled = true AND provider = 'google'
       ) AS existe`,
      [ctx.actor.userId],
    );

    // Idempotente para a UI: pedir sync sem conexão não fabrica `last_sync_at`
    // nem finge que sincronizou. O worker simplesmente não terá nada a fazer.
    if (rows[0]?.existe === true) {
      await tx.query(
        `INSERT INTO app.outbox (event_type, aggregate_id, payload)
         VALUES ('calendar_sync_requested', $1::uuid,
                 jsonb_build_object('userId', $1::text, 'force', true))`,
        [ctx.actor.userId],
      );
    }

    void reply.code(202);
    return { queued: true as const };
  }));
}
