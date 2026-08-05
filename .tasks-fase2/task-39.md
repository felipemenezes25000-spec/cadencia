### Task 39: rotas de pagamento — registrar, listar, estornar, link e recibo

**Arquivos**
- Criar `apps/api/src/routes/payments.ts`
- Criar `apps/api/src/routes/payments.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar o arquivo de rotas de pagamento `apps/api/src/routes/payments.ts`.

```ts
// apps/api/src/routes/payments.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

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
  createdBy: z.string().uuid(),
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

    // Registrar o pagamento
    await tx.query(
      `INSERT INTO fin.payment
         (id, patient_id, encounter_id, clinic_id, amount_cents, method,
          status, description, category_id, created_by, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9, clock_timestamp())`,
      [paymentId, b.patientId, b.encounterId ?? null, ctx.actor.clinicId,
       b.amountCents, b.method, b.description ?? null,
       b.categoryId ?? null, ctx.actor.userId]);

    // Gerar recibo
    await tx.query(
      `INSERT INTO fin.receipt (id, payment_id, clinic_id, generated_at)
       VALUES ($1, $2, $3, clock_timestamp())`,
      [receiptId, paymentId, ctx.actor.clinicId]);

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
    const condicoes: string[] = [`p.clinic_id = $1`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.from !== undefined) {
      condicoes.push(`p.paid_at >= $${idx}::date`);
      params.push(q.from);
      idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`p.paid_at < ($${idx}::date + 1)`);
      params.push(q.to);
      idx += 1;
    }
    if (q.status !== undefined) {
      condicoes.push(`p.status = $${idx}`);
      params.push(q.status);
      idx += 1;
    }
    if (q.patientId !== undefined) {
      condicoes.push(`p.patient_id = $${idx}`);
      params.push(q.patientId);
      idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`p.created_at < $${idx}`);
      params.push(q.cursor);
      idx += 1;
    }

    params.push(limite + 1);

    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      payment_id: string; encounter_id: string | null; patient_id: string;
      amount_cents: string; method: string; status: string;
      paid_at: string | null; provider_payment_id: string | null;
      created_at: string; created_by: string;
    }>(
      `SELECT p.id AS payment_id, p.encounter_id, p.patient_id,
              p.amount_cents::text, p.method, p.status::text,
              to_char(p.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              p.provider_payment_id,
              to_char(p.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              p.created_by
         FROM fin.payment p
        WHERE ${where}
        ORDER BY p.created_at DESC
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      paymentId: row.payment_id,
      encounterId: row.encounter_id,
      patientId: row.patient_id,
      amountCents: Number(row.amount_cents),
      method: row.method,
      status: row.status,
      paidAt: row.paid_at,
      providerPaymentId: row.provider_payment_id,
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

    // Verificar que o pagamento existe e esta confirmed
    const { rows: payRows } = await tx.query<{
      id: string; status: string; amount_cents: string; method: string;
      provider_payment_id: string | null;
    }>(
      `SELECT id, status::text, amount_cents::text, method, provider_payment_id
         FROM fin.payment WHERE id = $1`, [p.id]);

    if (payRows.length === 0) erroDominio('pagamento_nao_encontrado', 404);
    const pay = payRows[0]!;
    if (pay.status !== 'confirmed') erroDominio('pagamento_nao_estornavel', 422);

    const refundAmount = b.amountCents ?? Number(pay.amount_cents);
    if (refundAmount > Number(pay.amount_cents)) {
      erroDominio('valor_estorno_excede_pagamento', 422);
    }

    const refundId = uuidv7();

    // Para pagamentos com PSP, enfileirar no outbox
    if (pay.provider_payment_id !== null) {
      await tx.query(
        `INSERT INTO fin.outbox_event (id, event_type, aggregate_id, payload)
         VALUES ($1, 'refund_payment', $2,
                 jsonb_build_object('paymentId', $3, 'providerPaymentId', $4,
                   'amountCents', $5, 'reason', $6, 'refundId', $7))`,
        [uuidv7(), p.id, p.id, pay.provider_payment_id,
         refundAmount, b.reason, refundId]);
    }

    // Atualizar status do pagamento
    await tx.query(
      `UPDATE fin.payment SET status = 'refunded',
              refund_reason = $2, refund_amount_cents = $3,
              refunded_at = clock_timestamp(), refunded_by = $4
        WHERE id = $1`,
      [p.id, b.reason, refundAmount, ctx.actor.userId]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('PAYMENT_REFUND', 'fin', 'payment', $1, 'estornado',
              jsonb_build_object('amount_cents', $2, 'reason', $3), $4)`,
      [p.id, refundAmount, b.reason, ctx.actor.clinicId]);

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

    const paymentLinkId = uuidv7();
    const expiresMinutes = b.expiresInMinutes ?? 1440; // padrao 24h

    // Criar link no banco
    await tx.query(
      `INSERT INTO fin.payment_link
         (id, patient_id, encounter_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               clock_timestamp() + make_interval(mins => $7),
               'pending', $8)`,
      [paymentLinkId, b.patientId, b.encounterId ?? null, ctx.actor.clinicId,
       b.amountCents, b.description, expiresMinutes, ctx.actor.userId]);

    // Enfileirar no outbox para criacao do link no PSP
    await tx.query(
      `INSERT INTO fin.outbox_event (id, event_type, aggregate_id, payload)
       VALUES ($1, 'create_payment_link', $2,
               jsonb_build_object('paymentLinkId', $3, 'amountCents', $4,
                 'description', $5))`,
      [uuidv7(), paymentLinkId, paymentLinkId, b.amountCents, b.description]);

    void reply.code(201);
    return { paymentLinkId, status: 'pending' as const };
  }));

  // ── GET /v1/receipts/:id/pdf — download do recibo ────────────────────────
  r.get('/v1/receipts/:id/pdf', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('payment.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      receipt_id: string; payment_id: string; clinic_nome: string;
      patient_nome: string; amount_cents: string; method: string;
      paid_at: string; generated_at: string;
    }>(
      `SELECT r.id AS receipt_id, r.payment_id,
              cl.nome AS clinic_nome,
              pat.full_name AS patient_nome,
              p.amount_cents::text, p.method,
              to_char(p.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(r.generated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS generated_at
         FROM fin.receipt r
         JOIN fin.payment p ON p.id = r.payment_id
         JOIN app.clinic cl ON cl.id = r.clinic_id
         JOIN clin.patient pat ON pat.id = p.patient_id
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
```

- [ ] Registrar as rotas de pagamento no `apps/api/src/app.ts`.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { paymentRoutes } from './routes/payments';

// Apos o register de messagingWebhookRoutes:
//   await app.register(messagingWebhookRoutes);
//   await app.register(paymentRoutes);
```

- [ ] Criar o teste de integracao `apps/api/src/routes/payments.int.test.ts`.

```ts
// apps/api/src/routes/payments.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('rotas de pagamento', () => {
  let paymentId: string;
  let receiptId: string;

  it('POST /v1/payments registra pagamento e gera recibo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 15000,
        method: 'pix',
        description: 'Consulta particular',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentId: string; status: string; receiptId: string };
    expect(body.status).toBe('confirmed');
    expect(body.paymentId).toBeTruthy();
    expect(body.receiptId).toBeTruthy();
    paymentId = body.paymentId;
    receiptId = body.receiptId;
    await app.close();
  });

  it('GET /v1/payments lista pagamentos com filtro por paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/payments?patientId=${s.patientId}`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('POST /v1/payments/:id/refund estorna o pagamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Paciente desistiu do atendimento' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { paymentId: string; status: string };
    expect(body.status).toBe('refunded');
    await app.close();
  });

  it('estorno de pagamento ja estornado devolve 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Segunda tentativa' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'pagamento_nao_estornavel' });
    await app.close();
  });

  it('recepcao nao pode estornar (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    // Criar um pagamento para a recepcao tentar estornar
    const criarR = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(recep),
      payload: {
        patientId: recep.patientId,
        amountCents: 5000,
        method: 'dinheiro',
      },
    });
    const pid = (criarR.json() as { paymentId: string }).paymentId;

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${pid}/refund`,
      ...auth(recep),
      payload: { reason: 'Teste' },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('POST /v1/payment-links cria link de pagamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payment-links', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 25000,
        description: 'Consulta + exames',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentLinkId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.paymentLinkId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/receipts/:id/pdf devolve o recibo em HTML', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/receipts/${receiptId}/pdf`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('Recibo de Pagamento');
    expect(r.body).toContain('R$ 150.00');
    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/payments.int.test.ts
# Esperado: PASS — todos os 6 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/payments.ts apps/api/src/routes/payments.int.test.ts \
       apps/api/src/app.ts
git commit -m "feat(api): add payment routes — register, list, refund, link, receipt"
```

---