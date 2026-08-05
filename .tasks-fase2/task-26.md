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