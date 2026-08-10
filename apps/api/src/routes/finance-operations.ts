// apps/api/src/routes/finance-operations.ts
//
// Rotas de operacoes financeiras: a pagar, transferencias e recorrencias.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const STATUS_DB_TO_API: Record<string, string> = {
  pago: 'confirmed', pendente: 'pending', cancelado: 'failed', estornado: 'refunded',
};

const METHOD_DISPLAY: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartao de Credito',
  cartao_debito: 'Cartao de Debito', link: 'Link de Pagamento',
};

const PayableSchema = z.object({
  payableId: z.string().uuid(),
  kind: z.literal('despesa'),
  description: z.string(),
  amountCents: z.number().int(),
  method: z.string(),
  status: z.string(),
  dueDate: z.string().nullable(),
  paidAt: z.string().nullable(),
  supplierId: z.string().uuid().nullable(),
  // O NOME junto do id: a tela A Pagar mostra de quem e a conta, e devolver so
  // o uuid obrigaria o front a N consultas ou a exibir o identificador cru.
  supplierName: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  costCenterId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const RecurringSchema = z.object({
  recurringId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  kind: z.string(),
  method: z.string(),
  frequency: z.string(),
  dayOfMonth: z.number().int().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function financeOperationsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/payables — criar lancamento de despesa ───────────────────
  r.post('/v1/payables', {
    schema: {
      body: z.object({
        description: z.string().min(1),
        amountCents: z.number().int().min(1),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        supplierId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        costCenterId: z.string().uuid().optional(),
      }),
      response: {
        201: z.object({ payableId: z.string().uuid(), status: z.literal('pending') }),
      },
    },
  }, rota('finance.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      description: string; amountCents: number; method: string;
      dueDate?: string; supplierId?: string; categoryId?: string;
      costCenterId?: string };
    const id = uuidv7();

    // Resolver metodo de pagamento
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

    // `supplier_id` e `cost_center_id` entram no INSERT: o schema do body ja
    // aceitava os dois e o INSERT descartava em silencio, entao a despesa
    // nascia sem fornecedor e sem centro de custo. Quem preenche o formulario
    // nao tem como perceber — a resposta e 201 igual — e o rateio por centro de
    // custo passa a nao fechar com o total de despesas do periodo.
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, due_date,
          category_id, supplier_id, cost_center_id, idempotency_key, created_by)
       VALUES ($1, 'despesa', $2, $3, $4,
               $5, app.current_professional_id(), 'pendente', $6,
               $7, $8, $9, $10, app.current_user_id())`,
      [id, b.description, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, b.dueDate ?? null,
       b.categoryId ?? null, b.supplierId ?? null, b.costCenterId ?? null,
       `payable:${id}`]);

    void reply.code(201);
    return { payableId: id, status: 'pending' as const };
  }));

  // ── GET /v1/payables — listar despesas ────────────────────────────────
  r.get('/v1/payables', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.enum(['pending', 'confirmed', 'failed']).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(PayableSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as {
      from?: string; to?: string; status?: string;
      limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = [`e.clinic_id = $1`, `e.kind = 'despesa'`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.from !== undefined) {
      condicoes.push(`e.created_at >= $${idx}::date`);
      params.push(q.from); idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`e.created_at < ($${idx}::date + 1)`);
      params.push(q.to); idx += 1;
    }
    if (q.status !== undefined) {
      const STATUS_API_TO_DB: Record<string, string> = {
        confirmed: 'pago', pending: 'pendente', failed: 'cancelado',
      };
      condicoes.push(`e.status = $${idx}::fin.entry_status`);
      params.push(STATUS_API_TO_DB[q.status] ?? q.status); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`e.created_at < $${idx}`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      id: string; description: string; amount_cents: string;
      method: string; status: string; due_date: string | null;
      paid_at: string | null; created_at: string;
      supplier_id: string | null; supplier_name: string | null;
      category_id: string | null; category_name: string | null;
      cost_center_id: string | null;
    }>(
      `SELECT e.id, e.description, e.amount_cents::text,
              pm.kind AS method, e.status::text,
              e.due_date::text,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(e.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              e.supplier_id, f.name AS supplier_name,
              e.category_id, c.name AS category_name,
              e.cost_center_id
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
         LEFT JOIN fin.supplier f ON (f.tenant_id, f.id) = (e.tenant_id, e.supplier_id)
         LEFT JOIN fin.category c ON (c.tenant_id, c.id) = (e.tenant_id, e.category_id)
        WHERE ${where}
        ORDER BY e.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      payableId: row.id,
      kind: 'despesa' as const,
      description: row.description,
      amountCents: Number(row.amount_cents),
      method: row.method,
      status: STATUS_DB_TO_API[row.status] ?? row.status,
      dueDate: row.due_date,
      paidAt: row.paid_at,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      categoryId: row.category_id,
      categoryName: row.category_name,
      costCenterId: row.cost_center_id,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;
    return { itens, nextCursor };
  }));

  // ── POST /v1/transfers — transferencia entre contas ────────────────────
  r.post('/v1/transfers', {
    schema: {
      body: z.object({
        fromBankAccountId: z.string().uuid(),
        toBankAccountId: z.string().uuid(),
        amountCents: z.number().int().min(1),
        description: z.string().min(1),
      }),
      response: {
        201: z.object({
          transferId: z.string().uuid(),
          debitEntryId: z.string().uuid(),
          creditEntryId: z.string().uuid(),
        }),
      },
    },
  }, rota('finance.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      fromBankAccountId: string; toBankAccountId: string;
      amountCents: number; description: string };

    if (b.fromBankAccountId === b.toBankAccountId) {
      erroDominio('transferencia_mesma_conta', 422);
    }

    // Verificar que ambas as contas existem
    const { rows: fromRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.bank_account WHERE id = $1`, [b.fromBankAccountId]);
    if (fromRows.length === 0) erroDominio('conta_origem_nao_encontrada', 404);

    const { rows: toRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.bank_account WHERE id = $1`, [b.toBankAccountId]);
    if (toRows.length === 0) erroDominio('conta_destino_nao_encontrada', 404);

    const transferId = uuidv7();
    const debitId = uuidv7();
    const creditId = uuidv7();

    // Resolver metodo de pagamento 'pix' para transferencia
    const { rows: pmRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.payment_method WHERE kind = 'pix'::fin.payment_method_kind LIMIT 1`);
    let paymentMethodId: string;
    if (pmRows.length > 0) {
      paymentMethodId = pmRows[0]!.id;
    } else {
      const newPmId = uuidv7();
      await tx.query(
        `INSERT INTO fin.payment_method (id, kind, name) VALUES ($1, 'pix'::fin.payment_method_kind, 'Pix')`,
        [newPmId]);
      paymentMethodId = newPmId;
    }

    // Debito (despesa na conta de ORIGEM)
    //
    // `bank_account_id` e o que faz a transferencia transferir. Sem ele os dois
    // lancamentos nasciam sem conta: o saldo da origem nao caia, o do destino
    // nao subia, e a operacao inteira era so um par de linhas que se anulava no
    // total geral. As contas ja eram validadas logo acima e depois descartadas.
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, paid_at,
          bank_account_id, idempotency_key, created_by)
       VALUES ($1, 'despesa', $2, $3, $4,
               $5, app.current_professional_id(), 'pago', clock_timestamp(),
               $6, $7, app.current_user_id())`,
      [debitId, `Transferencia: ${b.description}`, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, b.fromBankAccountId, `transfer:debit:${transferId}`]);

    // Credito (receita na conta de DESTINO)
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, paid_at,
          bank_account_id, idempotency_key, created_by)
       VALUES ($1, 'receita', $2, $3, $4,
               $5, app.current_professional_id(), 'pago', clock_timestamp(),
               $6, $7, app.current_user_id())`,
      [creditId, `Transferencia: ${b.description}`, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, b.toBankAccountId, `transfer:credit:${transferId}`]);

    // A propria transferencia. `fin.transfer` (migration 0093) existe para
    // AMARRAR os dois lancamentos: sem a linha, `transferId` era um uuid gerado,
    // devolvido na resposta e jogado fora, e nada no banco dizia que aquele
    // debito e aquele credito sao a mesma operacao. Conciliar depois virava
    // adivinhacao por valor e horario.
    await tx.query(
      `INSERT INTO fin.transfer
         (id, from_bank_account_id, to_bank_account_id, amount_cents,
          description, debit_entry_id, credit_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, app.current_user_id())`,
      [transferId, b.fromBankAccountId, b.toBankAccountId, b.amountCents,
       b.description, debitId, creditId]);

    void reply.code(201);
    return { transferId, debitEntryId: debitId, creditEntryId: creditId };
  }));

  // ── POST /v1/recurring — criar template de recorrencia ────────────────
  // DIVERGENCIA: o schema real (migration 0091) usa next_due_date em vez de
  // starts_at e nao possui coluna method. A API aceita startsAt e method no
  // payload para manter a interface do plano, mapeando para as colunas reais.
  r.post('/v1/recurring', {
    schema: {
      body: z.object({
        description: z.string().min(1),
        amountCents: z.number().int().min(1),
        kind: z.enum(['receita', 'despesa']),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        frequency: z.enum(['monthly', 'weekly', 'biweekly']),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 201: z.object({ recurringId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, ctx, req, reply) => {
    const b = req.body as {
      description: string; amountCents: number; kind: string;
      method: string; frequency: string; dayOfMonth?: number;
      startsAt: string; endsAt?: string };
    const id = uuidv7();

    await tx.query(
      `INSERT INTO fin.recurring_template
         (id, clinic_id, description, amount_cents, kind,
          frequency, day_of_month, next_due_date, ends_at)
       VALUES ($1, $2, $3, $4, $5::fin.entry_kind,
               $6::fin.recurrence_frequency, $7, $8, $9)`,
      [id, ctx.actor.clinicId, b.description, b.amountCents, b.kind,
       b.frequency, b.dayOfMonth ?? null,
       b.startsAt, b.endsAt ?? null]);

    void reply.code(201);
    return { recurringId: id };
  }));

  // ── GET /v1/recurring — listar templates ──────────────────────────────
  r.get('/v1/recurring', {
    schema: {
      response: { 200: z.object({ itens: z.array(RecurringSchema) }) },
    },
  }, rota('finance.settings', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; description: string; amount_cents: string;
      kind: string; frequency: string;
      day_of_month: number | null; next_due_date: string;
      ends_at: string | null; active: boolean; created_at: string;
    }>(
      `SELECT id, description, amount_cents::text,
              kind::text, frequency::text,
              day_of_month, next_due_date::text,
              ends_at::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.recurring_template
        WHERE clinic_id = $1
        ORDER BY description COLLATE "pt-BR-x-icu"`,
      [ctx.actor.clinicId]);
    return {
      itens: rows.map((row) => ({
        recurringId: row.id,
        description: row.description,
        amountCents: Number(row.amount_cents),
        kind: row.kind,
        method: '',
        frequency: row.frequency,
        dayOfMonth: row.day_of_month,
        startsAt: row.next_due_date,
        endsAt: row.ends_at,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/recurring — atualizar template ────────────────────────────
  r.put('/v1/recurring', {
    schema: {
      body: z.object({
        recurringId: z.string().uuid(),
        description: z.string().min(1).optional(),
        amountCents: z.number().int().min(1).optional(),
        frequency: z.enum(['monthly', 'weekly', 'biweekly']).optional(),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 200: z.object({ recurringId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as {
      recurringId: string; description?: string; amountCents?: number;
      frequency?: string; dayOfMonth?: number; endsAt?: string };
    const sets: string[] = [];
    const params: unknown[] = [b.recurringId];
    let idx = 2;
    if (b.description !== undefined) { sets.push(`description = $${idx}`); params.push(b.description); idx += 1; }
    if (b.amountCents !== undefined) { sets.push(`amount_cents = $${idx}`); params.push(b.amountCents); idx += 1; }
    if (b.frequency !== undefined) { sets.push(`frequency = $${idx}::fin.recurrence_frequency`); params.push(b.frequency); idx += 1; }
    if (b.dayOfMonth !== undefined) { sets.push(`day_of_month = $${idx}`); params.push(b.dayOfMonth); idx += 1; }
    if (b.endsAt !== undefined) { sets.push(`ends_at = $${idx}`); params.push(b.endsAt); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.recurring_template SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('recorrencia_nao_encontrada', 404);
    return { recurringId: b.recurringId };
  }));

  // ── DELETE /v1/recurring/:id — desativar template ─────────────────────
  r.delete('/v1/recurring/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ recurringId: z.string().uuid(), active: z.literal(false) }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rowCount } = await tx.query(
      `UPDATE fin.recurring_template SET active = false WHERE id = $1`, [p.id]);
    if (rowCount === 0) erroDominio('recorrencia_nao_encontrada', 404);
    return { recurringId: p.id, active: false as const };
  }));
}
