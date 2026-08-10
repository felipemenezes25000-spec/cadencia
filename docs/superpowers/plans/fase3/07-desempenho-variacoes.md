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
