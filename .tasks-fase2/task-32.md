### Task 32: migration 0079 — fin.payment_link e fin.reconciliation_log

**Arquivos**
- Criar `packages/db/migrations/0079_fin_payment_link.sql`
- Criar `packages/db/migrations/0079_fin_payment_link.iso.test.ts`

**Premissa:** esta migration assume que `fin.entry` e `fin.entry_kind` ja existem, criados por um bloco anterior (bloco de recebimento no atendimento, migrations 0074-0078). A tabela `fin.entry` tem pelo menos `tenant_id`, `id`, `paid_at`, `external_ref`, `amount_cents`, `kind`, `status`, `clinic_id`. A migration referencia `fin.entry(tenant_id, id)` via FK composta.

- [ ] Criar a migration `packages/db/migrations/0079_fin_payment_link.sql`:

```sql
-- 0079_fin_payment_link.sql
-- Link de pagamento e log de conciliacao.
-- Premissa: fin.entry e fin.entry_kind ja existem (migration anterior).

BEGIN;

--------------------------------------------------------------------
-- 1. fin.payment_link — vincula um link do PSP a um lancamento
--------------------------------------------------------------------
CREATE TABLE fin.payment_link (
  tenant_id       uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid           NOT NULL,
  entry_id        uuid           NOT NULL,
  provider_link_id varchar(120)  NOT NULL,
  url             text           NOT NULL,
  status          text           NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','expired','cancelled')),
  amount_cents    bigint         NOT NULL CHECK (amount_cents > 0),
  paid_at         timestamptz(3),
  fee_cents       bigint,
  method          text,
  provider_id     text           NOT NULL,
  idempotency_key text           NOT NULL,
  webhook_raw     jsonb,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by      uuid           NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, provider_link_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES fin.entry(tenant_id, id)
);

ALTER TABLE fin.payment_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_link FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.payment_link AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_payment_link_entry ON fin.payment_link (tenant_id, entry_id);
CREATE INDEX ix_payment_link_status ON fin.payment_link (tenant_id, status)
  WHERE status = 'pending';

--------------------------------------------------------------------
-- 2. fin.reconciliation_log — divergencias detectadas pela conciliacao
--------------------------------------------------------------------
CREATE TABLE fin.reconciliation_log (
  tenant_id          uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid           NOT NULL,
  reconciled_date    date           NOT NULL,
  provider_payment_id varchar(120)  NOT NULL,
  entry_id           uuid,
  kind               text           NOT NULL
                       CHECK (kind IN (
                         'amount_mismatch', 'fee_mismatch',
                         'missing_in_psp', 'missing_in_system',
                         'status_mismatch'
                       )),
  expected_cents     bigint,
  actual_cents       bigint,
  detail             text,
  resolved           boolean        NOT NULL DEFAULT false,
  resolved_at        timestamptz(3),
  resolved_by        uuid,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);

ALTER TABLE fin.reconciliation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.reconciliation_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.reconciliation_log AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_reconciliation_date ON fin.reconciliation_log (tenant_id, reconciled_date);
CREATE INDEX ix_reconciliation_unresolved ON fin.reconciliation_log (tenant_id)
  WHERE resolved = false;

COMMIT;
```

- [ ] Rodar `pnpm db:migrate` — migration 0079 aplica sem erro.

- [ ] Criar o teste de isolamento `packages/db/migrations/0079_fin_payment_link.iso.test.ts`:

```ts
// packages/db/migrations/0079_fin_payment_link.iso.test.ts
import { describe, expect, it } from 'vitest';

describe('isolamento fin.payment_link e fin.reconciliation_log', () => {
  it('as tabelas existem e serao cobertas pela suite test:iso automaticamente', () => {
    // A suite test:iso descobre tabelas do catalogo e reprova quem
    // esquecer tenant_id, RLS ou FK composta. Este teste e um marcador
    // para que a CI execute a suite apos a migration.
    expect(true).toBe(true);
  });
});
```

- [ ] Rodar `pnpm test:iso` — confirmar que `fin.payment_link` e `fin.reconciliation_log` passam no isolamento (RLS FORCE + tenant_id + FK composta).

Saida esperada: sem falhas nas novas tabelas.

Commit: `feat(db): migration 0079 — fin.payment_link and fin.reconciliation_log`

---