// apps/api/src/routes/inventory.ts
//
// Rotas de estoque: produtos, movimentacoes e alertas.
// Leitura: inventory.read. Escrita: inventory.write.
//
// DIVERGENCIA: o plano usa clinic_id no INSERT de produto e resulting_stock/created_by
// no stock_movement. O schema real (migrations 0100-0101) usa tenant_id com DEFAULT,
// moved_by, reference_type, e um trigger que recalcula current_stock a partir dos
// movimentos. A implementacao segue o schema real.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  unit: z.string(),
  minStock: z.number().int(),
  currentStock: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const StockAlertSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  unit: z.string(),
  minStock: z.number().int(),
  currentStock: z.number().int(),
  deficit: z.number().int(),
});

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/products — criar produto ─────────────────────────────────
  r.post('/v1/products', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(300),
        sku: z.string().min(1).max(50).optional(),
        unit: z.string().min(1).max(30),
        minStock: z.number().int().min(0),
        currentStock: z.number().int().min(0),
      }),
      response: { 201: z.object({ productId: z.string().uuid() }) },
    },
  }, rota('inventory.write', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      name: string; sku?: string; unit: string;
      minStock: number; currentStock: number };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO inv.product
         (id, name, sku, unit, min_stock, current_stock)
       VALUES ($1, $2, $3, $4::inv.unit_kind, $5, $6)`,
      [id, b.name, b.sku ?? null, b.unit, b.minStock, b.currentStock]);
    void reply.code(201);
    return { productId: id };
  }));

  // ── GET /v1/products — listar produtos ────────────────────────────────
  r.get('/v1/products', {
    schema: {
      querystring: z.object({
        search: z.string().optional(),
        active: z.enum(['true', 'false']).optional(),
      }),
      response: { 200: z.object({ itens: z.array(ProductSchema) }) },
    },
  }, rota('inventory.read', async (tx, _ctx, req) => {
    const q = req.query as { search?: string; active?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.search !== undefined) {
      condicoes.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`);
      params.push(`%${q.search}%`); idx += 1;
    }
    if (q.active !== undefined) {
      condicoes.push(`p.active = $${idx}`);
      params.push(q.active === 'true'); idx += 1;
    }

    const where = condicoes.length > 0 ? `AND ${condicoes.join(' AND ')}` : '';
    const { rows } = await tx.query<{
      id: string; name: string; sku: string | null; unit: string;
      min_stock: string; current_stock: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, sku, unit::text, min_stock::text, current_stock::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM inv.product p
        WHERE true ${where}
        ORDER BY name COLLATE "pt-BR-x-icu"`,
      params);
    return {
      itens: rows.map((row) => ({
        productId: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        minStock: Number(row.min_stock),
        currentStock: Number(row.current_stock),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/products — atualizar produto ──────────────────────────────
  r.put('/v1/products', {
    schema: {
      body: z.object({
        productId: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        sku: z.string().min(1).max(50).optional(),
        unit: z.string().min(1).max(30).optional(),
        minStock: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ productId: z.string().uuid() }) },
    },
  }, rota('inventory.write', async (tx, _ctx, req) => {
    const b = req.body as {
      productId: string; name?: string; sku?: string;
      unit?: string; minStock?: number; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.productId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.sku !== undefined) { sets.push(`sku = $${idx}`); params.push(b.sku); idx += 1; }
    if (b.unit !== undefined) { sets.push(`unit = $${idx}::inv.unit_kind`); params.push(b.unit); idx += 1; }
    if (b.minStock !== undefined) { sets.push(`min_stock = $${idx}`); params.push(b.minStock); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE inv.product SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('produto_nao_encontrado', 404);
    return { productId: b.productId };
  }));

  // ── POST /v1/stock-movements — registrar movimentacao ─────────────────
  r.post('/v1/stock-movements', {
    schema: {
      body: z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        kind: z.enum(['entrada', 'saida']),
        reason: z.string().min(1).max(500),
      }),
      response: {
        201: z.object({
          movementId: z.string().uuid(),
          newStock: z.number().int(),
        }),
      },
    },
  }, rota('inventory.write', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      productId: string; quantity: number; kind: string; reason: string };
    const id = uuidv7();

    // Verificar se produto existe antes de inserir movimentacao
    const { rowCount: exists } = await tx.query(
      `SELECT 1 FROM inv.product WHERE id = $1`, [b.productId]);
    if (exists === 0) erroDominio('produto_nao_encontrado', 404);

    // Para saida, verificar se ha estoque suficiente
    if (b.kind === 'saida') {
      const { rows: stockRows } = await tx.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [b.productId]);
      const cs = Number(stockRows[0]!.current_stock);
      if (cs < b.quantity) erroDominio('estoque_insuficiente', 422);
    }

    // Inserir movimentacao — o trigger recalcula current_stock
    const referenceType = b.kind === 'entrada' ? 'compra' : 'uso_atendimento';
    await tx.query(
      `INSERT INTO inv.stock_movement
         (id, product_id, kind, quantity, reason, reference_type, moved_by)
       VALUES ($1, $2, $3::inv.movement_kind, $4, $5, $6::inv.reference_type, app.current_user_id())`,
      [id, b.productId, b.kind, b.quantity, b.reason, referenceType]);

    // Ler current_stock atualizado pelo trigger
    const { rows } = await tx.query<{ current_stock: string }>(
      `SELECT current_stock::text FROM inv.product WHERE id = $1`, [b.productId]);
    const newStock = Number(rows[0]!.current_stock);

    void reply.code(201);
    return { movementId: id, newStock };
  }));

  // ── GET /v1/stock-alerts — produtos abaixo do minimo ──────────────────
  r.get('/v1/stock-alerts', {
    schema: {
      response: { 200: z.object({ itens: z.array(StockAlertSchema) }) },
    },
  }, rota('inventory.read', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; sku: string | null; unit: string;
      min_stock: string; current_stock: string;
    }>(
      `SELECT id, name, sku, unit::text, min_stock::text, current_stock::text
         FROM inv.product
        WHERE active = true
          AND current_stock < min_stock
        ORDER BY (min_stock - current_stock) DESC`,
      []);
    return {
      itens: rows.map((row) => ({
        productId: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        minStock: Number(row.min_stock),
        currentStock: Number(row.current_stock),
        deficit: Number(row.min_stock) - Number(row.current_stock),
      })),
    };
  }));
}
