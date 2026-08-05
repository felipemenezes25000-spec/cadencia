<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:
  1. Task 27 (PaymentProvider contrato): o contrato DEFINITIVO e do
     Bloco 06, que adiciona idempotencyKey em createPaymentLink,
     PaymentStatus com 5 valores (pending/paid/expired/cancelled/refunded),
     PaymentSnapshot com feeCents/method, e Settlement com originalPaidAt.
     A versao deste bloco (7 status, metadata em snapshot) e SUPERSEDED.
  2. Task 27 (createFakePaymentProvider): a versao definitiva e do Bloco 06
     (4 modos: ok/indisponivel/timeout/rejeitado, simularPago).
  3. O barrel integrations/src/index.ts e unificado no Bloco 06.
  4. fin.daily_rollup (migration 0078): MANTIDO neste bloco com amount_cents
     bigint. O Bloco 06 migration 0080 deve conter APENAS a funcao
     fin.refresh_daily_rollup (sem CREATE TABLE).
─────────────────────────────────────────────────────────────────── -->

### Task 24: migration 0076 — enum, categorias e metodos de pagamento no schema fin

**Arquivos**

- Criar `packages/db/migrations/0076_fin_category_payment_method.sql`
- Teste `packages/payments/src/schema.int.test.ts` (criado na Task 25, valida aqui tambem)

**Passos**

- [ ] Criar a migration `packages/db/migrations/0076_fin_category_payment_method.sql`:

```sql
-- 0076_fin_category_payment_method.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema `fin` ja existe (migration 0002). Aqui nascem os tipos enumerados e as
-- tabelas de referencia: categorias de lancamento e metodos de pagamento.
-- Dinheiro em centavos inteiros (bigint), sem numeric — decisao irreversivel §10.

-- ---------------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------------
CREATE TYPE fin.entry_kind AS ENUM ('receita', 'despesa');

CREATE TYPE fin.payment_method_kind AS ENUM (
  'dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'link', 'convenio');

CREATE TYPE fin.entry_status AS ENUM (
  'pendente', 'pago', 'cancelado', 'estornado');

-- ---------------------------------------------------------------------------
-- 2. Categorias de lancamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.category (
  tenant_id   uuid NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid NOT NULL,
  name        text NOT NULL COLLATE "pt-BR-x-icu",
  kind        fin.entry_kind NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name, kind)
);
ALTER TABLE fin.category OWNER TO app_owner;
ALTER TABLE fin.category ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.category FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.category AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Metodos de pagamento do tenant
-- ---------------------------------------------------------------------------
CREATE TABLE fin.payment_method (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  kind         fin.payment_method_kind NOT NULL,
  name         text NOT NULL COLLATE "pt-BR-x-icu",
  provider_ref text,          -- ref do PSP para cartao/pix; null para dinheiro
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE fin.payment_method OWNER TO app_owner;
ALTER TABLE fin.payment_method ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_method FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.payment_method AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0076 aplicada sem erro.

- [ ] Rodar a suite de isolamento para garantir que as tabelas novas passam:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas (incluindo `fin.category` e `fin.payment_method`) passam nos testes de RLS e FK composta.

---

### Task 25: migration 0077 — lancamento financeiro e recibo

**Arquivos**

- Criar `packages/db/migrations/0077_fin_entry_receipt.sql`
- Criar `packages/payments/src/schema.int.test.ts`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0077_fin_entry_receipt.sql`:

```sql
-- 0077_fin_entry_receipt.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Lancamento financeiro (fin.entry) e recibo (fin.receipt). Dinheiro em centavos
-- inteiros (bigint) — Money do kernel, nunca numeric. A coluna amount_cents e
-- bigint para acomodar valores grandes sem perda.

-- ---------------------------------------------------------------------------
-- 1. Lancamento financeiro
-- ---------------------------------------------------------------------------
CREATE TABLE fin.entry (
  tenant_id         uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                uuid NOT NULL,
  kind              fin.entry_kind NOT NULL,
  category_id       uuid,
  patient_id        uuid,
  appointment_id    uuid,
  professional_id   uuid NOT NULL,
  clinic_id         uuid NOT NULL,
  description       text NOT NULL COLLATE "pt-BR-x-icu",
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  payment_method_id uuid NOT NULL,
  paid_at           timestamptz(3),
  due_date          date,
  status            fin.entry_status NOT NULL DEFAULT 'pendente',
  external_ref      text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by        uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, category_id)
    REFERENCES fin.category(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)
    REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)
    REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_method_id)
    REFERENCES fin.payment_method(tenant_id, id)
);
ALTER TABLE fin.entry OWNER TO app_owner;

CREATE INDEX ix_entry_tenant_clinic_date ON fin.entry
  (tenant_id, clinic_id, created_at DESC);
CREATE INDEX ix_entry_patient ON fin.entry (tenant_id, patient_id)
  WHERE patient_id IS NOT NULL;
CREATE INDEX ix_entry_appointment ON fin.entry (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

ALTER TABLE fin.entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.entry AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Sequencia de recibo por tenant
-- ---------------------------------------------------------------------------
CREATE TABLE fin.receipt_counter (
  tenant_id   uuid NOT NULL,
  next_value  bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id)
);
ALTER TABLE fin.receipt_counter OWNER TO app_owner;
ALTER TABLE fin.receipt_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.receipt_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.receipt_counter AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Recibo
-- ---------------------------------------------------------------------------
CREATE TABLE fin.receipt (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  entry_id        uuid NOT NULL,
  receipt_number  bigint NOT NULL,
  issued_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  pdf_storage_key text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  FOREIGN KEY (tenant_id, entry_id)
    REFERENCES fin.entry(tenant_id, id)
);
ALTER TABLE fin.receipt OWNER TO app_owner;
ALTER TABLE fin.receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.receipt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.receipt AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 4. Whitelist de chaves de auditoria para financeiro
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
              'amount_cents',        -- valor em centavos do lancamento financeiro
              'payment_method',      -- tipo do meio de pagamento (enum fechado)
              'receipt_number'       -- numero sequencial do recibo
            )
         );
$$;

RESET ROLE;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0077 aplicada sem erro.

- [ ] Criar o teste de integracao do schema em `packages/payments/src/schema.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeFinanceiro {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  categoryId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearFinanceiro(): Promise<SementeFinanceiro> {
  const s: SementeFinanceiro = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Financeiro', '12ABC34501DE35')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Fin')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Financeiro', 'completo')`,
      [s.tenantId, s.patientId]);
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

let s: SementeFinanceiro;
let actor: Actor;

beforeAll(async () => {
  s = await semearFinanceiro();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semeia categoria e metodo de pagamento via transacao de negocio
  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES (app.require_tenant_id(), $1, 'Consulta', 'receita')`,
      [s.categoryId]);
    await tx.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro')`,
      [s.paymentMethodId]);
  });
});

afterAll(async () => { await closePools(); });

describe('schema fin — categorias e metodos', () => {
  it('insere e le categoria com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind::text AS kind FROM fin.category WHERE id = $1`,
        [s.categoryId]));
    expect(rows[0]).toEqual({ name: 'Consulta', kind: 'receita' });
  });

  it('insere e le metodo de pagamento com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind::text AS kind FROM fin.payment_method WHERE id = $1`,
        [s.paymentMethodId]));
    expect(rows[0]).toEqual({ name: 'Dinheiro', kind: 'dinheiro' });
  });

  it('insere lancamento financeiro e recibo', async () => {
    const entryId = uuidv7();
    const receiptId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4, $5,
                 'Consulta particular', 25000, $6, clock_timestamp(), 'pago', $7)`,
        [entryId, s.categoryId, s.patientId, s.professionalId, s.clinicId,
         s.paymentMethodId, `pay-${entryId}`]);

      // Provisiona o contador de recibo
      await tx.query(
        `INSERT INTO fin.receipt_counter (tenant_id, next_value)
         VALUES (app.require_tenant_id(), 1)
         ON CONFLICT (tenant_id) DO NOTHING`);

      // Consome o proximo numero de recibo
      const { rows: counterRows } = await tx.query<{ consumed: string }>(
        `UPDATE fin.receipt_counter
            SET next_value = next_value + 1
          WHERE tenant_id = app.require_tenant_id()
        RETURNING next_value - 1 AS consumed`);
      const receiptNumber = Number(counterRows[0]?.consumed);

      await tx.query(
        `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number)
         VALUES (app.require_tenant_id(), $1, $2, $3)`,
        [receiptId, entryId, receiptNumber]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; status: string; receipt_number: string }>(
        `SELECT e.amount_cents::text AS amount_cents, e.status::text AS status,
                r.receipt_number::text AS receipt_number
           FROM fin.entry e
           JOIN fin.receipt r ON (r.tenant_id, r.entry_id) = (e.tenant_id, e.id)
          WHERE e.id = $1`, [entryId]));

    expect(rows[0]).toEqual({
      amount_cents: '25000',
      status: 'pago',
      receipt_number: '1',
    });
  });

  it('rejeita idempotency_key duplicada', async () => {
    const key = `dup-${uuidv7()}`;
    const e1 = uuidv7();
    const e2 = uuidv7();

    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Duplicata', 10000, $4, 'pendente', $5)`,
        [e1, s.professionalId, s.clinicId, s.paymentMethodId, key]));

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Duplicata 2', 10000, $4, 'pendente', $5)`,
          [e2, s.professionalId, s.clinicId, s.paymentMethodId, key])),
    ).rejects.toThrow();
  });

  it('rejeita amount_cents zero ou negativo', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Invalido', 0, $4, 'pendente', $5)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `zero-${uuidv7()}`])),
    ).rejects.toThrow();
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/payments/src/schema.int.test.ts
```

Saida esperada: 5 testes passando.

- [ ] Rodar a suite de isolamento:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas `fin.*` passam.

---

### Task 26: migration 0078 — daily_rollup e policy

**Arquivos**

- Criar `packages/db/migrations/0078_fin_daily_rollup.sql`
- Modificar `packages/payments/src/schema.int.test.ts`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0078_fin_daily_rollup.sql`:

```sql
-- 0078_fin_daily_rollup.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.7 — daily_rollup com DUAS bases (competencia e caixa). O sentinel UUID
-- 00000000-0000-0000-0000-000000000000 substitui NULL em category_id na PK.
-- Materializado por job noturno. Detector de divergencia obrigatorio.

CREATE TABLE fin.daily_rollup (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id    uuid NOT NULL,
  day          date NOT NULL,
  basis        text NOT NULL CHECK (basis IN ('competencia', 'caixa')),
  kind         fin.entry_kind NOT NULL,
  category_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  status       text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0,
  entries      int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, clinic_id, day, basis, kind, category_id, status),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
ALTER TABLE fin.daily_rollup OWNER TO app_owner;

ALTER TABLE fin.daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.daily_rollup FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.daily_rollup AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- O job noturno precisa de INSERT/UPDATE/DELETE para recalcular o rollup.
-- O papel `jobs` tem BYPASSRLS e nao usa withTenantTx; acessa diretamente.
GRANT SELECT, INSERT, UPDATE, DELETE ON fin.daily_rollup TO jobs;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0078 aplicada sem erro.

- [ ] Adicionar testes ao `packages/payments/src/schema.int.test.ts`. Acrescentar o describe a seguir ao final do arquivo:

```ts
describe('schema fin — daily_rollup', () => {
  it('insere e le rollup com sentinela de categoria', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.daily_rollup
           (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
         VALUES (app.require_tenant_id(), $1, '2026-08-01', 'competencia', 'receita',
                 '00000000-0000-0000-0000-000000000000', 'pago', 25000, 1)`,
        [s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; entries: number; basis: string }>(
        `SELECT amount_cents::text AS amount_cents, entries, basis
           FROM fin.daily_rollup
          WHERE clinic_id = $1 AND day = '2026-08-01' AND basis = 'competencia'`,
        [s.clinicId]));

    expect(rows[0]).toEqual({
      amount_cents: '25000',
      entries: 1,
      basis: 'competencia',
    });
  });

  it('insere rollup com base caixa (paid_at)', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.daily_rollup
           (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
         VALUES (app.require_tenant_id(), $1, '2026-08-01', 'caixa', 'receita',
                 $2, 'pago', 25000, 1)`,
        [s.clinicId, s.categoryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; basis: string }>(
        `SELECT amount_cents::text AS amount_cents, basis
           FROM fin.daily_rollup
          WHERE clinic_id = $1 AND day = '2026-08-01' AND basis = 'caixa'`,
        [s.clinicId]));

    expect(rows[0]).toEqual({ amount_cents: '25000', basis: 'caixa' });
  });

  it('rejeita basis diferente de competencia ou caixa', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.daily_rollup
             (tenant_id, clinic_id, day, basis, kind, status, amount_cents, entries)
           VALUES (app.require_tenant_id(), $1, '2026-08-02', 'outro', 'receita', 'pago', 100, 1)`,
          [s.clinicId])),
    ).rejects.toThrow();
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/payments/src/schema.int.test.ts
```

Saida esperada: 8 testes passando (5 anteriores + 3 novos).

- [ ] Rodar a suite de isolamento:

```bash
pnpm test:iso
```

Saida esperada: `fin.daily_rollup` passa nos testes de RLS e FK composta.

---

### Task 27: PaymentProvider — contrato e fake — **SUPERSEDED pelo Bloco 06**

> **COLISAO RESOLVIDA**: o contrato PaymentProvider deste bloco e SUPERSEDED
> pelo Bloco 06 (Task 30). Diferencas:
> - PaymentStatus: este bloco tem 7 valores, Bloco 06 tem 5 (vence Bloco 06)
> - PaymentSnapshot: este bloco tem metadata, Bloco 06 tem feeCents/method (vence Bloco 06)
> - createPaymentLink: Bloco 06 adiciona idempotencyKey (vence Bloco 06)
> - createFakePaymentProvider: Bloco 06 tem mais modos de falha (vence Bloco 06)
>
> Este bloco deve OMITIR a criacao de `payment.ts` e `payment-fake.ts` nos
> arquivos de integrations e usar a versao do Bloco 06.
> As funcoes de dominio (recordPayment, cancelPayment, etc.) e os testes
> de unidade PERMANECEM validos — usam o contrato, nao o definem.

**Arquivos**

- Criar `packages/integrations/src/contracts/payment.ts`
- Criar `packages/integrations/src/fakes/payment-fake.ts`
- Criar `packages/integrations/src/fakes/payment-fake.test.ts`
- Modificar `packages/integrations/src/index.ts`

**Passos**

- [ ] Criar o contrato em `packages/integrations/src/contracts/payment.ts`:

```ts
import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export type PaymentStatus =
  | 'pending' | 'approved' | 'declined' | 'refunded'
  | 'partially_refunded' | 'cancelled' | 'indeterminate';

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly paidAt: Rfc3339 | null;
  readonly method: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface Settlement {
  readonly providerPaymentId: string;
  readonly grossCents: number;
  readonly netCents: number;
  readonly feeCents: number;
  readonly settledAt: Rfc3339;
}

export interface PaymentLinkInput {
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes: number;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentLinkResult {
  readonly providerPaymentId: string;
  readonly paymentUrl: string;
  readonly expiresAt: Rfc3339;
}

export interface PaymentProvider extends Provider {
  createPaymentLink(
    ctx: ProviderCtx,
    i: PaymentLinkInput,
  ): Promise<ProviderResult<PaymentLinkResult>>;

  getPayment(
    ctx: ProviderCtx,
    i: { providerPaymentId: string },
  ): Promise<ProviderResult<PaymentSnapshot>>;

  refund(
    ctx: ProviderCtx,
    i: { providerPaymentId: string; amountCents?: number; reason: string },
  ): Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;

  verifyWebhook(
    raw: Buffer,
    h: Record<string, string>,
  ): { valid: boolean; reason?: string };

  /** Conciliacao: taxa REAL vem do PSP; nunca calculamos por conta propria. */
  fetchSettlements(
    ctx: ProviderCtx,
    i: { from: Rfc3339; to: Rfc3339 },
  ): Promise<ProviderResult<Settlement[]>>;
}
```

- [ ] Criar o fake em `packages/integrations/src/fakes/payment-fake.ts`:

```ts
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentLinkInput, PaymentLinkResult, PaymentProvider,
  PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

export interface FakePaymentOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout';
}

export function createFakePaymentProvider(
  opts: FakePaymentOptions = {},
): PaymentProvider {
  const modo = opts.modo ?? 'ok';
  const pagamentos = new Map<string, PaymentSnapshot>();

  function falha<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, detail: 'PSP fake fora' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false, detail: 'deadline 3s' });
    }
    return null;
  }

  function agora(): Rfc3339 {
    return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'payment-fake',
    capabilities: new Set(['residency:br', 'pix', 'credit_card', 'debit_card']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createPaymentLink(ctx: ProviderCtx, i: PaymentLinkInput) {
      const f = falha<PaymentLinkResult>();
      if (f) return f;

      const providerPaymentId = `fake-pay-${ctx.idempotencyKey}`;
      const expiresAt = asRfc3339(
        isoFromMs(systemClock.nowMs() + i.expiresInMinutes * 60_000),
      ) ?? agora();

      const snapshot: PaymentSnapshot = {
        providerPaymentId,
        status: 'pending',
        amountCents: i.amountCents,
        paidAt: null,
        method: null,
        metadata: i.metadata ?? {},
      };
      pagamentos.set(providerPaymentId, snapshot);

      return success<PaymentLinkResult>({
        providerPaymentId,
        paymentUrl: `https://psp.fake/pay/${providerPaymentId}`,
        expiresAt,
      }, providerPaymentId);
    },

    async getPayment(_ctx: ProviderCtx, i) {
      const f = falha<PaymentSnapshot>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} nao encontrado` });
      }
      return success(snap, i.providerPaymentId);
    },

    async refund(ctx: ProviderCtx, i) {
      const f = falha<{ refundId: string; status: PaymentStatus }>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} nao encontrado` });
      }

      const refundId = `fake-refund-${ctx.idempotencyKey}`;
      const refundedSnap: PaymentSnapshot = {
        ...snap,
        status: i.amountCents !== undefined && i.amountCents < snap.amountCents
          ? 'partially_refunded' : 'refunded',
      };
      pagamentos.set(i.providerPaymentId, refundedSnap);

      return success({ refundId, status: refundedSnap.status }, refundId);
    },

    verifyWebhook(_raw: Buffer, _h) {
      return { valid: true };
    },

    async fetchSettlements(_ctx: ProviderCtx, _i) {
      const f = falha<Settlement[]>();
      if (f) return f;

      const settlements: Settlement[] = [];
      for (const [, snap] of pagamentos) {
        if (snap.status === 'approved' || snap.status === 'refunded') {
          settlements.push({
            providerPaymentId: snap.providerPaymentId,
            grossCents: snap.amountCents,
            netCents: Math.round(snap.amountCents * 0.97),
            feeCents: Math.round(snap.amountCents * 0.03),
            settledAt: agora(),
          });
        }
      }
      return success(settlements, 'fake-settlements');
    },
  };
}
```

- [ ] Criar o teste em `packages/integrations/src/fakes/payment-fake.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertSafetyDeclared } from '../conformance';
import { type ProviderCtx } from '../contracts/common';
import { createFakePaymentProvider } from './payment-fake';

function ctx(key: string): ProviderCtx {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actorUserId: '00000000-0000-0000-0000-000000000002',
    requestId: '00000000-0000-0000-0000-000000000003',
    idempotencyKey: key,
    deadlineMs: 5000,
  };
}

describe('PaymentProvider fake', () => {
  it('declara safety para todos os metodos', () => {
    const p = createFakePaymentProvider();
    expect(assertSafetyDeclared(p, [
      'createPaymentLink', 'getPayment', 'refund', 'fetchSettlements',
    ])).toBe(true);
  });

  it('cria link, consulta e estorna', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('link-1'), {
      amountCents: 25000,
      description: 'Consulta particular',
      expiresInMinutes: 30,
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.value.paymentUrl).toContain('fake-pay-link-1');

    const get = await p.getPayment(ctx('get-1'), {
      providerPaymentId: link.value.providerPaymentId,
    });
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.status).toBe('pending');
      expect(get.value.amountCents).toBe(25000);
    }

    const refund = await p.refund(ctx('refund-1'), {
      providerPaymentId: link.value.providerPaymentId,
      reason: 'paciente desistiu',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('refunded');
    }
  });

  it('modo indisponivel retorna unavailable com retrySafe', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const r = await p.createPaymentLink(ctx('indisp-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unavailable');
      expect(r.error.retrySafe).toBe(true);
    }
  });

  it('modo timeout retorna timeout sem retrySafe — ESTADO DESCONHECIDO', async () => {
    const p = createFakePaymentProvider({ modo: 'timeout' });
    const r = await p.createPaymentLink(ctx('timeout-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  it('health retorna up=false quando indisponivel', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });

  it('verifyWebhook do fake sempre retorna valido', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), {})).toEqual({ valid: true });
  });

  it('estorno parcial marca como partially_refunded', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('partial-1'), {
      amountCents: 25000,
      description: 'Consulta',
      expiresInMinutes: 30,
    });
    if (!link.ok) return;

    const refund = await p.refund(ctx('partial-ref-1'), {
      providerPaymentId: link.value.providerPaymentId,
      amountCents: 10000,
      reason: 'estorno parcial',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('partially_refunded');
    }
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/fakes/payment-fake.test.ts
```

Saida esperada: 7 testes passando.

- [ ] Atualizar o barrel `packages/integrations/src/index.ts` para exportar o contrato e o fake:

```ts
export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
export {
  type PrescriberSession, type PrescriptionItem, type PrescriptionProvider,
  type PrescriptionRecord,
} from './contracts/prescription';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
export {
  type PaymentLinkInput, type PaymentLinkResult, type PaymentProvider,
  type PaymentSnapshot, type PaymentStatus, type Settlement,
} from './contracts/payment';
export {
  createFakePaymentProvider, type FakePaymentOptions,
} from './fakes/payment-fake';
```

- [ ] Rodar todos os testes de unidade do integrations para garantir que nada quebrou:

```bash
pnpm vitest run packages/integrations/src/
```

Saida esperada: todos os testes passando.

---

### Task 28: domain logic — recordPayment, cancelPayment, refundPayment

**Arquivos**

- Criar `packages/payments/src/record-payment.ts`
- Criar `packages/payments/src/record-payment.int.test.ts`
- Criar `packages/payments/src/test-support.ts`
- Modificar `packages/payments/src/index.ts`

**Passos**

- [ ] Criar o suporte de teste em `packages/payments/src/test-support.ts`:

```ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementePagamento {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  appointmentId: string;
  categoryId: string;
  paymentMethodDinheiroId: string;
  paymentMethodPixId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearPagamento(): Promise<SementePagamento> {
  const s: SementePagamento = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), appointmentId: uuidv7(),
    categoryId: uuidv7(),
    paymentMethodDinheiroId: uuidv7(), paymentMethodPixId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Pagamento', '12ABC34501DE35')`,
      [s.tenantId, `p-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Pag')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Pagamento', 'completo')`,
      [s.tenantId, s.patientId]);

    // Procedimento e agendamento para vincular ao pagamento
    const procedureId = uuidv7();
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, procedureId]);
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-10-15T14:00:00Z', '2026-10-15T14:30:00Z', '2026-10-15',
               'atendendo', $7)`,
      [s.appointmentId, s.tenantId, s.patientId, s.professionalId,
       s.clinicId, procedureId, s.userId]);

    // Categoria e metodos de pagamento
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta', 'receita')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro'),
              ($1, $3, 'pix', 'Pix')`,
      [s.tenantId, s.paymentMethodDinheiroId, s.paymentMethodPixId]);

    // Provisiona o contador de recibo
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
```

- [ ] Criar a logica de dominio em `packages/payments/src/record-payment.ts`:

```ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type PaymentFailure =
  | { kind: 'lancamento_nao_encontrado' }
  | { kind: 'metodo_nao_encontrado' }
  | { kind: 'ja_pago' }
  | { kind: 'ja_cancelado' }
  | { kind: 'ja_estornado' }
  | { kind: 'nao_pode_estornar'; status: string }
  | { kind: 'nao_pode_cancelar'; status: string };

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
}

export interface RecordedPayment {
  readonly entryId: string;
  readonly receiptId: string | null;
  readonly receiptNumber: number | null;
  readonly status: string;
}

/**
 * Registra pagamento no atendimento. Se paidNow=true, marca como pago e gera
 * recibo automaticamente. O recibo usa numero sequencial por tenant via
 * fin.receipt_counter. A geracao de PDF do recibo e injetada em L3 (via
 * callback), NAO importa documents diretamente — mesmo padrao de exportRecord.
 */
export async function recordPayment(
  tx: TxClient,
  i: RecordPaymentInput,
  generateReceiptPdf?: (entryId: string, receiptNumber: number) => Promise<string | null>,
): Promise<Result<RecordedPayment, PaymentFailure>> {
  // Valida que o metodo de pagamento existe
  const { rows: methodRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method WHERE id = $1`, [i.paymentMethodId]);
  if (methodRows.length === 0) return err({ kind: 'metodo_nao_encontrado' });

  const entryId = uuidv7();
  const status = i.paidNow ? 'pago' : 'pendente';

  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, patient_id, appointment_id,
        professional_id, clinic_id, description, amount_cents,
        payment_method_id, paid_at, due_date, status, external_ref,
        idempotency_key, created_by)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
             $5, $6, $7, $8, $9,
             CASE WHEN $10::boolean THEN clock_timestamp() ELSE NULL END,
             $11::date, $12::fin.entry_status, $13, $14, app.current_user_id())`,
    [entryId, i.categoryId ?? null, i.patientId ?? null, i.appointmentId ?? null,
     i.professionalId, i.clinicId, i.description, i.amountCents,
     i.paymentMethodId, i.paidNow, i.dueDate ?? null, status,
     i.externalRef ?? null, i.idempotencyKey]);

  await tx.query(
    `SELECT audit.log('PAYMENT_RECORD', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'payment_method', $3::text,
                                         'status', $4::text), $5)`,
    [entryId, i.amountCents, 'receita', status, i.clinicId]);

  let receiptId: string | null = null;
  let receiptNumber: number | null = null;

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
  }

  return ok({ entryId, receiptId, receiptNumber, status });
}

export interface CancelPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function cancelPayment(
  tx: TxClient,
  i: CancelPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status !== 'pendente') {
    return err({ kind: 'nao_pode_cancelar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'cancelado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_CANCEL', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'cancelado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'cancelado' });
}

export interface RefundPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function refundPayment(
  tx: TxClient,
  i: RefundPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status !== 'pago') {
    return err({ kind: 'nao_pode_estornar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'estornado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'estornado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'estornado' });
}
```

- [ ] Atualizar o barrel `packages/payments/src/index.ts`:

```ts
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
```

- [ ] Criar o teste de integracao em `packages/payments/src/record-payment.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment, cancelPayment, refundPayment } from './record-payment';
import { semearPagamento, type SementePagamento } from './test-support';

let s: SementePagamento;
let actor: Actor;

beforeAll(async () => {
  s = await semearPagamento();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('recordPayment — registra pagamento no atendimento', () => {
  it('registra pagamento em dinheiro com recibo automatico', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        categoryId: s.categoryId,
        description: 'Consulta particular',
        amountCents: 25000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `rec-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pago');
    expect(r.value.receiptId).not.toBeNull();
    expect(r.value.receiptNumber).toBe(1);
  });

  it('registra pagamento pendente sem recibo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Retorno',
        amountCents: 15000,
        paymentMethodId: s.paymentMethodPixId,
        paidNow: false,
        dueDate: '2026-11-01',
        idempotencyKey: `pend-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pendente');
    expect(r.value.receiptId).toBeNull();
    expect(r.value.receiptNumber).toBeNull();
  });

  it('recibo sequencial incrementa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Procedimento',
        amountCents: 50000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `seq-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.receiptNumber).toBe(2);
  });

  it('rejeita metodo de pagamento inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Teste',
        amountCents: 10000,
        paymentMethodId: uuidv7(),
        paidNow: false,
        idempotencyKey: `bad-method-${uuidv7()}`,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('metodo_nao_encontrado');
  });

  it('grava evento de auditoria PAYMENT_RECORD', async () => {
    const key = `audit-${uuidv7()}`;
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Auditoria',
        amountCents: 5000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: key,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'PAYMENT_RECORD' AND entity_id = $1`,
        [r.value.entryId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('cancelPayment — cancela lancamento pendente', () => {
  let pendingEntryId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Para cancelar',
        amountCents: 8000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: false,
        idempotencyKey: `cancel-${uuidv7()}`,
      }));
    if (r.ok) pendingEntryId = r.value.entryId;
  });

  it('cancela lancamento pendente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: pendingEntryId, reason: 'paciente desistiu' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('cancelado');
  });

  it('recusa cancelar lancamento ja cancelado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: pendingEntryId, reason: 'tentativa dupla' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_cancelado');
  });

  it('recusa cancelar lancamento pago — deve estornar', async () => {
    const paid = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Pago para cancelar',
        amountCents: 12000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `paid-cancel-${uuidv7()}`,
      }));
    if (!paid.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: paid.value.entryId, reason: 'teste' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nao_pode_cancelar');
  });
});

describe('refundPayment — estorna lancamento pago', () => {
  let paidEntryId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Para estornar',
        amountCents: 20000,
        paymentMethodId: s.paymentMethodPixId,
        paidNow: true,
        idempotencyKey: `refund-${uuidv7()}`,
      }));
    if (r.ok) paidEntryId = r.value.entryId;
  });

  it('estorna lancamento pago', async () => {
    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paidEntryId, reason: 'cobranca indevida' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('estornado');
  });

  it('recusa estornar lancamento ja estornado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paidEntryId, reason: 'tentativa dupla' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_estornado');
  });

  it('recusa estornar lancamento pendente', async () => {
    const pendR = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Pendente para estornar',
        amountCents: 7000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: false,
        idempotencyKey: `refund-pend-${uuidv7()}`,
      }));
    if (!pendR.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: pendR.value.entryId, reason: 'teste' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nao_pode_estornar');
  });

  it('grava evento de auditoria PAYMENT_REFUND', async () => {
    const paid = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Estorno auditoria',
        amountCents: 3000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `refund-audit-${uuidv7()}`,
      }));
    if (!paid.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paid.value.entryId, reason: 'auditoria' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'PAYMENT_REFUND' AND entity_id = $1`,
        [paid.value.entryId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar os testes de integracao:

```bash
pnpm vitest run packages/payments/src/record-payment.int.test.ts
```

Saida esperada: 12 testes passando.

---

### Task 29: rollup noturno — job de materializacao e detector de divergencia

**Arquivos**

- Criar `packages/payments/src/rollup.ts`
- Criar `packages/payments/src/rollup.int.test.ts`
- Modificar `packages/payments/src/index.ts`

**Passos**

- [ ] Criar a logica de rollup em `packages/payments/src/rollup.ts`:

```ts
import type { TxClient } from '@cadencia/db';

/**
 * §3.7 — materializa o daily_rollup para um tenant e um dia. O job noturno
 * chama esta funcao para cada tenant ativo. Usa DELETE + INSERT para garantir
 * consistencia: o rollup e pequeno (~240 linhas/mes por clinica) e o custo e
 * irrelevante comparado a complexidade de um UPSERT correto com PK composta
 * de 6 colunas.
 *
 * IMPORTANTE: esta funcao roda com o papel `jobs` (BYPASSRLS) e NAO usa
 * withTenantTx. Ela recebe o pool administrativo diretamente.
 */
export async function materializeRollup(
  tx: TxClient,
  tenantId: string,
  day: string,
): Promise<{ competencia: number; caixa: number }> {
  // Limpa o dia para recalcular
  await tx.query(
    `DELETE FROM fin.daily_rollup WHERE tenant_id = $1 AND day = $2::date`,
    [tenantId, day]);

  // Base competencia: agregado pelo created_at do lancamento
  const { rowCount: compRows } = await tx.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id, $2::date, 'competencia', e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000'),
       e.status::text, sum(e.amount_cents), count(*)::int
     FROM fin.entry e
     WHERE e.tenant_id = $1
       AND e.created_at::date = $2::date
     GROUP BY e.tenant_id, e.clinic_id, e.kind, e.category_id, e.status`,
    [tenantId, day]);

  // Base caixa: agregado pelo paid_at do lancamento (so os pagos)
  const { rowCount: caixaRows } = await tx.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id, $2::date, 'caixa', e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000'),
       e.status::text, sum(e.amount_cents), count(*)::int
     FROM fin.entry e
     WHERE e.tenant_id = $1
       AND e.paid_at IS NOT NULL
       AND e.paid_at::date = $2::date
     GROUP BY e.tenant_id, e.clinic_id, e.kind, e.category_id, e.status`,
    [tenantId, day]);

  return { competencia: compRows ?? 0, caixa: caixaRows ?? 0 };
}

export interface DivergenceRow {
  readonly clinicId: string;
  readonly day: string;
  readonly basis: string;
  readonly kind: string;
  readonly categoryId: string;
  readonly status: string;
  readonly rollupCents: number;
  readonly liveCents: number;
  readonly rollupEntries: number;
  readonly liveEntries: number;
}

/**
 * Detector de divergencia obrigatorio (§3.7). Compara o rollup materializado
 * com a agregacao ao vivo dos lancamentos. Roda como job noturno apos a
 * materializacao. Qualquer linha retornada indica divergencia que precisa de
 * investigacao. A data da ultima verificacao e exibida no painel.
 */
export async function detectDivergence(
  tx: TxClient,
  tenantId: string,
  day: string,
): Promise<DivergenceRow[]> {
  const { rows } = await tx.query<{
    clinic_id: string; day: string; basis: string; kind: string;
    category_id: string; status: string;
    rollup_cents: string; live_cents: string;
    rollup_entries: number; live_entries: number;
  }>(
    `WITH live_comp AS (
       SELECT e.clinic_id, e.kind::text AS kind,
              coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
              e.status::text AS status,
              sum(e.amount_cents) AS amount_cents, count(*)::int AS entries
         FROM fin.entry e
        WHERE e.tenant_id = $1 AND e.created_at::date = $2::date
        GROUP BY e.clinic_id, e.kind, e.category_id, e.status
     ), live_caixa AS (
       SELECT e.clinic_id, e.kind::text AS kind,
              coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
              e.status::text AS status,
              sum(e.amount_cents) AS amount_cents, count(*)::int AS entries
         FROM fin.entry e
        WHERE e.tenant_id = $1 AND e.paid_at IS NOT NULL AND e.paid_at::date = $2::date
        GROUP BY e.clinic_id, e.kind, e.category_id, e.status
     ), live_all AS (
       SELECT clinic_id, 'competencia' AS basis, kind, category_id, status, amount_cents, entries
         FROM live_comp
       UNION ALL
       SELECT clinic_id, 'caixa' AS basis, kind, category_id, status, amount_cents, entries
         FROM live_caixa
     )
     SELECT coalesce(r.clinic_id, l.clinic_id)::text AS clinic_id,
            $2::text AS day,
            coalesce(r.basis, l.basis) AS basis,
            coalesce(r.kind::text, l.kind) AS kind,
            coalesce(r.category_id, l.category_id)::text AS category_id,
            coalesce(r.status, l.status) AS status,
            coalesce(r.amount_cents, 0)::text AS rollup_cents,
            coalesce(l.amount_cents, 0)::text AS live_cents,
            coalesce(r.entries, 0) AS rollup_entries,
            coalesce(l.entries, 0) AS live_entries
       FROM fin.daily_rollup r
       FULL OUTER JOIN live_all l
         ON r.tenant_id = $1
        AND r.day = $2::date
        AND r.clinic_id = l.clinic_id
        AND r.basis = l.basis
        AND r.kind::text = l.kind
        AND r.category_id = l.category_id
        AND r.status = l.status
      WHERE (r.tenant_id = $1 OR r.tenant_id IS NULL)
        AND (coalesce(r.amount_cents, 0) != coalesce(l.amount_cents, 0)
          OR coalesce(r.entries, 0) != coalesce(l.entries, 0))`,
    [tenantId, day]);

  return rows.map((r) => ({
    clinicId: r.clinic_id,
    day: r.day,
    basis: r.basis,
    kind: r.kind,
    categoryId: r.category_id,
    status: r.status,
    rollupCents: Number(r.rollup_cents),
    liveCents: Number(r.live_cents),
    rollupEntries: r.rollup_entries,
    liveEntries: r.live_entries,
  }));
}
```

- [ ] Atualizar o barrel `packages/payments/src/index.ts`:

```ts
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
export {
  materializeRollup, detectDivergence,
  type DivergenceRow,
} from './rollup';
```

- [ ] Criar o teste de integracao em `packages/payments/src/rollup.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment } from './record-payment';
import { materializeRollup, detectDivergence } from './rollup';
import { semearPagamento, type SementePagamento } from './test-support';

let s: SementePagamento;
let actor: Actor;
let adminPool: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

beforeAll(async () => {
  s = await semearPagamento();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
  adminPool = new Pool({ connectionString: adminUrl(), max: 1 });

  // Registra dois pagamentos para o dia 2026-10-15 (data do appointment semeado)
  await withTenantTx(actor, (tx) =>
    recordPayment(tx, {
      patientId: s.patientId,
      appointmentId: s.appointmentId,
      professionalId: s.professionalId,
      clinicId: s.clinicId,
      categoryId: s.categoryId,
      description: 'Consulta rollup 1',
      amountCents: 25000,
      paymentMethodId: s.paymentMethodDinheiroId,
      paidNow: true,
      idempotencyKey: `rollup-1-${uuidv7()}`,
    }));

  await withTenantTx(actor, (tx) =>
    recordPayment(tx, {
      professionalId: s.professionalId,
      clinicId: s.clinicId,
      categoryId: s.categoryId,
      description: 'Consulta rollup 2',
      amountCents: 15000,
      paymentMethodId: s.paymentMethodPixId,
      paidNow: true,
      idempotencyKey: `rollup-2-${uuidv7()}`,
    }));
});

afterAll(async () => {
  await adminPool.end();
  await closePools();
});

describe('materializeRollup — job noturno', () => {
  it('materializa rollup com as duas bases para o dia', async () => {
    // O job noturno roda com o papel `jobs` (BYPASSRLS).
    // Simulamos com a conexao administrativa.
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      // Descobre o dia dos lancamentos
      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      const result = await materializeRollup(tx as never, s.tenantId, day);
      expect(result.competencia).toBeGreaterThan(0);
      expect(result.caixa).toBeGreaterThan(0);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('detector de divergencia retorna vazio apos materializacao correta', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      // Materializa primeiro
      await materializeRollup(tx as never, s.tenantId, day);

      // Detecta divergencia — deve estar vazio
      const divs = await detectDivergence(tx as never, s.tenantId, day);
      expect(divs).toEqual([]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('detector de divergencia pega rollup desatualizado', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      // Materializa
      await materializeRollup(tx as never, s.tenantId, day);

      // Insere um lancamento extra sem rematerializar
      await client.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_at)
         VALUES ($1, $2, 'receita', $3, $4, $5,
                 'Extra nao materializado', 9900, $6, clock_timestamp(), 'pago',
                 $7, $8::date::timestamptz)`,
        [s.tenantId, uuidv7(), s.categoryId, s.professionalId, s.clinicId,
         s.paymentMethodDinheiroId, `extra-${uuidv7()}`, day]);

      // Detecta divergencia — deve encontrar
      const divs = await detectDivergence(tx as never, s.tenantId, day);
      expect(divs.length).toBeGreaterThan(0);

      await client.query('ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
});
```

- [ ] Rodar os testes de integracao:

```bash
pnpm vitest run packages/payments/src/rollup.int.test.ts
```

Saida esperada: 3 testes passando.

- [ ] Rodar todos os testes do pacote payments:

```bash
pnpm vitest run packages/payments/src/
```

Saida esperada: todos os testes passando (schema + record-payment + rollup).

- [ ] Rodar a suite de isolamento final:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas `fin.*` passam nos testes de RLS e FK composta.
