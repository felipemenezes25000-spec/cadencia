// apps/api/src/routes/finance-settings.ts
//
// Rotas de configuracao financeira: contas bancarias, centros de custo e fornecedores.
// Acao: finance.settings (contas e centros de custo), finance.write (fornecedores).
//
// DIVERGENCIA: o plano usa colunas cnpj/phone para supplier, mas o schema real
// (migration 0089) usa cpf_cnpj/contact. Mapeamos na API para manter a interface
// do plano enquanto gravamos nas colunas reais.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

// ── Schemas de resposta ────────────────────────────────────────────────────

const BankAccountSchema = z.object({
  bankAccountId: z.string().uuid(),
  name: z.string(),
  bankCode: z.string().nullable(),
  agency: z.string().nullable(),
  accountNumber: z.string().nullable(),
  initialBalanceCents: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const CostCenterSchema = z.object({
  costCenterId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});

const SupplierSchema = z.object({
  supplierId: z.string().uuid(),
  name: z.string(),
  cnpj: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function financeSettingsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/bank-accounts ────────────────────────────────────────────
  r.post('/v1/bank-accounts', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(200),
        bankCode: z.string().min(1).max(10),
        agency: z.string().min(1).max(20),
        accountNumber: z.string().min(1).max(30),
        initialBalanceCents: z.number().int().default(0),
      }),
      response: { 201: z.object({ bankAccountId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      name: string; bankCode: string; agency: string;
      accountNumber: string; initialBalanceCents: number };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.bank_account
         (id, name, bank_code, agency, account_number, initial_balance_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, b.name, b.bankCode, b.agency, b.accountNumber, b.initialBalanceCents]);
    void reply.code(201);
    return { bankAccountId: id };
  }));

  // ── GET /v1/bank-accounts ─────────────────────────────────────────────
  r.get('/v1/bank-accounts', {
    schema: {
      response: { 200: z.object({ itens: z.array(BankAccountSchema) }) },
    },
  }, rota('finance.settings', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; bank_code: string | null; agency: string | null;
      account_number: string | null; initial_balance_cents: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, bank_code, agency, account_number,
              initial_balance_cents::text, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.bank_account
        ORDER BY name COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        bankAccountId: row.id,
        name: row.name,
        bankCode: row.bank_code,
        agency: row.agency,
        accountNumber: row.account_number,
        initialBalanceCents: Number(row.initial_balance_cents),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/bank-accounts ─────────────────────────────────────────────
  r.put('/v1/bank-accounts', {
    schema: {
      body: z.object({
        bankAccountId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        bankCode: z.string().min(1).max(10).optional(),
        agency: z.string().min(1).max(20).optional(),
        accountNumber: z.string().min(1).max(30).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ bankAccountId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as {
      bankAccountId: string; name?: string; bankCode?: string;
      agency?: string; accountNumber?: string; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.bankAccountId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.bankCode !== undefined) { sets.push(`bank_code = $${idx}`); params.push(b.bankCode); idx += 1; }
    if (b.agency !== undefined) { sets.push(`agency = $${idx}`); params.push(b.agency); idx += 1; }
    if (b.accountNumber !== undefined) { sets.push(`account_number = $${idx}`); params.push(b.accountNumber); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.bank_account SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('conta_nao_encontrada', 404);
    return { bankAccountId: b.bankAccountId };
  }));

  // ── POST /v1/cost-centers ─────────────────────────────────────────────
  r.post('/v1/cost-centers', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(200),
        code: z.string().min(1).max(20),
      }),
      response: { 201: z.object({ costCenterId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as { name: string; code: string };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.cost_center (id, name, code) VALUES ($1, $2, $3)`,
      [id, b.name, b.code]);
    void reply.code(201);
    return { costCenterId: id };
  }));

  // ── GET /v1/cost-centers ──────────────────────────────────────────────
  r.get('/v1/cost-centers', {
    schema: {
      response: { 200: z.object({ itens: z.array(CostCenterSchema) }) },
    },
  }, rota('finance.settings', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; code: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, code, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.cost_center
        ORDER BY code COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        costCenterId: row.id,
        name: row.name,
        code: row.code,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/cost-centers ──────────────────────────────────────────────
  r.put('/v1/cost-centers', {
    schema: {
      body: z.object({
        costCenterId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        code: z.string().min(1).max(20).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ costCenterId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as { costCenterId: string; name?: string; code?: string; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.costCenterId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.code !== undefined) { sets.push(`code = $${idx}`); params.push(b.code); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.cost_center SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('centro_custo_nao_encontrado', 404);
    return { costCenterId: b.costCenterId };
  }));

  // ── POST /v1/suppliers ────────────────────────────────────────────────
  r.post('/v1/suppliers', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(300),
        cnpj: z.string().max(14).optional(),
        phone: z.string().max(20).optional(),
      }),
      response: { 201: z.object({ supplierId: z.string().uuid() }) },
    },
  }, rota('finance.write', async (tx, _ctx, req, reply) => {
    const b = req.body as { name: string; cnpj?: string; phone?: string };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.supplier (id, name, cpf_cnpj, contact) VALUES ($1, $2, $3, $4)`,
      [id, b.name, b.cnpj ?? null, b.phone ?? null]);
    void reply.code(201);
    return { supplierId: id };
  }));

  // ── GET /v1/suppliers ─────────────────────────────────────────────────
  r.get('/v1/suppliers', {
    schema: {
      response: { 200: z.object({ itens: z.array(SupplierSchema) }) },
    },
  }, rota('finance.settings', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; cpf_cnpj: string | null;
      contact: string | null; active: boolean; created_at: string;
    }>(
      `SELECT id, name, cpf_cnpj, contact, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.supplier
        ORDER BY name COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        supplierId: row.id,
        name: row.name,
        cnpj: row.cpf_cnpj,
        phone: row.contact,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/suppliers ─────────────────────────────────────────────────
  r.put('/v1/suppliers', {
    schema: {
      body: z.object({
        supplierId: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        cnpj: z.string().max(14).optional(),
        phone: z.string().max(20).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ supplierId: z.string().uuid() }) },
    },
  }, rota('finance.write', async (tx, _ctx, req) => {
    const b = req.body as {
      supplierId: string; name?: string; cnpj?: string;
      phone?: string; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.supplierId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.cnpj !== undefined) { sets.push(`cpf_cnpj = $${idx}`); params.push(b.cnpj); idx += 1; }
    if (b.phone !== undefined) { sets.push(`contact = $${idx}`); params.push(b.phone); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.supplier SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('fornecedor_nao_encontrado', 404);
    return { supplierId: b.supplierId };
  }));
}
