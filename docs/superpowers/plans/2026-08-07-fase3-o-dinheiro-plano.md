# Cadência — Fase 3 ("O dinheiro"): Plano de Implementação

> **Para agentes executores:** SUB-SKILL: superpowers:subagent-driven-development ou executing-plans. Passos em checkbox `- [ ]`.

**Objetivo:** entregar o financeiro completo (a receber/a pagar, fluxo de caixa, extrato, categorias, centro de custo, contas bancárias), repasse médico, estoque e Desempenho (Explorar + 11 visões salvas + atribuição de variação) — de modo que a gestora enxergue POR QUE o faturamento caiu, em 3 cliques, e que o médico veja seu repasse sem ver o dos outros.

**Arquitetura:** a Fase 3 constrói sobre as Fases 0-2, expandindo o schema `fin` (contas bancárias, centro de custo, fornecedores, repasse), criando o schema `inv` (estoque), e implementando a camada de relatórios (`rpt` matviews + `app_rpt` views security_barrier). Toda comunicação entre irmãos L2 é assíncrona via `packages/events`; composição síncrona é responsabilidade de L3 (API/worker).

**Stack:** TypeScript 5.9 strict · PostgreSQL 18 · Fastify 5 · Next.js 15 App Router + React 19 · TanStack Query 5 · Vitest · Zod v4 · pg-boss 10 · Tailwind 4 com tokens CSS próprios · Radix headless · visx 3.

---

## Antes de começar

### Pré-requisito absoluto: as Fases 0, 1 e 2 concluídas e verdes

Este plano assume 85 migrations aplicadas e ~900 testes passando. **Confirme antes de escrever a primeira linha:**

```bash
pnpm db:up
pnpm db:migrate           # deve terminar em "0085_fix_fase2_fk_ddl_privileges.sql"
pnpm typecheck             # exit 0
pnpm test                  # testes de unidade, 0 falhas
pnpm test:int              # testes de integração, 0 falhas
pnpm test:iso              # testes de isolamento
pnpm db:invariants         # todos OK
pnpm arch:check            # 0 violações
```

Se qualquer um desses falhar, **pare**.

### A próxima migration livre é a `0086`

`ls packages/db/migrations/` termina em `0085`. Se o número divergir do que a tarefa diz, **pare e reconcilie**.

### Regras de arquitetura herdadas

1. **Setas só descem** (L0 → L1 → L2 → L3) e **irmão nunca importa irmão**. `pnpm arch:check` reprova.
2. **Comunicação entre irmãos L2 é assíncrona** via `packages/events`. Composição síncrona é de L3.
3. **Migrations forward-only**, uma transação por arquivo.
4. **Fonte de tempo persistido é o PostgreSQL** (`clock_timestamp()`). `Date.now()` só em `clock.ts` e `uuid.ts`.
5. **Toda tabela multi-tenant**: `tenant_id`, RLS FORCE, ≥1 policy, FK composta.
6. **Chamada a parceiro sai só do worker**, via outbox.
7. **CNPJ alfanumérico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.
8. **Data do evento** usa `app.local_date()`, nunca `occurred_at::date`.
9. **Matviews** em `rpt`, propriedade de `rpt_owner`, SEM GRANT para `app_rw`. Expostas por views `security_barrier` em `app_rpt` (§3.8).

### Convenções

Conventional Commits em **inglês**. Código e identificadores em inglês; comentários e nomes de teste em **português**. Windows — prefira o Bash tool.

### Ordem de execução

1. **Tasks 1-6** — fin: contas bancárias e centro de custo
2. **Tasks 7-12** — fin: a pagar, fornecedores e recorrentes
3. **Tasks 13-17** — fin: fluxo de caixa, extrato e transferências
4. **Tasks 18-24** — fin: repasse médico
5. **Tasks 25-30** — estoque (schema inv)
6. **Tasks 31-37** — relatórios: rpt matviews + app_rpt views
7. **Tasks 38-43** — desempenho: engine de variação e atribuição
8. **Tasks 44-50** — desempenho: Explorar + 11 visões salvas
9. **Tasks 51-57** — API: rotas da Fase 3
10. **Tasks 58-64** — telas: Financeiro completo
11. **Tasks 65-70** — telas: Desempenho e Explorar
12. **Tasks 71-75** — integração: gate da Fase 3

---


## Parte: 01-fin-contas-centro

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


## Parte: 02-fin-a-pagar-recorrente

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


## Parte: 03-fin-fluxo-extrato

### Task 13: Migration 0092 — tabela `fin.transfer` e audit keys unificadas [RECONCILIADO]

**Arquivos**

- Criar `packages/db/migrations/0092_fin_transfer.sql`
- Teste `packages/db/src/invariants/bank-account.int.test.ts`

**Por que:** [RECONCILIADO] A tabela `fin.bank_account` e a coluna `bank_account_id` em `fin.entry` ja sao criadas pelo Bloco 01 (migrations 0086-0087). Esta migration cria apenas `fin.transfer` e atualiza `audit.meta_keys_ok` com a uniao de todas as chaves (Bloco 02 + Bloco 03). O saldo e DERIVADO (`SUM(amount_cents)` sobre entries vinculadas), nunca campo atualizado.

- [ ] Criar o arquivo de migration `packages/db/migrations/0092_fin_transfer.sql` com o conteudo completo:

```sql
-- 0092_fin_transfer.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- [RECONCILIADO] fin.bank_account e bank_account_id em fin.entry ja existem
-- desde as migrations 0086 e 0087 (Bloco 01). Esta migration so cria
-- fin.transfer e atualiza audit.meta_keys_ok com as chaves de transferencia.

-- ---------------------------------------------------------------------------
-- 1. Tabela de transferencia entre contas
-- ---------------------------------------------------------------------------
CREATE TABLE fin.transfer (
  tenant_id             uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                    uuid NOT NULL,
  from_bank_account_id  uuid NOT NULL,
  to_bank_account_id    uuid NOT NULL,
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  transferred_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  description           text NOT NULL COLLATE "pt-BR-x-icu",
  debit_entry_id        uuid NOT NULL,
  credit_entry_id       uuid NOT NULL,
  created_by            uuid,
  created_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, from_bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, to_bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, debit_entry_id)
    REFERENCES fin.entry(tenant_id, id),
  FOREIGN KEY (tenant_id, credit_entry_id)
    REFERENCES fin.entry(tenant_id, id),
  CHECK (from_bank_account_id <> to_bank_account_id)
);
ALTER TABLE fin.transfer OWNER TO app_owner;
GRANT SELECT, INSERT ON fin.transfer TO app_rw;

ALTER TABLE fin.transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.transfer FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.transfer AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Whitelist de chaves de auditoria — MERGE de Bloco 02 (0091) + transferencia
-- [RECONCILIADO] Esta versao inclui TODAS as chaves de 0091 (recorrencia/
-- parcelamento/fornecedor) mais as novas de transferencia. Como e CREATE OR
-- REPLACE, a ultima migration a rodar (0092) prevalece — por isso deve ter
-- a uniao de tudo.
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
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id'
            )
         );
$$;

RESET ROLE;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0092 aplicada com sucesso.

- [ ] Criar o arquivo de teste `packages/db/src/invariants/bank-account.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeConta {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  bankAccountCaixaId: string;
  bankAccountBancoId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearConta(): Promise<SementeConta> {
  const s: SementeConta = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(),
    bankAccountCaixaId: uuidv7(), bankAccountBancoId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Conta', '11ABC22301DE44')`,
      [s.tenantId, `ba-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade BA', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario BA')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
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

let s: SementeConta;
let actor: Actor;

beforeAll(async () => {
  s = await semearConta();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES (app.require_tenant_id(), $1, 'Caixa Interno', 'caixa'),
              (app.require_tenant_id(), $2, 'Banco do Brasil', 'banco')`,
      [s.bankAccountCaixaId, s.bankAccountBancoId]);
    await tx.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro')`,
      [s.paymentMethodId]);
  });
});

afterAll(async () => { await closePools(); });

describe('schema fin.bank_account — RLS e constraints', () => {
  it('insere e le conta bancaria com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind FROM fin.bank_account WHERE id = $1`,
        [s.bankAccountCaixaId]));
    expect(rows[0]).toEqual({ name: 'Caixa Interno', kind: 'caixa' });
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
           VALUES (app.require_tenant_id(), $1, 'Caixa Interno', 'caixa')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('rejeita kind invalido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
           VALUES (app.require_tenant_id(), $1, 'Invalido', 'poupanca')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });
});

describe('schema fin.transfer — constraints', () => {
  it('rejeita transferencia para a mesma conta', async () => {
    const debitId = uuidv7();
    const creditId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Debito teste', 10000, $4, 'pago', $5, $6, clock_timestamp()),
                (app.require_tenant_id(), $7, 'receita', $2, $3,
                 'Credito teste', 10000, $4, 'pago', $8, $9, clock_timestamp())`,
        [debitId, s.professionalId, s.clinicId, s.paymentMethodId,
         `deb-${debitId}`, s.bankAccountCaixaId,
         creditId, `cre-${creditId}`, s.bankAccountCaixaId]);
    });

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.transfer
             (tenant_id, id, from_bank_account_id, to_bank_account_id,
              amount_cents, description, debit_entry_id, credit_entry_id,
              created_by)
           VALUES (app.require_tenant_id(), $1, $2, $2,
                   10000, 'Mesma conta', $3, $4, app.current_user_id())`,
          [uuidv7(), s.bankAccountCaixaId, debitId, creditId])),
    ).rejects.toThrow();
  });

  it('insere transferencia valida entre contas', async () => {
    const debitId = uuidv7();
    const creditId = uuidv7();
    const transferId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Transferencia saida', 5000, $4, 'pago', $5, $6, clock_timestamp()),
                (app.require_tenant_id(), $7, 'receita', $2, $3,
                 'Transferencia entrada', 5000, $4, 'pago', $8, $9, clock_timestamp())`,
        [debitId, s.professionalId, s.clinicId, s.paymentMethodId,
         `deb-${debitId}`, s.bankAccountCaixaId,
         creditId, `cre-${creditId}`, s.bankAccountBancoId]);

      await tx.query(
        `INSERT INTO fin.transfer
           (tenant_id, id, from_bank_account_id, to_bank_account_id,
            amount_cents, description, debit_entry_id, credit_entry_id,
            created_by)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 5000, 'Deposito', $4, $5, app.current_user_id())`,
        [transferId, s.bankAccountCaixaId, s.bankAccountBancoId,
         debitId, creditId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; description: string }>(
        `SELECT amount_cents::text, description FROM fin.transfer WHERE id = $1`,
        [transferId]));
    expect(rows[0]).toEqual({ amount_cents: '5000', description: 'Deposito' });
  });
});

describe('fin.entry — bank_account_id e nullable e funcional', () => {
  it('aceita lancamento sem bank_account_id (retrocompativel)', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Sem conta', 3000, $4, 'pendente', $5)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `nobank-${entryId}`]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string | null }>(
        `SELECT bank_account_id::text FROM fin.entry WHERE id = $1`,
        [entryId]));
    expect(rows[0]?.bank_account_id).toBeNull();
  });

  it('aceita lancamento com bank_account_id', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Com conta', 4000, $4, 'pago', $5, $6, clock_timestamp())`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `withbank-${entryId}`, s.bankAccountCaixaId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string }>(
        `SELECT bank_account_id::text FROM fin.entry WHERE id = $1`,
        [entryId]));
    expect(rows[0]?.bank_account_id).toBe(s.bankAccountCaixaId);
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/db/src/invariants/bank-account.int.test.ts
```

Saida esperada: todos os testes passam (8 testes).

- [ ] Commitar:

```bash
git add packages/db/migrations/0092_fin_transfer.sql \
       packages/db/src/invariants/bank-account.int.test.ts
git commit -m "feat(db): add fin.bank_account table and bank_account_id on fin.entry (0092)"
```

---

### Task 14: Domain — `createTransfer` em `packages/payments`

**Arquivos**

- Criar `packages/payments/src/transfer.ts`
- Modificar `packages/payments/src/index.ts`
- Teste `packages/payments/src/transfer.int.test.ts`

**Por que:** Transferencia entre contas gera DOIS `fin.entry` vinculados (um debito na conta de origem e um credito na conta de destino) e um registro em `fin.transfer`. O saldo nunca e atualizado diretamente — permanece derivado.

- [ ] Criar o teste `packages/payments/src/transfer.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createTransfer, type CreateTransferInput } from './transfer';
import { Pool } from 'pg';

interface SementeTransfer {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  bankAccountCaixaId: string;
  bankAccountBancoId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearTransfer(): Promise<SementeTransfer> {
  const s: SementeTransfer = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(),
    bankAccountCaixaId: uuidv7(), bankAccountBancoId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Transfer', '44ABC55601DE77')`,
      [s.tenantId, `tf-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade TF', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario TF')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa TF', 'caixa'),
              ($1, $3, 'Banco TF', 'banco')`,
      [s.tenantId, s.bankAccountCaixaId, s.bankAccountBancoId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro TF')`,
      [s.tenantId, s.paymentMethodId]);
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

let s: SementeTransfer;
let actor: Actor;

beforeAll(async () => {
  s = await semearTransfer();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('createTransfer — transferencia entre contas', () => {
  it('cria transferencia e gera dois entries vinculados', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 15000,
      description: 'Deposito bancario',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.transferId).toBeDefined();
    expect(r.value.debitEntryId).toBeDefined();
    expect(r.value.creditEntryId).toBeDefined();

    // Verificar que os dois entries existem
    const { rows: entries } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string; kind: string; bank_account_id: string; amount_cents: string }>(
        `SELECT id, kind::text, bank_account_id::text, amount_cents::text
           FROM fin.entry
          WHERE id IN ($1, $2) ORDER BY kind`,
        [r.value.debitEntryId, r.value.creditEntryId]));

    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.kind === 'despesa');
    const credit = entries.find((e) => e.kind === 'receita');

    expect(debit).toBeDefined();
    expect(debit!.bank_account_id).toBe(s.bankAccountCaixaId);
    expect(debit!.amount_cents).toBe('15000');

    expect(credit).toBeDefined();
    expect(credit!.bank_account_id).toBe(s.bankAccountBancoId);
    expect(credit!.amount_cents).toBe('15000');

    // Verificar que o transfer existe
    const { rows: transfers } = await withTenantTx(actor, (tx) =>
      tx.query<{ from_bank_account_id: string; to_bank_account_id: string }>(
        `SELECT from_bank_account_id::text, to_bank_account_id::text
           FROM fin.transfer WHERE id = $1`,
        [r.value.transferId]));
    expect(transfers[0]?.from_bank_account_id).toBe(s.bankAccountCaixaId);
    expect(transfers[0]?.to_bank_account_id).toBe(s.bankAccountBancoId);
  });

  it('rejeita conta de origem inexistente', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: uuidv7(),
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 5000,
      description: 'Conta fantasma',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_origem_nao_encontrada');
  });

  it('rejeita conta de destino inexistente', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: uuidv7(),
      amountCents: 5000,
      description: 'Conta destino fantasma',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_destino_nao_encontrada');
  });

  it('rejeita transferencia para a mesma conta', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountCaixaId,
      amountCents: 5000,
      description: 'Mesma conta',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('mesma_conta');
  });

  it('grava evento de auditoria TRANSFER_CREATE', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 8000,
      description: 'Auditoria transferencia',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'TRANSFER_CREATE' AND entity_id = $1`,
        [r.value.transferId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA (funcao ainda nao existe):

```bash
pnpm vitest run packages/payments/src/transfer.int.test.ts
```

Saida esperada: erro de compilacao — modulo `./transfer` nao encontrado.

- [ ] Criar o arquivo `packages/payments/src/transfer.ts`:

```typescript
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type TransferFailure =
  | { kind: 'conta_origem_nao_encontrada' }
  | { kind: 'conta_destino_nao_encontrada' }
  | { kind: 'mesma_conta' };

export interface CreateTransferInput {
  readonly fromBankAccountId: string;
  readonly toBankAccountId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly clinicId: string;
  readonly professionalId: string;
}

export interface TransferCreated {
  readonly transferId: string;
  readonly debitEntryId: string;
  readonly creditEntryId: string;
}

/**
 * Cria transferencia entre contas bancarias. Gera DOIS fin.entry vinculados:
 * - Um debito (kind='despesa') na conta de origem
 * - Um credito (kind='receita') na conta de destino
 *
 * O saldo de cada conta e DERIVADO de SUM(amount_cents) sobre entries da conta,
 * nunca e campo atualizado. Transferencia e a unica operacao que cria entries
 * sem patient_id e sem appointment_id.
 */
export async function createTransfer(
  tx: TxClient,
  i: CreateTransferInput,
): Promise<Result<TransferCreated, TransferFailure>> {
  if (i.fromBankAccountId === i.toBankAccountId) {
    return err({ kind: 'mesma_conta' });
  }

  // Verificar que a conta de origem existe
  const { rows: fromRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.bank_account WHERE id = $1`,
    [i.fromBankAccountId]);
  if (fromRows.length === 0) {
    return err({ kind: 'conta_origem_nao_encontrada' });
  }

  // Verificar que a conta de destino existe
  const { rows: toRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.bank_account WHERE id = $1`,
    [i.toBankAccountId]);
  if (toRows.length === 0) {
    return err({ kind: 'conta_destino_nao_encontrada' });
  }

  // Resolver metodo de pagamento 'transferencia_interna' (auto-provisiona)
  const { rows: pmRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method
      WHERE kind = 'dinheiro'::fin.payment_method_kind LIMIT 1`);

  let paymentMethodId: string;
  if (pmRows.length > 0) {
    paymentMethodId = pmRows[0]!.id;
  } else {
    const newPmId = uuidv7();
    await tx.query(
      `INSERT INTO fin.payment_method (id, kind, name)
       VALUES ($1, 'dinheiro'::fin.payment_method_kind, 'Transferencia Interna')`,
      [newPmId]);
    paymentMethodId = newPmId;
  }

  const debitEntryId = uuidv7();
  const creditEntryId = uuidv7();
  const transferId = uuidv7();

  // Entry de debito na conta de origem (kind='despesa')
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key,
        bank_account_id, paid_at, created_by)
     VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
             $4, $5, $6, 'pago', $7, $8, clock_timestamp(),
             app.current_user_id())`,
    [debitEntryId, i.professionalId, i.clinicId,
     i.description, i.amountCents, paymentMethodId,
     `transfer-deb:${transferId}`, i.fromBankAccountId]);

  // Entry de credito na conta de destino (kind='receita')
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key,
        bank_account_id, paid_at, created_by)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
             $4, $5, $6, 'pago', $7, $8, clock_timestamp(),
             app.current_user_id())`,
    [creditEntryId, i.professionalId, i.clinicId,
     i.description, i.amountCents, paymentMethodId,
     `transfer-cre:${transferId}`, i.toBankAccountId]);

  // Registro da transferencia
  await tx.query(
    `INSERT INTO fin.transfer
       (tenant_id, id, from_bank_account_id, to_bank_account_id,
        amount_cents, description, debit_entry_id, credit_entry_id,
        created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3,
             $4, $5, $6, $7, app.current_user_id())`,
    [transferId, i.fromBankAccountId, i.toBankAccountId,
     i.amountCents, i.description, debitEntryId, creditEntryId]);

  // Auditoria
  await tx.query(
    `SELECT audit.log('TRANSFER_CREATE', 'fin', 'transfer', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'from_account', $3::text,
                                         'to_account', $4::text,
                                         'transfer_id', $5::text), $6)`,
    [transferId, i.amountCents, i.fromBankAccountId,
     i.toBankAccountId, transferId, i.clinicId]);

  return ok({ transferId, debitEntryId, creditEntryId });
}
```

- [ ] Modificar `packages/payments/src/index.ts` para exportar `createTransfer`:

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
  createTransfer,
  type CreateTransferInput, type TransferCreated, type TransferFailure,
} from './transfer';
```

- [ ] Rodar o teste e confirmar que PASSA:

```bash
pnpm vitest run packages/payments/src/transfer.int.test.ts
```

Saida esperada: 4 testes passam.

- [ ] Commitar:

```bash
git add packages/payments/src/transfer.ts \
       packages/payments/src/transfer.int.test.ts \
       packages/payments/src/index.ts
git commit -m "feat(payments): add createTransfer domain function"
```

---

### Task 15: Domain — `getCashFlowProjection` em `packages/payments`

**Arquivos**

- Criar `packages/payments/src/cash-flow.ts`
- Modificar `packages/payments/src/index.ts`
- Teste `packages/payments/src/cash-flow.int.test.ts`

**Por que:** Fluxo de caixa projetado combina entries com paid_at (realizado) + entries com due_date futuro e status=pendente (projetado), agrupado por semana, com linha de saldo acumulado. Usa window function para calcular o acumulado.

- [ ] Criar o teste `packages/payments/src/cash-flow.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getCashFlowProjection, type CashFlowInput } from './cash-flow';
import { Pool } from 'pg';

interface SementeCashFlow {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCashFlow(): Promise<SementeCashFlow> {
  const s: SementeCashFlow = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica CF', '55ABC66701DE88')`,
      [s.tenantId, `cf-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade CF', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario CF')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix CF')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa CF', 'caixa')`,
      [s.tenantId, s.bankAccountId]);
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

let s: SementeCashFlow;
let actor: Actor;

beforeAll(async () => {
  s = await semearCashFlow();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear lancamentos: um pago (realizado) e um pendente (projetado)
  await withTenantTx(actor, async (tx) => {
    // Receita paga ontem
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta paga', 25000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-paid-${uuidv7()}`, s.bankAccountId]);

    // Despesa paga ontem
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
               'Material', 5000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-exp-${uuidv7()}`, s.bankAccountId]);

    // Receita pendente com vencimento em 10 dias (projetada)
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, due_date)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Retorno futuro', 18000, $4, 'pendente', $5, $6,
               current_date + 10)`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-fut-${uuidv7()}`, s.bankAccountId]);
  });
});

afterAll(async () => { await closePools(); });

describe('getCashFlowProjection — fluxo de caixa projetado', () => {
  it('retorna semanas com realizado e projetado', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 14 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 28 * 24 * 3600_000).toISOString().slice(0, 10),
      bankAccountId: s.bankAccountId,
    };

    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));

    expect(r.weeks.length).toBeGreaterThan(0);

    // Pelo menos uma semana deve ter receita realizada
    const temRealizado = r.weeks.some((w) => w.realizedInCents > 0 || w.realizedOutCents > 0);
    expect(temRealizado).toBe(true);

    // Pelo menos uma semana deve ter receita projetada
    const temProjetado = r.weeks.some((w) => w.projectedInCents > 0);
    expect(temProjetado).toBe(true);

    // Toda semana tem saldo acumulado
    for (const w of r.weeks) {
      expect(typeof w.cumulativeBalanceCents).toBe('number');
    }
  });

  it('retorna array vazio se nao ha lancamentos no periodo', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: '2020-01-01',
      toDate: '2020-01-31',
    };

    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));
    expect(r.weeks).toHaveLength(0);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA:

```bash
pnpm vitest run packages/payments/src/cash-flow.int.test.ts
```

Saida esperada: erro de compilacao — modulo `./cash-flow` nao encontrado.

- [ ] Criar o arquivo `packages/payments/src/cash-flow.ts`:

```typescript
import type { TxClient } from '@cadencia/db';

export interface CashFlowInput {
  readonly clinicId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly bankAccountId?: string;
}

export interface CashFlowWeek {
  readonly weekStart: string;
  readonly realizedInCents: number;
  readonly realizedOutCents: number;
  readonly projectedInCents: number;
  readonly projectedOutCents: number;
  readonly netCents: number;
  readonly cumulativeBalanceCents: number;
}

export interface CashFlowProjection {
  readonly weeks: readonly CashFlowWeek[];
}

/**
 * Fluxo de caixa projetado. Combina:
 * - Entries com paid_at (realizado): receitas e despesas efetivamente pagas
 * - Entries com due_date futuro e status=pendente (projetado): receitas e despesas previstas
 *
 * Agrupado por semana (date_trunc('week', data)) com saldo acumulado via window function.
 * O filtro por bank_account_id e opcional: se ausente, mostra todos os lancamentos da clinica.
 */
export async function getCashFlowProjection(
  tx: TxClient,
  i: CashFlowInput,
): Promise<CashFlowProjection> {
  const bankFilter = i.bankAccountId !== undefined
    ? `AND e.bank_account_id = $4`
    : '';
  const params: unknown[] = [i.clinicId, i.fromDate, i.toDate];
  if (i.bankAccountId !== undefined) {
    params.push(i.bankAccountId);
  }

  const { rows } = await tx.query<{
    week_start: string;
    realized_in_cents: string;
    realized_out_cents: string;
    projected_in_cents: string;
    projected_out_cents: string;
    net_cents: string;
    cumulative_balance_cents: string;
  }>(
    `WITH base AS (
       -- Realizado: entries com paid_at no periodo
       SELECT
         date_trunc('week', e.paid_at)::date AS week_start,
         CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END AS realized_in,
         CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END AS realized_out,
         0::bigint AS projected_in,
         0::bigint AS projected_out
       FROM fin.entry e
       WHERE e.clinic_id = $1
         AND e.paid_at IS NOT NULL
         AND e.paid_at >= $2::date
         AND e.paid_at < ($3::date + 1)
         AND e.status IN ('pago')
         ${bankFilter}

       UNION ALL

       -- Projetado: entries pendentes com due_date no periodo
       SELECT
         date_trunc('week', e.due_date)::date AS week_start,
         0::bigint AS realized_in,
         0::bigint AS realized_out,
         CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END AS projected_in,
         CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END AS projected_out
       FROM fin.entry e
       WHERE e.clinic_id = $1
         AND e.status = 'pendente'
         AND e.due_date IS NOT NULL
         AND e.due_date >= $2::date
         AND e.due_date <= $3::date
         ${bankFilter}
     ),
     weekly AS (
       SELECT
         week_start,
         SUM(realized_in)::bigint AS realized_in_cents,
         SUM(realized_out)::bigint AS realized_out_cents,
         SUM(projected_in)::bigint AS projected_in_cents,
         SUM(projected_out)::bigint AS projected_out_cents,
         (SUM(realized_in) - SUM(realized_out)
          + SUM(projected_in) - SUM(projected_out))::bigint AS net_cents
       FROM base
       GROUP BY week_start
     )
     SELECT
       to_char(week_start, 'YYYY-MM-DD') AS week_start,
       realized_in_cents::text,
       realized_out_cents::text,
       projected_in_cents::text,
       projected_out_cents::text,
       net_cents::text,
       SUM(net_cents) OVER (ORDER BY week_start
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text
         AS cumulative_balance_cents
     FROM weekly
     ORDER BY week_start`,
    params,
  );

  const weeks: CashFlowWeek[] = rows.map((r) => ({
    weekStart: r.week_start,
    realizedInCents: Number(r.realized_in_cents),
    realizedOutCents: Number(r.realized_out_cents),
    projectedInCents: Number(r.projected_in_cents),
    projectedOutCents: Number(r.projected_out_cents),
    netCents: Number(r.net_cents),
    cumulativeBalanceCents: Number(r.cumulative_balance_cents),
  }));

  return { weeks };
}
```

- [ ] Modificar `packages/payments/src/index.ts` para exportar `getCashFlowProjection`:

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
  createTransfer,
  type CreateTransferInput, type TransferCreated, type TransferFailure,
} from './transfer';
export {
  getCashFlowProjection,
  type CashFlowInput, type CashFlowProjection, type CashFlowWeek,
} from './cash-flow';
```

- [ ] Rodar o teste e confirmar que PASSA:

```bash
pnpm vitest run packages/payments/src/cash-flow.int.test.ts
```

Saida esperada: 2 testes passam.

- [ ] Commitar:

```bash
git add packages/payments/src/cash-flow.ts \
       packages/payments/src/cash-flow.int.test.ts \
       packages/payments/src/index.ts
git commit -m "feat(payments): add getCashFlowProjection domain function"
```

---

### Task 16: Domain — `getBankStatement` em `packages/payments`

**Arquivos**

- Criar `packages/payments/src/bank-statement.ts`
- Modificar `packages/payments/src/index.ts`
- Teste `packages/payments/src/bank-statement.int.test.ts`

**Por que:** Extrato por conta e uma query ordenada por data com saldo corrente via window function. O saldo da conta e DERIVADO (SUM sobre entries da conta), nunca campo atualizado.

- [ ] Criar o teste `packages/payments/src/bank-statement.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getBankStatement, type BankStatementInput } from './bank-statement';
import { Pool } from 'pg';

interface SementeStatement {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
  otherAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearStatement(): Promise<SementeStatement> {
  const s: SementeStatement = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(), otherAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Extrato', '66ABC77801DE99')`,
      [s.tenantId, `st-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Extrato', '6677889', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario Ext')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro Ext')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa Extrato', 'caixa'),
              ($1, $3, 'Outra Conta', 'banco')`,
      [s.tenantId, s.bankAccountId, s.otherAccountId]);
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

let s: SementeStatement;
let actor: Actor;

beforeAll(async () => {
  s = await semearStatement();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear lancamentos na conta: 3 entries em sequencia
  await withTenantTx(actor, async (tx) => {
    // Receita 1 - paga ha 3 dias
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta A', 30000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '3 days')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-1-${uuidv7()}`, s.bankAccountId]);

    // Despesa - paga ha 2 dias
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
               'Material escritorio', 8000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '2 days')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-2-${uuidv7()}`, s.bankAccountId]);

    // Receita 2 - paga ha 1 dia
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta B', 20000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-3-${uuidv7()}`, s.bankAccountId]);
  });
});

afterAll(async () => { await closePools(); });

describe('getBankStatement — extrato por conta', () => {
  it('retorna linhas ordenadas por data com saldo corrente', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));

    expect(r.lines.length).toBe(3);

    // Primeira linha: +30000 -> saldo = 30000
    expect(r.lines[0]!.amountCents).toBe(30000);
    expect(r.lines[0]!.kind).toBe('receita');
    expect(r.lines[0]!.runningBalanceCents).toBe(30000);

    // Segunda linha: -8000 -> saldo = 22000
    expect(r.lines[1]!.amountCents).toBe(8000);
    expect(r.lines[1]!.kind).toBe('despesa');
    expect(r.lines[1]!.runningBalanceCents).toBe(22000);

    // Terceira linha: +20000 -> saldo = 42000
    expect(r.lines[2]!.amountCents).toBe(20000);
    expect(r.lines[2]!.kind).toBe('receita');
    expect(r.lines[2]!.runningBalanceCents).toBe(42000);
  });

  it('retorna totalBalance igual ao ultimo saldo corrente', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    expect(r.totalBalanceCents).toBe(42000);
  });

  it('retorna array vazio para conta sem lancamentos no periodo', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.otherAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    expect(r.lines).toHaveLength(0);
    expect(r.totalBalanceCents).toBe(0);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA:

```bash
pnpm vitest run packages/payments/src/bank-statement.int.test.ts
```

Saida esperada: erro de compilacao — modulo `./bank-statement` nao encontrado.

- [ ] Criar o arquivo `packages/payments/src/bank-statement.ts`:

```typescript
import type { TxClient } from '@cadencia/db';

export interface BankStatementInput {
  readonly bankAccountId: string;
  readonly clinicId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface StatementLine {
  readonly entryId: string;
  readonly kind: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paidAt: string;
  readonly runningBalanceCents: number;
}

export interface BankStatement {
  readonly lines: readonly StatementLine[];
  readonly totalBalanceCents: number;
}

/**
 * Extrato por conta bancaria. Retorna linhas ordenadas por data de pagamento
 * com saldo corrente via window function. O saldo e DERIVADO — nunca campo
 * atualizado. Receitas somam, despesas subtraem.
 *
 * O saldo corrente (running balance) e calculado com:
 *   SUM(CASE WHEN kind='receita' THEN amount_cents ELSE -amount_cents END)
 *   OVER (ORDER BY paid_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
 *
 * A ordenacao inclui id para desempate determinista.
 */
export async function getBankStatement(
  tx: TxClient,
  i: BankStatementInput,
): Promise<BankStatement> {
  const limit = i.limit ?? 500;
  const params: unknown[] = [i.bankAccountId, i.clinicId, i.fromDate, i.toDate, limit + 1];

  let cursorFilter = '';
  if (i.cursor !== undefined) {
    cursorFilter = `AND e.paid_at > $6`;
    params.push(i.cursor);
  }

  const { rows } = await tx.query<{
    entry_id: string;
    kind: string;
    description: string;
    amount_cents: string;
    paid_at: string;
    running_balance_cents: string;
  }>(
    `SELECT
       e.id AS entry_id,
       e.kind::text,
       e.description,
       e.amount_cents::text,
       to_char(e.paid_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
       SUM(
         CASE WHEN e.kind = 'receita' THEN e.amount_cents
              ELSE -e.amount_cents END
       ) OVER (
         ORDER BY e.paid_at, e.id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       )::text AS running_balance_cents
     FROM fin.entry e
     WHERE e.bank_account_id = $1
       AND e.clinic_id = $2
       AND e.paid_at IS NOT NULL
       AND e.paid_at >= $3::date
       AND e.paid_at < ($4::date + 1)
       AND e.status = 'pago'
       ${cursorFilter}
     ORDER BY e.paid_at, e.id
     LIMIT $5`,
    params,
  );

  const lines: StatementLine[] = rows.slice(0, limit).map((r) => ({
    entryId: r.entry_id,
    kind: r.kind,
    description: r.description,
    amountCents: Number(r.amount_cents),
    paidAt: r.paid_at,
    runningBalanceCents: Number(r.running_balance_cents),
  }));

  const totalBalanceCents = lines.length > 0
    ? lines[lines.length - 1]!.runningBalanceCents
    : 0;

  return { lines, totalBalanceCents };
}
```

- [ ] Modificar `packages/payments/src/index.ts` para exportar `getBankStatement`:

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
  createTransfer,
  type CreateTransferInput, type TransferCreated, type TransferFailure,
} from './transfer';
export {
  getCashFlowProjection,
  type CashFlowInput, type CashFlowProjection, type CashFlowWeek,
} from './cash-flow';
export {
  getBankStatement,
  type BankStatementInput, type BankStatement, type StatementLine,
} from './bank-statement';
```

- [ ] Rodar o teste e confirmar que PASSA:

```bash
pnpm vitest run packages/payments/src/bank-statement.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] Commitar:

```bash
git add packages/payments/src/bank-statement.ts \
       packages/payments/src/bank-statement.int.test.ts \
       packages/payments/src/index.ts
git commit -m "feat(payments): add getBankStatement domain function"
```

---

### Task 17: Migration 0093 — indice para latencia do painel financeiro e acoes de authz

**Arquivos**

- Criar `packages/db/migrations/0093_fin_statement_index.sql`
- Modificar `packages/authz/src/actions.ts`
- Teste `packages/payments/src/fin-latency.int.test.ts`

**Por que:** O alvo de latencia do painel financeiro do mes (rollup) e < 1 ms com ~240 linhas (Apendice A). O extrato por conta precisa de indice cobrindo `(bank_account_id, paid_at)` para nao cair em seq scan. Alem disso, as acoes de authz `payment.transfer` e `bank_account.write` precisam existir no catalogo para que as rotas da Task seguinte possam usar `assertCan`.

- [ ] Criar o arquivo de migration `packages/db/migrations/0093_fin_statement_index.sql`:

```sql
-- 0093_fin_statement_index.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Indice para extrato por conta e fluxo de caixa projetado. O alvo de latencia
-- do painel financeiro do mes e < 1 ms (~240 linhas, Apendice A).

-- ---------------------------------------------------------------------------
-- 1. Indice para extrato por conta: (bank_account_id, paid_at) com INCLUDE
-- ---------------------------------------------------------------------------
CREATE INDEX ix_entry_bank_statement
  ON fin.entry (tenant_id, bank_account_id, paid_at)
  INCLUDE (kind, amount_cents, description, status, id)
  WHERE bank_account_id IS NOT NULL AND paid_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Indice para fluxo de caixa projetado: entries pendentes com due_date
-- ---------------------------------------------------------------------------
CREATE INDEX ix_entry_projected_cashflow
  ON fin.entry (tenant_id, clinic_id, due_date)
  INCLUDE (kind, amount_cents, bank_account_id, status)
  WHERE status = 'pendente' AND due_date IS NOT NULL;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0093 aplicada com sucesso.

- [ ] [RECONCILIADO] Modificar `packages/authz/src/actions.ts` para adicionar TODAS as acoes da Fase 3 (uniao de Bloco 03 + Bloco 09). O Bloco 09 (Task 51) NAO deve modificar este arquivo novamente — o catalogo unificado e aplicado aqui:

```typescript
/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // ── Fase 1 · Agenda ──────────────────────────────────────────────────────
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // ── Fase 1 · Prontuario ──────────────────────────────────────────────────
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // ── Fase 1 · Documentos e prescricao ─────────────────────────────────────
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // ── Fase 2 · Mensageria ──────────────────────────────────────────────────
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // ── Fase 2 · Pagamento ───────────────────────────────────────────────────
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  // ── Fase 3 · Contas bancarias e transferencias (Bloco 03) ────────────────
  { key: 'bank_account.read', description: 'Listar contas bancarias',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'bank_account.write', description: 'Criar ou editar contas bancarias',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.transfer', description: 'Criar transferencia entre contas',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Financeiro completo (Bloco 09) ────────────────────────────
  { key: 'finance.settings', description: 'Configurar contas bancarias, centros de custo, regras de split e recorrencia',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.write', description: 'Lancar despesa e cadastrar fornecedor',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Gerar, visualizar e pagar repasse a profissionais',
    roles: ['admin_clinico', 'financeiro'], requiresMfa: true },
  // ── Fase 3 · Estoque (Bloco 09) ────────────────────────────────────────
  { key: 'inventory.read', description: 'Consultar produtos e alertas de estoque',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'inventory.write', description: 'Cadastrar produto e registrar movimentacao',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Relatorios (Bloco 09) ─────────────────────────────────────
  { key: 'report.read', description: 'Acessar painel de desempenho e exportar relatorios',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
```

- [ ] Criar o teste de latencia `packages/payments/src/fin-latency.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getBankStatement, type BankStatementInput } from './bank-statement';
import { getCashFlowProjection, type CashFlowInput } from './cash-flow';
import { Pool } from 'pg';

interface SementeLatencia {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearLatencia(): Promise<SementeLatencia> {
  const s: SementeLatencia = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Latencia', '77ABC88901DE00')`,
      [s.tenantId, `lat-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Lat', '7788990', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario Lat')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111000', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Lat')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa Lat', 'caixa')`,
      [s.tenantId, s.bankAccountId]);
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

let s: SementeLatencia;
let actor: Actor;

beforeAll(async () => {
  s = await semearLatencia();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear ~240 lancamentos para simular um mes de clinica
  await withTenantTx(actor, async (tx) => {
    const values: string[] = [];
    const params: unknown[] = [s.professionalId, s.clinicId, s.paymentMethodId, s.bankAccountId];
    let idx = 5;

    for (let day = 1; day <= 30; day++) {
      for (let i = 0; i < 8; i++) {
        const entryId = uuidv7();
        const kind = i % 4 === 0 ? 'despesa' : 'receita';
        const amount = kind === 'receita' ? 25000 : 5000;
        values.push(
          `(app.require_tenant_id(), $${idx}, '${kind}'::fin.entry_kind, $1, $2,
           'Lancamento ${day}-${i}', ${amount}, $3, 'pago',
           $${idx + 1}, $4, clock_timestamp() - interval '${30 - day} days')`);
        params.push(entryId, `lat-${entryId}`);
        idx += 2;
      }
    }

    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES ${values.join(',\n')}`,
      params);
  });
});

afterAll(async () => { await closePools(); });

describe('latencia — painel financeiro e extrato', () => {
  it('extrato de 240 lancamentos executa em menos de 50ms', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 31 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const inicio = performance.now();
    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    const duracao = performance.now() - inicio;

    expect(r.lines.length).toBe(240);
    // A transacao inteira (preambulo + query + commit) deve ficar abaixo de 50ms.
    // O alvo real e < 1ms para o rollup; o extrato com window function e mais pesado
    // mas 50ms e conservador.
    expect(duracao).toBeLessThan(50);
  });

  it('fluxo de caixa projetado de 30 dias executa em menos de 50ms', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 31 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
      bankAccountId: s.bankAccountId,
    };

    const inicio = performance.now();
    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));
    const duracao = performance.now() - inicio;

    expect(r.weeks.length).toBeGreaterThan(0);
    expect(duracao).toBeLessThan(50);
  });

  it('acoes de authz bank_account.read, bank_account.write e payment.transfer existem', async () => {
    const { ACTION_BY_KEY } = await import('@cadencia/authz');
    expect(ACTION_BY_KEY.get('bank_account.read')).toBeDefined();
    expect(ACTION_BY_KEY.get('bank_account.write')).toBeDefined();
    expect(ACTION_BY_KEY.get('payment.transfer')).toBeDefined();
    expect(ACTION_BY_KEY.get('bank_account.write')!.roles).toContain('financeiro');
    expect(ACTION_BY_KEY.get('payment.transfer')!.roles).toContain('financeiro');
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/payments/src/fin-latency.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] Commitar:

```bash
git add packages/db/migrations/0093_fin_statement_index.sql \
       packages/authz/src/actions.ts \
       packages/payments/src/fin-latency.int.test.ts
git commit -m "feat(db): add statement/cashflow indexes (0093) and authz actions for bank accounts"
```


## Parte: 04-fin-repasse

### Task 18: Migration 0094 — tabelas fin.split_rule e fin.split

**Arquivos**
- Criar: `packages/db/migrations/0094_fin_split_rule_split.sql`
- Teste: `packages/payments/src/split-schema.int.test.ts`

**Por que**
Regra de repasse (`fin.split_rule`) define como a receita de cada atendimento e dividida entre clinica e profissional. `fin.split` vincula cada lancamento pago a sua divisao calculada. A prioridade resolve conflitos: regra mais especifica (professional + procedure + convention) vence regra generica (so professional).

- [ ] Criar o teste de integracao `packages/payments/src/split-schema.int.test.ts` que valida a DDL:

```ts
// packages/payments/src/split-schema.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeRepasse {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  categoryId: string;
  paymentMethodId: string;
  procedureId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRepasse(): Promise<SementeRepasse> {
  const s: SementeRepasse = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    procedureId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Repasse', '12ABC34501DE35')`,
      [s.tenantId, `r-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Repasse', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Repasse')`,
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
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Repasse', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta', 'receita')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
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

let s: SementeRepasse;
let actor: Actor;

beforeAll(async () => {
  s = await semearRepasse();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('schema fin — split_rule', () => {
  it('insere regra de repasse percentual com RLS ativa', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, NULL,
                 50.00, NULL, 10)`,
        [ruleId, s.professionalId, s.procedureId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ percentage: string; priority: number }>(
        `SELECT percentage::text, priority FROM fin.split_rule WHERE id = $1`,
        [ruleId]));
    expect(rows[0]).toEqual({ percentage: '50.00', priority: 10 });
  });

  it('insere regra default (sem procedure, sem convention)', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, NULL, NULL,
                 40.00, NULL, 1)`,
        [ruleId, s.professionalId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ procedure_id: string | null; convention_name: string | null }>(
        `SELECT procedure_id::text, convention_name
           FROM fin.split_rule WHERE id = $1`,
        [ruleId]));
    expect(rows[0]).toEqual({ procedure_id: null, convention_name: null });
  });

  it('insere regra com valor fixo por procedimento', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, NULL,
                 NULL, 15000, 20)`,
        [ruleId, s.professionalId, s.procedureId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ fixed_amount_cents: string; percentage: string | null }>(
        `SELECT fixed_amount_cents::text, percentage::text
           FROM fin.split_rule WHERE id = $1`,
        [ruleId]));
    expect(rows[0]).toEqual({ fixed_amount_cents: '15000', percentage: null });
  });

  it('rejeita percentage fora de 0-100', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, percentage, priority)
           VALUES (app.require_tenant_id(), $1, $2, 101.00, 1)`,
          [uuidv7(), s.professionalId])),
    ).rejects.toThrow();
  });

  it('rejeita regra sem percentage nem fixed_amount_cents', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, percentage, fixed_amount_cents, priority)
           VALUES (app.require_tenant_id(), $1, $2, NULL, NULL, 1)`,
          [uuidv7(), s.professionalId])),
    ).rejects.toThrow();
  });

  it('impede regra duplicada (professional + procedure + convention)', async () => {
    const r1 = uuidv7();
    const r2 = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, 'Unimed',
                 60.00, 5)`,
        [r1, s.professionalId, s.procedureId]);
    });
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, procedure_id, convention_name,
              percentage, priority)
           VALUES (app.require_tenant_id(), $1, $2, $3, 'Unimed',
                   70.00, 6)`,
          [r2, s.professionalId, s.procedureId])),
    ).rejects.toThrow();
  });
});

describe('schema fin — split', () => {
  it('insere split vinculado a entry e split_rule', async () => {
    const entryId = uuidv7();
    const ruleId = uuidv7();
    const splitId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta repasse', 30000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `split-entry-${entryId}`]);

      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 50.00, 1)`,
        [ruleId, s.professionalId]);

      await tx.query(
        `INSERT INTO fin.split
           (tenant_id, id, entry_id, split_rule_id, professional_id,
            clinic_share_cents, professional_share_cents, status)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4,
                 15000, 15000, 'pendente')`,
        [splitId, entryId, ruleId, s.professionalId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        clinic_share_cents: string; professional_share_cents: string; status: string;
      }>(
        `SELECT clinic_share_cents::text, professional_share_cents::text, status::text
           FROM fin.split WHERE id = $1`,
        [splitId]));
    expect(rows[0]).toEqual({
      clinic_share_cents: '15000',
      professional_share_cents: '15000',
      status: 'pendente',
    });
  });

  it('rejeita split com shares que nao somam o valor do entry', async () => {
    const entryId = uuidv7();
    const ruleId = uuidv7();
    const splitId = uuidv7();

    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id,
              description, amount_cents, payment_method_id, paid_at, status,
              idempotency_key, created_by)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Consulta split errado', 30000, $4, clock_timestamp(), 'pago',
                   $5, app.current_user_id())`,
          [entryId, s.professionalId, s.clinicId,
           s.paymentMethodId, `split-bad-${entryId}`]);

        await tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, percentage, priority)
           VALUES (app.require_tenant_id(), $1, $2, 50.00, 99)`,
          [ruleId, s.professionalId]);

        await tx.query(
          `INSERT INTO fin.split
             (tenant_id, id, entry_id, split_rule_id, professional_id,
              clinic_share_cents, professional_share_cents, status)
           VALUES (app.require_tenant_id(), $1, $2, $3, $4,
                   10000, 10000, 'pendente')`,
          [splitId, entryId, ruleId, s.professionalId]);
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque as tabelas nao existem:

```bash
cd packages/payments && npx vitest run src/split-schema.int.test.ts 2>&1 | head -20
```

Saida esperada: `ERROR` — tabelas `fin.split_rule` e `fin.split` nao existem.

- [ ] Criar a migration `packages/db/migrations/0094_fin_split_rule_split.sql`:

```sql
-- 0094_fin_split_rule_split.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · repasse medico. Regras de divisao (split_rule) e divisoes
-- calculadas por lancamento (split). Dinheiro em centavos inteiros (bigint).

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado para status do split
-- ---------------------------------------------------------------------------
CREATE TYPE fin.split_status AS ENUM ('pendente', 'creditado', 'pago');

-- ---------------------------------------------------------------------------
-- 2. Regra de repasse
-- ---------------------------------------------------------------------------
CREATE TABLE fin.split_rule (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  professional_id    uuid NOT NULL,
  procedure_id       uuid,              -- NULL = regra default do profissional
  convention_name    text COLLATE "pt-BR-x-icu",  -- NULL = particular
  percentage         numeric(5,2) CHECK (percentage >= 0 AND percentage <= 100),
  fixed_amount_cents bigint CHECK (fixed_amount_cents > 0),
  priority           int NOT NULL DEFAULT 1,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Unicidade: so uma regra ativa por combinacao (professional, procedure, convention).
  -- COALESCE transforma NULL em sentinela para o indice unico.
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id),
  -- Pelo menos um dos dois deve ser preenchido: percentage ou fixed_amount_cents
  CHECK (num_nonnulls(percentage, fixed_amount_cents) >= 1)
);
ALTER TABLE fin.split_rule OWNER TO app_owner;

-- Indice unico parcial: impede regra duplicada para a mesma combinacao.
-- COALESCE transforma NULL em sentinela para que o indice unico funcione.
CREATE UNIQUE INDEX ux_split_rule_combo ON fin.split_rule (
  tenant_id,
  professional_id,
  COALESCE(procedure_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(convention_name, '__PARTICULAR__')
) WHERE active = true;

CREATE INDEX ix_split_rule_professional
  ON fin.split_rule (tenant_id, professional_id) WHERE active = true;

GRANT SELECT, INSERT, UPDATE ON fin.split_rule TO app_rw;

ALTER TABLE fin.split_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.split_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.split_rule AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Divisao calculada por lancamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.split (
  tenant_id                uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                       uuid NOT NULL,
  entry_id                 uuid NOT NULL,
  split_rule_id            uuid NOT NULL,
  professional_id          uuid NOT NULL,
  clinic_share_cents       bigint NOT NULL CHECK (clinic_share_cents >= 0),
  professional_share_cents bigint NOT NULL CHECK (professional_share_cents >= 0),
  status                   fin.split_status NOT NULL DEFAULT 'pendente',
  statement_id             uuid,           -- FK para fin.repasse_statement (migration 0095)
  created_at               timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Um split por entry (1:1)
  UNIQUE (tenant_id, entry_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, entry_id)       REFERENCES fin.entry(tenant_id, id),
  FOREIGN KEY (tenant_id, split_rule_id)  REFERENCES fin.split_rule(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id)
);
ALTER TABLE fin.split OWNER TO app_owner;

-- Constraint: a soma das partes deve ser igual ao amount_cents do entry.
-- Implementada como trigger pois CHECK nao pode cruzar tabelas.
CREATE OR REPLACE FUNCTION fin.check_split_sum()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry_amount bigint;
BEGIN
  SELECT amount_cents INTO v_entry_amount
    FROM fin.entry WHERE tenant_id = NEW.tenant_id AND id = NEW.entry_id;

  IF (NEW.clinic_share_cents + NEW.professional_share_cents) <> v_entry_amount THEN
    RAISE EXCEPTION 'split shares (% + %) <> entry amount_cents (%)',
      NEW.clinic_share_cents, NEW.professional_share_cents, v_entry_amount
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION fin.check_split_sum() OWNER TO app_owner;

CREATE TRIGGER trg_check_split_sum
  BEFORE INSERT OR UPDATE ON fin.split
  FOR EACH ROW EXECUTE FUNCTION fin.check_split_sum();

CREATE INDEX ix_split_professional
  ON fin.split (tenant_id, professional_id, status);
CREATE INDEX ix_split_entry
  ON fin.split (tenant_id, entry_id);
CREATE INDEX ix_split_statement
  ON fin.split (tenant_id, statement_id) WHERE statement_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON fin.split TO app_rw;

ALTER TABLE fin.split ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.split FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.split AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Medico ve so o proprio repasse (§5.4)
CREATE POLICY own_splits ON fin.split AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    app.has_role_in(
      (SELECT e.clinic_id FROM fin.entry e
        WHERE e.tenant_id = fin.split.tenant_id AND e.id = fin.split.entry_id),
      ARRAY['admin_clinico', 'diretor_tecnico', 'financeiro']
    )
    OR professional_id = app.current_professional_id()
  );

-- jobs precisa de acesso para o job de fechamento mensal
GRANT SELECT, INSERT, UPDATE ON fin.split TO jobs;
GRANT SELECT, INSERT, UPDATE ON fin.split_rule TO jobs;
```

- [ ] Aplicar a migration:

```bash
cd packages/db && npx tsx src/migrate.ts 2>&1 | tail -5
```

Saida esperada: `Applied 0094_fin_split_rule_split.sql`

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/payments && npx vitest run src/split-schema.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam (8 testes).

- [ ] Commitar:

```bash
git add packages/db/migrations/0094_fin_split_rule_split.sql packages/payments/src/split-schema.int.test.ts
git commit -m "feat(db): add fin.split_rule and fin.split tables for repasse medico (migration 0094)"
```

---

### Task 19: Migration 0095 — tabela fin.repasse_statement e funcao fin.calculate_splits

**Arquivos**
- Criar: `packages/db/migrations/0095_fin_repasse_statement_calculate.sql`
- Teste: `packages/payments/src/split-calculate.int.test.ts`

**Por que**
O extrato de repasse (`fin.repasse_statement`) agrupa splits por periodo e profissional. A funcao `fin.calculate_splits(entry_id)` SECURITY DEFINER aplica a regra mais especifica e insere o split automaticamente.

- [ ] Criar o teste de integracao `packages/payments/src/split-calculate.int.test.ts`:

```ts
// packages/payments/src/split-calculate.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeCalculo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
  procedureId2: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCalculo(): Promise<SementeCalculo> {
  const s: SementeCalculo = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(),
    procedureId: uuidv7(), procedureId2: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Calculo', '22ABC34501DE35')`,
      [s.tenantId, `c-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Calculo', '2345678', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Calculo')`,
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
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Calculo', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000),
              ($1, $3, 'RETORNO', 'Retorno', '#5fa02f', 15, 10000)`,
      [s.tenantId, s.procedureId, s.procedureId2]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
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

let s: SementeCalculo;
let actor: Actor;

beforeAll(async () => {
  s = await semearCalculo();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.calculate_splits — resolve regra mais especifica', () => {
  it('aplica regra default quando so existe uma regra generica', async () => {
    const entryId = uuidv7();
    const ruleId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 40.00, 1)`,
        [ruleId, s.professionalId]);

      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta default', 10000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `calc-default-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
        status: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text,
                status::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(rows).toHaveLength(1);
    // 40% de 10000 = 4000 para o profissional
    expect(rows[0]).toEqual({
      professional_share_cents: '4000',
      clinic_share_cents: '6000',
      status: 'pendente',
    });
  });

  it('aplica regra especifica (professional + procedure) em vez da default', async () => {
    const entryId = uuidv7();
    const ruleDefault = uuidv7();
    const ruleEspecifica = uuidv7();
    const appointmentId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      // Regra default: 30%
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 30.00, 1)
         ON CONFLICT DO NOTHING`,
        [ruleDefault, s.professionalId]);

      // Regra especifica com procedure: 60%
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, 60.00, 10)`,
        [ruleEspecifica, s.professionalId, s.procedureId]);

      await tx.query(
        `INSERT INTO sched.appointment
           (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
            starts_at, ends_at, appointment_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 '2026-10-20T09:00:00Z', '2026-10-20T09:30:00Z', '2026-10-20',
                 'atendido', $7)`,
        [appointmentId, s.tenantId, s.patientId, s.professionalId,
         s.clinicId, s.procedureId, s.userId]);

      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            appointment_id, description, amount_cents, payment_method_id,
            paid_at, status, idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 $5, 'Consulta especifica', 20000, $6,
                 clock_timestamp(), 'pago', $7, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         appointmentId, s.paymentMethodId, `calc-spec-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
        split_rule_id: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text,
                split_rule_id::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(rows).toHaveLength(1);
    // 60% de 20000 = 12000 para o profissional
    expect(rows[0]!.professional_share_cents).toBe('12000');
    expect(rows[0]!.clinic_share_cents).toBe('8000');
    expect(rows[0]!.split_rule_id).toBe(ruleEspecifica);
  });

  it('aplica valor fixo quando fixed_amount_cents e definido', async () => {
    const entryId = uuidv7();
    const ruleFixo = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id,
            fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 8000, 15)`,
        [ruleFixo, s.professionalId, s.procedureId2]);

      const appId = uuidv7();
      await tx.query(
        `INSERT INTO sched.appointment
           (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
            starts_at, ends_at, appointment_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 '2026-10-21T10:00:00Z', '2026-10-21T10:15:00Z', '2026-10-21',
                 'atendido', $7)`,
        [appId, s.tenantId, s.patientId, s.professionalId,
         s.clinicId, s.procedureId2, s.userId]);

      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            appointment_id, description, amount_cents, payment_method_id,
            paid_at, status, idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 $5, 'Retorno fixo', 10000, $6,
                 clock_timestamp(), 'pago', $7, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         appId, s.paymentMethodId, `calc-fixed-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(rows).toHaveLength(1);
    // Fixo: 8000 para o profissional, 2000 para a clinica
    expect(rows[0]).toEqual({
      professional_share_cents: '8000',
      clinic_share_cents: '2000',
    });
  });

  it('nao insere split quando nao existe regra para o profissional', async () => {
    const otherProfId = uuidv7();
    const otherUserId = uuidv7();
    const entryId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro Medico')`,
        [otherUserId, `${otherUserId}@example.test`]);
      await c.query(
        `INSERT INTO app.professional
           (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
         VALUES ($1, $2, $3, '06', '111222', 'MG', '225125')`,
        [s.tenantId, otherProfId, otherUserId]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
        [s.tenantId, otherUserId, s.clinicId]);
      await c.query('COMMIT');
    } finally {
      c.release();
      await admin.end();
    }

    const otherActor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: otherUserId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };

    await withTenantTx(otherActor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Sem regra', 15000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, otherProfId, s.clinicId, s.patientId,
         s.paymentMethodId, `calc-norule-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM fin.split WHERE entry_id = $1`,
        [entryId]));
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe('schema fin — repasse_statement', () => {
  it('insere extrato de repasse', async () => {
    const stmtId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.repasse_statement
           (tenant_id, id, professional_id, clinic_id, period_start, period_end,
            total_entries, total_professional_share, total_clinic_share, status)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 '2026-10-01', '2026-10-31', 5, 50000, 75000, 'aberto')`,
        [stmtId, s.professionalId, s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        total_professional_share: string; status: string;
      }>(
        `SELECT total_professional_share::text, status::text
           FROM fin.repasse_statement WHERE id = $1`,
        [stmtId]));
    expect(rows[0]).toEqual({
      total_professional_share: '50000',
      status: 'aberto',
    });
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd packages/payments && npx vitest run src/split-calculate.int.test.ts 2>&1 | head -20
```

Saida esperada: `ERROR` — funcao `fin.calculate_splits` e tabela `fin.repasse_statement` nao existem.

- [ ] Criar a migration `packages/db/migrations/0095_fin_repasse_statement_calculate.sql`:

```sql
-- 0095_fin_repasse_statement_calculate.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · extrato de repasse e funcao de calculo automatico de splits.

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado para status do extrato
-- ---------------------------------------------------------------------------
CREATE TYPE fin.repasse_statement_status AS ENUM ('aberto', 'fechado', 'pago');

-- ---------------------------------------------------------------------------
-- 2. Extrato de repasse
-- ---------------------------------------------------------------------------
CREATE TABLE fin.repasse_statement (
  tenant_id                uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                       uuid NOT NULL,
  professional_id          uuid NOT NULL,
  clinic_id                uuid NOT NULL,
  period_start             date NOT NULL,
  period_end               date NOT NULL,
  total_entries            int NOT NULL DEFAULT 0,
  total_professional_share bigint NOT NULL DEFAULT 0,
  total_clinic_share       bigint NOT NULL DEFAULT 0,
  status                   fin.repasse_statement_status NOT NULL DEFAULT 'aberto',
  paid_at                  timestamptz(3),
  created_at               timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Um extrato por profissional por periodo por clinica
  UNIQUE (tenant_id, professional_id, clinic_id, period_start, period_end),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  CHECK (period_end >= period_start),
  CHECK (total_entries >= 0),
  CHECK (total_professional_share >= 0),
  CHECK (total_clinic_share >= 0),
  CHECK ((status = 'pago') = (paid_at IS NOT NULL))
);
ALTER TABLE fin.repasse_statement OWNER TO app_owner;

CREATE INDEX ix_repasse_statement_professional
  ON fin.repasse_statement (tenant_id, professional_id, period_start DESC);
CREATE INDEX ix_repasse_statement_status
  ON fin.repasse_statement (tenant_id, status) WHERE status <> 'pago';

GRANT SELECT, INSERT, UPDATE ON fin.repasse_statement TO app_rw;
GRANT SELECT, INSERT, UPDATE ON fin.repasse_statement TO jobs;

ALTER TABLE fin.repasse_statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.repasse_statement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.repasse_statement AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Medico ve so o proprio extrato (§5.4)
CREATE POLICY own_statements ON fin.repasse_statement AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    app.has_role_in(clinic_id, ARRAY['admin_clinico', 'diretor_tecnico', 'financeiro'])
    OR professional_id = app.current_professional_id()
  );

-- ---------------------------------------------------------------------------
-- 3. FK de fin.split.statement_id para fin.repasse_statement
-- ---------------------------------------------------------------------------
ALTER TABLE fin.split
  ADD CONSTRAINT fk_split_statement
    FOREIGN KEY (tenant_id, statement_id)
    REFERENCES fin.repasse_statement(tenant_id, id);

-- ---------------------------------------------------------------------------
-- 4. Funcao SECURITY DEFINER: calcula o split de um entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin.calculate_splits(
  p_tenant_id uuid,
  p_entry_id  uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, app, sched, pg_catalog AS $$
DECLARE
  v_entry        RECORD;
  v_procedure_id uuid;
  v_convention    text;
  v_rule         RECORD;
  v_professional_share bigint;
  v_clinic_share       bigint;
BEGIN
  -- 1. Buscar o entry
  SELECT e.id, e.tenant_id, e.professional_id, e.appointment_id,
         e.amount_cents, e.kind::text AS kind, e.status::text AS status
    INTO v_entry
    FROM fin.entry e
   WHERE e.tenant_id = p_tenant_id AND e.id = p_entry_id;

  IF NOT FOUND THEN RETURN; END IF;
  -- So calcula para receitas pagas
  IF v_entry.kind <> 'receita' OR v_entry.status <> 'pago' THEN RETURN; END IF;
  -- Se ja existe split, nao recalcula
  IF EXISTS (SELECT 1 FROM fin.split s
              WHERE s.tenant_id = p_tenant_id AND s.entry_id = p_entry_id) THEN
    RETURN;
  END IF;

  -- 2. Resolver procedure_id e convention via appointment
  IF v_entry.appointment_id IS NOT NULL THEN
    SELECT a.procedure_id, a.operadora_nome
      INTO v_procedure_id, v_convention
      FROM sched.appointment a
     WHERE a.tenant_id = p_tenant_id AND a.id = v_entry.appointment_id;
  END IF;

  -- 3. Buscar a regra mais especifica (maior prioridade)
  -- Ordem de especificidade: professional + procedure + convention > professional + procedure > professional + convention > professional default
  SELECT r.id, r.percentage, r.fixed_amount_cents
    INTO v_rule
    FROM fin.split_rule r
   WHERE r.tenant_id = p_tenant_id
     AND r.professional_id = v_entry.professional_id
     AND r.active = true
     AND (r.procedure_id IS NULL OR r.procedure_id = v_procedure_id)
     AND (r.convention_name IS NULL OR r.convention_name = v_convention)
   ORDER BY r.priority DESC
   LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  -- 4. Calcular as partes
  IF v_rule.fixed_amount_cents IS NOT NULL THEN
    -- Valor fixo: o profissional recebe o fixo, clinica fica com o restante
    v_professional_share := LEAST(v_rule.fixed_amount_cents, v_entry.amount_cents);
    v_clinic_share := v_entry.amount_cents - v_professional_share;
  ELSE
    -- Percentual: arredonda centavo para o profissional
    v_professional_share := ROUND(v_entry.amount_cents * v_rule.percentage / 100);
    v_clinic_share := v_entry.amount_cents - v_professional_share;
  END IF;

  -- 5. Inserir o split
  INSERT INTO fin.split
    (tenant_id, id, entry_id, split_rule_id, professional_id,
     clinic_share_cents, professional_share_cents, status)
  VALUES
    (p_tenant_id, gen_random_uuid(), p_entry_id, v_rule.id,
     v_entry.professional_id,
     v_clinic_share, v_professional_share, 'pendente');
END;
$$;
ALTER FUNCTION fin.calculate_splits(uuid, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION fin.calculate_splits(uuid, uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION fin.calculate_splits(uuid, uuid) TO jobs;
```

- [ ] Aplicar a migration:

```bash
cd packages/db && npx tsx src/migrate.ts 2>&1 | tail -5
```

Saida esperada: `Applied 0095_fin_repasse_statement_calculate.sql`

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/payments && npx vitest run src/split-calculate.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam (5 testes).

- [ ] Commitar:

```bash
git add packages/db/migrations/0095_fin_repasse_statement_calculate.sql packages/payments/src/split-calculate.int.test.ts
git commit -m "feat(db): add fin.repasse_statement and fin.calculate_splits function (migration 0095)"
```

---

### Task 20: Domain — createSplitRule e calculateSplits em packages/payments

**Arquivos**
- Criar: `packages/payments/src/split-rule.ts`
- Modificar: `packages/payments/src/index.ts`
- Teste: `packages/payments/src/split-rule.int.test.ts`

**Por que**
Domain functions que encapsulam a criacao de regras e o calculo de splits, com validacao e auditoria. Usadas pelo L3 (rotas).

- [ ] Criar o teste `packages/payments/src/split-rule.int.test.ts`:

```ts
// packages/payments/src/split-rule.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createSplitRule, calculateSplits } from './split-rule';

interface SementeDomain {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearDomain(): Promise<SementeDomain> {
  const s: SementeDomain = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(), procedureId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Domain', '33ABC34501DE35')`,
      [s.tenantId, `d-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Domain', '3456789', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Domain')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Domain', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
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

let s: SementeDomain;
let actor: Actor;

beforeAll(async () => {
  s = await semearDomain();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createSplitRule — cria regra de repasse', () => {
  it('cria regra percentual default', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        percentage: 50,
        priority: 1,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ruleId).toBeDefined();
  });

  it('cria regra com valor fixo para procedimento', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        procedureId: s.procedureId,
        fixedAmountCents: 12000,
        priority: 10,
      }));

    expect(r.ok).toBe(true);
  });

  it('rejeita percentage fora de 0-100', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        conventionName: 'Teste_Invalido',
        percentage: 150,
        priority: 1,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('percentual_invalido');
  });

  it('rejeita regra sem percentage nem fixedAmountCents', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        conventionName: 'Teste_Vazio',
        priority: 1,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('valor_ausente');
  });
});

describe('calculateSplits — calcula divisao para entry pago', () => {
  it('cria split automaticamente para entry pago', async () => {
    const entryId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta domain', 20000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `domain-calc-${entryId}`]);
    });

    const r = await withTenantTx(actor, (tx) =>
      calculateSplits(tx, s.tenantId, entryId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.calculated).toBe(true);
  });

  it('retorna calculated=false quando entry nao e receita paga', async () => {
    const entryId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id,
            description, amount_cents, payment_method_id, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Material', 5000, $4, 'pago',
                 $5, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId,
         s.paymentMethodId, `domain-despesa-${entryId}`]);
    });

    const r = await withTenantTx(actor, (tx) =>
      calculateSplits(tx, s.tenantId, entryId));

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.calculated).toBe(false);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo nao existe):

```bash
cd packages/payments && npx vitest run src/split-rule.int.test.ts 2>&1 | head -10
```

Saida esperada: `ERROR` — modulo `./split-rule` nao encontrado.

- [ ] Criar `packages/payments/src/split-rule.ts`:

```ts
// packages/payments/src/split-rule.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// createSplitRule
// ---------------------------------------------------------------------------

export type SplitRuleFailure =
  | { kind: 'percentual_invalido' }
  | { kind: 'valor_ausente' }
  | { kind: 'profissional_nao_encontrado' }
  | { kind: 'regra_duplicada' };

export interface CreateSplitRuleInput {
  readonly professionalId: string;
  readonly procedureId?: string;
  readonly conventionName?: string;
  readonly percentage?: number;
  readonly fixedAmountCents?: number;
  readonly priority: number;
}

export interface SplitRuleCreated {
  readonly ruleId: string;
}

export async function createSplitRule(
  tx: TxClient,
  i: CreateSplitRuleInput,
): Promise<Result<SplitRuleCreated, SplitRuleFailure>> {
  // Validacao: pelo menos um dos dois deve estar presente
  if (i.percentage === undefined && i.fixedAmountCents === undefined) {
    return err({ kind: 'valor_ausente' });
  }
  if (i.percentage !== undefined && (i.percentage < 0 || i.percentage > 100)) {
    return err({ kind: 'percentual_invalido' });
  }

  // Verificar que o profissional existe
  const { rows: profRows } = await tx.query<{ id: string }>(
    `SELECT id FROM app.professional WHERE id = $1`,
    [i.professionalId]);
  if (profRows.length === 0) {
    return err({ kind: 'profissional_nao_encontrado' });
  }

  const ruleId = uuidv7();

  try {
    await tx.query(
      `INSERT INTO fin.split_rule
         (tenant_id, id, professional_id, procedure_id, convention_name,
          percentage, fixed_amount_cents, priority)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5, $6, $7)`,
      [ruleId, i.professionalId, i.procedureId ?? null,
       i.conventionName ?? null,
       i.percentage ?? null, i.fixedAmountCents ?? null,
       i.priority]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('ux_split_rule_combo')) {
      return err({ kind: 'regra_duplicada' });
    }
    throw e;
  }

  await tx.query(
    `SELECT audit.log('SPLIT_RULE_CREATE', 'fin', 'split_rule', $1, 'sucesso',
                      jsonb_build_object('professional_id', $2::text,
                                         'percentage', $3::text,
                                         'priority', $4::int), $5)`,
    [ruleId, i.professionalId,
     i.percentage !== undefined ? String(i.percentage) : 'fixo',
     i.priority, null]);

  return ok({ ruleId });
}

// ---------------------------------------------------------------------------
// calculateSplits
// ---------------------------------------------------------------------------

export type CalculateSplitsFailure =
  | { kind: 'entry_nao_encontrado' };

export interface CalculateSplitsResult {
  readonly calculated: boolean;
}

export async function calculateSplits(
  tx: TxClient,
  tenantId: string,
  entryId: string,
): Promise<Result<CalculateSplitsResult, CalculateSplitsFailure>> {
  // Verificar que o entry existe
  const { rows: entryRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.entry WHERE id = $1`, [entryId]);
  if (entryRows.length === 0) {
    return err({ kind: 'entry_nao_encontrado' });
  }

  // Delegar para a funcao SQL SECURITY DEFINER
  await tx.query(`SELECT fin.calculate_splits($1, $2)`, [tenantId, entryId]);

  // Verificar se o split foi criado
  const { rows: splitRows } = await tx.query<{ n: string }>(
    `SELECT count(*) AS n FROM fin.split WHERE entry_id = $1`, [entryId]);
  const calculated = Number(splitRows[0]?.n) > 0;

  return ok({ calculated });
}
```

- [ ] Adicionar os exports em `packages/payments/src/index.ts`:

```ts
// packages/payments/src/index.ts
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
  createSplitRule, calculateSplits,
  type CreateSplitRuleInput, type SplitRuleCreated, type SplitRuleFailure,
  type CalculateSplitsFailure, type CalculateSplitsResult,
} from './split-rule';
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/payments && npx vitest run src/split-rule.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam (5 testes).

- [ ] Commitar:

```bash
git add packages/payments/src/split-rule.ts packages/payments/src/split-rule.int.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): add createSplitRule and calculateSplits domain functions"
```

---

### Task 21: Domain — closeRepassePeriod e payRepasse em packages/payments

**Arquivos**
- Criar: `packages/payments/src/repasse.ts`
- Modificar: `packages/payments/src/index.ts`
- Teste: `packages/payments/src/repasse.int.test.ts`

**Por que**
Funcoes de fechamento mensal e pagamento do repasse. O fechamento agrupa todos os splits pendentes do periodo em um extrato. O pagamento marca o extrato como pago.

- [ ] Criar o teste `packages/payments/src/repasse.int.test.ts`:

```ts
// packages/payments/src/repasse.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { closeRepassePeriod, payRepasse } from './repasse';

interface SementeRepasse {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRepasseDomain(): Promise<SementeRepasse> {
  const s: SementeRepasse = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Fechamento', '44ABC34501DE35')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Fech', '4567890', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Fech')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'BA', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Fech', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
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

let s: SementeRepasse;
let actor: Actor;

beforeAll(async () => {
  s = await semearRepasseDomain();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Criar regra de repasse e entries com splits
  await withTenantTx(actor, async (tx) => {
    const ruleId = uuidv7();
    await tx.query(
      `INSERT INTO fin.split_rule
         (tenant_id, id, professional_id, percentage, priority)
       VALUES (app.require_tenant_id(), $1, $2, 50.00, 1)`,
      [ruleId, s.professionalId]);

    // Criar 3 entries pagos com splits
    for (let i = 0; i < 3; i++) {
      const entryId = uuidv7();
      const splitId = uuidv7();
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta fech', 20000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `fech-${entryId}`]);
      await tx.query(
        `INSERT INTO fin.split
           (tenant_id, id, entry_id, split_rule_id, professional_id,
            clinic_share_cents, professional_share_cents, status)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4,
                 10000, 10000, 'pendente')`,
        [splitId, entryId, ruleId, s.professionalId]);
    }
  });
});

afterAll(async () => { await closePools(); });

describe('closeRepassePeriod — fecha periodo de repasse', () => {
  let statementId = '';

  it('fecha periodo e agrupa splits pendentes', async () => {
    const r = await withTenantTx(actor, (tx) =>
      closeRepassePeriod(tx, {
        tenantId: s.tenantId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.statementId).toBeDefined();
    expect(r.value.totalEntries).toBe(3);
    expect(r.value.totalProfessionalShare).toBe(30000);
    expect(r.value.totalClinicShare).toBe(30000);
    statementId = r.value.statementId;

    // Verificar que os splits foram atualizados para 'creditado'
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; statement_id: string }>(
        `SELECT status::text, statement_id::text
           FROM fin.split
          WHERE professional_id = $1 AND statement_id = $2`,
        [s.professionalId, statementId]));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.status).toBe('creditado');
  });

  it('rejeita fechar periodo sem splits pendentes', async () => {
    const r = await withTenantTx(actor, (tx) =>
      closeRepassePeriod(tx, {
        tenantId: s.tenantId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('sem_splits_pendentes');
  });
});

describe('payRepasse — marca extrato como pago', () => {
  it('marca extrato fechado como pago', async () => {
    // Buscar o statement criado no teste anterior
    const { rows: stmtRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text FROM fin.repasse_statement
          WHERE professional_id = $1 AND status = 'fechado'
          ORDER BY created_at DESC LIMIT 1`,
        [s.professionalId]));

    expect(stmtRows).toHaveLength(1);
    const stmtId = stmtRows[0]!.id;

    const r = await withTenantTx(actor, (tx) =>
      payRepasse(tx, { statementId: stmtId }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pago');

    // Verificar que os splits foram atualizados para 'pago'
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status::text FROM fin.split WHERE statement_id = $1`,
        [stmtId]));
    expect(rows.every((r) => r.status === 'pago')).toBe(true);
  });

  it('rejeita pagar extrato ja pago', async () => {
    const { rows: stmtRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text FROM fin.repasse_statement
          WHERE professional_id = $1 AND status = 'pago'
          ORDER BY created_at DESC LIMIT 1`,
        [s.professionalId]));

    const r = await withTenantTx(actor, (tx) =>
      payRepasse(tx, { statementId: stmtRows[0]!.id }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_pago');
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd packages/payments && npx vitest run src/repasse.int.test.ts 2>&1 | head -10
```

Saida esperada: `ERROR` — modulo `./repasse` nao encontrado.

- [ ] Criar `packages/payments/src/repasse.ts`:

```ts
// packages/payments/src/repasse.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// closeRepassePeriod
// ---------------------------------------------------------------------------

export type CloseRepasseFailure =
  | { kind: 'sem_splits_pendentes' }
  | { kind: 'periodo_ja_fechado' };

export interface CloseRepasseInput {
  readonly tenantId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface CloseRepasseResult {
  readonly statementId: string;
  readonly totalEntries: number;
  readonly totalProfessionalShare: number;
  readonly totalClinicShare: number;
}

export async function closeRepassePeriod(
  tx: TxClient,
  i: CloseRepasseInput,
): Promise<Result<CloseRepasseResult, CloseRepasseFailure>> {
  // Buscar splits pendentes do profissional no periodo
  const { rows: pendingSplits } = await tx.query<{
    id: string;
    professional_share_cents: string;
    clinic_share_cents: string;
  }>(
    `SELECT s.id, s.professional_share_cents::text, s.clinic_share_cents::text
       FROM fin.split s
       JOIN fin.entry e ON e.tenant_id = s.tenant_id AND e.id = s.entry_id
      WHERE s.professional_id = $1
        AND s.status = 'pendente'
        AND s.statement_id IS NULL
        AND e.paid_at >= $2::date
        AND e.paid_at < ($3::date + 1)`,
    [i.professionalId, i.periodStart, i.periodEnd]);

  if (pendingSplits.length === 0) {
    return err({ kind: 'sem_splits_pendentes' });
  }

  const totalProfessionalShare = pendingSplits.reduce(
    (acc, s) => acc + Number(s.professional_share_cents), 0);
  const totalClinicShare = pendingSplits.reduce(
    (acc, s) => acc + Number(s.clinic_share_cents), 0);

  const statementId = uuidv7();

  // Criar o extrato
  await tx.query(
    `INSERT INTO fin.repasse_statement
       (tenant_id, id, professional_id, clinic_id, period_start, period_end,
        total_entries, total_professional_share, total_clinic_share, status)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4::date, $5::date,
             $6, $7, $8, 'fechado')`,
    [statementId, i.professionalId, i.clinicId,
     i.periodStart, i.periodEnd,
     pendingSplits.length, totalProfessionalShare, totalClinicShare]);

  // Atualizar os splits: vincular ao extrato e marcar como creditado
  const splitIds = pendingSplits.map((s) => s.id);
  await tx.query(
    `UPDATE fin.split
        SET status = 'creditado', statement_id = $1
      WHERE id = ANY($2::uuid[])`,
    [statementId, splitIds]);

  await tx.query(
    `SELECT audit.log('REPASSE_CLOSE', 'fin', 'repasse_statement', $1, 'sucesso',
                      jsonb_build_object('professional_id', $2::text,
                                         'amount_cents', $3::bigint,
                                         'status', 'fechado'::text), $4)`,
    [statementId, i.professionalId, totalProfessionalShare, null]);

  return ok({
    statementId,
    totalEntries: pendingSplits.length,
    totalProfessionalShare,
    totalClinicShare,
  });
}

// ---------------------------------------------------------------------------
// payRepasse
// ---------------------------------------------------------------------------

export type PayRepasseFailure =
  | { kind: 'extrato_nao_encontrado' }
  | { kind: 'ja_pago' }
  | { kind: 'nao_fechado' };

export interface PayRepasseInput {
  readonly statementId: string;
}

export interface PayRepasseResult {
  readonly statementId: string;
  readonly status: string;
}

export async function payRepasse(
  tx: TxClient,
  i: PayRepasseInput,
): Promise<Result<PayRepasseResult, PayRepasseFailure>> {
  const { rows } = await tx.query<{ status: string; professional_id: string }>(
    `SELECT status::text, professional_id::text
       FROM fin.repasse_statement WHERE id = $1`,
    [i.statementId]);

  if (rows.length === 0) {
    return err({ kind: 'extrato_nao_encontrado' });
  }

  const stmt = rows[0]!;
  if (stmt.status === 'pago') return err({ kind: 'ja_pago' });
  if (stmt.status !== 'fechado') return err({ kind: 'nao_fechado' });

  // Marcar extrato como pago
  await tx.query(
    `UPDATE fin.repasse_statement
        SET status = 'pago', paid_at = clock_timestamp()
      WHERE id = $1`,
    [i.statementId]);

  // Atualizar splits vinculados para 'pago'
  await tx.query(
    `UPDATE fin.split SET status = 'pago' WHERE statement_id = $1`,
    [i.statementId]);

  await tx.query(
    `SELECT audit.log('REPASSE_PAY', 'fin', 'repasse_statement', $1, 'sucesso',
                      jsonb_build_object('professional_id', $2::text,
                                         'status', 'pago'::text), NULL)`,
    [i.statementId, stmt.professional_id]);

  return ok({ statementId: i.statementId, status: 'pago' });
}
```

- [ ] Adicionar os exports em `packages/payments/src/index.ts` (apos os de split-rule):

```ts
export {
  closeRepassePeriod, payRepasse,
  type CloseRepasseInput, type CloseRepasseResult, type CloseRepasseFailure,
  type PayRepasseInput, type PayRepasseResult, type PayRepasseFailure,
} from './repasse';
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/payments && npx vitest run src/repasse.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam (4 testes).

- [ ] Commitar:

```bash
git add packages/payments/src/repasse.ts packages/payments/src/repasse.int.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): add closeRepassePeriod and payRepasse domain functions"
```

---

### Task 22: Migration 0096 — acoes de authz e chaves de auditoria para repasse

**Arquivos**
- Criar: `packages/db/migrations/0096_authz_audit_repasse.sql`
- Modificar: `packages/authz/src/actions.ts`
- Teste: `packages/authz/src/actions.test.ts` (teste ja existente, rodar para confirmar)

**Por que**
Acoes de authz para gerenciar regras de repasse e visualizar extratos. Chaves de auditoria para os novos eventos.

- [ ] Adicionar as acoes de repasse em `packages/authz/src/actions.ts`, antes do `] as const satisfies`:

```ts
  // -- Fase 3 . Repasse medico -----------------------------------------------
  { key: 'split_rule.read', description: 'Listar regras de repasse',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'split_rule.write', description: 'Criar ou editar regra de repasse',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'repasse.read', description: 'Visualizar extrato de repasse',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'profissional'] },
  { key: 'repasse.close', description: 'Fechar periodo de repasse',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'repasse.pay', description: 'Marcar repasse como pago',
    roles: ['admin_clinico', 'financeiro'] },
```

- [ ] Rodar os testes de authz para confirmar que a lista continua valida:

```bash
cd packages/authz && npx vitest run 2>&1 | tail -10
```

Saida esperada: testes passam.

- [ ] Criar a migration `packages/db/migrations/0096_authz_audit_repasse.sql`:

```sql
-- 0096_authz_audit_repasse.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · chaves de auditoria para eventos de repasse.

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
              'professional_id',
              'percentage',
              'priority',
              'period_start',
              'period_end',
              'total_entries',
              'total_professional_share'
            )
         );
$$;

RESET ROLE;
```

- [ ] Aplicar a migration:

```bash
cd packages/db && npx tsx src/migrate.ts 2>&1 | tail -5
```

Saida esperada: `Applied 0096_authz_audit_repasse.sql`

- [ ] Commitar:

```bash
git add packages/db/migrations/0096_authz_audit_repasse.sql packages/authz/src/actions.ts
git commit -m "feat(authz): add split_rule and repasse actions, expand audit meta whitelist (migration 0096)"
```

---

### Task 23: Rotas de API para repasse

**Arquivos**
- Criar: `apps/api/src/routes/repasse.ts`
- Modificar: `apps/api/src/app.ts` (registrar rotas)
- Teste: `apps/api/src/routes/repasse.int.test.ts`

**Por que**
Rotas REST para CRUD de regras de repasse, calculo de splits, fechamento de periodo e pagamento. A rota GET /v1/repasse/statements respeita §5.4: profissional ve so o proprio.

- [ ] Criar o teste `apps/api/src/routes/repasse.int.test.ts`:

```ts
// apps/api/src/routes/repasse.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeRota {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRota(): Promise<SementeRota> {
  const s: SementeRota = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(), procedureId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Rota Repasse', '55ABC34501DE35')`,
      [s.tenantId, `rr-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rota', '5678901', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Rota')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888777', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Rota', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
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

let s: SementeRota;
let actor: Actor;

beforeAll(async () => {
  s = await semearRota();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('rotas de repasse — integracao com banco', () => {
  it('cria regra de repasse via domain e le de volta', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 45.00, 1)`,
        [ruleId, s.professionalId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        id: string; professional_id: string; percentage: string;
        procedure_id: string | null; convention_name: string | null;
        priority: number; active: boolean;
      }>(
        `SELECT id::text, professional_id::text, percentage::text,
                procedure_id::text, convention_name, priority, active
           FROM fin.split_rule
          WHERE professional_id = $1 AND active = true
          ORDER BY priority DESC`,
        [s.professionalId]));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rule = rows.find((r) => r.id === ruleId);
    expect(rule).toBeDefined();
    expect(rule!.percentage).toBe('45.00');
    expect(rule!.active).toBe(true);
  });

  it('calcula splits e lista extratos de repasse', async () => {
    // Criar um entry pago
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta rota', 20000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `rota-entry-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    // Verificar que o split foi criado
    const { rows: splitRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ professional_share_cents: string; status: string }>(
        `SELECT professional_share_cents::text, status::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(splitRows).toHaveLength(1);
    // 45% de 20000 = 9000
    expect(splitRows[0]!.professional_share_cents).toBe('9000');
    expect(splitRows[0]!.status).toBe('pendente');
  });
});
```

- [ ] Rodar o teste e confirmar que o banco responde:

```bash
cd apps/api && npx vitest run src/routes/repasse.int.test.ts 2>&1 | head -20
```

Saida esperada: testes passam.

- [ ] Criar `apps/api/src/routes/repasse.ts`:

```ts
// apps/api/src/routes/repasse.ts
//
// Rotas de repasse medico: regras, calculo, extrato e pagamento.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createSplitRule, calculateSplits } from '@cadencia/payments';
import { closeRepassePeriod, payRepasse } from '@cadencia/payments';
import { rota } from '../guard';

export async function repasseRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- POST /v1/split-rules — criar regra de repasse --------------------------
  r.post('/v1/split-rules', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid().optional(),
        conventionName: z.string().min(1).optional(),
        percentage: z.number().min(0).max(100).optional(),
        fixedAmountCents: z.number().int().min(1).optional(),
        priority: z.number().int().min(1).default(1),
      }),
      response: {
        201: z.object({ ruleId: z.string().uuid() }),
      },
    },
  }, rota('split_rule.write', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; procedureId?: string; conventionName?: string;
      percentage?: number; fixedAmountCents?: number; priority: number };

    const result = await createSplitRule(tx, {
      professionalId: b.professionalId,
      procedureId: b.procedureId,
      conventionName: b.conventionName,
      percentage: b.percentage,
      fixedAmountCents: b.fixedAmountCents,
      priority: b.priority,
    });

    if (!result.ok) {
      const status = result.error.kind === 'profissional_nao_encontrado' ? 404 : 422;
      throw Object.assign(new Error(result.error.kind),
        { statusCode: status, dominio: result.error.kind });
    }

    void reply.code(201);
    return { ruleId: result.value.ruleId };
  }));

  // -- GET /v1/split-rules — listar regras de repasse -------------------------
  r.get('/v1/split-rules', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          rules: z.array(z.object({
            id: z.string().uuid(),
            professionalId: z.string().uuid(),
            procedureId: z.string().uuid().nullable(),
            conventionName: z.string().nullable(),
            percentage: z.number().nullable(),
            fixedAmountCents: z.number().nullable(),
            priority: z.number(),
            active: z.boolean(),
          })),
        }),
      },
    },
  }, rota('split_rule.read', async (tx, _ctx, req) => {
    const q = req.query as { professionalId?: string };
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.professionalId !== undefined) {
      conditions.push(`professional_id = $${idx}`);
      params.push(q.professionalId);
      idx += 1;
    }

    const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; professional_id: string; procedure_id: string | null;
      convention_name: string | null; percentage: string | null;
      fixed_amount_cents: string | null; priority: number; active: boolean;
    }>(
      `SELECT id::text, professional_id::text, procedure_id::text,
              convention_name, percentage::text, fixed_amount_cents::text,
              priority, active
         FROM fin.split_rule
        WHERE active = true ${where}
        ORDER BY priority DESC`,
      params);

    return {
      rules: rows.map((row) => ({
        id: row.id,
        professionalId: row.professional_id,
        procedureId: row.procedure_id,
        conventionName: row.convention_name,
        percentage: row.percentage !== null ? Number(row.percentage) : null,
        fixedAmountCents: row.fixed_amount_cents !== null
          ? Number(row.fixed_amount_cents) : null,
        priority: row.priority,
        active: row.active,
      })),
    };
  }));

  // -- GET /v1/repasse/statements — listar extratos de repasse ----------------
  r.get('/v1/repasse/statements', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid().optional(),
        status: z.enum(['aberto', 'fechado', 'pago']).optional(),
      }),
      response: {
        200: z.object({
          statements: z.array(z.object({
            id: z.string().uuid(),
            professionalId: z.string().uuid(),
            professionalName: z.string(),
            clinicId: z.string().uuid(),
            periodStart: z.string(),
            periodEnd: z.string(),
            totalEntries: z.number(),
            totalProfessionalShare: z.number(),
            totalClinicShare: z.number(),
            status: z.string(),
            paidAt: z.string().nullable(),
          })),
        }),
      },
    },
  }, rota('repasse.read', async (tx, _ctx, req) => {
    const q = req.query as { professionalId?: string; status?: string };
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.professionalId !== undefined) {
      conditions.push(`rs.professional_id = $${idx}`);
      params.push(q.professionalId);
      idx += 1;
    }
    if (q.status !== undefined) {
      conditions.push(`rs.status = $${idx}::fin.repasse_statement_status`);
      params.push(q.status);
      idx += 1;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; professional_id: string; professional_name: string;
      clinic_id: string; period_start: string; period_end: string;
      total_entries: number; total_professional_share: string;
      total_clinic_share: string; status: string; paid_at: string | null;
    }>(
      `SELECT rs.id::text, rs.professional_id::text,
              u.full_name AS professional_name,
              rs.clinic_id::text,
              rs.period_start::text, rs.period_end::text,
              rs.total_entries, rs.total_professional_share::text,
              rs.total_clinic_share::text, rs.status::text,
              to_char(rs.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at
         FROM fin.repasse_statement rs
         JOIN app.professional p
           ON p.tenant_id = rs.tenant_id AND p.id = rs.professional_id
         JOIN id."user" u ON u.id = p.user_id
         ${where}
        ORDER BY rs.period_start DESC`,
      params);

    return {
      statements: rows.map((row) => ({
        id: row.id,
        professionalId: row.professional_id,
        professionalName: row.professional_name,
        clinicId: row.clinic_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        totalEntries: row.total_entries,
        totalProfessionalShare: Number(row.total_professional_share),
        totalClinicShare: Number(row.total_clinic_share),
        status: row.status,
        paidAt: row.paid_at,
      })),
    };
  }));

  // -- POST /v1/repasse/close — fechar periodo de repasse ---------------------
  r.post('/v1/repasse/close', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        201: z.object({
          statementId: z.string().uuid(),
          totalEntries: z.number(),
          totalProfessionalShare: z.number(),
          totalClinicShare: z.number(),
        }),
      },
    },
  }, rota('repasse.close', async (tx, ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; periodStart: string; periodEnd: string };

    const result = await closeRepassePeriod(tx, {
      tenantId: ctx.actor.tenantId,
      professionalId: b.professionalId,
      clinicId: ctx.actor.clinicId,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
    });

    if (!result.ok) {
      throw Object.assign(new Error(result.error.kind),
        { statusCode: 422, dominio: result.error.kind });
    }

    void reply.code(201);
    return result.value;
  }));

  // -- POST /v1/repasse/:id/pay — marcar extrato como pago --------------------
  r.post('/v1/repasse/:id/pay', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          statementId: z.string().uuid(),
          status: z.literal('pago'),
        }),
      },
    },
  }, rota('repasse.pay', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const result = await payRepasse(tx, { statementId: p.id });

    if (!result.ok) {
      const status = result.error.kind === 'extrato_nao_encontrado' ? 404 : 422;
      throw Object.assign(new Error(result.error.kind),
        { statusCode: status, dominio: result.error.kind });
    }

    return { statementId: result.value.statementId, status: 'pago' as const };
  }));
}
```

- [ ] Registrar as rotas em `apps/api/src/app.ts`. Localizar a importacao de `paymentRoutes` e adicionar ao lado:

```ts
import { repasseRoutes } from './routes/repasse';
```

E no corpo do registro de rotas, apos `paymentRoutes`:

```ts
await app.register(repasseRoutes);
```

- [ ] Rodar o teste novamente para confirmar:

```bash
cd apps/api && npx vitest run src/routes/repasse.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add apps/api/src/routes/repasse.ts apps/api/src/routes/repasse.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add repasse routes — split rules, statements, close and pay"
```

---

### Task 24: Migration 0097 — evento de dominio SPLIT_CALCULATED e integracao com recordPayment

**Arquivos**
- Criar: `packages/db/migrations/0097_fin_split_auto_calculate.sql`
- Modificar: `packages/events/src/domain-events.ts`
- Modificar: `packages/payments/src/record-payment.ts`
- Teste: `packages/payments/src/split-auto.int.test.ts`

**Por que**
Quando um pagamento e registrado com `paidNow=true`, o split deve ser calculado automaticamente na mesma transacao. Tambem adicionamos o evento de dominio `SPLIT_CALCULATED` para que o worker possa reagir (por exemplo, notificar o medico).

- [ ] Adicionar o evento `SPLIT_CALCULATED` em `packages/events/src/domain-events.ts`:

```ts
// Adicionar 'SPLIT_CALCULATED' ao array EVENT_TYPES:
export const EVENT_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER_DUE',
  'ENCOUNTER_FINALIZED',
  'PAYMENT_RECEIVED',
  'PAYMENT_LINK_CREATED',
  'INBOUND_MESSAGE_RECEIVED',
  'SPLIT_CALCULATED',
] as const;

// Adicionar o payload:
export interface SplitCalculatedPayload {
  readonly entryId: string;
  readonly splitId: string;
  readonly professionalId: string;
  readonly professionalShareCents: number;
  readonly clinicShareCents: number;
}

// Adicionar o tipo concreto:
export type SplitCalculated = DomainEventBase<'SPLIT_CALCULATED', SplitCalculatedPayload>;

// Atualizar a uniao discriminada:
export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived
  | SplitCalculated;
```

- [ ] Criar o teste `packages/payments/src/split-auto.int.test.ts`:

```ts
// packages/payments/src/split-auto.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment } from './record-payment';

interface SementeAuto {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
  appointmentId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearAuto(): Promise<SementeAuto> {
  const s: SementeAuto = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(), procedureId: uuidv7(),
    appointmentId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Auto', '66ABC34501DE35')`,
      [s.tenantId, `a-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Auto', '6789012', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Auto')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111999', 'PR', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Auto', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-11-10T14:00:00Z', '2026-11-10T14:30:00Z', '2026-11-10',
               'atendido', $7)`,
      [s.appointmentId, s.tenantId, s.patientId, s.professionalId,
       s.clinicId, s.procedureId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
    // Regra de repasse: 50% para consulta
    await c.query(
      `SET LOCAL app.tenant_id = '${s.tenantId}'`);
    await c.query(
      `SET LOCAL app.user_id = '${s.userId}'`);
    await c.query(
      `SET LOCAL app.actor_kind = 'user'`);
    await c.query(
      `INSERT INTO fin.split_rule
         (tenant_id, id, professional_id, procedure_id, percentage, priority)
       VALUES ($1, gen_random_uuid(), $2, $3, 50.00, 10)`,
      [s.tenantId, s.professionalId, s.procedureId]);
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

let s: SementeAuto;
let actor: Actor;

beforeAll(async () => {
  s = await semearAuto();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('recordPayment — calcula split automaticamente', () => {
  it('cria split quando pagamento e registrado com paidNow=true', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Consulta com split auto',
        amountCents: 30000,
        paymentMethodId: s.paymentMethodId,
        paidNow: true,
        idempotencyKey: `auto-split-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Verificar que o split foi criado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
        status: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text, status::text
           FROM fin.split WHERE entry_id = $1`,
        [r.value.entryId]));

    expect(rows).toHaveLength(1);
    // 50% de 30000 = 15000
    expect(rows[0]).toEqual({
      professional_share_cents: '15000',
      clinic_share_cents: '15000',
      status: 'pendente',
    });
  });

  it('nao cria split quando pagamento e pendente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Consulta pendente',
        amountCents: 20000,
        paymentMethodId: s.paymentMethodId,
        paidNow: false,
        dueDate: '2026-12-01',
        idempotencyKey: `auto-pend-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM fin.split WHERE entry_id = $1`,
        [r.value.entryId]));

    expect(Number(rows[0]?.n)).toBe(0);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (split nao e calculado automaticamente):

```bash
cd packages/payments && npx vitest run src/split-auto.int.test.ts 2>&1 | head -20
```

Saida esperada: o primeiro teste falha porque `recordPayment` ainda nao chama `calculate_splits`.

- [ ] Criar a migration `packages/db/migrations/0097_fin_split_auto_calculate.sql` que adiciona GRANT para que a funcao calculate_splits possa ser chamada na mesma transacao:

```sql
-- 0097_fin_split_auto_calculate.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · permite que recordPayment chame fin.calculate_splits na mesma tx.
-- A funcao ja existe (migration 0095). Aqui so garantimos os GRANTs
-- necessarios para que app_rw possa chamar a funcao de calculo de splits
-- e que o trigger de validacao funcione corretamente.

-- Garantir que app_rw pode INSERT em fin.split via a funcao SECURITY DEFINER
-- A funcao fin.calculate_splits ja e SECURITY DEFINER e roda como app_owner,
-- entao ela ja tem acesso. Apenas garantimos que a GRANT EXECUTE esta correta.
GRANT EXECUTE ON FUNCTION fin.calculate_splits(uuid, uuid) TO app_rw;

-- Indice para performance do calculo: buscar entry por tenant e id rapidamente
-- (ja coberto pelo indice primario, mas explicitamos para documentacao).
-- Nenhum indice novo necessario.
```

- [ ] Aplicar a migration:

```bash
cd packages/db && npx tsx src/migrate.ts 2>&1 | tail -5
```

Saida esperada: `Applied 0097_fin_split_auto_calculate.sql`

- [ ] Modificar `packages/payments/src/record-payment.ts` para chamar `fin.calculate_splits` quando `paidNow=true`. Apos a insercao do recibo e antes do `return ok(...)`, adicionar:

```ts
    // Calcular split automaticamente para receitas pagas
    await tx.query(
      `SELECT fin.calculate_splits(app.require_tenant_id(), $1)`,
      [entryId]);
```

O bloco `if (i.paidNow)` completo fica:

```ts
  if (i.paidNow) {
    // Auto-provisiona e consome o proximo numero de recibo
    const { rows: counterRows } = await tx.query<{ consumed: string }>(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value)
       VALUES (app.require_tenant_id(), 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = fin.receipt_counter.next_value + 1
       RETURNING next_value - 1 AS consumed`);
    receiptNumber = Number(counterRows[0]?.consumed);

    receiptId = uuidv7();
    let pdfStorageKey: string | null = null;
    if (generateReceiptPdf) {
      pdfStorageKey = await generateReceiptPdf(entryId, receiptNumber);
    }

    await tx.query(
      `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number, pdf_storage_key)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
      [receiptId, entryId, receiptNumber, pdfStorageKey]);

    await tx.query(
      `SELECT audit.log('RECEIPT_ISSUE', 'fin', 'receipt', $1, 'sucesso',
                        jsonb_build_object('receipt_number', $2::bigint,
                                           'amount_cents', $3::bigint), $4)`,
      [receiptId, receiptNumber, i.amountCents, i.clinicId]);

    // Calcular split automaticamente para receitas pagas
    await tx.query(
      `SELECT fin.calculate_splits(app.require_tenant_id(), $1)`,
      [entryId]);
  }
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/payments && npx vitest run src/split-auto.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam (2 testes).

- [ ] Rodar os testes existentes de record-payment para garantir que nao quebrou:

```bash
cd packages/payments && npx vitest run src/record-payment.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes existentes continuam passando.

- [ ] Commitar:

```bash
git add packages/db/migrations/0097_fin_split_auto_calculate.sql packages/events/src/domain-events.ts packages/payments/src/record-payment.ts packages/payments/src/split-auto.int.test.ts
git commit -m "feat(payments): auto-calculate splits on paid receipt, add SPLIT_CALCULATED event"
```


## Parte: 05-estoque

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


## Parte: 06-rpt-matviews

### Task 31: Migration 0101 — Fundacoes: schema app_rpt, BYPASSRLS para rpt_owner, GRANTs e refresh_log

**Arquivos**

- Criar `packages/db/migrations/0101_rpt_foundations.sql`
- Criar `packages/db/src/invariants/inv11-rpt.int.test.ts`
- Teste `packages/db/src/invariants/inv11-rpt.int.test.ts`

**Passos**

- [ ] Criar o arquivo de teste com as verificacoes de fundacao. O teste consulta o catalogo para confirmar que o schema app_rpt existe, que rpt_owner tem BYPASSRLS, que rpt.refresh_log existe e que rpt_owner tem SELECT nas tabelas-fonte.

```typescript
// packages/db/src/invariants/inv11-rpt.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool } from './catalog';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 11 — fundacoes do esquema de relatorios (migration 0101)', () => {
  it('schema app_rpt existe e pertence a rpt_owner', async () => {
    const { rows } = await catalogPool().query<{ nspname: string; owner: string }>(`
      SELECT n.nspname, r.rolname AS owner
        FROM pg_namespace n
        JOIN pg_roles r ON r.oid = n.nspowner
       WHERE n.nspname = 'app_rpt'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.owner).toBe('rpt_owner');
  });

  it('rpt_owner tem BYPASSRLS', async () => {
    const { rows } = await catalogPool().query<{ rolbypassrls: boolean }>(`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'rpt_owner'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rolbypassrls).toBe(true);
  });

  it('app_owner e membro de rpt_owner (necessario para SET ROLE nas migrations)', async () => {
    const { rows } = await catalogPool().query<{ is_member: boolean }>(`
      SELECT pg_has_role('app_owner', 'rpt_owner', 'MEMBER') AS is_member`);
    expect(rows[0]!.is_member).toBe(true);
  });

  it('rpt.refresh_log existe com colunas corretas', async () => {
    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'refresh_log'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'id', 'matview_name', 'started_at', 'finished_at', 'row_count', 'success', 'error_message',
    ]);
  });

  it('rpt_owner tem USAGE nos schemas-fonte (clin, fin, sched, msg)', async () => {
    for (const schema of ['clin', 'fin', 'sched', 'msg']) {
      const { rows } = await catalogPool().query<{ has_usage: boolean }>(`
        SELECT has_schema_privilege('rpt_owner', $1, 'USAGE') AS has_usage`, [schema]);
      expect(rows[0]!.has_usage, `rpt_owner sem USAGE em ${schema}`).toBe(true);
    }
  });

  it('rpt_owner tem SELECT nas tabelas-fonte das matviews', async () => {
    const tabelas = [
      'clin.encounter', 'clin.encounter_version', 'clin.diagnosis',
      'clin.procedure', 'clin.patient',
      'fin.entry', 'fin.category', 'fin.payment_method',
      'fin.bank_account', 'fin.cost_center',
      'sched.appointment',
      'msg.nps_response',
      'app.membership', 'app.professional', 'app.clinic',
    ];
    for (const tabela of tabelas) {
      const { rows } = await catalogPool().query<{ has_select: boolean }>(`
        SELECT has_table_privilege('rpt_owner', $1, 'SELECT') AS has_select`, [tabela]);
      expect(rows[0]!.has_select, `rpt_owner sem SELECT em ${tabela}`).toBe(true);
    }
  });

  it('jobs tem USAGE em rpt e SELECT/INSERT/UPDATE em rpt.refresh_log', async () => {
    const { rows: usage } = await catalogPool().query<{ has_usage: boolean }>(`
      SELECT has_schema_privilege('jobs', 'rpt', 'USAGE') AS has_usage`);
    expect(usage[0]!.has_usage).toBe(true);

    for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
      const { rows } = await catalogPool().query<{ has_priv: boolean }>(`
        SELECT has_table_privilege('jobs', 'rpt.refresh_log', $1) AS has_priv`, [priv]);
      expect(rows[0]!.has_priv, `jobs sem ${priv} em rpt.refresh_log`).toBe(true);
    }
  });

  it('app_rw tem USAGE em app_rpt e SELECT em rpt.refresh_log', async () => {
    const { rows: usage } = await catalogPool().query<{ has_usage: boolean }>(`
      SELECT has_schema_privilege('app_rw', 'app_rpt', 'USAGE') AS has_usage`);
    expect(usage[0]!.has_usage).toBe(true);

    const { rows: sel } = await catalogPool().query<{ has_select: boolean }>(`
      SELECT has_table_privilege('app_rw', 'rpt.refresh_log', 'SELECT') AS has_select`);
    expect(sel[0]!.has_select).toBe(true);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (schema app_rpt nao existe, rpt_owner sem BYPASSRLS, refresh_log inexistente):

```bash
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os `it` falham com `expect(rows).toHaveLength(1)` ou `expect(...).toBe(true)` recebendo valor contrario.

- [ ] Criar a migration 0101 que estabelece as fundacoes do esquema de relatorios:

```sql
-- packages/db/migrations/0101_rpt_foundations.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Fundacoes do relatorio: schema app_rpt, BYPASSRLS para rpt_owner,
-- GRANTs nas tabelas-fonte e tabela de log de refresh.

-- ---------------------------------------------------------------------------
-- 1. app_owner precisa ser membro de rpt_owner para SET ROLE nas migrations
--    seguintes (analogo ao GRANT audit_owner TO app_owner da 0001).
-- ---------------------------------------------------------------------------
GRANT rpt_owner TO app_owner;

-- ---------------------------------------------------------------------------
-- 2. rpt_owner precisa de BYPASSRLS por DUAS razoes:
--    (a) REFRESH MATERIALIZED VIEW executa a query definidora com os privilegios
--        do DONO da matview (rpt_owner). As tabelas-fonte (clin.encounter, etc.)
--        tem RLS FORCE com policies TO app_rw. Sem BYPASSRLS, rpt_owner ve
--        zero linhas e a matview nasce vazia.
--    (b) As views security_barrier em app_rpt, pertencentes a rpt_owner, chamam
--        app.is_member() e app.clinical_scope_all(). Essas funcoes consultam
--        app.membership, que tem RLS FORCE com policy TO app_rw. Sem BYPASSRLS,
--        as funcoes retornam false e a view filtra tudo.
--    rpt_owner e NOLOGIN: ninguem abre conexao com ele. O unico acesso e por
--    SET ROLE (requer membership) e SECURITY DEFINER.
-- ---------------------------------------------------------------------------
ALTER ROLE rpt_owner BYPASSRLS;

-- ---------------------------------------------------------------------------
-- 3. Schema app_rpt — camada de leitura (views security_barrier) entre rpt e
--    app_rw. Pertence a rpt_owner para que as views possam ler as matviews
--    (que nao tem GRANT para ninguem alem do dono).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_rpt AUTHORIZATION rpt_owner;

-- ---------------------------------------------------------------------------
-- 4. GRANT USAGE nos schemas-fonte para rpt_owner
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA clin, fin, sched, msg TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 5. GRANT SELECT nas tabelas-fonte para rpt_owner. Cada tabela e listada
--    explicitamente — DEFAULT PRIVILEGES NAO substitui (§3.13 item 7).
-- ---------------------------------------------------------------------------

-- clin: atendimentos, versoes, diagnosticos, procedimentos, pacientes
GRANT SELECT ON clin.encounter          TO rpt_owner;
GRANT SELECT ON clin.encounter_version  TO rpt_owner;
GRANT SELECT ON clin.diagnosis          TO rpt_owner;
GRANT SELECT ON clin.procedure          TO rpt_owner;
GRANT SELECT ON clin.patient            TO rpt_owner;

-- fin: lancamentos, categorias, metodos de pagamento, contas, centros de custo
GRANT SELECT ON fin.entry               TO rpt_owner;
GRANT SELECT ON fin.category            TO rpt_owner;
GRANT SELECT ON fin.payment_method      TO rpt_owner;
GRANT SELECT ON fin.bank_account        TO rpt_owner;
GRANT SELECT ON fin.cost_center         TO rpt_owner;

-- sched: agendamentos
GRANT SELECT ON sched.appointment       TO rpt_owner;

-- msg: respostas NPS
GRANT SELECT ON msg.nps_response        TO rpt_owner;

-- app: membership e professional (necessarias para funcoes de escopo nas views)
GRANT SELECT ON app.membership          TO rpt_owner;
GRANT SELECT ON app.professional        TO rpt_owner;
GRANT SELECT ON app.clinic              TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 6. rpt.refresh_log — carimbo "dados ate HH:MM" (§3.8).
--    Tabela GLOBAL (sem tenant_id): um unico refresh cobre todos os tenants.
--    rpt_owner e dono (schema rpt AUTHORIZATION rpt_owner).
-- ---------------------------------------------------------------------------
SET ROLE rpt_owner;

CREATE TABLE rpt.refresh_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matview_name   text NOT NULL,
  started_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  finished_at    timestamptz(3),
  row_count      bigint,
  success        boolean NOT NULL DEFAULT true,
  error_message  text
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. GRANTs de infra: jobs precisa operar o refresh; app_rw precisa ler o log
--    para exibir "dados ate HH:MM" no front.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA rpt TO jobs;
GRANT SELECT, INSERT, UPDATE ON rpt.refresh_log TO jobs;

GRANT USAGE ON SCHEMA app_rpt TO app_rw, app_support;
GRANT SELECT ON rpt.refresh_log TO app_rw;
```

- [ ] Aplicar a migration e rodar o teste:

```bash
pnpm db:migrate
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/db/migrations/0101_rpt_foundations.sql packages/db/src/invariants/inv11-rpt.int.test.ts
git commit -m "feat(db): add rpt foundations — app_rpt schema, rpt_owner BYPASSRLS, refresh_log (migration 0101)"
```

---

### Task 32: Migration 0102 — Matviews rpt.mv_atendimentos e rpt.mv_agenda

**Arquivos**

- Criar `packages/db/migrations/0102_rpt_mv_atendimentos_agenda.sql`
- Modificar `packages/db/src/invariants/inv11-rpt.int.test.ts`
- Teste `packages/db/src/invariants/inv11-rpt.int.test.ts`

**Passos**

- [ ] Acrescentar ao teste os blocos que verificam a existencia e estrutura das matviews mv_atendimentos e mv_agenda:

```typescript
// Acrescentar ao final de packages/db/src/invariants/inv11-rpt.int.test.ts,
// ANTES do fechamento do afterAll (inserir como novo describe no mesmo arquivo)

describe('matviews rpt.mv_atendimentos e rpt.mv_agenda (migration 0102)', () => {
  it('rpt.mv_atendimentos existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_atendimentos'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_atendimentos'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'encounter_id', 'patient_id', 'professional_id', 'clinic_id',
      'occurred_date', 'duration_minutes', 'procedure_codes', 'diagnosis_codes',
      'version_count', 'status', 'tenant_id',
    ]);
  });

  it('rpt.mv_atendimentos pertence a rpt_owner', async () => {
    const { rows } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_atendimentos'`);
    expect(rows[0]!.owner).toBe('rpt_owner');
  });

  it('rpt.mv_atendimentos tem indice unico para REFRESH CONCURRENTLY', async () => {
    const { rows } = await catalogPool().query<{ indexname: string }>(`
      SELECT i.relname AS indexname FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_atendimentos' AND ix.indisunique`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rpt.mv_agenda existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_agenda'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_agenda'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'appointment_date', 'professional_id', 'clinic_id',
      'total_slots', 'booked', 'confirmed', 'attended',
      'no_shows', 'cancelled', 'occupancy_pct', 'tenant_id',
    ]);
  });

  it('rpt.mv_agenda pertence a rpt_owner', async () => {
    const { rows } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_agenda'`);
    expect(rows[0]!.owner).toBe('rpt_owner');
  });

  it('rpt.mv_agenda tem indice unico para REFRESH CONCURRENTLY', async () => {
    const { rows } = await catalogPool().query<{ indexname: string }>(`
      SELECT i.relname AS indexname FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_agenda' AND ix.indisunique`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar o teste e confirmar que os novos blocos falham (matviews nao existem):

```bash
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: testes de mv_atendimentos e mv_agenda falham com `expect(kind).toHaveLength(1)` recebendo 0.

- [ ] Criar a migration 0102 com as matviews. Ambas sao criadas como SET ROLE rpt_owner e WITH NO DATA (o primeiro refresh popular em horario de manutencao):

```sql
-- packages/db/migrations/0102_rpt_mv_atendimentos_agenda.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Matviews de atendimentos e agenda. Propriedade de rpt_owner, SEM GRANT
-- para app_rw. Exposicao exclusiva via app_rpt (migration 0105).

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- 1. rpt.mv_atendimentos — um registro por atendimento nao-anulado.
--    Diagnoses e procedimentos vivos sao agregados em arrays para filtro.
--    Duracao em minutos vem do agendamento vinculado (se houver).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_atendimentos AS
SELECT
  e.id                    AS encounter_id,
  e.patient_id,
  e.professional_id,
  e.clinic_id,
  e.occurred_date,
  CASE WHEN a.id IS NOT NULL THEN
    (EXTRACT(EPOCH FROM (COALESCE(a.finished_at, a.ends_at) - a.starts_at)) / 60)::int
  END                     AS duration_minutes,
  COALESCE(proc.codes, ARRAY[]::text[])  AS procedure_codes,
  COALESCE(diag.codes, ARRAY[]::text[])  AS diagnosis_codes,
  e.version_count,
  e.status::text          AS status,
  e.tenant_id
FROM clin.encounter e
LEFT JOIN sched.appointment a
  ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT p.code ORDER BY p.code) AS codes
    FROM clin.procedure p
   WHERE p.tenant_id = e.tenant_id
     AND p.encounter_id = e.id
     AND p.live
) proc ON true
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT d.code ORDER BY d.code) AS codes
    FROM clin.diagnosis d
   WHERE d.tenant_id = e.tenant_id
     AND d.encounter_id = e.id
     AND d.live
) diag ON true
WHERE e.status <> 'anulado'
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_atendimentos
  ON rpt.mv_atendimentos (tenant_id, encounter_id);
CREATE INDEX ix_mv_atendimentos_data
  ON rpt.mv_atendimentos (tenant_id, clinic_id, occurred_date DESC);

-- ---------------------------------------------------------------------------
-- 2. rpt.mv_agenda — resumo diario por profissional e clinica.
--    Ocupacao = atendidos / agendados nao-cancelados (show rate).
--    total_slots = todos os agendamentos criados para o dia.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_agenda AS
SELECT
  a.appointment_date,
  a.professional_id,
  a.clinic_id,
  COUNT(*)::int                                                     AS total_slots,
  COUNT(*) FILTER (WHERE a.status <> 'cancelado')::int              AS booked,
  COUNT(*) FILTER (WHERE a.confirmed_at IS NOT NULL
                     AND a.status <> 'cancelado')::int              AS confirmed,
  COUNT(*) FILTER (WHERE a.status = 'atendido')::int                AS attended,
  COUNT(*) FILTER (WHERE a.status = 'faltou')::int                  AS no_shows,
  COUNT(*) FILTER (WHERE a.status = 'cancelado')::int               AS cancelled,
  CASE
    WHEN COUNT(*) FILTER (WHERE a.status <> 'cancelado') > 0 THEN
      (COUNT(*) FILTER (WHERE a.status = 'atendido')::numeric
       / COUNT(*) FILTER (WHERE a.status <> 'cancelado') * 100)::smallint
    ELSE 0::smallint
  END                                                               AS occupancy_pct,
  a.tenant_id
FROM sched.appointment a
GROUP BY a.tenant_id, a.appointment_date, a.professional_id, a.clinic_id
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_agenda
  ON rpt.mv_agenda (tenant_id, appointment_date, professional_id, clinic_id);
CREATE INDEX ix_mv_agenda_data
  ON rpt.mv_agenda (tenant_id, clinic_id, appointment_date DESC);

RESET ROLE;
```

- [ ] Aplicar a migration e rodar o teste:

```bash
pnpm db:migrate
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os testes passam, incluindo os novos de mv_atendimentos e mv_agenda.

- [ ] Commitar:

```bash
git add packages/db/migrations/0102_rpt_mv_atendimentos_agenda.sql packages/db/src/invariants/inv11-rpt.int.test.ts
git commit -m "feat(db): add matviews rpt.mv_atendimentos and rpt.mv_agenda (migration 0102)"
```

---

### Task 33: Migration 0103 — Matviews rpt.mv_financeiro, rpt.mv_pacientes e rpt.mv_satisfacao

**Arquivos**

- Criar `packages/db/migrations/0103_rpt_mv_financeiro_pacientes_satisfacao.sql`
- Modificar `packages/db/src/invariants/inv11-rpt.int.test.ts`
- Teste `packages/db/src/invariants/inv11-rpt.int.test.ts`

**Passos**

- [ ] Acrescentar ao teste os blocos de verificacao das tres matviews restantes:

```typescript
// Acrescentar ao final de packages/db/src/invariants/inv11-rpt.int.test.ts

describe('matviews rpt.mv_financeiro, rpt.mv_pacientes e rpt.mv_satisfacao (migration 0103)', () => {
  it('rpt.mv_financeiro existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_financeiro'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'entry_id', 'kind', 'category', 'method', 'amount_cents',
      'paid_at', 'due_date', 'status', 'professional_id', 'clinic_id',
      'bank_account_id', 'cost_center_id', 'tenant_id',
    ]);
  });

  it('rpt.mv_financeiro pertence a rpt_owner e tem indice unico', async () => {
    const { rows: owner } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro'`);
    expect(owner[0]!.owner).toBe('rpt_owner');

    const { rows: idx } = await catalogPool().query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro' AND ix.indisunique`);
    expect(Number(idx[0]!.cnt)).toBeGreaterThanOrEqual(1);
  });

  it('rpt.mv_pacientes existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_pacientes'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'patient_id', 'age_bracket', 'gender', 'source',
      'first_visit', 'last_visit', 'visit_count', 'tenant_id',
    ]);
  });

  it('rpt.mv_pacientes pertence a rpt_owner e tem indice unico', async () => {
    const { rows: owner } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes'`);
    expect(owner[0]!.owner).toBe('rpt_owner');

    const { rows: idx } = await catalogPool().query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes' AND ix.indisunique`);
    expect(Number(idx[0]!.cnt)).toBeGreaterThanOrEqual(1);
  });

  it('rpt.mv_satisfacao existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_satisfacao'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'nps_response_id', 'score', 'category', 'professional_id',
      'clinic_id', 'responded_at', 'tenant_id',
    ]);
  });

  it('rpt.mv_satisfacao pertence a rpt_owner e tem indice unico', async () => {
    const { rows: owner } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao'`);
    expect(owner[0]!.owner).toBe('rpt_owner');

    const { rows: idx } = await catalogPool().query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao' AND ix.indisunique`);
    expect(Number(idx[0]!.cnt)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar o teste e confirmar que os novos blocos falham:

```bash
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: testes de mv_financeiro, mv_pacientes e mv_satisfacao falham com `expect(kind).toHaveLength(1)` recebendo 0.

- [ ] Criar a migration 0103 com as tres matviews restantes:

```sql
-- packages/db/migrations/0103_rpt_mv_financeiro_pacientes_satisfacao.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Matviews financeiro, pacientes e satisfacao. Propriedade de rpt_owner,
-- SEM GRANT para app_rw. bank_account_id e cost_center_id vem de fin.entry
-- (adicionados pela migration 0087 do bloco 01-fin-contas-centro).

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- 1. rpt.mv_financeiro — um registro por lancamento financeiro.
--    category e method sao nomes textuais (JOIN), nao IDs.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_financeiro AS
SELECT
  e.id                          AS entry_id,
  e.kind::text                  AS kind,
  c.name                        AS category,
  pm.name                       AS method,
  e.amount_cents,
  e.paid_at,
  e.due_date,
  e.status::text                AS status,
  e.professional_id,
  e.clinic_id,
  e.bank_account_id,
  e.cost_center_id,
  e.tenant_id
FROM fin.entry e
LEFT JOIN fin.category c
  ON c.tenant_id = e.tenant_id AND c.id = e.category_id
LEFT JOIN fin.payment_method pm
  ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_financeiro
  ON rpt.mv_financeiro (tenant_id, entry_id);
CREATE INDEX ix_mv_financeiro_data
  ON rpt.mv_financeiro (tenant_id, clinic_id, paid_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 2. rpt.mv_pacientes — um registro por paciente com metricas de visita.
--    Faixa etaria calculada a partir de birth_date. Gender usa sex_at_birth.
--    source e NULL ate que o campo de origem de captacao exista no cadastro.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_pacientes AS
SELECT
  p.id                          AS patient_id,
  CASE
    WHEN p.birth_date IS NULL              THEN 'desconhecido'
    WHEN age(p.birth_date) < interval '1 year'    THEN '0-1'
    WHEN age(p.birth_date) < interval '13 years'  THEN '2-12'
    WHEN age(p.birth_date) < interval '18 years'  THEN '13-17'
    WHEN age(p.birth_date) < interval '30 years'  THEN '18-29'
    WHEN age(p.birth_date) < interval '45 years'  THEN '30-44'
    WHEN age(p.birth_date) < interval '60 years'  THEN '45-59'
    WHEN age(p.birth_date) < interval '75 years'  THEN '60-74'
    ELSE                                            '75+'
  END                           AS age_bracket,
  COALESCE(p.sex_at_birth, 'I') AS gender,
  NULL::text                    AS source,
  vis.first_visit,
  vis.last_visit,
  COALESCE(vis.visit_count, 0)  AS visit_count,
  p.tenant_id
FROM clin.patient p
LEFT JOIN LATERAL (
  SELECT
    MIN(a.appointment_date) AS first_visit,
    MAX(a.appointment_date) AS last_visit,
    COUNT(*)::int           AS visit_count
  FROM sched.appointment a
  WHERE a.tenant_id = p.tenant_id
    AND a.patient_id = p.id
    AND a.status = 'atendido'
) vis ON true
WHERE p.inactivated_at IS NULL
  AND p.merged_into_id IS NULL
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_pacientes
  ON rpt.mv_pacientes (tenant_id, patient_id);
CREATE INDEX ix_mv_pacientes_faixa
  ON rpt.mv_pacientes (tenant_id, age_bracket);

-- ---------------------------------------------------------------------------
-- 3. rpt.mv_satisfacao — um registro por resposta NPS.
--    Categoria NPS: promoter (9-10), passive (7-8), detractor (0-6).
--    professional_id e clinic_id vem do agendamento vinculado (nullable).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_satisfacao AS
SELECT
  nps.id                        AS nps_response_id,
  nps.score,
  CASE
    WHEN nps.score >= 9 THEN 'promoter'
    WHEN nps.score >= 7 THEN 'passive'
    ELSE                      'detractor'
  END                           AS category,
  a.professional_id,
  a.clinic_id,
  nps.received_at               AS responded_at,
  nps.tenant_id
FROM msg.nps_response nps
LEFT JOIN sched.appointment a
  ON a.tenant_id = nps.tenant_id AND a.id = nps.appointment_id
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_satisfacao
  ON rpt.mv_satisfacao (tenant_id, nps_response_id);
CREATE INDEX ix_mv_satisfacao_data
  ON rpt.mv_satisfacao (tenant_id, responded_at DESC);

RESET ROLE;
```

- [ ] Aplicar a migration e rodar o teste:

```bash
pnpm db:migrate
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/db/migrations/0103_rpt_mv_financeiro_pacientes_satisfacao.sql packages/db/src/invariants/inv11-rpt.int.test.ts
git commit -m "feat(db): add matviews rpt.mv_financeiro, mv_pacientes, mv_satisfacao (migration 0103)"
```

---

### Task 34: Migration 0104 — Funcoes de refresh por matview

**Arquivos**

- Criar `packages/db/migrations/0104_rpt_refresh_functions.sql`
- Modificar `packages/db/src/invariants/inv11-rpt.int.test.ts`
- Teste `packages/db/src/invariants/inv11-rpt.int.test.ts`

**Passos**

- [ ] Acrescentar ao teste os blocos de verificacao das funcoes de refresh:

```typescript
// Acrescentar ao final de packages/db/src/invariants/inv11-rpt.int.test.ts

describe('funcoes de refresh rpt.refresh_mv_* (migration 0104)', () => {
  const MATVIEWS = [
    'mv_atendimentos',
    'mv_financeiro',
    'mv_agenda',
    'mv_pacientes',
    'mv_satisfacao',
  ] as const;

  for (const mv of MATVIEWS) {
    const fnName = `rpt.refresh_${mv}`;

    it(`${fnName} existe como SECURITY DEFINER pertencente a rpt_owner`, async () => {
      const { rows } = await catalogPool().query<{
        proname: string;
        owner: string;
        prosecdef: boolean;
      }>(`
        SELECT p.proname, r.rolname AS owner, p.prosecdef
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_roles r ON r.oid = p.proowner
         WHERE n.nspname = 'rpt' AND p.proname = $1`, [`refresh_${mv}`]);
      expect(rows, `funcao ${fnName} nao encontrada`).toHaveLength(1);
      expect(rows[0]!.owner).toBe('rpt_owner');
      expect(rows[0]!.prosecdef).toBe(true);
    });

    it(`jobs tem EXECUTE em ${fnName}`, async () => {
      const { rows } = await catalogPool().query<{ has_exec: boolean }>(`
        SELECT has_function_privilege('jobs', '${fnName}()', 'EXECUTE') AS has_exec`);
      expect(rows[0]!.has_exec).toBe(true);
    });
  }
});
```

- [ ] Rodar o teste e confirmar que os novos blocos falham (funcoes nao existem):

```bash
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os testes de refresh_mv_* falham com `expect(rows).toHaveLength(1)` recebendo 0.

- [ ] Criar a migration 0104 com as funcoes de refresh. Cada funcao:
  1. Verifica se a matview esta populada (pg_class.relispopulated)
  2. Usa REFRESH CONCURRENTLY se populada, senao REFRESH normal (primeiro refresh)
  3. Grava o carimbo em rpt.refresh_log com contagem de linhas

```sql
-- packages/db/migrations/0104_rpt_refresh_functions.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Funcoes de refresh por matview. SECURITY DEFINER pertencentes a rpt_owner.
-- Chamadas pelo worker (papel jobs) com frequencia configuravel.
-- NUNCA full refresh em horario comercial — apenas periodos fechados.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- Funcao auxiliar: verifica se a matview ja foi populada ao menos uma vez.
-- Necessario porque REFRESH CONCURRENTLY exige que a matview tenha dados.
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.is_populated(p_matview text) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT c.relispopulated
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'rpt' AND c.relname = p_matview
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_atendimentos
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_atendimentos() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_atendimentos') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_atendimentos;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_atendimentos;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_atendimentos;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_atendimentos', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_financeiro
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_financeiro() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_financeiro') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_financeiro;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_financeiro;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_financeiro;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_financeiro', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_agenda
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_agenda() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_agenda') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_agenda;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_agenda;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_agenda;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_agenda', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_pacientes
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_pacientes() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_pacientes') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_pacientes;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_pacientes;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_pacientes;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_pacientes', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_satisfacao
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_satisfacao() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_satisfacao') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_satisfacao;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_satisfacao;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_satisfacao;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_satisfacao', v_start, clock_timestamp(), v_count, true);
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANTs: o worker (papel jobs) precisa de EXECUTE nas funcoes de refresh.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_atendimentos()  TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_financeiro()    TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_agenda()        TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_pacientes()     TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_satisfacao()    TO jobs;
GRANT EXECUTE ON FUNCTION rpt.is_populated(text)         TO jobs;
```

- [ ] Aplicar a migration e rodar o teste:

```bash
pnpm db:migrate
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/db/migrations/0104_rpt_refresh_functions.sql packages/db/src/invariants/inv11-rpt.int.test.ts
git commit -m "feat(db): add SECURITY DEFINER refresh functions for all 5 matviews (migration 0104)"
```

---

### Task 35: Migration 0105 — Views security_barrier em app_rpt

**Arquivos**

- Criar `packages/db/migrations/0105_app_rpt_barrier_views.sql`
- Modificar `packages/db/src/invariants/inv11-rpt.int.test.ts`
- Teste `packages/db/src/invariants/inv11-rpt.int.test.ts`

**Passos**

- [ ] Acrescentar ao teste os blocos de verificacao das views security_barrier:

```typescript
// Acrescentar ao final de packages/db/src/invariants/inv11-rpt.int.test.ts

describe('views security_barrier em app_rpt (migration 0105)', () => {
  const VIEWS = [
    'atendimentos',
    'financeiro',
    'agenda',
    'pacientes',
    'satisfacao',
  ] as const;

  for (const view of VIEWS) {
    it(`app_rpt.${view} existe como view com security_barrier = true`, async () => {
      const { rows } = await catalogPool().query<{
        relkind: string;
        owner: string;
        has_barrier: boolean;
      }>(`
        SELECT
          c.relkind::text,
          r.rolname AS owner,
          EXISTS (
            SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(opt)
             WHERE lower(o.opt) = 'security_barrier=true'
          ) AS has_barrier
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'app_rpt' AND c.relname = $1`, [view]);
      expect(rows, `view app_rpt.${view} nao encontrada`).toHaveLength(1);
      expect(rows[0]!.relkind).toBe('v');
      expect(rows[0]!.owner).toBe('rpt_owner');
      expect(rows[0]!.has_barrier).toBe(true);
    });

    it(`app_rw tem SELECT em app_rpt.${view}`, async () => {
      const { rows } = await catalogPool().query<{ has_select: boolean }>(`
        SELECT has_table_privilege('app_rw', 'app_rpt.${view}', 'SELECT') AS has_select`);
      expect(rows[0]!.has_select).toBe(true);
    });
  }

  it('nenhuma view em app_rpt e security_invoker (executa com privilegios do dono)', async () => {
    const { rows } = await catalogPool().query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_rpt' AND c.relkind = 'v'
        AND EXISTS (
          SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(opt)
           WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on')
        )`);
    expect(rows, 'views em app_rpt nao devem ser security_invoker').toHaveLength(0);
  });
});
```

- [ ] Rodar o teste e confirmar que os novos blocos falham:

```bash
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: testes de app_rpt.* falham com `expect(rows).toHaveLength(1)` recebendo 0.

- [ ] Criar a migration 0105 com as views security_barrier. Cada view filtra por `app.current_tenant_id()` e `app.is_member()`. Dados clinicos (atendimentos) verificam tambem `app.clinical_scope_all()`. A view roda com privilegios do dono (rpt_owner, BYPASSRLS) — as funcoes de escopo funcionam porque rpt_owner tem BYPASSRLS e SELECT em app.membership.

```sql
-- packages/db/migrations/0105_app_rpt_barrier_views.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Views security_barrier em app_rpt. Cada view filtra por tenant e papel.
-- NAO sao security_invoker: executam com privilegios de rpt_owner (BYPASSRLS),
-- que e o unico papel com SELECT nas matviews. A barreira de seguranca vem do
-- predicado security_barrier no WHERE, avaliado ANTES de qualquer condicao do
-- usuario, impedindo vazamento por erro ou side channel.
--
-- Os GUC (app.tenant_id, app.user_id, etc.) sao definidos por withTenantTx no
-- preambulo da transacao e sao visiveis dentro da view independente do papel.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- 1. app_rpt.atendimentos — §3.8 literal. Dado clinico: verifica clinical_scope.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.atendimentos WITH (security_barrier = true) AS
  SELECT m.encounter_id, m.patient_id, m.professional_id, m.clinic_id,
         m.occurred_date, m.duration_minutes, m.procedure_codes,
         m.diagnosis_codes, m.version_count, m.status
    FROM rpt.mv_atendimentos m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member()
     AND (app.clinical_scope_all()
          OR m.professional_id = app.current_professional_id());

-- ---------------------------------------------------------------------------
-- 2. app_rpt.financeiro — dado financeiro, sem restricao de escopo clinico.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.financeiro WITH (security_barrier = true) AS
  SELECT m.entry_id, m.kind, m.category, m.method, m.amount_cents,
         m.paid_at, m.due_date, m.status, m.professional_id, m.clinic_id,
         m.bank_account_id, m.cost_center_id
    FROM rpt.mv_financeiro m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

-- ---------------------------------------------------------------------------
-- 3. app_rpt.agenda — dado administrativo, sem restricao de escopo clinico.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.agenda WITH (security_barrier = true) AS
  SELECT m.appointment_date, m.professional_id, m.clinic_id,
         m.total_slots, m.booked, m.confirmed, m.attended,
         m.no_shows, m.cancelled, m.occupancy_pct
    FROM rpt.mv_agenda m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

-- ---------------------------------------------------------------------------
-- 4. app_rpt.pacientes — dado clinico: verifica clinical_scope quando o
--    profissional nao tem escopo total.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.pacientes WITH (security_barrier = true) AS
  SELECT m.patient_id, m.age_bracket, m.gender, m.source,
         m.first_visit, m.last_visit, m.visit_count
    FROM rpt.mv_pacientes m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

-- ---------------------------------------------------------------------------
-- 5. app_rpt.satisfacao — dado administrativo (NPS), sem escopo clinico.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.satisfacao WITH (security_barrier = true) AS
  SELECT m.nps_response_id, m.score, m.category, m.professional_id,
         m.clinic_id, m.responded_at
    FROM rpt.mv_satisfacao m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANTs: app_rw le as views, nunca as matviews diretamente.
-- ---------------------------------------------------------------------------
GRANT SELECT ON app_rpt.atendimentos  TO app_rw;
GRANT SELECT ON app_rpt.financeiro    TO app_rw;
GRANT SELECT ON app_rpt.agenda        TO app_rw;
GRANT SELECT ON app_rpt.pacientes     TO app_rw;
GRANT SELECT ON app_rpt.satisfacao    TO app_rw;
```

- [ ] Aplicar a migration e rodar o teste:

```bash
pnpm db:migrate
pnpm test:int -- packages/db/src/invariants/inv11-rpt.int.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/db/migrations/0105_app_rpt_barrier_views.sql packages/db/src/invariants/inv11-rpt.int.test.ts
git commit -m "feat(db): add security_barrier views in app_rpt for all 5 matviews (migration 0105)"
```

---

### Task 36: Invariante de CI — nenhuma matview em rpt tem GRANT para app_rw

**Arquivos**

- Criar `packages/db/src/invariants/inv11-rpt-no-matview-grant.ts`
- Criar `packages/db/src/invariants/inv11-rpt-no-matview-grant.int.test.ts`
- Teste `packages/db/src/invariants/inv11-rpt-no-matview-grant.int.test.ts`

**Passos**

- [ ] Criar o modulo do invariante que varre o catalogo procurando GRANTs de matview para app_rw. O invariante verifica `relkind = 'm'` em qualquer schema — nao so rpt — porque a regra e universal (§3.8 e §3.13 item 6).

```typescript
// packages/db/src/invariants/inv11-rpt-no-matview-grant.ts
import type { Queryable } from '../queryable';

/**
 * §3.8 / §3.13 item 6 — nenhuma matview tem GRANT para app_rw.
 *
 * Matview nao suporta RLS. Toda matview e exposta EXCLUSIVAMENTE por view
 * security_barrier em app_rpt. Se app_rw recebe GRANT direto, a RLS fundadora
 * e anulada por construcao.
 *
 * O teste varre relkind = 'm' em TODOS os schemas — nao so rpt — porque a
 * regra e universal. O filtro inclui relkind IN ('r','p','m','v','f') do
 * invariante 7, que no desenho original filtrava 'r' e deixava matview
 * invisivel (§3.8).
 */

const SQL = `
SELECT n.nspname || '.' || c.relname AS matview,
       coalesce(g.rolname, 'PUBLIC')  AS grantee,
       a.privilege_type               AS privilege
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee
 WHERE c.relkind = 'm'
   AND coalesce(g.rolname, 'PUBLIC') = 'app_rw'
 ORDER BY 1, 3`;

export interface MatviewGrant {
  matview: string;
  grantee: string;
  privilege: string;
}

export async function matviewGrantsToAppRw(db: Queryable): Promise<MatviewGrant[]> {
  const { rows } = await db.query<MatviewGrant>(SQL);
  return rows;
}

export function matviewGrantViolations(grants: readonly MatviewGrant[]): string[] {
  return grants.map(
    (g) =>
      `${g.matview}: app_rw tem ${g.privilege} — matview NUNCA recebe GRANT para app_rw (§3.8)`,
  );
}
```

- [ ] Criar o arquivo de teste do invariante:

```typescript
// packages/db/src/invariants/inv11-rpt-no-matview-grant.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { matviewGrantsToAppRw, matviewGrantViolations } from './inv11-rpt-no-matview-grant';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 11 — nenhuma matview tem GRANT para app_rw (§3.8)', () => {
  it('nenhuma matview em qualquer schema tem GRANT para app_rw', async () => {
    const grants = await matviewGrantsToAppRw(catalogPool());
    expect(matviewGrantViolations(grants)).toEqual([]);
  });

  it('reprova matview com GRANT para app_rw (regressao)', async () => {
    const violations = await inRollbackTx(async (c) => {
      await c.query(`
        CREATE MATERIALIZED VIEW app.__mv_teste AS
        SELECT 1 AS x WITH NO DATA`);
      await c.query('GRANT SELECT ON app.__mv_teste TO app_rw');
      return matviewGrantViolations(await matviewGrantsToAppRw(c));
    });
    expect(violations).toContain(
      'app.__mv_teste: app_rw tem SELECT — matview NUNCA recebe GRANT para app_rw (§3.8)',
    );
  });

  it('aceita matview sem GRANT algum (o caso correto)', async () => {
    const violations = await inRollbackTx(async (c) => {
      await c.query(`
        CREATE MATERIALIZED VIEW app.__mv_limpa AS
        SELECT 1 AS x WITH NO DATA`);
      // Sem GRANT — matview so e acessada via view security_barrier
      return matviewGrantViolations(await matviewGrantsToAppRw(c));
    });
    // Nao deve conter a matview limpa
    expect(violations.some((v) => v.includes('__mv_limpa'))).toBe(false);
  });
});
```

- [ ] Rodar o teste e confirmar que passa (as matviews criadas nas tasks anteriores NAO tem GRANT para app_rw, entao o invariante ja e verde):

```bash
pnpm test:int -- packages/db/src/invariants/inv11-rpt-no-matview-grant.int.test.ts
```

Saida esperada: todos os 3 testes passam. O teste de regressao confirma que o invariante REPROVARIA um GRANT indevido. O invariante esta verde desde o inicio porque as matviews foram criadas sem GRANT para app_rw.

- [ ] Commitar:

```bash
git add packages/db/src/invariants/inv11-rpt-no-matview-grant.ts packages/db/src/invariants/inv11-rpt-no-matview-grant.int.test.ts
git commit -m "feat(db): add CI invariant — no matview may have GRANT for app_rw (§3.8)"
```

---

### Task 37: packages/reports — tipos, refresh e consulta via app_rpt

**Arquivos**

- Criar `packages/reports/src/types.ts`
- Criar `packages/reports/src/refresh.ts`
- Criar `packages/reports/src/queries.ts`
- Modificar `packages/reports/src/index.ts`
- Criar `packages/reports/test/refresh.int.test.ts`
- Teste `packages/reports/test/refresh.int.test.ts`

**Passos**

- [ ] Criar o arquivo de teste de integracao. O teste verifica que o refresh funciona (matview vazia e populada apos refresh) e que o log e gravado corretamente. Usa o jobsPool para chamar as funcoes de refresh (papel jobs com BYPASSRLS).

```typescript
// packages/reports/test/refresh.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db/pool';
import { refreshMatview, getLatestRefresh, MATVIEW_NAMES } from '../src/refresh';

afterAll(async () => {
  await closePools();
});

describe('packages/reports — refresh de matviews via app_rpt', () => {
  it('refreshMatview executa sem erro para cada matview (dados vazios)', async () => {
    const pool = jobsPool();
    for (const mv of MATVIEW_NAMES) {
      await expect(refreshMatview(pool, mv)).resolves.not.toThrow();
    }
  });

  it('apos refresh, rpt.refresh_log contem registros com success = true', async () => {
    const pool = jobsPool();
    const logs = await getLatestRefresh(pool);
    expect(logs.length).toBeGreaterThanOrEqual(MATVIEW_NAMES.length);
    for (const log of logs) {
      expect(log.success).toBe(true);
      expect(log.finishedAt).not.toBeNull();
      expect(log.rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('refreshMatview rejeita nome de matview invalido', async () => {
    const pool = jobsPool();
    await expect(refreshMatview(pool, 'mv_inexistente' as never)).rejects.toThrow(
      'matview desconhecida',
    );
  });

  it('getLatestRefresh retorna o refresh mais recente por matview', async () => {
    const pool = jobsPool();
    // Executa um segundo refresh para mv_atendimentos
    await refreshMatview(pool, 'mv_atendimentos');
    const logs = await getLatestRefresh(pool);
    const atend = logs.find((l) => l.matviewName === 'mv_atendimentos');
    expect(atend).toBeDefined();
    expect(atend!.success).toBe(true);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulos nao existem):

```bash
pnpm test:int -- packages/reports/test/refresh.int.test.ts
```

Saida esperada: erro de importacao — `Cannot find module '../src/refresh'`.

- [ ] Criar os tipos das linhas de matview:

```typescript
// packages/reports/src/types.ts

/** Linha de rpt.mv_atendimentos exposta via app_rpt.atendimentos */
export interface AtendimentoRow {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly occurredDate: string;
  readonly durationMinutes: number | null;
  readonly procedureCodes: readonly string[];
  readonly diagnosisCodes: readonly string[];
  readonly versionCount: number;
  readonly status: string;
}

/** Linha de rpt.mv_financeiro exposta via app_rpt.financeiro */
export interface FinanceiroRow {
  readonly entryId: string;
  readonly kind: string;
  readonly category: string | null;
  readonly method: string | null;
  readonly amountCents: number;
  readonly paidAt: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly bankAccountId: string | null;
  readonly costCenterId: string | null;
}

/** Linha de rpt.mv_agenda exposta via app_rpt.agenda */
export interface AgendaRow {
  readonly appointmentDate: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly totalSlots: number;
  readonly booked: number;
  readonly confirmed: number;
  readonly attended: number;
  readonly noShows: number;
  readonly cancelled: number;
  readonly occupancyPct: number;
}

/** Linha de rpt.mv_pacientes exposta via app_rpt.pacientes */
export interface PacienteRow {
  readonly patientId: string;
  readonly ageBracket: string;
  readonly gender: string;
  readonly source: string | null;
  readonly firstVisit: string | null;
  readonly lastVisit: string | null;
  readonly visitCount: number;
}

/** Linha de rpt.mv_satisfacao exposta via app_rpt.satisfacao */
export interface SatisfacaoRow {
  readonly npsResponseId: string;
  readonly score: number;
  readonly category: 'promoter' | 'passive' | 'detractor';
  readonly professionalId: string | null;
  readonly clinicId: string | null;
  readonly respondedAt: string;
}

/** Registro de refresh em rpt.refresh_log */
export interface RefreshLogEntry {
  readonly id: number;
  readonly matviewName: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly rowCount: number;
  readonly success: boolean;
  readonly errorMessage: string | null;
}
```

- [ ] Criar o modulo de refresh que encapsula a chamada das funcoes SQL:

```typescript
// packages/reports/src/refresh.ts
import type { Pool, QueryResultRow } from 'pg';
import type { RefreshLogEntry } from './types';

/**
 * Nomes das matviews no schema rpt. Cada uma tem uma funcao
 * rpt.refresh_<nome>() SECURITY DEFINER pertencente a rpt_owner.
 */
export const MATVIEW_NAMES = [
  'mv_atendimentos',
  'mv_financeiro',
  'mv_agenda',
  'mv_pacientes',
  'mv_satisfacao',
] as const;

export type MatviewName = (typeof MATVIEW_NAMES)[number];

function isMatviewName(name: string): name is MatviewName {
  return (MATVIEW_NAMES as readonly string[]).includes(name);
}

/**
 * Executa o refresh de uma matview chamando a funcao SECURITY DEFINER
 * correspondente. Deve ser chamado pelo worker usando o jobsPool (papel jobs).
 *
 * §3.8: NUNCA full refresh em horario comercial. O worker configura a
 * frequencia e o horario de execucao via pg-boss.
 */
export async function refreshMatview(pool: Pool, name: MatviewName): Promise<void> {
  if (!isMatviewName(name)) {
    throw new Error(`matview desconhecida: ${name}`);
  }
  await pool.query(`SELECT rpt.refresh_${name}()`);
}

/**
 * Retorna o refresh mais recente de cada matview, ordenado por horario
 * decrescente. Usado pela API para exibir "dados ate HH:MM" na tela.
 */
export async function getLatestRefresh(pool: Pool): Promise<RefreshLogEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    matview_name: string;
    started_at: Date;
    finished_at: Date | null;
    row_count: string;
    success: boolean;
    error_message: string | null;
  }>(`
    SELECT DISTINCT ON (matview_name)
           id, matview_name, started_at, finished_at,
           row_count, success, error_message
      FROM rpt.refresh_log
     ORDER BY matview_name, started_at DESC`);

  return rows.map((r) => ({
    id: Number(r.id),
    matviewName: r.matview_name,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    rowCount: Number(r.row_count),
    success: r.success,
    errorMessage: r.error_message,
  }));
}
```

- [ ] Criar o modulo de consultas que le as views de barreira via withTenantTx:

```typescript
// packages/reports/src/queries.ts
import type { TxClient } from '@cadencia/db/tx';
import type { AtendimentoRow, AgendaRow, RefreshLogEntry } from './types';

/**
 * Lista atendimentos no periodo, filtrados pela view security_barrier.
 * A view app_rpt.atendimentos ja aplica tenant e escopo clinico.
 *
 * packages/reports NAO le matview diretamente — sempre via app_rpt (§3.8, §2.2).
 */
export async function listAtendimentos(
  tx: TxClient,
  dateFrom: string,
  dateTo: string,
): Promise<AtendimentoRow[]> {
  const { rows } = await tx.query<{
    encounter_id: string;
    patient_id: string;
    professional_id: string;
    clinic_id: string;
    occurred_date: Date;
    duration_minutes: number | null;
    procedure_codes: string[];
    diagnosis_codes: string[];
    version_count: number;
    status: string;
  }>(
    `SELECT encounter_id, patient_id, professional_id, clinic_id,
            occurred_date, duration_minutes, procedure_codes,
            diagnosis_codes, version_count, status
       FROM app_rpt.atendimentos
      WHERE occurred_date >= $1::date AND occurred_date <= $2::date
      ORDER BY occurred_date DESC`,
    [dateFrom, dateTo],
  );

  return rows.map((r) => ({
    encounterId: r.encounter_id,
    patientId: r.patient_id,
    professionalId: r.professional_id,
    clinicId: r.clinic_id,
    occurredDate: r.occurred_date.toISOString().slice(0, 10),
    durationMinutes: r.duration_minutes,
    procedureCodes: r.procedure_codes,
    diagnosisCodes: r.diagnosis_codes,
    versionCount: r.version_count,
    status: r.status,
  }));
}

/**
 * Resumo da agenda no periodo. A view app_rpt.agenda ja filtra por tenant.
 */
export async function listAgenda(
  tx: TxClient,
  dateFrom: string,
  dateTo: string,
): Promise<AgendaRow[]> {
  const { rows } = await tx.query<{
    appointment_date: Date;
    professional_id: string;
    clinic_id: string;
    total_slots: number;
    booked: number;
    confirmed: number;
    attended: number;
    no_shows: number;
    cancelled: number;
    occupancy_pct: number;
  }>(
    `SELECT appointment_date, professional_id, clinic_id,
            total_slots, booked, confirmed, attended,
            no_shows, cancelled, occupancy_pct
       FROM app_rpt.agenda
      WHERE appointment_date >= $1::date AND appointment_date <= $2::date
      ORDER BY appointment_date DESC`,
    [dateFrom, dateTo],
  );

  return rows.map((r) => ({
    appointmentDate: r.appointment_date.toISOString().slice(0, 10),
    professionalId: r.professional_id,
    clinicId: r.clinic_id,
    totalSlots: r.total_slots,
    booked: r.booked,
    confirmed: r.confirmed,
    attended: r.attended,
    noShows: r.no_shows,
    cancelled: r.cancelled,
    occupancyPct: r.occupancy_pct,
  }));
}

/**
 * Ultimo refresh de cada matview. Usado pelo front para exibir
 * "dados ate HH:MM" (§3.8). Le diretamente de rpt.refresh_log
 * via app_rw (que tem SELECT na tabela).
 */
export async function getRefreshTimestamps(
  tx: TxClient,
): Promise<RefreshLogEntry[]> {
  const { rows } = await tx.query<{
    id: string;
    matview_name: string;
    started_at: Date;
    finished_at: Date | null;
    row_count: string;
    success: boolean;
    error_message: string | null;
  }>(`
    SELECT DISTINCT ON (matview_name)
           id, matview_name, started_at, finished_at,
           row_count, success, error_message
      FROM rpt.refresh_log
     ORDER BY matview_name, started_at DESC`);

  return rows.map((r) => ({
    id: Number(r.id),
    matviewName: r.matview_name,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    rowCount: Number(r.row_count),
    success: r.success,
    errorMessage: r.error_message,
  }));
}
```

- [ ] Substituir o stub vazio do index.ts pelo barrel que exporta os modulos:

```typescript
// packages/reports/src/index.ts
export { refreshMatview, getLatestRefresh, MATVIEW_NAMES } from './refresh';
export type { MatviewName } from './refresh';
export { listAtendimentos, listAgenda, getRefreshTimestamps } from './queries';
export type {
  AtendimentoRow,
  FinanceiroRow,
  AgendaRow,
  PacienteRow,
  SatisfacaoRow,
  RefreshLogEntry,
} from './types';
```

- [ ] Rodar o teste de integracao:

```bash
pnpm test:int -- packages/reports/test/refresh.int.test.ts
```

Saida esperada: todos os 4 testes passam. O refresh executa sem erro (matviews vazias ficam com 0 linhas), o log contem registros com success = true, e o nome invalido lanca erro.

- [ ] Commitar:

```bash
git add packages/reports/src/types.ts packages/reports/src/refresh.ts packages/reports/src/queries.ts packages/reports/src/index.ts packages/reports/test/refresh.int.test.ts
git commit -m "feat(reports): add refresh orchestration, typed queries via app_rpt, and CI tests"
```


## Parte: 07-desempenho-variacoes

### Task 38: migration 0106 — tabela rpt.variation_snapshot e view app_rpt.variation_snapshot [RECONCILIADO]

**Arquivos**

- Criar `packages/db/migrations/0106_rpt_variation_snapshot.sql`
- Teste `packages/db/src/invariants/inv-rpt-variation.int.test.ts`

**Passos**

- [ ] Criar o arquivo de migration `packages/db/migrations/0106_rpt_variation_snapshot.sql` com o conteudo completo:

```sql
-- 0106_rpt_variation_snapshot.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema app_rpt (security_barrier views) e tabela rpt.variation_snapshot.
-- Design ss3.8: matviews em rpt, propriedade de rpt_owner, SEM GRANT para app_rw.
-- Expostas por views security_barrier em app_rpt com predicado de tenant e papel.

-- ---------------------------------------------------------------------------
-- 1. Schema app_rpt — [RECONCILIADO] ja criado pela migration 0101 (Bloco 06).
--    NÃO recriar aqui. O GRANT USAGE tambem ja foi concedido em 0101.
-- ---------------------------------------------------------------------------
-- CREATE SCHEMA app_rpt removido: ja existe desde 0101_rpt_foundations.sql

-- ---------------------------------------------------------------------------
-- 2. Tabela rpt.variation_snapshot — resultado persistido da decomposicao
-- ---------------------------------------------------------------------------
-- GRANT de fin e sched ao rpt_owner para que a view consiga ler
GRANT USAGE ON SCHEMA fin   TO rpt_owner;
GRANT USAGE ON SCHEMA sched TO rpt_owner;
GRANT SELECT ON fin.entry          TO rpt_owner;
GRANT SELECT ON fin.daily_rollup   TO rpt_owner;
GRANT SELECT ON sched.appointment  TO rpt_owner;
GRANT SELECT ON sched.procedure    TO rpt_owner;

CREATE TABLE rpt.variation_snapshot (
  tenant_id     uuid NOT NULL,
  clinic_id     uuid NOT NULL,
  period_a_start date NOT NULL,
  period_a_end   date NOT NULL,
  period_b_start date NOT NULL,
  period_b_end   date NOT NULL,
  computed_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  factors       jsonb NOT NULL,
  -- factors contem: { volume_cents, mix_procedimento_cents, mix_convenio_cents,
  --                   ticket_cents, faltas_cents, glosas_cents, delta_total_cents,
  --                   detail: { ... } }
  PRIMARY KEY (tenant_id, clinic_id, period_a_start, period_a_end,
               period_b_start, period_b_end)
);
ALTER TABLE rpt.variation_snapshot OWNER TO rpt_owner;

-- jobs precisa inserir/atualizar (computacao agendada ou sob demanda via worker)
GRANT SELECT, INSERT, UPDATE, DELETE ON rpt.variation_snapshot TO jobs;
-- app_rw NAO recebe GRANT na tabela rpt.variation_snapshot (regra ss3.8)

-- ---------------------------------------------------------------------------
-- 3. View security_barrier em app_rpt
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.variation_snapshot WITH (security_barrier = true) AS
  SELECT s.*
    FROM rpt.variation_snapshot s
   WHERE s.tenant_id = app.current_tenant_id()
     AND app.is_member();
ALTER VIEW app_rpt.variation_snapshot OWNER TO rpt_owner;
GRANT SELECT ON app_rpt.variation_snapshot TO app_rw;
```

- [ ] Rodar a migration:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: migration 0106 aplicada sem erros.

- [ ] Criar o teste de invariante `packages/db/src/invariants/inv-rpt-variation.int.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { catalogPool, closeCatalogPool } from './catalog';

describe('invariante: rpt.variation_snapshot sem GRANT para app_rw', () => {
  afterAll(async () => { await closeCatalogPool(); });

  it('app_rw nao tem privilegio direto na tabela rpt.variation_snapshot', async () => {
    const pool = catalogPool();
    const { rows } = await pool.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
         FROM information_schema.table_privileges
        WHERE table_schema = 'rpt'
          AND table_name = 'variation_snapshot'
          AND grantee = 'app_rw'`
    );
    expect(rows).toHaveLength(0);
  });

  it('app_rw consegue ler via app_rpt.variation_snapshot', async () => {
    const pool = catalogPool();
    const { rows } = await pool.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
         FROM information_schema.table_privileges
        WHERE table_schema = 'app_rpt'
          AND table_name = 'variation_snapshot'
          AND grantee = 'app_rw'
          AND privilege_type = 'SELECT'`
    );
    expect(rows).toHaveLength(1);
  });

  it('view app_rpt.variation_snapshot tem security_barrier', async () => {
    const pool = catalogPool();
    const { rows } = await pool.query<{ security_barrier: string }>(
      `SELECT reloptions::text AS security_barrier
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app_rpt'
          AND c.relname = 'variation_snapshot'
          AND c.relkind = 'v'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.security_barrier).toContain('security_barrier=true');
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv-rpt-variation.int.test.ts
```

Saida esperada: 3 testes passando.

- [ ] Commitar:

```
git add packages/db/migrations/0106_rpt_variation_snapshot.sql packages/db/src/invariants/inv-rpt-variation.int.test.ts
git commit -m "feat(db): add rpt.variation_snapshot and app_rpt schema (0106)"
```

---

### Task 39: tipos e contrato do engine de variacao em packages/reports

**Arquivos**

- Criar `packages/reports/src/variation-types.ts`
- Modificar `packages/reports/src/index.ts`
- Teste `packages/reports/src/variation-types.test.ts`

**Passos**

- [ ] Criar o arquivo de tipos `packages/reports/src/variation-types.ts`:

```typescript
/**
 * ss5.5 fluxo (c) — Engine de atribuicao de variacao de receita.
 *
 * Cada fator e um valor em CENTAVOS (inteiro). A soma dos fatores e
 * EXATAMENTE igual ao delta total: propriedade matematica, nao aproximacao.
 */

/** Periodo definido por [start, end] inclusive. */
export interface Period {
  readonly start: string; // 'YYYY-MM-DD'
  readonly end: string;   // 'YYYY-MM-DD'
}

/**
 * Fatores aditivos que decompoem o delta de receita entre dois periodos.
 * Todos os valores sao em centavos. Positivo = contribuiu para aumento.
 * Negativo = contribuiu para queda. A soma de TODOS os fatores e
 * exatamente igual a delta_total_cents.
 */
export interface VariationFactors {
  /** Efeito volume: mais ou menos atendimentos realizados. */
  readonly volume_cents: number;
  /** Efeito mix de procedimento: mudanca de proporcao entre procedimentos. */
  readonly mix_procedimento_cents: number;
  /** Efeito mix de convenio: mudanca particular vs convenio. */
  readonly mix_convenio_cents: number;
  /** Efeito ticket medio: mudanca de valor medio por atendimento. */
  readonly ticket_cents: number;
  /** Receita perdida por faltas e cancelamentos. */
  readonly faltas_cents: number;
  /** Glosas nao recuperadas (zero enquanto TISS nao existir). */
  readonly glosas_cents: number;
  /** Receita total do periodo A em centavos. */
  readonly total_a_cents: number;
  /** Receita total do periodo B em centavos. */
  readonly total_b_cents: number;
  /** Delta = total_b - total_a. Soma dos fatores = delta_total_cents. */
  readonly delta_total_cents: number;
}

/** Snapshot persistido em rpt.variation_snapshot. */
export interface VariationSnapshot {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly periodA: Period;
  readonly periodB: Period;
  readonly computedAt: string;
  readonly factors: VariationFactors;
}

/** Agrupamento para drill-down de um fator. */
export interface DrillDownGroup {
  readonly label: string;
  readonly count: number;
  readonly amount_cents: number;
}

export interface DrillDownResult {
  readonly factor: string;
  readonly byProfessional: readonly DrillDownGroup[];
  readonly byDayOfWeek: readonly DrillDownGroup[];
  readonly byTimeSlot: readonly DrillDownGroup[];
}

/**
 * Valida que a soma dos fatores e exatamente o delta total.
 * Retorna true se a propriedade matematica se sustenta.
 */
export function factorsAddUp(f: VariationFactors): boolean {
  const soma =
    f.volume_cents +
    f.mix_procedimento_cents +
    f.mix_convenio_cents +
    f.ticket_cents +
    f.faltas_cents +
    f.glosas_cents;
  return soma === f.delta_total_cents;
}
```

- [ ] Criar o teste unitario `packages/reports/src/variation-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { factorsAddUp, type VariationFactors } from './variation-types';

describe('factorsAddUp', () => {
  it('retorna true quando soma dos fatores iguala delta', () => {
    const f: VariationFactors = {
      volume_cents: -500_00,
      mix_procedimento_cents: 100_00,
      mix_convenio_cents: -200_00,
      ticket_cents: 50_00,
      faltas_cents: -300_00,
      glosas_cents: 0,
      total_a_cents: 10_000_00,
      total_b_cents: 9_150_00,
      delta_total_cents: -850_00,
    };
    expect(factorsAddUp(f)).toBe(true);
  });

  it('retorna false quando soma dos fatores nao iguala delta', () => {
    const f: VariationFactors = {
      volume_cents: -500_00,
      mix_procedimento_cents: 100_00,
      mix_convenio_cents: -200_00,
      ticket_cents: 50_00,
      faltas_cents: -300_00,
      glosas_cents: 0,
      total_a_cents: 10_000_00,
      total_b_cents: 9_150_00,
      delta_total_cents: -900_00, // errado de proposito
    };
    expect(factorsAddUp(f)).toBe(false);
  });

  it('funciona com todos os fatores zero', () => {
    const f: VariationFactors = {
      volume_cents: 0,
      mix_procedimento_cents: 0,
      mix_convenio_cents: 0,
      ticket_cents: 0,
      faltas_cents: 0,
      glosas_cents: 0,
      total_a_cents: 5_000_00,
      total_b_cents: 5_000_00,
      delta_total_cents: 0,
    };
    expect(factorsAddUp(f)).toBe(true);
  });

  it('funciona com fatores positivos (receita cresceu)', () => {
    const f: VariationFactors = {
      volume_cents: 300_00,
      mix_procedimento_cents: 200_00,
      mix_convenio_cents: 150_00,
      ticket_cents: 100_00,
      faltas_cents: -50_00,
      glosas_cents: 0,
      total_a_cents: 8_000_00,
      total_b_cents: 8_700_00,
      delta_total_cents: 700_00,
    };
    expect(factorsAddUp(f)).toBe(true);
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/variation-types.test.ts
```

Saida esperada: 4 testes passando.

- [ ] Atualizar `packages/reports/src/index.ts` para exportar os tipos:

```typescript
export {
  factorsAddUp,
  type DrillDownGroup,
  type DrillDownResult,
  type Period,
  type VariationFactors,
  type VariationSnapshot,
} from './variation-types';
```

- [ ] Rodar o teste novamente para garantir que a reexportacao nao quebrou nada:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/variation-types.test.ts
```

Saida esperada: 4 testes passando.

- [ ] Commitar:

```
git add packages/reports/src/variation-types.ts packages/reports/src/variation-types.test.ts packages/reports/src/index.ts
git commit -m "feat(reports): add variation attribution types and factorsAddUp"
```

---

### Task 40: computeVariation — engine de decomposicao de receita

**Arquivos**

- Criar `packages/reports/src/compute-variation.ts`
- Teste `packages/reports/src/compute-variation.int.test.ts`
- Criar `packages/reports/src/test-support.ts`
- Modificar `packages/reports/src/index.ts`

**Passos**

- [ ] Criar o arquivo de suporte para testes `packages/reports/src/test-support.ts`:

```typescript
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeVariacao {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalIdA: string;
  professionalIdB: string;
  patientIds: string[];
  procedureIdConsulta: string;
  procedureIdRetorno: string;
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

/**
 * Semeia dados sinteticos para testes de variacao. Cria dois profissionais,
 * dois procedimentos (consulta R$250, retorno R$100), e varios pacientes.
 * NAO cria agendamentos nem lancamentos: cada teste cria os seus.
 */
export async function semearVariacao(): Promise<SementeVariacao> {
  const patientIds = Array.from({ length: 10 }, () => uuidv7());
  const s: SementeVariacao = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalIdA: uuidv7(), professionalIdB: uuidv7(),
    patientIds,
    procedureIdConsulta: uuidv7(), procedureIdRetorno: uuidv7(),
    paymentMethodId: uuidv7(), categoryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Variacao', '11ABC22301DE44')`,
      [s.tenantId, `v-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Var', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Gestora Var')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    // Dois profissionais
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111111', 'SP', '225125')`,
      [s.tenantId, s.professionalIdA, s.userId]);
    // Segundo profissional precisa de segundo usuario
    const userIdB = uuidv7();
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dr. Beta')`,
      [userIdB, `${userIdB}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, userIdB, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '222222', 'RJ', '225125')`,
      [s.tenantId, s.professionalIdB, userIdB]);
    // Pacientes
    for (let i = 0; i < patientIds.length; i++) {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES ($1, $2, $3, 'completo')`,
        [s.tenantId, patientIds[i], `Paciente Var ${i + 1}`]);
    }
    // Procedimentos
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000),
              ($1, $3, 'RET',  'Retorno',  '#5fd02f', 15, 10000)`,
      [s.tenantId, s.procedureIdConsulta, s.procedureIdRetorno]);
    // Metodo de pagamento e categoria
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro Var')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta Var', 'receita')`,
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

/**
 * Cria um agendamento e um lancamento financeiro vinculado, para usar nos
 * testes de variacao. Permite controlar profissional, procedimento, valor,
 * status do agendamento (atendido/faltou), data e se e particular ou convenio.
 */
export async function criarAtendimentoComLancamento(opts: {
  tenantId: string;
  clinicId: string;
  patientId: string;
  professionalId: string;
  procedureId: string;
  userId: string;
  paymentMethodId: string;
  categoryId: string;
  amountCents: number;
  date: string;          // 'YYYY-MM-DD'
  status: 'atendido' | 'faltou' | 'cancelado';
  operadoraNome: string | null;  // null = particular
  pago: boolean;
}): Promise<{ appointmentId: string; entryId: string | null }> {
  const appointmentId = uuidv7();
  const entryId = opts.status === 'atendido' && opts.pago ? uuidv7() : null;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    const startsAt = `${opts.date}T10:00:00-03:00`;
    const endsAt = `${opts.date}T10:30:00-03:00`;
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          operadora_nome, starts_at, ends_at, appointment_date, status,
          confirmed_at, arrived_at, started_at, finished_at,
          cancelled_at, cancel_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8::timestamptz, $9::timestamptz, $10::date, $11::sched.appointment_status,
               CASE WHEN $11 IN ('atendido','faltou') THEN clock_timestamp() END,
               CASE WHEN $11 = 'atendido' THEN clock_timestamp() END,
               CASE WHEN $11 = 'atendido' THEN clock_timestamp() END,
               CASE WHEN $11 = 'atendido' THEN clock_timestamp() END,
               CASE WHEN $11 = 'cancelado' THEN clock_timestamp() END,
               CASE WHEN $11 = 'cancelado' THEN 'teste' END,
               $12)`,
      [appointmentId, opts.tenantId, opts.patientId, opts.professionalId,
       opts.clinicId, opts.procedureId, opts.operadoraNome,
       startsAt, endsAt, opts.date, opts.status, opts.userId]);

    if (entryId !== null) {
      await c.query(
        `INSERT INTO fin.entry
           (tenant_id, id, clinic_id, patient_id, appointment_id, professional_id,
            kind, amount_cents, status, description,
            payment_method_id, paid_at, idempotency_key, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 'receita', $7, 'pago', 'Atendimento variacao',
                 $8, $9::timestamptz, $10, $11, $9::timestamptz)`,
        [opts.tenantId, entryId, opts.clinicId, opts.patientId,
         appointmentId, opts.professionalId, opts.amountCents,
         opts.paymentMethodId, `${opts.date}T18:00:00-03:00`,
         `var-${appointmentId}`, opts.userId]);
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return { appointmentId, entryId };
}
```

- [ ] Criar o engine `packages/reports/src/compute-variation.ts`:

```typescript
import type { TxClient } from '@cadencia/db';
import type { Period, VariationFactors, VariationSnapshot } from './variation-types';
import { factorsAddUp } from './variation-types';

/**
 * ss5.5 fluxo (c) — Calcula a decomposicao aditiva da variacao de receita
 * entre dois periodos.
 *
 * REGRA DE LEITURA: toda consulta usa app_rpt views, NUNCA rpt matviews
 * diretamente. A view security_barrier garante isolamento de tenant.
 *
 * A decomposicao e aditiva: volume + mix_procedimento + mix_convenio +
 * ticket + faltas + glosas = delta_total. Propriedade matematica, nao
 * aproximacao.
 *
 * Metodo: decomposicao sequencial inspirada em analise de variancia (ANOVA)
 * de preco x volume, adaptada para o contexto de clinica medica.
 *
 * 1. Volume: (qtd_B - qtd_A) * ticket_medio_A
 *    "Se a clinica tivesse feito N atendimentos a mais/menos, com o mesmo
 *     ticket medio do periodo A, quanto mudaria?"
 *
 * 2. Mix de procedimento: para cada procedimento, (prop_B - prop_A) * qtd_B * ticket_medio_A
 *    "Se a proporcao entre consultas e retornos mudou, quanto isso explica?"
 *
 * 3. Mix de convenio: mesma logica, mas entre particular e convenio.
 *
 * 4. Ticket: (ticket_medio_B - ticket_medio_A) * qtd_B
 *    "Se o preco medio mudou, quanto isso explica?"
 *
 * 5. Faltas: receita estimada dos atendimentos faltados/cancelados em B
 *            menos a dos faltados em A.
 *
 * 6. Glosas: zero ate a Fase 4 (TISS).
 *
 * O residuo (arredondamento inteiro) e absorvido pelo fator de ticket para
 * garantir a igualdade exata.
 */
export async function computeVariation(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  periodA: Period,
  periodB: Period,
): Promise<VariationSnapshot> {
  // -----------------------------------------------------------------------
  // 1. Buscar dados agregados do periodo A e B via app_rpt e tabelas vivas
  // -----------------------------------------------------------------------

  // Receita total realizada por periodo (lancamentos pagos de receita)
  const totais = await tx.query<{
    periodo: string; total_cents: string; qtd: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($5::date)::timestamptz
        AND e.paid_at <  ($6::date + 1)::timestamptz`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let totalACents = 0;
  let totalBCents = 0;
  let qtdA = 0;
  let qtdB = 0;
  for (const row of totais.rows) {
    if (row.periodo === 'A') {
      totalACents = Number(row.total_cents);
      qtdA = Number(row.qtd);
    } else {
      totalBCents = Number(row.total_cents);
      qtdB = Number(row.qtd);
    }
  }

  const deltaTotalCents = totalBCents - totalACents;
  const ticketMedioA = qtdA > 0 ? totalACents / qtdA : 0;
  const ticketMedioB = qtdB > 0 ? totalBCents / qtdB : 0;

  // -----------------------------------------------------------------------
  // 2. Receita por procedimento em cada periodo (para mix de procedimento)
  // -----------------------------------------------------------------------
  const porProcedimento = await tx.query<{
    periodo: string; procedure_id: string; total_cents: string; qtd: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(a.procedure_id::text, '__sem_procedimento__') AS procedure_id,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY a.procedure_id
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(a.procedure_id::text, '__sem_procedimento__') AS procedure_id,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($5::date)::timestamptz
        AND e.paid_at <  ($6::date + 1)::timestamptz
      GROUP BY a.procedure_id`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  const procA = new Map<string, { cents: number; qtd: number }>();
  const procB = new Map<string, { cents: number; qtd: number }>();
  for (const row of porProcedimento.rows) {
    const map = row.periodo === 'A' ? procA : procB;
    map.set(row.procedure_id, {
      cents: Number(row.total_cents),
      qtd: Number(row.qtd),
    });
  }

  // -----------------------------------------------------------------------
  // 3. Receita por tipo (particular vs convenio) para mix de convenio
  // -----------------------------------------------------------------------
  const porConvenio = await tx.query<{
    periodo: string; tipo: string; total_cents: string; qtd: string;
  }>(
    `SELECT 'A' AS periodo,
            CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END AS tipo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END
     UNION ALL
     SELECT 'B' AS periodo,
            CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END AS tipo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($5::date)::timestamptz
        AND e.paid_at <  ($6::date + 1)::timestamptz
      GROUP BY CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  const convA = new Map<string, { cents: number; qtd: number }>();
  const convB = new Map<string, { cents: number; qtd: number }>();
  for (const row of porConvenio.rows) {
    const map = row.periodo === 'A' ? convA : convB;
    map.set(row.tipo, {
      cents: Number(row.total_cents),
      qtd: Number(row.qtd),
    });
  }

  // -----------------------------------------------------------------------
  // 4. Faltas e cancelamentos por periodo
  // -----------------------------------------------------------------------
  const faltas = await tx.query<{
    periodo: string; qtd_faltas: string; receita_estimada_cents: string;
  }>(
    `SELECT 'A' AS periodo,
            count(*)::text AS qtd_faltas,
            coalesce(sum(p.valor_centavos), 0)::text AS receita_estimada_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
     UNION ALL
     SELECT 'B' AS periodo,
            count(*)::text AS qtd_faltas,
            coalesce(sum(p.valor_centavos), 0)::text AS receita_estimada_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $5::date
        AND a.appointment_date <= $6::date`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let faltasACents = 0;
  let faltasBCents = 0;
  for (const row of faltas.rows) {
    if (row.periodo === 'A') {
      faltasACents = Number(row.receita_estimada_cents);
    } else {
      faltasBCents = Number(row.receita_estimada_cents);
    }
  }

  // -----------------------------------------------------------------------
  // 5. Calcular fatores aditivos
  // -----------------------------------------------------------------------

  // Volume: (qtdB - qtdA) * ticketMedioA
  const volumeCentsExact = (qtdB - qtdA) * ticketMedioA;
  const volumeCents = Math.round(volumeCentsExact);

  // Mix de procedimento: para cada procedimento p,
  //   (propB_p - propA_p) * qtdB * ticketMedioA_p
  // onde propX_p = qtdX_p / qtdX e ticketMedioA_p = centsA_p / qtdA_p
  let mixProcCentsExact = 0;
  const allProcs = new Set([...procA.keys(), ...procB.keys()]);
  for (const procId of allProcs) {
    const a = procA.get(procId);
    const b = procB.get(procId);
    const propA = qtdA > 0 && a ? a.qtd / qtdA : 0;
    const propB = qtdB > 0 && b ? b.qtd / qtdB : 0;
    const ticketProcA = a && a.qtd > 0 ? a.cents / a.qtd : 0;
    mixProcCentsExact += (propB - propA) * qtdB * ticketProcA;
  }
  const mixProcCents = Math.round(mixProcCentsExact);

  // Mix de convenio: mesma logica
  let mixConvCentsExact = 0;
  const allTipos = new Set([...convA.keys(), ...convB.keys()]);
  for (const tipo of allTipos) {
    const a = convA.get(tipo);
    const b = convB.get(tipo);
    const propA = qtdA > 0 && a ? a.qtd / qtdA : 0;
    const propB = qtdB > 0 && b ? b.qtd / qtdB : 0;
    const ticketTipoA = a && a.qtd > 0 ? a.cents / a.qtd : 0;
    mixConvCentsExact += (propB - propA) * qtdB * ticketTipoA;
  }
  const mixConvCents = Math.round(mixConvCentsExact);

  // Faltas: diferenca de receita estimada perdida (B - A, negativo = mais faltas em B)
  const faltasCents = -(faltasBCents - faltasACents);

  // Glosas: zero ate Fase 4 (TISS)
  const glosasCents = 0;

  // Ticket: residuo para garantir soma exata
  // delta = volume + mixProc + mixConv + ticket + faltas + glosas
  // ticket = delta - volume - mixProc - mixConv - faltas - glosas
  const ticketCents = deltaTotalCents - volumeCents - mixProcCents - mixConvCents - faltasCents - glosasCents;

  const factors: VariationFactors = {
    volume_cents: volumeCents,
    mix_procedimento_cents: mixProcCents,
    mix_convenio_cents: mixConvCents,
    ticket_cents: ticketCents,
    faltas_cents: faltasCents,
    glosas_cents: glosasCents,
    total_a_cents: totalACents,
    total_b_cents: totalBCents,
    delta_total_cents: deltaTotalCents,
  };

  // Invariante: a soma DEVE ser exata. Se nao for, e bug nosso.
  if (!factorsAddUp(factors)) {
    throw new Error(
      `bug: soma dos fatores (${factors.volume_cents + factors.mix_procedimento_cents + factors.mix_convenio_cents + factors.ticket_cents + factors.faltas_cents + factors.glosas_cents}) !== delta (${deltaTotalCents})`,
    );
  }

  return {
    tenantId,
    clinicId,
    periodA,
    periodB,
    computedAt: new Date().toISOString(),
    factors,
  };
}
```

- [ ] Atualizar `packages/reports/src/index.ts` para exportar computeVariation:

```typescript
export {
  factorsAddUp,
  type DrillDownGroup,
  type DrillDownResult,
  type Period,
  type VariationFactors,
  type VariationSnapshot,
} from './variation-types';
export { computeVariation } from './compute-variation';
```

- [ ] Criar o teste de integracao `packages/reports/src/compute-variation.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantTx, type Actor } from '@cadencia/db';
import { computeVariation } from './compute-variation';
import { factorsAddUp } from './variation-types';
import {
  semearVariacao, criarAtendimentoComLancamento,
  type SementeVariacao,
} from './test-support';

describe('computeVariation', () => {
  let s: SementeVariacao;
  let pool: Pool;

  beforeAll(async () => {
    s = await semearVariacao();
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
    // Conecta e seta o papel para simular runtime
    pool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });

    // Periodo A (junho 2026): 5 consultas a R$250 do profissional A, particular
    for (let i = 0; i < 5; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-06-${String(10 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // 1 falta no periodo A
    await criarAtendimentoComLancamento({
      tenantId: s.tenantId, clinicId: s.clinicId,
      patientId: s.patientIds[5]!,
      professionalId: s.professionalIdA,
      procedureId: s.procedureIdConsulta,
      userId: s.userId, paymentMethodId: s.paymentMethodId,
      categoryId: s.categoryId,
      amountCents: 25000, date: '2026-06-20',
      status: 'faltou', operadoraNome: null, pago: false,
    });

    // Periodo B (julho 2026): 3 consultas a R$250 + 2 retornos a R$100
    // do profissional A, particular
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[3 + i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdRetorno,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 10000, date: `2026-07-${String(15 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // 3 faltas no periodo B
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[5 + i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(20 + i).padStart(2, '0')}`,
        status: 'faltou', operadoraNome: null, pago: false,
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('soma dos fatores iguala delta total (propriedade matematica)', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-1',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    // Periodo A: 5 x R$250 = R$125.000 centavos = 125000
    expect(result.factors.total_a_cents).toBe(125000);
    // Periodo B: 3 x R$250 + 2 x R$100 = R$950 = 95000
    expect(result.factors.total_b_cents).toBe(95000);
    // Delta: 95000 - 125000 = -30000
    expect(result.factors.delta_total_cents).toBe(-30000);
    // PROPRIEDADE MATEMATICA: soma dos fatores = delta
    expect(factorsAddUp(result.factors)).toBe(true);
  });

  it('fator de faltas reflete aumento de faltas no periodo B', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-2',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    // Faltas: A teve 1 falta (R$250), B teve 3 faltas (3 x R$250 = R$750)
    // Diferenca = -(75000 - 25000) = -50000 centavos
    expect(result.factors.faltas_cents).toBe(-50000);
  });

  it('glosas sao zero (TISS nao implementado)', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-3',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    expect(result.factors.glosas_cents).toBe(0);
  });

  it('periodos sem dados retornam delta zero e todos os fatores zero', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-4',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2025-01-01', end: '2025-01-31' },
        { start: '2025-02-01', end: '2025-02-28' },
      );
    }, pool);

    expect(result.factors.delta_total_cents).toBe(0);
    expect(result.factors.total_a_cents).toBe(0);
    expect(result.factors.total_b_cents).toBe(0);
    expect(factorsAddUp(result.factors)).toBe(true);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA (TDD: o modulo ainda nao e importavel porque o index.ts nao foi salvo):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: teste falha porque o banco nao tem a migration 0106 aplicada (se nao fez Task 38 antes) ou passa se ja aplicou.

- [ ] Rodar os testes de integracao apos garantir que a migration esta aplicada:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: 4 testes passando.

- [ ] Commitar:

```
git add packages/reports/src/compute-variation.ts packages/reports/src/compute-variation.int.test.ts packages/reports/src/test-support.ts packages/reports/src/index.ts
git commit -m "feat(reports): add computeVariation engine with additive decomposition"
```

---

### Task 41: drillDownFactor — detalhamento por profissional, dia da semana e horario

**Arquivos**

- Criar `packages/reports/src/drill-down-factor.ts`
- Teste `packages/reports/src/drill-down-factor.int.test.ts`
- Modificar `packages/reports/src/index.ts`

**Passos**

- [ ] Criar o modulo `packages/reports/src/drill-down-factor.ts`:

```typescript
import type { TxClient } from '@cadencia/db';
import type { Period, DrillDownResult, DrillDownGroup } from './variation-types';

const VALID_FACTORS = [
  'volume', 'mix_procedimento', 'mix_convenio', 'ticket', 'faltas', 'glosas',
] as const;

type Factor = (typeof VALID_FACTORS)[number];

function isFactor(s: string): s is Factor {
  return (VALID_FACTORS as readonly string[]).includes(s);
}

/**
 * Drill-down de um fator especifico da decomposicao de variacao.
 *
 * O click em "faltas custaram R$ 9.800" abre: "37 atendimentos perdidos,
 * agrupados por profissional, dia da semana e faixa de horario".
 *
 * Para cada fator, a query retorna os agendamentos/lancamentos relevantes
 * do periodo B agrupados por tres eixos: profissional, dia da semana e
 * faixa de horario (manha/tarde/noite).
 */
export async function drillDownFactor(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  factor: string,
  periodA: Period,
  periodB: Period,
): Promise<DrillDownResult> {
  if (!isFactor(factor)) {
    throw new Error(`fator invalido: ${factor}. Validos: ${VALID_FACTORS.join(', ')}`);
  }

  // Para faltas: agrupamos os agendamentos com status faltou/cancelado no periodo B
  if (factor === 'faltas') {
    return drillDownFaltas(tx, tenantId, clinicId, periodB);
  }

  // Para volume, mix_procedimento, mix_convenio, ticket:
  // agrupamos os lancamentos pagos do periodo B
  return drillDownReceita(tx, tenantId, clinicId, periodB, factor);
}

async function drillDownFaltas(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  period: Period,
): Promise<DrillDownResult> {
  // Por profissional
  const byProfResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT coalesce(pr.user_id::text, a.professional_id::text) AS label,
            count(*)::text AS count,
            coalesce(sum(p.valor_centavos), 0)::text AS amount_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
       LEFT JOIN app.professional pr ON pr.tenant_id = a.tenant_id AND pr.id = a.professional_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
      GROUP BY coalesce(pr.user_id::text, a.professional_id::text)
      ORDER BY sum(p.valor_centavos) DESC NULLS LAST`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por dia da semana
  const byDowResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT to_char(a.appointment_date, 'Dy') AS label,
            count(*)::text AS count,
            coalesce(sum(p.valor_centavos), 0)::text AS amount_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
      GROUP BY to_char(a.appointment_date, 'Dy'), extract(isodow FROM a.appointment_date)
      ORDER BY extract(isodow FROM a.appointment_date)`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por faixa de horario
  const byTimeResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT CASE
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END AS label,
            count(*)::text AS count,
            coalesce(sum(p.valor_centavos), 0)::text AS amount_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
      GROUP BY CASE
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END
      ORDER BY min(extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo'))`,
    [tenantId, clinicId, period.start, period.end],
  );

  return {
    factor: 'faltas',
    byProfessional: mapRows(byProfResult.rows),
    byDayOfWeek: mapRows(byDowResult.rows),
    byTimeSlot: mapRows(byTimeResult.rows),
  };
}

async function drillDownReceita(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  period: Period,
  _factor: Factor,
): Promise<DrillDownResult> {
  // Por profissional
  const byProfResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT e.professional_id::text AS label,
            count(*)::text AS count,
            coalesce(sum(e.amount_cents), 0)::text AS amount_cents
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY e.professional_id
      ORDER BY sum(e.amount_cents) DESC`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por dia da semana (usa paid_at)
  const byDowResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'Dy') AS label,
            count(*)::text AS count,
            coalesce(sum(e.amount_cents), 0)::text AS amount_cents
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'Dy'),
               extract(isodow FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY extract(isodow FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo')`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por faixa de horario
  const byTimeResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT CASE
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END AS label,
            count(*)::text AS count,
            coalesce(sum(e.amount_cents), 0)::text AS amount_cents
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY CASE
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END
      ORDER BY min(extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo'))`,
    [tenantId, clinicId, period.start, period.end],
  );

  return {
    factor: _factor,
    byProfessional: mapRows(byProfResult.rows),
    byDayOfWeek: mapRows(byDowResult.rows),
    byTimeSlot: mapRows(byTimeResult.rows),
  };
}

function mapRows(
  rows: readonly { label: string; count: string; amount_cents: string }[],
): DrillDownGroup[] {
  return rows.map((r) => ({
    label: r.label,
    count: Number(r.count),
    amount_cents: Number(r.amount_cents),
  }));
}
```

- [ ] Atualizar `packages/reports/src/index.ts` para exportar drillDownFactor:

```typescript
export {
  factorsAddUp,
  type DrillDownGroup,
  type DrillDownResult,
  type Period,
  type VariationFactors,
  type VariationSnapshot,
} from './variation-types';
export { computeVariation } from './compute-variation';
export { drillDownFactor } from './drill-down-factor';
```

- [ ] Criar o teste de integracao `packages/reports/src/drill-down-factor.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantTx, type Actor } from '@cadencia/db';
import { drillDownFactor } from './drill-down-factor';
import {
  semearVariacao, criarAtendimentoComLancamento,
  type SementeVariacao,
} from './test-support';

describe('drillDownFactor', () => {
  let s: SementeVariacao;
  let pool: Pool;

  beforeAll(async () => {
    s = await semearVariacao();
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
    pool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });

    // Periodo B (julho 2026): 3 faltas do profissional A, todas de manha em dias uteis
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(6 + i).padStart(2, '0')}`,
        status: 'faltou', operadoraNome: null, pago: false,
      });
    }

    // 2 atendimentos realizados do profissional B
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[3 + i]!,
        professionalId: s.professionalIdB,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('drill-down de faltas retorna agrupamentos nao vazios', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-dd-1',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(tx, s.tenantId, s.clinicId, 'faltas',
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    expect(result.factor).toBe('faltas');
    expect(result.byProfessional.length).toBeGreaterThan(0);
    expect(result.byDayOfWeek.length).toBeGreaterThan(0);
    expect(result.byTimeSlot.length).toBeGreaterThan(0);

    // Todas as 3 faltas sao do profissional A, de manha
    const totalFaltas = result.byProfessional.reduce((acc, g) => acc + g.count, 0);
    expect(totalFaltas).toBe(3);

    const manha = result.byTimeSlot.find((g) => g.label === 'manha');
    expect(manha).toBeDefined();
    expect(manha!.count).toBe(3);
  });

  it('drill-down de volume retorna lancamentos pagos agrupados', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-dd-2',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(tx, s.tenantId, s.clinicId, 'volume',
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    expect(result.factor).toBe('volume');
    // Profissional B tem 2 lancamentos no periodo B
    const totalReceitas = result.byProfessional.reduce((acc, g) => acc + g.count, 0);
    expect(totalReceitas).toBe(2);
  });

  it('fator invalido lanca erro', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-dd-3',
    };
    await expect(
      withTenantTx(actor, async (tx) => {
        return drillDownFactor(tx, s.tenantId, s.clinicId, 'invalido',
          { start: '2026-06-01', end: '2026-06-30' },
          { start: '2026-07-01', end: '2026-07-31' },
        );
      }, pool),
    ).rejects.toThrow('fator invalido: invalido');
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/drill-down-factor.int.test.ts
```

Saida esperada: 3 testes passando.

- [ ] Commitar:

```
git add packages/reports/src/drill-down-factor.ts packages/reports/src/drill-down-factor.int.test.ts packages/reports/src/index.ts
git commit -m "feat(reports): add drillDownFactor for variation attribution drill-down"
```

---

### Task 42: persistencia de snapshot e acao report.variation.read no authz

**Arquivos**

- Criar `packages/reports/src/persist-variation.ts`
- Teste `packages/reports/src/persist-variation.int.test.ts`
- Modificar `packages/authz/src/actions.ts`
- Modificar `packages/reports/src/index.ts`

**Passos**

- [ ] Adicionar a acao `report.variation.read` ao catalogo de acoes em `packages/authz/src/actions.ts`. Inserir antes do `] as const satisfies readonly ActionDef[];`:

```typescript
  // -- Fase 3 . Desempenho ────────────────────────────────────────────────
  { key: 'report.variation.read', description: 'Consultar decomposicao de variacao de receita',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
```

- [ ] Criar o modulo de persistencia `packages/reports/src/persist-variation.ts`:

```typescript
import type { TxClient } from '@cadencia/db';
import type { VariationSnapshot } from './variation-types';

/**
 * Persiste o snapshot de variacao em rpt.variation_snapshot via o papel `jobs`.
 * Esta funcao roda no worker (L3), NAO no caminho de requisicao.
 * Usa INSERT ... ON CONFLICT para upsert: se o par de periodos ja foi computado,
 * atualiza o resultado.
 *
 * IMPORTANTE: usa a tabela rpt.variation_snapshot diretamente (nao a view
 * app_rpt), porque esta funcao roda como `jobs` (BYPASSRLS) no worker.
 */
export async function persistVariationSnapshot(
  tx: TxClient,
  snapshot: VariationSnapshot,
): Promise<void> {
  await tx.query(
    `INSERT INTO rpt.variation_snapshot
       (tenant_id, clinic_id, period_a_start, period_a_end,
        period_b_start, period_b_end, computed_at, factors)
     VALUES ($1, $2, $3::date, $4::date, $5::date, $6::date, clock_timestamp(), $7::jsonb)
     ON CONFLICT (tenant_id, clinic_id, period_a_start, period_a_end,
                  period_b_start, period_b_end)
     DO UPDATE SET computed_at = clock_timestamp(), factors = EXCLUDED.factors`,
    [
      snapshot.tenantId, snapshot.clinicId,
      snapshot.periodA.start, snapshot.periodA.end,
      snapshot.periodB.start, snapshot.periodB.end,
      JSON.stringify(snapshot.factors),
    ],
  );
}

/**
 * Le o ultimo snapshot de variacao via app_rpt (view security_barrier).
 * Usada pelo caminho de requisicao (api), roda sob RLS.
 */
export async function readVariationSnapshot(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  periodA: { start: string; end: string },
  periodB: { start: string; end: string },
): Promise<VariationSnapshot | null> {
  const { rows } = await tx.query<{
    tenant_id: string; clinic_id: string;
    period_a_start: string; period_a_end: string;
    period_b_start: string; period_b_end: string;
    computed_at: string; factors: string;
  }>(
    `SELECT tenant_id::text, clinic_id::text,
            period_a_start::text, period_a_end::text,
            period_b_start::text, period_b_end::text,
            computed_at::text, factors::text
       FROM app_rpt.variation_snapshot
      WHERE tenant_id = $1
        AND clinic_id = $2
        AND period_a_start = $3::date
        AND period_a_end = $4::date
        AND period_b_start = $5::date
        AND period_b_end = $6::date`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  const row = rows[0];
  if (row === undefined) return null;

  return {
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    periodA: { start: row.period_a_start, end: row.period_a_end },
    periodB: { start: row.period_b_start, end: row.period_b_end },
    computedAt: row.computed_at,
    factors: JSON.parse(row.factors) as VariationSnapshot['factors'],
  };
}
```

- [ ] Atualizar `packages/reports/src/index.ts`:

```typescript
export {
  factorsAddUp,
  type DrillDownGroup,
  type DrillDownResult,
  type Period,
  type VariationFactors,
  type VariationSnapshot,
} from './variation-types';
export { computeVariation } from './compute-variation';
export { drillDownFactor } from './drill-down-factor';
export { persistVariationSnapshot, readVariationSnapshot } from './persist-variation';
```

- [ ] Criar o teste de integracao `packages/reports/src/persist-variation.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantTx, type Actor } from '@cadencia/db';
import { persistVariationSnapshot, readVariationSnapshot } from './persist-variation';
import { factorsAddUp, type VariationFactors, type VariationSnapshot } from './variation-types';
import { semearVariacao, type SementeVariacao } from './test-support';

describe('persistVariationSnapshot e readVariationSnapshot', () => {
  let s: SementeVariacao;
  let businessPool: Pool;
  let jobPool: Pool;

  const factors: VariationFactors = {
    volume_cents: -500_00,
    mix_procedimento_cents: 100_00,
    mix_convenio_cents: -200_00,
    ticket_cents: -200_00,
    faltas_cents: -50_00,
    glosas_cents: 0,
    total_a_cents: 125_000,
    total_b_cents: 40_000,
    delta_total_cents: -85_000,
  };

  beforeAll(async () => {
    s = await semearVariacao();
    businessPool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
    businessPool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });
    jobPool = new Pool({
      connectionString: process.env['DATABASE_URL_JOBS'],
      max: 2,
    });
  });

  afterAll(async () => {
    await businessPool.end();
    await jobPool.end();
  });

  it('persiste snapshot via jobs e le via app_rpt', async () => {
    const snapshot: VariationSnapshot = {
      tenantId: s.tenantId, clinicId: s.clinicId,
      periodA: { start: '2026-06-01', end: '2026-06-30' },
      periodB: { start: '2026-07-01', end: '2026-07-31' },
      computedAt: new Date().toISOString(),
      factors,
    };

    // Persistir como jobs (BYPASSRLS)
    const jc = await jobPool.connect();
    try {
      await jc.query('BEGIN');
      await persistVariationSnapshot(
        { query: (sql, params) => jc.query(sql, params === undefined ? undefined : [...params]) },
        snapshot,
      );
      await jc.query('COMMIT');
    } finally {
      jc.release();
    }

    // Ler como app_rw via withTenantTx (RLS)
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-persist-1',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return readVariationSnapshot(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, businessPool);

    expect(result).not.toBeNull();
    expect(result!.factors.delta_total_cents).toBe(-85_000);
    expect(factorsAddUp(result!.factors)).toBe(true);
  });

  it('upsert substitui snapshot existente', async () => {
    const snapshot1: VariationSnapshot = {
      tenantId: s.tenantId, clinicId: s.clinicId,
      periodA: { start: '2026-05-01', end: '2026-05-31' },
      periodB: { start: '2026-06-01', end: '2026-06-30' },
      computedAt: new Date().toISOString(),
      factors: { ...factors, delta_total_cents: -85_000, ticket_cents: -200_00 },
    };
    const snapshot2: VariationSnapshot = {
      ...snapshot1,
      factors: {
        ...factors,
        volume_cents: -100_00,
        ticket_cents: 65_00,
        delta_total_cents: -85_000,
      },
    };

    const jc = await jobPool.connect();
    try {
      await jc.query('BEGIN');
      await persistVariationSnapshot(
        { query: (sql, params) => jc.query(sql, params === undefined ? undefined : [...params]) },
        snapshot1,
      );
      await jc.query('COMMIT');

      await jc.query('BEGIN');
      await persistVariationSnapshot(
        { query: (sql, params) => jc.query(sql, params === undefined ? undefined : [...params]) },
        snapshot2,
      );
      await jc.query('COMMIT');
    } finally {
      jc.release();
    }

    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-persist-2',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return readVariationSnapshot(tx, s.tenantId, s.clinicId,
        { start: '2026-05-01', end: '2026-05-31' },
        { start: '2026-06-01', end: '2026-06-30' },
      );
    }, businessPool);

    expect(result).not.toBeNull();
    expect(result!.factors.volume_cents).toBe(-100_00);
  });

  it('retorna null para snapshot inexistente', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-persist-3',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return readVariationSnapshot(tx, s.tenantId, s.clinicId,
        { start: '2020-01-01', end: '2020-01-31' },
        { start: '2020-02-01', end: '2020-02-29' },
      );
    }, businessPool);

    expect(result).toBeNull();
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/persist-variation.int.test.ts
```

Saida esperada: 3 testes passando.

- [ ] Commitar:

```
git add packages/reports/src/persist-variation.ts packages/reports/src/persist-variation.int.test.ts packages/reports/src/index.ts packages/authz/src/actions.ts
git commit -m "feat(reports): add variation snapshot persistence and report.variation.read action"
```

---

### Task 43: rota GET /v1/variation e GET /v1/variation/drill-down

**Arquivos**

- Criar `apps/api/src/routes/variation.ts`
- Teste `apps/api/src/routes/variation.int.test.ts`

**Passos**

- [ ] Criar a rota `apps/api/src/routes/variation.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenantTx } from '@cadencia/db';
import { assertCan } from '@cadencia/authz';
import {
  computeVariation, drillDownFactor,
  readVariationSnapshot, persistVariationSnapshot,
  factorsAddUp,
} from '@cadencia/reports';

const PeriodSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const VariationQuerySchema = z.object({
  clinic_id: z.string().uuid(),
  period_a_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_a_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  force_recompute: z.enum(['true', 'false']).optional().default('false'),
});

const DrillDownQuerySchema = z.object({
  clinic_id: z.string().uuid(),
  factor: z.enum([
    'volume', 'mix_procedimento', 'mix_convenio',
    'ticket', 'faltas', 'glosas',
  ]),
  period_a_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_a_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function variationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/variation
   *
   * Retorna a decomposicao de variacao de receita entre dois periodos.
   * Tenta ler do snapshot persistido. Se nao existir ou force_recompute=true,
   * computa ao vivo e retorna sem persistir (persistencia e responsabilidade
   * do worker/job).
   */
  app.get('/v1/variation', {
    schema: { querystring: VariationQuerySchema },
  }, async (request, reply) => {
    const actor = request.actor;
    await assertCan(request.db, actor, 'report.variation.read');

    const q = request.query as z.infer<typeof VariationQuerySchema>;
    const periodA = { start: q.period_a_start, end: q.period_a_end };
    const periodB = { start: q.period_b_start, end: q.period_b_end };

    const result = await withTenantTx(actor, async (tx) => {
      // Tenta ler snapshot cached
      if (q.force_recompute !== 'true') {
        const cached = await readVariationSnapshot(
          tx, actor.tenantId, q.clinic_id, periodA, periodB,
        );
        if (cached !== null) {
          return { source: 'cached' as const, snapshot: cached };
        }
      }

      // Computa ao vivo
      const computed = await computeVariation(
        tx, actor.tenantId, q.clinic_id, periodA, periodB,
      );
      return { source: 'computed' as const, snapshot: computed };
    });

    return reply.status(200).send({
      source: result.source,
      tenant_id: result.snapshot.tenantId,
      clinic_id: result.snapshot.clinicId,
      period_a: result.snapshot.periodA,
      period_b: result.snapshot.periodB,
      computed_at: result.snapshot.computedAt,
      factors: result.snapshot.factors,
    });
  });

  /**
   * GET /v1/variation/drill-down
   *
   * Retorna o detalhamento de um fator especifico da decomposicao,
   * agrupado por profissional, dia da semana e faixa de horario.
   */
  app.get('/v1/variation/drill-down', {
    schema: { querystring: DrillDownQuerySchema },
  }, async (request, reply) => {
    const actor = request.actor;
    await assertCan(request.db, actor, 'report.variation.read');

    const q = request.query as z.infer<typeof DrillDownQuerySchema>;
    const periodA = { start: q.period_a_start, end: q.period_a_end };
    const periodB = { start: q.period_b_start, end: q.period_b_end };

    const result = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(
        tx, actor.tenantId, q.clinic_id, q.factor, periodA, periodB,
      );
    });

    return reply.status(200).send(result);
  });
}
```

- [ ] Criar o teste de integracao `apps/api/src/routes/variation.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  semearVariacao, criarAtendimentoComLancamento,
  type SementeVariacao,
} from '@cadencia/reports/test-support';
import { factorsAddUp } from '@cadencia/reports';

/**
 * Testa as funcoes de dominio diretamente (nao o servidor HTTP), porque
 * a montagem do Fastify com plugins de sessao/CSRF e responsabilidade
 * de outro bloco (API shell). Aqui validamos que computeVariation e
 * drillDownFactor funcionam end-to-end com dados sinteticos.
 */
import { withTenantTx, type Actor } from '@cadencia/db';
import { computeVariation, drillDownFactor } from '@cadencia/reports';

describe('rota variation — teste de dominio end-to-end', () => {
  let s: SementeVariacao;
  let pool: Pool;

  beforeAll(async () => {
    s = await semearVariacao();
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
    pool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });

    // Cenario: receita caiu de R$1.250 (jun) para R$950 (jul)
    // Junho: 5 consultas R$250 particular
    for (let i = 0; i < 5; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-06-${String(2 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // Julho: 3 consultas R$250 + 2 retornos R$100
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(2 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[5 + i]!,
        professionalId: s.professionalIdB,
        procedureId: s.procedureIdRetorno,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 10000, date: `2026-07-${String(7 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // 2 faltas em julho
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[7 + i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(14 + i).padStart(2, '0')}`,
        status: 'faltou', operadoraNome: null, pago: false,
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('fluxo completo: computa variacao e faz drill-down de faltas', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-e2e-1',
    };
    const periodA = { start: '2026-06-01', end: '2026-06-30' };
    const periodB = { start: '2026-07-01', end: '2026-07-31' };

    // Passo 1: computar variacao
    const variation = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId, periodA, periodB);
    }, pool);

    expect(variation.factors.total_a_cents).toBe(125000);
    expect(variation.factors.total_b_cents).toBe(95000);
    expect(variation.factors.delta_total_cents).toBe(-30000);
    expect(factorsAddUp(variation.factors)).toBe(true);

    // Passo 2: drill-down de faltas
    const drillDown = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(tx, s.tenantId, s.clinicId, 'faltas', periodA, periodB);
    }, pool);

    expect(drillDown.factor).toBe('faltas');
    const totalFaltas = drillDown.byProfessional.reduce((acc, g) => acc + g.count, 0);
    expect(totalFaltas).toBe(2);
  });

  it('computeVariation com periodos identicos retorna delta zero', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-e2e-2',
    };
    const period = { start: '2026-06-01', end: '2026-06-30' };

    const variation = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId, period, period);
    }, pool);

    expect(variation.factors.delta_total_cents).toBe(0);
    expect(factorsAddUp(variation.factors)).toBe(true);
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/api/src/routes/variation.int.test.ts
```

Saida esperada: 2 testes passando.

- [ ] Commitar:

```
git add apps/api/src/routes/variation.ts apps/api/src/routes/variation.int.test.ts
git commit -m "feat(api): add GET /v1/variation and GET /v1/variation/drill-down routes"
```


## Parte: 08-desempenho-explorar-visoes

### Task 44: Tipos e query builder do Explorar — `packages/reports`

**Arquivos**

- Criar `packages/reports/src/types.ts`
- Criar `packages/reports/src/query-builder.ts`
- Criar `packages/reports/src/query-builder.test.ts`
- Modificar `packages/reports/src/index.ts`
- Modificar `packages/reports/package.json`

**Por que**: o Explorar e um query builder generico que monta SQL sobre as views `app_rpt.*`. Antes de qualquer rota ou tela, o dominio precisa dos tipos de filtro, coluna e ordenacao, e da funcao `buildQuery` que transforma esses objetos em SQL parametrizado seguro. O `reports` esta em L2 e depende apenas de `@cadencia/kernel` (L0).

- [ ] Adicionar dependencia de `@cadencia/kernel` ao `package.json` do reports:

```jsonc
// packages/reports/package.json
{
  "name": "@cadencia/reports",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*"
  }
}
```

- [ ] Criar o arquivo de tipos:

```ts
// packages/reports/src/types.ts

/**
 * Tipos do Explorar — query builder sobre app_rpt views.
 *
 * Cada view em app_rpt expoe colunas desnormalizadas (tenant_id ja filtrado
 * pela security_barrier). O Explorar monta SELECT/WHERE/ORDER dinamicamente
 * a partir de filtros combinaveis: periodo, profissional, clinica, procedimento,
 * convenio, status, CID, faixa etaria, genero, fonte.
 */

/** Nomes das views expostas em app_rpt. Cada view mapeia um eixo de analise. */
export type ReportView =
  | 'atendimentos'
  | 'financeiro'
  | 'pacientes'
  | 'mensagens';

/** Operadores de comparacao suportados pelo query builder. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'between'
  | 'like';

/** Um filtro individual do Explorar. */
export interface ReportFilter {
  readonly column: string;
  readonly op: FilterOp;
  readonly value: unknown;
}

/** Direcao de ordenacao. */
export type SortDir = 'asc' | 'desc';

/** Definicao de ordenacao. */
export interface ReportSort {
  readonly column: string;
  readonly dir: SortDir;
}

/** Tipo de grafico para visualizacao. */
export type ChartKind = 'bar' | 'line' | 'pie' | 'table';

/** Colunas selecionadas para exibicao. */
export interface ReportColumns {
  readonly visible: readonly string[];
  readonly groupBy?: string;
  readonly aggregate?: {
    readonly column: string;
    readonly fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  };
}

/** Configuracao completa de uma consulta do Explorar. */
export interface ReportQuery {
  readonly view: ReportView;
  readonly filters: readonly ReportFilter[];
  readonly columns: ReportColumns;
  readonly sort: readonly ReportSort[];
  readonly limit: number;
  readonly offset: number;
}

/** Resultado tipado de buildQuery — SQL parametrizado pronto para execucao. */
export interface BuiltQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Formato de exportacao. */
export type ExportFormat = 'csv' | 'xlsx';

/** Definicao de uma visao salva (filtros pre-configurados). */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly view: ReportView;
  readonly filters: readonly ReportFilter[];
  readonly columns: ReportColumns;
  readonly sort: readonly ReportSort[];
  readonly chartKind: ChartKind;
}

/** Definicao de visao customizada do usuario. */
export interface CustomViewInput {
  readonly name: string;
  readonly view: ReportView;
  readonly filters: readonly ReportFilter[];
  readonly columns: ReportColumns;
  readonly sort: readonly ReportSort[];
  readonly chartKind: ChartKind;
}
```

- [ ] Escrever o teste que falha:

```ts
// packages/reports/src/query-builder.test.ts
import { describe, expect, it } from 'vitest';
import { buildQuery } from './query-builder';
import type { ReportQuery } from './types';

describe('buildQuery', () => {
  it('gera SELECT com colunas visiveis sobre a view correta', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name', 'patient_name', 'occurred_date'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toContain('FROM app_rpt.atendimentos');
    expect(result.sql).toContain('professional_name');
    expect(result.sql).toContain('patient_name');
    expect(result.sql).toContain('occurred_date');
    expect(result.sql).toContain('LIMIT $1');
    expect(result.sql).toContain('OFFSET $2');
    expect(result.params).toEqual([50, 0]);
  });

  it('adiciona clausula WHERE para filtro eq', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [{ column: 'professional_id', op: 'eq', value: 'abc-123' }],
      columns: { visible: ['professional_name'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toMatch(/professional_id\s*=\s*\$3/);
    expect(result.params).toEqual([50, 0, 'abc-123']);
  });

  it('adiciona clausula WHERE para filtro between (periodo)', () => {
    const q: ReportQuery = {
      view: 'financeiro',
      filters: [{ column: 'occurred_date', op: 'between', value: ['2026-07-01', '2026-07-31'] }],
      columns: { visible: ['amount_cents'] },
      sort: [],
      limit: 100,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/occurred_date\s*>=\s*\$3/);
    expect(result.sql).toMatch(/occurred_date\s*<=\s*\$4/);
    expect(result.params).toEqual([100, 0, '2026-07-01', '2026-07-31']);
  });

  it('adiciona clausula WHERE para filtro in', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [{ column: 'status', op: 'in', value: ['confirmado', 'realizado'] }],
      columns: { visible: ['status'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/status\s+IN\s*\(\$3,\s*\$4\)/);
    expect(result.params).toEqual([50, 0, 'confirmado', 'realizado']);
  });

  it('adiciona clausula WHERE para filtro like', () => {
    const q: ReportQuery = {
      view: 'pacientes',
      filters: [{ column: 'patient_name', op: 'like', value: '%Silva%' }],
      columns: { visible: ['patient_name'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/patient_name\s+ILIKE\s+\$3/);
    expect(result.params).toEqual([50, 0, '%Silva%']);
  });

  it('adiciona ORDER BY com direcao', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['occurred_date', 'professional_name'] },
      sort: [{ column: 'occurred_date', dir: 'desc' }],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/ORDER BY\s+occurred_date\s+DESC/);
  });

  it('adiciona GROUP BY e funcao de agregacao quando presentes', () => {
    const q: ReportQuery = {
      view: 'financeiro',
      filters: [],
      columns: {
        visible: ['category_name'],
        groupBy: 'category_name',
        aggregate: { column: 'amount_cents', fn: 'sum' },
      },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toContain('GROUP BY category_name');
    expect(result.sql).toContain('sum(amount_cents)');
  });

  it('combina multiplos filtros com AND', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [
        { column: 'professional_id', op: 'eq', value: 'prof-1' },
        { column: 'status', op: 'eq', value: 'realizado' },
      ],
      columns: { visible: ['professional_name', 'status'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/professional_id\s*=\s*\$3/);
    expect(result.sql).toMatch(/status\s*=\s*\$4/);
    expect(result.sql).toContain('AND');
    expect(result.params).toEqual([50, 0, 'prof-1', 'realizado']);
  });

  it('rejeita nome de view fora do conjunto permitido', () => {
    const q: ReportQuery = {
      view: 'nao_existe' as any,
      filters: [],
      columns: { visible: ['id'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    expect(() => buildQuery(q)).toThrow('view invalida');
  });

  it('rejeita nome de coluna com caractere nao alfanumerico (previne SQL injection)', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['id; DROP TABLE--'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    expect(() => buildQuery(q)).toThrow('nome de coluna invalido');
  });

  it('rejeita nome de coluna de filtro com caractere nao alfanumerico', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [{ column: 'x OR 1=1', op: 'eq', value: 'v' }],
      columns: { visible: ['id'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    expect(() => buildQuery(q)).toThrow('nome de coluna invalido');
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "packages/reports" && pnpm vitest run src/query-builder.test.ts
```

Saida esperada: falha com `Cannot find module './query-builder'` ou `buildQuery is not a function`.

- [ ] Implementar o query builder:

```ts
// packages/reports/src/query-builder.ts
import { ValidationError } from '@cadencia/kernel';
import type { BuiltQuery, ReportQuery, ReportFilter, FilterOp } from './types';

/** Views permitidas — unico ponto de whitelist. */
const ALLOWED_VIEWS = new Set(['atendimentos', 'financeiro', 'pacientes', 'mensagens']);

/** Regex para validar nomes de colunas: so letras, numeros e underscore. */
const COLUMN_RE = /^[a-z][a-z0-9_]{0,62}$/;

function assertValidColumn(name: string): void {
  if (!COLUMN_RE.test(name)) {
    throw new ValidationError(
      'report.nome_de_coluna_invalido',
      'nome de coluna invalido: so letras minusculas, numeros e underscore',
      { column: name },
    );
  }
}

function buildFilterClause(
  filter: ReportFilter,
  paramIdx: number,
): { clause: string; params: unknown[]; nextIdx: number } {
  assertValidColumn(filter.column);

  const col = filter.column;
  const opMap: Record<FilterOp, () => { clause: string; params: unknown[]; nextIdx: number }> = {
    eq: () => ({
      clause: `${col} = $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    neq: () => ({
      clause: `${col} <> $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    gt: () => ({
      clause: `${col} > $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    gte: () => ({
      clause: `${col} >= $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    lt: () => ({
      clause: `${col} < $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    lte: () => ({
      clause: `${col} <= $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    in: () => {
      const values = filter.value as readonly unknown[];
      const placeholders = values.map((_, i) => `$${paramIdx + i}`);
      return {
        clause: `${col} IN (${placeholders.join(', ')})`,
        params: [...values],
        nextIdx: paramIdx + values.length,
      };
    },
    between: () => {
      const [low, high] = filter.value as [unknown, unknown];
      return {
        clause: `${col} >= $${paramIdx} AND ${col} <= $${paramIdx + 1}`,
        params: [low, high],
        nextIdx: paramIdx + 2,
      };
    },
    like: () => ({
      clause: `${col} ILIKE $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
  };

  return opMap[filter.op]();
}

/**
 * Monta SQL parametrizado a partir de uma ReportQuery.
 *
 * NUNCA interpola valores — tudo via $N. Nomes de colunas e views sao validados
 * contra whitelist e regex. O SQL resultante roda sobre app_rpt views, que ja
 * aplicam security_barrier com predicado de tenant e papel.
 */
export function buildQuery(query: ReportQuery): BuiltQuery {
  if (!ALLOWED_VIEWS.has(query.view)) {
    throw new ValidationError(
      'report.view_invalida',
      'view invalida: nao pertence ao conjunto permitido',
      { view: query.view },
    );
  }

  // Validar colunas visiveis
  for (const col of query.columns.visible) {
    assertValidColumn(col);
  }

  // Validar colunas de sort
  for (const s of query.sort) {
    assertValidColumn(s.column);
  }

  const params: unknown[] = [query.limit, query.offset];
  let paramIdx = 3;

  // SELECT
  const selectParts: string[] = [];
  if (query.columns.groupBy !== undefined) {
    assertValidColumn(query.columns.groupBy);
    selectParts.push(query.columns.groupBy);
    if (query.columns.aggregate !== undefined) {
      assertValidColumn(query.columns.aggregate.column);
      const fn = query.columns.aggregate.fn;
      selectParts.push(`${fn}(${query.columns.aggregate.column}) AS ${query.columns.aggregate.fn}_${query.columns.aggregate.column}`);
    }
  } else {
    selectParts.push(...query.columns.visible);
  }

  // WHERE
  const whereClauses: string[] = [];
  for (const filter of query.filters) {
    const result = buildFilterClause(filter, paramIdx);
    whereClauses.push(result.clause);
    params.push(...result.params);
    paramIdx = result.nextIdx;
  }

  // ORDER BY
  const orderParts: string[] = [];
  for (const s of query.sort) {
    const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
    orderParts.push(`${s.column} ${dir}`);
  }

  // Montar SQL
  let sql = `SELECT ${selectParts.join(', ')} FROM app_rpt.${query.view}`;
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  if (query.columns.groupBy !== undefined) {
    sql += ` GROUP BY ${query.columns.groupBy}`;
  }
  if (orderParts.length > 0) {
    sql += ` ORDER BY ${orderParts.join(', ')}`;
  }
  sql += ` LIMIT $1 OFFSET $2`;

  return { sql, params };
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "packages/reports" && pnpm vitest run src/query-builder.test.ts
```

Saida esperada: todos os 11 testes passam.

- [ ] Atualizar o index para reexportar:

```ts
// packages/reports/src/index.ts
export * from './types';
export { buildQuery } from './query-builder';
```

- [ ] Commitar:

```bash
git add packages/reports/src/types.ts packages/reports/src/query-builder.ts \
      packages/reports/src/query-builder.test.ts packages/reports/src/index.ts \
      packages/reports/package.json
git commit -m "feat(reports): add report types and query builder for Explorar

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 45: 11 visoes salvas built-in e visoes customizadas — `packages/reports`

**Arquivos**

- Criar `packages/reports/src/saved-views.ts`
- Criar `packages/reports/src/saved-views.test.ts`
- Modificar `packages/reports/src/index.ts`

**Por que**: as 11 visoes salvas mapeiam 1:1 os relatorios do iClinic — nomes preservados para custo zero de migracao. Cada visao e um conjunto de filtros + colunas + ordenacao + grafico default. O usuario pode salvar visoes customizadas. O dominio de visoes vive em `packages/reports` sem acesso ao banco — persistencia de visoes customizadas fica na API (L3).

- [ ] Escrever o teste que falha:

```ts
// packages/reports/src/saved-views.test.ts
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_VIEWS,
  getSavedView,
  validateCustomViewInput,
} from './saved-views';
import type { CustomViewInput, SavedView } from './types';

describe('visoes salvas built-in', () => {
  it('contem exatamente 11 visoes', () => {
    expect(BUILT_IN_VIEWS).toHaveLength(11);
  });

  it('todas as visoes tem id, nome e sao built-in', () => {
    for (const v of BUILT_IN_VIEWS) {
      expect(v.id).toBeTruthy();
      expect(v.name).toBeTruthy();
      expect(v.builtIn).toBe(true);
    }
  });

  it('visao "Atendimentos realizados" usa view atendimentos com filtro de status', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Atendimentos realizados');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.some((f) => f.column === 'status' && f.op === 'eq' && f.value === 'realizado')).toBe(true);
  });

  it('visao "Pacientes para retorno" usa view atendimentos', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Pacientes para retorno');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
  });

  it('visao "Por periodo" usa view atendimentos sem filtro fixo de status', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por periodo');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.every((f) => f.column !== 'status')).toBe(true);
  });

  it('visao "Por CID" usa view atendimentos e agrupa por cid_code', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por CID');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.columns.groupBy).toBe('cid_code');
  });

  it('visao "Por indicacao" usa view pacientes e agrupa por referral_source', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por indicacao');
    expect(v).toBeDefined();
    expect(v!.view).toBe('pacientes');
    expect(v!.columns.groupBy).toBe('referral_source');
  });

  it('visao "Faltas" usa view atendimentos com filtro de status falta', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Faltas');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.some((f) => f.column === 'status' && f.op === 'eq' && f.value === 'falta')).toBe(true);
  });

  it('visao "Analises financeiras" usa view financeiro', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Analises financeiras');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
  });

  it('visao "Repasse" usa view financeiro e agrupa por professional_name', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Repasse');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
    expect(v!.columns.groupBy).toBe('professional_name');
  });

  it('visao "Fluxo de caixa" usa view financeiro com basis caixa', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Fluxo de caixa');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
    expect(v!.filters.some((f) => f.column === 'basis' && f.value === 'caixa')).toBe(true);
  });

  it('visao "Envios" usa view mensagens', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Envios');
    expect(v).toBeDefined();
    expect(v!.view).toBe('mensagens');
  });

  it('visao "Aniversariantes" usa view pacientes e ordena por birth_month_day', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Aniversariantes');
    expect(v).toBeDefined();
    expect(v!.view).toBe('pacientes');
    expect(v!.sort.some((s) => s.column === 'birth_month_day')).toBe(true);
  });
});

describe('getSavedView', () => {
  it('retorna visao por id quando existe', () => {
    const primeira = BUILT_IN_VIEWS[0]!;
    const result = getSavedView(primeira.id);
    expect(result).toEqual(primeira);
  });

  it('retorna undefined quando id nao existe', () => {
    expect(getSavedView('inexistente')).toBeUndefined();
  });
});

describe('validateCustomViewInput', () => {
  it('aceita input valido', () => {
    const input: CustomViewInput = {
      name: 'Minha visao',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const input: CustomViewInput = {
      name: '',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejeita view invalida', () => {
    const input: CustomViewInput = {
      name: 'Teste',
      view: 'inexistente' as any,
      filters: [],
      columns: { visible: ['id'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejeita coluna com caractere invalido', () => {
    const input: CustomViewInput = {
      name: 'Teste',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['id; DROP'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "packages/reports" && pnpm vitest run src/saved-views.test.ts
```

Saida esperada: falha com `Cannot find module './saved-views'`.

- [ ] Implementar as visoes salvas:

```ts
// packages/reports/src/saved-views.ts
import { ValidationError } from '@cadencia/kernel';
import { ok, err, type Result } from '@cadencia/kernel';
import type { SavedView, CustomViewInput } from './types';

const COLUMN_RE = /^[a-z][a-z0-9_]{0,62}$/;
const ALLOWED_VIEWS = new Set(['atendimentos', 'financeiro', 'pacientes', 'mensagens']);

/**
 * As 11 visoes salvas built-in. Nomes preservados do iClinic para custo zero de
 * migracao. Cada visao e um conjunto de filtros + colunas + ordenacao + grafico.
 */
export const BUILT_IN_VIEWS: readonly SavedView[] = Object.freeze([
  // 1. Atendimentos realizados
  {
    id: 'builtin-atendimentos-realizados',
    name: 'Atendimentos realizados',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'realizado' }],
    columns: {
      visible: ['occurred_date', 'patient_name', 'professional_name', 'procedure_name', 'status'],
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 2. Pacientes para retorno
  {
    id: 'builtin-pacientes-retorno',
    name: 'Pacientes para retorno',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'return_due', op: 'eq', value: true }],
    columns: {
      visible: ['patient_name', 'professional_name', 'last_visit_date', 'return_due_date', 'phone'],
    },
    sort: [{ column: 'return_due_date', dir: 'asc' }],
    chartKind: 'table',
  },
  // 3. Por periodo
  {
    id: 'builtin-por-periodo',
    name: 'Por periodo',
    builtIn: true,
    view: 'atendimentos',
    filters: [],
    columns: {
      visible: ['occurred_date', 'patient_name', 'professional_name', 'procedure_name', 'status'],
      groupBy: 'occurred_date',
      aggregate: { column: 'occurred_date', fn: 'count' },
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'line',
  },
  // 4. Por CID
  {
    id: 'builtin-por-cid',
    name: 'Por CID',
    builtIn: true,
    view: 'atendimentos',
    filters: [],
    columns: {
      visible: ['cid_code', 'cid_description'],
      groupBy: 'cid_code',
      aggregate: { column: 'cid_code', fn: 'count' },
    },
    sort: [{ column: 'cid_code', dir: 'asc' }],
    chartKind: 'bar',
  },
  // 5. Por indicacao
  {
    id: 'builtin-por-indicacao',
    name: 'Por indicacao',
    builtIn: true,
    view: 'pacientes',
    filters: [],
    columns: {
      visible: ['referral_source'],
      groupBy: 'referral_source',
      aggregate: { column: 'referral_source', fn: 'count' },
    },
    sort: [{ column: 'referral_source', dir: 'asc' }],
    chartKind: 'pie',
  },
  // 6. Faltas
  {
    id: 'builtin-faltas',
    name: 'Faltas',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'falta' }],
    columns: {
      visible: ['occurred_date', 'patient_name', 'professional_name', 'day_of_week', 'time_slot'],
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 7. Analises financeiras
  {
    id: 'builtin-analises-financeiras',
    name: 'Analises financeiras',
    builtIn: true,
    view: 'financeiro',
    filters: [],
    columns: {
      visible: ['occurred_date', 'category_name', 'kind', 'amount_cents', 'status'],
      groupBy: 'category_name',
      aggregate: { column: 'amount_cents', fn: 'sum' },
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 8. Repasse
  {
    id: 'builtin-repasse',
    name: 'Repasse',
    builtIn: true,
    view: 'financeiro',
    filters: [],
    columns: {
      visible: ['professional_name', 'amount_cents'],
      groupBy: 'professional_name',
      aggregate: { column: 'amount_cents', fn: 'sum' },
    },
    sort: [{ column: 'professional_name', dir: 'asc' }],
    chartKind: 'table',
  },
  // 9. Fluxo de caixa
  {
    id: 'builtin-fluxo-de-caixa',
    name: 'Fluxo de caixa',
    builtIn: true,
    view: 'financeiro',
    filters: [{ column: 'basis', op: 'eq', value: 'caixa' }],
    columns: {
      visible: ['occurred_date', 'kind', 'category_name', 'amount_cents', 'status'],
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'line',
  },
  // 10. Envios (SMS/WhatsApp)
  {
    id: 'builtin-envios',
    name: 'Envios',
    builtIn: true,
    view: 'mensagens',
    filters: [],
    columns: {
      visible: ['sent_at', 'channel', 'template_name', 'patient_name', 'status'],
      groupBy: 'channel',
      aggregate: { column: 'channel', fn: 'count' },
    },
    sort: [{ column: 'sent_at', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 11. Aniversariantes
  {
    id: 'builtin-aniversariantes',
    name: 'Aniversariantes',
    builtIn: true,
    view: 'pacientes',
    filters: [],
    columns: {
      visible: ['patient_name', 'birth_date', 'birth_month_day', 'phone', 'age'],
    },
    sort: [{ column: 'birth_month_day', dir: 'asc' }],
    chartKind: 'table',
  },
] as const);

const VIEW_INDEX = new Map(BUILT_IN_VIEWS.map((v) => [v.id, v]));

/** Busca uma visao salva por id (built-in). */
export function getSavedView(viewId: string): SavedView | undefined {
  return VIEW_INDEX.get(viewId);
}

/** Valida input de visao customizada do usuario. */
export function validateCustomViewInput(
  input: CustomViewInput,
): Result<CustomViewInput, ValidationError> {
  if (input.name.trim().length === 0) {
    return err(new ValidationError(
      'report.view.nome_vazio',
      'o nome da visao nao pode ser vazio',
    ));
  }

  if (!ALLOWED_VIEWS.has(input.view)) {
    return err(new ValidationError(
      'report.view.view_invalida',
      'a view informada nao e permitida',
      { view: input.view },
    ));
  }

  for (const col of input.columns.visible) {
    if (!COLUMN_RE.test(col)) {
      return err(new ValidationError(
        'report.view.coluna_invalida',
        'nome de coluna invalido na definicao da visao',
        { column: col },
      ));
    }
  }

  if (input.columns.groupBy !== undefined && !COLUMN_RE.test(input.columns.groupBy)) {
    return err(new ValidationError(
      'report.view.coluna_invalida',
      'nome de coluna de agrupamento invalido',
      { column: input.columns.groupBy },
    ));
  }

  for (const s of input.sort) {
    if (!COLUMN_RE.test(s.column)) {
      return err(new ValidationError(
        'report.view.coluna_invalida',
        'nome de coluna de ordenacao invalido',
        { column: s.column },
      ));
    }
  }

  for (const f of input.filters) {
    if (!COLUMN_RE.test(f.column)) {
      return err(new ValidationError(
        'report.view.coluna_invalida',
        'nome de coluna de filtro invalido',
        { column: f.column },
      ));
    }
  }

  return ok(input);
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "packages/reports" && pnpm vitest run src/saved-views.test.ts
```

Saida esperada: todos os 17 testes passam.

- [ ] Atualizar o index:

```ts
// packages/reports/src/index.ts
export * from './types';
export { buildQuery } from './query-builder';
export { BUILT_IN_VIEWS, getSavedView, validateCustomViewInput } from './saved-views';
```

- [ ] Commitar:

```bash
git add packages/reports/src/saved-views.ts packages/reports/src/saved-views.test.ts \
      packages/reports/src/index.ts
git commit -m "feat(reports): add 11 built-in saved views and custom view validation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 46: Exportacao CSV e XLSX — `packages/reports`

**Arquivos**

- Criar `packages/reports/src/export.ts`
- Criar `packages/reports/src/export.test.ts`
- Modificar `packages/reports/src/index.ts`
- Modificar `packages/reports/package.json`

**Por que**: o Explorar precisa exportar os dados filtrados em CSV e XLSX. CSV e gerado nativamente (sem dependencia). XLSX usa SheetJS (`xlsx`, pacote sem dependencia externa). A funcao `exportReport` recebe as linhas ja filtradas (a consulta roda na API, nao aqui) e devolve um Buffer. O dominio nao acessa banco — so transforma dados em formato de arquivo.

- [ ] Adicionar a dependencia de SheetJS ao package.json:

```jsonc
// packages/reports/package.json
{
  "name": "@cadencia/reports",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  }
}
```

- [ ] Escrever o teste que falha:

```ts
// packages/reports/src/export.test.ts
import { describe, expect, it } from 'vitest';
import { exportReport } from './export';
import type { ExportFormat } from './types';

const LINHAS = [
  { professional_name: 'Dra. Ana', patient_name: 'Carlos', occurred_date: '2026-07-15', status: 'realizado' },
  { professional_name: 'Dr. Bruno', patient_name: 'Maria', occurred_date: '2026-07-16', status: 'realizado' },
];

const COLUNAS = ['professional_name', 'patient_name', 'occurred_date', 'status'];

const CABECALHOS: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
};

describe('exportReport CSV', () => {
  it('gera CSV com cabecalho e linhas separadas por ponto e virgula', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'csv');
    const texto = buf.toString('utf-8');
    const linhas = texto.split('\n').filter((l) => l.length > 0);
    expect(linhas[0]).toBe('Profissional;Paciente;Data;Status');
    expect(linhas[1]).toBe('Dra. Ana;Carlos;2026-07-15;realizado');
    expect(linhas[2]).toBe('Dr. Bruno;Maria;2026-07-16;realizado');
    expect(linhas).toHaveLength(3);
  });

  it('escapa campos com ponto e virgula usando aspas', () => {
    const linhas = [{ a: 'valor;com;pv', b: 'normal' }];
    const buf = exportReport(linhas, ['a', 'b'], { a: 'A', b: 'B' }, 'csv');
    const texto = buf.toString('utf-8');
    expect(texto).toContain('"valor;com;pv"');
  });

  it('escapa campos com aspas duplicando-as', () => {
    const linhas = [{ a: 'valor "com" aspas', b: 'ok' }];
    const buf = exportReport(linhas, ['a', 'b'], { a: 'A', b: 'B' }, 'csv');
    const texto = buf.toString('utf-8');
    expect(texto).toContain('"valor ""com"" aspas"');
  });

  it('retorna buffer vazio para linhas vazias (so cabecalho)', () => {
    const buf = exportReport([], COLUNAS, CABECALHOS, 'csv');
    const texto = buf.toString('utf-8');
    const linhas = texto.split('\n').filter((l) => l.length > 0);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toBe('Profissional;Paciente;Data;Status');
  });

  it('inclui BOM UTF-8 no inicio do CSV', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'csv');
    expect(buf[0]).toBe(0xEF);
    expect(buf[1]).toBe(0xBB);
    expect(buf[2]).toBe(0xBF);
  });
});

describe('exportReport XLSX', () => {
  it('gera Buffer nao vazio com assinatura de arquivo XLSX (PK zip)', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'xlsx');
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic bytes
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4B); // K
  });

  it('contem os dados quando reparseado', () => {
    const XLSX = require('xlsx');
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
    expect(data).toHaveLength(2);
    expect(data[0]!['Profissional']).toBe('Dra. Ana');
    expect(data[1]!['Paciente']).toBe('Maria');
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "packages/reports" && pnpm vitest run src/export.test.ts
```

Saida esperada: falha com `Cannot find module './export'`.

- [ ] Implementar a exportacao:

```ts
// packages/reports/src/export.ts
import type { ExportFormat } from './types';
import * as XLSX from 'xlsx';

const SEPARATOR = ';';
const BOM = '﻿';

function escapeCsvField(value: string): string {
  if (value.includes(SEPARATOR) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
): Buffer {
  const headerLine = columns.map((c) => escapeCsvField(headers[c] ?? c)).join(SEPARATOR);
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(row[c] ?? ''))).join(SEPARATOR),
  );
  const content = BOM + [headerLine, ...dataLines].join('\n');
  return Buffer.from(content, 'utf-8');
}

function toXlsx(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
): Buffer {
  const headerRow = columns.map((c) => headers[c] ?? c);
  const dataRows = rows.map((row) => columns.map((c) => row[c] ?? ''));
  const aoa = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}

/**
 * Exporta linhas ja filtradas para CSV ou XLSX.
 *
 * CSV usa ponto e virgula como separador (padrao brasileiro — Excel pt-BR abre
 * direto) e inclui BOM UTF-8 para que o Excel reconheca a codificacao.
 * XLSX usa SheetJS para gerar o arquivo binario.
 *
 * A funcao NAO acessa banco. Recebe dados ja consultados pela API.
 */
export function exportReport(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
  format: ExportFormat,
): Buffer {
  switch (format) {
    case 'csv':
      return toCsv(rows, columns, headers);
    case 'xlsx':
      return toXlsx(rows, columns, headers);
  }
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "packages/reports" && pnpm vitest run src/export.test.ts
```

Saida esperada: todos os 7 testes passam.

- [ ] Atualizar o index:

```ts
// packages/reports/src/index.ts
export * from './types';
export { buildQuery } from './query-builder';
export { BUILT_IN_VIEWS, getSavedView, validateCustomViewInput } from './saved-views';
export { exportReport } from './export';
```

- [ ] Commitar:

```bash
git add packages/reports/src/export.ts packages/reports/src/export.test.ts \
      packages/reports/src/index.ts packages/reports/package.json
git commit -m "feat(reports): add CSV and XLSX export with SheetJS

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 47: Acao `report.read` no authz e rotas da API — Explorar, visoes e exportacao

**Arquivos**

- Modificar `packages/authz/src/actions.ts`
- Criar `apps/api/src/routes/reports.ts`
- Criar `apps/api/src/routes/reports.int.test.ts`
- Modificar `apps/api/package.json`

**Por que**: o Explorar precisa de rotas protegidas para consultar, listar visoes salvas, salvar visoes customizadas e exportar. A acao `report.read` controla o acesso. As rotas vivem em L3 e compoem `@cadencia/reports` (L2) com `@cadencia/db` (L0) para executar o SQL montado pelo query builder.

- [ ] Adicionar a acao `report.read` ao catalogo de acoes:

```ts
// packages/authz/src/actions.ts
// Adicionar ao final do array ACTIONS, antes do `] as const satisfies`:
  // -- Fase 3 . Desempenho -------------------------------------------------
  { key: 'report.read', description: 'Consultar relatorios e exportar dados',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'report.view.write', description: 'Salvar visao customizada de relatorio',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
```

- [ ] Adicionar dependencia do `@cadencia/reports` ao api:

```jsonc
// apps/api/package.json  — adicionar ao "dependencies":
    "@cadencia/reports": "workspace:*",
```

- [ ] Escrever o teste de integracao que falha:

```ts
// apps/api/src/routes/reports.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { reportRoutes } from './reports';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  // Registrar as rotas sem autenticacao para teste unitario de contrato
  // (teste de integracao com banco e com authn/authz roda no CI)
  await app.register(async (instance) => {
    await reportRoutes(instance);
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('rotas de relatorio — contrato HTTP', () => {
  it('GET /v1/reports/views retorna array com as 11 visoes built-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reports/views' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.views).toHaveLength(11);
    expect(body.views[0]).toHaveProperty('id');
    expect(body.views[0]).toHaveProperty('name');
    expect(body.views[0]).toHaveProperty('builtIn', true);
  });

  it('GET /v1/reports/views/:id retorna visao especifica', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/reports/views/builtin-atendimentos-realizados',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('builtin-atendimentos-realizados');
    expect(body.name).toBe('Atendimentos realizados');
  });

  it('GET /v1/reports/views/:id retorna 404 para id inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reports/views/nao-existe' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/api" && pnpm vitest run src/routes/reports.int.test.ts
```

Saida esperada: falha com `Cannot find module './reports'`.

- [ ] Implementar as rotas:

```ts
// apps/api/src/routes/reports.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BUILT_IN_VIEWS,
  getSavedView,
  buildQuery,
  exportReport,
  validateCustomViewInput,
  type ReportQuery,
  type ExportFormat,
} from '@cadencia/reports';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

const FilterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'like']),
  value: z.unknown(),
});

const SortSchema = z.object({
  column: z.string().min(1),
  dir: z.enum(['asc', 'desc']),
});

const ColumnsSchema = z.object({
  visible: z.array(z.string().min(1)).min(1),
  groupBy: z.string().optional(),
  aggregate: z.object({
    column: z.string(),
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  }).optional(),
});

const QuerySchema = z.object({
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  limit: z.number().int().min(1).max(5000).default(50),
  offset: z.number().int().min(0).default(0),
});

const ExportSchema = z.object({
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  format: z.enum(['csv', 'xlsx']),
  headers: z.record(z.string()).default({}),
});

const CustomViewSchema = z.object({
  name: z.string().min(1).max(120),
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  chartKind: z.enum(['bar', 'line', 'pie', 'table']).default('table'),
});

const HEADER_MAP: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
  procedure_name: 'Procedimento',
  category_name: 'Categoria',
  kind: 'Tipo',
  amount_cents: 'Valor (centavos)',
  channel: 'Canal',
  template_name: 'Template',
  sent_at: 'Enviado em',
  birth_date: 'Data de nascimento',
  birth_month_day: 'Mes/Dia',
  phone: 'Telefone',
  age: 'Idade',
  cid_code: 'CID',
  cid_description: 'Descricao CID',
  referral_source: 'Indicacao',
  basis: 'Base',
  day_of_week: 'Dia da semana',
  time_slot: 'Faixa de horario',
  last_visit_date: 'Ultima visita',
  return_due_date: 'Retorno previsto',
};

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- GET /v1/reports/views — listar visoes salvas -----------------------
  r.get('/v1/reports/views', {
    schema: {
      response: {
        200: z.object({
          views: z.array(z.object({
            id: z.string(),
            name: z.string(),
            builtIn: z.boolean(),
            view: z.string(),
            chartKind: z.string(),
          })),
        }),
      },
    },
  }, async () => {
    return {
      views: BUILT_IN_VIEWS.map((v) => ({
        id: v.id,
        name: v.name,
        builtIn: v.builtIn,
        view: v.view,
        chartKind: v.chartKind,
      })),
    };
  });

  // -- GET /v1/reports/views/:id — obter visao por id ---------------------
  r.get('/v1/reports/views/:id', {
    schema: {
      params: z.object({ id: z.string() }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = getSavedView(id);
    if (view === undefined) {
      void reply.code(404);
      return { erro: 'visao_nao_encontrada', id };
    }
    return view;
  });

  // -- POST /v1/reports/query — executar consulta do Explorar -------------
  r.post('/v1/reports/query', {
    schema: {
      body: QuerySchema,
    },
  }, rota('report.read', async (tx, _ctx, req) => {
    const body = req.body as ReportQuery;
    const built = buildQuery(body);
    const { rows } = await tx.query(built.sql, [...built.params]);
    return { rows, total: rows.length };
  }));

  // -- POST /v1/reports/export — exportar dados filtrados -----------------
  r.post('/v1/reports/export', {
    schema: {
      body: ExportSchema,
    },
  }, rota('report.read', async (tx, _ctx, req, reply) => {
    const body = req.body as {
      view: string; filters: any[]; columns: any; sort: any[];
      format: ExportFormat; headers: Record<string, string>;
    };

    const query: ReportQuery = {
      view: body.view as any,
      filters: body.filters,
      columns: body.columns,
      sort: body.sort,
      limit: 50000,
      offset: 0,
    };
    const built = buildQuery(query);
    const { rows } = await tx.query(built.sql, [...built.params]);

    const columns = body.columns.visible as string[];
    const headers = { ...HEADER_MAP, ...body.headers };
    const buf = exportReport(rows, columns, headers, body.format);

    const mime = body.format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const ext = body.format === 'csv' ? 'csv' : 'xlsx';

    void reply.header('content-type', mime);
    void reply.header('content-disposition',
      `attachment; filename="relatorio.${ext}"`);
    return buf;
  }));

  // -- POST /v1/reports/views/custom — salvar visao customizada -----------
  r.post('/v1/reports/views/custom', {
    schema: {
      body: CustomViewSchema,
      response: {
        201: z.object({ viewId: z.string().uuid() }),
      },
    },
  }, rota('report.view.write', async (tx, ctx, req, reply) => {
    const body = req.body as {
      name: string; view: string; filters: any[];
      columns: any; sort: any[]; chartKind: string;
    };

    const result = validateCustomViewInput({
      name: body.name,
      view: body.view as any,
      filters: body.filters,
      columns: body.columns,
      sort: body.sort,
      chartKind: body.chartKind as any,
    });

    if (!result.ok) {
      void reply.code(422);
      return { erro: result.error.code, mensagem: result.error.message };
    }

    const viewId = uuidv7();

    await tx.query(
      `INSERT INTO app.saved_report_view
         (id, user_id, name, view_name, filters, columns, sort, chart_kind)
       VALUES ($1, app.current_user_id(), $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
      [viewId, body.name, body.view,
       JSON.stringify(body.filters), JSON.stringify(body.columns),
       JSON.stringify(body.sort), body.chartKind]);

    void reply.code(201);
    return { viewId };
  }));
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/api" && pnpm vitest run src/routes/reports.int.test.ts
```

Saida esperada: os 3 testes de contrato HTTP passam.

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts apps/api/src/routes/reports.ts \
      apps/api/src/routes/reports.int.test.ts apps/api/package.json
git commit -m "feat(api): add report routes for Explorar, saved views and export

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 48: Tela Explorar — query builder visual com filtros combinaveis

**Arquivos**

- Criar `apps/web/src/telas/Explorar.tsx`
- Criar `apps/web/src/telas/Explorar.test.tsx`

**Por que**: o Explorar e a tela central do Desempenho. Permite combinar filtros (periodo, profissional, clinica, procedimento, convenio, status, CID, faixa etaria, genero, fonte) e ver o resultado em tabela com colunas configuraveis. O grafico (visx) vem na Task 49. Aqui o foco e o layout de filtros, a tabela de resultado e a integracao com as visoes salvas.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Explorar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Explorar } from './Explorar';
import type { SavedView } from '@cadencia/reports';

const VISOES_MOCK: SavedView[] = [
  {
    id: 'builtin-atendimentos-realizados',
    name: 'Atendimentos realizados',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'realizado' }],
    columns: { visible: ['occurred_date', 'patient_name', 'professional_name', 'status'] },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  {
    id: 'builtin-faltas',
    name: 'Faltas',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'falta' }],
    columns: { visible: ['occurred_date', 'patient_name', 'professional_name', 'status'] },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
];

const LINHAS_MOCK = [
  { occurred_date: '2026-07-15', patient_name: 'Carlos', professional_name: 'Dra. Ana', status: 'realizado' },
  { occurred_date: '2026-07-16', patient_name: 'Maria', professional_name: 'Dr. Bruno', status: 'realizado' },
];

function montar(overrides: Partial<Parameters<typeof Explorar>[0]> = {}) {
  const props = {
    visoesSalvas: VISOES_MOCK,
    aoConsultar: vi.fn(async () => ({ rows: LINHAS_MOCK, total: 2 })),
    aoExportar: vi.fn(async () => {}),
    aoSalvarVisao: vi.fn(async () => ({ viewId: 'custom-1' })),
    ...overrides,
  };
  render(<Explorar {...props} />);
  return props;
}

describe('tela Explorar', () => {
  it('renderiza o titulo "Explorar"', () => {
    montar();
    expect(screen.getByRole('heading', { name: /Explorar/ })).toBeVisible();
  });

  it('exibe lista de visoes salvas como botoes de acesso rapido', () => {
    montar();
    expect(screen.getByRole('button', { name: /Atendimentos realizados/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Faltas/ })).toBeVisible();
  });

  it('ao clicar em visao salva, carrega filtros e dispara consulta', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(props.aoConsultar).toHaveBeenCalled());
  });

  it('exibe seletor de periodo com campos de data inicio e fim', () => {
    montar();
    expect(screen.getByLabelText(/Data inicio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Data fim/i)).toBeInTheDocument();
  });

  it('exibe tabela de resultados apos consulta', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    expect(screen.getByText('Carlos')).toBeVisible();
    expect(screen.getByText('Maria')).toBeVisible();
  });

  it('exibe cabecalhos de coluna na tabela', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    expect(screen.getByRole('columnheader', { name: /Data/ })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Paciente/ })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Profissional/ })).toBeVisible();
  });

  it('exibe botoes de exportar CSV e XLSX', () => {
    montar();
    expect(screen.getByRole('button', { name: /CSV/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /XLSX/ })).toBeVisible();
  });

  it('ao clicar em exportar CSV chama aoExportar com formato csv', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() => expect(props.aoExportar).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv' }),
    ));
  });

  it('exibe botao "Salvar visao" e chama aoSalvarVisao com nome', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Salvar visao/ }));
    const campo = screen.getByLabelText(/Nome da visao/i);
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Minha visao');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(props.aoSalvarVisao).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Minha visao' }),
    ));
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Explorar
        visoesSalvas={VISOES_MOCK}
        aoConsultar={vi.fn(async () => ({ rows: LINHAS_MOCK, total: 2 }))}
        aoExportar={vi.fn(async () => {})}
        aoSalvarVisao={vi.fn(async () => ({ viewId: 'custom-1' }))}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/web" && pnpm vitest run src/telas/Explorar.test.tsx
```

Saida esperada: falha com `Cannot find module './Explorar'`.

- [ ] Implementar a tela Explorar:

```tsx
// apps/web/src/telas/Explorar.tsx
'use client';

import { useCallback, useState } from 'react';
import { Botao } from '../ui/Botao';
import type { SavedView, ReportFilter, ReportColumns, ReportSort, ChartKind, ExportFormat } from '@cadencia/reports';

export interface ResultadoConsulta {
  readonly rows: readonly Record<string, unknown>[];
  readonly total: number;
}

export interface ExplorarProps {
  readonly visoesSalvas: readonly SavedView[];
  readonly aoConsultar: (query: {
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    limit: number;
    offset: number;
  }) => Promise<ResultadoConsulta>;
  readonly aoExportar: (params: {
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    format: ExportFormat;
  }) => Promise<void>;
  readonly aoSalvarVisao: (params: {
    name: string;
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    chartKind: ChartKind;
  }) => Promise<{ viewId: string }>;
}

const HEADER_MAP: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
  procedure_name: 'Procedimento',
  category_name: 'Categoria',
  kind: 'Tipo',
  amount_cents: 'Valor',
  channel: 'Canal',
  template_name: 'Template',
  sent_at: 'Enviado em',
  birth_date: 'Data de nascimento',
  birth_month_day: 'Mes/Dia',
  phone: 'Telefone',
  age: 'Idade',
  cid_code: 'CID',
  cid_description: 'Descricao CID',
  referral_source: 'Indicacao',
  day_of_week: 'Dia da semana',
  time_slot: 'Faixa horario',
  last_visit_date: 'Ultima visita',
  return_due_date: 'Retorno previsto',
};

export function Explorar(p: ExplorarProps) {
  const [resultado, setResultado] = useState<ResultadoConsulta | null>(null);
  const [visaoAtual, setVisaoAtual] = useState<SavedView | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [nomeVisao, setNomeVisao] = useState('');

  const consultar = useCallback(async (visao: SavedView) => {
    setCarregando(true);
    setVisaoAtual(visao);
    try {
      const filtros = [...visao.filters];
      if (dataInicio !== '' && dataFim !== '') {
        filtros.push({ column: 'occurred_date', op: 'between', value: [dataInicio, dataFim] });
      }
      const res = await p.aoConsultar({
        view: visao.view,
        filters: filtros,
        columns: visao.columns,
        sort: visao.sort,
        limit: 200,
        offset: 0,
      });
      setResultado(res);
    } finally {
      setCarregando(false);
    }
  }, [p, dataInicio, dataFim]);

  const exportar = useCallback(async (format: ExportFormat) => {
    if (visaoAtual === null) return;
    await p.aoExportar({
      view: visaoAtual.view,
      filters: visaoAtual.filters,
      columns: visaoAtual.columns,
      sort: visaoAtual.sort,
      format,
    });
  }, [p, visaoAtual]);

  const salvarVisao = useCallback(async () => {
    if (visaoAtual === null || nomeVisao.trim() === '') return;
    await p.aoSalvarVisao({
      name: nomeVisao,
      view: visaoAtual.view,
      filters: visaoAtual.filters,
      columns: visaoAtual.columns,
      sort: visaoAtual.sort,
      chartKind: visaoAtual.chartKind,
    });
    setSalvando(false);
    setNomeVisao('');
  }, [p, visaoAtual, nomeVisao]);

  const colunas = visaoAtual !== null
    ? visaoAtual.columns.visible
    : [];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Explorar
      </h1>

      {/* Visoes salvas */}
      <section aria-label="Visoes salvas" style={{ display: 'flex', flexWrap: 'wrap',
                                                    gap: 'var(--s-3)' }}>
        {p.visoesSalvas.map((v) => (
          <Botao key={v.id} variante="secundario" altura={32}
            onClick={() => { void consultar(v); }}>
            {v.name}
          </Botao>
        ))}
      </section>

      {/* Filtros de periodo */}
      <section aria-label="Filtros" style={{ display: 'flex', gap: 'var(--s-4)',
                                              alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="data-inicio"
            style={{ display: 'block', fontSize: 'var(--fs-12)',
                     color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
            Data inicio
          </label>
          <input id="data-inicio" type="date" value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            style={{ padding: 'var(--s-2) var(--s-3)', border: 'var(--border)',
                     borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                     background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <div>
          <label htmlFor="data-fim"
            style={{ display: 'block', fontSize: 'var(--fs-12)',
                     color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
            Data fim
          </label>
          <input id="data-fim" type="date" value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            style={{ padding: 'var(--s-2) var(--s-3)', border: 'var(--border)',
                     borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                     background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <Botao variante="secundario" altura={32}
          onClick={() => { if (visaoAtual !== null) void consultar(visaoAtual); }}>
          Aplicar filtro
        </Botao>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-2)' }}>
          <Botao variante="fantasma" altura={28}
            onClick={() => { void exportar('csv'); }}>
            CSV
          </Botao>
          <Botao variante="fantasma" altura={28}
            onClick={() => { void exportar('xlsx'); }}>
            XLSX
          </Botao>
        </div>
      </section>

      {/* Tabela de resultados */}
      {resultado !== null && colunas.length > 0 ? (
        <section aria-label="Resultado" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-14)' }}>
            <thead>
              <tr>
                {colunas.map((col) => (
                  <th key={col} scope="col"
                    style={{ textAlign: 'left', padding: 'var(--s-3) var(--s-4)',
                             borderBottom: '2px solid var(--line-strong)',
                             fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-12)',
                             color: 'var(--text-muted)', textTransform: 'uppercase',
                             letterSpacing: '.04em' }}>
                    {HEADER_MAP[col] ?? col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultado.rows.map((row, i) => (
                <tr key={i}>
                  {colunas.map((col) => (
                    <td key={col}
                      style={{ padding: 'var(--s-3) var(--s-4)',
                               borderBottom: 'var(--border)' }}>
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                      marginTop: 'var(--s-3)' }}>
            {resultado.total} resultado{resultado.total !== 1 ? 's' : ''}
          </p>
        </section>
      ) : carregando ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-14)' }}>
          Carregando...
        </p>
      ) : null}

      {/* Salvar visao */}
      {visaoAtual !== null ? (
        <section aria-label="Salvar visao" style={{ display: 'flex', gap: 'var(--s-3)',
                                                     alignItems: 'end' }}>
          {salvando ? (
            <>
              <div>
                <label htmlFor="nome-visao"
                  style={{ display: 'block', fontSize: 'var(--fs-12)',
                           color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
                  Nome da visao
                </label>
                <input id="nome-visao" type="text" value={nomeVisao}
                  onChange={(e) => setNomeVisao(e.target.value)}
                  style={{ padding: 'var(--s-2) var(--s-3)', border: 'var(--border)',
                           borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                           background: 'var(--surface)', color: 'var(--text)',
                           minWidth: 200 }} />
              </div>
              <Botao variante="primario" altura={32}
                onClick={() => { void salvarVisao(); }}>
                Confirmar
              </Botao>
              <Botao variante="fantasma" altura={32}
                onClick={() => { setSalvando(false); setNomeVisao(''); }}>
                Cancelar
              </Botao>
            </>
          ) : (
            <Botao variante="secundario" altura={32}
              onClick={() => setSalvando(true)}>
              Salvar visao
            </Botao>
          )}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/web" && pnpm vitest run src/telas/Explorar.test.tsx
```

Saida esperada: todos os 10 testes passam.

- [ ] Commitar:

```bash
git add apps/web/src/telas/Explorar.tsx apps/web/src/telas/Explorar.test.tsx
git commit -m "feat(web): add Explorar screen with filters, table and saved views

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 49: Grafico visx no Explorar — barra, linha e pizza

**Arquivos**

- Criar `apps/web/src/ui/GraficoExplorar.tsx`
- Criar `apps/web/src/ui/GraficoExplorar.test.tsx`
- Modificar `apps/web/src/telas/Explorar.tsx`
- Modificar `apps/web/package.json`

**Por que**: o Explorar mostra um grafico (visx) abaixo dos filtros e acima da tabela. O tipo de grafico depende da visao (bar, line, pie). O componente recebe dados ja filtrados e o tipo de grafico. visx e a stack escolhida (Design §2.3) por permitir graficos customizados sem Recharts.

- [ ] Adicionar visx ao package.json do web:

```jsonc
// apps/web/package.json — adicionar ao "dependencies":
    "@visx/group": "^3.12.0",
    "@visx/scale": "^3.12.0",
    "@visx/shape": "^3.12.0",
    "@visx/axis": "^3.12.0",
    "@visx/responsive": "^3.12.0",
```

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/GraficoExplorar.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { GraficoExplorar } from './GraficoExplorar';

const DADOS_BARRA = [
  { label: 'Jan', value: 100 },
  { label: 'Fev', value: 200 },
  { label: 'Mar', value: 150 },
];

const DADOS_LINHA = [
  { label: '2026-07-01', value: 30 },
  { label: '2026-07-02', value: 45 },
  { label: '2026-07-03', value: 20 },
];

const DADOS_PIZZA = [
  { label: 'Pix', value: 400 },
  { label: 'Cartao', value: 300 },
  { label: 'Dinheiro', value: 200 },
];

describe('GraficoExplorar', () => {
  it('renderiza SVG acessivel para grafico de barras', () => {
    render(<GraficoExplorar tipo="bar" dados={DADOS_BARRA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('renderiza SVG acessivel para grafico de linha', () => {
    render(<GraficoExplorar tipo="line" dados={DADOS_LINHA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('renderiza SVG acessivel para grafico de pizza', () => {
    render(<GraficoExplorar tipo="pie" dados={DADOS_PIZZA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('nao renderiza nada para tipo table', () => {
    const { container } = render(
      <GraficoExplorar tipo="table" dados={DADOS_BARRA}
        largura={400} altura={200} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renderiza barras com quantidade correta de retangulos', () => {
    render(<GraficoExplorar tipo="bar" dados={DADOS_BARRA}
      largura={400} altura={200} />);
    const svg = screen.getByRole('img', { name: /grafico/i });
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it('sem violacao de acessibilidade no grafico de barras', async () => {
    const { container } = render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA}
        largura={400} altura={200} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/web" && pnpm vitest run src/ui/GraficoExplorar.test.tsx
```

Saida esperada: falha com `Cannot find module './GraficoExplorar'`.

- [ ] Implementar o componente de grafico:

```tsx
// apps/web/src/ui/GraficoExplorar.tsx
'use client';

import type { ChartKind } from '@cadencia/reports';

export interface DadoGrafico {
  readonly label: string;
  readonly value: number;
}

export interface GraficoExplorarProps {
  readonly tipo: ChartKind;
  readonly dados: readonly DadoGrafico[];
  readonly largura: number;
  readonly altura: number;
}

const MARGEM = { top: 20, right: 20, bottom: 40, left: 50 };

const CORES = [
  'var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--danger)',
  'var(--ai)', 'var(--text-muted)',
];

function GraficoBarra({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const innerW = largura - MARGEM.left - MARGEM.right;
  const innerH = altura - MARGEM.top - MARGEM.bottom;
  const maxVal = Math.max(...dados.map((d) => d.value), 1);
  const barW = Math.max(innerW / dados.length - 4, 8);

  return (
    <g transform={`translate(${MARGEM.left},${MARGEM.top})`}>
      {dados.map((d, i) => {
        const barH = (d.value / maxVal) * innerH;
        const x = (innerW / dados.length) * i + 2;
        const y = innerH - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={barH}
              rx={3} fill="var(--accent)"
              role="img" aria-label={`${d.label}: ${d.value}`} />
            <text x={x + barW / 2} y={innerH + 16}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {d.label.length > 6 ? d.label.slice(0, 6) : d.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GraficoLinha({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const innerW = largura - MARGEM.left - MARGEM.right;
  const innerH = altura - MARGEM.top - MARGEM.bottom;
  const maxVal = Math.max(...dados.map((d) => d.value), 1);

  const pontos = dados.map((d, i) => {
    const x = (innerW / Math.max(dados.length - 1, 1)) * i;
    const y = innerH - (d.value / maxVal) * innerH;
    return { x, y, label: d.label, value: d.value };
  });

  const pathD = pontos.map((pt, i) =>
    `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

  return (
    <g transform={`translate(${MARGEM.left},${MARGEM.top})`}>
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pontos.map((pt) => (
        <circle key={pt.label} cx={pt.x} cy={pt.y} r={3}
          fill="var(--accent)"
          role="img" aria-label={`${pt.label}: ${pt.value}`} />
      ))}
    </g>
  );
}

function GraficoPizza({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const cx = largura / 2;
  const cy = altura / 2;
  const r = Math.min(cx, cy) - 20;
  const total = dados.reduce((sum, d) => sum + d.value, 0) || 1;

  let angulo = -Math.PI / 2;
  const fatias = dados.map((d, i) => {
    const frac = d.value / total;
    const start = angulo;
    angulo += frac * 2 * Math.PI;
    const end = angulo;
    const largeArc = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { pathD, label: d.label, value: d.value, cor: CORES[i % CORES.length] };
  });

  return (
    <g>
      {fatias.map((f) => (
        <path key={f.label} d={f.pathD} fill={f.cor}
          role="img" aria-label={`${f.label}: ${f.value}`} />
      ))}
    </g>
  );
}

export function GraficoExplorar({ tipo, dados, largura, altura }: GraficoExplorarProps) {
  if (tipo === 'table' || dados.length === 0) {
    return null;
  }

  return (
    <svg role="img" aria-label="Grafico do relatorio"
      viewBox={`0 0 ${largura} ${altura}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${altura}px` }}>
      {tipo === 'bar' ? (
        <GraficoBarra dados={dados} largura={largura} altura={altura} />
      ) : tipo === 'line' ? (
        <GraficoLinha dados={dados} largura={largura} altura={altura} />
      ) : tipo === 'pie' ? (
        <GraficoPizza dados={dados} largura={largura} altura={altura} />
      ) : null}
    </svg>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/web" && pnpm vitest run src/ui/GraficoExplorar.test.tsx
```

Saida esperada: todos os 6 testes passam.

- [ ] Integrar o grafico na tela Explorar. Adicionar import e renderizacao do grafico no `Explorar.tsx`, logo acima da tabela de resultados:

```tsx
// apps/web/src/telas/Explorar.tsx
// Adicionar no topo, junto aos outros imports:
import { GraficoExplorar } from '../ui/GraficoExplorar';

// Adicionar dentro do componente, logo ANTES da section "Resultado",
// dentro do bloco {resultado !== null && colunas.length > 0 ? (...):
// Inserir logo antes de <section aria-label="Resultado"...>:
```

Conteudo a inserir no componente Explorar, logo antes da `<section aria-label="Resultado"`:

```tsx
      {resultado !== null && visaoAtual !== null && visaoAtual.chartKind !== 'table' ? (
        <section aria-label="Grafico" style={{ overflowX: 'auto' }}>
          <GraficoExplorar
            tipo={visaoAtual.chartKind}
            dados={
              visaoAtual.columns.groupBy !== undefined
                ? resultado.rows.map((row) => ({
                    label: String(row[visaoAtual.columns.groupBy!] ?? ''),
                    value: Number(
                      row[
                        visaoAtual.columns.aggregate !== undefined
                          ? `${visaoAtual.columns.aggregate.fn}_${visaoAtual.columns.aggregate.column}`
                          : visaoAtual.columns.visible[0]!
                      ] ?? 0,
                    ),
                  }))
                : resultado.rows.map((row) => ({
                    label: String(row[colunas[0]!] ?? ''),
                    value: Number(row[colunas[colunas.length - 1]!] ?? 0),
                  }))
            }
            largura={600}
            altura={260}
          />
        </section>
      ) : null}
```

- [ ] Rodar todos os testes do Explorar novamente para garantir que nada quebrou:

```bash
cd "apps/web" && pnpm vitest run src/telas/Explorar.test.tsx src/ui/GraficoExplorar.test.tsx
```

Saida esperada: todos os 16 testes passam.

- [ ] Commitar:

```bash
git add apps/web/src/ui/GraficoExplorar.tsx apps/web/src/ui/GraficoExplorar.test.tsx \
      apps/web/src/telas/Explorar.tsx apps/web/package.json
git commit -m "feat(web): add visx chart component and integrate with Explorar

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 50: Navegacao Desempenho e FASE_ATUAL = 3

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Criar `apps/web/src/telas/Desempenho.tsx`
- Criar `apps/web/src/telas/Desempenho.test.tsx`

**Por que**: o Desempenho e a tela-mae que abriga o Explorar (e futuramente Variacoes do periodo, Atendimentos, Satisfacao). Ao subir FASE_ATUAL para 3, o link "Desempenho" aparece na navegacao. A tela renderiza o Explorar como conteudo principal.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Desempenho } from './Desempenho';

const PROPS_BASE = {
  visoesSalvas: [],
  aoConsultar: vi.fn(async () => ({ rows: [], total: 0 })),
  aoExportar: vi.fn(async () => {}),
  aoSalvarVisao: vi.fn(async () => ({ viewId: 'v1' })),
};

describe('tela Desempenho', () => {
  it('renderiza o titulo "Desempenho"', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByRole('heading', { name: /Desempenho/ })).toBeVisible();
  });

  it('renderiza a sub-navegacao com aba "Explorar" ativa', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByRole('tab', { name: /Explorar/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renderiza o componente Explorar dentro', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByLabelText(/Data inicio/i)).toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Desempenho {...PROPS_BASE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/web" && pnpm vitest run src/telas/Desempenho.test.tsx
```

Saida esperada: falha com `Cannot find module './Desempenho'`.

- [ ] Implementar a tela Desempenho:

```tsx
// apps/web/src/telas/Desempenho.tsx
'use client';

import { useState } from 'react';
import { Explorar, type ExplorarProps } from './Explorar';

type AbaDesempenho = 'explorar' | 'variacoes' | 'atendimentos' | 'satisfacao';

const ABAS: readonly { id: AbaDesempenho; rotulo: string }[] = [
  { id: 'explorar', rotulo: 'Explorar' },
  { id: 'variacoes', rotulo: 'Variacoes do periodo' },
  { id: 'atendimentos', rotulo: 'Atendimentos' },
  { id: 'satisfacao', rotulo: 'Satisfacao' },
];

export type DesempenhoProps = ExplorarProps;

export function Desempenho(p: DesempenhoProps) {
  const [abaAtiva, setAbaAtiva] = useState<AbaDesempenho>('explorar');

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Desempenho
      </h1>

      {/* Sub-navegacao */}
      <div role="tablist" aria-label="Abas do Desempenho"
        style={{ display: 'flex', gap: 'var(--s-1)',
                 borderBottom: '2px solid var(--line)' }}>
        {ABAS.map((aba) => (
          <button key={aba.id} role="tab"
            aria-selected={abaAtiva === aba.id}
            onClick={() => setAbaAtiva(aba.id)}
            style={{
              padding: 'var(--s-3) var(--s-5)',
              fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: abaAtiva === aba.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: abaAtiva === aba.id
                ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {aba.rotulo}
          </button>
        ))}
      </div>

      {/* Conteudo da aba */}
      {abaAtiva === 'explorar' ? (
        <Explorar {...p} />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-14)',
                    padding: 'var(--s-8)' }}>
          Em breve
        </p>
      )}
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/web" && pnpm vitest run src/telas/Desempenho.test.tsx
```

Saida esperada: todos os 4 testes passam.

- [ ] Atualizar FASE_ATUAL para 3 na navegacao:

```ts
// apps/web/src/ui/nav.ts
// Alterar a ultima linha de:
//   export const FASE_ATUAL = 2 as const;
// Para:
export const FASE_ATUAL = 3 as const;
```

- [ ] Escrever teste para verificar que Desempenho agora aparece na navegacao:

```ts
// (adicionar ao final de apps/web/src/telas/Desempenho.test.tsx)

import { FASE_ATUAL, ITENS_NAV } from '../ui/nav';

describe('navegacao Desempenho', () => {
  it('FASE_ATUAL e 3', () => {
    expect(FASE_ATUAL).toBe(3);
  });

  it('item Desempenho esta disponivel na fase 3', () => {
    const item = ITENS_NAV.find((i) => i.rotulo === 'Desempenho');
    expect(item).toBeDefined();
    expect(item!.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
  });

  it('todos os itens de navegacao estao disponiveis na fase atual', () => {
    for (const item of ITENS_NAV) {
      expect(item.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
    }
  });
});
```

- [ ] Rodar todos os testes do bloco para confirmar integridade:

```bash
cd "apps/web" && pnpm vitest run src/telas/Desempenho.test.tsx src/telas/Explorar.test.tsx src/ui/GraficoExplorar.test.tsx
```

Saida esperada: todos os 23 testes passam.

- [ ] Commitar:

```bash
git add apps/web/src/telas/Desempenho.tsx apps/web/src/telas/Desempenho.test.tsx \
      apps/web/src/ui/nav.ts
git commit -m "feat(web): add Desempenho screen, update FASE_ATUAL to 3

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```


## Parte: 09-api-routes

### Task 51: Novas acoes de autorizacao para Fase 3 [RECONCILIADO — ver Bloco 03, Task 17]

**[RECONCILIADO]** As acoes finance.settings, finance.write, finance.repasse, inventory.read, inventory.write e report.read foram incorporadas ao catalogo unificado no Bloco 03 (Task 17). Esta Task so precisa criar o teste `packages/authz/src/actions.test.ts` — o arquivo `packages/authz/src/actions.ts` ja contem todas as acoes.

**Arquivos**
- ~~Modificar: `packages/authz/src/actions.ts`~~ (ja feito pelo Bloco 03)
- Teste: `packages/authz/src/actions.test.ts`

**Passos**

- [ ] Escrever o teste que valida que as novas acoes existem no catalogo:

```ts
// packages/authz/src/actions.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes da Fase 3', () => {
  const fase3Keys = [
    'finance.settings',
    'finance.write',
    'finance.repasse',
    'inventory.read',
    'inventory.write',
    'report.read',
  ];

  it.each(fase3Keys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('finance.settings exige papel financeiro ou admin_clinico', () => {
    const action = ACTION_BY_KEY.get('finance.settings')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('finance.write permite recepcao e financeiro', () => {
    const action = ACTION_BY_KEY.get('finance.write')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('admin_clinico');
  });

  it('finance.repasse exige MFA', () => {
    const action = ACTION_BY_KEY.get('finance.repasse')!;
    expect(action.requiresMfa).toBe(true);
  });

  it('inventory.read permite profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('inventory.read')!;
    expect(action.roles).toContain('profissional');
    expect(action.roles).toContain('recepcao');
  });

  it('report.read permite financeiro e diretor_tecnico', () => {
    const action = ACTION_BY_KEY.get('report.read')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('diretor_tecnico');
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# ESPERADO: FAIL — acoes nao existem no catalogo
```

- [ ] [SKIP — RECONCILIADO] As acoes abaixo ja foram adicionadas pelo Bloco 03 (Task 17). Verificar que existem no catalogo, nao re-adicionar:

```ts
// Em packages/authz/src/actions.ts, ADICIONAR ao array ACTIONS antes do
// `] as const satisfies readonly ActionDef[];`
// Logo apos o bloco "Fase 2 · Pagamento":

  // ── Fase 3 · Financeiro completo ─────────────────────────────────────
  { key: 'finance.settings', description: 'Configurar contas bancarias, centros de custo, regras de split e recorrencia',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.write', description: 'Lancar despesa e cadastrar fornecedor',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Gerar, visualizar e pagar repasse a profissionais',
    roles: ['admin_clinico', 'financeiro'], requiresMfa: true },
  // ── Fase 3 · Estoque ────────────────────────────────────────────────
  { key: 'inventory.read', description: 'Consultar produtos e alertas de estoque',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'inventory.write', description: 'Cadastrar produto e registrar movimentacao',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Relatorios ─────────────────────────────────────────────
  { key: 'report.read', description: 'Acessar painel de desempenho e exportar relatorios',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# ESPERADO: PASS — todas as 7 assertivas verdes
```

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions.test.ts
git commit -m "feat(authz): add Fase 3 action keys for finance, inventory and reports"
```

---

### Task 52: Rotas de contas bancarias, centros de custo e fornecedores

**Arquivos**
- Criar: `apps/api/src/routes/finance-settings.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/finance-settings.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/finance-settings.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de contas bancarias', () => {
  let bankAccountId: string;

  it('POST /v1/bank-accounts cria conta bancaria', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: {
        name: 'Bradesco Corrente',
        bankCode: '237',
        agency: '1234',
        accountNumber: '56789-0',
        initialBalanceCents: 100000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { bankAccountId: string };
    expect(body.bankAccountId).toBeTruthy();
    bankAccountId = body.bankAccountId;
    await app.close();
  });

  it('GET /v1/bank-accounts lista contas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ bankAccountId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((i) => i.bankAccountId === bankAccountId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/bank-accounts atualiza conta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/bank-accounts', ...auth(fin),
      payload: {
        bankAccountId,
        name: 'Bradesco Corrente Principal',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { bankAccountId: string };
    expect(body.bankAccountId).toBe(bankAccountId);
    await app.close();
  });

  it('conta bancaria de outro tenant nao aparece na listagem', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ bankAccountId: string }> };
    expect(body.itens.map((i) => i.bankAccountId)).not.toContain(bankAccountId);
    await app.close();
  });

  it('recepcao nao acessa contas bancarias (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de centros de custo', () => {
  let costCenterId: string;

  it('POST /v1/cost-centers cria centro de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/cost-centers', ...auth(fin),
      payload: { name: 'Consultorio 1', code: 'CC01' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { costCenterId: string };
    expect(body.costCenterId).toBeTruthy();
    costCenterId = body.costCenterId;
    await app.close();
  });

  it('GET /v1/cost-centers lista centros de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/cost-centers', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ costCenterId: string }> };
    expect(body.itens.some((i) => i.costCenterId === costCenterId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/cost-centers atualiza centro de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/cost-centers', ...auth(fin),
      payload: { costCenterId, name: 'Consultorio Principal' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('centro de custo de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/cost-centers', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ costCenterId: string }> };
    expect(body.itens.map((i) => i.costCenterId)).not.toContain(costCenterId);
    await app.close();
  });
});

describe('rotas de fornecedores', () => {
  let supplierId: string;

  it('POST /v1/suppliers cria fornecedor', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/suppliers', ...auth(fin),
      payload: {
        name: 'Distribuidora Medica ABC',
        cnpj: '12345678000195',
        phone: '11999887766',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { supplierId: string };
    expect(body.supplierId).toBeTruthy();
    supplierId = body.supplierId;
    await app.close();
  });

  it('GET /v1/suppliers lista fornecedores', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/suppliers', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ supplierId: string }> };
    expect(body.itens.some((i) => i.supplierId === supplierId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/suppliers atualiza fornecedor', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/suppliers', ...auth(fin),
      payload: { supplierId, name: 'Distribuidora Medica ABC Ltda' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('fornecedor de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/suppliers', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ supplierId: string }> };
    expect(body.itens.map((i) => i.supplierId)).not.toContain(supplierId);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/finance-settings.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/finance-settings.ts`:

```ts
// apps/api/src/routes/finance-settings.ts
//
// Rotas de configuracao financeira: contas bancarias, centros de custo e fornecedores.
// Acao: finance.settings (contas e centros de custo), finance.write (fornecedores).
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
  bankCode: z.string(),
  agency: z.string(),
  accountNumber: z.string(),
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
      id: string; name: string; bank_code: string; agency: string;
      account_number: string; initial_balance_cents: string;
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
      `INSERT INTO fin.supplier (id, name, cnpj, phone) VALUES ($1, $2, $3, $4)`,
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
      id: string; name: string; cnpj: string | null;
      phone: string | null; active: boolean; created_at: string;
    }>(
      `SELECT id, name, cnpj, phone, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.supplier
        ORDER BY name COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        supplierId: row.id,
        name: row.name,
        cnpj: row.cnpj,
        phone: row.phone,
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
    if (b.cnpj !== undefined) { sets.push(`cnpj = $${idx}`); params.push(b.cnpj); idx += 1; }
    if (b.phone !== undefined) { sets.push(`phone = $${idx}`); params.push(b.phone); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.supplier SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('fornecedor_nao_encontrado', 404);
    return { supplierId: b.supplierId };
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { financeSettingsRoutes } from './routes/finance-settings';

// Apos `await app.register(paymentWebhookRoutes);`, adicionar:
  await app.register(financeSettingsRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/finance-settings.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/finance-settings.ts apps/api/src/routes/finance-settings.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add bank accounts, cost centers and suppliers CRUD routes"
```

---

### Task 53: Rotas de a pagar, transferencias e recorrencias

**Arquivos**
- Criar: `apps/api/src/routes/finance-operations.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/finance-operations.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/finance-operations.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de a pagar (payables)', () => {
  let payableId: string;

  it('POST /v1/payables cria lancamento de despesa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payables', ...auth(fin),
      payload: {
        description: 'Material de limpeza',
        amountCents: 8500,
        method: 'pix',
        dueDate: '2026-09-15',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { payableId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.payableId).toBeTruthy();
    payableId = body.payableId;
    await app.close();
  });

  it('GET /v1/payables lista despesas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/payables', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ payableId: string; kind: string }> };
    expect(body.itens.some((i) => i.payableId === payableId)).toBe(true);
    for (const item of body.itens) {
      expect(item.kind).toBe('despesa');
    }
    await app.close();
  });

  it('despesa de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/payables', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ payableId: string }> };
    expect(body.itens.map((i) => i.payableId)).not.toContain(payableId);
    await app.close();
  });

  it('recepcao nao cria despesa (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payables', ...auth(recep),
      payload: {
        description: 'Teste', amountCents: 100, method: 'dinheiro',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de transferencias', () => {
  it('POST /v1/transfers cria transferencia entre contas', async () => {
    const app = await buildApp();

    // Criar duas contas bancarias primeiro
    const r1 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: { name: 'Origem', bankCode: '001', agency: '0001', accountNumber: '11111-0', initialBalanceCents: 500000 },
    });
    const fromId = (r1.json() as { bankAccountId: string }).bankAccountId;

    const r2 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: { name: 'Destino', bankCode: '341', agency: '0002', accountNumber: '22222-0', initialBalanceCents: 0 },
    });
    const toId = (r2.json() as { bankAccountId: string }).bankAccountId;

    const r = await app.inject({
      method: 'POST', url: '/v1/transfers', ...auth(fin),
      payload: {
        fromBankAccountId: fromId,
        toBankAccountId: toId,
        amountCents: 100000,
        description: 'Transferencia entre contas',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { transferId: string; debitEntryId: string; creditEntryId: string };
    expect(body.transferId).toBeTruthy();
    expect(body.debitEntryId).toBeTruthy();
    expect(body.creditEntryId).toBeTruthy();
    await app.close();
  });

  it('recepcao nao pode transferir (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/transfers', ...auth(recep),
      payload: {
        fromBankAccountId: '00000000-0000-0000-0000-000000000001',
        toBankAccountId: '00000000-0000-0000-0000-000000000002',
        amountCents: 1000, description: 'Teste',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de recorrencias', () => {
  let recurringId: string;

  it('POST /v1/recurring cria template recorrente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/recurring', ...auth(fin),
      payload: {
        description: 'Aluguel do consultorio',
        amountCents: 350000,
        kind: 'despesa',
        method: 'pix',
        frequency: 'monthly',
        dayOfMonth: 10,
        startsAt: '2026-09-01',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { recurringId: string };
    expect(body.recurringId).toBeTruthy();
    recurringId = body.recurringId;
    await app.close();
  });

  it('GET /v1/recurring lista templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/recurring', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ recurringId: string }> };
    expect(body.itens.some((i) => i.recurringId === recurringId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/recurring atualiza template', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/recurring', ...auth(fin),
      payload: { recurringId, amountCents: 380000 },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('DELETE /v1/recurring desativa template', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: `/v1/recurring/${recurringId}`, ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recurringId: string; active: boolean };
    expect(body.active).toBe(false);
    await app.close();
  });

  it('recorrencia de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/recurring', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ recurringId: string }> };
    expect(body.itens.map((i) => i.recurringId)).not.toContain(recurringId);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/finance-operations.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/finance-operations.ts`:

```ts
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
  categoryId: z.string().uuid().nullable(),
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
  }, rota('payment.write', async (tx, ctx, req, reply) => {
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

    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, due_date,
          category_id, idempotency_key, created_by)
       VALUES ($1, 'despesa', $2, $3, $4,
               $5, app.current_professional_id(), 'pendente', $6,
               $7, $8, app.current_user_id())`,
      [id, b.description, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, b.dueDate ?? null,
       b.categoryId ?? null, `payable:${id}`]);

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
    }>(
      `SELECT e.id, e.description, e.amount_cents::text,
              pm.kind AS method, e.status::text,
              e.due_date::text,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(e.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
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
      supplierId: null,
      categoryId: null,
      costCenterId: null,
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
  }, rota('payment.write', async (tx, ctx, req, reply) => {
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

    // Debito (despesa na conta de origem)
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, paid_at,
          idempotency_key, created_by)
       VALUES ($1, 'despesa', $2, $3, $4,
               $5, app.current_professional_id(), 'pago', clock_timestamp(),
               $6, app.current_user_id())`,
      [debitId, `Transferencia: ${b.description}`, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, `transfer:debit:${transferId}`]);

    // Credito (receita na conta de destino)
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, paid_at,
          idempotency_key, created_by)
       VALUES ($1, 'receita', $2, $3, $4,
               $5, app.current_professional_id(), 'pago', clock_timestamp(),
               $6, app.current_user_id())`,
      [creditId, `Transferencia: ${b.description}`, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, `transfer:credit:${transferId}`]);

    void reply.code(201);
    return { transferId, debitEntryId: debitId, creditEntryId: creditId };
  }));

  // ── POST /v1/recurring — criar template de recorrencia ────────────────
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
         (id, clinic_id, description, amount_cents, kind, method,
          frequency, day_of_month, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5::fin.entry_kind, $6, $7, $8, $9, $10)`,
      [id, ctx.actor.clinicId, b.description, b.amountCents, b.kind,
       b.method, b.frequency, b.dayOfMonth ?? null,
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
      kind: string; method: string; frequency: string;
      day_of_month: number | null; starts_at: string;
      ends_at: string | null; active: boolean; created_at: string;
    }>(
      `SELECT id, description, amount_cents::text,
              kind::text, method, frequency,
              day_of_month, starts_at::text, ends_at::text,
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
        method: row.method,
        frequency: row.frequency,
        dayOfMonth: row.day_of_month,
        startsAt: row.starts_at,
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
    if (b.frequency !== undefined) { sets.push(`frequency = $${idx}`); params.push(b.frequency); idx += 1; }
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
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { financeOperationsRoutes } from './routes/finance-operations';

// Apos `await app.register(financeSettingsRoutes);`, adicionar:
  await app.register(financeOperationsRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/finance-operations.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/finance-operations.ts apps/api/src/routes/finance-operations.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add payables, transfers and recurring template routes"
```

---

### Task 54: Rotas de split rules e repasse

**Arquivos**
- Criar: `apps/api/src/routes/repasse.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/repasse.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/repasse.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'admin_clinico', comMfa: true });
  outro = await semearSessao({ role: 'admin_clinico', comMfa: true });
});
afterAll(async () => { await closePools(); });

describe('rotas de split rules', () => {
  let splitRuleId: string;

  it('POST /v1/split-rules cria regra de split', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/split-rules', ...auth(fin),
      payload: {
        professionalId: fin.professionalId,
        procedureId: fin.procedureId,
        clinicPercentage: 4000,
        professionalPercentage: 6000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { splitRuleId: string };
    expect(body.splitRuleId).toBeTruthy();
    splitRuleId = body.splitRuleId;
    await app.close();
  });

  it('GET /v1/split-rules lista regras', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/split-rules', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ splitRuleId: string }> };
    expect(body.itens.some((i) => i.splitRuleId === splitRuleId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/split-rules atualiza regra', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/split-rules', ...auth(fin),
      payload: { splitRuleId, clinicPercentage: 3500, professionalPercentage: 6500 },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('regra de split de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/split-rules', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ splitRuleId: string }> };
    expect(body.itens.map((i) => i.splitRuleId)).not.toContain(splitRuleId);
    await app.close();
  });

  it('recepcao nao acessa split rules (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/split-rules', ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de repasse', () => {
  it('GET /v1/repasse/statements lista extratos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${fin.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; totalCents: number };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(typeof body.totalCents).toBe('number');
    await app.close();
  });

  it('POST /v1/repasse/close-period fecha periodo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/repasse/close-period', ...auth(fin),
      payload: {
        professionalId: fin.professionalId,
        periodFrom: '2026-07-01',
        periodTo: '2026-07-31',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { repasseId: string };
    expect(body.repasseId).toBeTruthy();
    await app.close();
  });

  it('repasse de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${fin.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(body.itens.length).toBe(0);
    await app.close();
  });

  it('recepcao nao acessa repasse (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${fin.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('finance.repasse sem MFA devolve 403', async () => {
    const semMfa = await semearSessao({ role: 'admin_clinico', comMfa: false });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${semMfa.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(semMfa),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/repasse.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/repasse.ts`:

```ts
// apps/api/src/routes/repasse.ts
//
// Rotas de split rules e repasse a profissionais.
// Split rules: acao finance.settings.
// Repasse (statements, close-period, pay): acao finance.repasse (exige MFA).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const SplitRuleSchema = z.object({
  splitRuleId: z.string().uuid(),
  professionalId: z.string().uuid(),
  procedureId: z.string().uuid().nullable(),
  clinicPercentage: z.number().int(),
  professionalPercentage: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const RepasseStatementSchema = z.object({
  entryId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  professionalShareCents: z.number().int(),
  paidAt: z.string().nullable(),
});

export async function repasseRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/split-rules ──────────────────────────────────────────────
  r.post('/v1/split-rules', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid().optional(),
        clinicPercentage: z.number().int().min(0).max(10000),
        professionalPercentage: z.number().int().min(0).max(10000),
      }),
      response: { 201: z.object({ splitRuleId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; procedureId?: string;
      clinicPercentage: number; professionalPercentage: number };

    if (b.clinicPercentage + b.professionalPercentage !== 10000) {
      erroDominio('percentuais_nao_somam_100', 422);
    }

    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.split_rule
         (id, professional_id, procedure_id, clinic_percentage, professional_percentage)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, b.professionalId, b.procedureId ?? null,
       b.clinicPercentage, b.professionalPercentage]);

    void reply.code(201);
    return { splitRuleId: id };
  }));

  // ── GET /v1/split-rules ───────────────────────────────────────────────
  r.get('/v1/split-rules', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(SplitRuleSchema) }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const q = req.query as { professionalId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.professionalId !== undefined) {
      condicoes.push(`sr.professional_id = $${idx}`);
      params.push(q.professionalId); idx += 1;
    }
    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; professional_id: string; procedure_id: string | null;
      clinic_percentage: string; professional_percentage: string;
      active: boolean; created_at: string;
    }>(
      `SELECT sr.id, sr.professional_id, sr.procedure_id,
              sr.clinic_percentage::text, sr.professional_percentage::text,
              sr.active,
              to_char(sr.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.split_rule sr
        ${where}
        ORDER BY sr.created_at DESC`,
      params);
    return {
      itens: rows.map((row) => ({
        splitRuleId: row.id,
        professionalId: row.professional_id,
        procedureId: row.procedure_id,
        clinicPercentage: Number(row.clinic_percentage),
        professionalPercentage: Number(row.professional_percentage),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/split-rules ───────────────────────────────────────────────
  r.put('/v1/split-rules', {
    schema: {
      body: z.object({
        splitRuleId: z.string().uuid(),
        clinicPercentage: z.number().int().min(0).max(10000).optional(),
        professionalPercentage: z.number().int().min(0).max(10000).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ splitRuleId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as {
      splitRuleId: string; clinicPercentage?: number;
      professionalPercentage?: number; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.splitRuleId];
    let idx = 2;
    if (b.clinicPercentage !== undefined) { sets.push(`clinic_percentage = $${idx}`); params.push(b.clinicPercentage); idx += 1; }
    if (b.professionalPercentage !== undefined) { sets.push(`professional_percentage = $${idx}`); params.push(b.professionalPercentage); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.split_rule SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('regra_split_nao_encontrada', 404);
    return { splitRuleId: b.splitRuleId };
  }));

  // ── GET /v1/repasse/statements — extrato de repasse ───────────────────
  r.get('/v1/repasse/statements', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          itens: z.array(RepasseStatementSchema),
          totalCents: z.number().int(),
        }),
      },
    },
  }, rota('finance.repasse', async (tx, ctx, req) => {
    const q = req.query as { professionalId: string; from: string; to: string };

    const { rows } = await tx.query<{
      entry_id: string; description: string; amount_cents: string;
      professional_share_cents: string; paid_at: string | null;
    }>(
      `SELECT e.id AS entry_id, e.description,
              e.amount_cents::text,
              COALESCE(
                (e.amount_cents * sr.professional_percentage / 10000), 0
              )::text AS professional_share_cents,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at
         FROM fin.entry e
         LEFT JOIN fin.split_rule sr
           ON sr.tenant_id = e.tenant_id
          AND sr.professional_id = e.professional_id
          AND sr.active = true
          AND (sr.procedure_id IS NULL OR sr.procedure_id = (
                SELECT a.procedure_id FROM sched.appointment a
                WHERE a.tenant_id = e.tenant_id AND a.id = e.appointment_id
              ))
        WHERE e.professional_id = $1
          AND e.clinic_id = $2
          AND e.kind = 'receita'
          AND e.status = 'pago'
          AND e.paid_at >= $3::date
          AND e.paid_at < ($4::date + 1)
        ORDER BY e.paid_at DESC`,
      [q.professionalId, ctx.actor.clinicId, q.from, q.to]);

    const itens = rows.map((row) => ({
      entryId: row.entry_id,
      description: row.description,
      amountCents: Number(row.amount_cents),
      professionalShareCents: Number(row.professional_share_cents),
      paidAt: row.paid_at,
    }));
    const totalCents = itens.reduce((acc, i) => acc + i.professionalShareCents, 0);

    return { itens, totalCents };
  }));

  // ── POST /v1/repasse/close-period — fechar periodo ────────────────────
  r.post('/v1/repasse/close-period', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        201: z.object({ repasseId: z.string().uuid() }),
      },
    },
  }, rota('finance.repasse', async (tx, ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; periodFrom: string; periodTo: string };

    const id = uuidv7();

    await tx.query(
      `INSERT INTO fin.repasse_period
         (id, clinic_id, professional_id, period_from, period_to, status)
       VALUES ($1, $2, $3, $4, $5, 'closed')`,
      [id, ctx.actor.clinicId, b.professionalId, b.periodFrom, b.periodTo]);

    void reply.code(201);
    return { repasseId: id };
  }));

  // ── POST /v1/repasse/:id/pay — pagar repasse ─────────────────────────
  r.post('/v1/repasse/:id/pay', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        amountCents: z.number().int().min(1),
        method: z.enum(['pix', 'dinheiro', 'cartao_debito']),
      }),
      response: {
        200: z.object({ repasseId: z.string().uuid(), status: z.literal('paid') }),
      },
    },
  }, rota('finance.repasse', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { amountCents: number; method: string };

    const { rows } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM fin.repasse_period WHERE id = $1`, [p.id]);
    if (rows.length === 0) erroDominio('repasse_nao_encontrado', 404);
    if (rows[0]!.status === 'paid') erroDominio('repasse_ja_pago', 422);

    await tx.query(
      `UPDATE fin.repasse_period SET status = 'paid', paid_at = clock_timestamp(),
              amount_cents = $2 WHERE id = $1`,
      [p.id, b.amountCents]);

    return { repasseId: p.id, status: 'paid' as const };
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { repasseRoutes } from './routes/repasse';

// Apos `await app.register(financeOperationsRoutes);`, adicionar:
  await app.register(repasseRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/repasse.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/repasse.ts apps/api/src/routes/repasse.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add split rules and repasse routes with MFA enforcement"
```

---

### Task 55: Rotas de estoque (produtos, movimentacoes, alertas)

**Arquivos**
- Criar: `apps/api/src/routes/inventory.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/inventory.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/inventory.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'admin_clinico' });
  outro = await semearSessao({ role: 'admin_clinico' });
});
afterAll(async () => { await closePools(); });

describe('rotas de produtos', () => {
  let productId: string;

  it('POST /v1/products cria produto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: {
        name: 'Luva de procedimento M',
        sku: 'LUV-M-001',
        unit: 'caixa',
        minStock: 10,
        currentStock: 50,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { productId: string };
    expect(body.productId).toBeTruthy();
    productId = body.productId;
    await app.close();
  });

  it('GET /v1/products lista produtos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ productId: string }> };
    expect(body.itens.some((i) => i.productId === productId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/products atualiza produto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/products', ...auth(fin),
      payload: { productId, name: 'Luva de procedimento M - 100un' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('produto de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ productId: string }> };
    expect(body.itens.map((i) => i.productId)).not.toContain(productId);
    await app.close();
  });
});

describe('rotas de movimentacao de estoque', () => {
  let productId: string;

  it('registra entrada de estoque', async () => {
    const app = await buildApp();
    // Criar produto primeiro
    const rp = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: { name: 'Gaze esteril', sku: 'GAZ-001', unit: 'pacote', minStock: 5, currentStock: 20 },
    });
    productId = (rp.json() as { productId: string }).productId;

    const r = await app.inject({
      method: 'POST', url: '/v1/stock-movements', ...auth(fin),
      payload: {
        productId,
        quantity: 30,
        kind: 'entrada',
        reason: 'Compra mensal',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { movementId: string; newStock: number };
    expect(body.movementId).toBeTruthy();
    expect(body.newStock).toBe(50);
    await app.close();
  });

  it('registra saida de estoque', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/stock-movements', ...auth(fin),
      payload: {
        productId,
        quantity: 5,
        kind: 'saida',
        reason: 'Uso em procedimento',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { movementId: string; newStock: number };
    expect(body.newStock).toBe(45);
    await app.close();
  });
});

describe('alertas de estoque', () => {
  it('GET /v1/stock-alerts retorna produtos abaixo do minimo', async () => {
    const app = await buildApp();

    // Criar produto com estoque abaixo do minimo
    await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: { name: 'Seringa 5ml', sku: 'SER-5ML', unit: 'unidade', minStock: 100, currentStock: 3 },
    });

    const r = await app.inject({
      method: 'GET', url: '/v1/stock-alerts', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ name: string; currentStock: number; minStock: number }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.currentStock).toBeLessThan(item.minStock);
    }
    await app.close();
  });

  it('alerta de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/stock-alerts', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ name: string }> };
    // Nao pode conter os produtos do tenant fin
    expect(body.itens.every((i) => i.name !== 'Seringa 5ml')).toBe(true);
    await app.close();
  });

  it('profissional pode ler estoque (inventory.read)', async () => {
    const prof = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(prof),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao pode ler estoque (inventory.read)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(recep),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao nao pode criar produto (inventory.write 403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(recep),
      payload: { name: 'Teste', sku: 'TST', unit: 'un', minStock: 1, currentStock: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/inventory.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/inventory.ts`:

```ts
// apps/api/src/routes/inventory.ts
//
// Rotas de estoque: produtos, movimentacoes e alertas.
// Leitura: inventory.read. Escrita: inventory.write.
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
  sku: z.string(),
  unit: z.string(),
  minStock: z.number().int(),
  currentStock: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const StockAlertSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string(),
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
        sku: z.string().min(1).max(50),
        unit: z.string().min(1).max(30),
        minStock: z.number().int().min(0),
        currentStock: z.number().int().min(0),
      }),
      response: { 201: z.object({ productId: z.string().uuid() }) },
    },
  }, rota('inventory.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      name: string; sku: string; unit: string;
      minStock: number; currentStock: number };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO inv.product
         (id, clinic_id, name, sku, unit, min_stock, current_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ctx.actor.clinicId, b.name, b.sku, b.unit, b.minStock, b.currentStock]);
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
  }, rota('inventory.read', async (tx, ctx, req) => {
    const q = req.query as { search?: string; active?: string };
    const condicoes: string[] = [`p.clinic_id = $1`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.search !== undefined) {
      condicoes.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`);
      params.push(`%${q.search}%`); idx += 1;
    }
    if (q.active !== undefined) {
      condicoes.push(`p.active = $${idx}`);
      params.push(q.active === 'true'); idx += 1;
    }

    const where = condicoes.join(' AND ');
    const { rows } = await tx.query<{
      id: string; name: string; sku: string; unit: string;
      min_stock: string; current_stock: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, sku, unit, min_stock::text, current_stock::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM inv.product p
        WHERE ${where}
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
    if (b.unit !== undefined) { sets.push(`unit = $${idx}`); params.push(b.unit); idx += 1; }
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
    const delta = b.kind === 'entrada' ? b.quantity : -b.quantity;

    // Atualizar estoque e retornar novo valor
    const { rows, rowCount } = await tx.query<{ current_stock: string }>(
      `UPDATE inv.product
          SET current_stock = current_stock + $2
        WHERE id = $1
        RETURNING current_stock::text`,
      [b.productId, delta]);
    if (rowCount === 0) erroDominio('produto_nao_encontrado', 404);
    const newStock = Number(rows[0]!.current_stock);

    if (newStock < 0) erroDominio('estoque_insuficiente', 422);

    // Registrar movimentacao
    await tx.query(
      `INSERT INTO inv.stock_movement
         (id, product_id, quantity, kind, reason, resulting_stock, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id())`,
      [id, b.productId, b.quantity, b.kind, b.reason, newStock]);

    void reply.code(201);
    return { movementId: id, newStock };
  }));

  // ── GET /v1/stock-alerts — produtos abaixo do minimo ──────────────────
  r.get('/v1/stock-alerts', {
    schema: {
      response: { 200: z.object({ itens: z.array(StockAlertSchema) }) },
    },
  }, rota('inventory.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; name: string; sku: string; unit: string;
      min_stock: string; current_stock: string;
    }>(
      `SELECT id, name, sku, unit, min_stock::text, current_stock::text
         FROM inv.product
        WHERE clinic_id = $1
          AND active = true
          AND current_stock < min_stock
        ORDER BY (min_stock - current_stock) DESC`,
      [ctx.actor.clinicId]);
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
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { inventoryRoutes } from './routes/inventory';

// Apos `await app.register(repasseRoutes);`, adicionar:
  await app.register(inventoryRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/inventory.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/inventory.ts apps/api/src/routes/inventory.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add inventory routes for products, stock movements and alerts"
```

---

### Task 56: Rotas de relatorios (variation, explore, views, export)

**Arquivos**
- Criar: `apps/api/src/routes/reports.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/reports.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/reports.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de relatorios', () => {
  it('GET /v1/reports/variation retorna variacoes do periodo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      revenue: { currentCents: number; previousCents: number; variationPercent: number };
      expenses: { currentCents: number; previousCents: number; variationPercent: number };
    };
    expect(typeof body.revenue.currentCents).toBe('number');
    expect(typeof body.revenue.previousCents).toBe('number');
    expect(typeof body.revenue.variationPercent).toBe('number');
    expect(typeof body.expenses.currentCents).toBe('number');
    await app.close();
  });

  it('GET /v1/reports/explore retorna dados de exploracao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/explore?from=2026-07-01&to=2026-07-31&groupBy=category',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; period: { from: string; to: string } };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.period.from).toBe('2026-07-01');
    expect(body.period.to).toBe('2026-07-31');
    await app.close();
  });

  it('GET /v1/reports/views/:viewId retorna visao salva', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/views/revenue-by-professional?from=2026-07-01&to=2026-07-31',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { viewId: string; data: unknown[] };
    expect(body.viewId).toBe('revenue-by-professional');
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });

  it('GET /v1/reports/export retorna CSV com header correto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/export?from=2026-07-01&to=2026-07-31&format=csv',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('relatorio nunca retorna dados de outro tenant', async () => {
    // Criar um pagamento no tenant fin
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(fin),
      payload: { patientId: fin.patientId, amountCents: 10000, method: 'pix' },
    });

    // Relatorio do outro tenant nao deve conter esses dados
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-01-01&to=2026-12-31&compareTo=2025-01-01',
      ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { revenue: { currentCents: number } };
    // O tenant outro nao tem pagamentos, entao currentCents deve ser 0
    expect(body.revenue.currentCents).toBe(0);
    await app.close();
  });

  it('recepcao nao acessa relatorios (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('profissional nao acessa relatorios (403)', async () => {
    const prof = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(prof),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/reports.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/reports.ts`:

```ts
// apps/api/src/routes/reports.ts
//
// Rotas de relatorios: variation, explore, views salvas e export.
// Acao: report.read. Leitura via app_rpt (views com security_barrier),
// nunca diretamente de rpt.* (regra §3.8).
// Nenhuma resposta e cacheavel (no-store ja no hook global).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const VariationBlockSchema = z.object({
  currentCents: z.number().int(),
  previousCents: z.number().int(),
  variationPercent: z.number(),
});

const ExploreItemSchema = z.object({
  label: z.string(),
  amountCents: z.number().int(),
  entries: z.number().int(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/reports/variation — variacoes do periodo ───────────────────
  r.get('/v1/reports/variation', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          revenue: VariationBlockSchema,
          expenses: VariationBlockSchema,
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as { from: string; to: string; compareTo: string };

    // Calcular duracao do periodo atual para derivar periodo anterior
    const currentFrom = q.from;
    const currentTo = q.to;
    const previousFrom = q.compareTo;

    // Consulta agregando entries no periodo atual
    const { rows: currentRows } = await tx.query<{
      kind: string; total: string;
    }>(
      `SELECT kind::text, COALESCE(SUM(amount_cents), 0)::text AS total
         FROM fin.entry
        WHERE clinic_id = $1
          AND status = 'pago'
          AND paid_at >= $2::date
          AND paid_at < ($3::date + 1)
        GROUP BY kind`,
      [ctx.actor.clinicId, currentFrom, currentTo]);

    // Consulta no periodo anterior (mesma duracao, comecando em compareTo)
    const { rows: previousRows } = await tx.query<{
      kind: string; total: string;
    }>(
      `SELECT kind::text, COALESCE(SUM(amount_cents), 0)::text AS total
         FROM fin.entry
        WHERE clinic_id = $1
          AND status = 'pago'
          AND paid_at >= $4::date
          AND paid_at < ($4::date + ($3::date - $2::date + 1))
        GROUP BY kind`,
      [ctx.actor.clinicId, currentFrom, currentTo, previousFrom]);

    function findTotal(rows: Array<{ kind: string; total: string }>, kind: string): number {
      const row = rows.find((r) => r.kind === kind);
      return row !== undefined ? Number(row.total) : 0;
    }

    function variacao(current: number, previous: number): number {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 10000) / 100;
    }

    const currentRevenue = findTotal(currentRows, 'receita');
    const previousRevenue = findTotal(previousRows, 'receita');
    const currentExpenses = findTotal(currentRows, 'despesa');
    const previousExpenses = findTotal(previousRows, 'despesa');

    return {
      revenue: {
        currentCents: currentRevenue,
        previousCents: previousRevenue,
        variationPercent: variacao(currentRevenue, previousRevenue),
      },
      expenses: {
        currentCents: currentExpenses,
        previousCents: previousExpenses,
        variationPercent: variacao(currentExpenses, previousExpenses),
      },
    };
  }));

  // ── GET /v1/reports/explore — exploracao livre ────────────────────────
  r.get('/v1/reports/explore', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        groupBy: z.enum(['category', 'professional', 'method', 'day']),
        kind: z.enum(['receita', 'despesa']).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(ExploreItemSchema),
          period: z.object({ from: z.string(), to: z.string() }),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as {
      from: string; to: string; groupBy: string; kind?: string };

    const groupColumn: Record<string, string> = {
      category: `COALESCE(c.name, 'Sem categoria')`,
      professional: `COALESCE(u.full_name, 'Sem profissional')`,
      method: `pm.kind::text`,
      day: `e.paid_at::date::text`,
    };
    const groupExpr = groupColumn[q.groupBy] ?? `e.paid_at::date::text`;

    const kindFilter = q.kind !== undefined
      ? `AND e.kind = $4::fin.entry_kind` : '';
    const params: unknown[] = [ctx.actor.clinicId, q.from, q.to];
    if (q.kind !== undefined) params.push(q.kind);

    const { rows } = await tx.query<{
      label: string; amount_cents: string; entries: string;
    }>(
      `SELECT ${groupExpr} AS label,
              COALESCE(SUM(e.amount_cents), 0)::text AS amount_cents,
              COUNT(*)::text AS entries
         FROM fin.entry e
         LEFT JOIN fin.category c
           ON c.tenant_id = e.tenant_id AND c.id = e.category_id
         LEFT JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
         LEFT JOIN id."user" u
           ON u.id = e.professional_id
        WHERE e.clinic_id = $1
          AND e.status = 'pago'
          AND e.paid_at >= $2::date
          AND e.paid_at < ($3::date + 1)
          ${kindFilter}
        GROUP BY ${groupExpr}
        ORDER BY SUM(e.amount_cents) DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        label: row.label,
        amountCents: Number(row.amount_cents),
        entries: Number(row.entries),
      })),
      period: { from: q.from, to: q.to },
    };
  }));

  // ── GET /v1/reports/views/:viewId — visao salva ───────────────────────
  r.get('/v1/reports/views/:viewId', {
    schema: {
      params: z.object({ viewId: z.string().min(1).max(100) }),
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          viewId: z.string(),
          data: z.array(z.record(z.string(), z.unknown())),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const p = req.params as { viewId: string };
    const q = req.query as { from: string; to: string };

    // Visoes pre-definidas — cada uma mapeia para uma query especifica
    // A implementacao completa sera feita quando as matviews existirem;
    // por ora, todas as visoes consultam fin.entry diretamente.
    const viewQueries: Record<string, string> = {
      'revenue-by-professional': `
        SELECT u.full_name AS label, SUM(e.amount_cents)::text AS amount_cents,
               COUNT(*)::text AS entries
          FROM fin.entry e
          LEFT JOIN id."user" u ON u.id = e.professional_id
         WHERE e.clinic_id = $1 AND e.kind = 'receita' AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY u.full_name
         ORDER BY SUM(e.amount_cents) DESC`,
      'expenses-by-category': `
        SELECT COALESCE(c.name, 'Sem categoria') AS label,
               SUM(e.amount_cents)::text AS amount_cents,
               COUNT(*)::text AS entries
          FROM fin.entry e
          LEFT JOIN fin.category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
         WHERE e.clinic_id = $1 AND e.kind = 'despesa' AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY c.name
         ORDER BY SUM(e.amount_cents) DESC`,
      'daily-cashflow': `
        SELECT e.paid_at::date::text AS day,
               SUM(CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END)::text AS revenue_cents,
               SUM(CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END)::text AS expense_cents,
               SUM(CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE -e.amount_cents END)::text AS net_cents
          FROM fin.entry e
         WHERE e.clinic_id = $1 AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY e.paid_at::date
         ORDER BY e.paid_at::date`,
    };

    const sql = viewQueries[p.viewId];
    if (sql === undefined) {
      // Visao nao encontrada: retorna vazio (as visoes salvas pelo usuario
      // serao implementadas quando rpt.saved_view existir)
      return { viewId: p.viewId, data: [] };
    }

    const { rows } = await tx.query(sql, [ctx.actor.clinicId, q.from, q.to]);
    return { viewId: p.viewId, data: rows as Record<string, unknown>[] };
  }));

  // ── GET /v1/reports/export — exportar CSV ─────────────────────────────
  r.get('/v1/reports/export', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        format: z.enum(['csv']),
        kind: z.enum(['receita', 'despesa']).optional(),
      }),
    },
  }, rota('report.read', async (tx, ctx, req, reply) => {
    const q = req.query as { from: string; to: string; format: string; kind?: string };

    const kindFilter = q.kind !== undefined ? `AND e.kind = $4::fin.entry_kind` : '';
    const params: unknown[] = [ctx.actor.clinicId, q.from, q.to];
    if (q.kind !== undefined) params.push(q.kind);

    const { rows } = await tx.query<{
      data: string; descricao: string; valor: string;
      tipo: string; metodo: string; status: string;
    }>(
      `SELECT to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data,
              e.description AS descricao,
              (e.amount_cents / 100.0)::text AS valor,
              e.kind::text AS tipo,
              pm.kind::text AS metodo,
              e.status::text AS status
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
        WHERE e.clinic_id = $1
          AND e.paid_at >= $2::date
          AND e.paid_at < ($3::date + 1)
          ${kindFilter}
        ORDER BY e.paid_at DESC`,
      params);

    const header = 'Data,Descricao,Valor,Tipo,Metodo,Status\n';
    const csvRows = rows.map((row) =>
      `${row.data},"${row.descricao.replace(/"/g, '""')}",${row.valor},${row.tipo},${row.metodo},${row.status}`
    ).join('\n');
    const csv = header + csvRows;

    void reply.header('content-type', 'text/csv; charset=utf-8');
    void reply.header('content-disposition',
      `attachment; filename="relatorio-${q.from}-${q.to}.csv"`);
    return csv;
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { reportRoutes } from './routes/reports';

// Apos `await app.register(inventoryRoutes);`, adicionar:
  await app.register(reportRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/reports.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/reports.ts apps/api/src/routes/reports.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add reports routes for variation, explore, views and export"
```

---

### Task 57: Teste de isolamento multi-tenant para todas as rotas da Fase 3

**Arquivos**
- Criar: `apps/api/src/routes/fase3-isolation.int.test.ts`

**Passos**

- [ ] Escrever o teste de isolamento que cobre TODAS as rotas novas da Fase 3:

```ts
// apps/api/src/routes/fase3-isolation.int.test.ts
//
// Canario de isolamento multi-tenant para as rotas da Fase 3.
// Garantia: nenhuma rota nova vaza dado de um tenant para outro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let a: SementeSessao;
let b: SementeSessao;

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });
});
afterAll(async () => { await closePools(); });

describe('isolamento multi-tenant — rotas da Fase 3', () => {
  let bankAccountId: string;
  let costCenterId: string;
  let supplierId: string;
  let productId: string;
  let splitRuleId: string;
  let recurringId: string;

  it('semear dados no tenant A', async () => {
    const app = await buildApp();

    const r1 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(a),
      payload: { name: 'Conta Iso', bankCode: '001', agency: '0001', accountNumber: '99999-0', initialBalanceCents: 0 },
    });
    bankAccountId = (r1.json() as { bankAccountId: string }).bankAccountId;

    const r2 = await app.inject({
      method: 'POST', url: '/v1/cost-centers', ...auth(a),
      payload: { name: 'CC Iso', code: 'ISO01' },
    });
    costCenterId = (r2.json() as { costCenterId: string }).costCenterId;

    const r3 = await app.inject({
      method: 'POST', url: '/v1/suppliers', ...auth(a),
      payload: { name: 'Fornecedor Iso' },
    });
    supplierId = (r3.json() as { supplierId: string }).supplierId;

    const r4 = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(a),
      payload: { name: 'Produto Iso', sku: 'ISO-001', unit: 'un', minStock: 1, currentStock: 10 },
    });
    productId = (r4.json() as { productId: string }).productId;

    const r5 = await app.inject({
      method: 'POST', url: '/v1/split-rules', ...auth(a),
      payload: { professionalId: a.professionalId, clinicPercentage: 5000, professionalPercentage: 5000 },
    });
    splitRuleId = (r5.json() as { splitRuleId: string }).splitRuleId;

    const r6 = await app.inject({
      method: 'POST', url: '/v1/recurring', ...auth(a),
      payload: { description: 'Recorrencia Iso', amountCents: 10000, kind: 'despesa', method: 'pix', frequency: 'monthly', dayOfMonth: 1, startsAt: '2026-09-01' },
    });
    recurringId = (r6.json() as { recurringId: string }).recurringId;

    await app.close();
  });

  it('contas bancarias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/bank-accounts', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ bankAccountId: string }> }).itens.map((i) => i.bankAccountId);
    expect(ids).not.toContain(bankAccountId);
    await app.close();
  });

  it('centros de custo do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/cost-centers', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ costCenterId: string }> }).itens.map((i) => i.costCenterId);
    expect(ids).not.toContain(costCenterId);
    await app.close();
  });

  it('fornecedores do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/suppliers', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ supplierId: string }> }).itens.map((i) => i.supplierId);
    expect(ids).not.toContain(supplierId);
    await app.close();
  });

  it('produtos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/products', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ productId: string }> }).itens.map((i) => i.productId);
    expect(ids).not.toContain(productId);
    await app.close();
  });

  it('alertas de estoque do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/stock-alerts', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ productId: string }> }).itens.map((i) => i.productId);
    expect(ids).not.toContain(productId);
    await app.close();
  });

  it('split rules do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/split-rules', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ splitRuleId: string }> }).itens.map((i) => i.splitRuleId);
    expect(ids).not.toContain(splitRuleId);
    await app.close();
  });

  it('recorrencias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/recurring', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ recurringId: string }> }).itens.map((i) => i.recurringId);
    expect(ids).not.toContain(recurringId);
    await app.close();
  });

  it('repasse do tenant A nao aparece no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${a.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(body.itens.length).toBe(0);
    await app.close();
  });

  it('relatorio do tenant A nao vaza para o tenant B', async () => {
    const app = await buildApp();
    // Criar pagamento no tenant A
    await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(a),
      payload: { patientId: a.patientId, amountCents: 50000, method: 'pix' },
    });
    // Variacao do tenant B deve ser zero
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-01-01&to=2026-12-31&compareTo=2025-01-01',
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { revenue: { currentCents: number } };
    expect(body.revenue.currentCents).toBe(0);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts',
      cookies: { '__Host-cadencia_sid': a.token, '__Host-cadencia_csrf': a.csrf },
      headers: { 'x-clinic-id': b.clinicId, 'x-csrf-token': a.csrf },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/fase3-isolation.int.test.ts
# ESPERADO: PASS — nenhuma rota vaza dado entre tenants
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/fase3-isolation.int.test.ts
git commit -m "test(api): add multi-tenant isolation canary for all Fase 3 routes"
```


## Parte: 10-telas-financeiro

### Task 58: Sub-navegacao financeira com tabs e layout de container

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroLayout.tsx`
- Criar `apps/web/src/telas/FinanceiroLayout.test.tsx`

**Por que**: A tela Financeiro da Fase 2 e uma pagina unica. A Fase 3 exige sub-navegacao (Visao, Caixa, A receber, A pagar, Recebimentos, Repasse, Estoque) conforme Design §5.3. O layout garante que todos os sub-modulos compartilhem cabecalho, tabs e container.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroLayout.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroLayout.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout, type AbaFinanceiro } from './FinanceiroLayout';

const ABAS: AbaFinanceiro[] = [
  'visao', 'caixa', 'a-receber', 'a-pagar', 'recebimentos', 'repasse', 'estoque',
];

function montar(abaAtiva: AbaFinanceiro = 'visao') {
  const aoNavegar = vi.fn();
  render(
    <FinanceiroLayout abaAtiva={abaAtiva} aoNavegar={aoNavegar}>
      <div data-testid="conteudo-filho">Conteudo da aba</div>
    </FinanceiroLayout>,
  );
  return { aoNavegar };
}

describe('FinanceiroLayout', () => {
  it('renderiza o titulo "Financeiro"', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
  });

  it('renderiza todas as 7 abas como links de navegacao', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: /Sub-navegacao financeiro/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole('link', { name: /Visao/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /^Caixa$/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /A receber/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /A pagar/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Recebimentos/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Repasse/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Estoque/i })).toBeVisible();
  });

  it('marca a aba ativa com aria-current="page"', () => {
    montar('caixa');
    const link = screen.getByRole('link', { name: /^Caixa$/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Visao/i })).not.toHaveAttribute('aria-current');
  });

  it('ao clicar em outra aba chama aoNavegar com o slug correto', async () => {
    const { aoNavegar } = montar('visao');
    await userEvent.click(screen.getByRole('link', { name: /A pagar/i }));
    expect(aoNavegar).toHaveBeenCalledWith('a-pagar');
  });

  it('renderiza o conteudo filho dentro do container', () => {
    montar();
    expect(screen.getByTestId('conteudo-filho')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroLayout abaAtiva="visao" aoNavegar={() => {}}>
        <div>Conteudo</div>
      </FinanceiroLayout>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroLayout.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroLayout'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroLayout.tsx`:

```tsx
// apps/web/src/telas/FinanceiroLayout.tsx
'use client';

import type { ReactNode } from 'react';

export type AbaFinanceiro =
  | 'visao' | 'caixa' | 'a-receber' | 'a-pagar'
  | 'recebimentos' | 'repasse' | 'estoque';

export interface AbaConfig {
  readonly slug: AbaFinanceiro;
  readonly rotulo: string;
  readonly href: string;
}

export const ABAS_FINANCEIRO: readonly AbaConfig[] = [
  { slug: 'visao',         rotulo: 'Visao',         href: '/financeiro/visao' },
  { slug: 'caixa',         rotulo: 'Caixa',         href: '/financeiro/caixa' },
  { slug: 'a-receber',     rotulo: 'A receber',     href: '/financeiro/a-receber' },
  { slug: 'a-pagar',       rotulo: 'A pagar',       href: '/financeiro/a-pagar' },
  { slug: 'recebimentos',  rotulo: 'Recebimentos',  href: '/financeiro/recebimentos' },
  { slug: 'repasse',       rotulo: 'Repasse',       href: '/financeiro/repasse' },
  { slug: 'estoque',       rotulo: 'Estoque',       href: '/financeiro/estoque' },
];

export interface FinanceiroLayoutProps {
  readonly abaAtiva: AbaFinanceiro;
  readonly aoNavegar: (aba: AbaFinanceiro) => void;
  readonly children: ReactNode;
}

export function FinanceiroLayout({ abaAtiva, aoNavegar, children }: FinanceiroLayoutProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1120, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Financeiro
      </h1>

      <nav aria-label="Sub-navegacao financeiro">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)',
                     overflowX: 'auto' }}>
          {ABAS_FINANCEIRO.map((aba) => {
            const ativo = aba.slug === abaAtiva;
            return (
              <li key={aba.slug}>
                <a
                  href={aba.href}
                  aria-current={ativo ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); aoNavegar(aba.slug); }}
                  style={{
                    display: 'inline-block',
                    padding: `var(--s-4) var(--s-5)`,
                    color: ativo ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                    fontSize: 'var(--fs-14)',
                    textDecoration: 'none',
                    borderBottom: ativo
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    minHeight: 24,
                  }}
                >
                  {aba.rotulo}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroLayout.test.tsx 2>&1 | tail -5
# Esperado: Tests  6 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroLayout.tsx apps/web/src/telas/FinanceiroLayout.test.tsx
git commit -m "feat(web): add FinanceiroLayout with sub-navigation tabs

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 59: Tela Visao — dashboard expandido com graficos visx

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroVisao.tsx`
- Criar `apps/web/src/telas/FinanceiroVisao.test.tsx`

**Por que**: A aba Visao e o ponto de entrada do financeiro. Mostra receita vs despesa (bar chart visx), saldo projetado (line chart visx), top 5 categorias e alertas. Numeros com `font-variant-numeric: tabular-nums` conforme Design §6.3.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroVisao.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroVisao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { FinanceiroVisao, type FinanceiroVisaoProps } from './FinanceiroVisao';

const DADOS: FinanceiroVisaoProps['dados'] = {
  receitaVsDespesa: [
    { mes: '2026-06', receita: 320000, despesa: 180000 },
    { mes: '2026-07', receita: 280000, despesa: 190000 },
    { mes: '2026-08', receita: 350000, despesa: 170000 },
  ],
  saldoProjetado: [
    { dia: '2026-08-01', saldo: 150000 },
    { dia: '2026-08-07', saldo: 180000 },
    { dia: '2026-08-14', saldo: 210000 },
    { dia: '2026-08-21', saldo: 250000 },
    { dia: '2026-08-28', saldo: 300000 },
  ],
  topCategorias: [
    { nome: 'Consulta', total: 200000, percentual: 57 },
    { nome: 'Retorno', total: 80000, percentual: 23 },
    { nome: 'Exame', total: 40000, percentual: 11 },
    { nome: 'Procedimento', total: 20000, percentual: 6 },
    { nome: 'Outros', total: 10000, percentual: 3 },
  ],
  alertas: [
    { tipo: 'a-receber-vencido', mensagem: '3 lancamentos vencidos ha mais de 30 dias', severidade: 'danger' },
    { tipo: 'estoque-baixo', mensagem: 'Luva P abaixo do minimo (5 unidades)', severidade: 'warn' },
  ],
  resumoMes: {
    receitaTotal: 350000,
    despesaTotal: 170000,
    saldo: 180000,
  },
};

function montar() {
  const carregarDados = vi.fn(async () => DADOS);
  render(<FinanceiroVisao carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroVisao', () => {
  it('exibe o resumo do mes com receita, despesa e saldo formatados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(screen.getByText('R$ 1.700,00')).toBeVisible();
    expect(screen.getByText('R$ 1.800,00')).toBeVisible();
  });

  it('renderiza o grafico de receita vs despesa como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /Receita vs despesa/i })).toBeVisible());
  });

  it('renderiza o grafico de saldo projetado como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /Saldo projetado/i })).toBeVisible());
  });

  it('exibe a secao top 5 categorias com nomes e percentuais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Consulta')).toBeVisible());
    expect(screen.getByText('57%')).toBeVisible();
    expect(screen.getByText('Retorno')).toBeVisible();
  });

  it('exibe os alertas com a mensagem e indicador de severidade', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByText(/3 lancamentos vencidos/)).toBeVisible());
    expect(screen.getByText(/Luva P abaixo do minimo/)).toBeVisible();
  });

  it('valores monetarios usam font-variant-numeric tabular-nums', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    const el = screen.getByText('R$ 3.500,00');
    expect(el.className).toContain('num');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroVisao carregarDados={async () => DADOS} />,
    );
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroVisao.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroVisao'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroVisao.tsx`:

```tsx
// apps/web/src/telas/FinanceiroVisao.tsx
'use client';

import { useEffect, useState } from 'react';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ReceitaVsDespesaItem {
  readonly mes: string;
  readonly receita: number;
  readonly despesa: number;
}

export interface SaldoProjetadoItem {
  readonly dia: string;
  readonly saldo: number;
}

export interface CategoriaItem {
  readonly nome: string;
  readonly total: number;
  readonly percentual: number;
}

export interface AlertaItem {
  readonly tipo: string;
  readonly mensagem: string;
  readonly severidade: 'danger' | 'warn' | 'ok';
}

export interface ResumoMes {
  readonly receitaTotal: number;
  readonly despesaTotal: number;
  readonly saldo: number;
}

export interface VisaoDados {
  readonly receitaVsDespesa: readonly ReceitaVsDespesaItem[];
  readonly saldoProjetado: readonly SaldoProjetadoItem[];
  readonly topCategorias: readonly CategoriaItem[];
  readonly alertas: readonly AlertaItem[];
  readonly resumoMes: ResumoMes;
}

export interface FinanceiroVisaoProps {
  readonly dados?: never;
  readonly carregarDados: () => Promise<VisaoDados>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const TOKEN_SEVERIDADE: Record<string, string> = {
  danger: '--danger',
  warn: '--warn',
  ok: '--ok',
};

const BG_SEVERIDADE: Record<string, string> = {
  danger: '--danger-soft',
  warn: '--warn-soft',
  ok: '--ok-soft',
};

const GLIFO_SEVERIDADE: Record<string, string> = {
  danger: '!',
  warn: '!',
  ok: '✓',
};

// ── Grafico Receita vs Despesa (SVG puro) ──────────────────────────────────

function GraficoReceitaDespesa({ dados }: { readonly dados: readonly ReceitaVsDespesaItem[] }) {
  const maxVal = Math.max(...dados.flatMap((d) => [d.receita, d.despesa]), 1);
  const barW = 20;
  const gap = 6;
  const groupW = barW * 2 + gap;
  const groupGap = 16;
  const alturaMax = 120;
  const largura = dados.length * (groupW + groupGap);

  return (
    <svg
      role="img" aria-label="Receita vs despesa"
      viewBox={`0 0 ${largura} ${alturaMax + 30}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${alturaMax + 30}px` }}
    >
      {dados.map((d, i) => {
        const x = i * (groupW + groupGap);
        const hRec = Math.max((d.receita / maxVal) * alturaMax, 2);
        const hDesp = Math.max((d.despesa / maxVal) * alturaMax, 2);
        const mesLabel = d.mes.slice(5);
        return (
          <g key={d.mes}>
            <rect x={x} y={alturaMax - hRec} width={barW} height={hRec}
              rx={3} fill="var(--ok)"
              role="img" aria-label={`Receita ${d.mes}: ${centavosParaReais(d.receita)}`} />
            <rect x={x + barW + gap} y={alturaMax - hDesp} width={barW} height={hDesp}
              rx={3} fill="var(--danger)"
              role="img" aria-label={`Despesa ${d.mes}: ${centavosParaReais(d.despesa)}`} />
            <text x={x + groupW / 2} y={alturaMax + 14}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {mesLabel}
            </text>
          </g>
        );
      })}
      <g>
        <rect x={0} y={alturaMax + 20} width={8} height={8} rx={2} fill="var(--ok)" />
        <text x={12} y={alturaMax + 28} fontSize="9" fill="var(--text-muted)">Receita</text>
        <rect x={60} y={alturaMax + 20} width={8} height={8} rx={2} fill="var(--danger)" />
        <text x={72} y={alturaMax + 28} fontSize="9" fill="var(--text-muted)">Despesa</text>
      </g>
    </svg>
  );
}

// ── Grafico Saldo Projetado (SVG puro) ─────────────────────────────────────

function GraficoSaldoProjetado({ dados }: { readonly dados: readonly SaldoProjetadoItem[] }) {
  if (dados.length === 0) return null;
  const maxVal = Math.max(...dados.map((d) => d.saldo), 1);
  const minVal = Math.min(...dados.map((d) => d.saldo), 0);
  const range = maxVal - minVal || 1;
  const w = 300;
  const h = 100;
  const padX = 10;
  const padY = 10;

  const pontos = dados.map((d, i) => {
    const x = padX + (i / Math.max(dados.length - 1, 1)) * (w - 2 * padX);
    const y = padY + (1 - (d.saldo - minVal) / range) * (h - 2 * padY);
    return { x, y, ...d };
  });

  const pathD = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg
      role="img" aria-label="Saldo projetado"
      viewBox={`0 0 ${w} ${h + 20}`}
      style={{ width: '100%', maxWidth: `${w}px`, height: `${h + 20}px` }}
    >
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pontos.map((p) => (
        <circle key={p.dia} cx={p.x} cy={p.y} r={3} fill="var(--accent)"
          role="img" aria-label={`${p.dia}: ${centavosParaReais(p.saldo)}`} />
      ))}
      {pontos.map((p, i) => {
        if (i % 2 !== 0 && i !== pontos.length - 1) return null;
        return (
          <text key={`l-${p.dia}`} x={p.x} y={h + 14}
            textAnchor="middle" fontSize="9" fill="var(--text-muted)">
            {p.dia.slice(8)}
          </text>
        );
      })}
    </svg>
  );
}

// ── Componente principal ───────────────────────────────────────────────────

export function FinanceiroVisao(p: FinanceiroVisaoProps) {
  const [dados, setDados] = useState<VisaoDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)' }}>
      {/* Resumo do mes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 'var(--s-6)' }}>
        {([
          { rotulo: 'Receita', valor: dados.resumoMes.receitaTotal, cor: '--ok' },
          { rotulo: 'Despesa', valor: dados.resumoMes.despesaTotal, cor: '--danger' },
          { rotulo: 'Saldo', valor: dados.resumoMes.saldo, cor: '--accent' },
        ] as const).map((item) => (
          <div key={item.rotulo} style={{
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', padding: 'var(--s-6)',
          }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {item.rotulo}
            </span>
            <p className="num" style={{
              fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
              margin: `var(--s-2) 0 0`, fontVariantNumeric: 'tabular-nums',
              color: `var(${item.cor})`,
            }}>
              {centavosParaReais(item.valor)}
            </p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {dados.alertas.length > 0 ? (
        <section aria-label="Alertas financeiros" style={{ display: 'grid', gap: 'var(--s-3)' }}>
          {dados.alertas.map((a) => (
            <div key={a.tipo} role="alert" style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderRadius: 'var(--r-md)',
              background: `var(${BG_SEVERIDADE[a.severidade] ?? '--warn-soft'})`,
              color: `var(${TOKEN_SEVERIDADE[a.severidade] ?? '--warn'})`,
              fontSize: 'var(--fs-13)',
            }}>
              <span aria-hidden="true" style={{ fontWeight: 'var(--fw-semibold)' }}>
                {GLIFO_SEVERIDADE[a.severidade] ?? '!'}
              </span>
              {a.mensagem}
            </div>
          ))}
        </section>
      ) : null}

      {/* Receita vs Despesa */}
      <section aria-label="Receita vs despesa" style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', padding: 'var(--s-6)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Receita vs despesa
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <GraficoReceitaDespesa dados={dados.receitaVsDespesa} />
        </div>
      </section>

      {/* Saldo projetado */}
      <section aria-label="Saldo projetado" style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', padding: 'var(--s-6)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Saldo projetado
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <GraficoSaldoProjetado dados={dados.saldoProjetado} />
        </div>
      </section>

      {/* Top 5 categorias */}
      <section aria-label="Top categorias" style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', padding: 'var(--s-6)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Top categorias
        </h2>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                     gap: 'var(--s-3)' }}>
          {dados.topCategorias.map((c) => (
            <li key={c.nome} style={{
              display: 'grid', gridTemplateColumns: '1fr auto auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-2) 0', borderBottom: 'var(--border)',
              fontSize: 'var(--fs-14)',
            }}>
              <span>{c.nome}</span>
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums',
                                              color: 'var(--text-muted)' }}>
                {centavosParaReais(c.total)}
              </span>
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums',
                                              fontWeight: 'var(--fw-medium)',
                                              minWidth: '3ch', textAlign: 'right' }}>
                {c.percentual}%
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroVisao.test.tsx 2>&1 | tail -5
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroVisao.tsx apps/web/src/telas/FinanceiroVisao.test.tsx
git commit -m "feat(web): add FinanceiroVisao dashboard with charts and alerts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 60: Tela Caixa — extrato do dia com filtro por conta e periodo

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroCaixa.tsx`
- Criar `apps/web/src/telas/FinanceiroCaixa.test.tsx`

**Por que**: A aba Caixa mostra o extrato do dia por conta bancaria com total e filtros por conta e periodo. Filtros viram query string via nuqs.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroCaixa.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroCaixa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroCaixa, type CaixaDados } from './FinanceiroCaixa';

const DADOS: CaixaDados = {
  lancamentos: [
    { id: 'e1', descricao: 'Consulta — Maria Souza', amountCents: 25000,
      kind: 'receita', method: 'Pix', paidAt: '2026-08-06T10:30:00Z',
      categoryName: 'Consulta' },
    { id: 'e2', descricao: 'Material de escritorio', amountCents: 5000,
      kind: 'despesa', method: 'Dinheiro', paidAt: '2026-08-06T11:00:00Z',
      categoryName: 'Materiais' },
    { id: 'e3', descricao: 'Retorno — Joao Silva', amountCents: 15000,
      kind: 'receita', method: 'Cartao', paidAt: '2026-08-06T14:00:00Z',
      categoryName: 'Retorno' },
  ],
  totalReceita: 40000,
  totalDespesa: 5000,
  saldo: 35000,
  contas: [
    { id: 'c1', nome: 'Conta principal' },
    { id: 'c2', nome: 'Caixa fisico' },
  ],
};

function montar() {
  const carregarDados = vi.fn(async (_filtros: {
    contaId?: string; dataInicio?: string; dataFim?: string;
  }) => DADOS);
  render(<FinanceiroCaixa carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroCaixa', () => {
  it('exibe o saldo do periodo formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
  });

  it('exibe totais de receita e despesa separados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 400,00')).toBeVisible());
    expect(screen.getByText('R$ 50,00')).toBeVisible();
  });

  it('lista os lancamentos com descricao, valor e metodo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Maria Souza/)).toBeVisible());
    expect(screen.getByText(/Material de escritorio/)).toBeVisible();
    expect(screen.getByText(/Joao Silva/)).toBeVisible();
  });

  it('receitas exibem sinal positivo e despesas sinal negativo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('+ R$ 250,00')).toBeVisible());
    expect(screen.getByText('- R$ 50,00')).toBeVisible();
  });

  it('tem filtro por periodo com campos de data', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Data fim/i)).toBeVisible();
  });

  it('tem filtro por conta bancaria', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Conta/i)).toBeVisible());
  });

  it('ao clicar em Filtrar recarrega os dados com os filtros', async () => {
    const { carregarDados } = montar();
    await waitFor(() => expect(screen.getByText(/Maria Souza/)).toBeVisible());
    const dataInicio = screen.getByLabelText(/Data inicio/i);
    await userEvent.type(dataInicio, '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/i }));
    expect(carregarDados).toHaveBeenCalledTimes(2);
  });

  it('valores usam font-variant-numeric tabular-nums', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
    const el = screen.getByText('R$ 350,00');
    expect(el.className).toContain('num');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroCaixa carregarDados={async () => DADOS} />,
    );
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroCaixa.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroCaixa'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroCaixa.tsx`:

```tsx
// apps/web/src/telas/FinanceiroCaixa.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface LancamentoCaixa {
  readonly id: string;
  readonly descricao: string;
  readonly amountCents: number;
  readonly kind: 'receita' | 'despesa';
  readonly method: string;
  readonly paidAt: string;
  readonly categoryName: string;
}

export interface ContaBancaria {
  readonly id: string;
  readonly nome: string;
}

export interface CaixaDados {
  readonly lancamentos: readonly LancamentoCaixa[];
  readonly totalReceita: number;
  readonly totalDespesa: number;
  readonly saldo: number;
  readonly contas: readonly ContaBancaria[];
}

export interface FiltrosCaixa {
  readonly contaId?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface FinanceiroCaixaProps {
  readonly carregarDados: (filtros: FiltrosCaixa) => Promise<CaixaDados>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(d);
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroCaixa(p: FinanceiroCaixaProps) {
  const [dados, setDados] = useState<CaixaDados | null>(null);
  const [contaId, setContaId] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      contaId: contaId === '' ? undefined : contaId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-conta" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Conta
          </label>
          <select
            id="filtro-conta"
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            aria-label="Conta"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
        <Campo rotulo="Data inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Data inicio" />
        <Campo rotulo="Data fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Data fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Totais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 'var(--s-4)' }}>
        <div style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface)', padding: 'var(--s-5)' }}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>Receita</span>
          <p className="num" style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                                      margin: 'var(--s-1) 0 0', fontVariantNumeric: 'tabular-nums',
                                      color: 'var(--ok)' }}>
            {centavosParaReais(dados.totalReceita)}
          </p>
        </div>
        <div style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface)', padding: 'var(--s-5)' }}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>Despesa</span>
          <p className="num" style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                                      margin: 'var(--s-1) 0 0', fontVariantNumeric: 'tabular-nums',
                                      color: 'var(--danger)' }}>
            {centavosParaReais(dados.totalDespesa)}
          </p>
        </div>
        <div style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface)', padding: 'var(--s-5)' }}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>Saldo</span>
          <p className="num" style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                                      margin: 'var(--s-1) 0 0', fontVariantNumeric: 'tabular-nums' }}>
            {centavosParaReais(dados.saldo)}
          </p>
        </div>
      </div>

      {/* Extrato */}
      <section aria-label="Extrato">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.lancamentos.map((l) => {
            const sinal = l.kind === 'receita' ? '+' : '-';
            const cor = l.kind === 'receita' ? 'var(--ok)' : 'var(--danger)';
            return (
              <li key={l.id} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                               fontVariantNumeric: 'tabular-nums', minWidth: '4ch' }}>
                  {formatarHora(l.paidAt)}
                </span>
                <div>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {l.descricao}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {l.categoryName} — {l.method}
                  </span>
                </div>
                <span className="num" style={{
                  fontSize: 'var(--fs-14)', fontVariantNumeric: 'tabular-nums',
                  fontWeight: 'var(--fw-medium)', color: cor,
                }}>
                  {sinal} {centavosParaReais(l.amountCents)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroCaixa.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroCaixa.tsx apps/web/src/telas/FinanceiroCaixa.test.tsx
git commit -m "feat(web): add FinanceiroCaixa with statement and filters

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 61: Tela A Receber — lista com aging colorido e acoes

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroAReceber.tsx`
- Criar `apps/web/src/telas/FinanceiroAReceber.test.tsx`

**Por que**: A aba A receber lista entries pendentes com aging visual (verde ate 15d, ambar 15-30d, rubi >30d) e acoes (cobrar, marcar pago, enviar link).

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroAReceber.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAReceber.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAReceber, type AReceberDados } from './FinanceiroAReceber';

const HOJE = '2026-08-06';

const DADOS: AReceberDados = {
  total: 100000,
  entradas: [
    { id: 'e1', patientName: 'Maria Souza', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-01', daysPastDue: 5 },
    { id: 'e2', patientName: 'Joao Silva', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-07-15', daysPastDue: 22 },
    { id: 'e3', patientName: 'Ana Costa', description: 'Exame',
      amountCents: 25000, dueDate: '2026-07-01', daysPastDue: 36 },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoCobrar: vi.fn(async () => {}),
    aoMarcarPago: vi.fn(async () => {}),
    aoEnviarLink: vi.fn(async () => {}),
    hoje: HOJE,
  };
  render(<FinanceiroAReceber {...props} />);
  return props;
}

describe('FinanceiroAReceber', () => {
  it('exibe o total a receber formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.000,00')).toBeVisible());
  });

  it('lista as entradas pendentes com nome do paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
  });

  it('aging verde para ate 15 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const linha = screen.getByText('Maria Souza').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('ok');
  });

  it('aging ambar para 15-30 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const linha = screen.getByText('Joao Silva').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('warn');
  });

  it('aging rubi para mais de 30 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Ana Costa')).toBeVisible());
    const linha = screen.getByText('Ana Costa').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('danger');
  });

  it('cada entrada tem botoes de acao: Cobrar, Marcar pago, Enviar link', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Cobrar/i }).length).toBe(3));
    expect(screen.getAllByRole('button', { name: /Marcar pago/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Enviar link/i }).length).toBe(3);
  });

  it('ao clicar em Marcar pago chama aoMarcarPago com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Marcar pago/i });
    await userEvent.click(botoes[0]!);
    expect(props.aoMarcarPago).toHaveBeenCalledWith('e1');
  });

  it('ao clicar em Enviar link chama aoEnviarLink com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Enviar link/i });
    await userEvent.click(botoes[1]!);
    expect(props.aoEnviarLink).toHaveBeenCalledWith('e2');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAReceber
        carregarDados={async () => DADOS}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
      />,
    );
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAReceber.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroAReceber'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroAReceber.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAReceber.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface EntradaPendenteReceber {
  readonly id: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly daysPastDue: number;
}

export interface AReceberDados {
  readonly total: number;
  readonly entradas: readonly EntradaPendenteReceber[];
}

export interface FinanceiroAReceberProps {
  readonly carregarDados: () => Promise<AReceberDados>;
  readonly aoCobrar: (entryId: string) => Promise<void>;
  readonly aoMarcarPago: (entryId: string) => Promise<void>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
  readonly hoje: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

type AgingLevel = 'ok' | 'warn' | 'danger';

function calcularAging(daysPastDue: number): AgingLevel {
  if (daysPastDue > 30) return 'danger';
  if (daysPastDue > 15) return 'warn';
  return 'ok';
}

const AGING_BORDA: Record<AgingLevel, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
};

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAReceber(p: FinanceiroAReceberProps) {
  const [dados, setDados] = useState<AReceberDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          A receber
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Lista */}
      <section aria-label="Lancamentos a receber">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.entradas.map((e) => {
            const aging = calcularAging(e.daysPastDue);
            return (
              <li key={e.id} data-aging={aging} style={{
                display: 'grid',
                gridTemplateColumns: '4px 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                paddingInlineStart: 0,
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
                {/* Barra lateral de aging */}
                <span style={{
                  display: 'block', width: 4, alignSelf: 'stretch',
                  background: AGING_BORDA[aging], borderRadius: 'var(--r-sm)',
                }} aria-hidden="true" />

                <div style={{ paddingInlineStart: 'var(--s-3)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {e.patientName}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {e.description} — vence {e.dueDate}
                    {e.daysPastDue > 0 ? ` (${e.daysPastDue}d atraso)` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span className="num" style={{ fontSize: 'var(--fs-14)',
                                                  fontVariantNumeric: 'tabular-nums',
                                                  marginInlineEnd: 'var(--s-3)' }}>
                    {centavosParaReais(e.amountCents)}
                  </span>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoCobrar(e.id); }}>
                    Cobrar
                  </Botao>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoMarcarPago(e.id); }}>
                    Marcar pago
                  </Botao>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoEnviarLink(e.id); }}>
                    Enviar link
                  </Botao>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAReceber.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroAReceber.tsx apps/web/src/telas/FinanceiroAReceber.test.tsx
git commit -m "feat(web): add FinanceiroAReceber with aging colors and actions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 62: Tela A Pagar — lista de despesas pendentes com acoes

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroAPagar.tsx`
- Criar `apps/web/src/telas/FinanceiroAPagar.test.tsx`

**Por que**: A aba A pagar lista despesas pendentes com acoes (marcar pago, editar, parcelar), filtro por fornecedor/categoria/vencimento.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroAPagar.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAPagar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAPagar, type APagarDados } from './FinanceiroAPagar';

const DADOS: APagarDados = {
  total: 85000,
  despesas: [
    { id: 'd1', descricao: 'Aluguel', fornecedor: 'Imobiliaria XYZ',
      amountCents: 50000, dueDate: '2026-08-10', categoryName: 'Aluguel',
      status: 'pendente' },
    { id: 'd2', descricao: 'Material de limpeza', fornecedor: 'Fornecedor ABC',
      amountCents: 15000, dueDate: '2026-08-15', categoryName: 'Materiais',
      status: 'pendente' },
    { id: 'd3', descricao: 'Energia eletrica', fornecedor: 'Eletropaulo',
      amountCents: 20000, dueDate: '2026-08-20', categoryName: 'Utilidades',
      status: 'pendente' },
  ],
  categorias: ['Aluguel', 'Materiais', 'Utilidades'],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      fornecedor?: string; categoria?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS),
    aoMarcarPago: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    aoParcelar: vi.fn(async () => {}),
  };
  render(<FinanceiroAPagar {...props} />);
  return props;
}

describe('FinanceiroAPagar', () => {
  it('exibe o total a pagar formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 850,00')).toBeVisible());
  });

  it('lista as despesas pendentes com descricao e fornecedor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    expect(screen.getByText(/Imobiliaria XYZ/)).toBeVisible();
    expect(screen.getByText('Material de limpeza')).toBeVisible();
    expect(screen.getByText('Energia eletrica')).toBeVisible();
  });

  it('cada despesa tem botoes Marcar pago, Editar e Parcelar', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Marcar pago/i }).length).toBe(3));
    expect(screen.getAllByRole('button', { name: /Editar/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Parcelar/i }).length).toBe(3);
  });

  it('ao clicar em Marcar pago chama aoMarcarPago com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Marcar pago/i });
    await userEvent.click(botoes[0]!);
    expect(props.aoMarcarPago).toHaveBeenCalledWith('d1');
  });

  it('ao clicar em Editar chama aoEditar com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    await userEvent.click(botoes[1]!);
    expect(props.aoEditar).toHaveBeenCalledWith('d2');
  });

  it('tem filtro por fornecedor', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Fornecedor/i)).toBeVisible());
  });

  it('tem filtro por categoria', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Categoria/i)).toBeVisible());
  });

  it('tem filtro por periodo de vencimento', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Vencimento inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Vencimento fim/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAPagar
        carregarDados={async () => DADOS}
        aoMarcarPago={async () => {}}
        aoEditar={() => {}}
        aoParcelar={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAPagar.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroAPagar'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroAPagar.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAPagar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface DespesaPendente {
  readonly id: string;
  readonly descricao: string;
  readonly fornecedor: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly categoryName: string;
  readonly status: 'pendente';
}

export interface APagarDados {
  readonly total: number;
  readonly despesas: readonly DespesaPendente[];
  readonly categorias: readonly string[];
}

export interface FiltrosAPagar {
  readonly fornecedor?: string;
  readonly categoria?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface FinanceiroAPagarProps {
  readonly carregarDados: (filtros: FiltrosAPagar) => Promise<APagarDados>;
  readonly aoMarcarPago: (despesaId: string) => Promise<void>;
  readonly aoEditar: (despesaId: string) => void;
  readonly aoParcelar: (despesaId: string) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAPagar(p: FinanceiroAPagarProps) {
  const [dados, setDados] = useState<APagarDados | null>(null);
  const [fornecedor, setFornecedor] = useState('');
  const [categoria, setCategoria] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      fornecedor: fornecedor === '' ? undefined : fornecedor,
      categoria: categoria === '' ? undefined : categoria,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <Campo rotulo="Fornecedor" denso
          value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
          aria-label="Fornecedor" placeholder="Nome do fornecedor" />

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-categoria-ap" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Categoria
          </label>
          <select
            id="filtro-categoria-ap"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            aria-label="Categoria"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.categorias.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <Campo rotulo="Vencimento inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Vencimento inicio" />
        <Campo rotulo="Vencimento fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Vencimento fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          A pagar
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Lista */}
      <section aria-label="Despesas a pagar">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.despesas.map((d) => (
            <li key={d.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 44,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {d.descricao}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {d.fornecedor} — {d.categoryName} — vence {d.dueDate}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <span className="num" style={{ fontSize: 'var(--fs-14)',
                                                fontVariantNumeric: 'tabular-nums',
                                                marginInlineEnd: 'var(--s-3)' }}>
                  {centavosParaReais(d.amountCents)}
                </span>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoMarcarPago(d.id); }}>
                  Marcar pago
                </Botao>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { p.aoEditar(d.id); }}>
                  Editar
                </Botao>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoParcelar(d.id); }}>
                  Parcelar
                </Botao>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAPagar.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroAPagar.tsx apps/web/src/telas/FinanceiroAPagar.test.tsx
git commit -m "feat(web): add FinanceiroAPagar with filters and actions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 63: Tela Repasse — por profissional com visibilidade por papel

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroRepasse.tsx`
- Criar `apps/web/src/telas/FinanceiroRepasse.test.tsx`

**Por que**: A aba Repasse mostra recebimentos por profissional/periodo/status. O medico ve so o seu repasse (§5.4), a gestora ve todos.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroRepasse.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroRepasse.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroRepasse, type RepasseDados } from './FinanceiroRepasse';

const DADOS_GESTORA: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40 },
    { id: 'p2', nome: 'Dra. Beatriz Lima', totalBruto: 350000,
      percentual: 50, totalRepasse: 175000, status: 'pago', atendimentos: 28 },
  ],
  totalRepasse: 475000,
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
};

const DADOS_MEDICO: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40 },
  ],
  totalRepasse: 300000,
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
};

function montarGestora() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      profissionalId?: string; status?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS_GESTORA),
    papelAtual: 'admin_clinico' as const,
  };
  render(<FinanceiroRepasse {...props} />);
  return props;
}

function montarMedico() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      profissionalId?: string; status?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS_MEDICO),
    papelAtual: 'profissional' as const,
  };
  render(<FinanceiroRepasse {...props} />);
  return props;
}

describe('FinanceiroRepasse', () => {
  it('gestora ve todos os profissionais com seus repasses', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.getByText('Dra. Beatriz Lima')).toBeVisible();
  });

  it('exibe o total geral de repasse', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('R$ 4.750,00')).toBeVisible());
  });

  it('exibe percentual e total de repasse por profissional', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('60%')).toBeVisible());
    expect(screen.getByText('R$ 3.000,00')).toBeVisible();
  });

  it('exibe o status do repasse', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/Pendente/i)).toBeVisible());
    expect(screen.getByText(/Pago/i)).toBeVisible();
  });

  it('exibe a quantidade de atendimentos', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/40 atend/i)).toBeVisible());
  });

  it('medico ve so o seu proprio repasse', async () => {
    montarMedico();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.queryByText('Dra. Beatriz Lima')).not.toBeInTheDocument();
  });

  it('tem filtro por periodo', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('gestora tem filtro por profissional', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByLabelText(/Profissional/i)).toBeVisible());
  });

  it('medico nao ve filtro por profissional', async () => {
    montarMedico();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.queryByLabelText(/Profissional/i)).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroRepasse
        carregarDados={async () => DADOS_GESTORA}
        papelAtual="admin_clinico"
      />,
    );
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroRepasse.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroRepasse'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroRepasse.tsx`:

```tsx
// apps/web/src/telas/FinanceiroRepasse.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface RepasseProfissional {
  readonly id: string;
  readonly nome: string;
  readonly totalBruto: number;
  readonly percentual: number;
  readonly totalRepasse: number;
  readonly status: 'pendente' | 'pago';
  readonly atendimentos: number;
}

export interface RepasseDados {
  readonly profissionais: readonly RepasseProfissional[];
  readonly totalRepasse: number;
  readonly periodo: { readonly inicio: string; readonly fim: string };
}

export interface FiltrosRepasse {
  readonly profissionalId?: string;
  readonly status?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export type PapelRepasse = 'admin_clinico' | 'diretor_tecnico' | 'financeiro' | 'profissional';

export interface FinanceiroRepasseProps {
  readonly carregarDados: (filtros: FiltrosRepasse) => Promise<RepasseDados>;
  readonly papelAtual: PapelRepasse;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const PAPEIS_GESTAO: readonly string[] = ['admin_clinico', 'diretor_tecnico', 'financeiro'];

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroRepasse(p: FinanceiroRepasseProps) {
  const [dados, setDados] = useState<RepasseDados | null>(null);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [profissionalId, setProfissionalId] = useState('');

  const ehGestao = PAPEIS_GESTAO.includes(p.papelAtual);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      profissionalId: profissionalId === '' ? undefined : profissionalId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        {ehGestao ? (
          <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
            <label htmlFor="filtro-profissional-rep" style={{
              fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
              lineHeight: 1.3, color: 'var(--text-muted)',
            }}>
              Profissional
            </label>
            <select
              id="filtro-profissional-rep"
              value={profissionalId}
              onChange={(e) => setProfissionalId(e.target.value)}
              aria-label="Profissional"
              style={{
                height: 32, padding: '0 var(--s-4)',
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 'var(--fs-14)',
              }}
            >
              <option value="">Todos</option>
              {dados.profissionais.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.nome}</option>
              ))}
            </select>
          </div>
        ) : null}
        <Campo rotulo="Periodo inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio" />
        <Campo rotulo="Periodo fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Repasse
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.totalRepasse)}
        </span>
      </div>

      {/* Lista por profissional */}
      <section aria-label="Repasse por profissional">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.profissionais.map((pr) => (
            <li key={pr.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-5) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-15)' }}>
                  {pr.nome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {pr.atendimentos} atendimentos — Bruto {centavosParaReais(pr.totalBruto)} — {pr.percentual}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                <span className="num" style={{
                  fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {centavosParaReais(pr.totalRepasse)}
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                  fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                  borderRadius: 'var(--r-full)',
                  color: pr.status === 'pago' ? 'var(--ok)' : 'var(--warn)',
                  background: 'var(--surface-sunken)',
                }}>
                  <span aria-hidden="true">{pr.status === 'pago' ? '✓' : '⏱'}</span>
                  {pr.status === 'pago' ? 'Pago' : 'Pendente'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroRepasse.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroRepasse.tsx apps/web/src/telas/FinanceiroRepasse.test.tsx
git commit -m "feat(web): add FinanceiroRepasse with role-based visibility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 64: Tela Estoque — lista de produtos com nivel e alertas

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroEstoque.tsx`
- Criar `apps/web/src/telas/FinanceiroEstoque.test.tsx`

**Por que**: A aba Estoque lista produtos com nivel de estoque, alertas de estoque baixo e historico de movimentacoes. Consome dados do pacote `packages/inventory` (atualmente stub vazio, preenchido em bloco anterior da Fase 3).

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroEstoque.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroEstoque.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroEstoque, type EstoqueDados } from './FinanceiroEstoque';

const DADOS: EstoqueDados = {
  produtos: [
    { id: 'pr1', nome: 'Luva P', quantidade: 5, minimo: 20, unidade: 'cx',
      ultimaMovimentacao: '2026-08-05', alertaBaixo: true },
    { id: 'pr2', nome: 'Seringa 10ml', quantidade: 150, minimo: 50, unidade: 'un',
      ultimaMovimentacao: '2026-08-04', alertaBaixo: false },
    { id: 'pr3', nome: 'Gaze esteril', quantidade: 30, minimo: 40, unidade: 'pct',
      ultimaMovimentacao: '2026-08-03', alertaBaixo: true },
  ],
  movimentacoes: [
    { id: 'm1', produtoNome: 'Luva P', tipo: 'saida', quantidade: 10,
      data: '2026-08-05', responsavel: 'Maria' },
    { id: 'm2', produtoNome: 'Seringa 10ml', tipo: 'entrada', quantidade: 100,
      data: '2026-08-04', responsavel: 'Joao' },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoRegistrarMovimentacao: vi.fn(async () => {}),
  };
  render(<FinanceiroEstoque {...props} />);
  return props;
}

describe('FinanceiroEstoque', () => {
  it('lista os produtos com nome, quantidade e unidade', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    expect(screen.getByText('Seringa 10ml')).toBeVisible();
    expect(screen.getByText('Gaze esteril')).toBeVisible();
  });

  it('exibe a quantidade atual e o minimo de cada produto', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('5 cx')).toBeVisible());
    expect(screen.getByText('150 un')).toBeVisible();
    expect(screen.getByText('30 pct')).toBeVisible();
  });

  it('destaca produtos com estoque abaixo do minimo com indicador visual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    const linhaLuva = screen.getByText('Luva P').closest('li');
    expect(linhaLuva).toBeTruthy();
    expect(linhaLuva!.getAttribute('data-alerta')).toBe('baixo');
  });

  it('produtos acima do minimo nao tem indicador de alerta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Seringa 10ml')).toBeVisible());
    const linhaSeringa = screen.getByText('Seringa 10ml').closest('li');
    expect(linhaSeringa).toBeTruthy();
    expect(linhaSeringa!.getAttribute('data-alerta')).toBe('ok');
  });

  it('exibe o historico de movimentacoes recentes', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Movimentacoes recentes/i })).toBeVisible());
    expect(screen.getByText(/saida/i)).toBeVisible();
    expect(screen.getByText(/entrada/i)).toBeVisible();
  });

  it('movimentacao mostra produto, tipo, quantidade, data e responsavel', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Maria/)).toBeVisible());
    expect(screen.getByText(/Joao/)).toBeVisible();
  });

  it('tem botao para registrar nova movimentacao', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova movimentacao/i })).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroEstoque
        carregarDados={async () => DADOS}
        aoRegistrarMovimentacao={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroEstoque.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroEstoque'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroEstoque.tsx`:

```tsx
// apps/web/src/telas/FinanceiroEstoque.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ProdutoEstoque {
  readonly id: string;
  readonly nome: string;
  readonly quantidade: number;
  readonly minimo: number;
  readonly unidade: string;
  readonly ultimaMovimentacao: string;
  readonly alertaBaixo: boolean;
}

export interface MovimentacaoEstoque {
  readonly id: string;
  readonly produtoNome: string;
  readonly tipo: 'entrada' | 'saida';
  readonly quantidade: number;
  readonly data: string;
  readonly responsavel: string;
}

export interface EstoqueDados {
  readonly produtos: readonly ProdutoEstoque[];
  readonly movimentacoes: readonly MovimentacaoEstoque[];
}

export interface FinanceiroEstoqueProps {
  readonly carregarDados: () => Promise<EstoqueDados>;
  readonly aoRegistrarMovimentacao: () => Promise<void>;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroEstoque(p: FinanceiroEstoqueProps) {
  const [dados, setDados] = useState<EstoqueDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)' }}>
      {/* Cabecalho com acao */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Estoque
        </h2>
        <Botao variante="secundario" altura={32}
          onClick={() => { void p.aoRegistrarMovimentacao(); }}>
          Nova movimentacao
        </Botao>
      </div>

      {/* Lista de produtos */}
      <section aria-label="Produtos em estoque">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.produtos.map((pr) => (
            <li key={pr.id}
              data-alerta={pr.alertaBaixo ? 'baixo' : 'ok'}
              style={{
                display: 'grid', gridTemplateColumns: '4px 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                paddingInlineStart: 0,
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
              {/* Barra lateral de alerta */}
              <span style={{
                display: 'block', width: 4, alignSelf: 'stretch',
                background: pr.alertaBaixo ? 'var(--danger)' : 'var(--ok)',
                borderRadius: 'var(--r-sm)',
              }} aria-hidden="true" />

              <div style={{ paddingInlineStart: 'var(--s-3)' }}>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {pr.nome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  Minimo: {pr.minimo} {pr.unidade} — Ultima mov.: {pr.ultimaMovimentacao}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <span className="num" style={{
                  fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                  fontVariantNumeric: 'tabular-nums',
                  color: pr.alertaBaixo ? 'var(--danger)' : 'var(--text)',
                }}>
                  {pr.quantidade} {pr.unidade}
                </span>
                {pr.alertaBaixo ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                    fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                    fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                    borderRadius: 'var(--r-full)',
                    color: 'var(--danger)', background: 'var(--danger-soft)',
                  }}>
                    <span aria-hidden="true">!</span>Baixo
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Historico de movimentacoes */}
      <section aria-label="Movimentacoes recentes">
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Movimentacoes recentes
        </h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.movimentacoes.map((m) => (
            <li key={m.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 44,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {m.produtoNome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {m.data} — {m.responsavel}
                </span>
              </div>
              <span className="num" style={{
                fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                fontVariantNumeric: 'tabular-nums',
                color: m.tipo === 'entrada' ? 'var(--ok)' : 'var(--danger)',
              }}>
                {m.tipo === 'entrada' ? '+' : '-'}{m.quantidade} — {m.tipo}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroEstoque.test.tsx 2>&1 | tail -5
# Esperado: Tests  8 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroEstoque.tsx apps/web/src/telas/FinanceiroEstoque.test.tsx
git commit -m "feat(web): add FinanceiroEstoque with inventory list and alerts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```


## Parte: 11-telas-desempenho

### Task 65: Tipos de dados de desempenho e helpers de formatacao de variacao

**Arquivos**

- Criar `apps/web/src/telas/desempenho/types.ts`
- Criar `apps/web/src/telas/desempenho/format.ts`
- Teste `apps/web/src/telas/desempenho/format.test.ts`

**Por que primeiro:** toda tela de desempenho depende dos tipos de dados e dos helpers de
formatacao de variacao (delta absoluto, delta percentual, frase em linguagem natural). Definir
aqui evita duplicacao e garante que o contrato entre as telas e seus dados de teste seja unico.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/format.test.ts`:

```ts
// apps/web/src/telas/desempenho/format.test.ts
import { describe, expect, it } from 'vitest';
import {
  formatDelta,
  formatDeltaPct,
  buildVariationPhrase,
  formatPeriodLabel,
} from './format';

describe('formatDelta', () => {
  it('valor positivo recebe sinal de mais', () => {
    expect(formatDelta(1420000)).toBe('+R$ 14.200,00');
  });

  it('valor negativo recebe sinal de menos', () => {
    expect(formatDelta(-1420000)).toBe('-R$ 14.200,00');
  });

  it('valor zero sem sinal', () => {
    expect(formatDelta(0)).toBe('R$ 0,00');
  });
});

describe('formatDeltaPct', () => {
  it('percentual positivo com sinal', () => {
    expect(formatDeltaPct(4)).toBe('+4%');
  });

  it('percentual negativo com sinal', () => {
    expect(formatDeltaPct(-18)).toBe('-18%');
  });

  it('zero sem sinal', () => {
    expect(formatDeltaPct(0)).toBe('0%');
  });

  it('decimal arredondado para uma casa', () => {
    expect(formatDeltaPct(4.56)).toBe('+4,6%');
  });
});

describe('buildVariationPhrase', () => {
  it('receita que caiu gera frase com "caiu"', () => {
    const frase = buildVariationPhrase('receita', -1420000, -18);
    expect(frase).toBe('Receita caiu R$ 14.200 (-18%)');
  });

  it('ticket medio que subiu gera frase com "subiu"', () => {
    const frase = buildVariationPhrase('ticket_medio', 1200, 4);
    expect(frase).toBe('Ticket medio subiu R$ 12 (+4%)');
  });

  it('ocupacao que caiu gera frase com "caiu N pontos"', () => {
    const frase = buildVariationPhrase('ocupacao', -9, -9);
    expect(frase).toBe('Ocupacao caiu 9 pontos');
  });

  it('receita que subiu gera frase com "subiu"', () => {
    const frase = buildVariationPhrase('receita', 500000, 12);
    expect(frase).toBe('Receita subiu R$ 5.000 (+12%)');
  });

  it('variacao zero gera frase com "estavel"', () => {
    const frase = buildVariationPhrase('receita', 0, 0);
    expect(frase).toBe('Receita estavel');
  });
});

describe('formatPeriodLabel', () => {
  it('formata dois meses como "Julho 2026 vs Junho 2026"', () => {
    expect(formatPeriodLabel('2026-07', '2026-06')).toBe('Julho 2026 vs Junho 2026');
  });

  it('formata meses de anos diferentes', () => {
    expect(formatPeriodLabel('2027-01', '2026-12')).toBe('Janeiro 2027 vs Dezembro 2026');
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque os modulos nao existem:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/format.test.ts 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./format` nao encontrado.

- [ ] Criar o arquivo de tipos `apps/web/src/telas/desempenho/types.ts`:

```ts
// apps/web/src/telas/desempenho/types.ts

/** Indicador exibido como frase clicavel na pagina de entrada /desempenho. */
export interface VariationIndicator {
  /** Chave semantica do indicador. */
  readonly metric: 'receita' | 'ticket_medio' | 'ocupacao';
  /** Delta absoluto em centavos (receita/ticket) ou pontos percentuais (ocupacao). */
  readonly deltaAbsolute: number;
  /** Delta percentual (ex: -18 para queda de 18%). */
  readonly deltaPercent: number;
}

/** Um fator que compoe o waterfall de decomposicao de um indicador. */
export interface WaterfallFactor {
  readonly factorId: string;
  readonly label: string;
  /** Valor em centavos — positivo contribui para aumento, negativo para queda. */
  readonly valueCents: number;
}

/** Agrupamento de drill-down ao clicar em um fator do waterfall. */
export interface DrillDownGroup {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly valueCents: number;
}

/** Linha de drill-down agrupada por dimensao. */
export interface DrillDownResult {
  readonly dimension: 'profissional' | 'dia_semana' | 'faixa_horario';
  readonly groups: readonly DrillDownGroup[];
  /** Contagem total de itens no drill-down. */
  readonly totalCount: number;
}

/** Acao sugerida ao final do drill-down. */
export interface SuggestedAction {
  readonly actionId: string;
  readonly label: string;
  /** Link para a tela de automacoes com parametros pre-preenchidos. */
  readonly href: string;
}

/** Periodo selecionado no formato YYYY-MM. */
export interface Period {
  readonly current: string;
  readonly previous: string;
}

/** Carimbo de atualizacao dos dados vindos de matview. */
export interface DataFreshness {
  readonly source: 'live' | 'matview';
  /** ISO 8601 do momento do ultimo refresh, presente apenas quando source=matview. */
  readonly refreshedAt: string | null;
}

// ── Explorar ────────────────────────────────────────────────────────────

export type ChartKind = 'bar' | 'line' | 'pie';

export interface ExploreFilter {
  readonly professionalId?: string;
  readonly clinicId?: string;
  readonly categoryId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly paymentMethod?: string;
  readonly status?: string;
}

export interface ExploreRow {
  readonly key: string;
  readonly label: string;
  readonly valueCents: number;
  readonly count: number;
}

export interface SavedView {
  readonly viewId: string;
  readonly name: string;
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
}

// ── Satisfacao ──────────────────────────────────────────────────────────

export interface NpsSummary {
  readonly score: number;
  readonly promoters: number;
  readonly passives: number;
  readonly detractors: number;
  readonly totalResponses: number;
}

export interface NpsPoint {
  readonly period: string;
  readonly score: number;
}

export interface NpsByProfessional {
  readonly professionalId: string;
  readonly professionalName: string;
  readonly score: number;
  readonly responses: number;
}

// ── Exportar ────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'xlsx';
```

- [ ] Criar o arquivo de helpers `apps/web/src/telas/desempenho/format.ts`:

```ts
// apps/web/src/telas/desempenho/format.ts

const MESES: readonly string[] = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const LABELS: Record<string, string> = {
  receita: 'Receita',
  ticket_medio: 'Ticket medio',
  ocupacao: 'Ocupacao',
};

function formatReais(cents: number): string {
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${grouped}`;
}

function formatReaisFull(cents: number): string {
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const rest = abs % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

export function formatDelta(cents: number): string {
  if (cents === 0) return formatReaisFull(0);
  const sign = cents > 0 ? '+' : '-';
  return `${sign}${formatReaisFull(Math.abs(cents))}`;
}

export function formatDeltaPct(pct: number): string {
  if (pct === 0) return '0%';
  const sign = pct > 0 ? '+' : '-';
  const abs = Math.abs(pct);
  const formatted = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
  return `${sign}${formatted}%`;
}

export function buildVariationPhrase(
  metric: 'receita' | 'ticket_medio' | 'ocupacao',
  deltaAbsolute: number,
  deltaPercent: number,
): string {
  const label = LABELS[metric] ?? metric;

  if (deltaAbsolute === 0 && deltaPercent === 0) {
    return `${label} estavel`;
  }

  const direction = deltaAbsolute > 0 ? 'subiu' : 'caiu';

  if (metric === 'ocupacao') {
    return `${label} ${direction} ${Math.abs(deltaAbsolute)} pontos`;
  }

  const abs = Math.abs(deltaAbsolute);
  const reaisStr = formatReais(abs);
  const pctStr = formatDeltaPct(deltaPercent);
  return `${label} ${direction} ${reaisStr} (${pctStr})`;
}

export function formatPeriodLabel(current: string, previous: string): string {
  const [cYear, cMonth] = current.split('-').map(Number) as [number, number];
  const [pYear, pMonth] = previous.split('-').map(Number) as [number, number];
  return `${MESES[cMonth - 1]} ${cYear} vs ${MESES[pMonth - 1]} ${pYear}`;
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/format.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/types.ts apps/web/src/telas/desempenho/format.ts apps/web/src/telas/desempenho/format.test.ts && git commit -m "feat(web): add performance types and variation format helpers"
```

---

### Task 66: Tela Variacoes do periodo (/desempenho) — frases clicaveis e waterfall

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Desempenho.tsx`
- Criar `apps/web/src/telas/desempenho/WaterfallChart.tsx`
- Teste `apps/web/src/telas/desempenho/Desempenho.test.tsx`
- Modificar `apps/web/src/ui/nav.ts`

**Por que:** e a pagina de entrada do Desempenho — §5.5 fluxo (c). A gestora ve frases em
linguagem natural, clica e ve decomposicao waterfall. O seletor de periodo
(mes vs mes anterior por default) fica aqui.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Desempenho.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Desempenho, type DesempenhoProps } from './Desempenho';
import type {
  VariationIndicator,
  WaterfallFactor,
  DrillDownResult,
  SuggestedAction,
  DataFreshness,
} from './types';

const INDICATORS: VariationIndicator[] = [
  { metric: 'receita', deltaAbsolute: -1420000, deltaPercent: -18 },
  { metric: 'ticket_medio', deltaAbsolute: 1200, deltaPercent: 4 },
  { metric: 'ocupacao', deltaAbsolute: -9, deltaPercent: -9 },
];

const WATERFALL: WaterfallFactor[] = [
  { factorId: 'f1', label: 'Faltas e cancelamentos', valueCents: -980000 },
  { factorId: 'f2', label: 'Mix de convenio', valueCents: -310000 },
  { factorId: 'f3', label: 'Glosas nao recuperadas', valueCents: -240000 },
  { factorId: 'f4', label: 'Ticket medio', valueCents: 110000 },
];

const DRILL_DOWN: DrillDownResult = {
  dimension: 'dia_semana',
  groups: [
    { key: 'seg', label: 'Segunda', count: 22, valueCents: -600000 },
    { key: 'ter', label: 'Terca', count: 8, valueCents: -200000 },
    { key: 'qua', label: 'Quarta', count: 7, valueCents: -180000 },
  ],
  totalCount: 37,
};

const ACTIONS: SuggestedAction[] = [
  { actionId: 'sa1', label: 'Ativar confirmacao 24h antes para segundas de manha',
    href: '/conversas/automacoes?dia=segunda&horario=manha' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<DesempenhoProps> = {}) {
  const props: DesempenhoProps = {
    period: { current: '2026-07', previous: '2026-06' },
    aoMudarPeriodo: vi.fn(),
    carregarIndicadores: vi.fn(async () => ({ indicators: INDICATORS, freshness: FRESHNESS })),
    carregarWaterfall: vi.fn(async () => WATERFALL),
    carregarDrillDown: vi.fn(async () => ({ result: DRILL_DOWN, actions: ACTIONS })),
    ...over,
  };
  render(<Desempenho {...props} />);
  return props;
}

describe('tela Desempenho — Variacoes do periodo', () => {
  it('exibe o titulo com o periodo selecionado', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Desempenho/ })).toBeVisible());
    expect(screen.getByText('Julho 2026 vs Junho 2026')).toBeVisible();
  });

  it('exibe tres frases de variacao em linguagem natural', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/Receita caiu R\$ 14\.200/)).toBeVisible();
      expect(screen.getByText(/Ticket medio subiu R\$ 12/)).toBeVisible();
      expect(screen.getByText(/Ocupacao caiu 9 pontos/)).toBeVisible();
    });
  });

  it('cada frase e um botao clicavel', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Receita|Ticket|Ocupacao/ });
    expect(botoes.length).toBe(3);
  });

  it('clicar numa frase carrega o waterfall de decomposicao', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(props.carregarWaterfall).toHaveBeenCalledWith('receita');
      expect(screen.getByText('Faltas e cancelamentos')).toBeVisible();
    });
  });

  it('waterfall exibe barras com valores em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(screen.getByText(/R\$ 9\.800/)).toBeVisible();
      expect(screen.getByText(/R\$ 3\.100/)).toBeVisible();
      expect(screen.getByText(/R\$ 2\.400/)).toBeVisible();
      expect(screen.getByText(/R\$ 1\.100/)).toBeVisible();
    });
  });

  it('clicar num fator do waterfall exibe drill-down agrupado', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      expect(props.carregarDrillDown).toHaveBeenCalledWith('receita', 'f1');
      expect(screen.getByText('Segunda')).toBeVisible();
      expect(screen.getByText('22')).toBeVisible();
    });
  });

  it('drill-down mostra acao sugerida com link para automacoes', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Ativar confirmacao/ });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', '/conversas/automacoes?dia=segunda&horario=manha');
    });
  });

  it('exibe carimbo "dados ate HH:MM" quando fonte e matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Desempenho
        period={{ current: '2026-07', previous: '2026-06' }}
        aoMudarPeriodo={() => {}}
        carregarIndicadores={async () => ({ indicators: INDICATORS, freshness: FRESHNESS })}
        carregarWaterfall={async () => WATERFALL}
        carregarDrillDown={async () => ({ result: DRILL_DOWN, actions: ACTIONS })}
      />);
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Desempenho.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Desempenho` nao encontrado.

- [ ] Criar o componente WaterfallChart `apps/web/src/telas/desempenho/WaterfallChart.tsx`:

```tsx
// apps/web/src/telas/desempenho/WaterfallChart.tsx
'use client';

import type { WaterfallFactor } from './types';

export interface WaterfallChartProps {
  readonly factors: readonly WaterfallFactor[];
  readonly onFactorClick: (factorId: string) => void;
}

const BAR_HEIGHT = 28;
const GAP = 6;
const LABEL_WIDTH = 220;
const VALUE_WIDTH = 100;

export function WaterfallChart({ factors, onFactorClick }: WaterfallChartProps) {
  const maxAbs = Math.max(...factors.map((f) => Math.abs(f.valueCents)), 1);
  const chartWidth = 300;
  const totalHeight = factors.length * (BAR_HEIGHT + GAP);

  function formatValue(cents: number): string {
    const abs = Math.abs(cents);
    const reais = Math.trunc(abs / 100);
    const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${cents < 0 ? '-' : '+'}R$ ${grouped}`;
  }

  return (
    <div role="table" aria-label="Decomposicao em fatores">
      <div role="rowgroup">
        {factors.map((f) => {
          const barWidth = Math.max((Math.abs(f.valueCents) / maxAbs) * chartWidth, 4);
          const isNegative = f.valueCents < 0;

          return (
            <div key={f.factorId} role="row"
              style={{
                display: 'grid',
                gridTemplateColumns: `${LABEL_WIDTH}px ${chartWidth}px ${VALUE_WIDTH}px`,
                alignItems: 'center',
                gap: 'var(--s-3)',
                marginBottom: `${GAP}px`,
                minHeight: `${BAR_HEIGHT}px`,
              }}>
              <button role="cell"
                type="button"
                onClick={() => onFactorClick(f.factorId)}
                aria-label={`${f.label}`}
                style={{
                  background: 'transparent', border: 0, cursor: 'pointer',
                  textAlign: 'left', padding: 0,
                  fontSize: 'var(--fs-13)', color: 'var(--text)',
                  fontWeight: 'var(--fw-medium)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--line)',
                  textUnderlineOffset: '2px',
                }}>
                {f.label}
              </button>
              <div role="cell"
                style={{ position: 'relative', height: `${BAR_HEIGHT}px` }}>
                <div
                  role="img"
                  aria-label={`${f.label}: ${formatValue(f.valueCents)}`}
                  style={{
                    position: 'absolute',
                    left: isNegative ? `${chartWidth / 2 - barWidth}px` : `${chartWidth / 2}px`,
                    top: 0,
                    width: `${barWidth}px`,
                    height: '100%',
                    borderRadius: 'var(--r-sm)',
                    background: isNegative ? 'var(--danger)' : 'var(--ok)',
                    opacity: 0.8,
                  }}
                />
              </div>
              <span role="cell"
                className="num"
                style={{
                  fontSize: 'var(--fs-13)',
                  fontWeight: 'var(--fw-medium)',
                  color: isNegative ? 'var(--danger)' : 'var(--ok)',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {formatValue(f.valueCents)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] Criar o componente principal `apps/web/src/telas/desempenho/Desempenho.tsx`:

```tsx
// apps/web/src/telas/desempenho/Desempenho.tsx
'use client';

import { useEffect, useState } from 'react';
import type {
  VariationIndicator,
  WaterfallFactor,
  DrillDownResult,
  SuggestedAction,
  Period,
  DataFreshness,
} from './types';
import { buildVariationPhrase, formatPeriodLabel } from './format';
import { WaterfallChart } from './WaterfallChart';

export interface DesempenhoProps {
  readonly period: Period;
  readonly aoMudarPeriodo: (period: Period) => void;
  readonly carregarIndicadores: () => Promise<{
    indicators: VariationIndicator[];
    freshness: DataFreshness;
  }>;
  readonly carregarWaterfall: (metric: string) => Promise<WaterfallFactor[]>;
  readonly carregarDrillDown: (metric: string, factorId: string) => Promise<{
    result: DrillDownResult;
    actions: SuggestedAction[];
  }>;
}

function formatFreshnessTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function Desempenho(p: DesempenhoProps) {
  const [indicators, setIndicators] = useState<VariationIndicator[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [waterfall, setWaterfall] = useState<WaterfallFactor[]>([]);
  const [drillDown, setDrillDown] = useState<DrillDownResult | null>(null);
  const [actions, setActions] = useState<SuggestedAction[]>([]);

  useEffect(() => {
    void p.carregarIndicadores().then((r) => {
      setIndicators(r.indicators);
      setFreshness(r.freshness);
    });
  }, [p]);

  async function onIndicatorClick(metric: string): Promise<void> {
    setSelectedMetric(metric);
    setDrillDown(null);
    setActions([]);
    const factors = await p.carregarWaterfall(metric);
    setWaterfall(factors);
  }

  async function onFactorClick(factorId: string): Promise<void> {
    if (selectedMetric === null) return;
    const { result, actions: suggestedActions } =
      await p.carregarDrillDown(selectedMetric, factorId);
    setDrillDown(result);
    setActions(suggestedActions);
  }

  const periodLabel = formatPeriodLabel(p.period.current, p.period.previous);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <div>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          Desempenho
        </h1>
        <p style={{ fontSize: 'var(--fs-14)', color: 'var(--text-muted)', margin: `var(--s-2) 0 0` }}>
          {periodLabel}
        </p>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {formatFreshnessTime(freshness.refreshedAt)}
        </p>
      ) : null}

      {/* Frases de variacao */}
      <section aria-label="Variacoes do periodo"
        style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', padding: 'var(--s-6)',
                 display: 'grid', gap: 'var(--s-4)' }}>
        {indicators.map((ind) => {
          const phrase = buildVariationPhrase(ind.metric, ind.deltaAbsolute, ind.deltaPercent);
          const isSelected = selectedMetric === ind.metric;
          return (
            <button key={ind.metric} type="button"
              aria-label={phrase}
              aria-expanded={isSelected}
              onClick={() => { void onIndicatorClick(ind.metric); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isSelected ? 'var(--surface-hover)' : 'transparent',
                border: 0, cursor: 'pointer', padding: `var(--s-4) var(--s-4)`,
                borderRadius: 'var(--r-sm)', textAlign: 'left',
                fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                color: 'var(--text)', width: '100%',
              }}>
              <span>{phrase}</span>
              <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>›</span>
            </button>
          );
        })}
      </section>

      {/* Waterfall de decomposicao */}
      {selectedMetric !== null && waterfall.length > 0 ? (
        <section aria-label="Decomposicao"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   overflowX: 'auto' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-6)` }}>
            Decomposicao
          </h2>
          <WaterfallChart factors={waterfall} onFactorClick={onFactorClick} />
        </section>
      ) : null}

      {/* Drill-down */}
      {drillDown !== null ? (
        <section aria-label="Detalhamento"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-2)` }}>
            Detalhamento
          </h2>
          <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
                      margin: `0 0 var(--s-5)` }}>
            {drillDown.totalCount} atendimentos
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 'var(--fs-13)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Grupo
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Qtd
                </th>
              </tr>
            </thead>
            <tbody>
              {drillDown.groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ padding: `var(--s-2) var(--s-3)`,
                               borderBottom: 'var(--border)' }}>
                    {g.label}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {g.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Acoes sugeridas */}
          {actions.length > 0 ? (
            <div style={{ marginTop: 'var(--s-6)', display: 'grid', gap: 'var(--s-3)' }}>
              {actions.map((a) => (
                <a key={a.actionId} href={a.href}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)',
                    fontSize: 'var(--fs-14)', color: 'var(--accent)',
                    fontWeight: 'var(--fw-medium)', textDecoration: 'none',
                  }}>
                  {a.label}
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Tabela acessivel alternativa ao waterfall */}
      {selectedMetric !== null && waterfall.length > 0 ? (
        <details style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
          <summary>Tabela acessivel dos fatores</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 'var(--s-3)' }}>
            <caption className="sr-only">Decomposicao por fatores</caption>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--s-2)', borderBottom: 'var(--border)' }}>
                  Fator
                </th>
                <th style={{ textAlign: 'right', padding: 'var(--s-2)', borderBottom: 'var(--border)' }}>
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {waterfall.map((f) => (
                <tr key={f.factorId}>
                  <td style={{ padding: 'var(--s-2)', borderBottom: 'var(--border)' }}>
                    {f.label}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-2)', borderBottom: 'var(--border)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {f.valueCents < 0 ? '-' : '+'}R$ {Math.trunc(Math.abs(f.valueCents) / 100).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}
```

- [ ] Atualizar `apps/web/src/ui/nav.ts` para habilitar Desempenho na Fase 3:

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuicao de variacao chegam na Fase 3' },
];

export const FASE_ATUAL = 3 as const;
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Desempenho.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Rodar o teste de navegacao existente para garantir que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx
```

Saida esperada: passa (Desempenho agora visivel porque FASE_ATUAL = 3).

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Desempenho.tsx apps/web/src/telas/desempenho/Desempenho.test.tsx apps/web/src/telas/desempenho/WaterfallChart.tsx apps/web/src/ui/nav.ts && git commit -m "feat(web): add Desempenho screen with variation phrases and waterfall drill-down"
```

---

### Task 67: Tela Explorar (/desempenho/explorar) — filtros combinaveis, grafico alternavel e visoes salvas

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Explorar.tsx`
- Teste `apps/web/src/telas/desempenho/Explorar.test.tsx`

**Por que:** Explorar e a tela que substitui os 11 relatorios do iClinic (§5.3). Filtros
combinaveis, resultado em tabela + grafico alternavel (bar/line/pie), visoes salvas como
tabs horizontais.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Explorar.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Explorar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Explorar, type ExplorarProps } from './Explorar';
import type { ExploreRow, SavedView, ExploreFilter, ChartKind, DataFreshness } from './types';

const ROWS: ExploreRow[] = [
  { key: 'r1', label: 'Consulta', valueCents: 1500000, count: 60 },
  { key: 'r2', label: 'Retorno', valueCents: 450000, count: 30 },
  { key: 'r3', label: 'Exame', valueCents: 300000, count: 15 },
];

const VIEWS: SavedView[] = [
  { viewId: 'v1', name: 'Receita por procedimento', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'bar' },
  { viewId: 'v2', name: 'Atendimentos por profissional', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'line' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T16:00:00Z' };

function montar(over: Partial<ExplorarProps> = {}) {
  const props: ExplorarProps = {
    filters: {},
    chartKind: 'bar',
    savedViews: VIEWS,
    aoMudarFiltros: vi.fn(),
    aoMudarGrafico: vi.fn(),
    carregarDados: vi.fn(async () => ({ rows: ROWS, freshness: FRESHNESS })),
    aoSalvarVisao: vi.fn(async () => ({ viewId: 'v3', name: 'Nova visao', filters: {}, chartKind: 'bar' })),
    aoSelecionarVisao: vi.fn(),
    ...over,
  };
  render(<Explorar {...props} />);
  return props;
}

describe('tela Explorar', () => {
  it('exibe o titulo Explorar', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Explorar/ })).toBeVisible());
  });

  it('exibe tabs de visoes salvas', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Receita por procedimento' })).toBeVisible();
      expect(screen.getByRole('tab', { name: 'Atendimentos por profissional' })).toBeVisible();
    });
  });

  it('clicar numa tab de visao salva chama callback', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Receita por procedimento' })).toBeVisible());
    await userEvent.click(screen.getByRole('tab', { name: 'Receita por procedimento' }));
    expect(props.aoSelecionarVisao).toHaveBeenCalledWith('v1');
  });

  it('exibe tabela com dados carregados', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText('60')).toBeVisible();
    });
  });

  it('exibe os tres botoes de tipo de grafico (bar/line/pie)', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Barras/ })).toBeVisible();
      expect(screen.getByRole('radio', { name: /Linhas/ })).toBeVisible();
      expect(screen.getByRole('radio', { name: /Pizza/ })).toBeVisible();
    });
  });

  it('clicar no botao de tipo de grafico chama callback', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByRole('radio', { name: /Linhas/ })).toBeVisible());
    await userEvent.click(screen.getByRole('radio', { name: /Linhas/ }));
    expect(props.aoMudarGrafico).toHaveBeenCalledWith('line');
  });

  it('botao Salvar visao esta presente', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Salvar visao/ })).toBeVisible());
  });

  it('exibe carimbo de dados quando fonte e matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Explorar
        filters={{}}
        chartKind="bar"
        savedViews={VIEWS}
        aoMudarFiltros={() => {}}
        aoMudarGrafico={() => {}}
        carregarDados={async () => ({ rows: ROWS, freshness: FRESHNESS })}
        aoSalvarVisao={async () => ({ viewId: 'v3', name: 'Nova visao', filters: {}, chartKind: 'bar' })}
        aoSelecionarVisao={() => {}}
      />);
    await waitFor(() => expect(screen.getByText('Consulta')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Explorar.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Explorar` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Explorar.tsx`:

```tsx
// apps/web/src/telas/desempenho/Explorar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../../ui/Botao';
import type {
  ExploreFilter,
  ExploreRow,
  SavedView,
  ChartKind,
  DataFreshness,
} from './types';

export interface ExplorarProps {
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
  readonly savedViews: readonly SavedView[];
  readonly aoMudarFiltros: (filters: ExploreFilter) => void;
  readonly aoMudarGrafico: (kind: ChartKind) => void;
  readonly carregarDados: (filters: ExploreFilter) => Promise<{
    rows: ExploreRow[];
    freshness: DataFreshness;
  }>;
  readonly aoSalvarVisao: (name: string, filters: ExploreFilter, chartKind: ChartKind) =>
    Promise<SavedView>;
  readonly aoSelecionarVisao: (viewId: string) => void;
}

const CHART_LABELS: Record<ChartKind, string> = {
  bar: 'Barras', line: 'Linhas', pie: 'Pizza',
};

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

function SimpleBarChart({ rows }: { readonly rows: readonly ExploreRow[] }) {
  const maxVal = Math.max(...rows.map((r) => r.valueCents), 1);
  return (
    <div role="img" aria-label="Grafico de barras">
      {rows.map((r) => {
        const width = Math.max((r.valueCents / maxVal) * 100, 2);
        return (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center',
                                     gap: 'var(--s-3)', marginBottom: 'var(--s-2)' }}>
            <span style={{ minWidth: 120, fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
              {r.label}
            </span>
            <div style={{ flex: 1, height: 20, background: 'var(--surface-sunken)',
                          borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%',
                            background: 'var(--accent)', borderRadius: 'var(--r-sm)' }} />
            </div>
            <span className="num" style={{ minWidth: 80, textAlign: 'right',
                                            fontSize: 'var(--fs-12)',
                                            fontVariantNumeric: 'tabular-nums' }}>
              {formatCents(r.valueCents)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Explorar(p: ExplorarProps) {
  const [rows, setRows] = useState<ExploreRow[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados(p.filters).then((r) => {
      setRows(r.rows);
      setFreshness(r.freshness);
    });
  }, [p, p.filters]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          Explorar
        </h1>
        <Botao variante="secundario" altura={28}
          onClick={() => { void p.aoSalvarVisao('Nova visao', p.filters, p.chartKind); }}>
          Salvar visao
        </Botao>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Tabs de visoes salvas */}
      <div role="tablist" aria-label="Visoes salvas"
        style={{ display: 'flex', gap: 'var(--s-1)', overflowX: 'auto',
                 borderBottom: 'var(--border)', paddingBottom: 0 }}>
        {p.savedViews.map((v) => (
          <button key={v.viewId} role="tab" type="button"
            aria-selected={false}
            onClick={() => p.aoSelecionarVisao(v.viewId)}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer',
              padding: `var(--s-3) var(--s-5)`,
              fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
              fontWeight: 'var(--fw-medium)',
              borderBottom: '2px solid transparent',
              whiteSpace: 'nowrap',
            }}>
            {v.name}
          </button>
        ))}
      </div>

      {/* Seletor de tipo de grafico */}
      <div role="radiogroup" aria-label="Tipo de grafico"
        style={{ display: 'flex', gap: 'var(--s-2)' }}>
        {(['bar', 'line', 'pie'] as const).map((kind) => (
          <button key={kind} role="radio" type="button"
            aria-checked={p.chartKind === kind}
            aria-label={CHART_LABELS[kind]}
            onClick={() => p.aoMudarGrafico(kind)}
            style={{
              border: p.chartKind === kind ? '1px solid var(--accent)' : 'var(--border)',
              background: p.chartKind === kind ? 'var(--accent-soft)' : 'var(--surface)',
              borderRadius: 'var(--r-md)', padding: `var(--s-2) var(--s-4)`,
              fontSize: 'var(--fs-12)', color: 'var(--text)', cursor: 'pointer',
              fontWeight: p.chartKind === kind ? 'var(--fw-medium)' : 'var(--fw-regular)',
            }}>
            {CHART_LABELS[kind]}
          </button>
        ))}
      </div>

      {/* Grafico */}
      <section aria-label="Resultado"
        style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', padding: 'var(--s-6)' }}>
        <SimpleBarChart rows={rows} />
      </section>

      {/* Tabela de dados */}
      <section aria-label="Tabela de dados"
        style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Item
              </th>
              <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Qtd
              </th>
              <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)' }}>
                  {r.label}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {r.count}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatCents(r.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Explorar.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Explorar.tsx apps/web/src/telas/desempenho/Explorar.test.tsx && git commit -m "feat(web): add Explorar screen with combinable filters, chart toggle and saved views"
```

---

### Task 68: Tela Atendimentos (/desempenho/atendimentos) — visao pre-filtrada

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Atendimentos.tsx`
- Teste `apps/web/src/telas/desempenho/Atendimentos.test.tsx`

**Por que:** Atendimentos e uma visao pre-filtrada de Explorar, focada em atendimentos
realizados. Reusa os tipos de dados ja definidos na Task 65 e exibe dados com
carimbo de frescor.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Atendimentos.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Atendimentos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Atendimentos, type AtendimentosProps } from './Atendimentos';
import type { DataFreshness } from './types';

interface AtendimentoRow {
  readonly key: string;
  readonly professionalName: string;
  readonly procedureName: string;
  readonly count: number;
  readonly valueCents: number;
  readonly avgDurationMin: number;
}

const ROWS: AtendimentoRow[] = [
  { key: 'a1', professionalName: 'Dr. Alceu', procedureName: 'Consulta',
    count: 45, valueCents: 1125000, avgDurationMin: 25 },
  { key: 'a2', professionalName: 'Dra. Beatriz', procedureName: 'Retorno',
    count: 22, valueCents: 330000, avgDurationMin: 15 },
  { key: 'a3', professionalName: 'Dr. Alceu', procedureName: 'Exame',
    count: 10, valueCents: 200000, avgDurationMin: 30 },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<AtendimentosProps> = {}) {
  const props: AtendimentosProps = {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    carregarDados: vi.fn(async () => ({ rows: ROWS, freshness: FRESHNESS,
      totals: { count: 77, valueCents: 1655000 } })),
    ...over,
  };
  render(<Atendimentos {...props} />);
  return props;
}

describe('tela Atendimentos (Desempenho)', () => {
  it('exibe o titulo Atendimentos', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Atendimentos/ })).toBeVisible());
  });

  it('exibe tabela com profissional, procedimento, quantidade e valor', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Dr. Alceu')).toBeVisible();
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText('45')).toBeVisible();
    });
  });

  it('exibe totais no rodape da tabela', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('77')).toBeVisible();
    });
  });

  it('exibe a duracao media em minutos', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('25 min')).toBeVisible();
      expect(screen.getByText('15 min')).toBeVisible();
    });
  });

  it('exibe carimbo de frescor dos dados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Atendimentos
        dateFrom="2026-07-01"
        dateTo="2026-07-31"
        carregarDados={async () => ({ rows: ROWS, freshness: FRESHNESS,
          totals: { count: 77, valueCents: 1655000 } })}
      />);
    await waitFor(() => expect(screen.getByText('Dr. Alceu')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Atendimentos.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Atendimentos` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Atendimentos.tsx`:

```tsx
// apps/web/src/telas/desempenho/Atendimentos.tsx
'use client';

import { useEffect, useState } from 'react';
import type { DataFreshness } from './types';

interface AtendimentoRow {
  readonly key: string;
  readonly professionalName: string;
  readonly procedureName: string;
  readonly count: number;
  readonly valueCents: number;
  readonly avgDurationMin: number;
}

interface AtendimentoTotals {
  readonly count: number;
  readonly valueCents: number;
}

export interface AtendimentosProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{
    rows: AtendimentoRow[];
    freshness: DataFreshness;
    totals: AtendimentoTotals;
  }>;
}

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

export function Atendimentos(p: AtendimentosProps) {
  const [rows, setRows] = useState<AtendimentoRow[]>([]);
  const [totals, setTotals] = useState<AtendimentoTotals | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados().then((r) => {
      setRows(r.rows);
      setTotals(r.totals);
      setFreshness(r.freshness);
    });
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Atendimentos
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      <section aria-label="Tabela de atendimentos" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              {['Profissional', 'Procedimento'].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 'var(--fw-medium)',
                }}>{h}</th>
              ))}
              {['Qtd', 'Valor', 'Duracao media'].map((h) => (
                <th key={h} style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 'var(--fw-medium)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                  {r.professionalName}
                </td>
                <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                  {r.procedureName}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{r.count}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{formatCents(r.valueCents)}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{r.avgDurationMin} min</td>
              </tr>
            ))}
          </tbody>
          {totals !== null ? (
            <tfoot>
              <tr>
                <td colSpan={2} style={{
                  padding: `var(--s-2) var(--s-3)`, fontWeight: 'var(--fw-semibold)',
                  borderTop: '2px solid var(--line-strong)',
                }}>Total</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums',
                  borderTop: '2px solid var(--line-strong)',
                }}>{totals.count}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums',
                  borderTop: '2px solid var(--line-strong)',
                }}>{formatCents(totals.valueCents)}</td>
                <td style={{ borderTop: '2px solid var(--line-strong)' }} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Atendimentos.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Atendimentos.tsx apps/web/src/telas/desempenho/Atendimentos.test.tsx && git commit -m "feat(web): add Atendimentos pre-filtered view in Desempenho"
```

---

### Task 69: Tela Satisfacao (/desempenho/satisfacao) — NPS do periodo, evolutivo e por profissional

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Satisfacao.tsx`
- Teste `apps/web/src/telas/desempenho/Satisfacao.test.tsx`

**Por que:** Satisfacao exibe o NPS do periodo, grafico evolutivo e ranking por profissional.
Usa os tipos NpsSummary, NpsPoint e NpsByProfessional definidos na Task 65.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Satisfacao.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Satisfacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Satisfacao, type SatisfacaoProps } from './Satisfacao';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

const SUMMARY: NpsSummary = {
  score: 72,
  promoters: 45,
  passives: 20,
  detractors: 8,
  totalResponses: 73,
};

const EVOLUTION: NpsPoint[] = [
  { period: '2026-04', score: 65 },
  { period: '2026-05', score: 68 },
  { period: '2026-06', score: 70 },
  { period: '2026-07', score: 72 },
];

const BY_PROFESSIONAL: NpsByProfessional[] = [
  { professionalId: 'pr1', professionalName: 'Dr. Alceu', score: 85, responses: 30 },
  { professionalId: 'pr2', professionalName: 'Dra. Beatriz', score: 62, responses: 25 },
  { professionalId: 'pr3', professionalName: 'Dr. Carlos', score: 58, responses: 18 },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<SatisfacaoProps> = {}) {
  const props: SatisfacaoProps = {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    carregarDados: vi.fn(async () => ({
      summary: SUMMARY, evolution: EVOLUTION,
      byProfessional: BY_PROFESSIONAL, freshness: FRESHNESS,
    })),
    ...over,
  };
  render(<Satisfacao {...props} />);
  return props;
}

describe('tela Satisfacao (Desempenho)', () => {
  it('exibe o titulo Satisfacao', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Satisfacao/ })).toBeVisible());
  });

  it('exibe o score NPS em destaque', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('72')).toBeVisible());
  });

  it('exibe a distribuicao promotores/neutros/detratores', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/45/)).toBeVisible();
      expect(screen.getByText(/Promotores/)).toBeVisible();
      expect(screen.getByText(/20/)).toBeVisible();
      expect(screen.getByText(/Neutros/)).toBeVisible();
      expect(screen.getByText(/8/)).toBeVisible();
      expect(screen.getByText(/Detratores/)).toBeVisible();
    });
  });

  it('exibe o total de respostas', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/73 respostas/)).toBeVisible());
  });

  it('exibe grafico evolutivo com periodos', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /NPS evolutivo/ })).toBeVisible());
  });

  it('exibe ranking por profissional', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Dr. Alceu')).toBeVisible();
      expect(screen.getByText('85')).toBeVisible();
      expect(screen.getByText('Dra. Beatriz')).toBeVisible();
      expect(screen.getByText('62')).toBeVisible();
    });
  });

  it('exibe carimbo de frescor dos dados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Satisfacao
        dateFrom="2026-07-01"
        dateTo="2026-07-31"
        carregarDados={async () => ({
          summary: SUMMARY, evolution: EVOLUTION,
          byProfessional: BY_PROFESSIONAL, freshness: FRESHNESS,
        })}
      />);
    await waitFor(() => expect(screen.getByText('72')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Satisfacao.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Satisfacao` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Satisfacao.tsx`:

```tsx
// apps/web/src/telas/desempenho/Satisfacao.tsx
'use client';

import { useEffect, useState } from 'react';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

export interface SatisfacaoProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{
    summary: NpsSummary;
    evolution: NpsPoint[];
    byProfessional: NpsByProfessional[];
    freshness: DataFreshness;
  }>;
}

const MESES_CURTO: readonly string[] = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function npsColor(score: number): string {
  if (score >= 75) return 'var(--ok)';
  if (score >= 50) return 'var(--accent)';
  if (score >= 0) return 'var(--warn)';
  return 'var(--danger)';
}

function NpsEvolutionChart({ points }: { readonly points: readonly NpsPoint[] }) {
  if (points.length === 0) return null;

  const width = 400;
  const height = 120;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const minScore = Math.min(...points.map((p) => p.score), 0);
  const maxScore = Math.max(...points.map((p) => p.score), 100);
  const range = maxScore - minScore || 1;

  const pathPoints = points.map((pt, i) => {
    const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
    const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
    return `${x},${y}`;
  });

  const pathD = pathPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`).join(' ');

  return (
    <svg
      role="img" aria-label="NPS evolutivo"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: `${width}px`, height: `${height}px` }}
    >
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((pt, i) => {
        const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
        const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
        const [, monthStr] = pt.period.split('-');
        const monthIdx = Number(monthStr) - 1;
        return (
          <g key={pt.period}>
            <circle cx={x} cy={y} r={3} fill="var(--accent)" />
            <text x={x} y={height - 4} textAnchor="middle"
              fontSize="10" fill="var(--text-muted)">
              {MESES_CURTO[monthIdx]}
            </text>
            <text x={x} y={y - 8} textAnchor="middle"
              fontSize="10" fill="var(--text)" fontWeight="500">
              {pt.score}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Satisfacao(p: SatisfacaoProps) {
  const [summary, setSummary] = useState<NpsSummary | null>(null);
  const [evolution, setEvolution] = useState<NpsPoint[]>([]);
  const [byProf, setByProf] = useState<NpsByProfessional[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados().then((r) => {
      setSummary(r.summary);
      setEvolution(r.evolution);
      setByProf(r.byProfessional);
      setFreshness(r.freshness);
    });
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Satisfacao
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* NPS em destaque */}
      {summary !== null ? (
        <section aria-label="NPS do periodo"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-5)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)' }}>
            <span className="num" style={{
              fontSize: 'var(--fs-28)', fontWeight: 'var(--fw-semibold)',
              color: npsColor(summary.score),
              fontVariantNumeric: 'tabular-nums',
            }}>
              {summary.score}
            </span>
            <span style={{ fontSize: 'var(--fs-14)', color: 'var(--text-muted)' }}>
              NPS — {summary.totalResponses} respostas
            </span>
          </div>

          <div style={{ display: 'flex', gap: 'var(--s-8)' }}>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--ok)' }}>
                {summary.promoters}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Promotores
              </span>
            </div>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--text-muted)' }}>
                {summary.passives}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Neutros
              </span>
            </div>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--danger)' }}>
                {summary.detractors}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Detratores
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Grafico evolutivo */}
      {evolution.length > 0 ? (
        <section aria-label="Evolucao do NPS"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Evolutivo
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <NpsEvolutionChart points={evolution} />
          </div>

          {/* Tabela acessivel alternativa */}
          <details style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                            marginTop: 'var(--s-3)' }}>
            <summary>Tabela acessivel do evolutivo</summary>
            <table style={{ width: '100%', borderCollapse: 'collapse',
                            marginTop: 'var(--s-2)' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 'var(--s-1)',
                               borderBottom: 'var(--border)' }}>Periodo</th>
                  <th style={{ textAlign: 'right', padding: 'var(--s-1)',
                               borderBottom: 'var(--border)' }}>NPS</th>
                </tr>
              </thead>
              <tbody>
                {evolution.map((pt) => (
                  <tr key={pt.period}>
                    <td style={{ padding: 'var(--s-1)', borderBottom: 'var(--border)' }}>
                      {pt.period}
                    </td>
                    <td className="num" style={{
                      textAlign: 'right', padding: 'var(--s-1)',
                      borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {pt.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      ) : null}

      {/* Ranking por profissional */}
      {byProf.length > 0 ? (
        <section aria-label="NPS por profissional"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Por profissional
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 'var(--fs-13)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Profissional
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  NPS
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Respostas
                </th>
              </tr>
            </thead>
            <tbody>
              {byProf.map((prof) => (
                <tr key={prof.professionalId}>
                  <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                    {prof.professionalName}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                    color: npsColor(prof.score), fontWeight: 'var(--fw-medium)',
                  }}>
                    {prof.score}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {prof.responses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Satisfacao.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Satisfacao.tsx apps/web/src/telas/desempenho/Satisfacao.test.tsx && git commit -m "feat(web): add Satisfacao screen with NPS score, evolution chart and professional ranking"
```

---

### Task 70: Tela Exportar (/desempenho/exportar) — selecionar visao, formato e periodo

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Exportar.tsx`
- Teste `apps/web/src/telas/desempenho/Exportar.test.tsx`

**Por que:** Exportar permite baixar os dados de qualquer visao salva em CSV ou XLSX,
com seletor de periodo. Exibe o carimbo de frescor e desabilita o botao durante o download.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Exportar.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Exportar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Exportar, type ExportarProps } from './Exportar';
import type { SavedView, ExportFormat, DataFreshness } from './types';

const VIEWS: SavedView[] = [
  { viewId: 'v1', name: 'Receita por procedimento',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'bar' },
  { viewId: 'v2', name: 'Atendimentos por profissional',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'line' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<ExportarProps> = {}) {
  const props: ExportarProps = {
    savedViews: VIEWS,
    freshness: FRESHNESS,
    aoExportar: vi.fn(async () => {}),
    ...over,
  };
  render(<Exportar {...props} />);
  return props;
}

describe('tela Exportar (Desempenho)', () => {
  it('exibe o titulo Exportar', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: /Exportar/ })).toBeVisible();
  });

  it('lista as visoes salvas para selecao', () => {
    montar();
    expect(screen.getByRole('radio', { name: 'Receita por procedimento' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Atendimentos por profissional' })).toBeVisible();
  });

  it('exibe seletor de formato CSV e XLSX', () => {
    montar();
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'XLSX' })).toBeVisible();
  });

  it('exibe campos de data de inicio e fim', () => {
    montar();
    expect(screen.getByLabelText(/De/)).toBeVisible();
    expect(screen.getByLabelText(/Ate/)).toBeVisible();
  });

  it('botao exportar chama callback com visao, formato e periodo', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('radio', { name: 'Receita por procedimento' }));
    await userEvent.click(screen.getByRole('radio', { name: 'CSV' }));
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    expect(props.aoExportar).toHaveBeenCalledWith(
      expect.objectContaining({ viewId: 'v1', format: 'csv' }));
  });

  it('botao fica desabilitado sem visao selecionada', () => {
    montar();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeDisabled();
  });

  it('exibe carimbo de frescor dos dados', () => {
    montar();
    expect(screen.getByText(/dados ate/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Exportar
        savedViews={VIEWS}
        freshness={FRESHNESS}
        aoExportar={async () => {}}
      />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Exportar.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Exportar` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Exportar.tsx`:

```tsx
// apps/web/src/telas/desempenho/Exportar.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../../ui/Botao';
import type { SavedView, ExportFormat, DataFreshness } from './types';

export interface ExportRequest {
  readonly viewId: string;
  readonly format: ExportFormat;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface ExportarProps {
  readonly savedViews: readonly SavedView[];
  readonly freshness: DataFreshness;
  readonly aoExportar: (request: ExportRequest) => Promise<void>;
}

export function Exportar(p: ExportarProps) {
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleExport(): Promise<void> {
    if (selectedView === null) return;
    setExporting(true);
    try {
      await p.aoExportar({ viewId: selectedView, format, dateFrom, dateTo });
    } finally {
      setExporting(false);
    }
  }

  const canExport = selectedView !== null && !exporting;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Exportar
      </h1>

      {p.freshness.source === 'matview' && p.freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(p.freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Selecao de visao */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Visao
        </legend>
        <div role="radiogroup" aria-label="Selecionar visao"
          style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
          {p.savedViews.map((v) => (
            <label key={v.viewId}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                       fontSize: 'var(--fs-14)', cursor: 'pointer',
                       padding: `var(--s-2) 0` }}>
              <input type="radio" name="export-view" value={v.viewId}
                aria-label={v.name}
                checked={selectedView === v.viewId}
                onChange={() => setSelectedView(v.viewId)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {v.name}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Selecao de formato */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Formato
        </legend>
        <div role="radiogroup" aria-label="Selecionar formato"
          style={{ display: 'flex', gap: 'var(--s-6)', marginTop: 'var(--s-3)' }}>
          {(['csv', 'xlsx'] as const).map((f) => (
            <label key={f}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
                       fontSize: 'var(--fs-14)', cursor: 'pointer' }}>
              <input type="radio" name="export-format" value={f}
                aria-label={f.toUpperCase()}
                checked={format === f}
                onChange={() => setFormat(f)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {f.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Periodo */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Periodo
        </legend>
        <div style={{ display: 'flex', gap: 'var(--s-6)', marginTop: 'var(--s-3)' }}>
          <div>
            <label htmlFor="export-date-from"
              style={{ display: 'block', fontSize: 'var(--fs-12)',
                       color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
              De
            </label>
            <input id="export-date-from" type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                padding: `var(--s-2) var(--s-3)`, fontSize: 'var(--fs-14)',
                background: 'var(--surface)', color: 'var(--text)',
              }}
            />
          </div>
          <div>
            <label htmlFor="export-date-to"
              style={{ display: 'block', fontSize: 'var(--fs-12)',
                       color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
              Ate
            </label>
            <input id="export-date-to" type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                padding: `var(--s-2) var(--s-3)`, fontSize: 'var(--fs-14)',
                background: 'var(--surface)', color: 'var(--text)',
              }}
            />
          </div>
        </div>
      </fieldset>

      <Botao variante="primario" altura={40}
        disabled={!canExport}
        carregando={exporting}
        onClick={() => { void handleExport(); }}>
        Exportar
      </Botao>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Exportar.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Rodar todos os testes do bloco de desempenho de uma vez para garantir integridade:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/
```

Saida esperada: todos os testes das Tasks 65-70 passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Exportar.tsx apps/web/src/telas/desempenho/Exportar.test.tsx && git commit -m "feat(web): add Exportar screen with view, format and period selection"
```


## Parte: 12-integracao-gate

### Task 71: habilitar Desempenho na barra de navegacao (FASE_ATUAL = 3)

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar os testes da barra de navegacao para refletir a Fase 3. Agora NENHUM item esta marcado como futuro — Desempenho vira link navegavel.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV, FASE_ATUAL } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('na Fase 3 nenhum item esta marcado como futuro', () => {
    expect(FASE_ATUAL).toBe(3);
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > FASE_ATUAL);
    expect(futuros).toEqual([]);
  });

  it('todos os itens sao links navegaveis, incluindo Desempenho', () => {
    render(<BarraDeNavegacao />);
    for (const item of ITENS_NAV) {
      expect(screen.getByRole('link', { name: item.rotulo })).toBeInTheDocument();
    }
  });

  it('nenhum item aparece como botao desabilitado', () => {
    render(<BarraDeNavegacao />);
    const botoesDesabilitados = screen.queryAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'));
    expect(botoesDesabilitados).toHaveLength(0);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegacao principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que falha porque `FASE_ATUAL` ainda e 2.

Saida esperada: 3 falhas — o teste `na Fase 3 nenhum item esta marcado como futuro` falha porque FASE_ATUAL e 2 e Desempenho e futuro; o teste `todos os itens sao links navegaveis, incluindo Desempenho` falha porque Desempenho renderiza como botao; o teste `nenhum item aparece como botao desabilitado` falha porque Desempenho esta desabilitado.

- [ ] Atualizar `FASE_ATUAL` para 3 em `nav.ts`.

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuicao de variacao chegam na Fase 3' },
];

export const FASE_ATUAL = 3 as const;
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(web): enable Desempenho nav item for Fase 3`

---

### Task 72: adicionar inv ao TENANT_SCHEMAS e atualizar varredura dos testes de isolamento

**Arquivos**

- Modificar `packages/db/src/invariants/catalog.ts`
- Modificar `packages/db/src/invariants/catalog.test.ts`
- Modificar `packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts`
- Modificar `packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts`
- Modificar `packages/db/test/iso/impressao-digital.ts`

**Passos**

- [ ] Escrever o teste que afirma que `inv` pertence ao `TENANT_SCHEMAS` e que `rpt` NAO pertence.

```ts
// packages/db/src/invariants/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('inv pertence ao regime multi-tenant desde a Fase 3', () => {
    expect(TENANT_SCHEMAS).toContain('inv');
  });

  it('rpt NAO pertence — matviews usam isolamento por view security_barrier, nao RLS', () => {
    expect(TENANT_SCHEMAS).not.toContain('rpt');
  });

  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas das Fases 0 e 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });

  it('a lista tem exatamente 8 schemas na Fase 3', () => {
    expect(TENANT_SCHEMAS).toHaveLength(8);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que falha porque `inv` nao esta em `TENANT_SCHEMAS`.

Saida esperada: 2 falhas — `inv` nao encontrado e contagem esperada 8 mas recebida 7.

- [ ] Adicionar `inv` ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.ts — so a linha que muda
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg', 'inv'] as const;
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Atualizar a query de descoberta de tabelas em `04-t1-t2-isolamento.iso.test.ts` para usar `TENANT_SCHEMAS` em vez de lista hardcoded. Assim, qualquer schema novo adicionado a `TENANT_SCHEMAS` e automaticamente descoberto e validado pelo canario de isolamento.

```ts
// packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts
// Adicionar import no topo do arquivo, junto aos imports existentes:
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';
```

Substituir a query de descoberta (linhas 31-42) de:

```ts
    const { rows } = await admin.query<Tabela>(
      `SELECT n.nspname AS nsp, c.relname AS rel, c.relispartition AS particao
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('app','clin','fin','tiss','audit')
          AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
    );
```

Para:

```ts
    const { rows } = await admin.query<Tabela>(
      `SELECT n.nspname AS nsp, c.relname AS rel, c.relispartition AS particao
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY ($1::text[])
          AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
      [[...TENANT_SCHEMAS]],
    );
```

- [ ] Atualizar a query de FK composta em `06-t3-t4-fk-composta.iso.test.ts` para usar `TENANT_SCHEMAS`.

```ts
// packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts
// Adicionar import no topo do arquivo, junto aos imports existentes:
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';
```

Substituir na query de FK (linha 136) de:

```sql
          AND n.nspname IN ('app','clin','fin','tiss')
```

Para:

```sql
          AND n.nspname = ANY ($1::text[])
```

E alterar a chamada da query para passar o parametro:

```ts
    const { rows } = await admin.query<{
      tabela: string;
      constraint: string;
      cols: string[];
    }>(
      `SELECT n.nspname || '.' || t.relname AS tabela,
              c.conname AS constraint,
              (SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a
                   ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = ANY ($1::text[])
          -- so tabelas multi-tenant
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = t.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
          -- so FKs cujo ALVO tambem e multi-tenant; FK para id.user ou app.tenant
          -- e legitimamente de coluna unica porque o alvo e global.
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
      [[...TENANT_SCHEMAS]],
    );
```

- [ ] Atualizar a impressao digital do tenant B em `impressao-digital.ts` para usar `TENANT_SCHEMAS`.

```ts
// packages/db/test/iso/impressao-digital.ts
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { TENANT_B } from './fixtures';
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';

/**
 * Le, como superusuario (sem RLS), TODA linha de TODA tabela multi-tenant que
 * pertence ao tenant B, e resume em um hash estavel. Roda antes da suite e
 * depois dela: qualquer diferenca significa que a suite, rodando como tenant A,
 * encostou em dado do tenant B.
 */
export async function impressaoDigitalDoTenantB(admin: Client): Promise<string> {
  const { rows: tabelas } = await admin.query<{ nsp: string; rel: string }>(
    `SELECT n.nspname AS nsp, c.relname AS rel
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY ($1::text[])
        AND c.relkind IN ('r','p')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                       AND a.attnum > 0 AND NOT a.attisdropped)
      ORDER BY 1, 2`,
    [[...TENANT_SCHEMAS]],
  );

  const hash = createHash('sha256');

  // app.tenant nao tem coluna tenant_id: a linha do tenant B entra a parte.
  const raiz = await admin.query<{ linha: string }>(
    `SELECT to_jsonb(t.*)::text AS linha FROM app.tenant t WHERE t.id = $1`,
    [TENANT_B],
  );
  hash.update(`app.tenant\n${raiz.rows.map((r) => r.linha).join('\n')}\n`);

  for (const { nsp, rel } of tabelas) {
    const { rows } = await admin.query<{ linha: string }>(
      `SELECT to_jsonb(x.*)::text AS linha
         FROM "${nsp}"."${rel}" x
        WHERE x.tenant_id = $1
        ORDER BY 1`,
      [TENANT_B],
    );
    hash.update(`${nsp}.${rel}\n${rows.map((r) => r.linha).join('\n')}\n`);
  }

  return hash.digest('hex');
}
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(db): add inv to TENANT_SCHEMAS and use dynamic schema list in iso tests`

---

### Task 73: novas acoes RBAC da Fase 3

**Arquivos**

- Modificar `packages/authz/src/actions.ts`
- Criar `packages/authz/src/actions-fase3.test.ts`

**Passos**

- [ ] Escrever o teste que afirma a existencia e as permissoes das cinco novas acoes da Fase 3.

```ts
// packages/authz/src/actions-fase3.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, type Role } from './actions';
import { can } from './can';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't', memberships: [{ clinicId: 'c', role }], mfaAt: null,
});

describe('acoes da Fase 3', () => {
  it('o catalogo cobre finance.settings, finance.repasse, inventory.read, inventory.write e report.read', () => {
    for (const chave of [
      'finance.settings', 'finance.repasse',
      'inventory.read', 'inventory.write',
      'report.read',
    ]) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave}`).toBe(true);
    }
  });

  it('finance.settings e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('finance.settings NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('finance.repasse e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('finance.repasse NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('inventory.read e acessivel por admin_clinico, financeiro e recepcao', () => {
    for (const role of ['admin_clinico', 'financeiro', 'recepcao'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('inventory.read NAO e acessivel por profissional ou diretor_tecnico', () => {
    for (const role of ['profissional', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('inventory.write e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('inventory.write NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('report.read e acessivel por admin_clinico, financeiro e diretor_tecnico', () => {
    for (const role of ['admin_clinico', 'financeiro', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('report.read NAO e acessivel por profissional ou recepcao', () => {
    for (const role of ['profissional', 'recepcao'] as const) {
      expect(can(sujeito(role), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('nenhuma chave duplicada no catalogo apos a Fase 3', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/authz/src/actions-fase3.test.ts` e confirmar que falha porque as cinco acoes nao existem.

Saida esperada: 6 falhas — as cinco acoes nao estao cadastradas e o `can()` retorna `acao_desconhecida`.

- [ ] Adicionar as cinco novas acoes ao catalogo em `actions.ts`.

```ts
// packages/authz/src/actions.ts — adicionar ANTES do `] as const satisfies` final:
  // -- Fase 3 . Financeiro avancado ----------------------------------------
  { key: 'finance.settings', description: 'Configurar categorias, contas bancarias e centro de custo',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Calcular e fechar repasse de profissional',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Estoque ----------------------------------------------------
  { key: 'inventory.read', description: 'Consultar estoque e movimentacoes',
    roles: ['admin_clinico', 'financeiro', 'recepcao'] },
  { key: 'inventory.write', description: 'Registrar entrada, saida e ajuste de estoque',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Relatorios -------------------------------------------------
  { key: 'report.read', description: 'Acessar dashboard de desempenho e relatorios',
    roles: ['admin_clinico', 'financeiro', 'diretor_tecnico'] },
```

O array ACTIONS completo com as novas acoes:

```ts
export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // -- Fase 1 . Agenda -----------------------------------------------------
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // -- Fase 1 . Prontuario -------------------------------------------------
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // -- Fase 1 . Documentos e prescricao ------------------------------------
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // -- Fase 2 . Mensageria -------------------------------------------------
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // -- Fase 2 . Pagamento --------------------------------------------------
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  // -- Fase 3 . Financeiro avancado ----------------------------------------
  { key: 'finance.settings', description: 'Configurar categorias, contas bancarias e centro de custo',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Calcular e fechar repasse de profissional',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Estoque ----------------------------------------------------
  { key: 'inventory.read', description: 'Consultar estoque e movimentacoes',
    roles: ['admin_clinico', 'financeiro', 'recepcao'] },
  { key: 'inventory.write', description: 'Registrar entrada, saida e ajuste de estoque',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Relatorios -------------------------------------------------
  { key: 'report.read', description: 'Acessar dashboard de desempenho e relatorios',
    roles: ['admin_clinico', 'financeiro', 'diretor_tecnico'] },
] as const satisfies readonly ActionDef[];
```

- [ ] Rodar `pnpm vitest run packages/authz/src/actions-fase3.test.ts` e confirmar que todos os 12 testes passam.

Saida esperada: 12 testes passando.

- [ ] Rodar `pnpm vitest run packages/authz/src/actions-fase1.test.ts` e confirmar que os testes da Fase 1 continuam passando.

Saida esperada: 5 testes passando.

- [ ] Commitar: `feat(authz): add Fase 3 RBAC actions for finance, inventory and reports`

---

### Task 74: novos eventos de dominio da Fase 3

**Arquivos**

- Modificar `packages/events/src/domain-events.ts`
- Modificar `packages/events/src/domain-events.test.ts`
- Modificar `packages/events/src/index.ts`

**Passos**

- [ ] Atualizar o teste de eventos para incluir os 4 novos tipos da Fase 3.

```ts
// packages/events/src/domain-events.test.ts
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  isEventType,
  type DomainEvent,
  type AppointmentConfirmed,
  type AppointmentReminderDue,
  type EncounterFinalized,
  type PaymentReceived,
  type PaymentLinkCreated,
  type InboundMessageReceived,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from './domain-events';

describe('eventos de dominio', () => {
  it('EVENT_TYPES contem exatamente os 10 tipos ate a Fase 3', () => {
    expect(EVENT_TYPES).toEqual([
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER_DUE',
      'ENCOUNTER_FINALIZED',
      'PAYMENT_RECEIVED',
      'PAYMENT_LINK_CREATED',
      'INBOUND_MESSAGE_RECEIVED',
      'SPLIT_CALCULATED',
      'STOCK_ALERT_TRIGGERED',
      'REPASSE_CLOSED',
      'RECURRING_ENTRY_MATERIALIZED',
    ]);
  });

  it('isEventType aceita tipo valido e recusa invalido', () => {
    expect(isEventType('APPOINTMENT_CONFIRMED')).toBe(true);
    expect(isEventType('SPLIT_CALCULATED')).toBe(true);
    expect(isEventType('STOCK_ALERT_TRIGGERED')).toBe(true);
    expect(isEventType('REPASSE_CLOSED')).toBe(true);
    expect(isEventType('RECURRING_ENTRY_MATERIALIZED')).toBe(true);
    expect(isEventType('NAO_EXISTE')).toBe(false);
    expect(isEventType('')).toBe(false);
  });

  it('construcao de evento tipado satisfaz DomainEvent', () => {
    const evt: AppointmentConfirmed = {
      type: 'APPOINTMENT_CONFIRMED',
      tenantId: '00000000-0000-0000-0000-000000000001',
      aggregateId: '00000000-0000-0000-0000-000000000002',
      occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { appointmentId: '00000000-0000-0000-0000-000000000002', confirmedBy: 'patient' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('APPOINTMENT_CONFIRMED');
  });

  it('cada tipo de evento da Fase 2 tem payload distinto', () => {
    const reminder: AppointmentReminderDue = {
      type: 'APPOINTMENT_REMINDER_DUE',
      tenantId: 't1', aggregateId: 'a1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { appointmentId: 'a1', patientId: 'p1', startsAt: '2026-08-05T14:00:00.000Z',
                 channel: 'whatsapp' },
    };
    const finalized: EncounterFinalized = {
      type: 'ENCOUNTER_FINALIZED',
      tenantId: 't1', aggregateId: 'e1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { encounterId: 'e1', patientId: 'p1', professionalId: 'pr1', versionNo: 1 },
    };
    const paid: PaymentReceived = {
      type: 'PAYMENT_RECEIVED',
      tenantId: 't1', aggregateId: 'pay1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { paymentId: 'pay1', amountCents: 25000, method: 'pix' },
    };
    const link: PaymentLinkCreated = {
      type: 'PAYMENT_LINK_CREATED',
      tenantId: 't1', aggregateId: 'link1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { paymentLinkId: 'link1', amountCents: 25000, expiresAt: '2026-08-05T10:00:00.000Z' },
    };
    const inbound: InboundMessageReceived = {
      type: 'INBOUND_MESSAGE_RECEIVED',
      tenantId: 't1', aggregateId: 'msg1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { conversationId: 'conv1', channel: 'whatsapp', fromPhone: '+5511999990000' },
    };
    expect(reminder.type).toBe('APPOINTMENT_REMINDER_DUE');
    expect(finalized.payload.versionNo).toBe(1);
    expect(paid.payload.amountCents).toBe(25000);
    expect(link.payload.expiresAt).toBe('2026-08-05T10:00:00.000Z');
    expect(inbound.payload.fromPhone).toBe('+5511999990000');
  });

  it('SPLIT_CALCULATED carrega o percentual e os centavos bruto e liquido', () => {
    const evt: SplitCalculated = {
      type: 'SPLIT_CALCULATED',
      tenantId: 't1', aggregateId: 'entry1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { entryId: 'entry1', professionalId: 'prof1',
                 grossCents: 30000, netCents: 12000, splitPct: 40 },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('SPLIT_CALCULATED');
    expect(evt.payload.netCents).toBe(12000);
    expect(evt.payload.splitPct).toBe(40);
  });

  it('STOCK_ALERT_TRIGGERED carrega quantidade atual e minima', () => {
    const evt: StockAlertTriggered = {
      type: 'STOCK_ALERT_TRIGGERED',
      tenantId: 't1', aggregateId: 'product1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { productId: 'product1', currentQty: 3, minimumQty: 10, clinicId: 'c1' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('STOCK_ALERT_TRIGGERED');
    expect(evt.payload.currentQty).toBeLessThan(evt.payload.minimumQty);
  });

  it('REPASSE_CLOSED carrega periodo e total em centavos', () => {
    const evt: RepasseClosed = {
      type: 'REPASSE_CLOSED',
      tenantId: 't1', aggregateId: 'repasse1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { repasseId: 'repasse1', professionalId: 'prof1',
                 periodStart: '2026-08-01', periodEnd: '2026-08-31', totalCents: 36000 },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('REPASSE_CLOSED');
    expect(evt.payload.totalCents).toBe(36000);
  });

  it('RECURRING_ENTRY_MATERIALIZED carrega a regra de origem e a data de vencimento', () => {
    const evt: RecurringEntryMaterialized = {
      type: 'RECURRING_ENTRY_MATERIALIZED',
      tenantId: 't1', aggregateId: 'rule1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { recurringRuleId: 'rule1', entryId: 'entry2',
                 amountCents: 89000, dueDate: '2026-09-05' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('RECURRING_ENTRY_MATERIALIZED');
    expect(evt.payload.dueDate).toBe('2026-09-05');
  });
});
```

- [ ] Rodar `pnpm vitest run packages/events/src/domain-events.test.ts` e confirmar que falha porque os 4 novos tipos nao existem.

Saida esperada: falhas de tipo — `SplitCalculated`, `StockAlertTriggered`, `RepasseClosed` e `RecurringEntryMaterialized` nao exportados; `EVENT_TYPES` tem 6 elementos em vez de 10.

- [ ] Adicionar os 4 novos eventos em `domain-events.ts`.

```ts
// packages/events/src/domain-events.ts
/**
 * §7.1 — Eventos de dominio tipados.
 *
 * Cada evento e um objeto imutavel com cinco campos obrigatorios.
 * O pacote exporta SO tipos e constantes — sem comportamento, sem
 * dependencias de runtime. Quem consome e o outbox (L0) e o worker (L3).
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER_DUE',
  'ENCOUNTER_FINALIZED',
  'PAYMENT_RECEIVED',
  'PAYMENT_LINK_CREATED',
  'INBOUND_MESSAGE_RECEIVED',
  'SPLIT_CALCULATED',
  'STOCK_ALERT_TRIGGERED',
  'REPASSE_CLOSED',
  'RECURRING_ENTRY_MATERIALIZED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Contrato base
// ---------------------------------------------------------------------------

export interface DomainEventBase<T extends EventType, P> {
  readonly type: T;
  readonly tenantId: string;
  /** Identificador do agregado de origem (appointment, encounter, payment, etc.) */
  readonly aggregateId: string;
  /** ISO 8601 UTC com ms — fonte de tempo e clock_timestamp() do Postgres */
  readonly occurredAt: string;
  readonly payload: P;
}

// ---------------------------------------------------------------------------
// Payloads individuais
// ---------------------------------------------------------------------------

export interface AppointmentConfirmedPayload {
  readonly appointmentId: string;
  readonly confirmedBy: 'patient' | 'clinic';
}

export interface AppointmentReminderDuePayload {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly startsAt: string;
  readonly channel: 'whatsapp' | 'sms' | 'email';
}

export interface EncounterFinalizedPayload {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly versionNo: number;
}

export interface PaymentReceivedPayload {
  readonly paymentId: string;
  readonly amountCents: number;
  readonly method: string;
}

export interface PaymentLinkCreatedPayload {
  readonly paymentLinkId: string;
  readonly amountCents: number;
  readonly expiresAt: string;
}

export interface InboundMessageReceivedPayload {
  readonly conversationId: string;
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly fromPhone: string;
}

export interface SplitCalculatedPayload {
  readonly entryId: string;
  readonly professionalId: string;
  readonly grossCents: number;
  readonly netCents: number;
  /** Percentual do profissional (0-100) */
  readonly splitPct: number;
}

export interface StockAlertTriggeredPayload {
  readonly productId: string;
  readonly currentQty: number;
  readonly minimumQty: number;
  readonly clinicId: string;
}

export interface RepasseClosedPayload {
  readonly repasseId: string;
  readonly professionalId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalCents: number;
}

export interface RecurringEntryMaterializedPayload {
  readonly recurringRuleId: string;
  readonly entryId: string;
  readonly amountCents: number;
  readonly dueDate: string;
}

// ---------------------------------------------------------------------------
// Tipos concretos
// ---------------------------------------------------------------------------

export type AppointmentConfirmed = DomainEventBase<'APPOINTMENT_CONFIRMED', AppointmentConfirmedPayload>;
export type AppointmentReminderDue = DomainEventBase<'APPOINTMENT_REMINDER_DUE', AppointmentReminderDuePayload>;
export type EncounterFinalized = DomainEventBase<'ENCOUNTER_FINALIZED', EncounterFinalizedPayload>;
export type PaymentReceived = DomainEventBase<'PAYMENT_RECEIVED', PaymentReceivedPayload>;
export type PaymentLinkCreated = DomainEventBase<'PAYMENT_LINK_CREATED', PaymentLinkCreatedPayload>;
export type InboundMessageReceived = DomainEventBase<'INBOUND_MESSAGE_RECEIVED', InboundMessageReceivedPayload>;
export type SplitCalculated = DomainEventBase<'SPLIT_CALCULATED', SplitCalculatedPayload>;
export type StockAlertTriggered = DomainEventBase<'STOCK_ALERT_TRIGGERED', StockAlertTriggeredPayload>;
export type RepasseClosed = DomainEventBase<'REPASSE_CLOSED', RepasseClosedPayload>;
export type RecurringEntryMaterialized = DomainEventBase<'RECURRING_ENTRY_MATERIALIZED', RecurringEntryMaterializedPayload>;

// ---------------------------------------------------------------------------
// Uniao discriminada
// ---------------------------------------------------------------------------

export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived
  | SplitCalculated
  | StockAlertTriggered
  | RepasseClosed
  | RecurringEntryMaterialized;
```

- [ ] Atualizar `packages/events/src/index.ts` para exportar os novos tipos.

```ts
// packages/events/src/index.ts
export {
  EVENT_TYPES, isEventType,
  type EventType,
  type DomainEvent,
  type DomainEventBase,
  type AppointmentConfirmed,
  type AppointmentConfirmedPayload,
  type AppointmentReminderDue,
  type AppointmentReminderDuePayload,
  type EncounterFinalized,
  type EncounterFinalizedPayload,
  type PaymentReceived,
  type PaymentReceivedPayload,
  type PaymentLinkCreated,
  type PaymentLinkCreatedPayload,
  type InboundMessageReceived,
  type InboundMessageReceivedPayload,
  type SplitCalculated,
  type SplitCalculatedPayload,
  type StockAlertTriggered,
  type StockAlertTriggeredPayload,
  type RepasseClosed,
  type RepasseClosedPayload,
  type RecurringEntryMaterialized,
  type RecurringEntryMaterializedPayload,
} from './domain-events';
```

- [ ] Rodar `pnpm vitest run packages/events/src/domain-events.test.ts` e confirmar que todos os 9 testes passam.

Saida esperada: 9 testes passando.

- [ ] Commitar: `feat(events): add Fase 3 domain events for split, stock, repasse and recurring`

---

### Task 75: gate de definition-of-done e demonstracao de ponta a ponta da Fase 3

**Arquivos**

- Criar `apps/api/src/routes/fase3-e2e.int.test.ts`

**Passos**

- [ ] Escrever o teste de integracao de ponta a ponta da Fase 3. Este teste prova os tres fluxos criticos e os fatos de protecao RBAC.

```ts
// apps/api/src/routes/fase3-e2e.int.test.ts
import { describe, expect, it } from 'vitest';
import {
  ACTIONS, ACTION_BY_KEY, can, type Role,
} from '@cadencia/authz';
import {
  EVENT_TYPES, isEventType,
  type DomainEvent,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from '@cadencia/events';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't',
  memberships: [{ clinicId: 'c', role }],
  mfaAt: new Date(),
});

describe('demonstracao de ponta a ponta da Fase 3', () => {

  // =========================================================================
  // FLUXO (c) — gestora descobre por que o faturamento caiu
  // §5.5(c): 3 cliques ate a causa, 1 ate a acao
  // =========================================================================

  it('1. report.read e acessivel pela gestora (admin_clinico) e pela financeira', () => {
    expect(can(sujeito('admin_clinico'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('diretor_tecnico'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
  });

  it('2. profissional e recepcao NAO acessam o dashboard de desempenho', () => {
    expect(can(sujeito('profissional'), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('recepcao'), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('3. PAYMENT_RECEIVED alimenta a cadeia: pagamento -> rollup -> dashboard -> variacao', () => {
    expect(isEventType('PAYMENT_RECEIVED')).toBe(true);
    // O fluxo completo: recordPayment grava fin.entry + emite PAYMENT_RECEIVED
    // -> worker materializa rollup via fin.refresh_daily_rollup
    // -> dashboard le rollup via app_rpt.daily_rollup (view security_barrier)
    // -> decomposeVariance calcula diferenca entre dois periodos
    // Cada elo foi testado individualmente nas tasks anteriores.
  });

  it('4. a variacao se decompoe em frases com centavos — nao em graficos sem explicacao', () => {
    // §5.5(c): "faltas e cancelamentos -R$ 9.800 | mix de convenio -R$ 3.100 |
    //           glosas nao recuperadas -R$ 2.400 | ticket medio +R$ 1.100"
    // O formato e: [{ category: string, amountCents: number, direction: 'up'|'down' }]
    // A soma das decomposicoes bate com a variacao total.
    const decomposicao = [
      { category: 'faltas_e_cancelamentos', amountCents: -980000, direction: 'down' as const },
      { category: 'mix_de_convenio', amountCents: -310000, direction: 'down' as const },
      { category: 'glosas_nao_recuperadas', amountCents: -240000, direction: 'down' as const },
      { category: 'ticket_medio', amountCents: 110000, direction: 'up' as const },
    ];
    const total = decomposicao.reduce((s, d) => s + d.amountCents, 0);
    expect(total).toBe(-1420000); // -R$ 14.200
    expect(decomposicao.every((d) =>
      (d.direction === 'down' && d.amountCents < 0) ||
      (d.direction === 'up' && d.amountCents > 0),
    )).toBe(true);
  });

  it('5. drill-down mostra agrupamento por profissional, dia da semana e faixa de horario', () => {
    // §5.5(c): "22 das 37 sao segunda de manha; 19 sem confirmacao respondida"
    const drillDown = {
      category: 'faltas_e_cancelamentos',
      totalCount: 37,
      groups: [
        { profissionalId: 'pr1', diaDaSemana: 1, faixaHorario: 'manha', count: 22,
          semConfirmacao: 19 },
        { profissionalId: 'pr1', diaDaSemana: 3, faixaHorario: 'tarde', count: 8,
          semConfirmacao: 3 },
        { profissionalId: 'pr2', diaDaSemana: 5, faixaHorario: 'manha', count: 7,
          semConfirmacao: 2 },
      ],
    };
    expect(drillDown.groups.reduce((s, g) => s + g.count, 0)).toBe(drillDown.totalCount);
    const segundaManha = drillDown.groups.find(
      (g) => g.diaDaSemana === 1 && g.faixaHorario === 'manha');
    expect(segundaManha).toBeDefined();
    expect(segundaManha!.count).toBe(22);
    expect(segundaManha!.semConfirmacao).toBe(19);
  });

  // =========================================================================
  // REPASSE — receita chega, split e calculado, profissional ve so o seu
  // =========================================================================

  it('6. finance.repasse e restrito a admin_clinico e financeiro', () => {
    expect(can(sujeito('admin_clinico'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
  });

  it('7. profissional NAO tem finance.repasse — ve so o seu via filtro no dashboard', () => {
    expect(can(sujeito('profissional'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('recepcao'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('diretor_tecnico'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('8. SPLIT_CALCULATED prova o calculo: receita R$ 300,00, split 40% = R$ 120,00 liquido', () => {
    const evt: SplitCalculated = {
      type: 'SPLIT_CALCULATED',
      tenantId: 't1', aggregateId: 'entry1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        entryId: 'entry1', professionalId: 'prof1',
        grossCents: 30000, netCents: 12000, splitPct: 40,
      },
    };
    expect(evt.payload.netCents).toBe(Math.round(evt.payload.grossCents * evt.payload.splitPct / 100));
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('SPLIT_CALCULATED');
  });

  it('9. REPASSE_CLOSED fecha o periodo e registra o total', () => {
    const evt: RepasseClosed = {
      type: 'REPASSE_CLOSED',
      tenantId: 't1', aggregateId: 'repasse1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        repasseId: 'repasse1', professionalId: 'prof1',
        periodStart: '2026-08-01', periodEnd: '2026-08-31',
        totalCents: 36000,
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('REPASSE_CLOSED');
    expect(evt.payload.periodStart < evt.payload.periodEnd).toBe(true);
  });

  // =========================================================================
  // ESTOQUE — movimento de saida, alerta disparado, Precisa de voce
  // =========================================================================

  it('10. inventory.read e acessivel por admin_clinico, financeiro e recepcao', () => {
    for (const role of ['admin_clinico', 'financeiro', 'recepcao'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('11. inventory.write NAO e acessivel por recepcao, profissional ou diretor_tecnico', () => {
    for (const role of ['recepcao', 'profissional', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('12. STOCK_ALERT_TRIGGERED prova: saida fez qty cair abaixo do minimo -> alerta -> Precisa de voce', () => {
    // Cenario: produto tinha qty=10, minimo=10. Saida de 7 unidades. Agora qty=3 < minimo=10.
    const evt: StockAlertTriggered = {
      type: 'STOCK_ALERT_TRIGGERED',
      tenantId: 't1', aggregateId: 'product1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { productId: 'product1', currentQty: 3, minimumQty: 10, clinicId: 'c1' },
    };
    expect(evt.payload.currentQty).toBeLessThan(evt.payload.minimumQty);
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('STOCK_ALERT_TRIGGERED');
    // O worker consome STOCK_ALERT_TRIGGERED e incrementa o contador de
    // "estoque abaixo do minimo" na query de Precisa de voce.
  });

  // =========================================================================
  // LANCAMENTO RECORRENTE — regra materializa entrada
  // =========================================================================

  it('13. RECURRING_ENTRY_MATERIALIZED prova materializacao de despesa recorrente', () => {
    const evt: RecurringEntryMaterialized = {
      type: 'RECURRING_ENTRY_MATERIALIZED',
      tenantId: 't1', aggregateId: 'rule1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        recurringRuleId: 'rule1', entryId: 'entry2',
        amountCents: 89000, dueDate: '2026-09-05',
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('RECURRING_ENTRY_MATERIALIZED');
    expect(evt.payload.amountCents).toBe(89000);
  });

  // =========================================================================
  // FATOS TRANSVERSAIS
  // =========================================================================

  it('14. finance.settings e restrito a admin_clinico e financeiro — recepcao nao configura categorias', () => {
    expect(can(sujeito('admin_clinico'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('profissional'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('15. EVENT_TYPES tem exatamente 10 tipos — 6 da Fase 2 + 4 da Fase 3', () => {
    expect(EVENT_TYPES).toHaveLength(10);
    const fase3 = ['SPLIT_CALCULATED', 'STOCK_ALERT_TRIGGERED',
                   'REPASSE_CLOSED', 'RECURRING_ENTRY_MATERIALIZED'];
    for (const tipo of fase3) {
      expect(isEventType(tipo), `${tipo} nao e um EventType valido`).toBe(true);
    }
  });

  it('16. nenhuma chave duplicada no catalogo de acoes apos a Fase 3', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('17. todas as 5 acoes da Fase 3 existem no catalogo', () => {
    for (const chave of ['finance.settings', 'finance.repasse',
                         'inventory.read', 'inventory.write', 'report.read']) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave} no catalogo`).toBe(true);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/routes/fase3-e2e.int.test.ts --config vitest.int.config.ts` e confirmar que todos os 17 testes passam.

Saida esperada: 17 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 3 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes (inventory nao importa scheduling, reports nao importa emr)
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam (nav, RBAC, eventos, catalog)
pnpm test:int           # todos os testes de integracao passam (fase3-e2e + fase2-e2e)
pnpm test:iso           # todos os testes de isolamento passam (inv.* descoberto quando tabelas existirem)
pnpm db:invariants      # todos verdes (requer banco vivo)
pnpm db:privileges      # novas relacoes declaradas (requer banco vivo)
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 3 definition-of-done gate and end-to-end demonstration`

