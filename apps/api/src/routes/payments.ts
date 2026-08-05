// apps/api/src/routes/payments.ts
//
// Rotas de pagamento: registrar, listar, estornar, link e recibo.
//
// ADAPTACAO: o plano original referenciava `fin.payment` e `fin.outbox_event`,
// mas o repositorio real usa `fin.entry` (migration 0077) e `app.outbox`
// (migration 0068). Veja 00-CONTRATOS.md secoes A1-A3 para detalhes.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

// Mapeamento status BD (portugues) <-> API (ingles)
const STATUS_DB_TO_API: Record<string, string> = {
  pago: 'confirmed', estornado: 'refunded', pendente: 'pending', cancelado: 'failed',
};
const STATUS_API_TO_DB: Record<string, string> = {
  confirmed: 'pago', refunded: 'estornado', pending: 'pendente', failed: 'cancelado',
};

// Nomes de exibicao para auto-provisionamento de metodo de pagamento
const METHOD_DISPLAY: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartao de Credito',
  cartao_debito: 'Cartao de Debito', link: 'Link de Pagamento',
};

const PaymentSchema = z.object({
  paymentId: z.string().uuid(),
  encounterId: z.string().uuid().nullable(),
  patientId: z.string().uuid(),
  amountCents: z.number().int(),
  method: z.string(),
  status: z.string(),
  paidAt: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable(),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/payments — registrar pagamento ──────────────────────────────
  r.post('/v1/payments', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        amountCents: z.number().int().min(1),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        description: z.string().optional(),
        categoryId: z.string().uuid().optional(),
      }),
      response: {
        201: z.object({
          paymentId: z.string().uuid(),
          status: z.string(),
          receiptId: z.string().uuid(),
        }),
      },
    },
  }, rota('payment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; amountCents: number;
      method: string; description?: string; categoryId?: string };

    const paymentId = uuidv7();
    const receiptId = uuidv7();

    // Resolver (ou auto-provisionar) metodo de pagamento por kind
    const { rows: pmRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.payment_method WHERE kind = $1::fin.payment_method_kind LIMIT 1`,
      [b.method]);

    let paymentMethodId: string;
    if (pmRows.length > 0) {
      paymentMethodId = pmRows[0]!.id;
    } else {
      const newPmId = uuidv7();
      await tx.query(
        `INSERT INTO fin.payment_method (id, kind, name)
         VALUES ($1, $2::fin.payment_method_kind, $3)`,
        [newPmId, b.method, METHOD_DISPLAY[b.method] ?? b.method]);
      paymentMethodId = newPmId;
    }

    // Registrar o pagamento (fin.entry com kind='receita', status='pago')
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, patient_id, clinic_id, professional_id, amount_cents,
          payment_method_id, status, description, category_id,
          idempotency_key, paid_at, created_by)
       VALUES ($1, 'receita', $2, $3, app.current_professional_id(), $4,
               $5, 'pago', $6, $7, $8, clock_timestamp(), app.current_user_id())`,
      [paymentId, b.patientId, ctx.actor.clinicId, b.amountCents,
       paymentMethodId, b.description ?? 'Pagamento',
       b.categoryId ?? null, `pay:${paymentId}`]);

    // Alocar numero sequencial de recibo via fin.receipt_counter
    const { rows: counterRows } = await tx.query<{ consumed: string }>(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value)
       VALUES (app.require_tenant_id(), 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = fin.receipt_counter.next_value + 1
       RETURNING next_value - 1 AS consumed`);
    const receiptNumber = Number(counterRows[0]!.consumed);

    // Gerar recibo
    await tx.query(
      `INSERT INTO fin.receipt (id, entry_id, receipt_number)
       VALUES ($1, $2, $3)`,
      [receiptId, paymentId, receiptNumber]);

    void reply.code(201);
    return { paymentId, status: 'confirmed', receiptId };
  }));

  // ── GET /v1/payments — listar pagamentos ─────────────────────────────────
  r.get('/v1/payments', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.enum(['confirmed', 'refunded', 'pending', 'failed']).optional(),
        patientId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(PaymentSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as {
      from?: string; to?: string; status?: string;
      patientId?: string; limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = [`e.clinic_id = $1`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.from !== undefined) {
      condicoes.push(`e.paid_at >= $${idx}::date`);
      params.push(q.from);
      idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`e.paid_at < ($${idx}::date + 1)`);
      params.push(q.to);
      idx += 1;
    }
    if (q.status !== undefined) {
      const dbStatus = STATUS_API_TO_DB[q.status] ?? q.status;
      condicoes.push(`e.status = $${idx}::fin.entry_status`);
      params.push(dbStatus);
      idx += 1;
    }
    if (q.patientId !== undefined) {
      condicoes.push(`e.patient_id = $${idx}`);
      params.push(q.patientId);
      idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`e.created_at < $${idx}`);
      params.push(q.cursor);
      idx += 1;
    }

    params.push(limite + 1);

    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      payment_id: string; patient_id: string;
      amount_cents: string; method: string; status: string;
      paid_at: string | null; external_ref: string | null;
      created_at: string; created_by: string;
    }>(
      `SELECT e.id AS payment_id, e.patient_id,
              e.amount_cents::text, pm.kind AS method, e.status::text,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              e.external_ref,
              to_char(e.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              e.created_by::text
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
        WHERE ${where}
        ORDER BY e.created_at DESC
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      paymentId: row.payment_id,
      encounterId: null,
      patientId: row.patient_id,
      amountCents: Number(row.amount_cents),
      method: row.method,
      status: STATUS_DB_TO_API[row.status] ?? row.status,
      paidAt: row.paid_at,
      providerPaymentId: row.external_ref,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── POST /v1/payments/:id/refund — estorno ───────────────────────────────
  r.post('/v1/payments/:id/refund', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        reason: z.string().min(1),
        amountCents: z.number().int().min(1).optional(),
      }),
      response: {
        200: z.object({
          paymentId: z.string().uuid(),
          refundId: z.string().uuid(),
          status: z.literal('refunded'),
        }),
      },
    },
  }, rota('payment.refund', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { reason: string; amountCents?: number };

    // Verificar que o lancamento existe e esta pago
    const { rows: payRows } = await tx.query<{
      id: string; status: string; amount_cents: string;
      external_ref: string | null;
    }>(
      `SELECT id, status::text, amount_cents::text, external_ref
         FROM fin.entry WHERE id = $1`, [p.id]);

    if (payRows.length === 0) erroDominio('pagamento_nao_encontrado', 404);
    const pay = payRows[0]!;
    if (pay.status !== 'pago') erroDominio('pagamento_nao_estornavel', 422);

    const refundId = uuidv7();

    // Para pagamentos com PSP, enfileirar no outbox
    if (pay.external_ref !== null) {
      await tx.query(
        `INSERT INTO app.outbox (event_type, aggregate_id, payload)
         VALUES ('refund_payment', $1::uuid,
                 jsonb_build_object('paymentId', $2::text, 'externalRef', $3::text,
                   'amountCents', $4::bigint, 'reason', $5::text, 'refundId', $6::text))`,
        [p.id, p.id, pay.external_ref,
         b.amountCents ?? Number(pay.amount_cents), b.reason, refundId]);
    }

    // Atualizar status do lancamento
    await tx.query(
      `UPDATE fin.entry SET status = 'estornado' WHERE id = $1`,
      [p.id]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
              jsonb_build_object('amount_cents', $2::bigint, 'reason', $3::text,
                                 'status', 'estornado'::text), $4)`,
      [p.id, b.amountCents ?? Number(pay.amount_cents), b.reason, ctx.actor.clinicId]);

    return { paymentId: p.id, refundId, status: 'refunded' as const };
  }));

  // ── POST /v1/payment-links — criar link de pagamento ─────────────────────
  r.post('/v1/payment-links', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        amountCents: z.number().int().min(1),
        description: z.string().min(1),
        expiresInMinutes: z.number().int().min(5).max(43200).optional(),
      }),
      response: {
        201: z.object({
          paymentLinkId: z.string().uuid(),
          status: z.literal('pending'),
        }),
      },
    },
  }, rota('payment.link.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; amountCents: number;
      description: string; expiresInMinutes?: number };

    const entryId = uuidv7();

    // Resolver (ou auto-provisionar) metodo de pagamento 'link'
    const { rows: pmRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.payment_method WHERE kind = 'link'::fin.payment_method_kind LIMIT 1`);

    let paymentMethodId: string;
    if (pmRows.length > 0) {
      paymentMethodId = pmRows[0]!.id;
    } else {
      const newPmId = uuidv7();
      await tx.query(
        `INSERT INTO fin.payment_method (id, kind, name)
         VALUES ($1, 'link'::fin.payment_method_kind, 'Link de Pagamento')`,
        [newPmId]);
      paymentMethodId = newPmId;
    }

    // Criar lancamento pendente (fin.entry com status='pendente')
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, patient_id, clinic_id, professional_id, amount_cents,
          payment_method_id, status, description, idempotency_key)
       VALUES ($1, 'receita', $2, $3, app.current_professional_id(), $4,
               $5, 'pendente', $6, $7)`,
      [entryId, b.patientId, ctx.actor.clinicId, b.amountCents,
       paymentMethodId, b.description, `link:${entryId}`]);

    // Enfileirar no outbox para criacao do link no PSP
    await tx.query(
      `INSERT INTO app.outbox (event_type, aggregate_id, payload)
       VALUES ('create_payment_link', $1::uuid,
               jsonb_build_object('entryId', $2::text, 'amountCents', $3::bigint,
                 'description', $4::text))`,
      [entryId, entryId, b.amountCents, b.description]);

    void reply.code(201);
    return { paymentLinkId: entryId, status: 'pending' as const };
  }));

  // ── GET /v1/receipts/:id/pdf — download do recibo ────────────────────────
  r.get('/v1/receipts/:id/pdf', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('payment.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      receipt_id: string; entry_id: string; clinic_nome: string;
      patient_nome: string; amount_cents: string; method: string;
      paid_at: string; generated_at: string;
    }>(
      `SELECT r.id AS receipt_id, r.entry_id,
              cl.nome AS clinic_nome,
              pat.full_name AS patient_nome,
              e.amount_cents::text, pm.name AS method,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(r.issued_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS generated_at
         FROM fin.receipt r
         JOIN fin.entry e
           ON e.tenant_id = r.tenant_id AND e.id = r.entry_id
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
         JOIN app.clinic cl
           ON cl.tenant_id = e.tenant_id AND cl.id = e.clinic_id
         JOIN clin.patient pat
           ON pat.tenant_id = e.tenant_id AND pat.id = e.patient_id
        WHERE r.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('recibo_nao_encontrado', 404);
    const rec = rows[0]!;

    // Gerar HTML simples do recibo (PDF real sera implementado pelo worker)
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Recibo ${rec.receipt_id}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:auto;padding:2rem">
<h1>Recibo de Pagamento</h1>
<p><strong>Clinica:</strong> ${rec.clinic_nome}</p>
<p><strong>Paciente:</strong> ${rec.patient_nome}</p>
<p><strong>Valor:</strong> R$ ${(Number(rec.amount_cents) / 100).toFixed(2)}</p>
<p><strong>Forma:</strong> ${rec.method}</p>
<p><strong>Data:</strong> ${rec.paid_at}</p>
<p style="color:#666;font-size:12px">Recibo #${rec.receipt_id}</p>
</body></html>`;

    void reply.header('content-type', 'text/html; charset=utf-8');
    void reply.header('content-disposition',
      `inline; filename="recibo-${rec.receipt_id}.html"`);
    return html;
  }));
}
