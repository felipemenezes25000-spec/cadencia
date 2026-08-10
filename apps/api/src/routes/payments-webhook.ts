// apps/api/src/routes/payments-webhook.ts
//
// Webhook do PSP (Payment Service Provider).
//
// ADAPTACAO: o plano original referenciava `fin.payment` e colunas
// fantasma em `fin.payment_link` e `fin.receipt`. O repositorio real
// usa `fin.entry` (migration 0077), `fin.payment_link` com entry_id
// (migration 0079), e `fin.receipt` com entry_id + receipt_number
// (migration 0077). Veja 00-CONTRATOS.md secoes A3 e A7.
//
// REGRAS CRITICAS:
// 1. SEM autenticacao de sessao — valida assinatura do PSP
// 2. tenant_id NUNCA vem do request — e resolvido pelo payment_link/entry no banco
// 3. Grava evento bruto ANTES de processar
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { providers } from '../providers';

export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Preserva os BYTES que o PSP enviou, como ja faz o webhook de mensageria.
   *
   * Sem este parser o Fastify entrega `req.body` ja convertido em objeto, e a
   * rota reserializava com `JSON.stringify` para conferir o HMAC. Assinatura e
   * calculada sobre bytes: reserializar troca ordem de chave, espaco e escape
   * de unicode, entao o digest resultante nao e o que o PSP assinou. Contra um
   * PSP de verdade a verificacao nunca fecharia — o webhook so "funciona" hoje
   * porque as duas pontas sao o mesmo fake e erram igual.
   */
  r.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  r.post('/v1/payments/webhook', {
    schema: {
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
  }, async (req, reply) => {
    const rawBody = typeof req.body === 'string'
      ? Buffer.from(req.body)
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body));
    const headers = req.headers as Record<string, string>;

    // Validar assinatura do PSP
    const payment = providers().payment;
    const verificacao = payment.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    // Parsear o evento
    const parsed = JSON.parse(rawBody.toString()) as {
      eventType: string;
      paymentLinkId?: string;
      providerPaymentId?: string;
      status?: string;
      amountCents?: number;
      paidAt?: string;
    };

    // Resolver tenant_id pelo payment_link ou entry.
    // tenant_id NUNCA vem do request — e resolvido pelo banco.
    let tenantId: string | null = null;
    let paymentLinkId: string | null = null;
    let entryId: string | null = null;

    if (parsed.paymentLinkId !== undefined) {
      const { rows } = await jobsPool().query<{
        tenant_id: string; id: string; entry_id: string;
      }>(
        `SELECT tenant_id, id, entry_id FROM fin.payment_link WHERE id = $1`,
        [parsed.paymentLinkId]);
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        paymentLinkId = rows[0]!.id;
        entryId = rows[0]!.entry_id;
      }
    }

    if (tenantId === null && parsed.providerPaymentId !== undefined) {
      const { rows } = await jobsPool().query<{
        tenant_id: string; id: string;
      }>(
        `SELECT tenant_id, id FROM fin.entry WHERE external_ref = $1`,
        [parsed.providerPaymentId]);
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        entryId = rows[0]!.id;
      }
    }

    if (tenantId === null) {
      // Evento de pagamento sem referencia no nosso banco — aceitar mas ignorar
      return { accepted: true as const };
    }

    const requestId = uuidv7();
    const actor: Actor = {
      kind: 'system',
      tenantId,
      reason: 'webhook-psp-inbound',
      requestId,
    };

    await withTenantTx(actor, async (tx) => {
      // Gravar evento bruto ANTES de processar
      await tx.query(
        `INSERT INTO fin.webhook_event
           (id, event_type, raw_payload, received_at)
         VALUES ($1, $2, $3::jsonb, clock_timestamp())`,
        [uuidv7(), parsed.eventType ?? 'unknown', rawBody.toString()]);

      // Processar evento de pagamento confirmado
      if (parsed.eventType === 'payment.confirmed' && entryId !== null) {
        // Atualizar o lancamento para pago
        const atualizado = await tx.query(
          `UPDATE fin.entry
              SET status = 'pago', paid_at = clock_timestamp(),
                  external_ref = $2
            WHERE id = $1 AND status = 'pendente'`,
          [entryId, parsed.providerPaymentId ?? null]);

        /**
         * A TRANSICAO e a chave de idempotencia.
         *
         * PSP reentrega evento — e da norma do PSP fazer isso ate receber 200.
         * O UPDATE ja era idempotente pelo `status = 'pendente'`: na segunda
         * vez ele nao muda linha nenhuma. O que NAO era idempotente e o que vem
         * depois: o contador de recibo era consumido e um segundo `fin.receipt`
         * nascia para o mesmo lancamento. Resultado: dois recibos com numeros
         * diferentes para um pagamento so, e um buraco na sequencia fiscal que
         * ninguem consegue explicar depois.
         *
         * Se o UPDATE nao mexeu em nada, este evento ja foi processado.
         */
        if (atualizado.rowCount === 0) return;

        // Repasse do profissional na mesma transacao — a rota POST /v1/payments
        // faz o mesmo. Sem isto, pagamento confirmado por link nunca gera split.
        await tx.query(
          `SELECT fin.calculate_splits(app.require_tenant_id(), $1)`,
          [entryId]);

        // Atualizar status do link (se existir)
        if (paymentLinkId !== null) {
          await tx.query(
            `UPDATE fin.payment_link
                SET status = 'paid', paid_at = clock_timestamp(),
                    webhook_raw = $2::jsonb, updated_at = clock_timestamp()
              WHERE id = $1`,
            [paymentLinkId, rawBody.toString()]);
        }

        // Alocar numero sequencial de recibo via fin.receipt_counter
        const { rows: counterRows } = await tx.query<{ consumed: string }>(
          `INSERT INTO fin.receipt_counter (tenant_id, next_value)
           VALUES (app.require_tenant_id(), 2)
           ON CONFLICT (tenant_id) DO UPDATE
             SET next_value = fin.receipt_counter.next_value + 1
           RETURNING next_value - 1 AS consumed`);
        const receiptNumber = Number(counterRows[0]!.consumed);

        // Gerar recibo
        await tx.query(
          `INSERT INTO fin.receipt (id, entry_id, receipt_number)
           VALUES ($1, $2, $3)`,
          [uuidv7(), entryId, receiptNumber]);
      }

      // Processar evento de estorno
      if (parsed.eventType === 'payment.refunded' && parsed.providerPaymentId !== undefined) {
        await tx.query(
          `UPDATE fin.entry SET status = 'estornado'
            WHERE external_ref = $1 AND status = 'pago'`,
          [parsed.providerPaymentId]);
      }
    });

    return { accepted: true as const };
  });
}
