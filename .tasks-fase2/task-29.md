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