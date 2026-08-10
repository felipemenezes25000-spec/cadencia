### Task 1: Migration 0086 — tabelas `fin.bank_account` e `fin.cost_center`

**Arquivos**
- Criar `packages/db/migrations/0086_fin_bank_account_cost_center.sql`
- Teste `packages/payments/src/bank-account-cost-center.int.test.ts` (criado na Task 2)

**Passos**

- [ ] Criar o arquivo de migration com o conteudo abaixo.

```sql
-- 0086_fin_bank_account_cost_center.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.10 / Fase 3 bloco 01: contas bancarias e centros de custo.
-- Conta bancaria identifica onde o dinheiro da clinica transita. A sentinela
-- "Caixa Geral" existe em todo tenant novo e nao pode ser desativada.
-- Centro de custo e dimensao opcional de classificacao de lancamento.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado para tipo de conta bancaria
-- ---------------------------------------------------------------------------
CREATE TYPE fin.bank_account_type AS ENUM ('corrente', 'poupanca');

-- ---------------------------------------------------------------------------
-- 2. Conta bancaria
-- ---------------------------------------------------------------------------
CREATE TABLE fin.bank_account (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  name               text NOT NULL COLLATE "pt-BR-x-icu",
  bank_code          text,                -- codigo COMPE/ISPB; NULL para caixa geral
  agency             text,                -- agencia; NULL para caixa geral
  account_number     text,                -- numero da conta; NULL para caixa geral
  account_type       fin.bank_account_type,  -- NULL para caixa geral
  initial_balance_cents bigint NOT NULL DEFAULT 0,
  is_default         boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

ALTER TABLE fin.bank_account OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.bank_account TO app_rw;

ALTER TABLE fin.bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.bank_account FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.bank_account AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Indice parcial: no maximo UMA conta default por tenant
CREATE UNIQUE INDEX ux_bank_account_default
  ON fin.bank_account (tenant_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- 3. Centro de custo
-- ---------------------------------------------------------------------------
CREATE TABLE fin.cost_center (
  tenant_id   uuid NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL COLLATE "pt-BR-x-icu",
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

ALTER TABLE fin.cost_center OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.cost_center TO app_rw;

ALTER TABLE fin.cost_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cost_center FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.cost_center AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

COMMIT;
```

- [ ] Rodar a migration e confirmar que aplica sem erro.

```bash
pnpm db:migrate
```

Saida esperada: `0086_fin_bank_account_cost_center.sql` aplicada com sucesso.

---

### Task 2: Testes de schema para `fin.bank_account` e `fin.cost_center`

**Arquivos**
- Criar `packages/payments/src/bank-account-cost-center.int.test.ts`

**Passos**

- [ ] Criar o arquivo de teste de integracao que valida RLS, COLLATE, unique constraints e indice parcial de default.

```typescript
// packages/payments/src/bank-account-cost-center.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeContas {
  tenantId: string;
  clinicId: string;
  userId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearContas(): Promise<SementeContas> {
  const s: SementeContas = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Contas', '11ABC22301DE45')`,
      [s.tenantId, `cc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Contas', '1111111', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Contas')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

let s: SementeContas;
let actor: Actor;

beforeAll(async () => {
  s = await semearContas();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('schema fin.bank_account — RLS, unicidade e default', () => {
  const accountId = uuidv7();

  it('insere conta bancaria com RLS ativa', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.bank_account
           (tenant_id, id, name, bank_code, agency, account_number,
            account_type, initial_balance_cents, is_default)
         VALUES (app.require_tenant_id(), $1, 'Bradesco Corrente', '237',
                 '1234', '56789-0', 'corrente', 0, false)`,
        [accountId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; bank_code: string; account_type: string }>(
        `SELECT name, bank_code, account_type::text
           FROM fin.bank_account WHERE id = $1`, [accountId]));
    expect(rows[0]).toEqual({
      name: 'Bradesco Corrente',
      bank_code: '237',
      account_type: 'corrente',
    });
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account
             (tenant_id, id, name, is_default)
           VALUES (app.require_tenant_id(), $1, 'Bradesco Corrente', false)`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('permite no maximo UMA conta default por tenant', async () => {
    const defaultId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO fin.bank_account
           (tenant_id, id, name, is_default)
         VALUES (app.require_tenant_id(), $1, 'Conta Default', true)`,
        [defaultId]));

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account
             (tenant_id, id, name, is_default)
           VALUES (app.require_tenant_id(), $1, 'Outra Default', true)`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('insere conta poupanca', async () => {
    const poupId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.bank_account
           (tenant_id, id, name, bank_code, agency, account_number,
            account_type, initial_balance_cents)
         VALUES (app.require_tenant_id(), $1, 'Itau Poupanca', '341',
                 '5678', '12345-6', 'poupanca', 100000)`,
        [poupId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ account_type: string; initial_balance_cents: string }>(
        `SELECT account_type::text, initial_balance_cents::text
           FROM fin.bank_account WHERE id = $1`, [poupId]));
    expect(rows[0]).toEqual({
      account_type: 'poupanca',
      initial_balance_cents: '100000',
    });
  });
});

describe('schema fin.cost_center — RLS e unicidade', () => {
  const centerId = uuidv7();

  it('insere centro de custo com RLS ativa', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.cost_center
           (tenant_id, id, code, name)
         VALUES (app.require_tenant_id(), $1, 'ADM', 'Administrativo')`,
        [centerId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ code: string; name: string }>(
        `SELECT code, name FROM fin.cost_center WHERE id = $1`,
        [centerId]));
    expect(rows[0]).toEqual({ code: 'ADM', name: 'Administrativo' });
  });

  it('rejeita codigo duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.cost_center
             (tenant_id, id, code, name)
           VALUES (app.require_tenant_id(), $1, 'ADM', 'Outro Admin')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.cost_center
             (tenant_id, id, code, name)
           VALUES (app.require_tenant_id(), $1, 'ADM2', 'Administrativo')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('aceita mesmo codigo em tenants diferentes', async () => {
    const outroTenantId = uuidv7();
    const outroUserId = uuidv7();
    const outroClinicId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant', '99ABC88701DE21')`,
        [outroTenantId, `ot-${outroTenantId}`]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Outra', '9999999', 'America/Sao_Paulo')`,
        [outroTenantId, outroClinicId]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Admin Outro')`,
        [outroUserId, `${outroUserId}@example.test`]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [outroTenantId, outroUserId, outroClinicId]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const outroActor: Actor = {
      kind: 'user', tenantId: outroTenantId, userId: outroUserId,
      clinicId: outroClinicId, requestId: uuidv7(),
    };

    await withTenantTx(outroActor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.cost_center
           (tenant_id, id, code, name)
         VALUES (app.require_tenant_id(), $1, 'ADM', 'Administrativo')`,
        [uuidv7()]);
    });
    // Se chegou aqui sem erro, o mesmo codigo e aceito em outro tenant
  });
});
```

- [ ] Rodar os testes e confirmar que todos passam.

```bash
pnpm vitest run packages/payments/src/bank-account-cost-center.int.test.ts --config vitest.int.config.ts
```

Saida esperada: 6 testes passando.

- [ ] Commitar.

```bash
git add packages/db/migrations/0086_fin_bank_account_cost_center.sql \
       packages/payments/src/bank-account-cost-center.int.test.ts
git commit -m "feat(fin): add bank_account and cost_center tables (migration 0086)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Migration 0087 — ALTER TABLE `fin.entry` para FK de conta e centro

**Arquivos**
- Criar `packages/db/migrations/0087_fin_entry_bank_account_cost_center.sql`
- Teste `packages/payments/src/entry-bank-cost.int.test.ts` (criado na Task 4)

**Passos**

- [ ] Criar o arquivo de migration que adiciona as colunas `bank_account_id` e `cost_center_id` a `fin.entry`, ambas NULLABLE para retrocompatibilidade com lancamentos existentes da Fase 2.

```sql
-- 0087_fin_entry_bank_account_cost_center.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Expande fin.entry com as dimensoes de conta bancaria e centro de custo.
-- Ambas NULLABLE: lancamentos da Fase 2 continuam validos sem conta ou centro.
-- FK composta (tenant_id, *_id) conforme regra §3.4.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Coluna bank_account_id — NULLABLE, FK composta
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry
  ADD COLUMN bank_account_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_bank_account
    FOREIGN KEY (tenant_id, bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id);

CREATE INDEX ix_entry_bank_account ON fin.entry (tenant_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Coluna cost_center_id — NULLABLE, FK composta
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry
  ADD COLUMN cost_center_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_cost_center
    FOREIGN KEY (tenant_id, cost_center_id)
    REFERENCES fin.cost_center(tenant_id, id);

CREATE INDEX ix_entry_cost_center ON fin.entry (tenant_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

COMMIT;
```

- [ ] Rodar a migration e confirmar que aplica sem erro.

```bash
pnpm db:migrate
```

Saida esperada: `0087_fin_entry_bank_account_cost_center.sql` aplicada com sucesso.

---

### Task 4: Testes de schema para `fin.entry` com conta e centro

**Arquivos**
- Criar `packages/payments/src/entry-bank-cost.int.test.ts`

**Passos**

- [ ] Criar o arquivo de teste de integracao que valida a FK composta, insercao com e sem conta/centro, e rejeicao de referencia invalida.

```typescript
// packages/payments/src/entry-bank-cost.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeEntryBankCost {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
  costCenterId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearEntryBankCost(): Promise<SementeEntryBankCost> {
  const s: SementeEntryBankCost = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(), costCenterId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Entry BC', '55ABC66701DE89')`,
      [s.tenantId, `ebc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Entry BC', '5555555', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Admin Entry BC')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777777', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro BC')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
       VALUES ($1, $2, 'Caixa Geral', true)`,
      [s.tenantId, s.bankAccountId]);
    await c.query(
      `INSERT INTO fin.cost_center (tenant_id, id, code, name)
       VALUES ($1, $2, 'CLIN', 'Clinico')`,
      [s.tenantId, s.costCenterId]);
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

let s: SementeEntryBankCost;
let actor: Actor;

beforeAll(async () => {
  s = await semearEntryBankCost();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.entry — colunas bank_account_id e cost_center_id', () => {
  it('insere lancamento COM conta e centro', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, cost_center_id)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Com conta e centro', 30000, $4, 'pendente', $5, $6, $7)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `bc-${entryId}`, s.bankAccountId, s.costCenterId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string; cost_center_id: string }>(
        `SELECT bank_account_id::text, cost_center_id::text
           FROM fin.entry WHERE id = $1`, [entryId]));
    expect(rows[0]).toEqual({
      bank_account_id: s.bankAccountId,
      cost_center_id: s.costCenterId,
    });
  });

  it('insere lancamento SEM conta e centro (retrocompatibilidade Fase 2)', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Sem conta e centro', 20000, $4, 'pendente', $5)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `nobc-${entryId}`]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string | null; cost_center_id: string | null }>(
        `SELECT bank_account_id::text, cost_center_id::text
           FROM fin.entry WHERE id = $1`, [entryId]));
    expect(rows[0]?.bank_account_id).toBeNull();
    expect(rows[0]?.cost_center_id).toBeNull();
  });

  it('rejeita bank_account_id de outro tenant (FK composta)', async () => {
    const outroTenantId = uuidv7();
    const outroAccountId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant BC', '77ABC88901DE32')`,
        [outroTenantId, `ot2-${outroTenantId}`]);
      await c.query(
        `INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
         VALUES ($1, $2, 'Conta Alheia', true)`,
        [outroTenantId, outroAccountId]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key,
              bank_account_id)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'FK cruzada', 10000, $4, 'pendente', $5, $6)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `fk-cross-${uuidv7()}`, outroAccountId])),
    ).rejects.toThrow();
  });

  it('rejeita cost_center_id inexistente (FK composta)', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key,
              cost_center_id)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Centro fantasma', 10000, $4, 'pendente', $5, $6)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `fk-ghost-${uuidv7()}`, uuidv7()])),
    ).rejects.toThrow();
  });
});
```

- [ ] Rodar os testes e confirmar que todos passam.

```bash
pnpm vitest run packages/payments/src/entry-bank-cost.int.test.ts --config vitest.int.config.ts
```

Saida esperada: 4 testes passando.

- [ ] Commitar.

```bash
git add packages/db/migrations/0087_fin_entry_bank_account_cost_center.sql \
       packages/payments/src/entry-bank-cost.int.test.ts
git commit -m "feat(fin): add bank_account_id and cost_center_id to fin.entry (migration 0087)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Migration 0088 — seed da sentinela "Caixa Geral" e trigger de provisionamento

**Arquivos**
- Criar `packages/db/migrations/0088_fin_bank_account_seed_default.sql`
- Teste `packages/payments/src/bank-account-seed.int.test.ts` (criado nesta task)

**Passos**

- [ ] Criar a migration que instala uma funcao `fin.provision_default_bank_account()` chamada por trigger na insercao de tenant. Tenants existentes ganham a conta sentinela via backfill na propria migration.

```sql
-- 0088_fin_bank_account_seed_default.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Provisiona a conta sentinela "Caixa Geral" para cada tenant existente e para
-- todo tenant novo criado a partir de agora.
-- A conta sentinela e a default (is_default = true) e nao pode ser desativada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Funcao de provisionamento — SECURITY DEFINER para acessar fin.bank_account
--    sem depender do preambulo RLS (INSERT no tenant novo acontece ANTES de
--    qualquer withTenantTx).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fin.provision_default_bank_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, app, pg_catalog AS $$
BEGIN
  INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
  VALUES (NEW.id, gen_random_uuid(), 'Caixa Geral', true);
  RETURN NEW;
END;
$$;

ALTER FUNCTION fin.provision_default_bank_account() OWNER TO app_owner;

CREATE TRIGGER trg_tenant_default_bank_account
  AFTER INSERT ON app.tenant
  FOR EACH ROW
  EXECUTE FUNCTION fin.provision_default_bank_account();

-- ---------------------------------------------------------------------------
-- 2. Backfill: tenants existentes que ainda nao tem conta default
-- ---------------------------------------------------------------------------
INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
SELECT t.id, gen_random_uuid(), 'Caixa Geral', true
  FROM app.tenant t
 WHERE NOT EXISTS (
   SELECT 1 FROM fin.bank_account ba
    WHERE ba.tenant_id = t.id AND ba.is_default
 );

COMMIT;
```

- [ ] Rodar a migration e confirmar que aplica sem erro.

```bash
pnpm db:migrate
```

Saida esperada: `0088_fin_bank_account_seed_default.sql` aplicada com sucesso.

- [ ] Criar o arquivo de teste de integracao que valida o provisionamento automatico e o backfill.

```typescript
// packages/payments/src/bank-account-seed.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

let admin: Pool;

beforeAll(() => {
  admin = new Pool({ connectionString: adminUrl(), max: 1 });
});

afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('fin.bank_account — provisionamento automatico de Caixa Geral', () => {
  it('trigger cria Caixa Geral ao inserir tenant novo', async () => {
    const tenantId = uuidv7();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Tenant Trigger', '33ABC44501DE67')`,
        [tenantId, `trig-${tenantId}`]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    const { rows } = await admin.query<{
      name: string; is_default: boolean;
    }>(
      `SELECT name, is_default FROM fin.bank_account
        WHERE tenant_id = $1 AND is_default = true`, [tenantId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Caixa Geral');
    expect(rows[0]?.is_default).toBe(true);
  });

  it('backfill provisionou Caixa Geral para todos os tenants existentes', async () => {
    const { rows } = await admin.query<{ sem_default: string }>(
      `SELECT count(*)::text AS sem_default
         FROM app.tenant t
        WHERE NOT EXISTS (
          SELECT 1 FROM fin.bank_account ba
           WHERE ba.tenant_id = t.id AND ba.is_default
        )`);
    expect(rows[0]?.sem_default).toBe('0');
  });
});
```

- [ ] Rodar os testes e confirmar que todos passam.

```bash
pnpm vitest run packages/payments/src/bank-account-seed.int.test.ts --config vitest.int.config.ts
```

Saida esperada: 2 testes passando.

- [ ] Commitar.

```bash
git add packages/db/migrations/0088_fin_bank_account_seed_default.sql \
       packages/payments/src/bank-account-seed.int.test.ts
git commit -m "feat(fin): seed default Caixa Geral for all tenants (migration 0088)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Domain logic — CRUD de contas bancarias e centros de custo

**Arquivos**
- Criar `packages/payments/src/bank-account.ts`
- Criar `packages/payments/src/cost-center.ts`
- Modificar `packages/payments/src/index.ts`
- Modificar `packages/payments/src/record-payment.ts` (tipo `RecordPaymentInput`)
- Criar `packages/payments/src/bank-account.int.test.ts`
- Criar `packages/payments/src/cost-center.int.test.ts`

**Passos**

- [ ] Criar `packages/payments/src/bank-account.ts` com funcoes de CRUD para contas bancarias.

```typescript
// packages/payments/src/bank-account.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type BankAccountFailure =
  | { kind: 'conta_nao_encontrada' }
  | { kind: 'nome_duplicado' }
  | { kind: 'ja_desativada' }
  | { kind: 'conta_default_nao_pode_desativar' };

export interface CreateBankAccountInput {
  readonly name: string;
  readonly bankCode?: string;
  readonly agency?: string;
  readonly accountNumber?: string;
  readonly accountType?: 'corrente' | 'poupanca';
  readonly initialBalanceCents?: number;
  readonly isDefault?: boolean;
}

export interface BankAccountRow {
  readonly id: string;
  readonly name: string;
  readonly bankCode: string | null;
  readonly agency: string | null;
  readonly accountNumber: string | null;
  readonly accountType: string | null;
  readonly initialBalanceCents: number;
  readonly isDefault: boolean;
  readonly active: boolean;
}

export async function createBankAccount(
  tx: TxClient,
  i: CreateBankAccountInput,
): Promise<Result<BankAccountRow, BankAccountFailure>> {
  const id = uuidv7();
  const isDefault = i.isDefault ?? false;

  try {
    await tx.query(
      `INSERT INTO fin.bank_account
         (tenant_id, id, name, bank_code, agency, account_number,
          account_type, initial_balance_cents, is_default)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5,
               $6::fin.bank_account_type, $7, $8)`,
      [id, i.name, i.bankCode ?? null, i.agency ?? null,
       i.accountNumber ?? null, i.accountType ?? null,
       i.initialBalanceCents ?? 0, isDefault]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('ux_bank_account_default') || msg.includes('duplicate key')) {
      if (msg.includes('bank_account_name') || msg.includes('tenant_id, name')) {
        return err({ kind: 'nome_duplicado' });
      }
    }
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({
    id, name: i.name,
    bankCode: i.bankCode ?? null,
    agency: i.agency ?? null,
    accountNumber: i.accountNumber ?? null,
    accountType: i.accountType ?? null,
    initialBalanceCents: i.initialBalanceCents ?? 0,
    isDefault, active: true,
  });
}

export interface UpdateBankAccountInput {
  readonly id: string;
  readonly name?: string;
  readonly bankCode?: string | null;
  readonly agency?: string | null;
  readonly accountNumber?: string | null;
  readonly accountType?: 'corrente' | 'poupanca' | null;
}

export async function updateBankAccount(
  tx: TxClient,
  i: UpdateBankAccountInput,
): Promise<Result<BankAccountRow, BankAccountFailure>> {
  const { rows } = await tx.query<{
    id: string; name: string; bank_code: string | null;
    agency: string | null; account_number: string | null;
    account_type: string | null; initial_balance_cents: string;
    is_default: boolean; active: boolean;
  }>(
    `SELECT id::text, name, bank_code, agency, account_number,
            account_type::text, initial_balance_cents::text,
            is_default, active
       FROM fin.bank_account WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'conta_nao_encontrada' });

  const name = i.name ?? existing.name;
  const bankCode = i.bankCode !== undefined ? i.bankCode : existing.bank_code;
  const agency = i.agency !== undefined ? i.agency : existing.agency;
  const accountNumber = i.accountNumber !== undefined ? i.accountNumber : existing.account_number;
  const accountType = i.accountType !== undefined ? i.accountType : existing.account_type;

  try {
    await tx.query(
      `UPDATE fin.bank_account
          SET name = $2, bank_code = $3, agency = $4,
              account_number = $5, account_type = $6::fin.bank_account_type
        WHERE id = $1`,
      [i.id, name, bankCode, agency, accountNumber, accountType]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({
    id: existing.id, name,
    bankCode, agency, accountNumber, accountType,
    initialBalanceCents: Number(existing.initial_balance_cents),
    isDefault: existing.is_default,
    active: existing.active,
  });
}

export async function deactivateBankAccount(
  tx: TxClient,
  accountId: string,
): Promise<Result<{ id: string }, BankAccountFailure>> {
  const { rows } = await tx.query<{
    is_default: boolean; active: boolean;
  }>(
    `SELECT is_default, active FROM fin.bank_account WHERE id = $1`,
    [accountId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'conta_nao_encontrada' });
  if (!existing.active) return err({ kind: 'ja_desativada' });
  if (existing.is_default) return err({ kind: 'conta_default_nao_pode_desativar' });

  await tx.query(
    `UPDATE fin.bank_account SET active = false WHERE id = $1`,
    [accountId]);

  return ok({ id: accountId });
}

export async function listBankAccounts(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<BankAccountRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; name: string; bank_code: string | null;
    agency: string | null; account_number: string | null;
    account_type: string | null; initial_balance_cents: string;
    is_default: boolean; active: boolean;
  }>(
    `SELECT id::text, name, bank_code, agency, account_number,
            account_type::text, initial_balance_cents::text,
            is_default, active
       FROM fin.bank_account
      WHERE 1=1 ${whereActive}
      ORDER BY is_default DESC, name`);
  return rows.map((r) => ({
    id: r.id, name: r.name,
    bankCode: r.bank_code,
    agency: r.agency,
    accountNumber: r.account_number,
    accountType: r.account_type,
    initialBalanceCents: Number(r.initial_balance_cents),
    isDefault: r.is_default,
    active: r.active,
  }));
}
```

- [ ] Criar `packages/payments/src/cost-center.ts` com funcoes de CRUD para centros de custo.

```typescript
// packages/payments/src/cost-center.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type CostCenterFailure =
  | { kind: 'centro_nao_encontrado' }
  | { kind: 'codigo_duplicado' }
  | { kind: 'nome_duplicado' }
  | { kind: 'ja_desativado' };

export interface CreateCostCenterInput {
  readonly code: string;
  readonly name: string;
}

export interface CostCenterRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

export async function createCostCenter(
  tx: TxClient,
  i: CreateCostCenterInput,
): Promise<Result<CostCenterRow, CostCenterFailure>> {
  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO fin.cost_center
         (tenant_id, id, code, name)
       VALUES (app.require_tenant_id(), $1, $2, $3)`,
      [id, i.code, i.name]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('code')) {
      return err({ kind: 'codigo_duplicado' });
    }
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({ id, code: i.code, name: i.name, active: true });
}

export interface UpdateCostCenterInput {
  readonly id: string;
  readonly code?: string;
  readonly name?: string;
}

export async function updateCostCenter(
  tx: TxClient,
  i: UpdateCostCenterInput,
): Promise<Result<CostCenterRow, CostCenterFailure>> {
  const { rows } = await tx.query<{
    id: string; code: string; name: string; active: boolean;
  }>(
    `SELECT id::text, code, name, active
       FROM fin.cost_center WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'centro_nao_encontrado' });

  const code = i.code ?? existing.code;
  const name = i.name ?? existing.name;

  try {
    await tx.query(
      `UPDATE fin.cost_center SET code = $2, name = $3 WHERE id = $1`,
      [i.id, code, name]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('code')) {
      return err({ kind: 'codigo_duplicado' });
    }
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({ id: existing.id, code, name, active: existing.active });
}

export async function deactivateCostCenter(
  tx: TxClient,
  centerId: string,
): Promise<Result<{ id: string }, CostCenterFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM fin.cost_center WHERE id = $1`, [centerId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'centro_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE fin.cost_center SET active = false WHERE id = $1`,
    [centerId]);

  return ok({ id: centerId });
}

export async function listCostCenters(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<CostCenterRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; code: string; name: string; active: boolean;
  }>(
    `SELECT id::text, code, name, active
       FROM fin.cost_center
      WHERE 1=1 ${whereActive}
      ORDER BY code`);
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, active: r.active,
  }));
}
```

- [ ] Adicionar `bankAccountId` e `costCenterId` ao tipo `RecordPaymentInput` em `packages/payments/src/record-payment.ts` e passar as novas colunas no INSERT. A alteracao e retrocompativel: ambos sao opcionais.

Substituir a interface `RecordPaymentInput` e o INSERT do `recordPayment`:

```typescript
// Em packages/payments/src/record-payment.ts
// Adicionar os dois campos opcionais ao final da interface RecordPaymentInput:

export interface RecordPaymentInput {
  readonly patientId?: string;
  readonly appointmentId?: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly categoryId?: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paymentMethodId: string;
  readonly paidNow: boolean;
  readonly dueDate?: string;
  readonly externalRef?: string;
  readonly idempotencyKey: string;
  readonly bankAccountId?: string;
  readonly costCenterId?: string;
}
```

E o INSERT dentro de `recordPayment` passa a incluir as duas novas colunas:

```typescript
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, patient_id, appointment_id,
        professional_id, clinic_id, description, amount_cents,
        payment_method_id, paid_at, due_date, status, external_ref,
        idempotency_key, created_by, bank_account_id, cost_center_id)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
             $5, $6, $7, $8, $9,
             CASE WHEN $10::boolean THEN clock_timestamp() ELSE NULL END,
             $11::date, $12::fin.entry_status, $13, $14, app.current_user_id(),
             $15, $16)`,
    [entryId, i.categoryId ?? null, i.patientId ?? null, i.appointmentId ?? null,
     i.professionalId, i.clinicId, i.description, i.amountCents,
     i.paymentMethodId, i.paidNow, i.dueDate ?? null, status,
     i.externalRef ?? null, i.idempotencyKey,
     i.bankAccountId ?? null, i.costCenterId ?? null]);
```

- [ ] Atualizar `packages/payments/src/index.ts` para exportar os novos modulos.

```typescript
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
export {
  materializeRollup, detectDivergence, refreshDailyRollup,
  type DivergenceRow, type RollupResult,
} from './rollup';
export { createPaymentLink, type CreatePaymentLinkInput, type PaymentLinkCreated } from './create-payment-link';
export { processPaymentWebhook, type WebhookPayload, type WebhookProcessed } from './process-webhook';
export { reconcileSettlements, type ReconcileInput, type ReconcileResult } from './reconcile';
export {
  createBankAccount, updateBankAccount, deactivateBankAccount, listBankAccounts,
  type BankAccountFailure, type BankAccountRow,
  type CreateBankAccountInput, type UpdateBankAccountInput,
} from './bank-account';
export {
  createCostCenter, updateCostCenter, deactivateCostCenter, listCostCenters,
  type CostCenterFailure, type CostCenterRow,
  type CreateCostCenterInput, type UpdateCostCenterInput,
} from './cost-center';
```

- [ ] Criar `packages/payments/src/bank-account.int.test.ts` para testar a domain logic de contas bancarias.

```typescript
// packages/payments/src/bank-account.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createBankAccount, updateBankAccount, deactivateBankAccount, listBankAccounts,
} from './bank-account';

interface Semente {
  tenantId: string; clinicId: string; userId: string;
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
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica BA Domain', '44ABC55601DE78')`,
      [s.tenantId, `bad-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade BA', '4444444', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin BA')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

describe('createBankAccount — cria conta bancaria', () => {
  it('cria conta corrente com todos os campos', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, {
        name: 'Banco do Brasil',
        bankCode: '001',
        agency: '1234-5',
        accountNumber: '67890-1',
        accountType: 'corrente',
        initialBalanceCents: 500000,
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Banco do Brasil');
    expect(r.value.bankCode).toBe('001');
    expect(r.value.accountType).toBe('corrente');
    expect(r.value.initialBalanceCents).toBe(500000);
    expect(r.value.active).toBe(true);
  });

  it('cria conta minima sem dados bancarios', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, { name: 'Caixa Avulsa' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bankCode).toBeNull();
    expect(r.value.accountType).toBeNull();
  });
});

describe('updateBankAccount — atualiza conta bancaria', () => {
  let accountId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, { name: 'Para Atualizar', bankCode: '033' }));
    if (r.ok) accountId = r.value.id;
  });

  it('atualiza nome e banco', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateBankAccount(tx, { id: accountId, name: 'Santander', bankCode: '033' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Santander');
  });

  it('retorna erro para conta inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateBankAccount(tx, { id: uuidv7(), name: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_nao_encontrada');
  });
});

describe('deactivateBankAccount — desativa conta', () => {
  let accountId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, { name: 'Para Desativar' }));
    if (r.ok) accountId = r.value.id;
  });

  it('desativa conta nao-default', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateBankAccount(tx, accountId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar conta ja desativada', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateBankAccount(tx, accountId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativada');
  });

  it('recusa desativar a conta default (Caixa Geral)', async () => {
    // A Caixa Geral foi provisionada automaticamente pelo trigger
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text FROM fin.bank_account
          WHERE is_default = true LIMIT 1`));
    const defaultId = rows[0]?.id;
    expect(defaultId).toBeDefined();

    const r = await withTenantTx(actor, (tx) =>
      deactivateBankAccount(tx, defaultId!));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_default_nao_pode_desativar');
  });
});

describe('listBankAccounts — lista contas do tenant', () => {
  it('lista somente ativas por padrao, com default primeiro', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listBankAccounts(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    // Caixa Geral (default) sempre aparece primeiro
    expect(lista[0]?.isDefault).toBe(true);
    // Todas ativas
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });

  it('lista todas incluindo desativadas', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listBankAccounts(tx, false));
    const inativos = lista.filter((a) => !a.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Criar `packages/payments/src/cost-center.int.test.ts` para testar a domain logic de centros de custo.

```typescript
// packages/payments/src/cost-center.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createCostCenter, updateCostCenter, deactivateCostCenter, listCostCenters,
} from './cost-center';

interface Semente {
  tenantId: string; clinicId: string; userId: string;
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
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica CC Domain', '66ABC77801DE90')`,
      [s.tenantId, `ccd-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade CC', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin CC')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

describe('createCostCenter — cria centro de custo', () => {
  it('cria centro de custo com codigo e nome', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'MKT', name: 'Marketing' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.code).toBe('MKT');
    expect(r.value.name).toBe('Marketing');
    expect(r.value.active).toBe(true);
  });

  it('rejeita codigo duplicado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'MKT', name: 'Marketing Novo' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('codigo_duplicado');
  });

  it('rejeita nome duplicado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'MKT2', name: 'Marketing' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nome_duplicado');
  });
});

describe('updateCostCenter — atualiza centro de custo', () => {
  let centerId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'FIN', name: 'Financeiro' }));
    if (r.ok) centerId = r.value.id;
  });

  it('atualiza nome', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateCostCenter(tx, { id: centerId, name: 'Depto Financeiro' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Depto Financeiro');
    expect(r.value.code).toBe('FIN');
  });

  it('retorna erro para centro inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateCostCenter(tx, { id: uuidv7(), name: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('centro_nao_encontrado');
  });
});

describe('deactivateCostCenter — desativa centro', () => {
  let centerId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'RH', name: 'Recursos Humanos' }));
    if (r.ok) centerId = r.value.id;
  });

  it('desativa centro ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateCostCenter(tx, centerId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar centro ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateCostCenter(tx, centerId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listCostCenters — lista centros do tenant', () => {
  it('lista somente ativos por padrao, ordenados por codigo', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listCostCenters(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
    // Ordenacao por codigo
    for (let i = 1; i < lista.length; i++) {
      expect(lista[i]!.code >= lista[i - 1]!.code).toBe(true);
    }
  });

  it('lista todos incluindo desativados', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listCostCenters(tx, false));
    const inativos = lista.filter((c) => !c.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar todos os testes do pacote payments e confirmar que passam (incluindo os testes existentes da Fase 2, que devem continuar verdes com a alteracao retrocompativel).

```bash
pnpm vitest run packages/payments/src/ --config vitest.int.config.ts
```

Saida esperada: todos os testes passando (testes existentes + novos).

- [ ] Commitar.

```bash
git add packages/payments/src/bank-account.ts \
       packages/payments/src/cost-center.ts \
       packages/payments/src/index.ts \
       packages/payments/src/record-payment.ts \
       packages/payments/src/bank-account.int.test.ts \
       packages/payments/src/cost-center.int.test.ts
git commit -m "feat(payments): add bank account and cost center domain logic

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
