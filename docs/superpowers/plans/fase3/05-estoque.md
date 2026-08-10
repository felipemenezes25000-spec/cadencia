### Task 25: migration 0098 — schema inv, tabela product e supplier

**Arquivos**

- Criar `packages/db/migrations/0098_inv_schema_product.sql`
- Teste `packages/inventory/src/schema.int.test.ts` (criado na Task 26, valida aqui tambem)

**Passos**

- [ ] Criar a migration `packages/db/migrations/0098_inv_schema_product.sql`:

```sql
-- 0098_inv_schema_product.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema `inv` nasce aqui, com o mesmo dono e padrao de GRANT dos demais.
-- Fornecedor (inv.supplier) e produto (inv.product) sao as entidades base
-- do estoque. current_stock e DERIVADO: o trigger da Task 27 (migration 0099)
-- o mantem sincronizado com inv.stock_movement.

-- ---------------------------------------------------------------------------
-- 0. Schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA inv AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA inv TO app_rw, clin_writer, app_support;

-- ---------------------------------------------------------------------------
-- 1. Unidade de medida (enum)
-- ---------------------------------------------------------------------------
CREATE TYPE inv.unit_kind AS ENUM ('un', 'cx', 'ml', 'g', 'kg');

-- ---------------------------------------------------------------------------
-- 2. Fornecedor
-- ---------------------------------------------------------------------------
CREATE TABLE inv.supplier (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  name         text NOT NULL COLLATE "pt-BR-x-icu",
  cnpj         text,
  phone        text,
  email        text,
  notes        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE inv.supplier OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON inv.supplier TO app_rw;
ALTER TABLE inv.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.supplier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.supplier AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Produto
-- ---------------------------------------------------------------------------
CREATE TABLE inv.product (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  name             text NOT NULL COLLATE "pt-BR-x-icu",
  sku              text COLLATE "pt-BR-x-icu",
  unit             inv.unit_kind NOT NULL DEFAULT 'un',
  min_stock        numeric NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  current_stock    numeric NOT NULL DEFAULT 0,
  cost_price_cents bigint NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0),
  sale_price_cents bigint NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
  supplier_id      uuid,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES inv.supplier(tenant_id, id)
);
ALTER TABLE inv.product OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON inv.product TO app_rw;

-- SKU unico parcial: so entre ativos, e so quando preenchido
CREATE UNIQUE INDEX ux_product_sku_active
  ON inv.product (tenant_id, sku) WHERE active AND sku IS NOT NULL;

CREATE INDEX ix_product_name
  ON inv.product (tenant_id, name COLLATE "pt-BR-x-icu") WHERE active;

ALTER TABLE inv.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.product FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.product AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0098 aplicada sem erro.

- [ ] Rodar a suite de isolamento para garantir que as tabelas novas passam:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas (incluindo `inv.supplier` e `inv.product`) passam nos testes de RLS e FK composta.

- [ ] Commitar:

```bash
git add packages/db/migrations/0098_inv_schema_product.sql
git commit -m "feat(db): add inv schema with supplier and product tables

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 26: migration 0099 — stock_movement, trigger de current_stock e stock_alert

**Arquivos**

- Criar `packages/db/migrations/0099_inv_stock_movement_alert.sql`
- Criar `packages/inventory/src/schema.int.test.ts`

**Passos**

- [ ] Criar o teste `packages/inventory/src/schema.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(() => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('schema inv — tabelas de estoque existem', () => {
  it('inv.supplier existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'supplier'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('inv.product existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'product'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('inv.stock_movement existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'stock_movement'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('inv.stock_alert existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'stock_alert'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('trigger inv_update_current_stock existe em stock_movement', async () => {
    const { rows } = await admin.query<{ tgname: string }>(
      `SELECT t.tgname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'stock_movement'
          AND t.tgname = 'trg_update_current_stock'`);
    expect(rows).toHaveLength(1);
  });

  it('current_stock e derivado: trigger recalcula soma apos INSERT', async () => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');

      const tenantId = '019145a0-0000-7000-8000-000000000001';
      const clinicId = '019145a0-0000-7000-8000-000000000002';
      const userId   = '019145a0-0000-7000-8000-000000000003';
      const productId = '019145a0-0000-7000-8000-000000000010';

      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'inv-test', 'Clinica Estoque', '11ABC22301DE44')`,
        [tenantId]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Inv', '9999991', 'America/Sao_Paulo')`,
        [tenantId, clinicId]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Inv Tester')`,
        [userId, 'inv-test@example.test']);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [tenantId, userId, clinicId]);

      await c.query(
        `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock)
         VALUES ($1, $2, 'Gaze esteril', 'un', 10)`,
        [tenantId, productId]);

      // Inserir movimento de entrada: 50 unidades
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'entrada', 50, 'Compra inicial', 'compra', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterEntry } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterEntry[0]!.current_stock)).toBe(50);

      // Inserir movimento de saida: 15 unidades
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'saida', 15, 'Uso em atendimento', 'uso_atendimento', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterExit } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterExit[0]!.current_stock)).toBe(35);

      // Inserir ajuste: +5
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'ajuste', 5, 'Recontagem', 'ajuste_manual', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterAdjust } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterAdjust[0]!.current_stock)).toBe(40);

      // Inserir perda: 2
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'perda', 2, 'Danificado', 'perda', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterLoss } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterLoss[0]!.current_stock)).toBe(38);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
```

- [ ] Rodar o teste e confirmar que falha (tabelas nao existem ainda):

```bash
pnpm vitest run packages/inventory/src/schema.int.test.ts
```

Saida esperada: FAIL — `relation "inv.stock_movement" does not exist`.

- [ ] Criar a migration `packages/db/migrations/0099_inv_stock_movement_alert.sql`:

```sql
-- 0099_inv_stock_movement_alert.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Movimentacao de estoque e alerta de estoque minimo. O current_stock de
-- inv.product e DERIVADO: um trigger AFTER INSERT em stock_movement recalcula
-- a soma real (entrada - saida - perda + ajuste). A soma e conferida, nao confiada.

-- ---------------------------------------------------------------------------
-- 1. Tipo de movimentacao
-- ---------------------------------------------------------------------------
CREATE TYPE inv.movement_kind AS ENUM ('entrada', 'saida', 'ajuste', 'perda');

-- ---------------------------------------------------------------------------
-- 2. Tipo de referencia da movimentacao
-- ---------------------------------------------------------------------------
CREATE TYPE inv.reference_type AS ENUM (
  'compra', 'uso_atendimento', 'ajuste_manual', 'perda');

-- ---------------------------------------------------------------------------
-- 3. Movimentacao de estoque
-- ---------------------------------------------------------------------------
CREATE TABLE inv.stock_movement (
  tenant_id      uuid NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid NOT NULL,
  product_id     uuid NOT NULL,
  kind           inv.movement_kind NOT NULL,
  quantity       numeric NOT NULL CHECK (quantity > 0),
  reason         text NOT NULL,
  reference_type inv.reference_type NOT NULL,
  reference_id   uuid,
  moved_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  moved_by       uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES inv.product(tenant_id, id)
);
ALTER TABLE inv.stock_movement OWNER TO app_owner;
GRANT SELECT, INSERT ON inv.stock_movement TO app_rw;

CREATE INDEX ix_movement_product
  ON inv.stock_movement (tenant_id, product_id, moved_at DESC);

ALTER TABLE inv.stock_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_movement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.stock_movement AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 4. Trigger: atualiza current_stock de inv.product apos INSERT
--    A soma e CONFERIDA (SELECT SUM), nao confiada (incremento otimista).
-- ---------------------------------------------------------------------------
CREATE FUNCTION inv.fn_update_current_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_stock numeric;
BEGIN
  SELECT COALESCE(SUM(
    CASE m.kind
      WHEN 'entrada' THEN m.quantity
      WHEN 'ajuste'  THEN m.quantity
      WHEN 'saida'   THEN -m.quantity
      WHEN 'perda'   THEN -m.quantity
    END
  ), 0)
  INTO v_new_stock
  FROM inv.stock_movement m
  WHERE m.tenant_id = NEW.tenant_id AND m.product_id = NEW.product_id;

  UPDATE inv.product
     SET current_stock = v_new_stock
   WHERE tenant_id = NEW.tenant_id AND id = NEW.product_id;

  RETURN NEW;
END;
$$;
ALTER FUNCTION inv.fn_update_current_stock() OWNER TO app_owner;

CREATE TRIGGER trg_update_current_stock
  AFTER INSERT ON inv.stock_movement
  FOR EACH ROW
  EXECUTE FUNCTION inv.fn_update_current_stock();

-- ---------------------------------------------------------------------------
-- 5. Alerta de estoque minimo
-- ---------------------------------------------------------------------------
CREATE TABLE inv.stock_alert (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  product_id   uuid NOT NULL,
  threshold    numeric NOT NULL CHECK (threshold >= 0),
  triggered_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  resolved_at  timestamptz(3),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES inv.product(tenant_id, id)
);
ALTER TABLE inv.stock_alert OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON inv.stock_alert TO app_rw;

CREATE INDEX ix_alert_open
  ON inv.stock_alert (tenant_id, product_id)
  WHERE resolved_at IS NULL;

ALTER TABLE inv.stock_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_alert FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.stock_alert AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 6. GRANTs para jobs (alerta diario)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA inv TO jobs;
GRANT SELECT, INSERT, UPDATE ON inv.product TO jobs;
GRANT SELECT ON inv.stock_movement TO jobs;
GRANT SELECT, INSERT, UPDATE ON inv.stock_alert TO jobs;
GRANT SELECT ON inv.supplier TO jobs;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0099 aplicada sem erro.

- [ ] Rodar o teste de schema:

```bash
pnpm vitest run packages/inventory/src/schema.int.test.ts
```

Saida esperada: todos os 6 testes passam, incluindo o trigger que recalcula current_stock.

- [ ] Rodar a suite de isolamento:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas inv.* passam nos testes de RLS e FK composta.

- [ ] Commitar:

```bash
git add packages/db/migrations/0099_inv_stock_movement_alert.sql
git add packages/inventory/src/schema.int.test.ts
git commit -m "feat(db): add stock_movement with trigger, stock_alert, and schema tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 27: migration 0100 — registrar inv no TENANT_SCHEMAS e chaves de auditoria

**Arquivos**

- Criar `packages/db/migrations/0100_inv_tenant_schemas_audit_keys.sql`
- Modificar `packages/db/src/invariants/catalog.ts` — adicionar `'inv'` ao `TENANT_SCHEMAS`
- Modificar `packages/db/src/invariants/catalog.test.ts` — adicionar teste para `'inv'`

**Passos**

- [ ] Criar o teste que vai falhar. Modificar `packages/db/src/invariants/catalog.test.ts` adicionando apos o teste de `'msg'`:

```typescript
  it('inclui inv no TENANT_SCHEMAS', () => {
    expect(TENANT_SCHEMAS).toContain('inv');
  });
```

- [ ] Rodar o teste e confirmar que falha:

```bash
pnpm vitest run packages/db/src/invariants/catalog.test.ts
```

Saida esperada: FAIL — `expected [...] to contain 'inv'`.

- [ ] Modificar `packages/db/src/invariants/catalog.ts` — trocar a linha do `TENANT_SCHEMAS`:

```typescript
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg', 'inv'] as const;
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/db/src/invariants/catalog.test.ts
```

Saida esperada: PASS.

- [ ] Criar a migration `packages/db/migrations/0100_inv_tenant_schemas_audit_keys.sql`:

```sql
-- 0100_inv_tenant_schemas_audit_keys.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Duas responsabilidades:
-- 1. Adicionar chaves de auditoria do modulo de estoque a whitelist.
-- 2. GRANT de USAGE no schema inv para audit_owner (audit.log precisa enxergar
--    as tabelas de inv para gravar entity_schema/entity_table).

-- ---------------------------------------------------------------------------
-- 1. GRANT de USAGE no schema inv para audit_owner
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA inv TO audit_owner;

-- ---------------------------------------------------------------------------
-- 2. Whitelist de chaves de auditoria para estoque
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'product_name',
              'quantity',
              'movement_kind',
              'reference_type',
              'threshold',
              'current_stock',
              'sku'
            )
         );
$$;

RESET ROLE;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0100 aplicada sem erro.

- [ ] Rodar todos os invariantes:

```bash
pnpm vitest run packages/db/src/invariants/
```

Saida esperada: todos os invariantes passam, incluindo inv.* no regime multi-tenant.

- [ ] Commitar:

```bash
git add packages/db/migrations/0100_inv_tenant_schemas_audit_keys.sql
git add packages/db/src/invariants/catalog.ts
git add packages/db/src/invariants/catalog.test.ts
git commit -m "feat(db): register inv in TENANT_SCHEMAS and add inventory audit keys

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 28: dominio inventory — registerProduct e recordMovement

**Arquivos**

- Criar `packages/inventory/src/register-product.ts`
- Criar `packages/inventory/src/record-movement.ts`
- Criar `packages/inventory/src/test-support.ts`
- Criar `packages/inventory/src/register-product.int.test.ts`
- Criar `packages/inventory/src/record-movement.int.test.ts`
- Modificar `packages/inventory/src/index.ts`
- Modificar `packages/inventory/package.json` — adicionar dependencias

**Passos**

- [ ] Modificar `packages/inventory/package.json` para adicionar dependencias:

```json
{
  "name": "@cadencia/inventory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*",
    "@cadencia/db": "workspace:*"
  },
  "devDependencies": {
    "pg": "^8.16.0",
    "vitest": "^3.2.1"
  }
}
```

- [ ] Criar `packages/inventory/src/test-support.ts`:

```typescript
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeEstoque {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  supplierId: string;
  productId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearEstoque(): Promise<SementeEstoque> {
  const s: SementeEstoque = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), supplierId: uuidv7(), productId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Estoque', '55ABC66701DE88')`,
      [s.tenantId, `inv-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Inv', '8888881', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Estoquista')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO inv.supplier (tenant_id, id, name)
       VALUES ($1, $2, 'Fornecedor A')`,
      [s.tenantId, s.supplierId]);
    await c.query(
      `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock, cost_price_cents, sale_price_cents, supplier_id)
       VALUES ($1, $2, 'Gaze esteril 10x10', 'un', 20, 150, 500, $3)`,
      [s.tenantId, s.productId, s.supplierId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

- [ ] Criar `packages/inventory/src/register-product.ts`:

```typescript
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type ProductFailure =
  | { kind: 'fornecedor_nao_encontrado' }
  | { kind: 'sku_duplicado'; sku: string };

export interface RegisterProductInput {
  readonly name: string;
  readonly sku?: string;
  readonly unit: 'un' | 'cx' | 'ml' | 'g' | 'kg';
  readonly minStock: number;
  readonly costPriceCents: number;
  readonly salePriceCents: number;
  readonly supplierId?: string;
}

export interface RegisteredProduct {
  readonly productId: string;
  readonly name: string;
  readonly currentStock: number;
}

export async function registerProduct(
  tx: TxClient,
  i: RegisterProductInput,
  clinicId: string,
): Promise<Result<RegisteredProduct, ProductFailure>> {
  if (i.supplierId !== undefined) {
    const { rows: supplierRows } = await tx.query<{ id: string }>(
      `SELECT id FROM inv.supplier WHERE id = $1`, [i.supplierId]);
    if (supplierRows.length === 0) return err({ kind: 'fornecedor_nao_encontrado' });
  }

  const productId = uuidv7();

  try {
    await tx.query(
      `INSERT INTO inv.product
         (id, name, sku, unit, min_stock, cost_price_cents, sale_price_cents, supplier_id)
       VALUES ($1, $2, $3, $4::inv.unit_kind, $5, $6, $7, $8)`,
      [productId, i.name, i.sku ?? null, i.unit, i.minStock,
       i.costPriceCents, i.salePriceCents, i.supplierId ?? null]);
  } catch (e: unknown) {
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && i.sku !== undefined) {
      return err({ kind: 'sku_duplicado', sku: i.sku });
    }
    throw e;
  }

  await tx.query(
    `SELECT audit.log('PRODUCT_REGISTER', 'inv', 'product', $1, 'sucesso',
                      jsonb_build_object('product_name', $2::text,
                                         'sku', COALESCE($3::text, ''),
                                         'quantity', '0'), $4)`,
    [productId, i.name, i.sku ?? null, clinicId]);

  return ok({ productId, name: i.name, currentStock: 0 });
}
```

- [ ] Criar o teste `packages/inventory/src/register-product.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { registerProduct } from './register-product';
import { semearEstoque, type SementeEstoque } from './test-support';

let s: SementeEstoque;
let actor: Actor;

beforeAll(async () => {
  s = await semearEstoque();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('registerProduct — cadastro de produto no estoque', () => {
  it('cadastra produto com fornecedor', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Luva descartavel M',
        sku: 'LUV-M-001',
        unit: 'cx',
        minStock: 10,
        costPriceCents: 2500,
        salePriceCents: 5000,
        supplierId: s.supplierId,
      }, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Luva descartavel M');
    expect(r.value.currentStock).toBe(0);
  });

  it('cadastra produto sem fornecedor e sem SKU', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Algodao 500g',
        unit: 'un',
        minStock: 5,
        costPriceCents: 800,
        salePriceCents: 1500,
      }, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Algodao 500g');
  });

  it('rejeita fornecedor inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Produto X',
        unit: 'un',
        minStock: 0,
        costPriceCents: 100,
        salePriceCents: 200,
        supplierId: uuidv7(),
      }, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('fornecedor_nao_encontrado');
  });

  it('rejeita SKU duplicado entre produtos ativos', async () => {
    const sku = `DUP-${uuidv7().slice(0, 8)}`;
    await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Produto Original',
        sku,
        unit: 'un',
        minStock: 0,
        costPriceCents: 100,
        salePriceCents: 200,
      }, s.clinicId));

    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Produto Duplicado',
        sku,
        unit: 'un',
        minStock: 0,
        costPriceCents: 100,
        salePriceCents: 200,
      }, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('sku_duplicado');
  });

  it('grava evento de auditoria PRODUCT_REGISTER', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Esparadrapo micropore',
        sku: `AUD-${uuidv7().slice(0, 8)}`,
        unit: 'un',
        minStock: 3,
        costPriceCents: 350,
        salePriceCents: 700,
      }, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, async (tx) => {
      return tx.query<{ event_type: string; entity_id: string }>(
        `SELECT event_type, entity_id::text
           FROM audit.event
          WHERE entity_id = $1 AND event_type = 'PRODUCT_REGISTER'`,
        [r.value.productId]);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('PRODUCT_REGISTER');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (funcao nao existe ainda):

```bash
pnpm vitest run packages/inventory/src/register-product.int.test.ts
```

Saida esperada: FAIL — modulo nao encontrado ou funcao nao exportada.

- [ ] Criar `packages/inventory/src/record-movement.ts`:

```typescript
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type MovementFailure =
  | { kind: 'produto_nao_encontrado' }
  | { kind: 'quantidade_invalida' };

export type MovementKind = 'entrada' | 'saida' | 'ajuste' | 'perda';
export type ReferenceType = 'compra' | 'uso_atendimento' | 'ajuste_manual' | 'perda';

export interface RecordMovementInput {
  readonly productId: string;
  readonly kind: MovementKind;
  readonly quantity: number;
  readonly reason: string;
  readonly referenceType: ReferenceType;
  readonly referenceId?: string;
}

export interface RecordedMovement {
  readonly movementId: string;
  readonly productId: string;
  readonly newStock: number;
}

export async function recordMovement(
  tx: TxClient,
  i: RecordMovementInput,
  movedBy: string,
  clinicId: string,
): Promise<Result<RecordedMovement, MovementFailure>> {
  if (i.quantity <= 0) return err({ kind: 'quantidade_invalida' });

  const { rows: productRows } = await tx.query<{ id: string }>(
    `SELECT id FROM inv.product WHERE id = $1`, [i.productId]);
  if (productRows.length === 0) return err({ kind: 'produto_nao_encontrado' });

  const movementId = uuidv7();

  await tx.query(
    `INSERT INTO inv.stock_movement
       (id, product_id, kind, quantity, reason, reference_type, reference_id, moved_by)
     VALUES ($1, $2, $3::inv.movement_kind, $4, $5,
             $6::inv.reference_type, $7, $8)`,
    [movementId, i.productId, i.kind, i.quantity, i.reason,
     i.referenceType, i.referenceId ?? null, movedBy]);

  // Ler o current_stock atualizado pelo trigger
  const { rows: stockRows } = await tx.query<{ current_stock: string }>(
    `SELECT current_stock::text FROM inv.product WHERE id = $1`, [i.productId]);
  const newStock = Number(stockRows[0]!.current_stock);

  await tx.query(
    `SELECT audit.log('STOCK_MOVEMENT', 'inv', 'stock_movement', $1, 'sucesso',
                      jsonb_build_object('movement_kind', $2::text,
                                         'quantity', $3::text,
                                         'reference_type', $4::text,
                                         'current_stock', $5::text), $6)`,
    [movementId, i.kind, String(i.quantity), i.referenceType,
     String(newStock), clinicId]);

  return ok({ movementId, productId: i.productId, newStock });
}

export interface AdjustStockInput {
  readonly productId: string;
  readonly newQuantity: number;
  readonly reason: string;
}

/**
 * Ajuste de estoque: calcula a diferenca entre estoque atual e o desejado,
 * e registra uma movimentacao de ajuste (entrada ou saida) para chegar la.
 */
export async function adjustStock(
  tx: TxClient,
  i: AdjustStockInput,
  movedBy: string,
  clinicId: string,
): Promise<Result<RecordedMovement, MovementFailure>> {
  const { rows: productRows } = await tx.query<{ id: string; current_stock: string }>(
    `SELECT id, current_stock::text FROM inv.product WHERE id = $1`, [i.productId]);
  if (productRows.length === 0) return err({ kind: 'produto_nao_encontrado' });

  const currentStock = Number(productRows[0]!.current_stock);
  const diff = i.newQuantity - currentStock;

  if (diff === 0) {
    return ok({ movementId: '', productId: i.productId, newStock: currentStock });
  }

  const kind: MovementKind = diff > 0 ? 'entrada' : 'saida';
  const quantity = Math.abs(diff);

  return recordMovement(tx, {
    productId: i.productId,
    kind,
    quantity,
    reason: i.reason,
    referenceType: 'ajuste_manual',
  }, movedBy, clinicId);
}
```

- [ ] Criar o teste `packages/inventory/src/record-movement.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordMovement, adjustStock } from './record-movement';
import { semearEstoque, type SementeEstoque } from './test-support';

let s: SementeEstoque;
let actor: Actor;

beforeAll(async () => {
  s = await semearEstoque();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('recordMovement — registra movimentacao de estoque', () => {
  it('registra entrada e atualiza current_stock via trigger', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'entrada',
        quantity: 100,
        reason: 'Compra mensal',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(100);
  });

  it('registra saida e decrementa current_stock', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'saida',
        quantity: 15,
        reason: 'Uso em atendimento',
        referenceType: 'uso_atendimento',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(85);
  });

  it('registra perda e decrementa current_stock', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'perda',
        quantity: 5,
        reason: 'Vencido',
        referenceType: 'perda',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(80);
  });

  it('rejeita produto inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: uuidv7(),
        kind: 'entrada',
        quantity: 10,
        reason: 'Teste',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('produto_nao_encontrado');
  });

  it('rejeita quantidade zero ou negativa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'entrada',
        quantity: 0,
        reason: 'Invalido',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('quantidade_invalida');
  });

  it('grava evento de auditoria STOCK_MOVEMENT', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'entrada',
        quantity: 10,
        reason: 'Reposicao para auditoria',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, async (tx) => {
      return tx.query<{ event_type: string; entity_id: string }>(
        `SELECT event_type, entity_id::text
           FROM audit.event
          WHERE entity_id = $1 AND event_type = 'STOCK_MOVEMENT'`,
        [r.value.movementId]);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('STOCK_MOVEMENT');
  });
});

describe('adjustStock — ajusta estoque para quantidade desejada', () => {
  it('ajusta para cima quando newQuantity > currentStock', async () => {
    // current_stock apos testes acima: 80 + 10 = 90
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: s.productId,
        newQuantity: 100,
        reason: 'Recontagem de inventario',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(100);
  });

  it('ajusta para baixo quando newQuantity < currentStock', async () => {
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: s.productId,
        newQuantity: 50,
        reason: 'Recontagem com falta',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(50);
  });

  it('nao cria movimentacao quando diferenca e zero', async () => {
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: s.productId,
        newQuantity: 50,
        reason: 'Sem mudanca',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.movementId).toBe('');
    expect(r.value.newStock).toBe(50);
  });

  it('rejeita produto inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: uuidv7(),
        newQuantity: 10,
        reason: 'Inexistente',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('produto_nao_encontrado');
  });
});
```

- [ ] Modificar `packages/inventory/src/index.ts` para exportar as funcoes:

```typescript
export {
  registerProduct,
  type RegisterProductInput,
  type RegisteredProduct,
  type ProductFailure,
} from './register-product';
export {
  recordMovement,
  adjustStock,
  type RecordMovementInput,
  type RecordedMovement,
  type AdjustStockInput,
  type MovementFailure,
  type MovementKind,
  type ReferenceType,
} from './record-movement';
export {
  getStockAlerts,
  getMovementHistory,
  type StockAlert,
  type MovementHistoryRow,
} from './queries';
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/inventory/src/register-product.int.test.ts
pnpm vitest run packages/inventory/src/record-movement.int.test.ts
```

Saida esperada: todos os testes de ambos os arquivos passam.

- [ ] Commitar:

```bash
git add packages/inventory/src/register-product.ts
git add packages/inventory/src/record-movement.ts
git add packages/inventory/src/test-support.ts
git add packages/inventory/src/register-product.int.test.ts
git add packages/inventory/src/record-movement.int.test.ts
git add packages/inventory/src/index.ts
git add packages/inventory/package.json
git commit -m "feat(inventory): add registerProduct, recordMovement, and adjustStock domain functions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 29: dominio inventory — getStockAlerts e getMovementHistory

**Arquivos**

- Criar `packages/inventory/src/queries.ts`
- Criar `packages/inventory/src/queries.int.test.ts`

**Passos**

- [ ] Criar `packages/inventory/src/queries.ts`:

```typescript
import type { TxClient } from '@cadencia/db';

export interface StockAlert {
  readonly alertId: string;
  readonly productId: string;
  readonly productName: string;
  readonly currentStock: number;
  readonly threshold: number;
  readonly triggeredAt: string;
}

/**
 * Retorna alertas de estoque abertos (resolved_at IS NULL) para o tenant.
 * Junta com inv.product para trazer nome e estoque atual.
 */
export async function getStockAlerts(
  tx: TxClient,
): Promise<StockAlert[]> {
  const { rows } = await tx.query<{
    alert_id: string; product_id: string; product_name: string;
    current_stock: string; threshold: string; triggered_at: string;
  }>(
    `SELECT a.id AS alert_id, a.product_id,
            p.name AS product_name,
            p.current_stock::text,
            a.threshold::text,
            to_char(a.triggered_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS triggered_at
       FROM inv.stock_alert a
       JOIN inv.product p
         ON p.tenant_id = a.tenant_id AND p.id = a.product_id
      WHERE a.resolved_at IS NULL
      ORDER BY a.triggered_at DESC`);

  return rows.map((r) => ({
    alertId: r.alert_id,
    productId: r.product_id,
    productName: r.product_name,
    currentStock: Number(r.current_stock),
    threshold: Number(r.threshold),
    triggeredAt: r.triggered_at,
  }));
}

export interface MovementHistoryRow {
  readonly movementId: string;
  readonly productId: string;
  readonly productName: string;
  readonly kind: string;
  readonly quantity: number;
  readonly reason: string;
  readonly referenceType: string;
  readonly referenceId: string | null;
  readonly movedAt: string;
  readonly movedBy: string;
}

export interface MovementHistoryInput {
  readonly productId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * Historico de movimentacoes com paginacao por cursor (moved_at DESC).
 * Filtravel por produto. Traz o nome do produto junto.
 */
export async function getMovementHistory(
  tx: TxClient,
  i: MovementHistoryInput = {},
): Promise<{ rows: MovementHistoryRow[]; nextCursor: string | null }> {
  const limite = i.limit ?? 50;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (i.productId !== undefined) {
    conditions.push(`m.product_id = $${idx}`);
    params.push(i.productId);
    idx += 1;
  }

  if (i.cursor !== undefined) {
    conditions.push(`m.moved_at < $${idx}::timestamptz`);
    params.push(i.cursor);
    idx += 1;
  }

  params.push(limite + 1);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await tx.query<{
    movement_id: string; product_id: string; product_name: string;
    kind: string; quantity: string; reason: string;
    reference_type: string; reference_id: string | null;
    moved_at: string; moved_by: string;
  }>(
    `SELECT m.id AS movement_id, m.product_id,
            p.name AS product_name,
            m.kind::text, m.quantity::text, m.reason,
            m.reference_type::text,
            m.reference_id::text,
            to_char(m.moved_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS moved_at,
            m.moved_by::text
       FROM inv.stock_movement m
       JOIN inv.product p
         ON p.tenant_id = m.tenant_id AND p.id = m.product_id
     ${where}
      ORDER BY m.moved_at DESC
      LIMIT $${idx}`,
    params);

  const hasMore = rows.length > limite;
  const page = hasMore ? rows.slice(0, limite) : rows;
  const mapped = page.map((r) => ({
    movementId: r.movement_id,
    productId: r.product_id,
    productName: r.product_name,
    kind: r.kind,
    quantity: Number(r.quantity),
    reason: r.reason,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    movedAt: r.moved_at,
    movedBy: r.moved_by,
  }));

  const nextCursor = hasMore && mapped.length > 0
    ? mapped[mapped.length - 1]!.movedAt
    : null;

  return { rows: mapped, nextCursor };
}
```

- [ ] Criar o teste `packages/inventory/src/queries.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { recordMovement } from './record-movement';
import { getStockAlerts, getMovementHistory } from './queries';
import { semearEstoque, type SementeEstoque } from './test-support';

let s: SementeEstoque;
let actor: Actor;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  s = await semearEstoque();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear movimentacoes para historico
  await withTenantTx(actor, (tx) =>
    recordMovement(tx, {
      productId: s.productId,
      kind: 'entrada',
      quantity: 100,
      reason: 'Compra inicial',
      referenceType: 'compra',
    }, s.userId, s.clinicId));

  await withTenantTx(actor, (tx) =>
    recordMovement(tx, {
      productId: s.productId,
      kind: 'saida',
      quantity: 30,
      reason: 'Uso em atendimento',
      referenceType: 'uso_atendimento',
    }, s.userId, s.clinicId));

  // Semear alerta manualmente via admin (simula o job)
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query(
      `INSERT INTO inv.stock_alert (tenant_id, id, product_id, threshold)
       VALUES ($1, gen_random_uuid(), $2, 20)`,
      [s.tenantId, s.productId]);
  } finally {
    c.release();
    await admin.end();
  }
});
afterAll(async () => { await closePools(); });

describe('getStockAlerts — lista alertas de estoque abertos', () => {
  it('retorna alertas nao resolvidos', async () => {
    const alerts = await withTenantTx(actor, (tx) => getStockAlerts(tx));

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const alert = alerts.find((a) => a.productId === s.productId);
    expect(alert).toBeDefined();
    expect(alert!.productName).toBe('Gaze esteril 10x10');
    expect(alert!.threshold).toBe(20);
    expect(alert!.currentStock).toBe(70);
  });

  it('nao retorna alertas resolvidos', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    const resolvedProductId = uuidv7();
    try {
      await c.query(
        `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock)
         VALUES ($1, $2, 'Produto Resolvido', 'un', 5)`,
        [s.tenantId, resolvedProductId]);
      await c.query(
        `INSERT INTO inv.stock_alert (tenant_id, id, product_id, threshold, resolved_at)
         VALUES ($1, gen_random_uuid(), $2, 5, clock_timestamp())`,
        [s.tenantId, resolvedProductId]);
    } finally {
      c.release();
      await admin.end();
    }

    const alerts = await withTenantTx(actor, (tx) => getStockAlerts(tx));
    const resolved = alerts.find((a) => a.productId === resolvedProductId);
    expect(resolved).toBeUndefined();
  });
});

describe('getMovementHistory — historico de movimentacoes', () => {
  it('retorna historico ordenado por data decrescente', async () => {
    const result = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx));

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    // O mais recente (saida) vem primeiro
    expect(result.rows[0]!.kind).toBe('saida');
    expect(result.rows[0]!.quantity).toBe(30);
  });

  it('filtra por productId', async () => {
    const result = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, { productId: s.productId }));

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of result.rows) {
      expect(row.productId).toBe(s.productId);
    }
  });

  it('pagina com cursor', async () => {
    const page1 = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, { productId: s.productId, limit: 1 }));

    expect(page1.rows).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, {
        productId: s.productId,
        limit: 1,
        cursor: page1.nextCursor!,
      }));

    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]!.movementId).not.toBe(page1.rows[0]!.movementId);
  });

  it('retorna nextCursor null quando nao ha mais paginas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, { productId: s.productId, limit: 100 }));

    expect(result.nextCursor).toBeNull();
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/inventory/src/queries.int.test.ts
```

Saida esperada: todos os 6 testes passam.

- [ ] Commitar:

```bash
git add packages/inventory/src/queries.ts
git add packages/inventory/src/queries.int.test.ts
git commit -m "feat(inventory): add getStockAlerts and getMovementHistory query functions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 30: acoes de authz para estoque e evento STOCK_LOW no domain-events

**Arquivos**

- Modificar `packages/authz/src/actions.ts` — adicionar acoes `inventory.*`
- Modificar `packages/events/src/domain-events.ts` — adicionar evento `STOCK_LOW`
- Criar `packages/inventory/src/stock-alert-job.ts`
- Criar `packages/inventory/src/stock-alert-job.int.test.ts`

**Passos**

- [ ] Modificar `packages/authz/src/actions.ts` — adicionar ao final do array `ACTIONS`, antes do `] as const satisfies`:

```typescript
  // -- Fase 3 . Estoque -------------------------------------------------------
  { key: 'inventory.read', description: 'Listar produtos e movimentacoes do estoque',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'inventory.write', description: 'Cadastrar produto e registrar movimentacao',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'inventory.adjust', description: 'Ajustar estoque manualmente',
    roles: ['admin_clinico', 'financeiro'] },
```

- [ ] Rodar o teste de catalogo para confirmar consistencia:

```bash
pnpm vitest run packages/authz/src/catalog.test.ts
```

Saida esperada: PASS — chaves unicas e papeis validos.

- [ ] Modificar `packages/events/src/domain-events.ts` — adicionar `'STOCK_LOW'` ao `EVENT_TYPES`:

```typescript
export const EVENT_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER_DUE',
  'ENCOUNTER_FINALIZED',
  'PAYMENT_RECEIVED',
  'PAYMENT_LINK_CREATED',
  'INBOUND_MESSAGE_RECEIVED',
  'STOCK_LOW',
] as const;
```

- [ ] Adicionar o payload e o tipo concreto apos `InboundMessageReceivedPayload`:

```typescript
export interface StockLowPayload {
  readonly productId: string;
  readonly productName: string;
  readonly currentStock: number;
  readonly threshold: number;
}
```

- [ ] Adicionar o tipo concreto apos `InboundMessageReceived`:

```typescript
export type StockLow = DomainEventBase<'STOCK_LOW', StockLowPayload>;
```

- [ ] Atualizar a uniao `DomainEvent` para incluir `StockLow`:

```typescript
export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived
  | StockLow;
```

- [ ] Criar `packages/inventory/src/stock-alert-job.ts`:

```typescript
import type { Pool } from 'pg';

export interface AlertJobResult {
  readonly created: number;
  readonly resolved: number;
}

/**
 * Job diario de alerta de estoque. Roda com o papel `jobs` (BYPASSRLS),
 * NAO usa withTenantTx. Varre todos os tenants:
 * 1. Cria alerta para produtos com current_stock < min_stock que nao tem alerta aberto.
 * 2. Resolve alertas cujo produto voltou ao nivel (current_stock >= min_stock).
 * 3. Enfileira evento STOCK_LOW no outbox para cada alerta criado.
 */
export async function runStockAlertJob(jobsPool: Pool): Promise<AlertJobResult> {
  const c = await jobsPool.connect();
  let created = 0;
  let resolved = 0;

  try {
    await c.query('BEGIN');

    // 1. Criar alertas para produtos abaixo do minimo sem alerta aberto
    const { rows: newAlerts } = await c.query<{
      tenant_id: string; product_id: string;
      product_name: string; current_stock: string; min_stock: string;
    }>(
      `INSERT INTO inv.stock_alert (tenant_id, id, product_id, threshold)
       SELECT p.tenant_id, gen_random_uuid(), p.id, p.min_stock
         FROM inv.product p
        WHERE p.active
          AND p.min_stock > 0
          AND p.current_stock < p.min_stock
          AND NOT EXISTS (
            SELECT 1 FROM inv.stock_alert a
             WHERE a.tenant_id = p.tenant_id
               AND a.product_id = p.id
               AND a.resolved_at IS NULL
          )
       RETURNING tenant_id, product_id,
                 (SELECT name FROM inv.product WHERE id = product_id AND tenant_id = inv.stock_alert.tenant_id) AS product_name,
                 (SELECT current_stock::text FROM inv.product WHERE id = product_id AND tenant_id = inv.stock_alert.tenant_id) AS current_stock,
                 threshold::text AS min_stock`);

    created = newAlerts.length;

    // 2. Enfileirar eventos STOCK_LOW no outbox para cada novo alerta
    for (const alert of newAlerts) {
      await c.query(
        `INSERT INTO app.outbox (tenant_id, event_type, aggregate_id, payload)
         VALUES ($1, 'STOCK_LOW', $2,
                 jsonb_build_object(
                   'productId', $3::text,
                   'productName', $4::text,
                   'currentStock', $5::numeric,
                   'threshold', $6::numeric
                 ))`,
        [alert.tenant_id, alert.product_id,
         alert.product_id, alert.product_name,
         Number(alert.current_stock), Number(alert.min_stock)]);
    }

    // 3. Resolver alertas cujo produto voltou ao nivel
    const { rowCount: resolvedCount } = await c.query(
      `UPDATE inv.stock_alert a
          SET resolved_at = clock_timestamp()
         FROM inv.product p
        WHERE a.tenant_id = p.tenant_id
          AND a.product_id = p.id
          AND a.resolved_at IS NULL
          AND p.current_stock >= p.min_stock`);

    resolved = resolvedCount ?? 0;

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  return { created, resolved };
}
```

- [ ] Criar o teste `packages/inventory/src/stock-alert-job.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { runStockAlertJob } from './stock-alert-job';

let jobsPool: Pool;
let admin: Pool;
let tenantId: string;
let clinicId: string;
let userId: string;
let productBelowId: string;
let productAboveId: string;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} ausente`);
  return v;
}

beforeAll(async () => {
  jobsPool = new Pool({ connectionString: requireEnv('DATABASE_URL_JOBS'), max: 2 });
  admin = new Pool({ connectionString: requireEnv('DATABASE_URL_ADMIN'), max: 1 });

  tenantId = uuidv7();
  clinicId = uuidv7();
  userId = uuidv7();
  productBelowId = uuidv7();
  productAboveId = uuidv7();

  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica AlertJob', '77ABC88901DE00')`,
      [tenantId, `aj-${tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade AJ', '7777771', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Job User')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [tenantId, userId, clinicId]);

    // Produto ABAIXO do minimo (current_stock=5, min_stock=20)
    await c.query(
      `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock, current_stock)
       VALUES ($1, $2, 'Seringa 5ml', 'un', 20, 5)`,
      [tenantId, productBelowId]);

    // Produto ACIMA do minimo (current_stock=50, min_stock=10)
    await c.query(
      `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock, current_stock)
       VALUES ($1, $2, 'Algodao 500g', 'un', 10, 50)`,
      [tenantId, productAboveId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await jobsPool.end();
  await admin.end();
});

describe('runStockAlertJob — job diario de alerta de estoque', () => {
  it('cria alerta para produto abaixo do minimo', async () => {
    const result = await runStockAlertJob(jobsPool);

    expect(result.created).toBeGreaterThanOrEqual(1);

    const { rows } = await admin.query<{ product_id: string; resolved_at: string | null }>(
      `SELECT product_id::text, resolved_at
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2 AND resolved_at IS NULL`,
      [tenantId, productBelowId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolved_at).toBeNull();
  });

  it('nao cria alerta duplicado na segunda execucao', async () => {
    const result = await runStockAlertJob(jobsPool);

    // Nenhum novo alerta deve ser criado para o mesmo produto
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2 AND resolved_at IS NULL`,
      [tenantId, productBelowId]);

    expect(Number(rows[0]!.cnt)).toBe(1);
  });

  it('nao cria alerta para produto acima do minimo', async () => {
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2`,
      [tenantId, productAboveId]);

    expect(Number(rows[0]!.cnt)).toBe(0);
  });

  it('resolve alerta quando produto volta acima do minimo', async () => {
    // Subir o estoque do produto para acima do minimo
    const c = await admin.connect();
    try {
      await c.query(
        `UPDATE inv.product SET current_stock = 25 WHERE id = $1`,
        [productBelowId]);
    } finally {
      c.release();
    }

    const result = await runStockAlertJob(jobsPool);
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    const { rows } = await admin.query<{ resolved_at: string | null }>(
      `SELECT resolved_at::text
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2
        ORDER BY triggered_at DESC LIMIT 1`,
      [tenantId, productBelowId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolved_at).not.toBeNull();
  });

  it('enfileira evento STOCK_LOW no outbox para alertas novos', async () => {
    // Baixar estoque de volta para disparar novo alerta
    const c = await admin.connect();
    try {
      await c.query(
        `UPDATE inv.product SET current_stock = 3 WHERE id = $1`,
        [productBelowId]);
    } finally {
      c.release();
    }

    await runStockAlertJob(jobsPool);

    const { rows } = await admin.query<{ event_type: string; aggregate_id: string }>(
      `SELECT event_type, aggregate_id::text
         FROM app.outbox
        WHERE tenant_id = $1 AND event_type = 'STOCK_LOW' AND aggregate_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, productBelowId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('STOCK_LOW');
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/inventory/src/stock-alert-job.int.test.ts
```

Saida esperada: todos os 5 testes passam.

- [ ] Rodar todos os testes do inventory:

```bash
pnpm vitest run packages/inventory/
```

Saida esperada: todos os testes do pacote passam (schema, register-product, record-movement, queries, stock-alert-job).

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts
git add packages/events/src/domain-events.ts
git add packages/inventory/src/stock-alert-job.ts
git add packages/inventory/src/stock-alert-job.int.test.ts
git commit -m "feat(inventory): add authz actions, STOCK_LOW event, and daily alert job

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
