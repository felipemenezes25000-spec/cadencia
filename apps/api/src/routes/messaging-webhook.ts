// apps/api/src/routes/messaging-webhook.ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { InboundMessage, StatusUpdate } from '@cadencia/integrations';
import { providers } from '../providers';

function primeiroHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function urlPublica(req: FastifyRequest): string {
  // Proxy reverso pode mudar host/esquema internos. Quando o deploy tiver URL
  // pública fixa, esta variável é a fonte mais robusta para a assinatura Twilio.
  const origemConfigurada = process.env['TWILIO_WEBHOOK_ORIGIN']?.replace(/\/$/, '');
  if (origemConfigurada !== undefined && origemConfigurada !== '') {
    return `${origemConfigurada}${req.url.startsWith('/') ? req.url : `/${req.url}`}`;
  }

  const proto = primeiroHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim()
    ?? req.protocol;
  const host = primeiroHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim()
    ?? req.headers.host
    ?? req.hostname;
  return `${proto}://${host}${req.url}`;
}

function payloadPersistido(channel: string, rawBody: Buffer): string {
  if (channel === 'sms') {
    // raw_payload é jsonb; preservamos o formulário ORIGINAL dentro de uma
    // string JSON em vez de fingir que form-urlencoded é JSON.
    return JSON.stringify({
      contentType: 'application/x-www-form-urlencoded',
      raw: rawBody.toString('utf-8'),
    });
  }
  return rawBody.toString('utf-8');
}

export async function messagingWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => { done(null, body); },
  );
  r.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (_req, body, done) => { done(null, body); },
  );

  r.post('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
  }, async (req, reply) => {
    const channel = (req.params as { channel: 'whatsapp' | 'sms' }).channel;
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const headers = req.headers as Record<string, string>;

    // Cada rota usa o provedor do próprio canal. Antes /sms era validado e
    // parseado pelo WhatsApp, logo nenhum webhook Twilio real poderia entrar.
    const registry = providers();
    const messaging = channel === 'sms' ? registry.sms : registry.messaging;
    const verificacao = messaging.verifyWebhook(
      rawBody,
      headers,
      channel === 'sms' ? { url: urlPublica(req) } : undefined,
    );
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    const eventos = messaging.parseInbound(rawBody);

    let businessPhone: string | undefined;
    let providerRef: string | undefined;
    if (channel === 'sms') {
      const form = new URLSearchParams(rawBody.toString('utf-8'));
      businessPhone = form.get('To') ?? undefined;
    } else {
      const parsed = JSON.parse(rawBody.toString('utf-8')) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              metadata?: { display_phone_number?: string; phone_number_id?: string };
            };
          }>;
        }>;
      };
      const metadata = parsed.entry?.[0]?.changes?.[0]?.value?.metadata;
      businessPhone = metadata?.display_phone_number;
      providerRef = metadata?.phone_number_id;
    }

    if (businessPhone === undefined && providerRef === undefined) {
      return { accepted: true as const };
    }

    const { rows: identityRows } = await jobsPool().query<{
      tenant_id: string; id: string;
    }>(
      `SELECT tenant_id, id
         FROM msg.channel_identity
        WHERE channel = $1
          AND status IN ('verified', 'active')
          AND (($2::text IS NOT NULL AND phone = $2)
            OR ($3::text IS NOT NULL AND provider_ref = $3))
        ORDER BY CASE WHEN provider_ref = $3 THEN 0 ELSE 1 END, id
        LIMIT 2`,
      [channel, businessPhone ?? null, providerRef ?? null],
    );

    // Mais de uma identidade para o mesmo endereço de parceiro é configuração
    // ambígua. Nunca escolhemos um tenant "por sorte".
    if (identityRows.length !== 1) {
      return { accepted: true as const };
    }
    const identity = identityRows[0]!;

    const actor: Actor = {
      kind: 'system',
      tenantId: identity.tenant_id,
      reason: `webhook-${channel}-inbound`,
      requestId: uuidv7(),
    };

    await withTenantTx(actor, async (tx) => {
      const inboundEventId = uuidv7();
      await tx.query(
        `INSERT INTO msg.inbound_event
           (id, channel_identity_id, raw_payload, received_at)
         VALUES ($1, $2, $3::jsonb, clock_timestamp())`,
        [inboundEventId, identity.id, payloadPersistido(channel, rawBody)],
      );

      for (const evento of eventos) {
        if (evento.kind === 'status') {
          const status = evento as StatusUpdate;
          await tx.query(
            `UPDATE msg.message
                SET status = CASE
                      WHEN status = 'read' THEN status
                      WHEN status = 'delivered' AND $2 = 'sent' THEN status
                      WHEN status = 'failed' THEN status
                      ELSE $2
                    END,
                    sent_at = CASE WHEN $2 IN ('sent','delivered','read')
                                   THEN coalesce(sent_at, clock_timestamp()) ELSE sent_at END,
                    delivered_at = CASE WHEN $2 IN ('delivered','read')
                                        THEN coalesce(delivered_at, clock_timestamp()) ELSE delivered_at END,
                    read_at = CASE WHEN $2 = 'read'
                                   THEN coalesce(read_at, clock_timestamp()) ELSE read_at END
              WHERE external_id = $1 AND channel = $3`,
            [status.providerMessageId, status.status, channel],
          );
          continue;
        }

        const msg = evento as InboundMessage;

        // pg_advisory_xact_lock serializa reentregas simultâneas do mesmo id.
        // Depois conferimos existência: entrega at-least-once vira exatamente uma
        // mensagem na timeline sem precisar apagar histórico antigo em migration.
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`${channel}:${msg.providerMessageId}`],
        );
        const jaExiste = await tx.query(
          `SELECT 1 FROM msg.message
            WHERE channel = $1 AND external_id = $2
            LIMIT 1`,
          [channel, msg.providerMessageId],
        );
        if (jaExiste.rows.length > 0) continue;

        const { rows: convRows } = await tx.query<{ id: string }>(
          `INSERT INTO msg.conversation
             (id, channel_identity_id, patient_id, remote_phone, status, last_message_at)
           VALUES ($1, $2, NULL, $3, 'active', clock_timestamp())
           ON CONFLICT (tenant_id, channel_identity_id, remote_phone)
             WHERE status = 'active'
           DO UPDATE SET last_message_at = clock_timestamp()
           RETURNING id`,
          [uuidv7(), identity.id, msg.from],
        );
        const conversationId = convRows[0]!.id;
        const bodyText = msg.body.kind === 'text' ? msg.body.text : null;

        await tx.query(
          `INSERT INTO msg.message
             (id, conversation_id, direction, channel, body_text, status, external_id)
           VALUES ($1, $2, 'inbound', $3, $4, 'delivered', $5)`,
          [uuidv7(), conversationId, channel, bodyText, msg.providerMessageId],
        );
      }

      await tx.query(
        `UPDATE msg.inbound_event SET processed_at = clock_timestamp() WHERE id = $1`,
        [inboundEventId],
      );
    });

    return { accepted: true as const };
  });

  // GET de verificação é protocolo da Meta; /sms nunca deve fazer handshake.
  r.get('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      querystring: z.object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      }),
    },
  }, async (req, reply) => {
    const channel = (req.params as { channel: 'whatsapp' | 'sms' }).channel;
    if (channel !== 'whatsapp') return reply.code(404).send({ erro: 'nao_encontrado' });

    const q = req.query as {
      'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
    const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN'];
    if (verifyToken !== undefined && verifyToken !== ''
        && q['hub.mode'] === 'subscribe'
        && q['hub.verify_token'] === verifyToken) {
      return reply.code(200).send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ erro: 'token_invalido' });
  });
}
