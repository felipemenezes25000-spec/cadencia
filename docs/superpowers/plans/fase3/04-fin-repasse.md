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
