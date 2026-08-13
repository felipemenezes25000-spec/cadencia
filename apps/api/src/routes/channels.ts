import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

const ChannelKind = z.enum(['whatsapp', 'sms', 'email']);
const ChannelStatus = z.enum(['inactive', 'active', 'suspended', 'pending_verification']);

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/channels', {
    schema: { response: { 200: z.object({ itens: z.array(z.object({
      id: z.string().uuid(), channel: ChannelKind, status: ChannelStatus,
      rateLimitPerMinute: z.number().int(), hasCredentials: z.boolean(),
      createdAt: z.string(), updatedAt: z.string(),
    })) }) } },
  }, rota('channel.read', async (tx) => {
    const { rows } = await tx.query<{
      id: string; channel: 'whatsapp' | 'sms' | 'email';
      status: 'inactive' | 'active' | 'suspended' | 'pending_verification';
      rate_limit_per_minute: number; has_credentials: boolean;
      created_at: Date; updated_at: Date;
    }>(
      `SELECT id, channel, status, rate_limit_per_minute, has_credentials,
              created_at, updated_at
         FROM msg.channel_config
        ORDER BY channel`,
    );
    return { itens: rows.map((item) => ({
      id: item.id, channel: item.channel, status: item.status,
      rateLimitPerMinute: item.rate_limit_per_minute,
      hasCredentials: item.has_credentials,
      createdAt: item.created_at.toISOString(), updatedAt: item.updated_at.toISOString(),
    })) };
  }));

  r.post('/v1/channels', {
    schema: {
      body: z.object({
        channel: ChannelKind,
        config: z.record(z.string(), z.unknown()).optional(),
        rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
        credentials: z.never().optional(),
      }),
      response: { 201: z.object({ id: z.string().uuid(), status: ChannelStatus }) },
    },
  }, rota('channel.write', async (tx, _ctx, req, reply) => {
    const body = req.body as {
      channel: 'whatsapp' | 'sms' | 'email';
      config?: Record<string, unknown>; rateLimitPerMinute?: number;
    };
    const id = uuidv7();
    const { rows } = await tx.query<{
      id: string; status: 'inactive' | 'active' | 'suspended' | 'pending_verification';
    }>(
      `INSERT INTO msg.channel_config
         (tenant_id, id, channel, config, rate_limit_per_minute)
       VALUES (app.require_tenant_id(), $1, $2, $3::jsonb, $4)
       ON CONFLICT (tenant_id, channel) DO UPDATE
         SET config = EXCLUDED.config,
             rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
             updated_at = clock_timestamp()
       RETURNING id, status`,
      [id, body.channel, JSON.stringify(body.config ?? {}), body.rateLimitPerMinute ?? 60],
    );
    void reply.code(201);
    return { id: rows[0]!.id, status: rows[0]!.status };
  }));

  r.get('/v1/channels/:id/identity', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ itens: z.array(z.object({
        id: z.string().uuid(), displayName: z.string(), phone: z.string().nullable(),
        emailDomain: z.string().nullable(), externalRef: z.string().nullable(),
        status: z.enum(['active', 'inactive']), createdAt: z.string(),
      })) }) },
    },
  }, rota('channel.read', async (tx, _ctx, req) => {
    const params = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; display_name: string; phone: string | null;
      provider_ref: string | null; status: string; created_at: Date;
    }>(
      `SELECT i.id, i.display_name, i.phone, i.provider_ref, i.status, i.created_at
         FROM msg.channel_identity i
         JOIN msg.channel_config c
           ON c.tenant_id = i.tenant_id AND c.channel = i.channel
        WHERE c.id = $1
        ORDER BY i.display_name`,
      [params.id],
    );
    return { itens: rows.map((item) => ({
      id: item.id, displayName: item.display_name, phone: item.phone,
      emailDomain: null, externalRef: item.provider_ref,
      status: item.status === 'active' || item.status === 'verified' ? 'active' as const : 'inactive' as const,
      createdAt: item.created_at.toISOString(),
    })) };
  }));
}
