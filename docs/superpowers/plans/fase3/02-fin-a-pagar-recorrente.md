### Task 7: Migration 0089 — tabela fin.supplier e FK em fin.entry

**Arquivos**
- Criar `packages/db/migrations/0089_fin_supplier.sql`
- Teste `packages/payments/src/supplier.int.test.ts`

- [ ] **Passo 1 — teste que falha: inserir fornecedor com RLS ativa**

Criar o arquivo de teste que tenta inserir e ler um fornecedor. Vai falhar porque a tabela nao existe.

```ts
// packages/payments/src/supplier.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeSupplier {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearSupplier(): Promise<SementeSupplier> {
  const s: SementeSupplier = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Fornecedor', '99ABC88701DE12')`,
      [s.tenantId, `sup-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Sup', '9876543', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Sup')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
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

let s: SementeSupplier;
let actor: Actor;

beforeAll(async () => {
  s = await semearSupplier();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.supplier — CRUD com RLS', () => {
  it('insere e le fornecedor com RLS ativa', async () => {
    const supplierId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier
           (tenant_id, id, name, cpf_cnpj, contact, active)
         VALUES (app.require_tenant_id(), $1, 'Dental Brasil', '12ABC34501DE35', 'contato@dental.br', true)`,
        [supplierId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; cpf_cnpj: string; active: boolean }>(
        `SELECT name, cpf_cnpj, active FROM fin.supplier WHERE id = $1`,
        [supplierId]));

    expect(rows[0]).toEqual({
      name: 'Dental Brasil',
      cpf_cnpj: '12ABC34501DE35',
      active: true,
    });
  });

  it('isolamento de tenant: outro tenant nao ve o fornecedor', async () => {
    const otherTenant = uuidv7();
    const otherUser = uuidv7();
    const otherClinic = uuidv7();

    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant', '77ABC66501DE99')`,
        [otherTenant, `ot-${otherTenant}`]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Outro', '1111111', 'America/Sao_Paulo')`,
        [otherTenant, otherClinic]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Outro User')`,
        [otherUser, `${otherUser}@example.test`]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenant, otherUser, otherClinic]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const otherActor: Actor = {
      kind: 'user', tenantId: otherTenant, userId: otherUser,
      clinicId: otherClinic, requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(`SELECT id::text FROM fin.supplier`));

    expect(rows).toHaveLength(0);
  });

  it('nome do fornecedor e COLLATE pt-BR-x-icu', async () => {
    const id1 = uuidv7();
    const id2 = uuidv7();
    const id3 = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier (tenant_id, id, name, active)
         VALUES (app.require_tenant_id(), $1, 'Acores', true),
                (app.require_tenant_id(), $2, 'Abacate', true),
                (app.require_tenant_id(), $3, 'Acai', true)`,
        [id1, id2, id3]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string }>(
        `SELECT name FROM fin.supplier
          WHERE id IN ($1, $2, $3)
          ORDER BY name`,
        [id1, id2, id3]));

    expect(rows.map((r) => r.name)).toEqual(['Abacate', 'Acai', 'Acores']);
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    const nameUnique = `DuplicateTest-${uuidv7()}`;
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier (tenant_id, id, name, active)
         VALUES (app.require_tenant_id(), $1, $2, true)`,
        [uuidv7(), nameUnique]);
    });

    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.supplier (tenant_id, id, name, active)
           VALUES (app.require_tenant_id(), $1, $2, true)`,
          [uuidv7(), nameUnique]);
      }),
    ).rejects.toThrow();
  });
});

describe('fin.entry.supplier_id — FK para fornecedor', () => {
  it('vincula lancamento de despesa a fornecedor', async () => {
    const supplierId = uuidv7();
    const entryId = uuidv7();
    const paymentMethodId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier (tenant_id, id, name, active)
         VALUES (app.require_tenant_id(), $1, 'Fornecedor Vinculado', true)`,
        [supplierId]);
      await tx.query(
        `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
         VALUES (app.require_tenant_id(), $1, 'pix', 'Pix Sup')`,
        [paymentMethodId]);
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key, supplier_id)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Material odontologico', 50000, $4, 'pendente', $5, $6)`,
        [entryId, s.professionalId, s.clinicId, paymentMethodId,
         `sup-${entryId}`, supplierId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ supplier_id: string; kind: string }>(
        `SELECT supplier_id::text, kind::text FROM fin.entry WHERE id = $1`,
        [entryId]));

    expect(rows[0]).toEqual({ supplier_id: supplierId, kind: 'despesa' });
  });

  it('rejeita supplier_id inexistente (FK composta)', async () => {
    const paymentMethodId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
         VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro Sup FK')`,
        [paymentMethodId]);
    });

    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key, supplier_id)
           VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                   'FK invalida', 10000, $4, 'pendente', $5, $6)`,
          [uuidv7(), s.professionalId, s.clinicId, paymentMethodId,
           `fk-bad-${uuidv7()}`, uuidv7()]);
      }),
    ).rejects.toThrow();
  });
});
```

Rodar:

```bash
pnpm vitest run packages/payments/src/supplier.int.test.ts
```

Saida esperada: falha com `relation "fin.supplier" does not exist`.

- [ ] **Passo 2 — migration 0089: tabela fin.supplier + ALTER TABLE fin.entry**

```sql
-- packages/db/migrations/0089_fin_supplier.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — Fornecedor e FK em fin.entry.supplier_id.
-- cpf_cnpj e varchar(14) alfanumerico (CNPJ novo desde 01/07/2026).

-- ---------------------------------------------------------------------------
-- 1. Tabela de fornecedores
-- ---------------------------------------------------------------------------
CREATE TABLE fin.supplier (
  tenant_id  uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id         uuid           NOT NULL,
  name       text           NOT NULL COLLATE "pt-BR-x-icu",
  cpf_cnpj   varchar(14),
  contact    text,
  active     boolean        NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE fin.supplier OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.supplier TO app_rw;

ALTER TABLE fin.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.supplier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.supplier AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_supplier_active ON fin.supplier (tenant_id, active)
  WHERE active;

-- ---------------------------------------------------------------------------
-- 2. FK composta em fin.entry para fornecedor (nullable — retrocompativel)
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry ADD COLUMN supplier_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_supplier
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES fin.supplier(tenant_id, id);

CREATE INDEX ix_entry_supplier ON fin.entry (tenant_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. GRANT para jobs (BYPASSRLS ignora POLICY, nao ignora GRANT)
-- ---------------------------------------------------------------------------
GRANT SELECT ON fin.supplier TO jobs;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0089 aplicada com sucesso.

- [ ] **Passo 3 — rodar teste e confirmar que passa**

```bash
pnpm vitest run packages/payments/src/supplier.int.test.ts
```

Saida esperada: todos os testes passam (5 testes).

- [ ] **Passo 4 — commit**

```bash
git add packages/db/migrations/0089_fin_supplier.sql packages/payments/src/supplier.int.test.ts
git commit -m "feat(db): add fin.supplier table and supplier_id FK on fin.entry

Migration 0089: supplier table with RLS, COLLATE, FK composta.
ALTER TABLE fin.entry adds supplier_id (nullable, retrocompat).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Migration 0090 — tabela fin.installment_plan

**Arquivos**
- Criar `packages/db/migrations/0090_fin_installment_plan.sql`
- Teste `packages/payments/src/installment.int.test.ts`

- [ ] **Passo 1 — teste que falha: criar plano de parcelamento com parcelas vinculadas**

```ts
// packages/payments/src/installment.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeInstallment {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  motherEntryId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearInstallment(): Promise<SementeInstallment> {
  const s: SementeInstallment = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    paymentMethodId: uuidv7(), motherEntryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Parcela', '11ABC22301DE44')`,
      [s.tenantId, `inst-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Inst', '5555555', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Inst')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'cartao_credito', 'Cartao Credito Inst')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key, created_by)
       VALUES ($1, $2, 'despesa', $3, $4,
               'Equipamento odontologico', 120000, $5, 'pendente',
               $6, $7)`,
      [s.tenantId, s.motherEntryId, s.professionalId, s.clinicId,
       s.paymentMethodId, `mother-${s.motherEntryId}`, s.userId]);
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

let s: SementeInstallment;
let actor: Actor;

beforeAll(async () => {
  s = await semearInstallment();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.installment_plan — parcelamento', () => {
  it('cria plano de parcelamento com parcela-mae e filhas', async () => {
    const planId = uuidv7();
    const child1Id = uuidv7();
    const child2Id = uuidv7();
    const child3Id = uuidv7();

    await withTenantTx(actor, async (tx) => {
      // Cria 3 entries filhas (parcelas)
      for (const [id, desc, due] of [
        [child1Id, 'Parcela 1/3', '2026-09-15'],
        [child2Id, 'Parcela 2/3', '2026-10-15'],
        [child3Id, 'Parcela 3/3', '2026-11-15'],
      ] as const) {
        await tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, due_date, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                   $4, 40000, $5, 'pendente', $6::date, $7)`,
          [id, s.professionalId, s.clinicId, desc, s.paymentMethodId, due,
           `inst-${id}`]);
      }

      // Cria o plano de parcelamento
      await tx.query(
        `INSERT INTO fin.installment_plan
           (tenant_id, id, mother_entry_id, total_installments, generated_installments)
         VALUES (app.require_tenant_id(), $1, $2, 3, 3)`,
        [planId, s.motherEntryId]);

      // Vincula parcelas ao plano
      await tx.query(
        `UPDATE fin.entry SET installment_plan_id = $1
          WHERE id IN ($2, $3, $4)`,
        [planId, child1Id, child2Id, child3Id]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        total_installments: number;
        generated_installments: number;
        linked_entries: string;
      }>(
        `SELECT ip.total_installments, ip.generated_installments,
                count(e.id)::text AS linked_entries
           FROM fin.installment_plan ip
           LEFT JOIN fin.entry e ON e.installment_plan_id = ip.id
          WHERE ip.id = $1
          GROUP BY ip.id`,
        [planId]));

    expect(rows[0]).toEqual({
      total_installments: 3,
      generated_installments: 3,
      linked_entries: '3',
    });
  });

  it('rejeita mother_entry_id inexistente (FK composta)', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.installment_plan
             (tenant_id, id, mother_entry_id, total_installments, generated_installments)
           VALUES (app.require_tenant_id(), $1, $2, 3, 0)`,
          [uuidv7(), uuidv7()]);
      }),
    ).rejects.toThrow();
  });

  it('rejeita total_installments menor que 2', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.installment_plan
             (tenant_id, id, mother_entry_id, total_installments, generated_installments)
           VALUES (app.require_tenant_id(), $1, $2, 1, 0)`,
          [uuidv7(), s.motherEntryId]);
      }),
    ).rejects.toThrow();
  });
});
```

Rodar:

```bash
pnpm vitest run packages/payments/src/installment.int.test.ts
```

Saida esperada: falha com `relation "fin.installment_plan" does not exist`.

- [ ] **Passo 2 — migration 0090: tabela fin.installment_plan + installment_plan_id em fin.entry**

```sql
-- packages/db/migrations/0090_fin_installment_plan.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — Plano de parcelamento.
-- A parcela-mae e uma fin.entry existente. As parcelas filhas sao outras
-- fin.entry com installment_plan_id apontando para o plano.

-- ---------------------------------------------------------------------------
-- 1. Tabela de plano de parcelamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.installment_plan (
  tenant_id              uuid    NOT NULL DEFAULT app.require_tenant_id(),
  id                     uuid    NOT NULL,
  mother_entry_id        uuid    NOT NULL,
  total_installments     int     NOT NULL CHECK (total_installments >= 2),
  generated_installments int     NOT NULL DEFAULT 0 CHECK (generated_installments >= 0),
  created_at             timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, mother_entry_id),
  FOREIGN KEY (tenant_id, mother_entry_id)
    REFERENCES fin.entry(tenant_id, id)
);
ALTER TABLE fin.installment_plan OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.installment_plan TO app_rw;

ALTER TABLE fin.installment_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.installment_plan FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.installment_plan AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. FK de parcela filha → plano (nullable — entries avulsas nao tem plano)
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry ADD COLUMN installment_plan_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_installment_plan
    FOREIGN KEY (tenant_id, installment_plan_id)
    REFERENCES fin.installment_plan(tenant_id, id);

CREATE INDEX ix_entry_installment_plan ON fin.entry (tenant_id, installment_plan_id)
  WHERE installment_plan_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. GRANT para jobs
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON fin.installment_plan TO jobs;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0090 aplicada com sucesso.

- [ ] **Passo 3 — rodar teste e confirmar que passa**

```bash
pnpm vitest run packages/payments/src/installment.int.test.ts
```

Saida esperada: todos os testes passam (3 testes).

- [ ] **Passo 4 — commit**

```bash
git add packages/db/migrations/0090_fin_installment_plan.sql packages/payments/src/installment.int.test.ts
git commit -m "feat(db): add fin.installment_plan and installment_plan_id FK on fin.entry

Migration 0090: installment plan table with RLS, FK composta for
mother_entry_id and child entries. CHECK total >= 2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Migration 0091 — tabela fin.recurring_template

**Arquivos**
- Criar `packages/db/migrations/0091_fin_recurring_template.sql`
- Teste `packages/payments/src/recurring-template.int.test.ts`

- [ ] **Passo 1 — teste que falha: inserir template recorrente**

```ts
// packages/payments/src/recurring-template.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeRecurring {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  categoryId: string;
  paymentMethodId: string;
  supplierId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRecurring(): Promise<SementeRecurring> {
  const s: SementeRecurring = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    supplierId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Recorrente', '33ABC44501DE66')`,
      [s.tenantId, `rec-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rec', '4444444', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Rec')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'MG', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Aluguel', 'despesa')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Rec')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.supplier (tenant_id, id, name, active)
       VALUES ($1, $2, 'Imobiliaria Centro', true)`,
      [s.tenantId, s.supplierId]);
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

let s: SementeRecurring;
let actor: Actor;

beforeAll(async () => {
  s = await semearRecurring();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.recurring_template — templates recorrentes', () => {
  it('insere e le template mensal com RLS', async () => {
    const templateId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.recurring_template
           (tenant_id, id, description, kind, category_id, amount_cents,
            clinic_id, supplier_id, frequency, day_of_month,
            next_due_date, active)
         VALUES (app.require_tenant_id(), $1, 'Aluguel sala 3', 'despesa',
                 $2, 350000, $3, $4,
                 'monthly', 10, '2026-09-10', true)`,
        [templateId, s.categoryId, s.clinicId, s.supplierId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        description: string;
        kind: string;
        frequency: string;
        day_of_month: number;
        amount_cents: string;
        next_due_date: string;
        active: boolean;
      }>(
        `SELECT description, kind::text, frequency::text, day_of_month,
                amount_cents::text, next_due_date::text, active
           FROM fin.recurring_template WHERE id = $1`,
        [templateId]));

    expect(rows[0]).toEqual({
      description: 'Aluguel sala 3',
      kind: 'despesa',
      frequency: 'monthly',
      day_of_month: 10,
      amount_cents: '350000',
      next_due_date: '2026-09-10',
      active: true,
    });
  });

  it('aceita frequencia weekly, biweekly e yearly', async () => {
    for (const freq of ['weekly', 'biweekly', 'yearly'] as const) {
      const id = uuidv7();
      await withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.recurring_template
             (tenant_id, id, description, kind, amount_cents, clinic_id,
              frequency, next_due_date, active)
           VALUES (app.require_tenant_id(), $1, $2, 'despesa', 10000, $3,
                   $4, '2026-10-01', true)`,
          [id, `Freq ${freq}`, s.clinicId, freq]);
      });

      const { rows } = await withTenantTx(actor, (tx) =>
        tx.query<{ frequency: string }>(
          `SELECT frequency::text FROM fin.recurring_template WHERE id = $1`,
          [id]));
      expect(rows[0]?.frequency).toBe(freq);
    }
  });

  it('rejeita frequencia invalida', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.recurring_template
             (tenant_id, id, description, kind, amount_cents, clinic_id,
              frequency, next_due_date, active)
           VALUES (app.require_tenant_id(), $1, 'Invalido', 'despesa', 10000, $2,
                   'diario', '2026-10-01', true)`,
          [uuidv7(), s.clinicId]);
      }),
    ).rejects.toThrow();
  });

  it('rejeita amount_cents menor ou igual a zero', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.recurring_template
             (tenant_id, id, description, kind, amount_cents, clinic_id,
              frequency, next_due_date, active)
           VALUES (app.require_tenant_id(), $1, 'Zero', 'despesa', 0, $2,
                   'monthly', '2026-10-01', true)`,
          [uuidv7(), s.clinicId]);
      }),
    ).rejects.toThrow();
  });

  it('template pode referenciar receita (kind=receita)', async () => {
    const id = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.recurring_template
           (tenant_id, id, description, kind, amount_cents, clinic_id,
            frequency, next_due_date, active)
         VALUES (app.require_tenant_id(), $1, 'Mensalidade academia', 'receita',
                 15000, $2, 'monthly', '2026-10-05', true)`,
        [id, s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ kind: string }>(
        `SELECT kind::text FROM fin.recurring_template WHERE id = $1`,
        [id]));
    expect(rows[0]?.kind).toBe('receita');
  });

  it('isolamento de tenant: outro tenant nao ve templates', async () => {
    const otherTenant = uuidv7();
    const otherUser = uuidv7();
    const otherClinic = uuidv7();

    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Rec', '88ABC99901DE77')`,
        [otherTenant, `otr-${otherTenant}`]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Outro Rec', '2222222', 'America/Sao_Paulo')`,
        [otherTenant, otherClinic]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Outro Rec')`,
        [otherUser, `${otherUser}@example.test`]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenant, otherUser, otherClinic]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const otherActor: Actor = {
      kind: 'user', tenantId: otherTenant, userId: otherUser,
      clinicId: otherClinic, requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(`SELECT id::text FROM fin.recurring_template`));

    expect(rows).toHaveLength(0);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/payments/src/recurring-template.int.test.ts
```

Saida esperada: falha com `relation "fin.recurring_template" does not exist`.

- [ ] **Passo 2 — migration 0091: tipo enumerado de frequencia + tabela fin.recurring_template**

```sql
-- packages/db/migrations/0091_fin_recurring_template.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — Template de lancamento recorrente.
-- O job de materializacao (packages/payments) gera fin.entry a partir de
-- templates com next_due_date <= hoje + 30 dias. Roda como `jobs` (BYPASSRLS).

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado de frequencia
-- ---------------------------------------------------------------------------
CREATE TYPE fin.recurrence_frequency AS ENUM (
  'weekly', 'biweekly', 'monthly', 'yearly'
);

-- ---------------------------------------------------------------------------
-- 2. Template de lancamento recorrente
-- ---------------------------------------------------------------------------
CREATE TABLE fin.recurring_template (
  tenant_id      uuid                    NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid                    NOT NULL,
  description    text                    NOT NULL COLLATE "pt-BR-x-icu",
  kind           fin.entry_kind          NOT NULL,
  category_id    uuid,
  amount_cents   bigint                  NOT NULL CHECK (amount_cents > 0),
  clinic_id      uuid                    NOT NULL,
  bank_account_id uuid,
  cost_center_id  uuid,
  supplier_id    uuid,
  frequency      fin.recurrence_frequency NOT NULL,
  day_of_month   int                     CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
  next_due_date  date                    NOT NULL,
  active         boolean                 NOT NULL DEFAULT true,
  ends_at        date,
  created_at     timestamptz(3)          NOT NULL DEFAULT clock_timestamp(),
  created_by     uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id)
    REFERENCES fin.category(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES fin.supplier(tenant_id, id)
);
ALTER TABLE fin.recurring_template OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.recurring_template TO app_rw;

ALTER TABLE fin.recurring_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.recurring_template FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.recurring_template AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_recurring_active_due ON fin.recurring_template
  (tenant_id, next_due_date)
  WHERE active;

-- ---------------------------------------------------------------------------
-- 3. GRANT para jobs — o job de materializacao roda como BYPASSRLS
-- ---------------------------------------------------------------------------
GRANT SELECT, UPDATE ON fin.recurring_template TO jobs;

-- ---------------------------------------------------------------------------
-- 4. Coluna recurring_template_id em fin.entry (nullable — entries manuais
--    nao vem de template). Permite rastrear a origem.
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry ADD COLUMN recurring_template_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_recurring_template
    FOREIGN KEY (tenant_id, recurring_template_id)
    REFERENCES fin.recurring_template(tenant_id, id);

CREATE INDEX ix_entry_recurring ON fin.entry (tenant_id, recurring_template_id)
  WHERE recurring_template_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Whitelist de chaves de auditoria para recorrentes e parcelamento
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
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name'
            )
         );
$$;

RESET ROLE;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0091 aplicada com sucesso.

- [ ] **Passo 3 — rodar teste e confirmar que passa**

```bash
pnpm vitest run packages/payments/src/recurring-template.int.test.ts
```

Saida esperada: todos os testes passam (6 testes).

- [ ] **Passo 4 — commit**

```bash
git add packages/db/migrations/0091_fin_recurring_template.sql packages/payments/src/recurring-template.int.test.ts
git commit -m "feat(db): add fin.recurring_template and recurrence_frequency enum

Migration 0091: recurring template table with RLS, enum for frequency,
FK compostas. Adds recurring_template_id FK on fin.entry and audit
meta keys for recurrence and installment tracking.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Domain — createInstallmentPlan em packages/payments

**Arquivos**
- Criar `packages/payments/src/installment-plan.ts`
- Criar `packages/payments/src/installment-plan.int.test.ts`
- Modificar `packages/payments/src/index.ts`

- [ ] **Passo 1 — teste que falha: criar plano de parcelamento via domain**

```ts
// packages/payments/src/installment-plan.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createInstallmentPlan } from './installment-plan';

interface Semente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  categoryId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    paymentMethodId: uuidv7(), categoryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Inst Domain', '55ABC66701DE88')`,
      [s.tenantId, `idom-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade IDom', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin IDom')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'cartao_credito', 'Cartao Inst')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Equipamento', 'despesa')`,
      [s.tenantId, s.categoryId]);
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

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semear();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createInstallmentPlan — domain', () => {
  it('particiona 100000 centavos em 3 parcelas sem perda', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Cadeira odontologica',
        kind: 'despesa',
        totalAmountCents: 100000,
        installments: 3,
        firstDueDate: '2026-10-15',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.planId).toBeDefined();
    expect(result.value.motherEntryId).toBeDefined();
    expect(result.value.installmentEntryIds).toHaveLength(3);

    // Verifica que a soma das parcelas = valor total
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ total: string }>(
        `SELECT sum(amount_cents)::text AS total
           FROM fin.entry
          WHERE installment_plan_id = $1`,
        [result.value.planId]));

    expect(rows[0]?.total).toBe('100000');
  });

  it('particiona valor impar sem perder centavo (allocate do kernel)', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Autoclave usada',
        kind: 'despesa',
        totalAmountCents: 10001,
        installments: 3,
        firstDueDate: '2026-11-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ total: string }>(
        `SELECT sum(amount_cents)::text AS total
           FROM fin.entry
          WHERE installment_plan_id = $1`,
        [result.value.planId]));

    // 10001 / 3 = 3333 + 3334 + 3334 — soma exata
    expect(rows[0]?.total).toBe('10001');
  });

  it('rejeita menos de 2 parcelas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Uma so',
        kind: 'despesa',
        totalAmountCents: 50000,
        installments: 1,
        firstDueDate: '2026-12-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('parcelas_insuficientes');
  });

  it('rejeita valor zero', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Gratis',
        kind: 'despesa',
        totalAmountCents: 0,
        installments: 2,
        firstDueDate: '2026-12-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('valor_invalido');
  });

  it('marca a parcela-mae com status cancelado (substituida pelas filhas)', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Mae cancelada',
        kind: 'despesa',
        totalAmountCents: 60000,
        installments: 2,
        firstDueDate: '2026-10-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status::text FROM fin.entry WHERE id = $1`,
        [result.value.motherEntryId]));

    expect(rows[0]?.status).toBe('cancelado');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/payments/src/installment-plan.int.test.ts
```

Saida esperada: falha com `Cannot find module './installment-plan'`.

- [ ] **Passo 2 — implementar createInstallmentPlan**

```ts
// packages/payments/src/installment-plan.ts
import { err, ok, uuidv7, allocate, brl, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type InstallmentFailure =
  | { kind: 'parcelas_insuficientes' }
  | { kind: 'valor_invalido' }
  | { kind: 'metodo_nao_encontrado' };

export interface CreateInstallmentPlanInput {
  readonly description: string;
  readonly kind: 'receita' | 'despesa';
  readonly totalAmountCents: number;
  readonly installments: number;
  readonly firstDueDate: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly paymentMethodId: string;
  readonly categoryId?: string;
  readonly supplierId?: string;
}

export interface InstallmentPlanCreated {
  readonly planId: string;
  readonly motherEntryId: string;
  readonly installmentEntryIds: readonly string[];
}

/**
 * Cria um plano de parcelamento: entry-mae (cancelada, referencia), N entries
 * filhas com valores rateados via allocate() do kernel (sem perder centavo).
 * Datas de vencimento incrementam mensalmente a partir de firstDueDate.
 */
export async function createInstallmentPlan(
  tx: TxClient,
  i: CreateInstallmentPlanInput,
): Promise<Result<InstallmentPlanCreated, InstallmentFailure>> {
  if (i.installments < 2) return err({ kind: 'parcelas_insuficientes' });
  if (i.totalAmountCents <= 0 || !Number.isSafeInteger(i.totalAmountCents)) {
    return err({ kind: 'valor_invalido' });
  }

  // Valida metodo de pagamento
  const { rows: methodRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method WHERE id = $1`, [i.paymentMethodId]);
  if (methodRows.length === 0) return err({ kind: 'metodo_nao_encontrado' });

  // Rateia o valor total sem perder centavo
  const ratios = Array.from({ length: i.installments }, () => 1);
  const shares = allocate(brl(i.totalAmountCents), ratios);

  // Cria a entry-mae (referencia, cancelada — substituida pelas parcelas)
  const motherEntryId = uuidv7();
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, professional_id, clinic_id,
        description, amount_cents, payment_method_id, status,
        due_date, idempotency_key, supplier_id, created_by)
     VALUES (app.require_tenant_id(), $1, $2::fin.entry_kind, $3, $4, $5,
             $6, $7, $8, 'cancelado',
             $9::date, $10, $11, app.current_user_id())`,
    [motherEntryId, i.kind, i.categoryId ?? null, i.professionalId, i.clinicId,
     i.description, i.totalAmountCents, i.paymentMethodId,
     i.firstDueDate, `mother-${motherEntryId}`, i.supplierId ?? null]);

  // Cria o plano
  const planId = uuidv7();
  await tx.query(
    `INSERT INTO fin.installment_plan
       (tenant_id, id, mother_entry_id, total_installments, generated_installments)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
    [planId, motherEntryId, i.installments, i.installments]);

  // Cria as parcelas filhas
  const installmentEntryIds: string[] = [];
  const baseDate = new Date(i.firstDueDate + 'T12:00:00Z');

  for (let idx = 0; idx < i.installments; idx++) {
    const entryId = uuidv7();
    installmentEntryIds.push(entryId);

    // Calcula a data de vencimento (incrementa mes a mes a partir da base)
    const dueDate = new Date(baseDate);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + idx);
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const share = shares[idx]!;
    const label = `${i.description} (${idx + 1}/${i.installments})`;

    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, category_id, professional_id, clinic_id,
          description, amount_cents, payment_method_id, status,
          due_date, idempotency_key, supplier_id, installment_plan_id,
          created_by)
       VALUES (app.require_tenant_id(), $1, $2::fin.entry_kind, $3, $4, $5,
               $6, $7, $8, 'pendente',
               $9::date, $10, $11, $12, app.current_user_id())`,
      [entryId, i.kind, i.categoryId ?? null, i.professionalId, i.clinicId,
       label, share.cents, i.paymentMethodId,
       dueDateStr, `inst-${entryId}`, i.supplierId ?? null, planId]);
  }

  // Audit log
  await tx.query(
    `SELECT audit.log('INSTALLMENT_CREATE', 'fin', 'installment_plan', $1, 'sucesso',
                      jsonb_build_object('total_installments', $2::int,
                                         'amount_cents', $3::bigint), $4)`,
    [planId, i.installments, i.totalAmountCents, i.clinicId]);

  return ok({ planId, motherEntryId, installmentEntryIds });
}
```

- [ ] **Passo 3 — rodar teste e confirmar que passa**

```bash
pnpm vitest run packages/payments/src/installment-plan.int.test.ts
```

Saida esperada: todos os testes passam (5 testes).

- [ ] **Passo 4 — exportar no index**

```ts
// packages/payments/src/index.ts — adicionar ao final:
export {
  createInstallmentPlan,
  type CreateInstallmentPlanInput, type InstallmentFailure, type InstallmentPlanCreated,
} from './installment-plan';
```

- [ ] **Passo 5 — commit**

```bash
git add packages/payments/src/installment-plan.ts packages/payments/src/installment-plan.int.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): add createInstallmentPlan domain function

Uses kernel allocate() to split total into N installments without
losing a centavo. Mother entry is cancelled, children are pendente.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Domain — createRecurringTemplate em packages/payments

**Arquivos**
- Criar `packages/payments/src/recurring.ts`
- Criar `packages/payments/src/recurring.int.test.ts`
- Modificar `packages/payments/src/index.ts`

- [ ] **Passo 1 — teste que falha: criar e ler template recorrente via domain**

```ts
// packages/payments/src/recurring.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecurringTemplate, type RecurringTemplateCreated } from './recurring';

interface Semente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  categoryId: string;
  paymentMethodId: string;
  supplierId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    supplierId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica RecDom', '44ABC55601DE77')`,
      [s.tenantId, `rdom-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade RDom', '3333333', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin RDom')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111000', 'BA', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Aluguel Dom', 'despesa')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix RDom')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.supplier (tenant_id, id, name, active)
       VALUES ($1, $2, 'Imobiliaria RDom', true)`,
      [s.tenantId, s.supplierId]);
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

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semear();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createRecurringTemplate — domain', () => {
  it('cria template mensal de despesa', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Aluguel sala 5',
        kind: 'despesa',
        amountCents: 500000,
        clinicId: s.clinicId,
        categoryId: s.categoryId,
        supplierId: s.supplierId,
        frequency: 'monthly',
        dayOfMonth: 10,
        nextDueDate: '2026-10-10',
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.templateId).toBeDefined();

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ description: string; frequency: string; active: boolean }>(
        `SELECT description, frequency::text, active
           FROM fin.recurring_template WHERE id = $1`,
        [result.value.templateId]));

    expect(rows[0]).toEqual({
      description: 'Aluguel sala 5',
      frequency: 'monthly',
      active: true,
    });
  });

  it('cria template semanal de receita', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Aula de pilates',
        kind: 'receita',
        amountCents: 15000,
        clinicId: s.clinicId,
        frequency: 'weekly',
        nextDueDate: '2026-10-07',
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ kind: string; frequency: string }>(
        `SELECT kind::text, frequency::text
           FROM fin.recurring_template WHERE id = $1`,
        [result.value.templateId]));

    expect(rows[0]).toEqual({ kind: 'receita', frequency: 'weekly' });
  });

  it('rejeita amount_cents zero', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Gratis',
        kind: 'despesa',
        amountCents: 0,
        clinicId: s.clinicId,
        frequency: 'monthly',
        nextDueDate: '2026-10-01',
      }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('valor_invalido');
  });

  it('aceita ends_at e cria template com data de fim', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Contrato temporario',
        kind: 'despesa',
        amountCents: 200000,
        clinicId: s.clinicId,
        frequency: 'monthly',
        dayOfMonth: 1,
        nextDueDate: '2026-10-01',
        endsAt: '2027-03-01',
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ ends_at: string }>(
        `SELECT ends_at::text FROM fin.recurring_template WHERE id = $1`,
        [result.value.templateId]));

    expect(rows[0]?.ends_at).toBe('2027-03-01');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/payments/src/recurring.int.test.ts
```

Saida esperada: falha com `Cannot find module './recurring'`.

- [ ] **Passo 2 — implementar createRecurringTemplate**

```ts
// packages/payments/src/recurring.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type RecurringFailure =
  | { kind: 'valor_invalido' }
  | { kind: 'frequencia_invalida' }
  | { kind: 'data_fim_anterior_ao_inicio' };

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const VALID_FREQUENCIES: readonly string[] = ['weekly', 'biweekly', 'monthly', 'yearly'];

export interface CreateRecurringTemplateInput {
  readonly description: string;
  readonly kind: 'receita' | 'despesa';
  readonly amountCents: number;
  readonly clinicId: string;
  readonly categoryId?: string;
  readonly bankAccountId?: string;
  readonly costCenterId?: string;
  readonly supplierId?: string;
  readonly frequency: RecurrenceFrequency;
  readonly dayOfMonth?: number;
  readonly nextDueDate: string;
  readonly endsAt?: string;
}

export interface RecurringTemplateCreated {
  readonly templateId: string;
}

/**
 * Cria um template de lancamento recorrente. A materializacao e feita pelo
 * job materializeRecurringEntries (Task 12), que gera fin.entry a partir
 * de templates com next_due_date <= hoje + 30 dias.
 */
export async function createRecurringTemplate(
  tx: TxClient,
  i: CreateRecurringTemplateInput,
): Promise<Result<RecurringTemplateCreated, RecurringFailure>> {
  if (i.amountCents <= 0 || !Number.isSafeInteger(i.amountCents)) {
    return err({ kind: 'valor_invalido' });
  }
  if (!VALID_FREQUENCIES.includes(i.frequency)) {
    return err({ kind: 'frequencia_invalida' });
  }
  if (i.endsAt !== undefined && i.endsAt < i.nextDueDate) {
    return err({ kind: 'data_fim_anterior_ao_inicio' });
  }

  const templateId = uuidv7();

  await tx.query(
    `INSERT INTO fin.recurring_template
       (tenant_id, id, description, kind, category_id, amount_cents,
        clinic_id, bank_account_id, cost_center_id, supplier_id,
        frequency, day_of_month, next_due_date, active, ends_at, created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3::fin.entry_kind, $4, $5,
             $6, $7, $8, $9,
             $10::fin.recurrence_frequency, $11, $12::date, true, $13::date,
             app.current_user_id())`,
    [templateId, i.description, i.kind, i.categoryId ?? null, i.amountCents,
     i.clinicId, i.bankAccountId ?? null, i.costCenterId ?? null,
     i.supplierId ?? null,
     i.frequency, i.dayOfMonth ?? null, i.nextDueDate, i.endsAt ?? null]);

  await tx.query(
    `SELECT audit.log('RECURRING_CREATE', 'fin', 'recurring_template', $1, 'sucesso',
                      jsonb_build_object('frequency', $2::text,
                                         'amount_cents', $3::bigint), $4)`,
    [templateId, i.frequency, i.amountCents, i.clinicId]);

  return ok({ templateId });
}
```

- [ ] **Passo 3 — rodar teste e confirmar que passa**

```bash
pnpm vitest run packages/payments/src/recurring.int.test.ts
```

Saida esperada: todos os testes passam (4 testes).

- [ ] **Passo 4 — exportar no index**

```ts
// packages/payments/src/index.ts — adicionar ao final:
export {
  createRecurringTemplate,
  type CreateRecurringTemplateInput, type RecurringFailure,
  type RecurringTemplateCreated, type RecurrenceFrequency,
} from './recurring';
```

- [ ] **Passo 5 — commit**

```bash
git add packages/payments/src/recurring.ts packages/payments/src/recurring.int.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): add createRecurringTemplate domain function

Validates frequency, amount, and date range. Template is stored
as active and awaits materialization by the nightly job.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Domain — materializeRecurringEntries (job de materializacao)

**Arquivos**
- Criar `packages/payments/src/materialize-recurring.ts`
- Criar `packages/payments/src/materialize-recurring.int.test.ts`
- Modificar `packages/payments/src/index.ts`

- [ ] **Passo 1 — teste que falha: materializar entries de templates ativos**

```ts
// packages/payments/src/materialize-recurring.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { materializeRecurringEntries } from './materialize-recurring';

interface Semente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  categoryId: string;
  paymentMethodId: string;
  templateMonthlyId: string;
  templateEndedId: string;
  templateInactiveId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

function jobsUrl(): string {
  const url = process.env['DATABASE_URL_JOBS'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_JOBS ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    templateMonthlyId: uuidv7(),
    templateEndedId: uuidv7(),
    templateInactiveId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Mat', '66ABC77801DE99')`,
      [s.tenantId, `mat-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Mat', '8888888', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Mat')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888777', 'RS', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Aluguel Mat', 'despesa')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Mat')`,
      [s.tenantId, s.paymentMethodId]);

    // Template mensal ativo: next_due_date = hoje (deve materializar)
    await c.query(
      `INSERT INTO fin.recurring_template
         (tenant_id, id, description, kind, category_id, amount_cents,
          clinic_id, frequency, day_of_month, next_due_date, active,
          created_by)
       VALUES ($1, $2, 'Aluguel mensal', 'despesa', $3, 350000,
               $4, 'monthly', 15, current_date, true, $5)`,
      [s.tenantId, s.templateMonthlyId, s.categoryId, s.clinicId, s.userId]);

    // Template com ends_at no passado (nao deve materializar)
    await c.query(
      `INSERT INTO fin.recurring_template
         (tenant_id, id, description, kind, amount_cents,
          clinic_id, frequency, next_due_date, active, ends_at,
          created_by)
       VALUES ($1, $2, 'Contrato encerrado', 'despesa', 100000,
               $3, 'monthly', current_date, true,
               current_date - interval '1 day', $4)`,
      [s.tenantId, s.templateEndedId, s.clinicId, s.userId]);

    // Template inativo (nao deve materializar)
    await c.query(
      `INSERT INTO fin.recurring_template
         (tenant_id, id, description, kind, amount_cents,
          clinic_id, frequency, next_due_date, active,
          created_by)
       VALUES ($1, $2, 'Servico suspenso', 'despesa', 200000,
               $3, 'monthly', current_date, false, $4)`,
      [s.tenantId, s.templateInactiveId, s.clinicId, s.userId]);

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

let s: Semente;
let jobsPool: Pool;

beforeAll(async () => {
  s = await semear();
  jobsPool = new Pool({ connectionString: jobsUrl(), max: 2 });
});

afterAll(async () => {
  await jobsPool.end();
  await closePools();
});

describe('materializeRecurringEntries — job de materializacao', () => {
  it('materializa entry do template ativo com next_due_date <= hoje + 30d', async () => {
    const client = await jobsPool.connect();
    try {
      await client.query('BEGIN');
      const result = await materializeRecurringEntries(
        { query: (sql, params) => client.query(sql, params === undefined ? undefined : [...params]) },
        s.tenantId,
      );
      await client.query('COMMIT');

      // Pelo menos 1 entry gerada (do template mensal ativo)
      expect(result.generated).toBeGreaterThanOrEqual(1);
      expect(result.skipped).toBeGreaterThanOrEqual(0);
    } finally {
      client.release();
    }

    // Verifica que a entry foi criada com recurring_template_id
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{
        description: string; kind: string;
        amount_cents: string; status: string;
        recurring_template_id: string;
      }>(
        `SELECT description, kind::text, amount_cents::text,
                status::text, recurring_template_id::text
           FROM fin.entry
          WHERE tenant_id = $1 AND recurring_template_id = $2`,
        [s.tenantId, s.templateMonthlyId]);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.kind).toBe('despesa');
      expect(rows[0]?.amount_cents).toBe('350000');
      expect(rows[0]?.status).toBe('pendente');
    } finally {
      await admin.end();
    }
  });

  it('nao materializa template inativo', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{ id: string }>(
        `SELECT id::text FROM fin.entry
          WHERE tenant_id = $1 AND recurring_template_id = $2`,
        [s.tenantId, s.templateInactiveId]);

      expect(rows).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });

  it('nao materializa template com ends_at no passado', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{ id: string }>(
        `SELECT id::text FROM fin.entry
          WHERE tenant_id = $1 AND recurring_template_id = $2`,
        [s.tenantId, s.templateEndedId]);

      expect(rows).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });

  it('avanca next_due_date apos materializar', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{ next_due_date: string }>(
        `SELECT next_due_date::text FROM fin.recurring_template WHERE id = $1`,
        [s.templateMonthlyId]);

      // next_due_date deve ter avancado (nao mais a data original)
      const nextDue = new Date(rows[0]!.next_due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      expect(nextDue.getTime()).toBeGreaterThan(today.getTime());
    } finally {
      await admin.end();
    }
  });

  it('nao duplica entry na segunda execucao (idempotency_key por template+data)', async () => {
    // Roda novamente — nao deve gerar duplicata
    const client = await jobsPool.connect();
    try {
      await client.query('BEGIN');
      const result = await materializeRecurringEntries(
        { query: (sql, params) => client.query(sql, params === undefined ? undefined : [...params]) },
        s.tenantId,
      );
      await client.query('COMMIT');

      // Nada gerado na segunda vez (next_due_date ja avancou)
      expect(result.generated).toBe(0);
    } finally {
      client.release();
    }
  });
});
```

Rodar:

```bash
pnpm vitest run packages/payments/src/materialize-recurring.int.test.ts
```

Saida esperada: falha com `Cannot find module './materialize-recurring'`.

- [ ] **Passo 2 — implementar materializeRecurringEntries**

```ts
// packages/payments/src/materialize-recurring.ts
import { uuidv7 } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export interface MaterializeResult {
  readonly generated: number;
  readonly skipped: number;
}

interface TemplateRow {
  id: string;
  description: string;
  kind: string;
  category_id: string | null;
  amount_cents: string;
  clinic_id: string;
  bank_account_id: string | null;
  cost_center_id: string | null;
  supplier_id: string | null;
  frequency: string;
  day_of_month: number | null;
  next_due_date: string;
  ends_at: string | null;
  created_by: string | null;
}

/**
 * Materializa entries a partir de templates recorrentes ativos cujo
 * next_due_date <= hoje + 30 dias. Roda como `jobs` (BYPASSRLS), sem
 * withTenantTx. Idempotencia garantida por idempotency_key unico
 * (template_id + due_date). Avanca next_due_date conforme a frequencia.
 *
 * REGRA: ends_at < next_due_date => template nao gera mais. Template
 * inativo (active=false) e ignorado.
 */
export async function materializeRecurringEntries(
  tx: TxClient,
  tenantId: string,
): Promise<MaterializeResult> {
  // Busca templates ativos com next_due_date no horizonte de 30 dias
  const { rows: templates } = await tx.query<TemplateRow>(
    `SELECT id::text, description, kind::text, category_id::text,
            amount_cents::text, clinic_id::text,
            bank_account_id::text, cost_center_id::text,
            supplier_id::text, frequency::text,
            day_of_month, next_due_date::text,
            ends_at::text, created_by::text
       FROM fin.recurring_template
      WHERE tenant_id = $1
        AND active = true
        AND next_due_date <= (current_date + interval '30 days')
        AND (ends_at IS NULL OR ends_at >= next_due_date)`,
    [tenantId]);

  let generated = 0;
  let skipped = 0;

  for (const tpl of templates) {
    let currentDue = tpl.next_due_date;

    // Gera entries para todas as datas pendentes ate hoje + 30 dias
    while (true) {
      const dueDateObj = new Date(currentDue + 'T12:00:00Z');
      const horizonObj = new Date();
      horizonObj.setUTCDate(horizonObj.getUTCDate() + 30);
      horizonObj.setUTCHours(23, 59, 59, 999);

      if (dueDateObj.getTime() > horizonObj.getTime()) break;

      // Verifica ends_at
      if (tpl.ends_at !== null) {
        const endsAtObj = new Date(tpl.ends_at + 'T23:59:59Z');
        if (dueDateObj.getTime() > endsAtObj.getTime()) break;
      }

      // Idempotency key: garante que o mesmo template+data nao gera duplicata
      const idempotencyKey = `recurring-${tpl.id}-${currentDue}`;

      // Tenta inserir; se a key ja existe, pula (ON CONFLICT DO NOTHING)
      const entryId = uuidv7();
      const { rowCount } = await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, status,
            due_date, idempotency_key, supplier_id,
            bank_account_id, cost_center_id,
            recurring_template_id, created_by)
         SELECT $1, $2, $3::fin.entry_kind, $4,
                -- professional_id: usa o created_by do template como fallback.
                -- O job nao tem profissional; usa o primeiro profissional da clinica.
                (SELECT p.id FROM app.professional p
                  WHERE p.tenant_id = $1
                  LIMIT 1),
                $5, $6, $7, 
                -- payment_method_id: usa o primeiro metodo ativo do tenant
                (SELECT pm.id FROM fin.payment_method pm
                  WHERE pm.tenant_id = $1 AND pm.active = true
                  LIMIT 1),
                'pendente', $8::date, $9, $10, $11, $12, $13, $14
          WHERE NOT EXISTS (
            SELECT 1 FROM fin.entry e2
             WHERE e2.tenant_id = $1 AND e2.idempotency_key = $9
          )`,
        [tenantId, entryId, tpl.kind, tpl.category_id,
         tpl.clinic_id, tpl.description, Number(tpl.amount_cents),
         currentDue, idempotencyKey, tpl.supplier_id,
         tpl.bank_account_id, tpl.cost_center_id, tpl.id,
         tpl.created_by]);

      if ((rowCount ?? 0) > 0) {
        generated++;
      } else {
        skipped++;
      }

      // Avanca para o proximo vencimento
      currentDue = advanceDueDate(currentDue, tpl.frequency, tpl.day_of_month);
    }

    // Atualiza next_due_date do template para o proximo vencimento nao materializado
    let nextDue = tpl.next_due_date;
    const horizonCheck = new Date();
    horizonCheck.setUTCDate(horizonCheck.getUTCDate() + 30);

    while (true) {
      const checkObj = new Date(nextDue + 'T12:00:00Z');
      if (checkObj.getTime() > horizonCheck.getTime()) break;
      if (tpl.ends_at !== null) {
        const endsAtCheck = new Date(tpl.ends_at + 'T23:59:59Z');
        if (checkObj.getTime() > endsAtCheck.getTime()) break;
      }
      nextDue = advanceDueDate(nextDue, tpl.frequency, tpl.day_of_month);
    }

    if (nextDue !== tpl.next_due_date) {
      await tx.query(
        `UPDATE fin.recurring_template
            SET next_due_date = $2::date
          WHERE tenant_id = $1 AND id = $3`,
        [tenantId, nextDue, tpl.id]);
    }
  }

  return { generated, skipped };
}

/**
 * Avanca a data de vencimento conforme a frequencia.
 * Para monthly, respeita day_of_month quando informado.
 */
function advanceDueDate(
  currentDue: string,
  frequency: string,
  dayOfMonth: number | null,
): string {
  const d = new Date(currentDue + 'T12:00:00Z');

  switch (frequency) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'biweekly':
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case 'monthly': {
      d.setUTCMonth(d.getUTCMonth() + 1);
      if (dayOfMonth !== null) {
        // Ajusta para o dia correto; se o mes nao tem esse dia, usa o ultimo
        const targetDay = Math.min(dayOfMonth, daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
        d.setUTCDate(targetDay);
      }
      break;
    }
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }

  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
```

- [ ] **Passo 3 — rodar teste e confirmar que passa**

```bash
pnpm vitest run packages/payments/src/materialize-recurring.int.test.ts
```

Saida esperada: todos os testes passam (5 testes).

- [ ] **Passo 4 — exportar no index**

```ts
// packages/payments/src/index.ts — adicionar ao final:
export {
  materializeRecurringEntries,
  type MaterializeResult,
} from './materialize-recurring';
```

- [ ] **Passo 5 — commit**

```bash
git add packages/payments/src/materialize-recurring.ts packages/payments/src/materialize-recurring.int.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): add materializeRecurringEntries job function

Generates fin.entry from active recurring templates with next_due_date
within 30-day horizon. Idempotent via idempotency_key. Advances
next_due_date after materialization. Runs as jobs role (BYPASSRLS).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
