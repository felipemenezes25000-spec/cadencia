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