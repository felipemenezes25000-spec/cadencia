// apps/api/src/routes/messaging-webhook.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { InboundMessage } from '@cadencia/integrations';
import { providers } from '../providers';

/**
 * Webhook de parceiro de mensageria (WhatsApp/Meta).
 *
 * REGRAS CRÍTICAS:
 * 1. SEM autenticação de sessão — valida assinatura do parceiro
 * 2. tenant_id NUNCA vem do request — é resolvido pela channel_identity
 * 3. Grava payload bruto em inbound_event ANTES de parsear
 */
export async function messagingWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Configurar Fastify para preservar o rawBody no webhook
  r.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  r.post('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
    // Sem pre-handler de sessão — webhook é público
  }, async (req, reply) => {
    const channel = (req.params as { channel: string }).channel;
    const rawBody = req.body as Buffer;
    const headers = req.headers as Record<string, string>;

    // Validar assinatura do parceiro
    const messaging = providers().messaging;
    const verificacao = messaging.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    // Parsear eventos do payload
    const eventos = messaging.parseInbound(rawBody);
    const mensagens = eventos.filter((e): e is InboundMessage => e.kind === 'message');
    if (mensagens.length === 0) {
      return { accepted: true as const };
    }

    // Extrair o telefone do negócio do metadata do payload (WhatsApp Cloud API)
    const parsed = JSON.parse(rawBody.toString('utf-8')) as {
      entry?: Array<{
        changes?: Array<{
          value?: { metadata?: { display_phone_number?: string } };
        }>;
      }>;
    };
    const businessPhone =
      parsed?.entry?.[0]?.changes?.[0]?.value?.metadata?.display_phone_number;
    if (!businessPhone) {
      // Sem metadata — não conseguimos resolver o tenant; aceita silenciosamente
      return { accepted: true as const };
    }

    // Resolver tenant_id a partir da channel_identity no banco.
    // A channel_identity é do PARCEIRO, não do request.
    // Usa jobsPool (BYPASSRLS) pois não temos sessão de usuário.
    const { rows: identityRows } = await jobsPool().query<{
      tenant_id: string; id: string;
    }>(
      `SELECT tenant_id, id FROM msg.channel_identity
        WHERE phone = $1 AND channel = $2 AND status = 'verified'`,
      [businessPhone, channel]);

    if (identityRows.length === 0) {
      // Número não reconhecido — ignorar, mas sem erro (o parceiro reenviaria)
      return { accepted: true as const };
    }

    const identity = identityRows[0]!;

    for (const msg of mensagens) {
      const requestId = uuidv7();
      const actor: Actor = {
        kind: 'system',
        tenantId: identity.tenant_id,
        reason: `webhook-${channel}-inbound`,
        requestId,
      };

      await withTenantTx(actor, async (tx) => {
        // Gravar payload bruto ANTES de parsear (§7.3 garante)
        await tx.query(
          `INSERT INTO msg.inbound_event
             (id, channel_identity_id, raw_payload, received_at)
           VALUES ($1, $2, $3::jsonb, clock_timestamp())`,
          [uuidv7(), identity.id, rawBody.toString('utf-8')]);

        // Criar ou atualizar conversa
        const { rows: convRows } = await tx.query<{ id: string }>(
          `SELECT id FROM msg.conversation
            WHERE channel_identity_id = $1 AND remote_phone = $2 AND status = 'active'`,
          [identity.id, msg.from]);

        let conversationId: string;
        if (convRows.length > 0) {
          conversationId = convRows[0]!.id;
          await tx.query(
            `UPDATE msg.conversation
                SET last_message_at = clock_timestamp()
              WHERE id = $1`,
            [conversationId]);
        } else {
          conversationId = uuidv7();
          await tx.query(
            `INSERT INTO msg.conversation
               (id, channel_identity_id, patient_id,
                remote_phone, status, last_message_at)
             VALUES ($1, $2, NULL, $3, 'active', clock_timestamp())`,
            [conversationId, identity.id, msg.from]);
        }

        // Extrair texto do corpo da mensagem
        const bodyText = msg.body.kind === 'text' ? msg.body.text : null;

        // Gravar mensagem
        await tx.query(
          `INSERT INTO msg.message
             (id, conversation_id, direction, channel, body_text, status,
              external_id)
           VALUES ($1, $2, 'inbound', $3, $4, 'delivered', $5)`,
          [uuidv7(), conversationId, channel, bodyText,
           msg.providerMessageId]);
      });
    }

    return { accepted: true as const };
  });

  // GET para verificação do webhook (WhatsApp exige)
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
    const q = req.query as {
      'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
    // Sem token configurado a resposta é SEMPRE 403.
    //
    // Com o `?? ''` antigo, `WHATSAPP_VERIFY_TOKEN` ausente fazia o segredo
    // esperado virar string vazia — e `hub.verify_token` é opcional no schema.
    // Bastava chamar `?hub.mode=subscribe&hub.verify_token=&hub.challenge=x`
    // para o handshake da Meta passar, ou seja, qualquer um registrava este
    // endpoint no próprio app da Meta. Ambiente mal configurado tem de recusar,
    // não aceitar todo mundo.
    const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN'];
    if (verifyToken !== undefined && verifyToken !== ''
        && q['hub.mode'] === 'subscribe'
        && q['hub.verify_token'] === verifyToken) {
      return reply.code(200).send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ erro: 'token_invalido' });
  });
}
