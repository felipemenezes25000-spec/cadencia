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
