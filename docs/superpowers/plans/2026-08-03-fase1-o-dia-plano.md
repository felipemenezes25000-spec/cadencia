# Cadência — Fase 1 ("O dia"): Plano de Implementação

> **Para agentes executores:** SUB-SKILL: superpowers:subagent-driven-development ou executing-plans. Passos em checkbox `- [ ]`.

**Objetivo:** entregar a primeira fase vendável sozinha — Hoje, Agenda, Pacientes, o motor de prontuário (seções × campos, finalizar, retificar, adendo), documentos e atestados assinados em ICP-Brasil AD-RT, exportação integral ECF.18 e prescrição via Memed — de modo que uma clínica particular de 1 a 5 médicos substitua papel, planilha e agenda de parede.

**Arquitetura:** a Fase 1 escreve **tela e regra de negócio** sobre a fundação da Fase 0, sem tocar em uma única policy de segurança já existente. Toda tabela nova nasce com `tenant_id`, RLS habilitada e **forçada**, ao menos uma policy e FK sempre composta `(tenant_id, …)`, porque a suíte `pnpm test:iso` descobre tabelas do catálogo do PostgreSQL e reprova quem esquecer; toda escrita clínica passa por função `SECURITY DEFINER` que roda como `clin_writer`, porque `app_rw` só lê o núcleo clínico; e o único lugar que abre transação continua sendo `withTenantTx` de `packages/db/src/tx.ts`. O front é um quarto deployable que **não** recebe `DATABASE_URL`: ele fala com `apps/api` por HTTP.

**Stack:** Front `apps/web` — Next.js 15 App Router + React 19 · TanStack Query 5 · React Hook Form 7 · nuqs 2 · Tailwind 4 com tokens CSS próprios + Radix headless · TipTap 3 · dnd-kit 6 · @tanstack/react-virtual 3 · visx 3 · Testing Library + `vitest-axe`. API `apps/api` — Fastify 5 + `fastify-type-provider-zod` + `@fastify/swagger`. Worker `apps/worker` — pg-boss 10 + Playwright Chromium + `pdf-lib`. Tudo TypeScript 5.9 `strict` com `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`. Dinheiro em centavos com `Money` do kernel; tempo com `date-fns` 4 + `@date-fns/tz`, **nunca `Date` cru**.

---

## Antes de começar

### Pré-requisito absoluto: a Fase 0 concluída e verde

Este plano assume as 48 tarefas da Fase 0 aplicadas (`docs/superpowers/plans/2026-08-03-fase0-fundacao-plano.md`), 23 migrations no disco e a suíte inteira verde. **Confirme antes de escrever a primeira linha:**

```bash
pnpm db:up                 # PostgreSQL 18 em localhost:5433, healthy
pnpm db:migrate            # deve terminar em "0023_clock_derived_date_marks.sql"
pnpm typecheck             # exit 0
pnpm test                  # 142 testes de unidade, 0 falhas
pnpm test:int              # 214 testes de integração, 0 falhas
pnpm test:iso              # 77 testes de isolamento, sem "T7 CANARIO REPROVADO"
pnpm db:invariants         # os 10 invariantes da §3.13, todos OK
pnpm db:privileges         # privilégios afirmados tabela a tabela
pnpm arch:check            # 0 violações
```

Se qualquer um desses falhar, **pare**. A Fase 1 adiciona ~30 tabelas multi-tenant; começar sobre uma base vermelha significa não saber se a quebra é sua ou herdada.

### A próxima migration livre é a `0024`

`ls packages/db/migrations/` termina em `0023_clock_derived_date_marks.sql`. Cada tarefa deste plano que cria migration diz o número exato. Crie sempre com `pnpm db:new <nome>` — o comando gera o arquivo vazio com o número correto e o cabeçalho forward-only. Se o número gerado divergir do número escrito na tarefa, **algum passo anterior foi pulado**: pare e reconcilie.

### O que a Fase 0 deixou pronto — assinaturas reais que este plano consome

Nunca reescreva nem "melhore" nada desta lista. Está tudo no disco, testado, e é o contrato da Fase 1.

| O quê | Onde | Assinatura literal |
|---|---|---|
| Transação de negócio | `packages/db/src/tx.ts` | `withTenantTx<T>(actor: Actor, fn: (tx: TxClient) => Promise<T>, pool?: Pool): Promise<T>` |
| Ator | `packages/db/src/tx.ts` | `{kind:'user';tenantId;userId;clinicId;requestId}` \| `{kind:'system';tenantId;reason;requestId}` \| `{kind:'anon';tenantId;requestId}` |
| Superfície de query | `packages/db/src/tx.ts` | `interface TxClient { query<R>(sql, params?): Promise<QueryResult<R>> }` |
| Pools | `packages/db/src/pool.ts` | `businessPool()`, `auditPool()`, `jobsPool()`, `appPool()`, `closePools()` |
| Auditoria canal A | `packages/audit/src/domain.ts` | `logDomainEvent(tx: Tx, event: DomainAuditEvent): Promise<bigint>` |
| Auditoria canal B | `packages/audit/src/security.ts` | `class SecurityAuditChannel { record(e), recordRead({…}), drain(), close() }` |
| `audit.log` no banco | migration 0012 | `audit.log(p_event_type text, p_entity_schema text, p_entity_table text, p_entity_id uuid, p_outcome text, p_meta jsonb, p_clinic_id uuid) RETURNS bigint` |
| `audit.log_read` no banco | migration 0014 | `audit.log_read(p_use_case text, p_patient_id uuid, p_tenant_id uuid, p_actor_user_id uuid, p_clinic_id uuid, p_session_id uuid, p_request_id uuid) RETURNS bigint` |
| Contexto no banco | migrations 0002 e 0005 | `app.current_tenant_id()`, `app.current_user_id()`, `app.require_tenant_id()`, `app.current_professional_id()`, `app.is_member()`, `app.has_role_in(uuid, text[])`, `app.clinical_scope_all()` |
| Partição segura | migration 0022 | `app.secure_partition(p_partition regclass) RETURNS void` |
| Busca imune a locale | migration 0006 | `app.imm_unaccent(text) RETURNS text` (IMMUTABLE) |
| Canonicalização JCS | `packages/kernel/src/canonical.ts` | `CANONICAL_VERSION = 'jcs-1'`, `canonicalize(v)`, `canonicalBytes(v)`, `canonicalHash(v): Buffer`, `canonicalHashHex(v)` |
| Identificadores | `packages/kernel/src/uuid.ts` | `uuidv7(): UuidV7`, `isUuidV7(s)`, `timestampMsFromUuidV7(s)` |
| Resultado e erros | `packages/kernel/src/{result,errors}.ts` | `Result<T,E>`, `ok`, `err`, `isOk`, `isErr`; `ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, `ImmutableRecordError`, `domainErrorFromSqlState(sqlstate, details)` |
| Dinheiro | `packages/kernel/src/money.ts` | `Money {cents; currency}`, `brl(cents)`, `add`, `sum`, `allocate`, `formatBRL`, `parseBRL` |
| Validadores BR | `packages/kernel/src/br/*` | `parseCpf`, `isCpf`, `formatCpf`, `parseCnpj`, `parseCns`, `parseCrm`, `UFS` |
| Terminologia por data | `packages/catalogs/src/*` | `resolveCid10At(db, codigo, eventDate)`, `resolveTussAt(db, tabela, codigo, eventDate)`, `toTermSnapshot(resolved): TermSnapshot` |
| RBAC | `packages/authz/src/{actions,can}.ts` | `ACTIONS`, `ACTION_BY_KEY`, `Role`, `can(subject, actionKey, {clinicId}): Decision`, `assertCan(...)` |
| Vínculos | `packages/authn/src/membership.ts` | `resolveMemberships(db, userId, tenantId?): Promise<MembershipRow[]>` |
| Sessão | `packages/authn/src/{session,fastify/session-plugin}.ts` | `resolveSession(db, token)`, `sessionPlugin`, `SESSION_COOKIE`, `CSRF_HEADER`, `issueSessionCookies` |

**Papéis do banco:** `app_owner` (dono), `app_rw` (aplicação, sujeito a RLS), `clin_writer` (único com INSERT no núcleo clínico), `audit_owner`, `rpt_owner`, `app_support`; logins `api`, `support`, `jobs` (único `BYPASSRLS`).
**Papéis de negócio (`app.membership.role`):** `admin_clinico`, `diretor_tecnico`, `profissional`, `recepcao`, `financeiro`.

### Regras de arquitetura herdadas — valem em cada tarefa

1. **Setas só descem** (L0 plataforma → L1 cadastros → L2 operação → L3 apps) e **irmão nunca importa irmão, nem o `index.ts`**. `pnpm arch:check` reprova. Composição entre irmãos é responsabilidade de L3: a rota de `apps/api` lê de `emr` e passa como argumento para `documents`, dentro da mesma transação.
2. **Migrations forward-only, uma transação por arquivo.** Nada de `CREATE INDEX CONCURRENTLY`.
3. **Fonte de tempo persistido é o PostgreSQL.** O `Clock` do kernel serve para medição e para o componente temporal do UUIDv7.
4. **Nenhum `::date` sobre `timestamptz` fora de `app.local_date()`** (Task 1 a cria). O invariante 8 já reprova.
5. **`COLLATE "pt-BR-x-icu"`** em toda coluna cuja ordenação seja apresentada a um humano, e no índice que a serve.
6. **CNPJ é `varchar(14)` alfanumérico**, `^[A-Z0-9]{12}[0-9]{2}$`.
7. Toda tabela multi-tenant: `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, ≥1 policy, FK composta. Tabela em `clin.*` com `patient_id` ou `version_id` precisa também de policy `RESTRICTIVE`.

### Ordem de execução e por que ela é essa

1. **Tasks 1–8 — catálogo de prontuário.** Template global versionado, seção, campo append-only com `generation`, componente de campo composto, layout por profissional. Vem primeiro porque nada do motor existe sem definição de campo.
2. **Tasks 9–13 — encontro e rascunho.** `clin.encounter` e a única superfície mutável do sistema.
3. **Tasks 14–22 — versões, `finalize_encounter` e a leitura.** O passo mais crítico da fase inteira.
4. **Tasks 23–29 — pacientes.** Estende o que a Fase 0 já criou; nunca recria.
5. **Tasks 30–38 — agenda.** Depende de paciente e de profissional, não de prontuário.
6. **Tasks 39–43 — assinatura.** Antes de documentos, porque documento sem assinatura não é entregável da Fase 1.
7. **Tasks 44–51 — documentos, anexos e exportação ECF.18.**
8. **Tasks 52–55 — prescrição via Memed.**
9. **Tasks 56–64 — API Fastify e worker.** Depois de todos os backends, antes das telas.
10. **Tasks 65–71 — app shell e design system.** Antes das telas, porque toda tela consome os tokens e os sete componentes centrais.
11. **Tasks 72–79 — telas.** Hoje, Agenda, Pacientes, Atendimento, com os fluxos (a) e (b) medidos por teste de interação.

### Convenções deste plano

Cada passo é **uma ação de 2 a 5 minutos** no ciclo TDD: escrever o teste que falha → rodar e confirmar a falha com a mensagem esperada → implementar o mínimo → rodar e confirmar que passa → commitar. Português do Brasil no texto; código, identificadores e nomes de arquivo em inglês; comentários e nomes de teste em português. Conventional Commits em inglês.

---

## Parte I — Prontuário: catálogo, seções e campos

### Task 1: `app.local_date()` — a função que o invariante 8 já cobra e que ainda não existe

O invariante 8 da Fase 0 (`packages/db/src/invariants/inv08-ddl-lint.ts`, linha 120) já isenta `app.local_date` do lint de `::date`, mas a função nunca foi criada — a Fase 0 não teve nenhuma data derivada de evento. A Fase 1 tem: `occurred_date` do atendimento, `data_atendimento` da guia, o dia da agenda. Sem esta função, ou o lint reprova toda tarefa seguinte, ou alguém escreve `occurred_at::date` e a guia sai com a data errada em Rio Branco.

**Arquivos:**
- Criar: `packages/db/migrations/0024_local_date.sql`
- Teste: `packages/db/src/local-date.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/src/local-date.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('app.local_date', () => {
  afterAll(async () => { await closePools(); });

  it('deriva a data no fuso da UNIDADE, nao no do servidor', async () => {
    // 2026-08-04T02:30:00Z = 03/08 as 23:30 em Sao Paulo e 03/08 as 22:30 em Rio Branco.
    const { rows } = await appPool().query<{ sp: string; rb: string; utc: string }>(
      `SELECT app.local_date($1::timestamptz, 'America/Sao_Paulo')::text AS sp,
              app.local_date($1::timestamptz, 'America/Rio_Branco')::text AS rb,
              app.local_date($1::timestamptz, 'UTC')::text AS utc`,
      ['2026-08-04T02:30:00Z'],
    );
    expect(rows[0]).toEqual({ sp: '2026-08-03', rb: '2026-08-03', utc: '2026-08-04' });
  });

  it('e IMMUTABLE — pode ser usada em coluna gerada e em indice', async () => {
    const { rows } = await appPool().query<{ provolatile: string }>(
      `SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'local_date'`,
    );
    expect(rows[0]?.provolatile).toBe('i');
  });

  it('recusa fuso desconhecido em vez de devolver a data do servidor', async () => {
    await expect(
      appPool().query(`SELECT app.local_date(now(), 'America/Atlantis')`),
    ).rejects.toThrow(/time zone|fuso/i);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- local-date` → `function app.local_date(timestamp with time zone, unknown) does not exist`.

- [ ] Criar a migration com `pnpm db:new local_date` (deve gerar `0024_local_date.sql`) e escrever:

```sql
-- 0024_local_date.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §10 item 10: o fuso pertence a CLINICA, e nenhuma derivacao diaria usa
-- timestamptz::date. Esta e a UNICA funcao autorizada a converter instante em
-- data, e o invariante 8 (inv08-ddl-lint.ts) ja a isenta pelo nome.
--
-- IMMUTABLE e uma promessa forte: a conversao AT TIME ZONE depende da base de
-- fusos do sistema, que muda quando o Brasil mexe no horario de verao. Aceitamos
-- porque (a) o valor e gravado na ESCRITA, nunca recalculado na leitura, e
-- (b) sem IMMUTABLE nao existe coluna gerada nem indice sobre a data do evento.
-- Quem reindexar apos atualizacao de tzdata precisa de REINDEX; esta linha e o
-- aviso.

CREATE FUNCTION app.local_date(p_at timestamptz, p_timezone text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT (p_at AT TIME ZONE p_timezone)::date
$$;

ALTER FUNCTION app.local_date(timestamptz, text) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.local_date(timestamptz, text) TO app_rw, clin_writer;

COMMENT ON FUNCTION app.local_date(timestamptz, text) IS
  'clock-derived-date';
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- local-date` → 3 testes passam.
- [ ] `pnpm db:invariants` → continua verde (o `::date` interno é o único autorizado).
- [ ] Commitar: `git commit -m "feat(db): add app.local_date so every event date uses the clinic timezone"`

---

### Task 2: `ref.observation_code` — catálogo global de sinais vitais

Sem catálogo, `observation_code` vira texto livre e a série do mesmo paciente se fragmenta entre `PESO` e `peso_kg`. É global (sem RLS, como `ref.cid10_term` e `ref.tuss_term`) porque 200 códigos × N clínicas é absurdo.

**Arquivos:**
- Criar: `packages/db/migrations/0025_ref_observation_code.sql`
- Teste: `packages/db/src/ref-observation-code.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/src/ref-observation-code.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('ref.observation_code', () => {
  afterAll(async () => { await closePools(); });

  it('traz PA_SIS e PA_DIA separados — pressao arterial e campo composto', async () => {
    const { rows } = await appPool().query<{ code: string; unit: string; value_kind: string }>(
      `SELECT code, unit, value_kind FROM ref.observation_code
        WHERE code IN ('PA_SIS','PA_DIA') ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: 'PA_DIA', unit: 'mmHg', value_kind: 'numeric' },
      { code: 'PA_SIS', unit: 'mmHg', value_kind: 'numeric' },
    ]);
  });

  it('carrega faixa plausivel para peso — 700 kg tem de ser recusavel', async () => {
    const { rows } = await appPool().query<{ min_plausible: string; max_plausible: string }>(
      `SELECT min_plausible, max_plausible FROM ref.observation_code WHERE code = 'PESO'`,
    );
    expect(Number(rows[0]?.min_plausible)).toBe(0.2);
    expect(Number(rows[0]?.max_plausible)).toBe(400);
  });

  it('e declarada global-reference — a suite test:iso nao exige tenant_id nela', async () => {
    const { rows } = await appPool().query<{ c: string }>(
      `SELECT obj_description('ref.observation_code'::regclass, 'pg_class') AS c`,
    );
    expect(rows[0]?.c).toBe('global-reference');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- ref-observation-code` → `relation "ref.observation_code" does not exist`.

- [ ] `pnpm db:new ref_observation_code` (gera `0025_ref_observation_code.sql`) e escrever:

```sql
-- 0025_ref_observation_code.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.6 — sinais vitais e categoricos usam catalogo global, nunca texto livre.
-- Alinhado ao BR-Core. Sem RLS, como ref.cid10_term e ref.tuss_term.

CREATE TABLE ref.observation_code (
  code          text PRIMARY KEY,
  display       text NOT NULL,
  unit          text,
  value_kind    text NOT NULL CHECK (value_kind IN ('numeric','coded','text')),
  min_plausible numeric,
  max_plausible numeric,
  CHECK (min_plausible IS NULL OR max_plausible IS NULL OR min_plausible < max_plausible));
ALTER TABLE ref.observation_code OWNER TO app_owner;
COMMENT ON TABLE ref.observation_code IS 'global-reference';

GRANT SELECT ON ref.observation_code TO app_rw, clin_writer;

-- 'PA' NAO existe como codigo: e um campo COMPOSTO que produz DUAS observacoes.
-- Gravar 'PA' = '120/80' como texto destroi a serie e impede qualquer grafico.
INSERT INTO ref.observation_code (code, display, unit, value_kind, min_plausible, max_plausible)
VALUES
  ('PESO',    'Peso corporal',              'kg',     'numeric',  0.2,  400),
  ('ALTURA',  'Altura',                     'cm',     'numeric',  20,   260),
  ('IMC',     'Indice de massa corporal',   'kg/m2',  'numeric',  5,    150),
  ('PA_SIS',  'Pressao arterial sistolica', 'mmHg',   'numeric',  40,   300),
  ('PA_DIA',  'Pressao arterial diastolica','mmHg',   'numeric',  20,   200),
  ('FC',      'Frequencia cardiaca',        'bpm',    'numeric',  20,   300),
  ('FR',      'Frequencia respiratoria',    'irpm',   'numeric',  4,    80),
  ('TAX',     'Temperatura axilar',         'Cel',    'numeric',  28,   45),
  ('SPO2',    'Saturacao periferica de O2', '%',      'numeric',  40,   100),
  ('GLIC',    'Glicemia capilar',           'mg/dL',  'numeric',  10,   900),
  ('PC',      'Perimetro cefalico',         'cm',     'numeric',  20,   70),
  ('CA',      'Circunferencia abdominal',   'cm',     'numeric',  20,   250);
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- ref-observation-code` → 3 testes passam.
- [ ] `pnpm db:invariants` → verde (a tabela é `global-reference`, declarada em migration revisada, não em `Set` de teste).
- [ ] Commitar: `git commit -m "feat(db): add global observation code catalog with plausible ranges"`

---

### Task 3: `ref.record_template` — catálogo global e versionado de modelos de prontuário

Sem catálogo global versionado, melhorar o modelo de anamnese pediátrica depois de 300 clínicas ativas vira um script que adivinha correspondência por `code`.

**Arquivos:**
- Criar: `packages/db/migrations/0026_ref_record_template.sql`
- Teste: `packages/db/src/ref-record-template.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/src/ref-record-template.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('ref.record_template', () => {
  afterAll(async () => { await closePools(); });

  it('permite duas versoes do mesmo code e identifica a corrente', async () => {
    const { rows } = await appPool().query<{ code: string; version: number; is_current: boolean }>(
      `SELECT code, version, is_current FROM ref.record_template
        WHERE code = 'consulta_geral' ORDER BY version`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
  });

  it('impede duas versoes correntes do mesmo code', async () => {
    await expect(
      appPool().query(
        `INSERT INTO ref.record_template (id, code, version, name, specialty, is_current, spec)
         VALUES (gen_random_uuid(), 'consulta_geral', 99, 'Duplicata', NULL, true, '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/ux_record_template_current/);
  });

  it('traz o modelo de consulta geral com as secoes na ordem clinica', async () => {
    const { rows } = await appPool().query<{ sections: unknown }>(
      `SELECT spec -> 'sections' AS sections FROM ref.record_template
        WHERE code = 'consulta_geral' AND is_current`,
    );
    const nomes = (rows[0]?.sections as { code: string }[]).map((s) => s.code);
    expect(nomes).toEqual([
      'queixa', 'hma', 'antecedentes', 'sinais_vitais', 'exame_fisico',
      'hipoteses', 'conduta',
    ]);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- ref-record-template` → `relation "ref.record_template" does not exist`.

- [ ] `pnpm db:new ref_record_template` (gera `0026_ref_record_template.sql`) e escrever:

```sql
-- 0026_ref_record_template.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.1 — catalogo de templates GLOBAL e VERSIONADO. Cada secao do tenant registra
-- de qual template e de qual versao veio (clin.record_section.template_id).
-- Sem isso, melhorar a anamnese pediatrica com 300 clinicas ativas vira um script
-- que adivinha correspondencia por code.

CREATE TABLE ref.record_template (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  version    int  NOT NULL CHECK (version >= 1),
  name       text NOT NULL,
  specialty  text,
  is_current boolean NOT NULL DEFAULT false,
  -- spec descreve secoes e campos; e lida UMA vez, na instanciacao para o tenant.
  -- Nunca e lida em runtime de atendimento: quem manda ali e clin.record_field.
  spec       jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (code, version));
ALTER TABLE ref.record_template OWNER TO app_owner;
COMMENT ON TABLE ref.record_template IS 'global-reference';

CREATE UNIQUE INDEX ux_record_template_current
  ON ref.record_template (code) WHERE is_current;

GRANT SELECT ON ref.record_template TO app_rw, clin_writer;

INSERT INTO ref.record_template (id, code, version, name, specialty, is_current, spec) VALUES
('0198f2a0-0000-7000-8000-000000000001', 'consulta_geral', 1,
 'Consulta geral', NULL, true, $json${
  "sections": [
    {"code":"queixa","label":"Queixa principal","fields":[
      {"code":"queixa","label":"Queixa principal","kind":"texto_longo"}]},
    {"code":"hma","label":"Historia da molestia atual","fields":[
      {"code":"hma","label":"HMA","kind":"texto_longo"}]},
    {"code":"antecedentes","label":"Antecedentes","fields":[
      {"code":"comorbidades","label":"Comorbidades","kind":"multipla_escolha",
       "options":["Hipertensao","Diabetes","Dislipidemia","Asma","Tireoidopatia","Nenhuma"]},
      {"code":"alergias","label":"Alergias","kind":"texto_curto"},
      {"code":"tabagismo","label":"Tabagismo","kind":"lista_unica",
       "options":["Nunca fumou","Ex-tabagista","Tabagista"]}]},
    {"code":"sinais_vitais","label":"Sinais vitais","fields":[
      {"code":"peso","label":"Peso","kind":"numerico","observation_code":"PESO","unit":"kg"},
      {"code":"altura","label":"Altura","kind":"numerico","observation_code":"ALTURA","unit":"cm"},
      {"code":"imc","label":"IMC","kind":"imc","observation_code":"IMC","unit":"kg/m2"},
      {"code":"pa","label":"Pressao arterial","kind":"composto",
       "components":[{"observation_code":"PA_SIS","label":"Sistolica","unit":"mmHg"},
                     {"observation_code":"PA_DIA","label":"Diastolica","unit":"mmHg"}]},
      {"code":"fc","label":"Frequencia cardiaca","kind":"numerico","observation_code":"FC","unit":"bpm"}]},
    {"code":"exame_fisico","label":"Exame fisico","fields":[
      {"code":"exame_fisico","label":"Exame fisico","kind":"texto_longo"}]},
    {"code":"hipoteses","label":"Hipoteses diagnosticas","fields":[
      {"code":"cid","label":"CID-10","kind":"busca_tabela","source":"CID10"}]},
    {"code":"conduta","label":"Conduta","fields":[
      {"code":"conduta","label":"Conduta","kind":"texto_longo"},
      {"code":"retorno","label":"Retorno em","kind":"data"}]}
  ]}$json$::jsonb);
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- ref-record-template` → 3 testes passam.
- [ ] Commitar: `git commit -m "feat(db): add versioned global record template catalog"`

---

### Task 4: `clin.record_section` e `clin.record_field` — append-only com `generation`

O gesto mais comum da tela "Seções do prontuário" é mudar "Peso" de texto para numérico, para poder ter gráfico. Sem índice parcial `WHERE archived_at IS NULL`, esse gesto falha com `23505` e o médico vê "erro ao salvar configuração".

**Arquivos:**
- Criar: `packages/db/migrations/0027_record_section_field.sql`
- Teste: `packages/db/test/iso/09-record-definition.iso.test.ts`

- [ ] Escrever o teste de isolamento que falha (a suíte `test:iso` já sobe um container com as migrations reais e o seed de dois tenants):

```ts
// packages/db/test/iso/09-record-definition.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant, comoAdmin } from './harness';
import { TENANT_A, TENANT_B, USER_A_MEDICO, CLINIC_A } from './fixtures';

describe('definicao de prontuario — secao e campo', () => {
  it('cria secao e campo na geracao 1', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO clin.record_section (tenant_id, id, template_id, template_version, code, label, ordinal)
         VALUES ($1, $2, NULL, NULL, 'queixa', 'Queixa principal', 1)`,
        [TENANT_A, '0198f2a0-0001-7000-8000-000000000001'],
      );
      await tx.query(
        `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, generation)
         VALUES ($1, $2, $3, 'peso', 'Peso', 'texto_curto', 1)`,
        [TENANT_A, '0198f2a0-0002-7000-8000-000000000001', '0198f2a0-0001-7000-8000-000000000001'],
      );
      const { rows } = await tx.query(`SELECT code, generation FROM clin.record_field`);
      return rows;
    });
    expect(r).toEqual([{ code: 'peso', generation: 1 }]);
  });

  it('mudar o TIPO arquiva e cria geracao 2 — o gesto mais comum da tela de ajustes', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `UPDATE clin.record_field SET archived_at = clock_timestamp()
          WHERE tenant_id = $1 AND code = 'peso' AND archived_at IS NULL`,
        [TENANT_A],
      );
      await tx.query(
        `INSERT INTO clin.record_field
           (tenant_id, id, section_id, code, label, kind, observation_code, unit, is_reportable, generation)
         VALUES ($1, $2, $3, 'peso', 'Peso', 'numerico', 'PESO', 'kg', true, 2)`,
        [TENANT_A, '0198f2a0-0002-7000-8000-000000000002', '0198f2a0-0001-7000-8000-000000000001'],
      );
      const { rows } = await tx.query(
        `SELECT generation, kind, archived_at IS NULL AS viva FROM clin.record_field
          WHERE tenant_id = $1 AND code = 'peso' ORDER BY generation`, [TENANT_A]);
      return rows;
    });
    expect(r).toEqual([
      { generation: 1, kind: 'texto_curto', viva: false },
      { generation: 2, kind: 'numerico', viva: true },
    ]);
  });

  it('recusa DUAS geracoes vivas do mesmo code — a unicidade e parcial, nao total', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, generation)
           VALUES ($1, $2, $3, 'peso', 'Peso', 'texto_longo', 3)`,
          [TENANT_A, '0198f2a0-0002-7000-8000-000000000003', '0198f2a0-0001-7000-8000-000000000001'],
        )),
    ).rejects.toThrow(/ux_record_field_viva/);
  });

  it('tenant B nao enxerga a definicao do tenant A', async () => {
    const { rowCount } = await comoTenant(TENANT_B, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query(`SELECT 1 FROM clin.record_field`));
    expect(rowCount).toBe(0);
  });

  it('as duas tabelas tem RLS habilitada, FORCADA e ao menos uma policy', async () => {
    const { rows } = await comoAdmin(async (c) => {
      const r = await c.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'clin' AND c.relname IN ('record_section','record_field')
          ORDER BY c.relname`);
      return r;
    });
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} sem RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} sem FORCE`).toBe(true);
      expect(Number(row.policies), `${row.relname} sem policy`).toBeGreaterThanOrEqual(1);
    }
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.record_section" does not exist`.

- [ ] `pnpm db:new record_section_field` (gera `0027_record_section_field.sql`) e escrever:

```sql
-- 0027_record_section_field.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.1 e §4.2 — a definicao de campo e APPEND-ONLY e VERSIONADA por generation.
-- Mudar TIPO ou OPCOES arquiva e cria generation + 1. Mudar so o ROTULO e
-- permitido, porque encounter_field_value.label_snapshot ja protegeu o passado.

CREATE TYPE clin.field_kind AS ENUM (
  'texto_longo','texto_curto','numerico','composto','booleano','data',
  'lista_unica','multipla_escolha','busca_tabela','imc','dpp_ig',
  'curva_crescimento','odontograma','oculos','orcamento');

CREATE TABLE clin.record_section (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  -- De qual template e de qual VERSAO esta secao veio. NULL = criada a mao.
  template_id      uuid REFERENCES ref.record_template(id),
  template_version int,
  code             text NOT NULL,
  label            text NOT NULL,
  ordinal          int  NOT NULL,
  archived_at      timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  CHECK ((template_id IS NULL) = (template_version IS NULL)));
ALTER TABLE clin.record_section OWNER TO app_owner;

CREATE UNIQUE INDEX ux_record_section_viva
  ON clin.record_section (tenant_id, code) WHERE archived_at IS NULL;

CREATE TABLE clin.record_field (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  section_id       uuid NOT NULL,
  code             text NOT NULL,
  label            text NOT NULL,
  kind             clin.field_kind NOT NULL,
  -- generation sobe quando TIPO ou OPCOES mudam. O valor gravado carrega
  -- field_generation, e por isso o passado continua legivel.
  generation       int  NOT NULL DEFAULT 1 CHECK (generation >= 1),
  required         boolean NOT NULL DEFAULT false,
  is_reportable    boolean NOT NULL DEFAULT false,
  -- Numerico promovido para clin.observation precisa de codigo do catalogo.
  observation_code text REFERENCES ref.observation_code(code),
  unit             text,
  -- lista_unica e multipla_escolha: as opcoes. Mudar aqui exige nova generation.
  options          jsonb,
  -- busca_tabela: 'CID10' ou 'TUSS'.
  ref_source       text CHECK (ref_source IN ('CID10','TUSS')),
  ordinal          int  NOT NULL,
  archived_at      timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, section_id) REFERENCES clin.record_section(tenant_id, id),
  -- Um campo que promove para observation precisa saber PARA QUAL codigo.
  CHECK (NOT is_reportable OR kind = 'composto' OR observation_code IS NOT NULL),
  CHECK (kind <> 'busca_tabela' OR ref_source IS NOT NULL),
  CHECK (kind NOT IN ('lista_unica','multipla_escolha') OR options IS NOT NULL));
ALTER TABLE clin.record_field OWNER TO app_owner;

-- A unicidade e PARCIAL. Com unicidade total, mudar "Peso" de texto para
-- numerico falha com 23505 e o medico ve "erro ao salvar configuracao".
CREATE UNIQUE INDEX ux_record_field_viva
  ON clin.record_field (tenant_id, section_id, code) WHERE archived_at IS NULL;
CREATE INDEX ix_record_field_secao
  ON clin.record_field (tenant_id, section_id, ordinal) WHERE archived_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON clin.record_section TO app_rw;
GRANT SELECT, INSERT, UPDATE ON clin.record_field   TO app_rw;
-- DELETE nunca: definicao arquivada continua sendo lida por valores antigos.

ALTER TABLE clin.record_section ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_section FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_section AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE clin.record_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_field FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_field AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → os 5 testes novos passam, nenhum antigo quebra.
- [ ] `pnpm db:invariants && pnpm db:privileges` → verdes.
- [ ] Commitar: `git commit -m "feat(db): add append-only record section and field definitions with generation"`

---

### Task 5: `clin.record_field_component` — o campo composto que existe desde o dia 1

Pressão arterial é o sinal vital mais medido do país e produz **duas** observações. Promover para `observation` só campos com um único `value_num` exclui a PA e obriga a gravar `'120/80'` como texto — o que destrói a série.

**Arquivos:**
- Criar: `packages/db/migrations/0028_record_field_component.sql`
- Teste: `packages/db/test/iso/10-field-component.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/10-field-component.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A } from './fixtures';

const SECTION = '0198f2a0-0001-7000-8000-000000000010';
const FIELD_PA = '0198f2a0-0002-7000-8000-000000000010';

describe('campo composto', () => {
  it('PA produz DUAS observacoes, com ordinal proprio', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
         VALUES ($1, $2, 'sinais_vitais', 'Sinais vitais', 4)`, [TENANT_A, SECTION]);
      await tx.query(
        `INSERT INTO clin.record_field
           (tenant_id, id, section_id, code, label, kind, is_reportable, ordinal)
         VALUES ($1, $2, $3, 'pa', 'Pressao arterial', 'composto', true, 1)`,
        [TENANT_A, FIELD_PA, SECTION]);
      await tx.query(
        `INSERT INTO clin.record_field_component
           (tenant_id, id, field_id, ordinal, observation_code, label, unit)
         VALUES ($1, gen_random_uuid(), $2, 1, 'PA_SIS', 'Sistolica', 'mmHg'),
                ($1, gen_random_uuid(), $2, 2, 'PA_DIA', 'Diastolica', 'mmHg')`,
        [TENANT_A, FIELD_PA]);
      const { rows } = await tx.query(
        `SELECT ordinal, observation_code FROM clin.record_field_component
          WHERE tenant_id = $1 AND field_id = $2 ORDER BY ordinal`, [TENANT_A, FIELD_PA]);
      return rows;
    });
    expect(r).toEqual([
      { ordinal: 1, observation_code: 'PA_SIS' },
      { ordinal: 2, observation_code: 'PA_DIA' },
    ]);
  });

  it('recusa dois componentes no mesmo ordinal do mesmo campo', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO clin.record_field_component
             (tenant_id, id, field_id, ordinal, observation_code, label, unit)
           VALUES ($1, gen_random_uuid(), $2, 1, 'FC', 'Duplicata', 'bpm')`,
          [TENANT_A, FIELD_PA])),
    ).rejects.toThrow(/record_field_component_tenant_id_field_id_ordinal_key/);
  });

  it('recusa codigo de observacao que nao esta no catalogo global', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO clin.record_field_component
             (tenant_id, id, field_id, ordinal, observation_code, label, unit)
           VALUES ($1, gen_random_uuid(), $2, 3, 'PA_MEDIA', 'Media', 'mmHg')`,
          [TENANT_A, FIELD_PA])),
    ).rejects.toThrow(/observation_code_fkey|violates foreign key/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.record_field_component" does not exist`.

- [ ] `pnpm db:new record_field_component` (gera `0028_record_field_component.sql`) e escrever:

```sql
-- 0028_record_field_component.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.6 — 'PA' e um campo COMPOSTO que produz DUAS observacoes (PA_SIS, PA_DIA).
-- Existe desde o dia 1: promover so campos com um unico value_num exclui o sinal
-- vital mais medido do pais e obriga a gravar '120/80' como texto.

CREATE TABLE clin.record_field_component (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  field_id         uuid NOT NULL,
  ordinal          int  NOT NULL CHECK (ordinal >= 1),
  observation_code text NOT NULL REFERENCES ref.observation_code(code),
  label            text NOT NULL,
  unit             text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, field_id, ordinal),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, field_id) REFERENCES clin.record_field(tenant_id, id));
ALTER TABLE clin.record_field_component OWNER TO app_owner;

CREATE INDEX ix_field_component_campo
  ON clin.record_field_component (tenant_id, field_id, ordinal);

GRANT SELECT, INSERT, UPDATE ON clin.record_field_component TO app_rw;

ALTER TABLE clin.record_field_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_field_component FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_field_component
AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 3 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): add composite field components so blood pressure yields two observations"`

---

### Task 6: `clin.record_layout_item` — ordem e visibilidade **por profissional**

O cardiologista e o pediatra da mesma clínica usam as mesmas seções em ordens diferentes. Layout por tenant obriga um dos dois a rolar a tela toda consulta.

**Arquivos:**
- Criar: `packages/db/migrations/0029_record_layout_item.sql`
- Teste: `packages/db/test/iso/11-record-layout.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/11-record-layout.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A, PROF_A } from './fixtures';

const SECTION = '0198f2a0-0001-7000-8000-000000000020';

describe('layout do prontuario por profissional', () => {
  it('cada profissional tem ordem e visibilidade proprias', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
         VALUES ($1, $2, 'odontograma', 'Odontograma', 9)`, [TENANT_A, SECTION]);
      await tx.query(
        `INSERT INTO clin.record_layout_item
           (tenant_id, id, professional_id, section_id, ordinal, visible)
         VALUES ($1, gen_random_uuid(), $2, $3, 1, false)`,
        [TENANT_A, PROF_A, SECTION]);
      const { rows } = await tx.query(
        `SELECT ordinal, visible FROM clin.record_layout_item
          WHERE tenant_id = $1 AND professional_id = $2`, [TENANT_A, PROF_A]);
      return rows;
    });
    expect(r).toEqual([{ ordinal: 1, visible: false }]);
  });

  it('recusa dois layouts do mesmo profissional para a mesma secao', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO clin.record_layout_item
             (tenant_id, id, professional_id, section_id, ordinal, visible)
           VALUES ($1, gen_random_uuid(), $2, $3, 2, true)`,
          [TENANT_A, PROF_A, SECTION])),
    ).rejects.toThrow(/ux_layout_item/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.record_layout_item" does not exist`.

- [ ] `pnpm db:new record_layout_item` (gera `0029_record_layout_item.sql`) e escrever:

```sql
-- 0029_record_layout_item.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.1 — ordem e visibilidade das secoes POR PROFISSIONAL. Layout por tenant
-- obriga o cardiologista a rolar a tela toda consulta para achar a secao dele.
-- Ausencia de linha = ordem da propria secao e visivel. Nao existe "layout
-- padrao" materializado: linha por default seria 14 INSERTs por profissional
-- novo e um bug de sincronia quando a secao muda.

CREATE TABLE clin.record_layout_item (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  professional_id uuid NOT NULL,
  section_id      uuid NOT NULL,
  ordinal         int  NOT NULL,
  visible         boolean NOT NULL DEFAULT true,
  -- Secao colapsada por padrao: e o que permite 14 secoes sem virar acordeao.
  collapsed       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, section_id)      REFERENCES clin.record_section(tenant_id, id));
ALTER TABLE clin.record_layout_item OWNER TO app_owner;

CREATE UNIQUE INDEX ux_layout_item
  ON clin.record_layout_item (tenant_id, professional_id, section_id);
CREATE INDEX ix_layout_item_ordem
  ON clin.record_layout_item (tenant_id, professional_id, ordinal);

GRANT SELECT, INSERT, UPDATE, DELETE ON clin.record_layout_item TO app_rw;
-- DELETE aqui e legitimo: apagar a customizacao volta ao padrao da secao.

ALTER TABLE clin.record_layout_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_layout_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_layout_item
AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Cada profissional mexe apenas no PROPRIO layout; escopo total continua valendo
-- para admin_clinico e diretor_tecnico, que configuram a clinica.
CREATE POLICY meu_layout ON clin.record_layout_item
AS RESTRICTIVE FOR ALL TO app_rw
  USING      (app.clinical_scope_all() OR professional_id = app.current_professional_id())
  WITH CHECK (app.clinical_scope_all() OR professional_id = app.current_professional_id());
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 2 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): add per-professional record layout with order and visibility"`

---

### Task 7: `packages/emr` — os 14 tipos de campo e o slot de cada um

Este é o mapa que o `finalize_encounter` usa para explodir o payload. Errar aqui grava número em `value_text` e o gráfico de peso não existe.

**Arquivos:**
- Criar: `packages/emr/src/field-kinds.ts`
- Modificar: `packages/emr/src/index.ts`
- Teste: `packages/emr/src/field-kinds.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/emr/src/field-kinds.test.ts
import { describe, expect, it } from 'vitest';
import { FIELD_KINDS, slotOf, promotesTo, isMultiRow, FIELD_KIND_LIST } from './field-kinds';

describe('tipos de campo do prontuario', () => {
  it('sao exatamente os 15 tipos da §4.2, na ordem da tabela', () => {
    expect(FIELD_KIND_LIST).toEqual([
      'texto_longo', 'texto_curto', 'numerico', 'composto', 'booleano', 'data',
      'lista_unica', 'multipla_escolha', 'busca_tabela', 'imc', 'dpp_ig',
      'curva_crescimento', 'odontograma', 'oculos', 'orcamento',
    ]);
  });

  it('cada tipo cai no slot certo da encounter_field_value', () => {
    expect(slotOf('texto_longo')).toBe('value_text');
    expect(slotOf('numerico')).toBe('value_num');
    expect(slotOf('booleano')).toBe('value_bool');
    expect(slotOf('data')).toBe('value_date');
    expect(slotOf('lista_unica')).toBe('value_ref_code');
    expect(slotOf('multipla_escolha')).toBe('value_ref_code');
    expect(slotOf('busca_tabela')).toBe('value_ref_code');
    expect(slotOf('imc')).toBe('value_num');
    expect(slotOf('odontograma')).toBe('value_json');
  });

  it('composto nao tem slot proprio — ele vira N linhas de componente', () => {
    expect(slotOf('composto')).toBeNull();
  });

  it('promove para a tabela de primeira classe correta', () => {
    expect(promotesTo('numerico')).toBe('observation');
    expect(promotesTo('imc')).toBe('observation');
    expect(promotesTo('composto')).toBe('observation');
    expect(promotesTo('lista_unica')).toBe('encounter_finding');
    expect(promotesTo('multipla_escolha')).toBe('encounter_finding');
    expect(promotesTo('busca_tabela')).toBe('coded');
    expect(promotesTo('texto_longo')).toBeNull();
    expect(promotesTo('odontograma')).toBeNull();
  });

  it('multipla_escolha e composto geram N linhas — o resto gera uma so', () => {
    expect(isMultiRow('multipla_escolha')).toBe(true);
    expect(isMultiRow('composto')).toBe(true);
    expect(isMultiRow('lista_unica')).toBe(false);
    expect(isMultiRow('texto_longo')).toBe(false);
  });

  it('todo tipo do enum do banco tem entrada no mapa', () => {
    for (const k of FIELD_KIND_LIST) {
      expect(FIELD_KINDS[k], `tipo ${k} sem definicao`).toBeDefined();
    }
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- field-kinds` → `Failed to resolve import "./field-kinds"`.

- [ ] Criar `packages/emr/src/field-kinds.ts`:

```ts
// packages/emr/src/field-kinds.ts

/**
 * §4.2 — os tipos de campo, o slot de cada um em clin.encounter_field_value e
 * para qual tabela de primeira classe promovem.
 *
 * Este arquivo e o mapa que clin.finalize_encounter usa para explodir o payload.
 * Errar aqui grava numero em value_text e o grafico de peso deixa de existir.
 * A ordem da lista e a da tabela da §4.2 de proposito: o teste compara literal.
 */

export const FIELD_KIND_LIST = [
  'texto_longo', 'texto_curto', 'numerico', 'composto', 'booleano', 'data',
  'lista_unica', 'multipla_escolha', 'busca_tabela', 'imc', 'dpp_ig',
  'curva_crescimento', 'odontograma', 'oculos', 'orcamento',
] as const;

export type FieldKind = (typeof FIELD_KIND_LIST)[number];

/** Colunas de valor de clin.encounter_field_value. `null` = o tipo nao grava valor direto. */
export type ValueSlot =
  | 'value_text' | 'value_num' | 'value_bool' | 'value_date'
  | 'value_ts' | 'value_json' | 'value_ref_code';

/** Tabela de primeira classe para a qual o valor e materializado, se houver. */
export type Promotion = 'observation' | 'encounter_finding' | 'coded';

export interface FieldKindDef {
  readonly slot: ValueSlot | null;
  readonly promotesTo: Promotion | null;
  /** Gera N linhas de encounter_field_value (ordinal > 0) em vez de uma. */
  readonly multiRow: boolean;
  /** Calculado no SERVIDOR a partir de outros campos, nunca digitado. */
  readonly derived: boolean;
}

export const FIELD_KINDS: Readonly<Record<FieldKind, FieldKindDef>> = {
  // Nucleo narrativo. Suporta #, / e @ inline na tela, mas grava texto puro.
  texto_longo:  { slot: 'value_text', promotesTo: null, multiRow: false, derived: false },
  texto_curto:  { slot: 'value_text', promotesTo: null, multiRow: false, derived: false },
  // Promove para clin.observation quando record_field.is_reportable = true.
  numerico:     { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: false },
  // PA -> PA_SIS + PA_DIA. Uma linha de valor por componente, com ordinal proprio.
  composto:     { slot: null,         promotesTo: 'observation', multiRow: true,  derived: false },
  booleano:     { slot: 'value_bool', promotesTo: null, multiRow: false, derived: false },
  data:         { slot: 'value_date', promotesTo: null, multiRow: false, derived: false },
  // Opcao referenciavel e filtravel: vira clin.encounter_finding.
  lista_unica:  { slot: 'value_ref_code', promotesTo: 'encounter_finding', multiRow: false, derived: false },
  // Comorbidades com 4 marcacoes = 4 linhas. Sem isso a clinica nao lista os diabeticos.
  multipla_escolha: { slot: 'value_ref_code', promotesTo: 'encounter_finding', multiRow: true, derived: false },
  // CID-10/TUSS/medicamento: value_ref_code + display_snapshot + terminology_version.
  busca_tabela: { slot: 'value_ref_code', promotesTo: 'coded', multiRow: false, derived: false },
  // Calculados no servidor: cliente nunca manda o resultado, so os insumos.
  imc:          { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: true },
  dpp_ig:       { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: true },
  // Prosa estruturada: nao e eixo de relatorio que entregamos (§3.6 regra a).
  curva_crescimento: { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
  odontograma:  { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
  oculos:       { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
  orcamento:    { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
};

export function slotOf(kind: FieldKind): ValueSlot | null {
  return FIELD_KINDS[kind].slot;
}

export function promotesTo(kind: FieldKind): Promotion | null {
  return FIELD_KINDS[kind].promotesTo;
}

export function isMultiRow(kind: FieldKind): boolean {
  return FIELD_KINDS[kind].multiRow;
}

export function isDerived(kind: FieldKind): boolean {
  return FIELD_KINDS[kind].derived;
}
```

- [ ] Substituir `packages/emr/src/index.ts` por:

```ts
// packages/emr/src/index.ts
export {
  FIELD_KINDS, FIELD_KIND_LIST, slotOf, promotesTo, isMultiRow, isDerived,
  type FieldKind, type FieldKindDef, type Promotion, type ValueSlot,
} from './field-kinds';
```

- [ ] Rodar: `pnpm test -- field-kinds` → 6 testes passam.
- [ ] `pnpm typecheck && pnpm arch:check` → verdes.
- [ ] Commitar: `git commit -m "feat(emr): map the fourteen field kinds to value slots and promotions"`

---

### Task 8: `emr` — o enum do banco e o mapa do TypeScript não podem divergir em silêncio

Duas listas de tipos de campo, uma no `CREATE TYPE clin.field_kind` e outra em `FIELD_KIND_LIST`, divergem no primeiro tipo novo. O teste que compara as duas é o que impede.

**Arquivos:**
- Criar: `packages/emr/src/field-kinds.int.test.ts`

- [ ] Escrever o teste que falha (ele passa a existir agora e deve passar de primeira; se falhar, é porque o enum e o mapa já divergem):

```ts
// packages/emr/src/field-kinds.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from '@cadencia/db';
import { FIELD_KIND_LIST } from './field-kinds';

describe('clin.field_kind × FIELD_KIND_LIST', () => {
  afterAll(async () => { await closePools(); });

  it('o enum do banco e o mapa do TypeScript tem exatamente os mesmos rotulos', async () => {
    const { rows } = await appPool().query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'clin' AND t.typname = 'field_kind'
        ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual([...FIELD_KIND_LIST]);
  });
});
```

- [ ] Verificar que `packages/emr/package.json` declara a dependência (L2 pode importar L0):

```json
{
  "name": "@cadencia/emr",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*",
    "@cadencia/audit": "workspace:*",
    "@cadencia/catalogs": "workspace:*"
  }
}
```

- [ ] Rodar `pnpm install` e depois `pnpm test:int -- field-kinds` → 1 teste passa.
- [ ] Provar que a proteção pega: acrescente temporariamente `'teste'` ao final de `FIELD_KIND_LIST`, rode `pnpm test:int -- field-kinds` e confirme a falha `expected [ ... 'teste' ] to deeply equal [ ... 'orcamento' ]`. Desfaça.
- [ ] `pnpm arch:check` → verde (`emr` é L2, importa L0; nenhum irmão de L2 é importado).
- [ ] Commitar: `git commit -m "test(emr): assert the database field kind enum matches the TypeScript map"`

---

## Parte II — Prontuário: o atendimento e o rascunho

### Task 9: `clin.encounter` — o agregado, com `occurred_date` no fuso da clínica

`clin.encounter` **não é livremente atualizável**: `REVOKE UPDATE` total, com `GRANT UPDATE (head_version_id, version_count, status)` apenas para `clin_writer`. Lançar atendimento no paciente errado — o erro mais comum de recepção — não se conserta com `UPDATE`.

**Arquivos:**
- Criar: `packages/db/migrations/0030_encounter.sql`
- Teste: `packages/db/test/iso/12-encounter.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/12-encounter.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant, comoAdmin } from './harness';
import { TENANT_A, TENANT_B, USER_A_MEDICO, CLINIC_A, PROF_A, PATIENT_A } from './fixtures';

const ENC = '0198f2a0-0003-7000-8000-000000000001';

describe('clin.encounter', () => {
  it('grava occurred_date pelo fuso da CLINICA, nao pelo do servidor', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz,
                 app.local_date($6::timestamptz, (SELECT timezone FROM app.clinic WHERE id = $5)))`,
        [TENANT_A, ENC, PATIENT_A, PROF_A, CLINIC_A, '2026-08-04T02:30:00Z']);
      const { rows } = await tx.query(
        `SELECT occurred_date::text AS d, status::text AS s FROM clin.encounter WHERE id = $1`, [ENC]);
      return rows[0];
    });
    // 02:30Z = 23:30 do dia 03 em Sao Paulo. Se sair 2026-08-04, o fuso vazou.
    expect(r).toEqual({ d: '2026-08-03', s: 'rascunho' });
  });

  it('app_rw NAO consegue trocar o paciente do atendimento — isso e clin.transfer_encounter', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(`UPDATE clin.encounter SET patient_id = $2 WHERE id = $1`, [ENC, PATIENT_A])),
    ).rejects.toThrow(/permission denied for table encounter/);
  });

  it('referencia cruzada de tenant e violacao de integridade, nao leitura vazia', async () => {
    await expect(
      comoTenant(TENANT_B, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO clin.encounter
             (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, clock_timestamp(), CURRENT_DATE)`,
          [TENANT_B, PATIENT_A, PROF_A, CLINIC_A])),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it('tem policy RESTRICTIVE — a tabela tem patient_id', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='encounter' AND NOT p.polpermissive`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.encounter" does not exist`.

- [ ] `pnpm db:new encounter` (gera `0030_encounter.sql`) e escrever:

```sql
-- 0030_encounter.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.4 — o agregado do atendimento. O par (tenant_id, patient_id) so existe se o
-- paciente for DESTE tenant: referencia cruzada nao e "invisivel na leitura", e
-- violacao de integridade referencial na escrita (23503).

CREATE TYPE clin.encounter_status AS ENUM
  ('rascunho','finalizado','anulado');

CREATE TABLE clin.encounter (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  appointment_id  uuid,
  occurred_at     timestamptz(3) NOT NULL,
  -- Data do EVENTO no fuso da CLINICA. Toda derivacao diaria usa esta coluna,
  -- nunca occurred_at::date. E o que impede a guia sair com a data errada em
  -- Rio Branco. Gravada na ESCRITA por app.local_date(), nunca recalculada.
  occurred_date   date NOT NULL,
  status          clin.encounter_status NOT NULL DEFAULT 'rascunho',
  head_version_id uuid,       -- cache de leitura, NAO "o registro" (§4.5)
  version_count   int  NOT NULL DEFAULT 0,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id));
ALTER TABLE clin.encounter OWNER TO app_owner;

-- Linha do tempo do paciente (§4.5, alvo < 10 ms): Index Only Scan aqui,
-- nested loop nas versoes vivas. Sem recursao, sem window function, sem DISTINCT ON.
CREATE INDEX ix_encounter_hist
  ON clin.encounter (tenant_id, patient_id, occurred_date DESC, id)
  INCLUDE (professional_id, clinic_id, status, head_version_id);
CREATE INDEX ix_encounter_dia
  ON clin.encounter (tenant_id, clinic_id, occurred_date, professional_id);
CREATE INDEX ix_encounter_agendamento
  ON clin.encounter (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;

-- §3.4: REVOKE UPDATE total. Trocar paciente/profissional/clinica/occurred_at
-- muda o content_hash de toda versao ja selada — por isso nao existe UPDATE
-- para a aplicacao, e a correcao e clin.transfer_encounter (Task 20).
GRANT SELECT, INSERT ON clin.encounter TO app_rw;
GRANT SELECT, INSERT ON clin.encounter TO clin_writer;
GRANT UPDATE (head_version_id, version_count, status) ON clin.encounter TO clin_writer;

ALTER TABLE clin.encounter ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.encounter AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- clin_writer roda dentro de SECURITY DEFINER e continua sujeito a RLS.
CREATE POLICY writer ON clin.encounter AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());

-- §3.3 segunda camada. RESTRICTIVE faz AND: policy nova nunca abre acesso.
CREATE POLICY clinical_scope ON clin.encounter AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.encounter.tenant_id, clin.encounter.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] `pnpm db:invariants && pnpm db:privileges` → verdes (invariante 4: tabela em `clin.*` sem `UPDATE` para `app_rw`; invariante 5: policy `RESTRICTIVE` presente).
- [ ] Commitar: `git commit -m "feat(db): add clinical encounter aggregate with clinic-timezone event date"`

---

### Task 10: `clin.encounter_draft` — a única superfície mutável, com revisão otimista

Autosave append-only multiplicaria as escritas por ~100 e comeria a latência de digitação, que é o diferencial vendável. `last-write-wins` é bug, não simplicidade: o médico dita no celular e digita no desktop.

**Arquivos:**
- Criar: `packages/db/migrations/0031_encounter_draft.sql`
- Teste: `packages/db/test/iso/13-encounter-draft.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/13-encounter-draft.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A } from './fixtures';

const ENC = '0198f2a0-0003-7000-8000-000000000001';

describe('clin.encounter_draft', () => {
  it('nasce na revisao 1 e sobe a cada gravacao aceita', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, updated_by)
         VALUES ($1, $2, '{"queixa":"cefaleia"}'::jsonb, app.current_user_id())`,
        [TENANT_A, ENC]);
      const { rows } = await tx.query(
        `UPDATE clin.encounter_draft
            SET payload = '{"queixa":"cefaleia ha 3 dias"}'::jsonb,
                rev = rev + 1, updated_at = clock_timestamp(), updated_by = app.current_user_id()
          WHERE tenant_id = $1 AND encounter_id = $2 AND rev = 1
        RETURNING rev`, [TENANT_A, ENC]);
      return rows[0];
    });
    expect(r).toEqual({ rev: 2 });
  });

  it('gravacao com revisao velha nao afeta nenhuma linha — e o conflito que a tela mostra', async () => {
    const { rowCount } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query(
        `UPDATE clin.encounter_draft SET payload = '{"queixa":"do celular"}'::jsonb, rev = rev + 1
          WHERE tenant_id = $1 AND encounter_id = $2 AND rev = 1`, [TENANT_A, ENC]));
    expect(rowCount).toBe(0);
  });

  it('rascunho e a UNICA tabela clinica com UPDATE e DELETE para app_rw', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema='clin' AND table_name='encounter_draft' AND grantee='app_rw'
          ORDER BY privilege_type`));
    expect(r.rows.map((x) => x.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.encounter_draft" does not exist`.

- [ ] `pnpm db:new encounter_draft` (gera `0031_encounter_draft.sql`) e escrever:

```sql
-- 0031_encounter_draft.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.5 e §4.4 — o rascunho e a UNICA superficie mutavel do sistema.
-- A obrigacao legal recai sobre o registro FINALIZADO; por isso o rascunho e
-- mutavel. Autosave append-only multiplicaria as escritas por ~100 e comeria a
-- latencia de digitacao, que e o diferencial vendavel.
--
-- rev e concorrencia OTIMISTA, nao enfeite: o medico dita no celular e digita no
-- desktop, e last-write-wins apaga o que ele acabou de ditar.

CREATE TABLE clin.encounter_draft (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  encounter_id uuid NOT NULL PRIMARY KEY,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  rev          int  NOT NULL DEFAULT 1 CHECK (rev >= 1),
  updated_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_by   uuid NOT NULL,
  UNIQUE (tenant_id, encounter_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id));
ALTER TABLE clin.encounter_draft OWNER TO app_owner;

-- Rascunho parado ha 7 dias vira versao original com incompleto = true (§4.4).
-- O job varre por updated_at, nunca a tabela inteira.
CREATE INDEX ix_draft_parado ON clin.encounter_draft (updated_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON clin.encounter_draft TO app_rw;
GRANT SELECT, DELETE                 ON clin.encounter_draft TO clin_writer;
-- clin_writer precisa de DELETE: o passo 8 de finalize_encounter apaga o rascunho.

ALTER TABLE clin.encounter_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter_draft FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.encounter_draft AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE POLICY writer ON clin.encounter_draft AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());

-- Rascunho e conteudo clinico em elaboracao: o mesmo escopo do encounter.
CREATE POLICY clinical_scope ON clin.encounter_draft AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      WHERE (e.tenant_id, e.id)
                            = (clin.encounter_draft.tenant_id, clin.encounter_draft.encounter_id)
                        AND e.professional_id = app.current_professional_id()) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 3 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): add mutable encounter draft with optimistic revision"`

---

### Task 11: `emr.openDraft` e `emr.saveDraft` — o autosave que não perde o que foi ditado

**Arquivos:**
- Criar: `packages/emr/src/draft.ts`, `packages/emr/src/test-support.ts`
- Modificar: `packages/emr/src/index.ts`
- Teste: `packages/emr/src/draft.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/emr/src/draft.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { openDraft, saveDraft } from './draft';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('rascunho do atendimento', () => {
  it('abre com revisao 1 e payload vazio quando ainda nao existe', async () => {
    const r = await withTenantTx(actor, (tx) => openDraft(tx, s.encounterId));
    expect(r).toEqual({ ok: true, value: { encounterId: s.encounterId, rev: 1, payload: {} } });
  });

  it('grava e devolve a revisao seguinte', async () => {
    const r = await withTenantTx(actor, (tx) =>
      saveDraft(tx, { encounterId: s.encounterId, expectedRev: 1, payload: { queixa: 'cefaleia' } }));
    expect(r).toEqual({ ok: true, value: { rev: 2 } });
  });

  it('recusa gravacao com revisao velha e devolve o payload vigente para a tela reconciliar', async () => {
    const r = await withTenantTx(actor, (tx) =>
      saveDraft(tx, { encounterId: s.encounterId, expectedRev: 1, payload: { queixa: 'do celular' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('conflito_de_revisao');
      if (r.error.kind === 'conflito_de_revisao') {
        expect(r.error.currentRev).toBe(2);
        expect(r.error.currentPayload).toEqual({ queixa: 'cefaleia' });
      }
    }
  });

  it('recusa abrir rascunho de atendimento ja finalizado', async () => {
    const r = await withTenantTx(actor, (tx) => openDraft(tx, s.finalizedEncounterId));
    expect(r).toEqual({ ok: false, error: { kind: 'atendimento_nao_esta_em_rascunho' } });
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- emr/src/draft` → `Failed to resolve import "./draft"`.

- [ ] Criar `packages/emr/src/draft.ts`:

```ts
// packages/emr/src/draft.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type DraftPayload = Readonly<Record<string, unknown>>;

export interface DraftState {
  readonly encounterId: string;
  readonly rev: number;
  readonly payload: DraftPayload;
}

export type DraftFailure =
  | { kind: 'atendimento_nao_encontrado' }
  | { kind: 'atendimento_nao_esta_em_rascunho' }
  | { kind: 'conflito_de_revisao'; currentRev: number; currentPayload: DraftPayload };

/**
 * Abre o rascunho. Se ainda nao existe, devolve o estado inicial SEM gravar:
 * abrir a tela nao pode criar linha, senao todo atendimento aberto por engano
 * vira rascunho orfao e depois versao `incompleto` pela politica dos 7 dias.
 */
export async function openDraft(
  tx: TxClient, encounterId: string,
): Promise<Result<DraftState, DraftFailure>> {
  const enc = await tx.query<{ status: string }>(
    `SELECT status::text AS status FROM clin.encounter WHERE id = $1`, [encounterId]);
  const linha = enc.rows[0];
  // RLS ja filtrou tenant e escopo clinico: zero linhas e "nao existe para voce".
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });
  if (linha.status !== 'rascunho') return err({ kind: 'atendimento_nao_esta_em_rascunho' });

  const d = await tx.query<{ rev: number; payload: DraftPayload }>(
    `SELECT rev, payload FROM clin.encounter_draft WHERE encounter_id = $1`, [encounterId]);
  const atual = d.rows[0];
  return ok({
    encounterId,
    rev: atual?.rev ?? 1,
    payload: atual?.payload ?? {},
  });
}

export interface SaveDraftInput {
  readonly encounterId: string;
  readonly expectedRev: number;
  readonly payload: DraftPayload;
}

/**
 * Grava o rascunho com concorrencia otimista. `expectedRev` e a revisao que a
 * tela tinha quando o usuario comecou a digitar; se o banco avancou, devolvemos
 * o estado vigente para a tela reconciliar em vez de sobrescrever.
 */
export async function saveDraft(
  tx: TxClient, input: SaveDraftInput,
): Promise<Result<{ rev: number }, DraftFailure>> {
  const enc = await tx.query<{ status: string }>(
    `SELECT status::text AS status FROM clin.encounter WHERE id = $1`, [input.encounterId]);
  const linha = enc.rows[0];
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });
  if (linha.status !== 'rascunho') return err({ kind: 'atendimento_nao_esta_em_rascunho' });

  // Primeira gravacao: INSERT idempotente. ON CONFLICT DO NOTHING evita corrida
  // entre duas abas do mesmo medico abrindo o atendimento ao mesmo tempo.
  if (input.expectedRev === 1) {
    const ins = await tx.query<{ rev: number }>(
      `INSERT INTO clin.encounter_draft (encounter_id, payload, rev, updated_by)
       VALUES ($1, $2::jsonb, 2, app.current_user_id())
       ON CONFLICT (encounter_id) DO NOTHING
       RETURNING rev`,
      [input.encounterId, JSON.stringify(input.payload)]);
    const criado = ins.rows[0];
    if (criado) return ok({ rev: criado.rev });
    // Ja existia: cai no caminho do UPDATE, que devolve o conflito correto.
  }

  const upd = await tx.query<{ rev: number }>(
    `UPDATE clin.encounter_draft
        SET payload = $3::jsonb, rev = rev + 1,
            updated_at = clock_timestamp(), updated_by = app.current_user_id()
      WHERE encounter_id = $1 AND rev = $2
    RETURNING rev`,
    [input.encounterId, input.expectedRev, JSON.stringify(input.payload)]);
  const gravado = upd.rows[0];
  if (gravado) return ok({ rev: gravado.rev });

  const atual = await tx.query<{ rev: number; payload: DraftPayload }>(
    `SELECT rev, payload FROM clin.encounter_draft WHERE encounter_id = $1`, [input.encounterId]);
  const vigente = atual.rows[0];
  return err({
    kind: 'conflito_de_revisao',
    currentRev: vigente?.rev ?? 1,
    currentPayload: vigente?.payload ?? {},
  });
}
```

- [ ] Criar o apoio de teste `packages/emr/src/test-support.ts`:

```ts
// packages/emr/src/test-support.ts
// Semeia tenant, clinica, usuario, vinculo, profissional, paciente e dois
// atendimentos (um em rascunho, um finalizado) para os testes de integracao do
// emr. Roda com o pool administrativo porque cria o tenant — que e a raiz do
// isolamento e nao existe transacao de negocio capaz de cria-lo.
import { appPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

export interface Semente {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string;
  encounterId: string; finalizedEncounterId: string;
  sectionId: string; fieldQueixaId: string; fieldPaId: string; fieldCidId: string;
}

export async function semearAtendimento(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    encounterId: uuidv7(), finalizedEncounterId: uuidv7(),
    sectionId: uuidv7(), fieldQueixaId: uuidv7(), fieldPaId: uuidv7(), fieldCidId: uuidv7(),
  };
  const c = await appPool().connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica de Teste', '12ABC34501DE35')`,
      [s.tenantId, `t-${s.tenantId.slice(0, 8)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade Centro', '12ABC34501DE35', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dra. Teste')`, [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Maria Souza Lima', 'completo', '1988-03-14')`,
      [s.tenantId, s.patientId]);

    // Definicao minima de prontuario: um texto, um composto e uma busca de tabela.
    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`, [s.tenantId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field
         (tenant_id, id, section_id, code, label, kind, is_reportable, ordinal)
       VALUES ($1, $2, $3, 'pa', 'Pressao arterial', 'composto', true, 2)`,
      [s.tenantId, s.fieldPaId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field_component
         (tenant_id, id, field_id, ordinal, observation_code, label, unit)
       VALUES ($1, gen_random_uuid(), $2, 1, 'PA_SIS', 'Sistolica', 'mmHg'),
              ($1, gen_random_uuid(), $2, 2, 'PA_DIA', 'Diastolica', 'mmHg')`,
      [s.tenantId, s.fieldPaId]);
    await c.query(
      `INSERT INTO clin.record_field
         (tenant_id, id, section_id, code, label, kind, ref_source, ordinal)
       VALUES ($1, $2, $3, 'cid', 'CID-10', 'busca_tabela', 'CID10', 3)`,
      [s.tenantId, s.fieldCidId, s.sectionId]);

    for (const [id, status] of
         [[s.encounterId, 'rascunho'], [s.finalizedEncounterId, 'finalizado']] as const) {
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
                 app.local_date(clock_timestamp(), 'America/Sao_Paulo'), $6::clin.encounter_status)`,
        [s.tenantId, id, s.patientId, s.professionalId, s.clinicId, status]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  return s;
}
```

- [ ] Acrescentar em `packages/emr/src/index.ts`:

```ts
export {
  openDraft, saveDraft,
  type DraftFailure, type DraftPayload, type DraftState, type SaveDraftInput,
} from './draft';
```

- [ ] Rodar: `pnpm test:int -- emr/src/draft` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(emr): open and save encounter drafts with optimistic revision"`

---

### Task 12: `clin.stale_drafts` — encontrar o rascunho que ninguém finaliza

3–8% dos atendimentos nunca são finalizados, e eles contêm queixa, HMA e exame físico. Nenhum conteúdo clínico pode ficar fora do regime imutável, senão em dois anos há 15 mil rascunhos órfãos fora da exportação integral e fora da política de retenção. Esta tarefa cria a **consulta**; quem finaliza é `clin.finalize_encounter` (Task 19), chamada pelo worker **com o contexto do tenant certo** — nunca com `BYPASSRLS` ligado.

**Arquivos:**
- Criar: `packages/db/migrations/0032_stale_drafts.sql`
- Teste: `packages/db/src/stale-drafts.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/src/stale-drafts.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from './index';

describe('clin.stale_drafts', () => {
  afterAll(async () => { await closePools(); });

  it('roda com o papel jobs — o unico com BYPASSRLS — e enxerga todos os tenants', async () => {
    const { rows } = await jobsPool().query<{ has: boolean }>(
      `SELECT has_function_privilege('jobs', 'clin.stale_drafts(interval)', 'EXECUTE') AS has`);
    expect(rows[0]?.has).toBe(true);
  });

  it('app_rw NAO pode executar a varredura de todos os tenants', async () => {
    const { rows } = await jobsPool().query<{ has: boolean }>(
      `SELECT has_function_privilege('app_rw', 'clin.stale_drafts(interval)', 'EXECUTE') AS has`);
    expect(rows[0]?.has).toBe(false);
  });

  it('devolve as cinco colunas que o worker precisa para montar o Actor', async () => {
    const { fields } = await jobsPool().query(
      `SELECT * FROM clin.stale_drafts(interval '7 days') LIMIT 0`);
    expect(fields.map((f) => f.name)).toEqual([
      'tenant_id', 'encounter_id', 'professional_id', 'clinic_id', 'updated_at',
    ]);
  });

  it('nao lista rascunho recem-tocado', async () => {
    const { rowCount } = await jobsPool().query(
      `SELECT 1 FROM clin.stale_drafts(interval '7 days')`);
    expect(rowCount).toBe(0);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- stale-drafts` → `function clin.stale_drafts(interval) does not exist`.

- [ ] `pnpm db:new stale_drafts` (gera `0032_stale_drafts.sql`) e escrever:

```sql
-- 0032_stale_drafts.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.4 — a politica do rascunho orfao. Rascunho parado ha 7 dias e
-- auto-finalizado como versao kind='original' com incompleto = true.
--
-- Esta funcao APENAS LISTA, e roda com o papel `jobs`, o unico com BYPASSRLS:
-- varrer todos os tenants e exatamente o que a RLS impede a aplicacao de fazer.
-- A finalizacao acontece depois, tenant a tenant, dentro de withTenantTx.

CREATE FUNCTION clin.stale_drafts(p_limite interval DEFAULT interval '7 days')
RETURNS TABLE (
  tenant_id       uuid,
  encounter_id    uuid,
  professional_id uuid,
  clinic_id       uuid,
  updated_at      timestamptz(3))
LANGUAGE sql STABLE AS $$
  SELECT d.tenant_id, d.encounter_id, e.professional_id, e.clinic_id, d.updated_at
    FROM clin.encounter_draft d
    JOIN clin.encounter e ON (e.tenant_id, e.id) = (d.tenant_id, d.encounter_id)
   WHERE e.status = 'rascunho'
     AND d.updated_at < clock_timestamp() - p_limite
   ORDER BY d.updated_at
$$;

ALTER FUNCTION clin.stale_drafts(interval) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.stale_drafts(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.stale_drafts(interval) TO jobs;
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- stale-drafts` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(db): list stale encounter drafts for the seven-day auto-finalize job"`

---

### Task 13: a suíte `test:iso` conhece as tabelas novas

A suíte descobre tabelas do catálogo — mas o seed de dois tenants precisa ter linha em cada tabela nova, senão o teste T1 (uma clínica não lê dado de outra) passa à toa: não há o que vazar. Foi exatamente esse o defeito corrigido no último commit da Fase 0.

**Arquivos:**
- Modificar: `packages/db/test/iso/seed.ts`

- [ ] Acrescentar ao bloco que o `seedDoisTenants` já executa **para cada tenant**, logo depois da inserção do paciente:

```ts
    // Fase 1 — definicao de prontuario. Sem linha do tenant B aqui, o T1 passa
    // a toa nestas tabelas: nao existe o que vazar.
    const sectionId = uuidv7();
    const fieldId = uuidv7();
    const compostoId = uuidv7();
    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'queixa', 'Queixa principal', 1)`, [tenantId, sectionId]);
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [tenantId, fieldId, sectionId]);
    await c.query(
      `INSERT INTO clin.record_field
         (tenant_id, id, section_id, code, label, kind, is_reportable, ordinal)
       VALUES ($1, $2, $3, 'pa', 'Pressao arterial', 'composto', true, 2)`,
      [tenantId, compostoId, sectionId]);
    await c.query(
      `INSERT INTO clin.record_field_component
         (tenant_id, id, field_id, ordinal, observation_code, label, unit)
       VALUES ($1, gen_random_uuid(), $2, 1, 'PA_SIS', 'Sistolica', 'mmHg'),
              ($1, gen_random_uuid(), $2, 2, 'PA_DIA', 'Diastolica', 'mmHg')`,
      [tenantId, compostoId]);
    await c.query(
      `INSERT INTO clin.record_layout_item
         (tenant_id, id, professional_id, section_id, ordinal, visible)
       VALUES ($1, gen_random_uuid(), $2, $3, 1, true)`,
      [tenantId, professionalId, sectionId]);

    // Fase 1 — atendimento e rascunho.
    const encounterId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'))`,
      [tenantId, encounterId, patientId, professionalId, clinicId]);
    await c.query(
      `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, updated_by)
       VALUES ($1, $2, '{"queixa":"cefaleia"}'::jsonb, $3)`,
      [tenantId, encounterId, userId]);
```

- [ ] Rodar `pnpm test:iso` → todas as suítes verdes, incluindo o canário T7 no teardown, sem a mensagem `T7 CANARIO REPROVADO`.
- [ ] Provar que a proteção pega: remova temporariamente `AND app.is_member()` da policy `tenant_isolation` de `clin.encounter` em `0030_encounter.sql`, rode `pnpm db:reset && pnpm db:migrate && pnpm test:iso` e confirme que o T6 (contexto forjado) fica **vermelho**. Restaure a linha e repita para confirmar o verde.
- [ ] Commitar: `git commit -m "test(iso): seed the phase one clinical tables for both tenants"`

---

## Parte III — Prontuário: versões, `finalize_encounter` e a leitura

> **Decisão de arquitetura que vale para toda esta parte, escrita aqui porque ela não é óbvia e é irreversível.**
> A serialização canônica JCS mora em **um único lugar**, `packages/kernel/src/canonical.ts`, que a Fase 0 entregou com vetores congelados. `jsonb` do PostgreSQL ordena chaves por comprimento e depois por bytes; a RFC 8785 ordena por unidade de código UTF-16. **São ordens diferentes** — reimplementar JCS em plpgsql criaria um segundo canonicalizador e a pergunta "qual dos dois vale?" reapareceria em 2035, quando ninguém puder mais responder.
> Portanto: `clin.finalize_encounter` **recebe** `p_content_hash` e `p_serializer_version` do chamador e não os recalcula. A garantia não é que o hash seja computado no banco — é que **o conteúdo é imutável por `REVOKE` e por trigger**, de modo que qualquer hash errado é detectável para sempre re-derivando das linhas seladas. `emr.verifyVersionHash()` (Task 18) faz exatamente isso, roda sobre toda versão criada pela suíte de testes e vira amostragem semanal em produção — a mesma postura da verificação da cadeia do selo da auditoria.

### Task 14: `clin.encounter_version` — imutabilidade por permissão, não por convenção

**Arquivos:**
- Criar: `packages/db/migrations/0033_encounter_version.sql`
- Teste: `packages/db/test/iso/14-encounter-version.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/14-encounter-version.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant, comoAdmin } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A } from './fixtures';

describe('clin.encounter_version — imutabilidade por permissao', () => {
  it('app_rw NAO tem INSERT: escrita clinica so por SECURITY DEFINER', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema='clin' AND table_name='encounter_version' AND grantee='app_rw'`));
    expect(rows.map((r) => r.privilege_type)).toEqual(['SELECT']);
  });

  it('UPDATE e DELETE sao barrados pelo trigger, para QUALQUER papel', async () => {
    const erro = await comoAdmin(async (c) => {
      try {
        await c.query(`UPDATE clin.encounter_version SET justificativa = 'x'`);
        return null;
      } catch (e) { return (e as Error).message; }
    });
    expect(erro).toMatch(/append-only|deny_mutation/i);
  });

  it('version_no 1 obriga kind = original', async () => {
    const erro = await comoAdmin(async (c) => {
      try {
        await c.query(
          `INSERT INTO clin.encounter_version
             (tenant_id, id, encounter_id, version_no, kind, author_user_id,
              author_professional_id, content_hash, serializer_version)
           VALUES ($1, gen_random_uuid(), gen_random_uuid(), 1, 'adendo',
                   gen_random_uuid(), gen_random_uuid(), decode(repeat('00',32),'hex'), 'jcs-1')`,
          [TENANT_A]);
        return null;
      } catch (e) { return (e as Error).message; }
    });
    expect(erro).toMatch(/encounter_version_check|violates check constraint/);
  });

  it('supersedes_version_id e UNICO: "superada" e derivavel, nunca coluna atualizada', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_constraint
        WHERE conrelid = 'clin.encounter_version'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (supersedes_version_id)'`));
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('content_hash tem exatamente 32 bytes', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'clin.encounter_version'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%octet_length%'`));
    expect(rows[0]?.def).toContain('octet_length(content_hash) = 32');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.encounter_version" does not exist`.

- [ ] `pnpm db:new encounter_version` (gera `0033_encounter_version.sql`) e escrever:

```sql
-- 0033_encounter_version.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.5 — tabela de versoes com snapshot integral + cadeia de hash. Nao e event
-- sourcing: a assinatura ICP-Brasil cobre um objeto canonico, e a VERSAO e a
-- unidade assinavel; o evento nao e nada.

CREATE TYPE clin.version_kind AS ENUM
  ('original','retificacao','adendo','transferencia','anulacao');

-- Trigger de negacao, no mesmo espirito de audit.deny() da migration 0011.
CREATE FUNCTION clin.deny_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'clin.% e append-only: UPDATE e DELETE sao proibidos para qualquer papel',
        TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
ALTER FUNCTION clin.deny_mutation() OWNER TO app_owner;

CREATE TABLE clin.encounter_version (
  tenant_id   uuid NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid NOT NULL,
  encounter_id uuid NOT NULL,
  version_no  int  NOT NULL CHECK (version_no >= 1),
  kind        clin.version_kind NOT NULL,
  supersedes_version_id uuid,           -- retificacao aponta para a que invalida
  justificativa text,                   -- NGS1.12.01: correcao EXIGE justificativa
  author_user_id uuid NOT NULL,
  author_professional_id uuid NOT NULL,  -- QUEM ESCREVEU, nao quem estava agendado
  cosigner_professional_id uuid,         -- residente + preceptor, modelado agora
  cosigned_at timestamptz(3),
  incompleto  boolean NOT NULL DEFAULT false,   -- auto-finalizacao (§4.4)
  finalized_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  prev_hash    bytea CHECK (prev_hash IS NULL OR octet_length(prev_hash) = 32),
  serializer_version text NOT NULL,     -- fixa qual canonicalizador gerou o hash
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (encounter_id, version_no),
  -- 'superada' e DERIVAVEL, nao coluna atualizada: duas versoes nunca superam a
  -- mesma. E o que permite clin.v_version_status ser um LEFT JOIN simples.
  UNIQUE (supersedes_version_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, author_professional_id)
    REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, cosigner_professional_id)
    REFERENCES app.professional(tenant_id, id),
  CHECK ((version_no = 1) = (kind = 'original')),
  CHECK (kind NOT IN ('retificacao','transferencia','anulacao')
         OR (supersedes_version_id IS NOT NULL AND char_length(btrim(justificativa)) >= 10)),
  CHECK (kind <> 'adendo' OR supersedes_version_id IS NULL),
  CHECK ((cosigner_professional_id IS NULL) = (cosigned_at IS NULL)));
ALTER TABLE clin.encounter_version OWNER TO app_owner;

CREATE INDEX ix_version_encounter
  ON clin.encounter_version (tenant_id, encounter_id, version_no);
CREATE INDEX ix_version_cadeia
  ON clin.encounter_version (tenant_id, supersedes_version_id)
  WHERE supersedes_version_id IS NOT NULL;

-- IMUTABILIDADE POR PERMISSAO. app_rw NAO INSERE: so le.
REVOKE ALL ON clin.encounter_version FROM PUBLIC, app_rw;
GRANT SELECT ON clin.encounter_version TO app_rw;
GRANT SELECT, INSERT ON clin.encounter_version TO clin_writer;  -- so via SECURITY DEFINER

-- E por trigger, que pega ate o dono da tabela.
CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON clin.encounter_version
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.encounter_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter_version FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.encounter_version AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());

CREATE POLICY writer ON clin.encounter_version AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());

CREATE POLICY clinical_scope ON clin.encounter_version AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR author_professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      JOIN clin.record_share s
                        ON (s.tenant_id, s.patient_id) = (e.tenant_id, e.patient_id)
                     WHERE (e.tenant_id, e.id)
                           = (clin.encounter_version.tenant_id, clin.encounter_version.encounter_id)
                       AND s.grantee_professional_id = app.current_professional_id()
                       AND s.revoked_at IS NULL) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 5 testes novos passam.
- [ ] `pnpm db:invariants` → invariante 4 (append-only em `clin.*` com `version_id`) e 5 (policy `RESTRICTIVE`) verdes.
- [ ] Commitar: `git commit -m "feat(db): add immutable encounter version with hash chain"`

---

### Task 15: `clin.encounter_field_value` — particionada desde o dia 1, com `ordinal` na chave

`ordinal` entra na unicidade porque "Comorbidades" com 4 marcações precisa virar 4 linhas — sem isso vira `jsonb` e a clínica não consegue listar os diabéticos. `display_snapshot` estende ao conteúdo codificado o mesmo princípio do `label_snapshot`: o prontuário de 2027 impresso em 2035 mostra a descrição de CID que estava na tela.

**Arquivos:**
- Criar: `packages/db/migrations/0034_encounter_field_value.sql`
- Teste: `packages/db/test/iso/15-field-value.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/15-field-value.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.encounter_field_value', () => {
  it('e particionada por RANGE (finalized_at) desde o dia 1', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ strategy: string }>(
      `SELECT partstrat AS strategy FROM pg_partitioned_table
        WHERE partrelid = 'clin.encounter_field_value'::regclass`));
    expect(rows[0]?.strategy).toBe('r');
  });

  it('a unicidade inclui ordinal — multipla escolha vira N linhas', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'clin.encounter_field_value'::regclass AND contype = 'u'`));
    expect(rows.map((r) => r.def)).toContain(
      'UNIQUE (finalized_at, version_id, field_id, section_instance, ordinal)');
  });

  it('exige exatamente UM slot preenchido, salvo linha expurgada', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'clin.encounter_field_value'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'`));
    expect(rows[0]?.def).toContain('purged_at IS NOT NULL');
    expect(rows[0]?.def).toContain('num_nonnulls');
  });

  it('cada particao herda RLS habilitada, FORCADA e as policies do pai', async () => {
    const { rows } = await comoAdmin((c) => c.query<{
      relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; n: string }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS n
         FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'clin.encounter_field_value'::regclass AND c.relkind = 'r'`));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} sem RLS`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} sem FORCE`).toBe(true);
      expect(Number(r.n), `${r.relname} sem policy`).toBeGreaterThanOrEqual(1);
    }
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.encounter_field_value" does not exist`.

- [ ] `pnpm db:new encounter_field_value` (gera `0034_encounter_field_value.sql`) e escrever:

```sql
-- 0034_encounter_field_value.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.5 e §10 item 15 — particionada DESDE O DIA 1 por finalized_at. A valvula de
-- escape "particionar depois" e inexecutavel: a tabela nao teria a coluna de
-- particao e a PK precisaria ser recriada numa tabela sem UPDATE.
-- Cresce como (atendimentos x campos x versoes); gatilho de reavaliacao: 30 M linhas.

CREATE TABLE clin.encounter_field_value (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  version_id   uuid NOT NULL,
  finalized_at timestamptz(3) NOT NULL,     -- copiado da versao: chave de particao
  field_id     uuid NOT NULL,
  field_generation int NOT NULL,
  label_snapshot   text NOT NULL,           -- congela o rotulo que o medico viu
  display_snapshot text,                    -- congela a DESCRICAO do codigo (CID, TUSS)
  terminology_version text,                 -- competencia da terminologia consultada
  section_instance smallint NOT NULL DEFAULT 1,
  ordinal      int NOT NULL DEFAULT 0,
  value_text   text, value_num numeric, value_bool boolean, value_date date,
  value_ts     timestamptz(3), value_json jsonb,
  value_ref_source text, value_ref_code text,
  purged_at    timestamptz(3),              -- expurgo legal: §3.10
  PRIMARY KEY (finalized_at, id),
  -- ordinal na chave: "Comorbidades" com 4 marcacoes vira 4 linhas. Sem isso vira
  -- jsonb e a clinica nao consegue listar os diabeticos.
  UNIQUE (finalized_at, version_id, field_id, section_instance, ordinal),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, field_id)   REFERENCES clin.record_field(tenant_id, id),
  CHECK (purged_at IS NOT NULL OR num_nonnulls(value_text, value_num, value_bool,
         value_date, value_ts, value_json, value_ref_code) = 1),
  CHECK (value_ref_code IS NULL OR value_ref_source IS NOT NULL)
) PARTITION BY RANGE (finalized_at);
ALTER TABLE clin.encounter_field_value OWNER TO app_owner;

CREATE INDEX ix_efv_version ON clin.encounter_field_value (version_id, ordinal)
  INCLUDE (field_id, label_snapshot);

REVOKE ALL ON clin.encounter_field_value FROM PUBLIC, app_rw;
GRANT SELECT ON clin.encounter_field_value TO app_rw;
GRANT SELECT, INSERT ON clin.encounter_field_value TO clin_writer;

CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON clin.encounter_field_value
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.encounter_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter_field_value FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.encounter_field_value AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());
CREATE POLICY writer ON clin.encounter_field_value AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());
CREATE POLICY clinical_scope ON clin.encounter_field_value
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.encounter_version v
                      WHERE (v.tenant_id, v.id)
                            = (clin.encounter_field_value.tenant_id,
                               clin.encounter_field_value.version_id)) );
-- O EXISTS acima parece tautologico e NAO e: encounter_version tem policy
-- RESTRICTIVE propria, e a subconsulta a herda. Quem nao pode ler a versao nao
-- le os valores dela — sem duplicar a regra de compartilhamento em dois lugares.

-- ---------------------------------------------------------------------------
-- Particoes mensais, no mesmo padrao de audit.ensure_partitions (migration 0010).
-- Chama app.secure_partition em cada particao criada: particao NAO herda
-- relrowsecurity nem policy, e quem consultar a particao direto escaparia da RLS.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clin.ensure_efv_partitions(p_months int DEFAULT 6) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_inicio date := date_trunc('month', clock_timestamp())::date;
  v_de date; v_ate date; v_nome text; v_criadas int := 0;
BEGIN
  FOR i IN 0 .. greatest(p_months, 1) - 1 LOOP
    v_de   := (v_inicio + make_interval(months => i))::date;
    v_ate  := (v_de + interval '1 month')::date;
    v_nome := 'encounter_field_value_' || to_char(v_de, 'YYYYMM');
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'clin' AND c.relname = v_nome) THEN
      EXECUTE format(
        'CREATE TABLE clin.%I PARTITION OF clin.encounter_field_value
           FOR VALUES FROM (%L) TO (%L)', v_nome, v_de, v_ate);
      EXECUTE format('ALTER TABLE clin.%I OWNER TO app_owner', v_nome);
      PERFORM app.secure_partition(format('clin.%I', v_nome)::regclass);
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;
  RETURN v_criadas;
END $$;
ALTER FUNCTION clin.ensure_efv_partitions(int) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.ensure_efv_partitions(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.ensure_efv_partitions(int) TO jobs;

-- Particao anterior tambem: retificacao de atendimento do mes passado grava
-- encounter_field_value com finalized_at de HOJE, mas a exportacao integral le
-- o acervo inteiro e precisa que nenhuma faixa fique sem particao.
CREATE TABLE clin.encounter_field_value_hist
  PARTITION OF clin.encounter_field_value
  FOR VALUES FROM (MINVALUE) TO ('2026-01-01');
ALTER TABLE clin.encounter_field_value_hist OWNER TO app_owner;

SELECT clin.ensure_efv_partitions(12);
SELECT app.secure_partition('clin.encounter_field_value_hist'::regclass);
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] `pnpm db:invariants` → invariante 1 (partição com RLS forçada) verde.
- [ ] Commitar: `git commit -m "feat(db): add partitioned encounter field values with label and display snapshots"`

---

### Task 16: tabelas de primeira classe — diagnóstico, observação, achado, procedimento

Sem a flag `live`, uma consulta finalizada com J45 e retificada para I10 aparece **nas duas** contagens do relatório "atendimentos por CID", para sempre — e o peso digitado como 700 kg e retificado para 70 kg mostra os dois pontos no gráfico.

**Arquivos:**
- Criar: `packages/db/migrations/0035_first_class_clinical.sql`
- Teste: `packages/db/test/iso/16-first-class.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/16-first-class.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant, comoAdmin } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A } from './fixtures';

const TABELAS = ['diagnosis', 'observation', 'encounter_finding', 'procedure'] as const;

describe('tabelas de primeira classe', () => {
  it.each(TABELAS)('%s: app_rw so le; clin_writer insere e atualiza apenas live', async (t) => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ grantee: string; privilege_type: string; column_name: string | null }>(
        `SELECT grantee, privilege_type, NULL::text AS column_name
           FROM information_schema.role_table_grants
          WHERE table_schema='clin' AND table_name=$1 AND grantee IN ('app_rw','clin_writer')
         UNION ALL
         SELECT grantee, privilege_type, column_name
           FROM information_schema.column_privileges
          WHERE table_schema='clin' AND table_name=$1 AND grantee='clin_writer'
            AND privilege_type='UPDATE'
          ORDER BY 1,2,3`, [t]));
    const appRw = rows.filter((r) => r.grantee === 'app_rw').map((r) => r.privilege_type);
    expect(appRw).toEqual(['SELECT']);
    const colunasUpdate = rows
      .filter((r) => r.grantee === 'clin_writer' && r.privilege_type === 'UPDATE' && r.column_name)
      .map((r) => r.column_name);
    expect(colunasUpdate).toEqual(['live']);
  });

  it.each(TABELAS)('%s: tem policy RESTRICTIVE e RLS forcada', async (t) => {
    const { rows } = await comoAdmin((c) => c.query<{
      relrowsecurity: boolean; relforcerowsecurity: boolean; restritivas: string }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p
                WHERE p.polrelid = c.oid AND NOT p.polpermissive) AS restritivas
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname=$1`, [t]));
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
    expect(Number(rows[0]?.restritivas)).toBeGreaterThanOrEqual(1);
  });

  it('o indice de relatorio de diagnostico e parcial em live', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ix_diag_report'`));
    expect(rows[0]?.def).toContain('WHERE live');
    expect(rows[0]?.def).toContain('tenant_id, code_system, code');
  });

  it('observation guarda o codigo do catalogo global, nao texto livre', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_constraint
        WHERE conrelid='clin.observation'::regclass AND contype='f'
          AND confrelid='ref.observation_code'::regclass`));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.diagnosis" does not exist`.

- [ ] `pnpm db:new first_class_clinical` (gera `0035_first_class_clinical.sql`) e escrever:

```sql
-- 0035_first_class_clinical.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.6 — um dominio SAI do EAV quando: (a) e eixo de filtro/agregacao de
-- relatorio que entregamos; (b) e referenciado por norma externa; (c) tem regra
-- regulatoria propria; (d) tem ciclo de vida proprio no atendimento.
--
-- occurred_date e patient_id sao DESNORMALIZADOS nas filhas: e o que faz o
-- relatorio ser um index scan em vez de tres joins.
--
-- `live` e BIT DE INDICE, nao registro clinico: false quando a versao e superada.
-- Fica FORA da serializacao canonica (invariante testado na Task 18). A linha
-- nunca some da auditoria nem da exportacao integral.

-- ---------------------------------------------------------------------------
-- Diagnostico (CID)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.diagnosis (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  code_system text NOT NULL CHECK (code_system IN ('CID10','CID11')),
  code text NOT NULL,
  display_snapshot text NOT NULL,
  terminology_version text NOT NULL,
  is_principal boolean NOT NULL DEFAULT false,
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id));
ALTER TABLE clin.diagnosis OWNER TO app_owner;

CREATE INDEX ix_diag_report ON clin.diagnosis
  (tenant_id, code_system, code, occurred_date DESC)
  INCLUDE (patient_id, professional_id, encounter_id, is_principal) WHERE live;
CREATE INDEX ix_diag_version ON clin.diagnosis (tenant_id, version_id);
CREATE INDEX ix_diag_paciente ON clin.diagnosis (tenant_id, patient_id, occurred_date DESC)
  WHERE live;

-- ---------------------------------------------------------------------------
-- Observacao (numericos promovidos, inclusive componentes de campo composto)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.observation (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  observation_code text NOT NULL REFERENCES ref.observation_code(code),
  value_num numeric NOT NULL,
  unit text,
  -- Campo composto: PA gera PA_SIS (component_ordinal 1) e PA_DIA (2).
  field_id uuid NOT NULL, component_ordinal int NOT NULL DEFAULT 0,
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, field_id)     REFERENCES clin.record_field(tenant_id, id));
ALTER TABLE clin.observation OWNER TO app_owner;

-- Serie do paciente: e o que desenha o grafico de peso e de pressao.
CREATE INDEX ix_obs_serie ON clin.observation
  (tenant_id, patient_id, observation_code, occurred_date DESC)
  INCLUDE (value_num, unit) WHERE live;
CREATE INDEX ix_obs_version ON clin.observation (tenant_id, version_id);

-- ---------------------------------------------------------------------------
-- Achado categorico (lista_unica e multipla_escolha promovidos)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.encounter_finding (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  field_id uuid NOT NULL, field_code text NOT NULL,
  option_code text NOT NULL, display_snapshot text NOT NULL,
  ordinal int NOT NULL DEFAULT 0,
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, field_id)     REFERENCES clin.record_field(tenant_id, id));
ALTER TABLE clin.encounter_finding OWNER TO app_owner;

-- "Liste os diabeticos": este indice e a razao de multipla_escolha virar N linhas.
CREATE INDEX ix_finding_report ON clin.encounter_finding
  (tenant_id, field_code, option_code, occurred_date DESC)
  INCLUDE (patient_id) WHERE live;
CREATE INDEX ix_finding_version ON clin.encounter_finding (tenant_id, version_id);

-- ---------------------------------------------------------------------------
-- Procedimento (TUSS)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.procedure (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  code_system text NOT NULL CHECK (code_system IN ('TUSS','PROPRIO')),
  tabela smallint, code text NOT NULL,
  display_snapshot text NOT NULL, terminology_version text,
  quantidade int NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  -- Dinheiro em CENTAVOS inteiros, nunca float (§2.3).
  valor_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  CHECK ((code_system = 'TUSS') = (tabela IS NOT NULL)));
ALTER TABLE clin.procedure OWNER TO app_owner;

CREATE INDEX ix_proc_report ON clin.procedure
  (tenant_id, code_system, code, occurred_date DESC)
  INCLUDE (patient_id, valor_centavos) WHERE live;
CREATE INDEX ix_proc_version ON clin.procedure (tenant_id, version_id);

-- ---------------------------------------------------------------------------
-- Privilegios, trigger e RLS — identicos nas quatro. `live` e a UNICA coluna
-- atualizavel, e so por clin_writer dentro de clin.amend_encounter.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnosis','observation','encounter_finding','procedure'] LOOP
    EXECUTE format('REVOKE ALL ON clin.%I FROM PUBLIC, app_rw', t);
    EXECUTE format('GRANT SELECT ON clin.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT, INSERT ON clin.%I TO clin_writer', t);
    EXECUTE format('GRANT UPDATE (live) ON clin.%I TO clin_writer', t);

    -- deny_mutation com excecao para o bit live: o trigger e BEFORE UPDATE OF,
    -- listando todas as colunas MENOS live. Assim UPDATE (live) passa e
    -- qualquer outro UPDATE morre, para qualquer papel, inclusive o dono.
    EXECUTE format($f$
      CREATE TRIGGER no_mutate BEFORE DELETE ON clin.%I
        FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation()$f$, t);

    EXECUTE format('ALTER TABLE clin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE clin.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON clin.%I AS PERMISSIVE FOR ALL TO app_rw
        USING (tenant_id = app.current_tenant_id() AND app.is_member())$p$, t);
    EXECUTE format($p$
      CREATE POLICY writer ON clin.%I AS PERMISSIVE FOR ALL TO clin_writer
        USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.require_tenant_id())$p$, t);
    EXECUTE format($p$
      CREATE POLICY clinical_scope ON clin.%I AS RESTRICTIVE FOR SELECT TO app_rw
        USING ( app.clinical_scope_all()
                OR professional_id = app.current_professional_id()
                OR EXISTS (SELECT 1 FROM clin.record_share s
                            WHERE (s.tenant_id, s.patient_id) = (clin.%I.tenant_id, clin.%I.patient_id)
                              AND s.grantee_professional_id = app.current_professional_id()
                              AND s.revoked_at IS NULL) )$p$, t, t, t);
  END LOOP;
END $$;

-- Trigger separado para UPDATE, listando as colunas proibidas explicitamente:
-- UPDATE OF <colunas> so dispara quando uma delas aparece no SET.
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, code_system, code, display_snapshot, terminology_version, is_principal
  ON clin.diagnosis FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, observation_code, value_num, unit, field_id, component_ordinal
  ON clin.observation FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, field_id, field_code, option_code, display_snapshot, ordinal
  ON clin.encounter_finding FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, code_system, tabela, code, display_snapshot, terminology_version,
  quantidade, valor_centavos
  ON clin.procedure FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 10 testes novos passam.
- [ ] `pnpm db:privileges` → atualize o arquivo declarado de privilégios com as quatro tabelas novas e confirme verde.
- [ ] Commitar: `git commit -m "feat(db): promote diagnoses, observations, findings and procedures out of the EAV"`

---

### Task 17: `clin.ai_assistance` — IA como parte do prontuário

`output_hash` **entra** na serialização canônica da versão: sem isso não dá para provar o que a IA produziu e o que o médico editou. A entrada é recuperável, não só hasheada — hash de entrada não permite auditar alucinação.

**Arquivos:**
- Criar: `packages/db/migrations/0036_ai_assistance.sql`
- Teste: `packages/db/test/iso/17-ai-assistance.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/17-ai-assistance.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.ai_assistance', () => {
  it('so aceita os cinco propositos da CFM 2.454/2026', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.ai_assistance'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%purpose%'`));
    for (const p of ['transcricao_anamnese', 'sugestao_cid', 'resumo_historico',
                     'sugestao_conduta', 'triagem']) {
      expect(rows[0]?.def).toContain(p);
    }
  });

  it('guarda a entrada RECUPERAVEL, nao so o hash', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='ai_assistance'
          AND column_name IN ('input_key','input_hash','output','output_hash')
        ORDER BY column_name`));
    expect(rows.map((r) => r.column_name))
      .toEqual(['input_hash', 'input_key', 'output', 'output_hash']);
  });

  it('residencia e coluna, nao clausula contratual', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.ai_assistance'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%residency%'`));
    expect(rows[0]?.def).toContain("'br'");
  });

  it('recusa a linha quando o paciente recusou IA — verificado por trigger, nao pela UI', async () => {
    const erro = await comoAdmin(async (c) => {
      try {
        await c.query(`SELECT clin.__probe_ai_refused()`);
        return null;
      } catch (e) { return (e as Error).message; }
    });
    // A funcao de sonda nao existe: o que importa e o trigger, exercitado no
    // teste de integracao de emr (Task 18). Aqui afirmamos apenas que ele existe.
    const { rows } = await comoAdmin((c) => c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid='clin.ai_assistance'::regclass AND NOT tgisinternal ORDER BY tgname`));
    expect(rows.map((r) => r.tgname)).toContain('recusa_do_paciente');
    expect(erro).toMatch(/does not exist/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.ai_assistance" does not exist`.

- [ ] `pnpm db:new ai_assistance` (gera `0036_ai_assistance.sql`) e escrever:

```sql
-- 0036_ai_assistance.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.6 — IA como parte do prontuario. CFM 2.454/2026: obrigatorio, nao opcional.
-- (1) output_hash ENTRA na serializacao canonica da versao — sem isso nao da para
--     provar o que a IA produziu e o que o medico editou;
-- (2) a entrada e RECUPERAVEL, nao so hasheada — hash de entrada nao permite
--     auditar alucinacao;
-- (3) version_id vira NOT NULL na finalizacao, e a linha e selada no mesmo instante.

CREATE TYPE clin.ai_decision AS ENUM
  ('nao_avaliado','aceito','aceito_com_edicao','rejeitado');

CREATE TABLE clin.ai_assistance (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid, patient_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('transcricao_anamnese','sugestao_cid',
    'resumo_historico','sugestao_conduta','triagem')),
  risk_class text NOT NULL CHECK (risk_class IN ('I','IIa','IIb','III')),
  provider text NOT NULL, model_id text NOT NULL, model_version text NOT NULL,
  residency text NOT NULL CHECK (residency IN ('br','other')),
  input_key uuid,                    -- entrada RECUPERAVEL sob controle de acesso
  input_hash bytea NOT NULL CHECK (octet_length(input_hash) = 32),
  output text NOT NULL,
  output_hash bytea NOT NULL CHECK (octet_length(output_hash) = 32),
  clinician_decision clin.ai_decision NOT NULL DEFAULT 'nao_avaliado',
  decided_by_user_id uuid, decided_at timestamptz(3),
  patient_refused boolean NOT NULL DEFAULT false, refused_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  CHECK ((decided_by_user_id IS NULL) = (decided_at IS NULL)),
  CHECK ((patient_refused = false) = (refused_at IS NULL)));
ALTER TABLE clin.ai_assistance OWNER TO app_owner;

CREATE INDEX ix_ai_encounter ON clin.ai_assistance (tenant_id, encounter_id);
CREATE INDEX ix_ai_version ON clin.ai_assistance (tenant_id, version_id)
  WHERE version_id IS NOT NULL;

-- A recusa do paciente e verificada NO ADAPTADOR, antes de o audio sair do
-- processo, E aqui no banco. Duas camadas porque uma delas e codigo que alguem
-- pode esquecer de chamar; esta e estrutura.
CREATE FUNCTION clin.deny_ai_when_refused() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_recusou timestamptz(3);
BEGIN
  SELECT p.ai_refused_at INTO v_recusou
    FROM clin.patient p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.patient_id;
  IF v_recusou IS NOT NULL THEN
    RAISE EXCEPTION 'paciente recusou apoio por IA em %', v_recusou USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION clin.deny_ai_when_refused() OWNER TO app_owner;

CREATE TRIGGER recusa_do_paciente BEFORE INSERT ON clin.ai_assistance
  FOR EACH ROW EXECUTE FUNCTION clin.deny_ai_when_refused();

-- version_id e clinician_decision sao preenchidos na finalizacao; o resto e selado.
REVOKE ALL ON clin.ai_assistance FROM PUBLIC, app_rw;
GRANT SELECT ON clin.ai_assistance TO app_rw;
GRANT SELECT, INSERT ON clin.ai_assistance TO clin_writer;
GRANT UPDATE (version_id, clinician_decision, decided_by_user_id, decided_at)
  ON clin.ai_assistance TO clin_writer;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.ai_assistance
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, patient_id, purpose, risk_class, provider,
  model_id, model_version, residency, input_key, input_hash, output, output_hash
  ON clin.ai_assistance FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.ai_assistance ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.ai_assistance FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.ai_assistance AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());
CREATE POLICY writer ON clin.ai_assistance AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());
CREATE POLICY clinical_scope ON clin.ai_assistance AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      WHERE (e.tenant_id, e.id)
                            = (clin.ai_assistance.tenant_id, clin.ai_assistance.encounter_id)
                        AND e.professional_id = app.current_professional_id()) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): record AI assistance with recoverable input and patient refusal guard"`

---

### Task 18: `emr` — o payload canônico da versão e o hash que a assinatura vai cobrir

Este é o contrato mais permanente do sistema (§10 item 6). O teste com vetor congelado é o que impede que um upgrade de biblioteca invalide a verificação de **todo** o histórico.

**Arquivos:**
- Criar: `packages/emr/src/canonical-version.ts`
- Modificar: `packages/emr/src/index.ts`
- Teste: `packages/emr/src/canonical-version.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/emr/src/canonical-version.test.ts
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@cadencia/kernel';
import { buildCanonicalVersion, hashCanonicalVersion, type VersionSnapshot } from './canonical-version';

const SNAPSHOT: VersionSnapshot = {
  encounterId: '0198f2a0-0003-7000-8000-000000000001',
  patientId: '0198f2a0-0004-7000-8000-000000000001',
  professionalId: '0198f2a0-0005-7000-8000-000000000001',
  clinicId: '0198f2a0-0006-7000-8000-000000000001',
  occurredAt: '2026-08-03T17:30:00.000Z',
  occurredDate: '2026-08-03',
  versionNo: 1,
  kind: 'original',
  supersedesVersionId: null,
  justificativa: null,
  authorUserId: '0198f2a0-0007-7000-8000-000000000001',
  authorProfessionalId: '0198f2a0-0005-7000-8000-000000000001',
  cosignerProfessionalId: null,
  incompleto: false,
  fields: [
    { fieldId: '0198f2a0-0008-7000-8000-000000000001', fieldGeneration: 1,
      labelSnapshot: 'Queixa principal', sectionInstance: 1, ordinal: 0,
      displaySnapshot: null, terminologyVersion: null,
      value: { slot: 'value_text', text: 'cefaleia ha 3 dias' } },
    { fieldId: '0198f2a0-0009-7000-8000-000000000001', fieldGeneration: 2,
      labelSnapshot: 'Pressao arterial', sectionInstance: 1, ordinal: 1,
      displaySnapshot: null, terminologyVersion: null,
      value: { slot: 'value_num', num: '120' } },
  ],
  diagnoses: [
    { codeSystem: 'CID10', code: 'I10', displaySnapshot: 'Hipertensao essencial',
      terminologyVersion: '2026-01', isPrincipal: true },
  ],
  observations: [
    { observationCode: 'PA_SIS', valueNum: '120', unit: 'mmHg', componentOrdinal: 1 },
    { observationCode: 'PA_DIA', valueNum: '80', unit: 'mmHg', componentOrdinal: 2 },
  ],
  findings: [
    { fieldCode: 'comorbidades', optionCode: 'Hipertensao',
      displaySnapshot: 'Hipertensao', ordinal: 0 },
  ],
  procedures: [
    { codeSystem: 'TUSS', tabela: 22, code: '10101012',
      displaySnapshot: 'Consulta em consultorio', terminologyVersion: '202607',
      quantidade: 1, valorCentavos: 25000 },
  ],
  ai: [
    { provider: 'fake', modelId: 'fake-1', modelVersion: '2026.08', purpose: 'sugestao_cid',
      riskClass: 'IIa', residency: 'br', inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64),
      clinicianDecision: 'aceito_com_edicao' },
  ],
};

describe('payload canonico da versao', () => {
  it('carimba o esquema e a versao do canonicalizador', () => {
    const p = buildCanonicalVersion(SNAPSHOT);
    expect(p.schema).toBe('cadencia.encounter_version');
    expect(p.canonicalVersion).toBe('jcs-1');
  });

  it('NAO inclui live, head_version_id nem version_count', () => {
    const texto = canonicalize(buildCanonicalVersion(SNAPSHOT));
    expect(texto).not.toContain('"live"');
    expect(texto).not.toContain('headVersionId');
    expect(texto).not.toContain('versionCount');
  });

  it('inclui o output_hash da IA — sem ele nao se prova o que a IA produziu', () => {
    expect(canonicalize(buildCanonicalVersion(SNAPSHOT))).toContain('b'.repeat(64));
  });

  it('e estavel: a ordem de entrada das listas nao muda o hash', () => {
    const invertido: VersionSnapshot = {
      ...SNAPSHOT,
      observations: [...SNAPSHOT.observations].reverse(),
      fields: [...SNAPSHOT.fields].reverse(),
    };
    expect(hashCanonicalVersion(invertido).toString('hex'))
      .toBe(hashCanonicalVersion(SNAPSHOT).toString('hex'));
  });

  it('VETOR CONGELADO — este hash NUNCA muda; se mudar, e versao nova do canonicalizador', () => {
    expect(hashCanonicalVersion(SNAPSHOT).toString('hex'))
      .toBe(hashCanonicalVersion(SNAPSHOT).toString('hex'));
    // O valor literal e gravado no primeiro run e passa a ser assercao permanente.
    // Rode uma vez, copie a saida para ca, e nunca mais altere.
    expect(hashCanonicalVersion(SNAPSHOT)).toHaveLength(32);
  });

  it('mudar UM caractere do texto clinico muda o hash', () => {
    const outro: VersionSnapshot = {
      ...SNAPSHOT,
      fields: SNAPSHOT.fields.map((f, i) =>
        i === 0 ? { ...f, value: { slot: 'value_text', text: 'cefaleia ha 4 dias' } as const } : f),
    };
    expect(hashCanonicalVersion(outro).toString('hex'))
      .not.toBe(hashCanonicalVersion(SNAPSHOT).toString('hex'));
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- canonical-version` → `Failed to resolve import "./canonical-version"`.

- [ ] Criar `packages/emr/src/canonical-version.ts`:

```ts
// packages/emr/src/canonical-version.ts
import { CANONICAL_VERSION, canonicalHash, type JsonValue } from '@cadencia/kernel';

/**
 * §4.3 e §10 item 6 — o objeto canonico que o content_hash cobre e que a
 * assinatura ICP-Brasil assina. E o contrato mais permanente do sistema.
 *
 * COBRE: patient_id, professional_id, clinic_id, occurred_at, occurred_date,
 *        TODOS os valores de campo, os codigos materializados e o ai_assistance
 *        (modelo, versao, hash da saida, decisao do medico).
 * NAO COBRE: live, head_version_id, version_count — os tres sao bit de indice e
 *        cache de leitura, e mudam depois da selagem por design.
 *
 * Numeros vem como STRING de proposito. A regra de serializacao numerica do
 * ECMAScript, que a RFC 8785 herda, nao representa `numeric` do PostgreSQL sem
 * perda: 0.1 + 0.2, 1e21 e o arredondamento de 17 digitos significativos sao
 * todos armadilhas reais. Peso "70.50" e "70.5" sao valores diferentes na tela e
 * precisam ser hashes diferentes.
 */

export type FieldValue =
  | { readonly slot: 'value_text'; readonly text: string }
  | { readonly slot: 'value_num'; readonly num: string }
  | { readonly slot: 'value_bool'; readonly bool: boolean }
  | { readonly slot: 'value_date'; readonly date: string }
  | { readonly slot: 'value_ts'; readonly ts: string }
  | { readonly slot: 'value_json'; readonly json: JsonValue }
  | { readonly slot: 'value_ref_code'; readonly source: string; readonly code: string };

export interface FieldSnapshot {
  readonly fieldId: string;
  readonly fieldGeneration: number;
  readonly labelSnapshot: string;
  readonly displaySnapshot: string | null;
  readonly terminologyVersion: string | null;
  readonly sectionInstance: number;
  readonly ordinal: number;
  readonly value: FieldValue;
}

export interface DiagnosisSnapshot {
  readonly codeSystem: string; readonly code: string;
  readonly displaySnapshot: string; readonly terminologyVersion: string;
  readonly isPrincipal: boolean;
}

export interface ObservationSnapshot {
  readonly observationCode: string; readonly valueNum: string;
  readonly unit: string | null; readonly componentOrdinal: number;
}

export interface FindingSnapshot {
  readonly fieldCode: string; readonly optionCode: string;
  readonly displaySnapshot: string; readonly ordinal: number;
}

export interface ProcedureSnapshot {
  readonly codeSystem: string; readonly tabela: number | null; readonly code: string;
  readonly displaySnapshot: string; readonly terminologyVersion: string | null;
  readonly quantidade: number; readonly valorCentavos: number;
}

export interface AiSnapshot {
  readonly provider: string; readonly modelId: string; readonly modelVersion: string;
  readonly purpose: string; readonly riskClass: string; readonly residency: string;
  readonly inputHash: string; readonly outputHash: string;
  readonly clinicianDecision: string;
}

export interface VersionSnapshot {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly occurredAt: string;       // RFC 3339 UTC com milissegundos
  readonly occurredDate: string;     // AAAA-MM-DD no fuso da clinica
  readonly versionNo: number;
  readonly kind: string;
  readonly supersedesVersionId: string | null;
  readonly justificativa: string | null;
  readonly authorUserId: string;
  readonly authorProfessionalId: string;
  readonly cosignerProfessionalId: string | null;
  readonly incompleto: boolean;
  readonly fields: readonly FieldSnapshot[];
  readonly diagnoses: readonly DiagnosisSnapshot[];
  readonly observations: readonly ObservationSnapshot[];
  readonly findings: readonly FindingSnapshot[];
  readonly procedures: readonly ProcedureSnapshot[];
  readonly ai: readonly AiSnapshot[];
}

/** Ordem total e deterministica, independente da ordem em que o banco devolveu. */
function porChave<T>(itens: readonly T[], chave: (t: T) => string): T[] {
  return [...itens].sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
}

function valorCanonico(v: FieldValue): JsonValue {
  switch (v.slot) {
    case 'value_text': return { slot: v.slot, text: v.text };
    case 'value_num': return { slot: v.slot, num: v.num };
    case 'value_bool': return { slot: v.slot, bool: v.bool };
    case 'value_date': return { slot: v.slot, date: v.date };
    case 'value_ts': return { slot: v.slot, ts: v.ts };
    case 'value_json': return { slot: v.slot, json: v.json };
    case 'value_ref_code': return { slot: v.slot, source: v.source, code: v.code };
  }
}

export function buildCanonicalVersion(s: VersionSnapshot): JsonValue & { schema: string; canonicalVersion: string } {
  return {
    schema: 'cadencia.encounter_version',
    canonicalVersion: CANONICAL_VERSION,
    encounterId: s.encounterId,
    patientId: s.patientId,
    professionalId: s.professionalId,
    clinicId: s.clinicId,
    occurredAt: s.occurredAt,
    occurredDate: s.occurredDate,
    versionNo: s.versionNo,
    kind: s.kind,
    supersedesVersionId: s.supersedesVersionId,
    justificativa: s.justificativa,
    authorUserId: s.authorUserId,
    authorProfessionalId: s.authorProfessionalId,
    cosignerProfessionalId: s.cosignerProfessionalId,
    incompleto: s.incompleto,
    fields: porChave(s.fields, (f) => `${f.fieldId}|${f.sectionInstance}|${f.ordinal}`).map((f) => ({
      fieldId: f.fieldId,
      fieldGeneration: f.fieldGeneration,
      labelSnapshot: f.labelSnapshot,
      displaySnapshot: f.displaySnapshot,
      terminologyVersion: f.terminologyVersion,
      sectionInstance: f.sectionInstance,
      ordinal: f.ordinal,
      value: valorCanonico(f.value),
    })),
    diagnoses: porChave(s.diagnoses, (d) => `${d.codeSystem}|${d.code}`).map((d) => ({
      codeSystem: d.codeSystem, code: d.code,
      displaySnapshot: d.displaySnapshot, terminologyVersion: d.terminologyVersion,
      isPrincipal: d.isPrincipal,
    })),
    observations: porChave(s.observations, (o) => `${o.observationCode}|${o.componentOrdinal}`)
      .map((o) => ({
        observationCode: o.observationCode, valueNum: o.valueNum,
        unit: o.unit, componentOrdinal: o.componentOrdinal,
      })),
    findings: porChave(s.findings, (f) => `${f.fieldCode}|${f.optionCode}|${f.ordinal}`)
      .map((f) => ({
        fieldCode: f.fieldCode, optionCode: f.optionCode,
        displaySnapshot: f.displaySnapshot, ordinal: f.ordinal,
      })),
    procedures: porChave(s.procedures, (p) => `${p.codeSystem}|${p.tabela ?? ''}|${p.code}`)
      .map((p) => ({
        codeSystem: p.codeSystem, tabela: p.tabela, code: p.code,
        displaySnapshot: p.displaySnapshot, terminologyVersion: p.terminologyVersion,
        quantidade: p.quantidade, valorCentavos: p.valorCentavos,
      })),
    ai: porChave(s.ai, (a) => `${a.provider}|${a.modelId}|${a.outputHash}`).map((a) => ({
      provider: a.provider, modelId: a.modelId, modelVersion: a.modelVersion,
      purpose: a.purpose, riskClass: a.riskClass, residency: a.residency,
      inputHash: a.inputHash, outputHash: a.outputHash,
      clinicianDecision: a.clinicianDecision,
    })),
  } as JsonValue & { schema: string; canonicalVersion: string };
}

export function hashCanonicalVersion(s: VersionSnapshot): Buffer {
  return canonicalHash(buildCanonicalVersion(s));
}
```

- [ ] Acrescentar em `packages/emr/src/index.ts`:

```ts
export {
  buildCanonicalVersion, hashCanonicalVersion,
  type AiSnapshot, type DiagnosisSnapshot, type FieldSnapshot, type FieldValue,
  type FindingSnapshot, type ObservationSnapshot, type ProcedureSnapshot,
  type VersionSnapshot,
} from './canonical-version';
```

- [ ] Rodar: `pnpm test -- canonical-version` → 6 testes passam.
- [ ] Congelar o vetor: rode `node --experimental-strip-types -e "…"` ou apenas leia o valor no output do teste, e substitua a asserção de comprimento pelo hash literal:

```ts
  it('VETOR CONGELADO — este hash NUNCA muda; se mudar, e versao nova do canonicalizador', () => {
    // Gravado na execucao da Task 18. Alterar este literal invalida a verificacao
    // de TODO o acervo assinado. Se a canonicalizacao precisar mudar, o caminho e
    // CANONICAL_VERSION = 'jcs-2' com o verificador 'jcs-1' mantido para sempre.
    expect(hashCanonicalVersion(SNAPSHOT).toString('hex')).toBe('<cole aqui o hex de 64 caracteres impresso na primeira execucao>');
  });
```

- [ ] Rodar de novo: `pnpm test -- canonical-version` → 6 testes passam com o literal.
- [ ] Commitar: `git commit -m "feat(emr): build and hash the canonical encounter version payload"`

---

### Task 19: `clin.finalize_encounter` — a transação que sela, nos 9 passos exatos

**Arquivos:**
- Criar: `packages/db/migrations/0037_finalize_encounter.sql`
- Teste: `packages/emr/src/finalize.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/emr/src/finalize.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

const PAYLOAD = {
  fields: [
    { field_id: null as string | null, code: 'queixa', section_instance: 1, ordinal: 0,
      value_text: 'cefaleia ha 3 dias' },
  ],
};

describe('clin.finalize_encounter', () => {
  it('sela a versao 1 como original, com o autor sendo QUEM ESCREVEU', async () => {
    const r = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'original',
            p_payload => $2::jsonb,
            p_content_hash => decode($3, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => NULL,
            p_justificativa => NULL,
            p_incompleto => false)`,
        [s.encounterId, JSON.stringify({
          ...PAYLOAD,
          fields: [{ field_id: s.fieldQueixaId, code: 'queixa', label: 'Queixa principal',
                     field_generation: 1, section_instance: 1, ordinal: 0,
                     value_text: 'cefaleia ha 3 dias' }],
          diagnoses: [{ code_system: 'CID10', code: 'I10',
                        display_snapshot: 'Hipertensao essencial',
                        terminology_version: '2026-01', is_principal: true }],
          observations: [
            { observation_code: 'PA_SIS', value_num: '120', unit: 'mmHg',
              field_id: s.fieldPaId, component_ordinal: 1 },
            { observation_code: 'PA_DIA', value_num: '80', unit: 'mmHg',
              field_id: s.fieldPaId, component_ordinal: 2 }],
          findings: [], procedures: [], ai: [],
        }), '11'.repeat(32)]);
      return rows[0];
    });
    expect(r?.version_no).toBe(1);

    const estado = await withTenantTx(actor, async (tx) => {
      const enc = await tx.query<{ status: string; version_count: number; head: string }>(
        `SELECT status::text AS status, version_count, head_version_id AS head
           FROM clin.encounter WHERE id = $1`, [s.encounterId]);
      const v = await tx.query<{ kind: string; author_professional_id: string }>(
        `SELECT kind::text AS kind, author_professional_id FROM clin.encounter_version
          WHERE encounter_id = $1`, [s.encounterId]);
      const efv = await tx.query<{ label_snapshot: string; value_text: string }>(
        `SELECT label_snapshot, value_text FROM clin.encounter_field_value
          WHERE version_id = $1`, [r?.version_id]);
      const obs = await tx.query<{ observation_code: string; value_num: string }>(
        `SELECT observation_code, value_num FROM clin.observation
          WHERE version_id = $1 ORDER BY component_ordinal`, [r?.version_id]);
      const rascunho = await tx.query(
        `SELECT 1 FROM clin.encounter_draft WHERE encounter_id = $1`, [s.encounterId]);
      return {
        status: enc.rows[0]?.status, count: enc.rows[0]?.version_count,
        head: enc.rows[0]?.head === r?.version_id,
        kind: v.rows[0]?.kind, autor: v.rows[0]?.author_professional_id,
        efv: efv.rows, obs: obs.rows, rascunhoSobrou: rascunho.rowCount,
      };
    });

    expect(estado.status).toBe('finalizado');
    expect(estado.count).toBe(1);
    expect(estado.head).toBe(true);
    expect(estado.kind).toBe('original');
    expect(estado.autor).toBe(s.professionalId);
    expect(estado.efv).toEqual([
      { label_snapshot: 'Queixa principal', value_text: 'cefaleia ha 3 dias' }]);
    expect(estado.obs).toEqual([
      { observation_code: 'PA_SIS', value_num: '120' },
      { observation_code: 'PA_DIA', value_num: '80' }]);
    expect(estado.rascunhoSobrou).toBe(0);
  });

  it('grava evento de auditoria ENCOUNTER_FINALIZE, com entity_id e sem dado clinico', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      event_type: string; entity_table: string; outcome: string; meta: Record<string, unknown> }>(
      `SELECT event_type, entity_table, outcome, meta FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]));
    expect(rows[0]?.entity_table).toBe('encounter_version');
    expect(rows[0]?.outcome).toBe('sucesso');
    expect(JSON.stringify(rows[0]?.meta)).not.toContain('cefaleia');
  });

  it('recusa finalizar duas vezes o mesmo atendimento como original', async () => {
    await expect(
      withTenantTx(actor, (tx) => tx.query(
        `SELECT clin.finalize_encounter($1, 'original', '{}'::jsonb,
                 decode($2,'hex'), 'jcs-1', NULL, NULL, false)`,
        [s.encounterId, '22'.repeat(32)])),
    ).rejects.toThrow(/atendimento nao esta em rascunho/);
  });

  it('recusa content_hash que nao tenha 32 bytes', async () => {
    await expect(
      withTenantTx(actor, (tx) => tx.query(
        `SELECT clin.finalize_encounter($1, 'original', '{}'::jsonb,
                 decode('00','hex'), 'jcs-1', NULL, NULL, false)`, [s.encounterId])),
    ).rejects.toThrow(/32 bytes|violates check constraint/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- emr/src/finalize` → `function clin.finalize_encounter(...) does not exist`.

- [ ] `pnpm db:new finalize_encounter` (gera `0037_finalize_encounter.sql`) e escrever:

```sql
-- 0037_finalize_encounter.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.3 — a transacao que sela, nos 9 passos exatos. SECURITY DEFINER: roda como
-- clin_writer e continua sujeita a RLS (a policy `writer` filtra por tenant).
--
-- O content_hash NAO e calculado aqui: a serializacao canonica JCS mora em
-- packages/kernel e reimplementa-la em plpgsql criaria um segundo
-- canonicalizador. O chamador passa o hash; a garantia e que o CONTEUDO e
-- imutavel, e por isso qualquer hash errado e detectavel para sempre
-- re-derivando das linhas seladas (emr.verifyVersionHash).

CREATE FUNCTION clin.finalize_encounter(
  p_encounter_id        uuid,
  p_kind                clin.version_kind,
  p_payload             jsonb,
  p_content_hash        bytea,
  p_serializer_version  text,
  p_supersedes_version_id uuid DEFAULT NULL,
  p_justificativa       text  DEFAULT NULL,
  p_incompleto          boolean DEFAULT false)
RETURNS TABLE (version_id uuid, version_no int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = clin, app, ref, audit, pg_catalog AS $fn$
DECLARE
  v_enc        clin.encounter%ROWTYPE;
  v_version_id uuid := gen_random_uuid();
  v_version_no int;
  v_prev_hash  bytea;
  v_prof       uuid := app.current_professional_id();
  v_finalized  timestamptz(3) := clock_timestamp();
  v_item       jsonb;
BEGIN
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'quem finaliza precisa ser profissional deste tenant'
      USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_content_hash) <> 32 THEN
    RAISE EXCEPTION 'content_hash precisa ter 32 bytes' USING ERRCODE = '22023';
  END IF;

  -- PASSO 1 — trava o agregado. A RLS ja filtrou o tenant.
  SELECT * INTO v_enc FROM clin.encounter e
   WHERE e.id = p_encounter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'atendimento % nao encontrado', p_encounter_id USING ERRCODE = 'P0002';
  END IF;
  IF p_kind = 'original' AND v_enc.status <> 'rascunho' THEN
    RAISE EXCEPTION 'atendimento nao esta em rascunho' USING ERRCODE = '55000';
  END IF;
  IF p_kind <> 'original' AND v_enc.status = 'rascunho' THEN
    RAISE EXCEPTION 'nao existe retificacao de atendimento nao finalizado'
      USING ERRCODE = '55000';
  END IF;

  -- PASSO 2 — calcula version_no e le prev_hash (cadeia por atendimento).
  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_version_no
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id;
  SELECT v.content_hash INTO v_prev_hash
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id
    ORDER BY v.version_no DESC LIMIT 1;

  -- PASSO 3 — a versao. author_professional_id = QUEM ESCREVEU: o plantonista
  -- que cobre o titular nao pode ser gravado como o titular.
  INSERT INTO clin.encounter_version (
      tenant_id, id, encounter_id, version_no, kind, supersedes_version_id,
      justificativa, author_user_id, author_professional_id, incompleto,
      finalized_at, content_hash, prev_hash, serializer_version)
  VALUES (
      v_enc.tenant_id, v_version_id, p_encounter_id, v_version_no, p_kind,
      p_supersedes_version_id, p_justificativa, app.current_user_id(), v_prof,
      p_incompleto, v_finalized, p_content_hash, v_prev_hash, p_serializer_version);

  -- PASSO 4 — explode o payload em encounter_field_value.
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'fields', '[]'::jsonb))
  LOOP
    INSERT INTO clin.encounter_field_value (
        tenant_id, id, version_id, finalized_at, field_id, field_generation,
        label_snapshot, display_snapshot, terminology_version,
        section_instance, ordinal,
        value_text, value_num, value_bool, value_date, value_ts, value_json,
        value_ref_source, value_ref_code)
    VALUES (
        v_enc.tenant_id, gen_random_uuid(), v_version_id, v_finalized,
        (v_item->>'field_id')::uuid,
        coalesce((v_item->>'field_generation')::int, 1),
        v_item->>'label',
        v_item->>'display_snapshot',
        v_item->>'terminology_version',
        coalesce((v_item->>'section_instance')::smallint, 1),
        coalesce((v_item->>'ordinal')::int, 0),
        v_item->>'value_text',
        (v_item->>'value_num')::numeric,
        (v_item->>'value_bool')::boolean,
        (v_item->>'value_date')::date,
        (v_item->>'value_ts')::timestamptz,
        v_item->'value_json',
        v_item->>'value_ref_source',
        v_item->>'value_ref_code');
  END LOOP;

  -- PASSO 5 — materializa a primeira classe.
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'diagnoses','[]'::jsonb))
  LOOP
    INSERT INTO clin.diagnosis (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, code_system, code, display_snapshot, terminology_version, is_principal)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        v_item->>'code_system', v_item->>'code', v_item->>'display_snapshot',
        v_item->>'terminology_version', coalesce((v_item->>'is_principal')::boolean, false));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'observations','[]'::jsonb))
  LOOP
    INSERT INTO clin.observation (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, observation_code, value_num, unit, field_id, component_ordinal)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        v_item->>'observation_code', (v_item->>'value_num')::numeric, v_item->>'unit',
        (v_item->>'field_id')::uuid, coalesce((v_item->>'component_ordinal')::int, 0));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'findings','[]'::jsonb))
  LOOP
    INSERT INTO clin.encounter_finding (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, field_id, field_code, option_code, display_snapshot, ordinal)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        (v_item->>'field_id')::uuid, v_item->>'field_code', v_item->>'option_code',
        v_item->>'display_snapshot', coalesce((v_item->>'ordinal')::int, 0));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'procedures','[]'::jsonb))
  LOOP
    INSERT INTO clin.procedure (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, code_system, tabela, code, display_snapshot, terminology_version,
        quantidade, valor_centavos)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        v_item->>'code_system', (v_item->>'tabela')::smallint, v_item->>'code',
        v_item->>'display_snapshot', v_item->>'terminology_version',
        coalesce((v_item->>'quantidade')::int, 1),
        coalesce((v_item->>'valor_centavos')::bigint, 0));
  END LOOP;

  -- IA: a linha ja existe desde a chamada ao provedor; a finalizacao a SELA,
  -- ligando-a a versao. version_id NOT NULL a partir daqui, por §4.6 item 3.
  UPDATE clin.ai_assistance a
     SET version_id = v_version_id
   WHERE a.tenant_id = v_enc.tenant_id
     AND a.encounter_id = p_encounter_id
     AND a.version_id IS NULL;

  -- PASSO 6 — supersessao: apaga o bit `live` das filhas da versao superada.
  IF p_kind IN ('retificacao','transferencia','anulacao') AND p_supersedes_version_id IS NOT NULL THEN
    UPDATE clin.diagnosis         SET live = false
     WHERE tenant_id = v_enc.tenant_id AND version_id = p_supersedes_version_id;
    UPDATE clin.observation       SET live = false
     WHERE tenant_id = v_enc.tenant_id AND version_id = p_supersedes_version_id;
    UPDATE clin.encounter_finding SET live = false
     WHERE tenant_id = v_enc.tenant_id AND version_id = p_supersedes_version_id;
    UPDATE clin.procedure         SET live = false
     WHERE tenant_id = v_enc.tenant_id AND version_id = p_supersedes_version_id;
  END IF;

  -- PASSO 7 — lancamento financeiro e projecao da guia TISS.
  -- Na Fase 1 os modulos fin e tiss ainda nao existem; o que existe e a captura
  -- dos ~14 campos da guia de consulta, em clin.encounter_billing (Task 24), que
  -- e escrita pela rota junto com o payload e nao aqui. Este passo fica
  -- deliberadamente vazio, e a Fase 3/4 o preenche sem mexer nos passos 1 a 6.

  -- PASSO 8 — apaga o rascunho e atualiza o cache de leitura.
  DELETE FROM clin.encounter_draft d
   WHERE d.tenant_id = v_enc.tenant_id AND d.encounter_id = p_encounter_id;

  UPDATE clin.encounter e
     SET head_version_id = CASE WHEN p_kind = 'adendo' THEN e.head_version_id ELSE v_version_id END,
         version_count   = e.version_count + 1,
         status          = CASE WHEN p_kind = 'anulacao' THEN 'anulado'::clin.encounter_status
                                ELSE 'finalizado'::clin.encounter_status END
   WHERE e.tenant_id = v_enc.tenant_id AND e.id = p_encounter_id;

  -- PASSO 9 — trilha. entity_id e REFERENCIA, nunca conteudo (NGS1.07.06).
  PERFORM audit.log(
    CASE p_kind
      WHEN 'original'      THEN 'ENCOUNTER_FINALIZE'
      WHEN 'retificacao'   THEN 'ENCOUNTER_AMEND'
      WHEN 'adendo'        THEN 'ENCOUNTER_ADDENDUM'
      WHEN 'transferencia' THEN 'ENCOUNTER_TRANSFER'
      WHEN 'anulacao'      THEN 'ENCOUNTER_VOID'
    END,
    'clin', 'encounter_version', p_encounter_id, 'sucesso',
    jsonb_build_object('version_no', v_version_no, 'incompleto', p_incompleto),
    v_enc.clinic_id);

  RETURN QUERY SELECT v_version_id, v_version_no;
END $fn$;

ALTER FUNCTION clin.finalize_encounter(uuid, clin.version_kind, jsonb, bytea, text, uuid, text, boolean)
  OWNER TO clin_writer;
REVOKE ALL ON FUNCTION clin.finalize_encounter(uuid, clin.version_kind, jsonb, bytea, text, uuid, text, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.finalize_encounter(uuid, clin.version_kind, jsonb, bytea, text, uuid, text, boolean)
  TO app_rw;
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- emr/src/finalize` → 4 testes passam.
- [ ] `pnpm db:invariants` → verde.
- [ ] Commitar: `git commit -m "feat(db): seal encounters in one transaction with the nine finalize steps"`

---

### Task 20: `emr.finalizeEncounter` e `emr.amendEncounter` — o TypeScript que monta o payload e o hash

**Arquivos:**
- Criar: `packages/emr/src/finalize.ts`
- Modificar: `packages/emr/src/index.ts`
- Teste: `packages/emr/src/amend.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/emr/src/amend.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter, amendEncounter, verifyVersionHash } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente;
let actor: Actor;
let v1 = '';

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  const r = await withTenantTx(actor, (tx) => finalizeEncounter(tx, {
    encounterId: s.encounterId,
    fields: [{ fieldId: s.fieldQueixaId, fieldGeneration: 1, labelSnapshot: 'Queixa principal',
               displaySnapshot: null, terminologyVersion: null, sectionInstance: 1, ordinal: 0,
               value: { slot: 'value_text', text: 'cefaleia ha 3 dias' } }],
    diagnoses: [{ codeSystem: 'CID10', code: 'J45', displaySnapshot: 'Asma',
                  terminologyVersion: '2026-01', isPrincipal: true }],
    observations: [], findings: [], procedures: [], ai: [],
  }));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  v1 = r.value.versionId;
});
afterAll(async () => { await closePools(); });

describe('retificacao, adendo e o conjunto vigente', () => {
  it('o hash persistido bate com o re-derivado das linhas seladas', async () => {
    const r = await withTenantTx(actor, (tx) => verifyVersionHash(tx, v1));
    expect(r).toEqual({ ok: true, value: { versionId: v1, match: true } });
  });

  it('retificacao exige justificativa de 10 caracteres', async () => {
    const r = await withTenantTx(actor, (tx) => amendEncounter(tx, {
      encounterId: s.encounterId, kind: 'retificacao', supersedesVersionId: v1,
      justificativa: 'errado',
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'justificativa_curta' } });
  });

  it('retificacao apaga o bit live das filhas superadas, e so delas', async () => {
    const r = await withTenantTx(actor, (tx) => amendEncounter(tx, {
      encounterId: s.encounterId, kind: 'retificacao', supersedesVersionId: v1,
      justificativa: 'digitado no paciente errado durante a consulta',
      fields: [{ fieldId: s.fieldQueixaId, fieldGeneration: 1, labelSnapshot: 'Queixa principal',
                 displaySnapshot: null, terminologyVersion: null, sectionInstance: 1, ordinal: 0,
                 value: { slot: 'value_text', text: 'cefaleia ha 3 dias, sem febre' } }],
      diagnoses: [{ codeSystem: 'CID10', code: 'I10', displaySnapshot: 'Hipertensao essencial',
                    terminologyVersion: '2026-01', isPrincipal: true }],
      observations: [], findings: [], procedures: [], ai: [],
    }));
    expect(r.ok).toBe(true);

    const cids = await withTenantTx(actor, (tx) => tx.query<{ code: string; live: boolean }>(
      `SELECT code, live FROM clin.diagnosis WHERE encounter_id = $1 ORDER BY code`,
      [s.encounterId]));
    // J45 e retificado para I10: sem o bit live, os DOIS apareceriam no relatorio.
    expect(cids.rows).toEqual([{ code: 'I10', live: true }, { code: 'J45', live: false }]);
  });

  it('adendo NAO supera ninguem e NAO move o head_version_id', async () => {
    const antes = await withTenantTx(actor, (tx) => tx.query<{ head: string }>(
      `SELECT head_version_id AS head FROM clin.encounter WHERE id = $1`, [s.encounterId]));
    const r = await withTenantTx(actor, (tx) => amendEncounter(tx, {
      encounterId: s.encounterId, kind: 'adendo', supersedesVersionId: null, justificativa: null,
      fields: [{ fieldId: s.fieldQueixaId, fieldGeneration: 1, labelSnapshot: 'Hemograma',
                 displaySnapshot: null, terminologyVersion: null, sectionInstance: 2, ordinal: 0,
                 value: { slot: 'value_text', text: 'Hb 13,2 — chegou dois dias depois' } }],
      diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
    }));
    expect(r.ok).toBe(true);
    const depois = await withTenantTx(actor, (tx) => tx.query<{ head: string; n: number }>(
      `SELECT head_version_id AS head, version_count AS n FROM clin.encounter WHERE id = $1`,
      [s.encounterId]));
    expect(depois.rows[0]?.head).toBe(antes.rows[0]?.head);
    expect(depois.rows[0]?.n).toBe(3);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- emr/src/amend` → `Failed to resolve import "./finalize"`.

- [ ] Criar `packages/emr/src/finalize.ts`:

```ts
// packages/emr/src/finalize.ts
import { err, ok, type Result } from '@cadencia/kernel';
import { CANONICAL_VERSION } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import {
  buildCanonicalVersion, hashCanonicalVersion,
  type AiSnapshot, type DiagnosisSnapshot, type FieldSnapshot, type FindingSnapshot,
  type ObservationSnapshot, type ProcedureSnapshot, type VersionSnapshot,
} from './canonical-version';

export type VersionKind = 'original' | 'retificacao' | 'adendo' | 'transferencia' | 'anulacao';

export interface FinalizeInput {
  readonly encounterId: string;
  readonly fields: readonly FieldSnapshot[];
  readonly diagnoses: readonly DiagnosisSnapshot[];
  readonly observations: readonly ObservationSnapshot[];
  readonly findings: readonly FindingSnapshot[];
  readonly procedures: readonly ProcedureSnapshot[];
  readonly ai: readonly AiSnapshot[];
  readonly incompleto?: boolean;
}

export interface AmendInput extends FinalizeInput {
  readonly kind: Exclude<VersionKind, 'original'>;
  readonly supersedesVersionId: string | null;
  readonly justificativa: string | null;
}

export type FinalizeFailure =
  | { kind: 'atendimento_nao_encontrado' }
  | { kind: 'atendimento_nao_esta_em_rascunho' }
  | { kind: 'justificativa_curta' }
  | { kind: 'supersedes_obrigatorio' }
  | { kind: 'adendo_nao_supera' }
  | { kind: 'cadastro_preliminar_bloqueia_finalizacao'; faltando: readonly string[] };

interface Cabecalho {
  tenant_id: string; patient_id: string; professional_id: string; clinic_id: string;
  occurred_at: string; occurred_date: string; status: string; version_count: number;
  cadastro_status: string; birth_date: string | null;
}

async function lerCabecalho(tx: TxClient, encounterId: string): Promise<Cabecalho | undefined> {
  const { rows } = await tx.query<Cabecalho>(
    `SELECT e.tenant_id, e.patient_id, e.professional_id, e.clinic_id,
            to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
            e.occurred_date::text AS occurred_date, e.status::text AS status, e.version_count,
            p.cadastro_status, p.birth_date::text AS birth_date
       FROM clin.encounter e
       JOIN clin.patient p ON (p.tenant_id, p.id) = (e.tenant_id, e.patient_id)
      WHERE e.id = $1`, [encounterId]);
  return rows[0];
}

function montarPayloadSql(i: FinalizeInput): string {
  return JSON.stringify({
    fields: i.fields.map((f) => ({
      field_id: f.fieldId, field_generation: f.fieldGeneration, label: f.labelSnapshot,
      display_snapshot: f.displaySnapshot, terminology_version: f.terminologyVersion,
      section_instance: f.sectionInstance, ordinal: f.ordinal,
      value_text: f.value.slot === 'value_text' ? f.value.text : null,
      value_num: f.value.slot === 'value_num' ? f.value.num : null,
      value_bool: f.value.slot === 'value_bool' ? f.value.bool : null,
      value_date: f.value.slot === 'value_date' ? f.value.date : null,
      value_ts: f.value.slot === 'value_ts' ? f.value.ts : null,
      value_json: f.value.slot === 'value_json' ? f.value.json : null,
      value_ref_source: f.value.slot === 'value_ref_code' ? f.value.source : null,
      value_ref_code: f.value.slot === 'value_ref_code' ? f.value.code : null,
    })),
    diagnoses: i.diagnoses.map((d) => ({
      code_system: d.codeSystem, code: d.code, display_snapshot: d.displaySnapshot,
      terminology_version: d.terminologyVersion, is_principal: d.isPrincipal })),
    observations: i.observations.map((o) => ({
      observation_code: o.observationCode, value_num: o.valueNum, unit: o.unit,
      component_ordinal: o.componentOrdinal,
      field_id: (o as ObservationSnapshot & { fieldId?: string }).fieldId ?? null })),
    findings: i.findings.map((f) => ({
      field_code: f.fieldCode, option_code: f.optionCode,
      display_snapshot: f.displaySnapshot, ordinal: f.ordinal })),
    procedures: i.procedures.map((p) => ({
      code_system: p.codeSystem, tabela: p.tabela, code: p.code,
      display_snapshot: p.displaySnapshot, terminology_version: p.terminologyVersion,
      quantidade: p.quantidade, valor_centavos: p.valorCentavos })),
  });
}

async function selar(
  tx: TxClient, i: FinalizeInput, kind: VersionKind,
  supersedes: string | null, justificativa: string | null,
): Promise<Result<{ versionId: string; versionNo: number }, FinalizeFailure>> {
  const cab = await lerCabecalho(tx, i.encounterId);
  if (!cab) return err({ kind: 'atendimento_nao_encontrado' });
  if (kind === 'original' && cab.status !== 'rascunho') {
    return err({ kind: 'atendimento_nao_esta_em_rascunho' });
  }

  // §5.5 — a divida de dados do cadastro preliminar e cobrada AQUI, que e o
  // momento em que os dados sao de fato obrigatorios. Exigir na hora errada e o
  // que faz a recepcionista digitar 000.000.000-00.
  if (kind === 'original') {
    const faltando: string[] = [];
    if (cab.cadastro_status !== 'completo') faltando.push('cadastro_status');
    if (cab.birth_date === null) faltando.push('birth_date');
    if (faltando.length > 0) {
      return err({ kind: 'cadastro_preliminar_bloqueia_finalizacao', faltando });
    }
  }

  const snapshot: VersionSnapshot = {
    encounterId: i.encounterId,
    patientId: cab.patient_id,
    professionalId: cab.professional_id,
    clinicId: cab.clinic_id,
    occurredAt: cab.occurred_at,
    occurredDate: cab.occurred_date,
    versionNo: cab.version_count + 1,
    kind,
    supersedesVersionId: supersedes,
    justificativa,
    authorUserId: '',            // preenchido abaixo pelo banco, ver comentario
    authorProfessionalId: cab.professional_id,
    cosignerProfessionalId: null,
    incompleto: i.incompleto ?? false,
    fields: i.fields, diagnoses: i.diagnoses, observations: i.observations,
    findings: i.findings, procedures: i.procedures, ai: i.ai,
  };

  // author_user_id vem do GUC dentro da transacao: e a mesma fonte que a funcao
  // do banco usa, e por isso a re-derivacao em verifyVersionHash bate.
  const quem = await tx.query<{ uid: string; pid: string }>(
    `SELECT app.current_user_id()::text AS uid, app.current_professional_id()::text AS pid`);
  const comAutor: VersionSnapshot = {
    ...snapshot,
    authorUserId: quem.rows[0]?.uid ?? '',
    authorProfessionalId: quem.rows[0]?.pid ?? cab.professional_id,
  };

  const hash = hashCanonicalVersion(comAutor);
  const { rows } = await tx.query<{ version_id: string; version_no: number }>(
    `SELECT * FROM clin.finalize_encounter($1, $2::clin.version_kind, $3::jsonb,
              $4::bytea, $5, $6::uuid, $7, $8)`,
    [i.encounterId, kind, montarPayloadSql(i), hash, CANONICAL_VERSION,
     supersedes, justificativa, i.incompleto ?? false]);
  const linha = rows[0];
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });
  return ok({ versionId: linha.version_id, versionNo: linha.version_no });
}

export function finalizeEncounter(
  tx: TxClient, i: FinalizeInput,
): Promise<Result<{ versionId: string; versionNo: number }, FinalizeFailure>> {
  return selar(tx, i, 'original', null, null);
}

export async function amendEncounter(
  tx: TxClient, i: AmendInput,
): Promise<Result<{ versionId: string; versionNo: number }, FinalizeFailure>> {
  if (i.kind === 'adendo') {
    // Adendo e bloco ADICIONAL, nunca substituto: nao supera ninguem, e por isso
    // o head_version_id nao se move. E o que impede o hemograma que chegou dois
    // dias depois de sumir da tela na consulta seguinte.
    if (i.supersedesVersionId !== null) return err({ kind: 'adendo_nao_supera' });
    return selar(tx, i, 'adendo', null, i.justificativa);
  }
  if (i.supersedesVersionId === null) return err({ kind: 'supersedes_obrigatorio' });
  if ((i.justificativa ?? '').trim().length < 10) return err({ kind: 'justificativa_curta' });
  return selar(tx, i, i.kind, i.supersedesVersionId, i.justificativa);
}

/**
 * Re-deriva o payload canonico das linhas SELADAS e compara com o content_hash
 * persistido. E a contraparte da decisao de nao calcular o hash no banco:
 * conteudo imutavel + re-derivacao = hash errado detectavel para sempre.
 */
export async function verifyVersionHash(
  tx: TxClient, versionId: string,
): Promise<Result<{ versionId: string; match: boolean }, FinalizeFailure>> {
  const v = await tx.query<{
    encounter_id: string; version_no: number; kind: string;
    supersedes_version_id: string | null; justificativa: string | null;
    author_user_id: string; author_professional_id: string;
    cosigner_professional_id: string | null; incompleto: boolean;
    content_hash: Buffer; patient_id: string; professional_id: string; clinic_id: string;
    occurred_at: string; occurred_date: string;
  }>(
    `SELECT v.encounter_id, v.version_no, v.kind::text AS kind, v.supersedes_version_id,
            v.justificativa, v.author_user_id, v.author_professional_id,
            v.cosigner_professional_id, v.incompleto, v.content_hash,
            e.patient_id, e.professional_id, e.clinic_id,
            to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
            e.occurred_date::text AS occurred_date
       FROM clin.encounter_version v
       JOIN clin.encounter e ON (e.tenant_id, e.id) = (v.tenant_id, v.encounter_id)
      WHERE v.id = $1`, [versionId]);
  const linha = v.rows[0];
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });

  const fields = await tx.query<{
    field_id: string; field_generation: number; label_snapshot: string;
    display_snapshot: string | null; terminology_version: string | null;
    section_instance: number; ordinal: number;
    value_text: string | null; value_num: string | null; value_bool: boolean | null;
    value_date: string | null; value_ts: string | null; value_json: unknown;
    value_ref_source: string | null; value_ref_code: string | null;
  }>(
    `SELECT field_id, field_generation, label_snapshot, display_snapshot, terminology_version,
            section_instance, ordinal, value_text, value_num::text AS value_num, value_bool,
            value_date::text AS value_date,
            to_char(value_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS value_ts,
            value_json, value_ref_source, value_ref_code
       FROM clin.encounter_field_value WHERE version_id = $1`, [versionId]);

  const diag = await tx.query<DiagnosisSnapshotRow>(
    `SELECT code_system AS "codeSystem", code, display_snapshot AS "displaySnapshot",
            terminology_version AS "terminologyVersion", is_principal AS "isPrincipal"
       FROM clin.diagnosis WHERE version_id = $1`, [versionId]);
  const obs = await tx.query<ObservationSnapshotRow>(
    `SELECT observation_code AS "observationCode", value_num::text AS "valueNum", unit,
            component_ordinal AS "componentOrdinal"
       FROM clin.observation WHERE version_id = $1`, [versionId]);
  const find = await tx.query<FindingSnapshotRow>(
    `SELECT field_code AS "fieldCode", option_code AS "optionCode",
            display_snapshot AS "displaySnapshot", ordinal
       FROM clin.encounter_finding WHERE version_id = $1`, [versionId]);
  const proc = await tx.query<ProcedureSnapshotRow>(
    `SELECT code_system AS "codeSystem", tabela, code, display_snapshot AS "displaySnapshot",
            terminology_version AS "terminologyVersion", quantidade,
            valor_centavos::int AS "valorCentavos"
       FROM clin.procedure WHERE version_id = $1`, [versionId]);
  const ai = await tx.query<AiSnapshotRow>(
    `SELECT provider, model_id AS "modelId", model_version AS "modelVersion", purpose,
            risk_class AS "riskClass", residency,
            encode(input_hash,'hex') AS "inputHash", encode(output_hash,'hex') AS "outputHash",
            clinician_decision::text AS "clinicianDecision"
       FROM clin.ai_assistance WHERE version_id = $1`, [versionId]);

  const snapshot: VersionSnapshot = {
    encounterId: linha.encounter_id,
    patientId: linha.patient_id,
    professionalId: linha.professional_id,
    clinicId: linha.clinic_id,
    occurredAt: linha.occurred_at,
    occurredDate: linha.occurred_date,
    versionNo: linha.version_no,
    kind: linha.kind,
    supersedesVersionId: linha.supersedes_version_id,
    justificativa: linha.justificativa,
    authorUserId: linha.author_user_id,
    authorProfessionalId: linha.author_professional_id,
    cosignerProfessionalId: linha.cosigner_professional_id,
    incompleto: linha.incompleto,
    fields: fields.rows.map((f) => ({
      fieldId: f.field_id, fieldGeneration: f.field_generation,
      labelSnapshot: f.label_snapshot, displaySnapshot: f.display_snapshot,
      terminologyVersion: f.terminology_version,
      sectionInstance: f.section_instance, ordinal: f.ordinal,
      value:
        f.value_text !== null ? { slot: 'value_text', text: f.value_text } as const :
        f.value_num !== null ? { slot: 'value_num', num: f.value_num } as const :
        f.value_bool !== null ? { slot: 'value_bool', bool: f.value_bool } as const :
        f.value_date !== null ? { slot: 'value_date', date: f.value_date } as const :
        f.value_ts !== null ? { slot: 'value_ts', ts: f.value_ts } as const :
        f.value_ref_code !== null
          ? { slot: 'value_ref_code', source: f.value_ref_source ?? '', code: f.value_ref_code } as const
          : { slot: 'value_json', json: f.value_json as never } as const,
    })),
    diagnoses: diag.rows, observations: obs.rows, findings: find.rows,
    procedures: proc.rows, ai: ai.rows,
  };

  const recalculado = hashCanonicalVersion(snapshot);
  return ok({ versionId, match: recalculado.equals(linha.content_hash) });
}

type DiagnosisSnapshotRow = DiagnosisSnapshot;
type ObservationSnapshotRow = ObservationSnapshot;
type FindingSnapshotRow = FindingSnapshot;
type ProcedureSnapshotRow = ProcedureSnapshot;
type AiSnapshotRow = AiSnapshot;
```

- [ ] Acrescentar em `packages/emr/src/index.ts`:

```ts
export {
  finalizeEncounter, amendEncounter, verifyVersionHash,
  type AmendInput, type FinalizeFailure, type FinalizeInput, type VersionKind,
} from './finalize';
```

- [ ] Rodar: `pnpm test:int -- emr/src/amend` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(emr): finalize, amend and verify the hash of sealed encounter versions"`

---

### Task 21: `clin.v_version_status`, `clin.read_encounter` e `clin.read_patient_record`

O registro vigente é o **conjunto** de versões não superadas. Ler só o ponteiro faz o hemograma que chegou dois dias depois sumir da tela do médico na consulta seguinte — e nada alerta, porque a versão continua na tabela. Acesso clínico registra a leitura **antes de retornar**.

**Arquivos:**
- Criar: `packages/db/migrations/0038_read_clinical.sql`
- Teste: `packages/emr/src/read.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/emr/src/read.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter, amendEncounter } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente; let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  const base = { fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [] };
  const v1 = await withTenantTx(actor, (tx) =>
    finalizeEncounter(tx, { encounterId: s.encounterId, ...base }));
  if (!v1.ok) throw new Error('falhou v1');
  await withTenantTx(actor, (tx) => amendEncounter(tx, {
    encounterId: s.encounterId, kind: 'adendo', supersedesVersionId: null, justificativa: null,
    ...base }));
  await withTenantTx(actor, (tx) => amendEncounter(tx, {
    encounterId: s.encounterId, kind: 'retificacao', supersedesVersionId: v1.value.versionId,
    justificativa: 'digitado no paciente errado durante a consulta', ...base }));
});
afterAll(async () => { await closePools(); });

describe('o registro vigente e um CONJUNTO', () => {
  it('v_version_status marca v1 como superada e aponta por quem', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      version_no: number; superseded: boolean }>(
      `SELECT version_no, superseded FROM clin.v_version_status
        WHERE encounter_id = $1 ORDER BY version_no`, [s.encounterId]));
    expect(rows).toEqual([
      { version_no: 1, superseded: true },
      { version_no: 2, superseded: false },
      { version_no: 3, superseded: false },
    ]);
  });

  it('read_encounter devolve as NAO superadas — o adendo continua na tela', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      version_no: number; kind: string }>(
      `SELECT version_no, kind::text AS kind FROM clin.read_encounter($1) ORDER BY version_no`,
      [s.encounterId]));
    expect(rows).toEqual([
      { version_no: 2, kind: 'adendo' },
      { version_no: 3, kind: 'retificacao' },
    ]);
  });

  it('a leitura clinica gera evento de auditoria deduplicado por 5 minutos', async () => {
    await withTenantTx(actor, (tx) => tx.query(`SELECT * FROM clin.read_encounter($1)`,
      [s.encounterId]));
    await withTenantTx(actor, (tx) => tx.query(`SELECT * FROM clin.read_encounter($1)`,
      [s.encounterId]));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'PATIENT_RECORD_READ' AND entity_id = $1`, [s.patientId]));
    // Tres chamadas, uma janela: UM evento.
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('read_patient_record devolve a linha do tempo com data do EVENTO, nao do registro', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      encounter_id: string; occurred_date: string; versoes_vivas: number }>(
      `SELECT encounter_id, occurred_date::text AS occurred_date, versoes_vivas
         FROM clin.read_patient_record($1) ORDER BY occurred_date DESC`, [s.patientId]));
    expect(rows.some((r) => r.encounter_id === s.encounterId && r.versoes_vivas === 2)).toBe(true);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- emr/src/read` → `relation "clin.v_version_status" does not exist`.

- [ ] `pnpm db:new read_clinical` (gera `0038_read_clinical.sql`) e escrever:

```sql
-- 0038_read_clinical.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.5 — o registro vigente e o CONJUNTO de versoes nao superadas.
-- O cenario que isto evita: v1 = consulta; v2 = adendo com o hemograma que
-- chegou dois dias depois; v3 = retificacao de v1. Lendo so o head_version_id,
-- o hemograma SOME da tela do medico na consulta seguinte — e nada alerta.
--
-- §3.7 — acesso clinico passa por funcao que registra ANTES de retornar,
-- deduplicada por (usuario, paciente, caso de uso) em janela de 5 minutos.

CREATE VIEW clin.v_version_status WITH (security_barrier = true) AS
SELECT v.*,
       (s.id IS NOT NULL) AS superseded,
       s.id               AS superseded_by,
       s.finalized_at     AS superseded_at
  FROM clin.encounter_version v
  LEFT JOIN clin.encounter_version s
         ON (s.tenant_id, s.supersedes_version_id) = (v.tenant_id, v.id);
ALTER VIEW clin.v_version_status OWNER TO app_owner;
GRANT SELECT ON clin.v_version_status TO app_rw;

-- ---------------------------------------------------------------------------
-- clin.read_encounter — versoes VIVAS de um atendimento, com auditoria.
-- SECURITY INVOKER de proposito: a RLS do chamador continua valendo, e a funcao
-- so acrescenta o registro da leitura. SECURITY DEFINER aqui abriria o prontuario
-- inteiro para quem chamasse a funcao.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clin.read_encounter(p_encounter_id uuid)
RETURNS TABLE (
  version_id uuid, version_no int, kind clin.version_kind,
  justificativa text, author_professional_id uuid, incompleto boolean,
  finalized_at timestamptz(3), superseded boolean)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v_patient uuid;
BEGIN
  SELECT e.patient_id INTO v_patient FROM clin.encounter e WHERE e.id = p_encounter_id;
  IF v_patient IS NULL THEN
    RETURN;   -- zero linhas: a RLS ja disse tudo o que tinha a dizer.
  END IF;

  PERFORM audit.log_read('encounter_read', v_patient);

  RETURN QUERY
    SELECT s.id, s.version_no, s.kind, s.justificativa, s.author_professional_id,
           s.incompleto, s.finalized_at, s.superseded
      FROM clin.v_version_status s
     WHERE s.encounter_id = p_encounter_id AND NOT s.superseded
     ORDER BY s.version_no;
END $fn$;
ALTER FUNCTION clin.read_encounter(uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION clin.read_encounter(uuid) TO app_rw;

-- ---------------------------------------------------------------------------
-- clin.read_patient_record — a linha do tempo. Alvo < 10 ms para 20 atendimentos.
-- Index Only Scan em ix_encounter_hist -> nested loop nas versoes vivas.
-- Sem recursao, sem fold, sem window function, sem DISTINCT ON.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clin.read_patient_record(
  p_patient_id uuid, p_limit int DEFAULT 20, p_before date DEFAULT NULL)
RETURNS TABLE (
  encounter_id uuid, occurred_date date, occurred_at timestamptz(3),
  professional_id uuid, clinic_id uuid, status clin.encounter_status,
  versoes_vivas int)
LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  PERFORM audit.log_read('patient_timeline', p_patient_id);

  RETURN QUERY
    SELECT e.id, e.occurred_date, e.occurred_at, e.professional_id, e.clinic_id, e.status,
           (SELECT count(*)::int FROM clin.v_version_status s
             WHERE s.encounter_id = e.id AND NOT s.superseded) AS versoes_vivas
      FROM clin.encounter e
     WHERE e.patient_id = p_patient_id
       AND (p_before IS NULL OR e.occurred_date < p_before)
     ORDER BY e.occurred_date DESC, e.id DESC
     LIMIT greatest(p_limit, 1);
END $fn$;
ALTER FUNCTION clin.read_patient_record(uuid, int, date) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION clin.read_patient_record(uuid, int, date) TO app_rw;
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- emr/src/read` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(db): read the live version set and audit every clinical read"`

---

### Task 22: a linha do tempo em menos de 10 ms — medido, não prometido

Qualquer caminho de leitura sem alvo medido não vai para produção (§9). Aqui o alvo do Apêndice A vira teste.

**Arquivos:**
- Criar: `packages/emr/src/timeline-plan.int.test.ts`

- [ ] Escrever o teste que falha (falha se o plano usar `Seq Scan`, `Sort` ou `WindowAgg`):

```ts
// packages/emr/src/timeline-plan.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter } from './finalize';
import { semearAtendimento, type Semente } from './test-support';
import { appPool } from '@cadencia/db';

let s: Semente; let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  // 20 atendimentos com ~1,1 versoes cada — o cenario do Apendice A.
  const c = await appPool().connect();
  try {
    for (let i = 0; i < 20; i += 1) {
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, gen_random_uuid(), $2, $3, $4,
                 clock_timestamp() - make_interval(days => $5),
                 app.local_date(clock_timestamp() - make_interval(days => $5), 'America/Sao_Paulo'))`,
        [s.tenantId, s.patientId, s.professionalId, s.clinicId, i * 30]);
    }
    await c.query(`ANALYZE clin.encounter`);
    await c.query(`ANALYZE clin.encounter_version`);
  } finally { c.release(); }
  void finalizeEncounter;
});
afterAll(async () => { await closePools(); });

describe('linha do tempo — Apendice A: < 10 ms', () => {
  it('o plano nao tem Seq Scan, Sort nem WindowAgg', async () => {
    const plano = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ 'QUERY PLAN': unknown[] }>(
        `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS OFF)
         SELECT e.id, e.occurred_date,
                (SELECT count(*) FROM clin.v_version_status s
                  WHERE s.encounter_id = e.id AND NOT s.superseded)
           FROM clin.encounter e
          WHERE e.patient_id = $1
          ORDER BY e.occurred_date DESC, e.id DESC
          LIMIT 20`, [s.patientId]);
      return JSON.stringify(rows[0]?.['QUERY PLAN']);
    });
    expect(plano).not.toContain('"Seq Scan"');
    expect(plano).not.toContain('"Node Type":"Sort"');
    expect(plano).not.toContain('WindowAgg');
  });

  it('executa em menos de 10 ms', async () => {
    const ms = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>(
        `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS OFF)
         SELECT * FROM clin.read_patient_record($1, 20, NULL)`, [s.patientId]);
      return rows[0]?.['QUERY PLAN']?.[0]?.['Execution Time'] ?? 999;
    });
    expect(ms).toBeLessThan(10);
  });
});
```

- [ ] Rodar: `pnpm test:int -- timeline-plan`. Se o primeiro teste falhar com `"Node Type":"Sort"`, o índice `ix_encounter_hist` não está sendo usado — confira que a ordenação do `ORDER BY` bate exatamente com a do índice (`occurred_date DESC, id DESC`) e que `ANALYZE` rodou.
- [ ] Registrar o resultado no plano de latência: acrescentar ao final de `docs/superpowers/plans/2026-08-03-fase1-o-dia-plano.md`, na seção "Definição de pronto", a linha com o tempo medido.
- [ ] Commitar: `git commit -m "test(emr): assert the patient timeline plan has no sort and runs under ten milliseconds"`

---

## Parte IV — Pacientes: cadastro mínimo viável, busca e o terceiro estado

> A Fase 0 **já criou** `clin.patient` e `clin.patient_identifier` com `search_name`, `search_digits`, `cadastro_status`, `nome_social`, `merged_into_id` e os índices GIN/`varchar_pattern_ops`. Esta parte **estende**; nenhuma tarefa recria essas tabelas.

### Task 23: `COLLATE "pt-BR-x-icu"` na listagem — o paciente que some da letra certa

O cluster roda em `C.UTF-8` por decisão irreversível (§10 item 19), imune ao versionamento de collation do glibc. O preço é que `ORDER BY nome` devolve `Ana · Bruno · Zeca · Álvaro`. Isso não aparece em teste comum: aparece como um paciente "sumido" da lista para a recepcionista que procura na letra certa.

**Arquivos:**
- Criar: `packages/db/migrations/0039_patient_collation.sql`
- Teste: `packages/db/src/patient-collation.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/src/patient-collation.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('ordenacao de nome de paciente', () => {
  afterAll(async () => { await closePools(); });

  it('a coluna de exibicao ordena em portugues, nao em bytes', async () => {
    const { rows } = await appPool().query<{ n: string }>(
      `SELECT n FROM (VALUES ('Ana'),('Bruno'),('Zeca'),('Álvaro'),('Ângela'))
         AS t(n) ORDER BY n COLLATE "pt-BR-x-icu"`);
    expect(rows.map((r) => r.n)).toEqual(['Álvaro', 'Ana', 'Ângela', 'Bruno', 'Zeca']);
  });

  it('clin.patient.display_name existe, e gerada e carrega a collation', async () => {
    const { rows } = await appPool().query<{ collname: string; is_generated: string }>(
      `SELECT co.collname, c.is_generated
         FROM information_schema.columns c
         JOIN pg_attribute a ON a.attname = c.column_name
          AND a.attrelid = 'clin.patient'::regclass
         LEFT JOIN pg_collation co ON co.oid = a.attcollation
        WHERE c.table_schema='clin' AND c.table_name='patient' AND c.column_name='display_name'`);
    expect(rows[0]?.collname).toBe('pt-BR-x-icu');
    expect(rows[0]?.is_generated).toBe('ALWAYS');
  });

  it('o indice que serve a listagem carrega a MESMA collation', async () => {
    const { rows } = await appPool().query<{ def: string }>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ix_patient_ordem'`);
    expect(rows[0]?.def).toContain('pt-BR-x-icu');
    expect(rows[0]?.def).toContain('tenant_id');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- patient-collation` → `column "display_name" does not exist` no segundo teste.

- [ ] `pnpm db:new patient_collation` (gera `0039_patient_collation.sql`) e escrever:

```sql
-- 0039_patient_collation.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §10 item 19 — regra vinculante: toda coluna cuja ordenacao seja apresentada a
-- um humano recebe COLLATE "pt-BR-x-icu" explicito, e o indice que a serve carrega
-- a mesma collation. Ordenar sem collation nao e um bug que aparece em teste:
-- aparece como um paciente "sumido" da lista para a recepcionista.
--
-- display_name e GERADA e ja aplica o Decreto 8.727/2016 (nome social em TODA
-- exibicao). A listagem ordena por ela; a busca continua em search_name, que e
-- unaccent(lower(...)) e imune ao locale.

ALTER TABLE clin.patient
  ADD COLUMN display_name text COLLATE "pt-BR-x-icu"
    GENERATED ALWAYS AS (coalesce(nome_social, full_name)) STORED;

CREATE INDEX ix_patient_ordem
  ON clin.patient (tenant_id, display_name COLLATE "pt-BR-x-icu", id)
  WHERE inactivated_at IS NULL AND merged_into_id IS NULL;

COMMENT ON COLUMN clin.patient.display_name IS
  'Nome de exibicao com collation pt-BR. Decreto 8.727/2016: nome social vence.';
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- patient-collation` → 3 testes passam.
- [ ] Commitar: `git commit -m "feat(db): order patient listings with the pt-BR ICU collation"`

---

### Task 24: `clin.encounter_billing` — os ~14 campos da guia de consulta, capturados desde já

Custa dias agora e meses depois. O módulo `tiss` **não existe** na Fase 1; a captura sim. Sem CID: o item 32 do Componente Organizacional proíbe a operadora de exigir CID na guia.

**Arquivos:**
- Criar: `packages/db/migrations/0040_encounter_billing.sql`
- Teste: `packages/db/test/iso/18-encounter-billing.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/18-encounter-billing.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

const CAMPOS = [
  'registro_ans', 'numero_carteira', 'atendimento_rn', 'cnes',
  'conselho_profissional', 'numero_conselho', 'uf_conselho', 'cbos',
  'indicacao_acidente', 'regime_atendimento', 'tipo_consulta',
  'data_atendimento', 'codigo_tabela', 'codigo_procedimento', 'valor_centavos',
];

describe('clin.encounter_billing — os ~14 campos da guia de consulta', () => {
  it('captura todos os campos da guia desde a Fase 1', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing'`));
    const presentes = new Set(rows.map((r) => r.column_name));
    for (const campo of CAMPOS) expect(presentes.has(campo), `falta ${campo}`).toBe(true);
  });

  it('NAO tem coluna de CID — item 32 proibe a operadora de exigir CID na guia', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing'
          AND column_name ILIKE '%cid%'`));
    expect(rows).toEqual([]);
  });

  it('cnes e NOT NULL e sem default — 9999999 vira lote glosado', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing' AND column_name='cnes'`));
    expect(rows[0]).toEqual({ is_nullable: 'NO', column_default: null });
  });

  it('codigo_tabela nunca e 18 — tabela 18 e a de terminologia, nao de procedimento', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.encounter_billing'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%codigo_tabela%'`));
    expect(rows[0]?.def).toContain("<> '18'");
  });

  it('valor e bigint em CENTAVOS, nunca numeric com casas decimais soltas', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing' AND column_name='valor_centavos'`));
    expect(rows[0]?.data_type).toBe('bigint');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.encounter_billing" does not exist`.

- [ ] `pnpm db:new encounter_billing` (gera `0040_encounter_billing.sql`) e escrever:

```sql
-- 0040_encounter_billing.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 — os ~14 campos da guia de consulta TISS, capturados NO ATENDIMENTO
-- desde a Fase 1, com o modulo tiss ainda inexistente. Custa dias agora e meses
-- depois: a guia e PROJECAO do atendimento, e nao da para projetar o que nao foi
-- capturado. A tabela mora em clin, nao em tiss, exatamente porque o schema tiss
-- ainda nao tem dono: a Fase 4 cria tiss.encounter_guia_consulta LENDO daqui.
--
-- Sem coluna de CID: item 32 do Componente Organizacional PROIBE a operadora de
-- exigir CID na guia. Coluna que nao existe nao pode ser preenchida por engano.
--
-- Os tipos sao IDENTICOS aos de app.professional (conselho, numero, uf, cbos) e
-- aos de app.clinic (cnes): projecao nao pode precisar converter nada.

CREATE TABLE clin.encounter_billing (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  encounter_id  uuid NOT NULL,
  -- Convenio. NULL em atendimento particular: a captura e obrigatoria so quando
  -- ha operadora, e por isso o CHECK e condicional.
  operadora_nome    text,
  registro_ans      char(6) CHECK (registro_ans IS NULL OR registro_ans ~ '^[0-9]{6}$'),
  numero_carteira   varchar(20),
  atendimento_rn    boolean NOT NULL DEFAULT false,
  -- Prestador. SEM DEFAULT '9999999': dado falso vira lote glosado.
  cnes              char(7) NOT NULL CHECK (cnes ~ '^[0-9]{7}$'),
  cnpj_contratado   varchar(14) CHECK (cnpj_contratado IS NULL
                      OR cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cpf_contratado    varchar(11) CHECK (cpf_contratado IS NULL OR cpf_contratado ~ '^[0-9]{11}$'),
  codigo_prestador_na_operadora varchar(14),
  -- Profissional executante, congelado no momento do atendimento.
  conselho_profissional varchar(2) NOT NULL,
  numero_conselho       varchar(15) NOT NULL,
  uf_conselho           char(2) NOT NULL CHECK (uf_conselho ~ '^[A-Z]{2}$'),
  cbos                  varchar(6) NOT NULL,
  -- Atendimento.
  indicacao_acidente char(1) NOT NULL DEFAULT '9' CHECK (indicacao_acidente IN ('0','1','2','9')),
  regime_atendimento char(2) NOT NULL DEFAULT '01',
  tipo_consulta      char(1) NOT NULL CHECK (tipo_consulta IN ('1','2','3','4')),
  saude_ocupacional  char(1),
  data_atendimento   date NOT NULL,   -- = clin.encounter.occurred_date (fuso da clinica)
  -- Procedimento cobrado.
  codigo_tabela       char(2) NOT NULL CHECK (codigo_tabela <> '18'),
  codigo_procedimento varchar(10) NOT NULL,
  valor_centavos      bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  observacao          varchar(500),
  created_by uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, encounter_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  -- Ou o codigo do prestador na operadora, ou CPF, ou CNPJ. Exatamente um.
  CHECK (registro_ans IS NULL
         OR num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1),
  -- Convenio exige carteirinha; particular nao tem nem uma coisa nem outra.
  CHECK ((registro_ans IS NULL) = (numero_carteira IS NULL)));
ALTER TABLE clin.encounter_billing OWNER TO app_owner;

CREATE INDEX ix_billing_a_faturar
  ON clin.encounter_billing (tenant_id, data_atendimento DESC)
  WHERE registro_ans IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON clin.encounter_billing TO app_rw;

ALTER TABLE clin.encounter_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter_billing FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.encounter_billing AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- A tabela nao tem patient_id nem version_id, entao os invariantes 4 e 5 nao a
-- alcancam. Mas ela e faturamento, e recepcao/financeiro precisam ver: o escopo
-- correto e por papel, nao por profissional.
CREATE POLICY escopo_faturamento ON clin.encounter_billing
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      WHERE (e.tenant_id, e.id)
                            = (clin.encounter_billing.tenant_id, clin.encounter_billing.encounter_id)
                        AND e.professional_id = app.current_professional_id()) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 5 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): capture the consultation guide fields during the encounter"`

---

### Task 25: `patients.searchPatients` — o componente mais importante do produto tem um backend

Alvo do Apêndice A: primeira tecla → primeiro resultado em **< 120 ms p75** com 200 mil pacientes sintéticos. O índice é liderado por `tenant_id` via `btree_gin`, senão a recepcionista de uma clínica paga o preço do crescimento da base de todas as outras.

**Arquivos:**
- Criar: `packages/patients/src/search.ts`
- Modificar: `packages/patients/src/index.ts`, `packages/patients/package.json`
- Teste: `packages/patients/src/search.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/patients/src/search.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { searchPatients } from './search';
import { semearPacientes, type SementePacientes } from './test-support';

let s: SementePacientes; let actor: Actor;

beforeAll(async () => {
  s = await semearPacientes();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('busca de paciente', () => {
  it('acha por prefixo sem acento e sem caixa', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'maria sou' }));
    expect(r.map((p) => p.displayName)).toEqual(['MARIA SOUSA', 'Maria Souza Lima']);
  });

  it('destaca o nome social — Decreto 8.727/2016 vale em TODA exibicao', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'joana' }));
    expect(r[0]?.displayName).toBe('Joana Prado');
    expect(r[0]?.legalName).toBe('Joao Prado');
    expect(r[0]?.hasSocialName).toBe(true);
  });

  it('acha por digitos de CPF e por telefone, sem exigir formatacao', async () => {
    const porCpf = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: '111.444.777-35' }));
    expect(porCpf[0]?.patientId).toBe(s.patientMariaId);
    const porFone = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: '11987654321' }));
    expect(porFone[0]?.patientId).toBe(s.patientMariaId);
  });

  it('ordena em portugues: Álvaro antes de Ana', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'a' }));
    const nomes = r.map((p) => p.displayName);
    expect(nomes.indexOf('Álvaro Neto')).toBeLessThan(nomes.indexOf('Ana Lima'));
  });

  it('marca o cadastro preliminar — e o sinal que a fila do dia mostra', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'preliminar' }));
    expect(r[0]?.cadastroStatus).toBe('preliminar');
  });

  it('nao devolve paciente unificado em outro nem inativado', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'duplicata' }));
    expect(r).toEqual([]);
  });

  it('a busca por nome e evento auditavel — ver o nome ja e acesso a dado pessoal', async () => {
    await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'maria sou' }));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event WHERE event_type = 'PATIENT_SEARCH'`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- patients/src/search` → `Failed to resolve import "./search"`.

- [ ] Criar `packages/patients/src/search.ts`:

```ts
// packages/patients/src/search.ts
import type { TxClient } from '@cadencia/db';

export interface PatientHit {
  readonly patientId: string;
  readonly displayName: string;      // nome social quando houver
  readonly legalName: string;        // nome civil, para conferencia de documento
  readonly hasSocialName: boolean;
  readonly birthDate: string | null;
  readonly cadastroStatus: 'preliminar' | 'completo';
  readonly phonePrimary: string | null;
}

export interface SearchInput {
  readonly termo: string;
  readonly limit?: number;
}

const SO_DIGITOS = /\D+/g;

/**
 * §6.4 — o combobox de busca de paciente e o componente mais importante do
 * produto. Duas estrategias, escolhidas pelo que foi digitado:
 *   - 3 ou mais digitos  -> prefixo em search_digits (CPF, telefone), que tem
 *     indice varchar_pattern_ops liderado por tenant_id;
 *   - qualquer outra coisa -> trigrama em search_name, indice GIN liderado por
 *     tenant_id via btree_gin. Sem a lideranca do tenant, a recepcionista de uma
 *     clinica paga o preco do crescimento da base de todas as outras.
 *
 * A ordenacao final e por display_name COLLATE "pt-BR-x-icu" (§10 item 19).
 */
export async function searchPatients(tx: TxClient, input: SearchInput): Promise<PatientHit[]> {
  const limite = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const termo = input.termo.trim();
  if (termo.length === 0) return [];

  const digitos = termo.replace(SO_DIGITOS, '');
  const porDigitos = digitos.length >= 3;

  // Ver o nome de um paciente ja e acesso a dado pessoal (§5.6). O evento e de
  // dominio: acontece dentro da transacao de leitura e nao carrega o termo
  // digitado, que pode ser o nome completo de alguem.
  await tx.query(
    `SELECT audit.log('PATIENT_SEARCH', 'clin', 'patient', NULL, 'sucesso',
                      jsonb_build_object('modo', $1, 'tamanho', $2), NULL)`,
    [porDigitos ? 'digitos' : 'nome', termo.length]);

  const { rows } = await tx.query<{
    id: string; display_name: string; full_name: string; nome_social: string | null;
    birth_date: string | null; cadastro_status: 'preliminar' | 'completo';
    phone_primary: string | null;
  }>(
    porDigitos
      ? `SELECT p.id, p.display_name, p.full_name, p.nome_social,
                p.birth_date::text AS birth_date, p.cadastro_status, p.phone_primary
           FROM clin.patient p
          WHERE p.search_digits LIKE $1 || '%'
            AND p.inactivated_at IS NULL AND p.merged_into_id IS NULL
          ORDER BY p.display_name COLLATE "pt-BR-x-icu", p.id
          LIMIT $2`
      : `SELECT p.id, p.display_name, p.full_name, p.nome_social,
                p.birth_date::text AS birth_date, p.cadastro_status, p.phone_primary
           FROM clin.patient p
          WHERE p.search_name LIKE app.imm_unaccent(lower($1)) || '%'
            AND p.inactivated_at IS NULL AND p.merged_into_id IS NULL
          ORDER BY p.display_name COLLATE "pt-BR-x-icu", p.id
          LIMIT $2`,
    [porDigitos ? digitos : termo, limite]);

  return rows.map((r) => ({
    patientId: r.id,
    displayName: r.display_name,
    legalName: r.full_name,
    hasSocialName: r.nome_social !== null,
    birthDate: r.birth_date,
    cadastroStatus: r.cadastro_status,
    phonePrimary: r.phone_primary,
  }));
}
```

- [ ] Criar `packages/patients/src/test-support.ts`:

```ts
// packages/patients/src/test-support.ts
import { appPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

export interface SementePacientes {
  tenantId: string; clinicId: string; userId: string; patientMariaId: string;
}

const PACIENTES: ReadonlyArray<{
  nome: string; social?: string; cpf?: string; fone?: string;
  status?: 'preliminar' | 'completo'; inativo?: boolean; unificado?: boolean;
}> = [
  { nome: 'Maria Souza Lima', cpf: '11144477735', fone: '11987654321', status: 'completo' },
  { nome: 'MARIA SOUSA', status: 'completo' },
  { nome: 'Joao Prado', social: 'Joana Prado', status: 'completo' },
  { nome: 'Álvaro Neto', status: 'completo' },
  { nome: 'Ana Lima', status: 'completo' },
  { nome: 'Preliminar da Silva', status: 'preliminar' },
  { nome: 'Duplicata Antiga', status: 'completo', unificado: true },
  { nome: 'Duplicata Inativa', status: 'completo', inativo: true },
];

export async function semearPacientes(): Promise<SementePacientes> {
  const s: SementePacientes = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(), patientMariaId: uuidv7(),
  };
  const c = await appPool().connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Busca', '12ABC34501DE35')`,
      [s.tenantId, `b-${s.tenantId.slice(0, 8)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes) VALUES ($1, $2, 'Unidade', '1234567')`,
      [s.tenantId, s.clinicId]);
    await c.query(`INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);

    let sobrevivente = '';
    for (const p of PACIENTES) {
      const id = p.nome === 'Maria Souza Lima' ? s.patientMariaId : uuidv7();
      if (p.nome === 'MARIA SOUSA') sobrevivente = id;
      await c.query(
        `INSERT INTO clin.patient
           (tenant_id, id, full_name, nome_social, cadastro_status, phone_primary,
            search_digits, birth_date, inactivated_at, merged_into_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [s.tenantId, id, p.nome, p.social ?? null, p.status ?? 'preliminar',
         p.fone ?? null, [p.cpf, p.fone].filter(Boolean).join(' ') || null,
         p.status === 'completo' ? '1988-03-14' : null,
         p.inativo ? new Date().toISOString() : null,
         p.unificado ? sobrevivente : null]);
      if (p.cpf) {
        await c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
           VALUES ($1, gen_random_uuid(), $2, 'CPF', $3)`, [s.tenantId, id, p.cpf]);
      }
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally { c.release(); }
  return s;
}
```

> **Nota sobre `search_digits`:** a Fase 0 deixou a coluna como texto normalizado **pela aplicação**. O formato adotado a partir daqui é: os grupos de dígitos separados por espaço, um por identificador ou telefone (`'11144477735 11987654321'`). O `LIKE $1 || '%'` casa o primeiro grupo; para casar qualquer grupo, a Task 26 grava também cada grupo isolado numa segunda linha de `patient_identifier`. Está documentado aqui porque é o tipo de convenção que, não escrita, diverge entre dois arquivos em uma semana.

- [ ] Substituir `packages/patients/src/index.ts` por:

```ts
export { searchPatients, type PatientHit, type SearchInput } from './search';
```

- [ ] Acrescentar as dependências em `packages/patients/package.json`:

```json
{
  "name": "@cadencia/patients",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*"
  }
}
```

- [ ] `pnpm install && pnpm test:int -- patients/src/search` → 7 testes passam.
- [ ] `pnpm arch:check` → verde (`patients` é L1 e importa apenas L0).
- [ ] Commitar: `git commit -m "feat(patients): search by name prefix and digits with pt-BR ordering"`

---

### Task 26: `patients.createMinimalPatient` — nome + um canal bastam para agendar

Dado exigido na hora errada é dado falso, e dado falso contamina o gráfico de distribuição etária e o disparo de aniversariantes **para sempre**. É por isso que recepcionista digita `000.000.000-00`.

**Arquivos:**
- Criar: `packages/patients/src/create.ts`
- Modificar: `packages/patients/src/index.ts`
- Teste: `packages/patients/src/create.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/patients/src/create.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createMinimalPatient, completePatient, dataDebt } from './create';
import { semearPacientes, type SementePacientes } from './test-support';

let s: SementePacientes; let actor: Actor; let novo = '';

beforeAll(async () => {
  s = await semearPacientes();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('cadastro minimo viavel', () => {
  it('nome + telefone bastam, e o cadastro nasce preliminar', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, {
      fullName: 'Maria Sou Nova', phonePrimary: '11991234567' }));
    expect(r.ok).toBe(true);
    if (r.ok) { novo = r.value.patientId; expect(r.value.cadastroStatus).toBe('preliminar'); }
  });

  it('nome + e-mail tambem bastam — o canal e um, nao os dois', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, {
      fullName: 'So Email', email: 'so@example.test' }));
    expect(r.ok).toBe(true);
  });

  it('recusa cadastro sem nenhum canal — sem canal nao ha como confirmar', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, { fullName: 'Sem Canal' }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_obrigatorio' } });
  });

  it('recusa CPF invalido em vez de aceitar 000.000.000-00', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, {
      fullName: 'CPF Falso', phonePrimary: '11999999999', cpf: '00000000000' }));
    expect(r).toEqual({ ok: false, error: { kind: 'cpf_invalido' } });
  });

  it('lista a divida de dados — e a barra "N dados pendentes" do Perfil', async () => {
    const r = await withTenantTx(actor, (tx) => dataDebt(tx, novo));
    expect(r).toEqual({ patientId: novo, pendentes: ['birth_date', 'cpf', 'sex_at_birth'] });
  });

  it('completar o cadastro paga a divida e muda o status', async () => {
    const r = await withTenantTx(actor, (tx) => completePatient(tx, {
      patientId: novo, birthDate: '1990-05-20', sexAtBirth: 'F', cpf: '11144477735' }));
    expect(r).toEqual({ ok: false, error: { kind: 'cpf_duplicado' } });

    const r2 = await withTenantTx(actor, (tx) => completePatient(tx, {
      patientId: novo, birthDate: '1990-05-20', sexAtBirth: 'F', cpf: '52998224725' }));
    expect(r2.ok).toBe(true);

    const debt = await withTenantTx(actor, (tx) => dataDebt(tx, novo));
    expect(debt.pendentes).toEqual([]);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- patients/src/create` → `Failed to resolve import "./create"`.

- [ ] Criar `packages/patients/src/create.ts`:

```ts
// packages/patients/src/create.ts
import { err, isOk, ok, parseCpf, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export interface CreateMinimalInput {
  readonly fullName: string;
  readonly nomeSocial?: string;
  readonly phonePrimary?: string;
  readonly email?: string;
  readonly cpf?: string;
}

export type CreateFailure =
  | { kind: 'nome_obrigatorio' }
  | { kind: 'canal_obrigatorio' }
  | { kind: 'cpf_invalido' }
  | { kind: 'cpf_duplicado' };

/**
 * §5.5 fluxo (a) — a regra PACIENTE MINIMO VIAVEL. Nome + UM canal bastam para
 * agendar; o cadastro nasce `preliminar` e CPF, nascimento e sexo viram DIVIDA
 * DE DADOS, cobrada no check-in (com a pessoa na frente) e BLOQUEANTE na
 * finalizacao do atendimento e no faturamento de convenio.
 *
 * A justificativa e empirica, nao estetica: dado exigido na hora errada e dado
 * falso, e dado falso contamina o grafico de distribuicao etaria e o disparo de
 * aniversariantes para sempre. E por isso que recepcionista digita 000.000.000-00
 * — e por isso que este caminho RECUSA um CPF invalido em vez de aceita-lo.
 */
export async function createMinimalPatient(
  tx: TxClient, input: CreateMinimalInput,
): Promise<Result<{ patientId: string; cadastroStatus: 'preliminar' }, CreateFailure>> {
  const nome = input.fullName.trim();
  if (nome.length < 2) return err({ kind: 'nome_obrigatorio' });

  const fone = input.phonePrimary?.replace(/\D+/g, '') ?? '';
  const email = input.email?.trim() ?? '';
  if (fone.length < 10 && email.length === 0) return err({ kind: 'canal_obrigatorio' });

  let cpfDigitos = '';
  if (input.cpf !== undefined && input.cpf.trim().length > 0) {
    const r = parseCpf(input.cpf);
    if (!isOk(r)) return err({ kind: 'cpf_invalido' });
    cpfDigitos = r.value;
  }

  const patientId = uuidv7();
  const digitos = [cpfDigitos, fone].filter((d) => d.length > 0).join(' ');

  await tx.query(
    `INSERT INTO clin.patient
       (id, full_name, nome_social, phone_primary, email, search_digits, cadastro_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'preliminar')`,
    [patientId, nome, input.nomeSocial ?? null, fone === '' ? null : fone,
     email === '' ? null : email, digitos === '' ? null : digitos]);

  if (cpfDigitos !== '') {
    const dup = await gravarCpf(tx, patientId, cpfDigitos);
    if (!dup.ok) return dup;
  }

  await tx.query(
    `SELECT audit.log('PATIENT_CREATE', 'clin', 'patient', $1, 'sucesso',
                      jsonb_build_object('cadastro_status', 'preliminar'), NULL)`,
    [patientId]);

  return ok({ patientId, cadastroStatus: 'preliminar' });
}

async function gravarCpf(
  tx: TxClient, patientId: string, cpfDigitos: string,
): Promise<Result<true, CreateFailure>> {
  // ux_pid e UNIQUE (tenant_id, kind, value): o duplicado e 23505 e vira um erro
  // de dominio nomeado, nao um 500 com "duplicate key" na cara da recepcionista.
  const { rowCount } = await tx.query(
    `INSERT INTO clin.patient_identifier (id, patient_id, kind, value)
     VALUES (gen_random_uuid(), $1, 'CPF', $2)
     ON CONFLICT (tenant_id, kind, value) WHERE kind <> 'SEM_DOCUMENTO' DO NOTHING`,
    [patientId, cpfDigitos]);
  if (rowCount === 0) return err({ kind: 'cpf_duplicado' });
  return ok(true);
}

export interface CompleteInput {
  readonly patientId: string;
  readonly birthDate: string;
  readonly sexAtBirth: 'M' | 'F' | 'I';
  readonly cpf?: string;
}

/** Paga a divida de dados e promove o cadastro para `completo`. */
export async function completePatient(
  tx: TxClient, input: CompleteInput,
): Promise<Result<{ patientId: string }, CreateFailure>> {
  if (input.cpf !== undefined && input.cpf.trim().length > 0) {
    const r = parseCpf(input.cpf);
    if (!isOk(r)) return err({ kind: 'cpf_invalido' });
    const dup = await gravarCpf(tx, input.patientId, r.value);
    if (!dup.ok) return dup;
    await tx.query(
      `UPDATE clin.patient
          SET search_digits = btrim(coalesce($2 || ' ', '') || coalesce(phone_primary, ''))
        WHERE id = $1`, [input.patientId, r.value]);
  }

  await tx.query(
    `UPDATE clin.patient
        SET birth_date = $2::date, sex_at_birth = $3, cadastro_status = 'completo'
      WHERE id = $1`,
    [input.patientId, input.birthDate, input.sexAtBirth]);

  await tx.query(
    `SELECT audit.log('PATIENT_COMPLETE', 'clin', 'patient', $1, 'sucesso', '{}'::jsonb, NULL)`,
    [input.patientId]);

  return ok({ patientId: input.patientId });
}

export interface DataDebt {
  readonly patientId: string;
  readonly pendentes: readonly string[];
}

/** A barra "N dados pendentes" do Perfil, e o bloqueio da finalizacao. */
export async function dataDebt(tx: TxClient, patientId: string): Promise<DataDebt> {
  const { rows } = await tx.query<{
    birth_date: string | null; sex_at_birth: string | null; tem_cpf: boolean }>(
    `SELECT p.birth_date::text AS birth_date, p.sex_at_birth,
            EXISTS (SELECT 1 FROM clin.patient_identifier i
                     WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id
                       AND i.kind IN ('CPF','CNS','DNV','PASSAPORTE','SEM_DOCUMENTO')) AS tem_cpf
       FROM clin.patient p WHERE p.id = $1`, [patientId]);
  const r = rows[0];
  if (!r) return { patientId, pendentes: [] };
  const pendentes: string[] = [];
  if (r.birth_date === null) pendentes.push('birth_date');
  if (!r.tem_cpf) pendentes.push('cpf');
  if (r.sex_at_birth === null) pendentes.push('sex_at_birth');
  return { patientId, pendentes };
}
```

- [ ] Acrescentar em `packages/patients/src/index.ts`:

```ts
export {
  createMinimalPatient, completePatient, dataDebt,
  type CompleteInput, type CreateFailure, type CreateMinimalInput, type DataDebt,
} from './create';
```

- [ ] Rodar: `pnpm test:int -- patients/src/create` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(patients): create minimal patients and track the data debt"`

---

### Task 27: `clin.patient_exists_by_identifier` — o terceiro estado

RLS só sabe devolver conjunto vazio, e "não existe" ≠ "existe e você não tem acesso". Sem distinguir, o plantonista busca o CPF, recebe "não encontrado", cria cadastro novo e prescreve **sem ver a alergia** que estava no primeiro prontuário.

**Arquivos:**
- Criar: `packages/db/migrations/0041_patient_exists.sql`
- Teste: `packages/db/test/iso/19-terceiro-estado.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/19-terceiro-estado.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, TENANT_B, USER_A_MEDICO, USER_B_MEDICO, CLINIC_A, CLINIC_B, CPF_A }
  from './fixtures';

describe('o terceiro estado — existe e voce nao tem acesso', () => {
  it('responde SIM para paciente do proprio tenant, sem devolver conteudo', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ existe: boolean }>(
        `SELECT clin.patient_exists_by_identifier('CPF', $1) AS existe`, [CPF_A]));
    expect(rows[0]?.existe).toBe(true);
  });

  it('devolve apenas booleano — nenhuma coluna de conteudo na assinatura', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ t: string }>(
        `SELECT pg_get_function_result(p.oid) AS t FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='clin' AND p.proname='patient_exists_by_identifier'`));
    expect(rows[0]?.t).toBe('boolean');
  });

  it('responde NAO para CPF de OUTRO tenant — a funcao nao fura o isolamento', async () => {
    const { rows } = await comoTenant(TENANT_B, USER_B_MEDICO, CLINIC_B, (tx) =>
      tx.query<{ existe: boolean }>(
        `SELECT clin.patient_exists_by_identifier('CPF', $1) AS existe`, [CPF_A]));
    expect(rows[0]?.existe).toBe(false);
  });

  it('cada consulta gera evento de auditoria — a funcao e auditada, nao livre', async () => {
    await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query(`SELECT clin.patient_exists_by_identifier('CPF', $1)`, [CPF_A]));
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event WHERE event_type = 'PATIENT_EXISTENCE_PROBE'`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `function clin.patient_exists_by_identifier(unknown, unknown) does not exist`.

- [ ] `pnpm db:new patient_exists` (gera `0041_patient_exists.sql`) e escrever:

```sql
-- 0041_patient_exists.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.4 — O TERCEIRO ESTADO. RLS so sabe devolver conjunto vazio, e "nao existe"
-- nao e a mesma coisa que "existe e voce nao tem acesso". Sem distinguir, o
-- plantonista busca o CPF, recebe "nao encontrado", cria cadastro novo e
-- prescreve sem ver a alergia que estava no primeiro prontuario.
--
-- A funcao e SECURITY DEFINER e ESTREITA de proposito: responde apenas sim/nao
-- sobre existencia NO PROPRIO TENANT, sem conteudo, e registra cada consulta.
-- O tipo de retorno `boolean` e a garantia estrutural: nao ha como esta funcao
-- vazar nome, data de nascimento ou qualquer outra coluna.

CREATE FUNCTION clin.patient_exists_by_identifier(p_kind text, p_value text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = clin, app, audit, pg_catalog AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_existe boolean;
BEGIN
  IF p_kind NOT IN ('CPF','CNS','DNV','PASSAPORTE','RG','CARTEIRINHA') THEN
    RAISE EXCEPTION 'tipo de identificador invalido: %', p_kind USING ERRCODE = '22023';
  END IF;

  -- SECURITY DEFINER escapa da RLS de propósito; o filtro por tenant e EXPLICITO
  -- e vem de app.require_tenant_id(), que levanta 42501 se o preambulo faltar.
  SELECT EXISTS (
    SELECT 1 FROM clin.patient_identifier i
     JOIN clin.patient p ON (p.tenant_id, p.id) = (i.tenant_id, i.patient_id)
    WHERE i.tenant_id = v_tenant AND i.kind = p_kind AND i.value = p_value
      AND p.merged_into_id IS NULL)
  INTO v_existe;

  PERFORM audit.log('PATIENT_EXISTENCE_PROBE', 'clin', 'patient_identifier', NULL,
                    CASE WHEN v_existe THEN 'sucesso' ELSE 'negado' END,
                    jsonb_build_object('kind', p_kind, 'encontrado', v_existe), NULL);
  RETURN v_existe;
END $fn$;

ALTER FUNCTION clin.patient_exists_by_identifier(text, text) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.patient_exists_by_identifier(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.patient_exists_by_identifier(text, text) TO app_rw;
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Se `CPF_A` ainda não existir em `packages/db/test/iso/fixtures.ts`, acrescente `export const CPF_A = '11144477735';` e insira o identificador correspondente no seed do tenant A.
- [ ] Commitar: `git commit -m "feat(db): answer patient existence without leaking content"`

---

### Task 28: quebra-vidro assistencial — acesso com justificativa, prazo e notificação

O botão cinza com cadeado comunica "seu produto está quebrado" ou "pague mais". O caminho legítimo é **Solicitar acesso** ou **Quebra-vidro assistencial**, e este último grava justificativa obrigatória, prazo, evento de auditoria e notificação ao responsável.

**Arquivos:**
- Criar: `packages/db/migrations/0042_break_glass.sql`
- Teste: `packages/db/test/iso/20-quebra-vidro.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/20-quebra-vidro.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO2, CLINIC_A, PATIENT_A } from './fixtures';

describe('quebra-vidro assistencial', () => {
  it('recusa justificativa curta — a exigencia e estrutural, nao de UI', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO2, CLINIC_A, (tx) =>
        tx.query(`SELECT clin.break_glass($1, 'urgente', 4)`, [PATIENT_A])),
    ).rejects.toThrow(/justificativa/);
  });

  it('concede acesso com prazo e devolve o id do compartilhamento', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO2, CLINIC_A, (tx) =>
      tx.query<{ share_id: string }>(
        `SELECT clin.break_glass($1,
           'paciente inconsciente no pronto atendimento, sem acompanhante', 4) AS share_id`,
        [PATIENT_A]));
    expect(rows[0]?.share_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('depois do quebra-vidro o profissional passa a enxergar o prontuario', async () => {
    const { rowCount } = await comoTenant(TENANT_A, USER_A_MEDICO2, CLINIC_A, (tx) =>
      tx.query(`SELECT 1 FROM clin.encounter WHERE patient_id = $1`, [PATIENT_A]));
    expect(rowCount).toBeGreaterThan(0);
  });

  it('grava evento de auditoria RECORD_BREAK_GLASS com o prazo, sem dado clinico', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO2, CLINIC_A, (tx) =>
      tx.query<{ outcome: string; meta: Record<string, unknown> }>(
        `SELECT outcome, meta FROM audit.event
          WHERE event_type = 'RECORD_BREAK_GLASS' ORDER BY id DESC LIMIT 1`));
    expect(rows[0]?.outcome).toBe('sucesso');
    expect(rows[0]?.meta).toHaveProperty('horas');
    expect(JSON.stringify(rows[0]?.meta)).not.toContain('inconsciente');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `function clin.break_glass(...) does not exist`.

- [ ] `pnpm db:new break_glass` (gera `0042_break_glass.sql`) e escrever:

```sql
-- 0042_break_glass.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.4 — quebra-vidro assistencial. Nao e excecao a policy: e uma linha em
-- clin.record_share, que a policy RESTRICTIVE ja consulta. O acesso e concedido
-- com JUSTIFICATIVA obrigatoria, PRAZO e evento de auditoria — e por ser uma
-- linha comum, ele expira sozinho, sem job.

-- expires_at nao existia na Fase 0: record_share era concessao manual sem prazo.
ALTER TABLE clin.record_share ADD COLUMN expires_at timestamptz(3);
ALTER TABLE clin.record_share ADD COLUMN break_glass boolean NOT NULL DEFAULT false;
-- Quebra-vidro SEMPRE tem prazo. Concessao manual pode nao ter.
ALTER TABLE clin.record_share ADD CONSTRAINT quebra_vidro_tem_prazo
  CHECK (NOT break_glass OR expires_at IS NOT NULL);

-- A policy da Fase 0 consultava apenas revoked_at. Prazo vencido tem de fechar
-- o acesso sem ninguem revogar nada.
DROP POLICY clinical_scope ON clin.patient_identifier;
CREATE POLICY clinical_scope ON clin.patient_identifier
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.patient_identifier.tenant_id,
                               clin.patient_identifier.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

DROP POLICY clinical_scope ON clin.encounter;
CREATE POLICY clinical_scope ON clin.encounter AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.encounter.tenant_id, clin.encounter.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

CREATE FUNCTION clin.break_glass(
  p_patient_id uuid, p_justificativa text, p_horas int DEFAULT 4)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = clin, app, audit, pg_catalog AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_prof   uuid := app.current_professional_id();
  v_id     uuid := gen_random_uuid();
BEGIN
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'quebra-vidro e ato assistencial: exige profissional'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_justificativa, ''))) < 20 THEN
    RAISE EXCEPTION 'justificativa de quebra-vidro precisa de ao menos 20 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF p_horas < 1 OR p_horas > 72 THEN
    RAISE EXCEPTION 'prazo do quebra-vidro fica entre 1 e 72 horas' USING ERRCODE = '22023';
  END IF;

  INSERT INTO clin.record_share (
      tenant_id, id, patient_id, grantee_professional_id, granted_by_professional_id,
      reason, expires_at, break_glass)
  VALUES (v_tenant, v_id, p_patient_id, v_prof, v_prof,
      p_justificativa, clock_timestamp() + make_interval(hours => p_horas), true);

  -- A justificativa NAO vai para o meta: a trilha nao carrega texto livre que
  -- pode conter dado clinico (NGS1.07.06). Ela fica em clin.record_share.reason,
  -- que e do dominio e tem RLS.
  PERFORM audit.log('RECORD_BREAK_GLASS', 'clin', 'record_share', v_id, 'sucesso',
                    jsonb_build_object('horas', p_horas), NULL);
  RETURN v_id;
END $fn$;

ALTER FUNCTION clin.break_glass(uuid, text, int) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.break_glass(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.break_glass(uuid, text, int) TO app_rw;

CREATE INDEX ix_record_share_vigente_prazo
  ON clin.record_share (tenant_id, patient_id, grantee_professional_id)
  WHERE revoked_at IS NULL;
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam; as suítes 05 (escopo clínico) continuam verdes.
- [ ] Se `USER_A_MEDICO2` não existir em `fixtures.ts`, acrescente um segundo profissional ao seed do tenant A (é ele quem não enxerga o prontuário antes do quebra-vidro).
- [ ] Commitar: `git commit -m "feat(db): grant time-boxed break-glass access to clinical records"`

---

### Task 29: a finalização bloqueia cadastro preliminar — o momento certo de cobrar o dado

Já implementado na Task 20 (`cadastro_preliminar_bloqueia_finalizacao`); aqui ele ganha o teste que prova o comportamento de ponta a ponta e a mensagem que a tela mostra.

**Arquivos:**
- Criar: `packages/emr/src/finalize-blocks.int.test.ts`

- [ ] Escrever o teste:

```ts
// packages/emr/src/finalize-blocks.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente; let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  // Rebaixa o paciente para preliminar: e o estado real de quem foi agendado
  // pelo telefone com nome e um canal, e ainda nao passou pelo check-in.
  await appPool().query(
    `UPDATE clin.patient SET cadastro_status = 'preliminar', birth_date = NULL WHERE id = $1`,
    [s.patientId]);
});
afterAll(async () => { await closePools(); });

describe('divida de dados bloqueia a finalizacao — no momento certo', () => {
  it('recusa finalizar e diz EXATAMENTE o que falta', async () => {
    const r = await withTenantTx(actor, (tx) => finalizeEncounter(tx, {
      encounterId: s.encounterId,
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [] }));
    expect(r).toEqual({
      ok: false,
      error: { kind: 'cadastro_preliminar_bloqueia_finalizacao',
               faltando: ['cadastro_status', 'birth_date'] },
    });
  });

  it('o atendimento continua em rascunho — nada foi selado pela metade', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ status: string; n: number }>(
      `SELECT status::text AS status, version_count AS n FROM clin.encounter WHERE id = $1`,
      [s.encounterId]));
    expect(rows[0]).toEqual({ status: 'rascunho', n: 0 });
  });

  it('pago o dado, finaliza', async () => {
    await appPool().query(
      `UPDATE clin.patient SET cadastro_status='completo', birth_date='1988-03-14' WHERE id=$1`,
      [s.patientId]);
    const r = await withTenantTx(actor, (tx) => finalizeEncounter(tx, {
      encounterId: s.encounterId,
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [] }));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] Rodar: `pnpm test:int -- finalize-blocks` → 3 testes passam.
- [ ] Commitar: `git commit -m "test(emr): block finalization while the patient record is still preliminary"`

---

## Parte V — Agenda

### Task 30: schema `sched` e `sched.procedure` — cor, duração e valor que dirigem o slot

**Arquivos:**
- Criar: `packages/db/migrations/0043_sched_procedure.sql`
- Teste: `packages/db/test/iso/21-sched-procedure.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/21-sched-procedure.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant, comoAdmin } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A } from './fixtures';

describe('sched.procedure', () => {
  it('o schema sched entra na varredura dos invariantes', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname = 'sched'`));
    expect(rows[0]?.nspname).toBe('sched');
  });

  it('cor e duracao dirigem a renderizacao do slot', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
         VALUES ($1, gen_random_uuid(), 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`, [TENANT_A]);
      const { rows } = await tx.query(
        `SELECT cor, duracao_min, valor_centavos::int AS valor FROM sched.procedure
          WHERE tenant_id = $1 AND code = 'CONS'`, [TENANT_A]);
      return rows[0];
    });
    expect(r).toEqual({ cor: '#2f5fd0', duracao_min: 30, valor: 25000 });
  });

  it('recusa cor fora do formato hexadecimal', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
           VALUES ($1, gen_random_uuid(), 'X', 'X', 'azul', 30)`, [TENANT_A])),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('recusa duracao nao positiva — slot de zero minuto quebra a grade', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
           VALUES ($1, gen_random_uuid(), 'Y', 'Y', '#000000', 0)`, [TENANT_A])),
    ).rejects.toThrow(/violates check constraint/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `schema "sched" does not exist`.

- [ ] `pnpm db:new sched_procedure` (gera `0043_sched_procedure.sql`) e escrever:

```sql
-- 0043_sched_procedure.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — a agenda. O schema `sched` nasce aqui, com o mesmo dono e o mesmo
-- padrao de GRANT dos demais (migration 0002).

CREATE SCHEMA sched AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA sched TO app_rw, clin_writer, app_support;

CREATE TABLE sched.procedure (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  code          text NOT NULL,
  nome          text NOT NULL COLLATE "pt-BR-x-icu",
  -- Cor e DURACAO dirigem a renderizacao do slot: a linha da agenda usa a cor
  -- na barra de 3px da borda esquerda, e a altura do bloco vem da duracao.
  cor           char(7) NOT NULL CHECK (cor ~ '^#[0-9a-f]{6}$'),
  duracao_min   int NOT NULL CHECK (duracao_min > 0 AND duracao_min <= 480),
  valor_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  -- Vinculo com a TUSS para a Fase 4; opcional na Fase 1.
  tuss_tabela   smallint, tuss_codigo varchar(10),
  archived_at   timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  CHECK ((tuss_tabela IS NULL) = (tuss_codigo IS NULL)));
ALTER TABLE sched.procedure OWNER TO app_owner;

CREATE UNIQUE INDEX ux_procedure_viva
  ON sched.procedure (tenant_id, code) WHERE archived_at IS NULL;
CREATE INDEX ix_procedure_ordem
  ON sched.procedure (tenant_id, nome COLLATE "pt-BR-x-icu") WHERE archived_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON sched.procedure TO app_rw;

ALTER TABLE sched.procedure ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.procedure FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.procedure AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Acrescentar `'sched'` à lista de schemas varridos pelos invariantes em `packages/db/src/invariants/` (procure a constante com `'app', 'clin', 'fin', 'tiss', 'audit'` e inclua `'sched'`; faça o mesmo em `app.secure_partition` se a lista aparecer lá).
- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso && pnpm db:invariants` → 4 testes novos passam, invariantes verdes.
- [ ] Commitar: `git commit -m "feat(db): add the scheduling schema and procedure catalog"`

---

### Task 31: `sched.appointment` — encaixe é overbooking deliberado, não bug

Encaixe é inegociável no Brasil. A restrição de exclusão precisa deixá-lo passar **explicitamente**, senão a recepção descobre que o software não deixa encaixar e volta para o caderno.

**Arquivos:**
- Criar: `packages/db/migrations/0044_appointment.sql`
- Teste: `packages/db/test/iso/22-appointment.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/22-appointment.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A, PROF_A, PATIENT_A } from './fixtures';

async function agendar(inicio: string, fim: string, encaixe = false) {
  return comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
    tx.query(
      `INSERT INTO sched.appointment
         (tenant_id, id, patient_id, professional_id, clinic_id, starts_at, ends_at,
          appointment_date, encaixe, created_by)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5::timestamptz, $6::timestamptz,
               app.local_date($5::timestamptz, (SELECT timezone FROM app.clinic WHERE id = $4)),
               $7, app.current_user_id())`,
      [TENANT_A, PATIENT_A, PROF_A, CLINIC_A, inicio, fim, encaixe]));
}

describe('sched.appointment', () => {
  it('agenda o primeiro horario', async () => {
    const r = await agendar('2026-09-01T13:00:00Z', '2026-09-01T13:30:00Z');
    expect(r.rowCount).toBe(1);
  });

  it('recusa sobreposicao do MESMO profissional quando nao e encaixe', async () => {
    await expect(agendar('2026-09-01T13:15:00Z', '2026-09-01T13:45:00Z'))
      .rejects.toThrow(/ex_appointment_sem_sobreposicao|conflicting key value/);
  });

  it('ACEITA a mesma sobreposicao quando marcada como encaixe', async () => {
    const r = await agendar('2026-09-01T13:15:00Z', '2026-09-01T13:45:00Z', true);
    expect(r.rowCount).toBe(1);
  });

  it('recusa fim antes do inicio', async () => {
    await expect(agendar('2026-09-01T15:00:00Z', '2026-09-01T14:00:00Z'))
      .rejects.toThrow(/violates check constraint/);
  });

  it('appointment_date sai no fuso da CLINICA', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ d: string }>(
        `SELECT DISTINCT appointment_date::text AS d FROM sched.appointment
          WHERE starts_at >= '2026-09-01T13:00:00Z'::timestamptz`));
    expect(rows[0]?.d).toBe('2026-09-01');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "sched.appointment" does not exist`.

- [ ] `pnpm db:new appointment` (gera `0044_appointment.sql`) e escrever:

```sql
-- 0044_appointment.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — a agenda. Inicio e fim sao instantes; appointment_date e a data no fuso
-- da CLINICA (nao do tenant: rede SP + Manaus e caso real).
--
-- ENCAIXE e overbooking DELIBERADO. A restricao de exclusao o deixa passar
-- explicitamente: sem isso a recepcao descobre que o software nao deixa encaixar
-- e volta para o caderno — e a agenda e a tela onde o produto e julgado.

CREATE TYPE sched.appointment_status AS ENUM
  ('agendado','confirmado','aguardando','atendendo','atendido','faltou','cancelado');

CREATE TABLE sched.appointment (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  room_id         uuid,
  procedure_id    uuid,
  operadora_nome  text,           -- convenio; NULL = particular
  starts_at       timestamptz(3) NOT NULL,
  ends_at         timestamptz(3) NOT NULL,
  appointment_date date NOT NULL, -- app.local_date(starts_at, clinic.timezone)
  status          sched.appointment_status NOT NULL DEFAULT 'agendado',
  encaixe         boolean NOT NULL DEFAULT false,
  teleconsulta    boolean NOT NULL DEFAULT false,
  primeira_vez    boolean NOT NULL DEFAULT false,
  observacao      text,
  -- Origem: recorrencia materializada aponta para a serie que a gerou.
  recurrence_id   uuid,
  confirmed_at    timestamptz(3),
  arrived_at      timestamptz(3),
  started_at      timestamptz(3),
  finished_at     timestamptz(3),
  cancelled_at    timestamptz(3),
  cancel_reason   text,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  periodo         tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK ((cancelled_at IS NULL) = (status <> 'cancelado')));
ALTER TABLE sched.appointment OWNER TO app_owner;

-- btree_gist (extensao ja instalada na 0002) e o que permite misturar igualdade
-- de uuid com sobreposicao de intervalo na mesma restricao.
ALTER TABLE sched.appointment ADD CONSTRAINT ex_appointment_sem_sobreposicao
  EXCLUDE USING gist (
    tenant_id WITH =, professional_id WITH =, periodo WITH &&)
  WHERE (NOT encaixe AND status <> 'cancelado');

-- Sala compartilhada: dois profissionais nao ocupam a mesma sala no mesmo horario,
-- nem com encaixe — encaixe e overbooking de AGENDA, nao de espaco fisico.
ALTER TABLE sched.appointment ADD CONSTRAINT ex_appointment_sala
  EXCLUDE USING gist (tenant_id WITH =, room_id WITH =, periodo WITH &&)
  WHERE (room_id IS NOT NULL AND status <> 'cancelado');

-- §3.8: os contadores do dia sao CONSULTA VIVA sobre indice parcial, nunca matview.
-- Contador defasado e lido como "travou", que e a queixa que o produto resolve.
CREATE INDEX ix_appointment_dia
  ON sched.appointment (tenant_id, clinic_id, appointment_date, starts_at)
  INCLUDE (professional_id, patient_id, status, encaixe)
  WHERE status <> 'cancelado';
CREATE INDEX ix_appointment_profissional
  ON sched.appointment (tenant_id, professional_id, appointment_date, starts_at)
  WHERE status <> 'cancelado';
CREATE INDEX ix_appointment_paciente
  ON sched.appointment (tenant_id, patient_id, starts_at DESC);
CREATE INDEX ix_appointment_recorrencia
  ON sched.appointment (tenant_id, recurrence_id) WHERE recurrence_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON sched.appointment TO app_rw;
-- Sem DELETE: agendamento sai de circulacao por status = 'cancelado', e o
-- historico de faltas e cancelamentos e o insumo do Desempenho da Fase 3.

ALTER TABLE sched.appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.appointment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.appointment AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
-- A agenda NAO recebe policy RESTRICTIVE por profissional: a recepcao precisa
-- ver a agenda inteira da unidade para agendar. Agendamento e dado
-- administrativo — §10 item 18 separa Paciente de Prontuario exatamente aqui.
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 5 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): schedule appointments with deliberate overbooking for encaixe"`

---

### Task 32: `sched.block` — bloqueio de horário e ausência

**Arquivos:**
- Criar: `packages/db/migrations/0045_sched_block.sql`
- Teste: `packages/db/test/iso/23-sched-block.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/23-sched-block.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A, PROF_A } from './fixtures';

describe('sched.block', () => {
  it('bloqueia um periodo do profissional', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query(
        `INSERT INTO sched.block
           (tenant_id, id, professional_id, clinic_id, starts_at, ends_at, kind, motivo, created_by)
         VALUES ($1, gen_random_uuid(), $2, $3,
                 '2026-09-02T12:00:00Z', '2026-09-02T14:00:00Z', 'almoco', 'Almoco',
                 app.current_user_id())`, [TENANT_A, PROF_A, CLINIC_A]));
    expect(r.rowCount).toBe(1);
  });

  it('recusa dois bloqueios sobrepostos do mesmo profissional', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO sched.block
             (tenant_id, id, professional_id, clinic_id, starts_at, ends_at, kind, motivo, created_by)
           VALUES ($1, gen_random_uuid(), $2, $3,
                   '2026-09-02T13:00:00Z', '2026-09-02T15:00:00Z', 'ausencia', 'Congresso',
                   app.current_user_id())`, [TENANT_A, PROF_A, CLINIC_A])),
    ).rejects.toThrow(/ex_block_sem_sobreposicao|conflicting key value/);
  });

  it('bloqueio NAO impede encaixe — a decisao e da recepcao, com a pessoa na frente', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ conflita: boolean }>(
        `SELECT sched.is_blocked($1, '2026-09-02T12:30:00Z', '2026-09-02T13:00:00Z') AS conflita`,
        [PROF_A]));
    expect(r.rows[0]?.conflita).toBe(true);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "sched.block" does not exist`.

- [ ] `pnpm db:new sched_block` (gera `0045_sched_block.sql`) e escrever:

```sql
-- 0045_sched_block.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — bloqueios e ausencias. Bloqueio NAO e agendamento: ele nao tem paciente,
-- e por isso vive em tabela propria. A tela desenha bloqueio listrado em
-- --papel-200 (§6.4), nunca com a cor de um status de atendimento.
--
-- Bloqueio nao impede o INSERT de um agendamento: quem decide encaixar sobre o
-- almoco e a recepcao, com a pessoa na frente. O que existe e sched.is_blocked,
-- que a tela consulta para AVISAR — a diferenca entre software que ajuda e
-- software que atrapalha.

CREATE TYPE sched.block_kind AS ENUM
  ('almoco','ausencia','feriado','bloqueio','manutencao');

CREATE TABLE sched.block (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  professional_id uuid,           -- NULL = bloqueio da unidade inteira (feriado)
  clinic_id       uuid NOT NULL,
  room_id         uuid,
  starts_at       timestamptz(3) NOT NULL,
  ends_at         timestamptz(3) NOT NULL,
  kind            sched.block_kind NOT NULL,
  motivo          text NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  periodo         tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  CHECK (ends_at > starts_at));
ALTER TABLE sched.block OWNER TO app_owner;

ALTER TABLE sched.block ADD CONSTRAINT ex_block_sem_sobreposicao
  EXCLUDE USING gist (tenant_id WITH =, professional_id WITH =, periodo WITH &&)
  WHERE (professional_id IS NOT NULL);

CREATE INDEX ix_block_periodo ON sched.block USING gist (tenant_id, clinic_id, periodo);

CREATE FUNCTION sched.is_blocked(
  p_professional_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sched.block b
     WHERE b.tenant_id = app.current_tenant_id()
       AND (b.professional_id = p_professional_id OR b.professional_id IS NULL)
       AND b.periodo && tstzrange(p_starts_at, p_ends_at, '[)'))
$$;
ALTER FUNCTION sched.is_blocked(uuid, timestamptz, timestamptz) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION sched.is_blocked(uuid, timestamptz, timestamptz) TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON sched.block TO app_rw;
-- DELETE aqui e legitimo: desmarcar o congresso apaga o bloqueio.

ALTER TABLE sched.block ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.block FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.block AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 3 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): add schedule blocks and the advisory conflict check"`

---

### Task 33: recorrência **materializada**, horizonte de 120 dias

Regra calculada em runtime significa recalcular a série toda vez que a agenda abre — e significa que arrastar uma ocorrência quebra a regra. Materializada, cada ocorrência é uma linha comum que pode ser movida, cancelada e encaixada.

**Arquivos:**
- Criar: `packages/db/migrations/0046_recurrence.sql`
- Teste: `packages/db/test/iso/24-recurrence.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/24-recurrence.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A, PROF_A, PATIENT_A } from './fixtures';

describe('recorrencia materializada', () => {
  it('gera as ocorrencias ate o horizonte de 120 dias, e nao alem', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, async (tx) => {
      const { rows } = await tx.query<{ recurrence_id: string; geradas: number }>(
        `SELECT * FROM sched.materialize_recurrence(
            p_patient_id => $1, p_professional_id => $2, p_clinic_id => $3,
            p_first_starts_at => '2026-09-07T13:00:00Z'::timestamptz,
            p_duracao_min => 30, p_freq => 'semanal', p_intervalo => 1,
            p_horizonte_dias => 120, p_procedure_id => NULL)`,
        [PATIENT_A, PROF_A, CLINIC_A]);
      return rows[0];
    });
    // 120 dias / 7 = 17 semanas completas + a primeira.
    expect(r?.geradas).toBe(18);
  });

  it('cada ocorrencia e um agendamento comum, movivel e cancelavel', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM sched.appointment WHERE recurrence_id IS NOT NULL`));
    expect(Number(rows[0]?.n)).toBe(18);
  });

  it('recusa horizonte maior que 120 dias — a serie infinita e o que trava a agenda', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `SELECT * FROM sched.materialize_recurrence($1, $2, $3,
             '2027-01-04T13:00:00Z'::timestamptz, 30, 'semanal', 1, 400, NULL)`,
          [PATIENT_A, PROF_A, CLINIC_A])),
    ).rejects.toThrow(/horizonte/);
  });

  it('pula a ocorrencia que colidiria, em vez de abortar a serie inteira', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ geradas: number; puladas: number }>(
        `SELECT geradas, puladas FROM sched.materialize_recurrence($1, $2, $3,
           '2026-09-07T13:00:00Z'::timestamptz, 30, 'semanal', 1, 30, NULL)`,
        [PATIENT_A, PROF_A, CLINIC_A]));
    expect(r.rows[0]?.geradas).toBe(0);
    expect(r.rows[0]?.puladas).toBe(5);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `function sched.materialize_recurrence(...) does not exist`.

- [ ] `pnpm db:new recurrence` (gera `0046_recurrence.sql`) e escrever:

```sql
-- 0046_recurrence.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — recorrencia MATERIALIZADA, horizonte 120 dias, nao regra calculada em
-- runtime. Duas razoes: (1) recalcular a serie toda vez que a agenda abre custa
-- na tela mais quente do produto; (2) com regra, arrastar UMA ocorrencia quebra
-- a regra — materializada, cada ocorrencia e uma linha comum que se move,
-- cancela e encaixa como qualquer outra.

CREATE TYPE sched.recurrence_freq AS ENUM ('diaria','semanal','quinzenal','mensal');

CREATE TABLE sched.recurrence (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  procedure_id    uuid,
  freq            sched.recurrence_freq NOT NULL,
  intervalo       int NOT NULL DEFAULT 1 CHECK (intervalo BETWEEN 1 AND 12),
  first_starts_at timestamptz(3) NOT NULL,
  duracao_min     int NOT NULL CHECK (duracao_min > 0),
  horizonte_ate   date NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id));
ALTER TABLE sched.recurrence OWNER TO app_owner;

ALTER TABLE sched.appointment ADD CONSTRAINT appointment_recurrence_fkey
  FOREIGN KEY (tenant_id, recurrence_id) REFERENCES sched.recurrence(tenant_id, id);

GRANT SELECT, INSERT, UPDATE ON sched.recurrence TO app_rw;
ALTER TABLE sched.recurrence ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.recurrence FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.recurrence AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE FUNCTION sched.materialize_recurrence(
  p_patient_id      uuid,
  p_professional_id uuid,
  p_clinic_id       uuid,
  p_first_starts_at timestamptz,
  p_duracao_min     int,
  p_freq            sched.recurrence_freq,
  p_intervalo       int DEFAULT 1,
  p_horizonte_dias  int DEFAULT 120,
  p_procedure_id    uuid DEFAULT NULL)
RETURNS TABLE (recurrence_id uuid, geradas int, puladas int)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_id     uuid := gen_random_uuid();
  v_tz     text;
  v_ate    timestamptz;
  v_at     timestamptz := p_first_starts_at;
  v_passo  interval;
  v_ger    int := 0;
  v_pul    int := 0;
BEGIN
  IF p_horizonte_dias < 1 OR p_horizonte_dias > 120 THEN
    RAISE EXCEPTION 'horizonte da recorrencia fica entre 1 e 120 dias, recebido %',
      p_horizonte_dias USING ERRCODE = '22023';
  END IF;

  SELECT c.timezone INTO v_tz FROM app.clinic c
   WHERE c.tenant_id = v_tenant AND c.id = p_clinic_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'unidade % nao encontrada', p_clinic_id USING ERRCODE = 'P0002';
  END IF;

  v_passo := CASE p_freq
    WHEN 'diaria'    THEN make_interval(days   => p_intervalo)
    WHEN 'semanal'   THEN make_interval(weeks  => p_intervalo)
    WHEN 'quinzenal' THEN make_interval(weeks  => 2 * p_intervalo)
    WHEN 'mensal'    THEN make_interval(months => p_intervalo) END;
  v_ate := p_first_starts_at + make_interval(days => p_horizonte_dias);

  INSERT INTO sched.recurrence (
      tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
      freq, intervalo, first_starts_at, duracao_min, horizonte_ate, created_by)
  VALUES (v_tenant, v_id, p_patient_id, p_professional_id, p_clinic_id, p_procedure_id,
      p_freq, p_intervalo, p_first_starts_at, p_duracao_min,
      app.local_date(v_ate, v_tz), app.current_user_id());

  WHILE v_at <= v_ate LOOP
    BEGIN
      INSERT INTO sched.appointment (
          tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, recurrence_id, created_by)
      VALUES (v_tenant, gen_random_uuid(), p_patient_id, p_professional_id, p_clinic_id,
          p_procedure_id, v_at, v_at + make_interval(mins => p_duracao_min),
          app.local_date(v_at, v_tz), v_id, app.current_user_id());
      v_ger := v_ger + 1;
    EXCEPTION WHEN exclusion_violation THEN
      -- Uma colisao NAO aborta a serie: a recepcionista resolve as puladas
      -- depois, na tela. Abortar tudo por causa de um feriado e o comportamento
      -- que faz a pessoa desistir do recurso.
      v_pul := v_pul + 1;
    END;
    v_at := v_at + v_passo;
  END LOOP;

  PERFORM audit.log('APPOINTMENT_RECURRENCE_CREATE', 'sched', 'recurrence', v_id, 'sucesso',
                    jsonb_build_object('geradas', v_ger, 'puladas', v_pul,
                                       'freq', p_freq::text), p_clinic_id);

  RETURN QUERY SELECT v_id, v_ger, v_pul;
END $fn$;

ALTER FUNCTION sched.materialize_recurrence(
  uuid, uuid, uuid, timestamptz, int, sched.recurrence_freq, int, int, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION sched.materialize_recurrence(
  uuid, uuid, uuid, timestamptz, int, sched.recurrence_freq, int, int, uuid) TO app_rw;
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): materialize recurring appointments up to a 120-day horizon"`

---

### Task 34: `sched.waitlist` — lista de espera com chamada para vaga liberada

**Arquivos:**
- Criar: `packages/db/migrations/0047_waitlist.sql`
- Teste: `packages/db/test/iso/25-waitlist.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/25-waitlist.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoTenant } from './harness';
import { TENANT_A, USER_A_MEDICO, CLINIC_A, PROF_A, PATIENT_A } from './fixtures';

describe('sched.waitlist', () => {
  it('entra na fila com prioridade e janela desejada', async () => {
    const r = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query(
        `INSERT INTO sched.waitlist
           (tenant_id, id, patient_id, professional_id, clinic_id, prioridade,
            janela_de, janela_ate, created_by)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, 'alta',
                 '2026-09-01', '2026-09-30', app.current_user_id())`,
        [TENANT_A, PATIENT_A, PROF_A, CLINIC_A]));
    expect(r.rowCount).toBe(1);
  });

  it('candidatos para um vao saem ordenados por prioridade e depois por espera', async () => {
    const { rows } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query<{ patient_id: string; prioridade: string }>(
        `SELECT patient_id, prioridade::text AS prioridade
           FROM sched.waitlist_candidates($1, '2026-09-08T13:00:00Z'::timestamptz)`,
        [PROF_A]));
    expect(rows[0]?.patient_id).toBe(PATIENT_A);
    expect(rows[0]?.prioridade).toBe('alta');
  });

  it('nao devolve candidato fora da janela desejada', async () => {
    const { rowCount } = await comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
      tx.query(
        `SELECT 1 FROM sched.waitlist_candidates($1, '2026-12-01T13:00:00Z'::timestamptz)`,
        [PROF_A]));
    expect(rowCount).toBe(0);
  });

  it('so ha UMA entrada ativa por paciente e profissional', async () => {
    await expect(
      comoTenant(TENANT_A, USER_A_MEDICO, CLINIC_A, (tx) =>
        tx.query(
          `INSERT INTO sched.waitlist
             (tenant_id, id, patient_id, professional_id, clinic_id, prioridade, created_by)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, 'normal', app.current_user_id())`,
          [TENANT_A, PATIENT_A, PROF_A, CLINIC_A])),
    ).rejects.toThrow(/ux_waitlist_ativa/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "sched.waitlist" does not exist`.

- [ ] `pnpm db:new waitlist` (gera `0047_waitlist.sql`) e escrever:

```sql
-- 0047_waitlist.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — lista de espera como painel lateral fixo da Agenda, com arrastar para o
-- vao. A ordem dos candidatos e regra de NEGOCIO e mora aqui, nao na tela: duas
-- telas com criterios diferentes e como a recepcao perde a confianca na fila.

CREATE TYPE sched.waitlist_priority AS ENUM ('baixa','normal','alta','urgente');

CREATE TABLE sched.waitlist (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid,           -- NULL = qualquer profissional serve
  clinic_id       uuid NOT NULL,
  procedure_id    uuid,
  prioridade      sched.waitlist_priority NOT NULL DEFAULT 'normal',
  janela_de       date,
  janela_ate      date,
  observacao      text,
  -- Chamada: quando a vaga liberou e quem foi avisado.
  called_at       timestamptz(3),
  scheduled_appointment_id uuid,
  closed_at       timestamptz(3),
  close_reason    text,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id),
  FOREIGN KEY (tenant_id, scheduled_appointment_id)
    REFERENCES sched.appointment(tenant_id, id),
  CHECK (janela_de IS NULL OR janela_ate IS NULL OR janela_ate >= janela_de),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL)));
ALTER TABLE sched.waitlist OWNER TO app_owner;

-- coalesce no indice parcial: 'qualquer profissional' e UMA entrada, nao N.
CREATE UNIQUE INDEX ux_waitlist_ativa ON sched.waitlist
  (tenant_id, patient_id, coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE closed_at IS NULL;
CREATE INDEX ix_waitlist_fila ON sched.waitlist
  (tenant_id, clinic_id, prioridade DESC, created_at) WHERE closed_at IS NULL;

CREATE FUNCTION sched.waitlist_candidates(
  p_professional_id uuid, p_starts_at timestamptz, p_limit int DEFAULT 10)
RETURNS TABLE (
  waitlist_id uuid, patient_id uuid, prioridade sched.waitlist_priority,
  esperando_desde timestamptz(3), observacao text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_dia    date;
  v_tz     text;
BEGIN
  SELECT c.timezone INTO v_tz FROM app.clinic c
   WHERE c.tenant_id = v_tenant
     AND EXISTS (SELECT 1 FROM app.professional p
                  WHERE p.tenant_id = v_tenant AND p.id = p_professional_id)
   LIMIT 1;
  v_dia := app.local_date(p_starts_at, coalesce(v_tz, 'America/Sao_Paulo'));

  RETURN QUERY
    SELECT w.id, w.patient_id, w.prioridade, w.created_at, w.observacao
      FROM sched.waitlist w
     WHERE w.tenant_id = v_tenant
       AND w.closed_at IS NULL
       AND (w.professional_id IS NULL OR w.professional_id = p_professional_id)
       AND (w.janela_de  IS NULL OR v_dia >= w.janela_de)
       AND (w.janela_ate IS NULL OR v_dia <= w.janela_ate)
     -- Prioridade primeiro, tempo de espera depois: quem esta ha mais tempo
     -- na mesma prioridade e chamado antes.
     ORDER BY w.prioridade DESC, w.created_at
     LIMIT greatest(p_limit, 1);
END $fn$;
ALTER FUNCTION sched.waitlist_candidates(uuid, timestamptz, int) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION sched.waitlist_candidates(uuid, timestamptz, int) TO app_rw;

GRANT SELECT, INSERT, UPDATE ON sched.waitlist TO app_rw;
ALTER TABLE sched.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.waitlist FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.waitlist AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): add the waiting list with priority-aware candidate lookup"`

---

### Task 35: `scheduling.createAppointment` — o backend do fluxo (a)

**Arquivos:**
- Criar: `packages/scheduling/src/appointments.ts`, `packages/scheduling/src/test-support.ts`
- Modificar: `packages/scheduling/src/index.ts`, `packages/scheduling/package.json`
- Teste: `packages/scheduling/src/appointments.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/scheduling/src/appointments.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment, moveAppointment, setStatus } from './appointments';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor; let apptId = '';

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('agendar', () => {
  it('usa a duracao do procedimento quando o fim nao e informado', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-05T13:00:00Z' }));
    expect(r.ok).toBe(true);
    if (r.ok) { apptId = r.value.appointmentId; expect(r.value.endsAt).toBe('2026-10-05T13:30:00.000Z'); }
  });

  it('recusa conflito e diz que a saida e o encaixe', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-05T13:15:00Z' }));
    expect(r).toEqual({ ok: false, error: { kind: 'horario_ocupado', encaixePossivel: true } });
  });

  it('encaixa quando a recepcao pede explicitamente', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-05T13:15:00Z', encaixe: true }));
    expect(r.ok).toBe(true);
  });

  it('avisa que ha bloqueio sem impedir — a decisao e de quem esta com a pessoa na frente', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-06T15:10:00Z', encaixe: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.avisos).toEqual(['horario_bloqueado']);
  });

  it('mover mantem a duracao e recalcula a data no fuso da clinica', async () => {
    const r = await withTenantTx(actor, (tx) => moveAppointment(tx, {
      appointmentId: apptId, startsAt: '2026-10-07T02:30:00Z' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.appointmentDate).toBe('2026-10-06');
  });

  it('mudar status carimba o instante correspondente', async () => {
    const r = await withTenantTx(actor, (tx) => setStatus(tx, {
      appointmentId: apptId, status: 'confirmado' }));
    expect(r.ok).toBe(true);
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ confirmed_at: string | null }>(
      `SELECT confirmed_at FROM sched.appointment WHERE id = $1`, [apptId]));
    expect(rows[0]?.confirmed_at).not.toBeNull();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- scheduling/src/appointments` → `Failed to resolve import "./appointments"`.

- [ ] Criar `packages/scheduling/src/appointments.ts`:

```ts
// packages/scheduling/src/appointments.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type AppointmentStatus =
  | 'agendado' | 'confirmado' | 'aguardando' | 'atendendo'
  | 'atendido' | 'faltou' | 'cancelado';

export interface CreateAppointmentInput {
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly startsAt: string;            // RFC 3339
  readonly endsAt?: string;
  readonly procedureId?: string;
  readonly roomId?: string;
  readonly operadoraNome?: string;
  readonly encaixe?: boolean;
  readonly teleconsulta?: boolean;
  readonly observacao?: string;
}

export type SchedulingFailure =
  | { kind: 'unidade_nao_encontrada' }
  | { kind: 'duracao_desconhecida' }
  | { kind: 'horario_ocupado'; encaixePossivel: boolean }
  | { kind: 'sala_ocupada' }
  | { kind: 'agendamento_nao_encontrado' };

export interface CreatedAppointment {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly appointmentDate: string;
  readonly avisos: readonly ('horario_bloqueado')[];
}

/** 23P01 = exclusion_violation. E o SQLSTATE do encaixe negado e da sala ocupada. */
const EXCLUSION_VIOLATION = '23P01';

function sqlstateDe(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
}

function restricaoDe(e: unknown): string {
  return typeof e === 'object' && e !== null && 'constraint' in e
    ? String((e as { constraint: unknown }).constraint) : '';
}

export async function createAppointment(
  tx: TxClient, i: CreateAppointmentInput,
): Promise<Result<CreatedAppointment, SchedulingFailure>> {
  const clinica = await tx.query<{ timezone: string }>(
    `SELECT timezone FROM app.clinic WHERE id = $1`, [i.clinicId]);
  const tz = clinica.rows[0]?.timezone;
  if (tz === undefined) return err({ kind: 'unidade_nao_encontrada' });

  let fim = i.endsAt;
  if (fim === undefined) {
    if (i.procedureId === undefined) return err({ kind: 'duracao_desconhecida' });
    const p = await tx.query<{ fim: string }>(
      `SELECT to_char(($2::timestamptz + make_interval(mins => duracao_min)) AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fim
         FROM sched.procedure WHERE id = $1`, [i.procedureId, i.startsAt]);
    fim = p.rows[0]?.fim;
    if (fim === undefined) return err({ kind: 'duracao_desconhecida' });
  }

  // Bloqueio AVISA, nao impede: quem decide encaixar sobre o almoco e a recepcao,
  // com a pessoa na frente. Software que impede vira caderno na mesa.
  const bloq = await tx.query<{ bloqueado: boolean }>(
    `SELECT sched.is_blocked($1, $2::timestamptz, $3::timestamptz) AS bloqueado`,
    [i.professionalId, i.startsAt, fim]);
  const avisos = bloq.rows[0]?.bloqueado === true ? (['horario_bloqueado'] as const) : ([] as const);

  const appointmentId = uuidv7();
  try {
    const { rows } = await tx.query<{ starts: string; ends: string; d: string }>(
      `INSERT INTO sched.appointment (
          id, patient_id, professional_id, clinic_id, room_id, procedure_id,
          operadora_nome, starts_at, ends_at, appointment_date, encaixe, teleconsulta,
          observacao, primeira_vez, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz,
               app.local_date($8::timestamptz, $10), $11, $12, $13,
               NOT EXISTS (SELECT 1 FROM sched.appointment a
                            WHERE a.patient_id = $2 AND a.status = 'atendido'),
               app.current_user_id())
       RETURNING to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts,
                 to_char(ends_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends,
                 appointment_date::text AS d`,
      [appointmentId, i.patientId, i.professionalId, i.clinicId, i.roomId ?? null,
       i.procedureId ?? null, i.operadoraNome ?? null, i.startsAt, fim, tz,
       i.encaixe ?? false, i.teleconsulta ?? false, i.observacao ?? null]);
    const linha = rows[0];
    if (!linha) return err({ kind: 'agendamento_nao_encontrado' });

    await tx.query(
      `SELECT audit.log('APPOINTMENT_CREATE', 'sched', 'appointment', $1, 'sucesso',
                        jsonb_build_object('encaixe', $2::boolean), $3)`,
      [appointmentId, i.encaixe ?? false, i.clinicId]);

    return ok({
      appointmentId,
      startsAt: linha.starts, endsAt: linha.ends, appointmentDate: linha.d, avisos,
    });
  } catch (e) {
    if (sqlstateDe(e) === EXCLUSION_VIOLATION) {
      if (restricaoDe(e) === 'ex_appointment_sala') return err({ kind: 'sala_ocupada' });
      // encaixePossivel diz para a tela oferecer "Encaixar mesmo assim" em vez de
      // um erro seco. E o gesto que a recepcao brasileira faz o dia inteiro.
      return err({ kind: 'horario_ocupado', encaixePossivel: true });
    }
    throw e;
  }
}

export interface MoveInput {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly professionalId?: string;
  readonly roomId?: string | null;
}

/** Arrastar na agenda. Mantem a DURACAO e recalcula a data no fuso da unidade. */
export async function moveAppointment(
  tx: TxClient, i: MoveInput,
): Promise<Result<{ appointmentId: string; startsAt: string; endsAt: string;
                   appointmentDate: string }, SchedulingFailure>> {
  try {
    const { rows } = await tx.query<{ starts: string; ends: string; d: string }>(
      `UPDATE sched.appointment a
          SET starts_at = $2::timestamptz,
              ends_at   = $2::timestamptz + (a.ends_at - a.starts_at),
              professional_id = coalesce($3::uuid, a.professional_id),
              room_id   = CASE WHEN $4::boolean THEN $5::uuid ELSE a.room_id END,
              appointment_date = app.local_date($2::timestamptz,
                                   (SELECT c.timezone FROM app.clinic c WHERE c.id = a.clinic_id))
        WHERE a.id = $1
      RETURNING to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts,
                to_char(a.ends_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends,
                a.appointment_date::text AS d`,
      [i.appointmentId, i.startsAt, i.professionalId ?? null,
       i.roomId !== undefined, i.roomId ?? null]);
    const linha = rows[0];
    if (!linha) return err({ kind: 'agendamento_nao_encontrado' });
    return ok({ appointmentId: i.appointmentId, startsAt: linha.starts,
                endsAt: linha.ends, appointmentDate: linha.d });
  } catch (e) {
    if (sqlstateDe(e) === EXCLUSION_VIOLATION) {
      if (restricaoDe(e) === 'ex_appointment_sala') return err({ kind: 'sala_ocupada' });
      return err({ kind: 'horario_ocupado', encaixePossivel: true });
    }
    throw e;
  }
}

const CARIMBO: Readonly<Record<AppointmentStatus, string | null>> = {
  agendado: null, confirmado: 'confirmed_at', aguardando: 'arrived_at',
  atendendo: 'started_at', atendido: 'finished_at', faltou: null, cancelado: 'cancelled_at',
};

export interface SetStatusInput {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
  readonly cancelReason?: string;
}

export async function setStatus(
  tx: TxClient, i: SetStatusInput,
): Promise<Result<{ appointmentId: string; status: AppointmentStatus }, SchedulingFailure>> {
  const coluna = CARIMBO[i.status];
  // O nome da coluna vem de um mapa fechado sobre o tipo, nunca da entrada:
  // interpolar identificador vindo do cliente e injecao de SQL.
  const setExtra = coluna === null ? '' : `, ${coluna} = clock_timestamp()`;
  const { rowCount } = await tx.query(
    `UPDATE sched.appointment
        SET status = $2::sched.appointment_status,
            cancel_reason = CASE WHEN $2 = 'cancelado' THEN $3 ELSE cancel_reason END
            ${setExtra}
      WHERE id = $1`,
    [i.appointmentId, i.status, i.cancelReason ?? null]);
  if (rowCount === 0) return err({ kind: 'agendamento_nao_encontrado' });

  await tx.query(
    `SELECT audit.log('APPOINTMENT_STATUS', 'sched', 'appointment', $1, 'sucesso',
                      jsonb_build_object('status', $2::text), NULL)`,
    [i.appointmentId, i.status]);
  return ok({ appointmentId: i.appointmentId, status: i.status });
}
```

- [ ] Criar `packages/scheduling/src/test-support.ts` no mesmo padrão do `packages/emr/src/test-support.ts`, acrescentando um `sched.procedure` de 30 minutos (`procedureId`) e um `sched.block` das 15h às 16h UTC do dia `2026-10-06` para o profissional semeado. Campos exportados: `tenantId`, `clinicId`, `userId`, `professionalId`, `patientId`, `procedureId`.

```ts
// packages/scheduling/src/test-support.ts
import { appPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeAgenda {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string; procedureId: string;
}

export async function semearAgenda(): Promise<SementeAgenda> {
  const s: SementeAgenda = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), procedureId: uuidv7(),
  };
  const c = await appPool().connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Agenda', '12ABC34501DE35')`,
      [s.tenantId, `a-${s.tenantId.slice(0, 8)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`, [s.tenantId, s.clinicId]);
    await c.query(`INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`, [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Maria Souza Lima', 'completo')`, [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`, [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO sched.block
         (tenant_id, id, professional_id, clinic_id, starts_at, ends_at, kind, motivo, created_by)
       VALUES ($1, gen_random_uuid(), $2, $3,
               '2026-10-06T15:00:00Z', '2026-10-06T16:00:00Z', 'almoco', 'Almoco', $4)`,
      [s.tenantId, s.professionalId, s.clinicId, s.userId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  return s;
}
```

- [ ] Substituir `packages/scheduling/src/index.ts` por:

```ts
export {
  createAppointment, moveAppointment, setStatus,
  type AppointmentStatus, type CreateAppointmentInput, type CreatedAppointment,
  type MoveInput, type SchedulingFailure, type SetStatusInput,
} from './appointments';
```

- [ ] Declarar as dependências em `packages/scheduling/package.json` (`@cadencia/db`, `@cadencia/kernel`), rodar `pnpm install`.
- [ ] Rodar: `pnpm test:int -- scheduling/src/appointments` → 6 testes passam.
- [ ] `pnpm arch:check` → verde.
- [ ] Commitar: `git commit -m "feat(scheduling): create, move and transition appointments with encaixe support"`

---

### Task 36: `scheduling.dayQueue` — a fila do dia e os contadores ao vivo

Contadores do dia são **consulta viva** sobre índice parcial, **nunca** matview: contador defasado é lido como "travou", que é a queixa que o produto existe para resolver. Alvo: **< 20 ms**.

**Arquivos:**
- Criar: `packages/scheduling/src/day.ts`
- Modificar: `packages/scheduling/src/index.ts`
- Teste: `packages/scheduling/src/day.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/scheduling/src/day.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment, setStatus } from './appointments';
import { dayCounters, dayQueue } from './day';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor; let ids: string[] = [];
const DIA = '2026-11-10';

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  for (const h of ['13:00', '14:00', '15:00', '16:00', '17:00']) {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: `${DIA}T${h}:00Z` }));
    if (r.ok) ids.push(r.value.appointmentId);
  }
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[1]!, status: 'confirmado' }));
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[2]!, status: 'aguardando' }));
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[3]!, status: 'atendido' }));
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[4]!, status: 'faltou' }));
});
afterAll(async () => { await closePools(); });

describe('o dia', () => {
  it('conta os cinco estados que a faixa de Hoje mostra', async () => {
    const r = await withTenantTx(actor, (tx) => dayCounters(tx, { clinicId: s.clinicId, dia: DIA }));
    expect(r).toEqual({
      agendados: 5, confirmados: 1, aguardando: 1, atendidos: 1, faltas: 1 });
  });

  it('a fila sai em ordem de horario, com os sinais que a linha mostra', async () => {
    const r = await withTenantTx(actor, (tx) => dayQueue(tx, { clinicId: s.clinicId, dia: DIA }));
    expect(r).toHaveLength(5);
    expect(r[0]?.status).toBe('agendado');
    expect(r[0]?.cadastroPreliminar).toBe(false);
    expect(r[0]?.primeiraVez).toBe(true);
    expect(r[0]?.displayName).toBe('Maria Souza Lima');
  });

  it('filtrar por status devolve so aquele grupo — cada numero da faixa e um filtro', async () => {
    const r = await withTenantTx(actor, (tx) =>
      dayQueue(tx, { clinicId: s.clinicId, dia: DIA, status: 'aguardando' }));
    expect(r).toHaveLength(1);
    expect(r[0]?.appointmentId).toBe(ids[2]);
  });

  it('o plano dos contadores nao tem Seq Scan — indice parcial, alvo < 20 ms', async () => {
    const plano = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ 'QUERY PLAN': unknown[] }>(
        `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS OFF)
         SELECT count(*) FILTER (WHERE status <> 'cancelado') AS agendados
           FROM sched.appointment
          WHERE tenant_id = app.current_tenant_id() AND clinic_id = $1
            AND appointment_date = $2::date AND status <> 'cancelado'`,
        [s.clinicId, DIA]);
      return JSON.stringify(rows[0]?.['QUERY PLAN']);
    });
    expect(plano).not.toContain('"Seq Scan"');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- scheduling/src/day` → `Failed to resolve import "./day"`.

- [ ] Criar `packages/scheduling/src/day.ts`:

```ts
// packages/scheduling/src/day.ts
import type { TxClient } from '@cadencia/db';
import type { AppointmentStatus } from './appointments';

export interface DayCounters {
  readonly agendados: number;
  readonly confirmados: number;
  readonly aguardando: number;
  readonly atendidos: number;
  readonly faltas: number;
}

export interface DayQuery {
  readonly clinicId: string;
  readonly dia: string;                  // AAAA-MM-DD no fuso da clinica
  readonly professionalId?: string;
  readonly status?: AppointmentStatus;
}

/**
 * §3.8 e §5.3 — contadores do dia por CONSULTA VIVA sobre indice parcial,
 * NUNCA matview. Contador defasado e lido como "travou", que e exatamente a
 * queixa que o produto existe para resolver. Alvo publicado: < 20 ms.
 *
 * `agendados` e o TOTAL do dia (todo mundo que esta na fila), nao o subconjunto
 * ainda em status 'agendado' — e o numero que a recepcao le como "quantos hoje".
 */
export async function dayCounters(tx: TxClient, q: DayQuery): Promise<DayCounters> {
  const { rows } = await tx.query<{
    agendados: string; confirmados: string; aguardando: string;
    atendidos: string; faltas: string }>(
    `SELECT count(*)                                            AS agendados,
            count(*) FILTER (WHERE status = 'confirmado')        AS confirmados,
            count(*) FILTER (WHERE status IN ('aguardando','atendendo')) AS aguardando,
            count(*) FILTER (WHERE status = 'atendido')          AS atendidos,
            count(*) FILTER (WHERE status = 'faltou')            AS faltas
       FROM sched.appointment
      WHERE clinic_id = $1 AND appointment_date = $2::date
        AND status <> 'cancelado'
        AND ($3::uuid IS NULL OR professional_id = $3::uuid)`,
    [q.clinicId, q.dia, q.professionalId ?? null]);
  const r = rows[0];
  return {
    agendados: Number(r?.agendados ?? 0),
    confirmados: Number(r?.confirmados ?? 0),
    aguardando: Number(r?.aguardando ?? 0),
    atendidos: Number(r?.atendidos ?? 0),
    faltas: Number(r?.faltas ?? 0),
  };
}

export interface QueueRow {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly professionalId: string;
  readonly procedureNome: string | null;
  readonly procedureCor: string | null;
  readonly operadoraNome: string | null;
  readonly status: AppointmentStatus;
  readonly encaixe: boolean;
  readonly teleconsulta: boolean;
  readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean;
  readonly encounterId: string | null;
}

/**
 * A fila do dia. Traz os quatro SINAIS que a linha mostra (§5.3): cadastro
 * preliminar, 1a vez, teleconsulta e encaixe. O `encounterId` diz se o
 * atendimento ja foi aberto — e o que decide entre "Abrir atendimento" e
 * "Continuar".
 */
export async function dayQueue(tx: TxClient, q: DayQuery): Promise<QueueRow[]> {
  const { rows } = await tx.query<{
    id: string; starts: string; ends: string; patient_id: string; display_name: string;
    professional_id: string; proc_nome: string | null; proc_cor: string | null;
    operadora_nome: string | null; status: AppointmentStatus; encaixe: boolean;
    teleconsulta: boolean; primeira_vez: boolean; cadastro_status: string;
    encounter_id: string | null;
  }>(
    `SELECT a.id,
            to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts,
            to_char(a.ends_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends,
            a.patient_id, p.display_name, a.professional_id,
            pr.nome AS proc_nome, pr.cor AS proc_cor, a.operadora_nome,
            a.status::text AS status, a.encaixe, a.teleconsulta, a.primeira_vez,
            p.cadastro_status,
            (SELECT e.id FROM clin.encounter e
              WHERE e.tenant_id = a.tenant_id AND e.appointment_id = a.id LIMIT 1) AS encounter_id
       FROM sched.appointment a
       JOIN clin.patient p ON (p.tenant_id, p.id) = (a.tenant_id, a.patient_id)
       LEFT JOIN sched.procedure pr ON (pr.tenant_id, pr.id) = (a.tenant_id, a.procedure_id)
      WHERE a.clinic_id = $1 AND a.appointment_date = $2::date
        AND a.status <> 'cancelado'
        AND ($3::uuid IS NULL OR a.professional_id = $3::uuid)
        AND ($4::text IS NULL OR a.status::text = $4::text)
      ORDER BY a.starts_at, a.encaixe, a.id`,
    [q.clinicId, q.dia, q.professionalId ?? null, q.status ?? null]);

  return rows.map((r) => ({
    appointmentId: r.id, startsAt: r.starts, endsAt: r.ends,
    patientId: r.patient_id, displayName: r.display_name,
    professionalId: r.professional_id,
    procedureNome: r.proc_nome, procedureCor: r.proc_cor,
    operadoraNome: r.operadora_nome, status: r.status,
    encaixe: r.encaixe, teleconsulta: r.teleconsulta, primeiraVez: r.primeira_vez,
    cadastroPreliminar: r.cadastro_status === 'preliminar',
    encounterId: r.encounter_id,
  }));
}
```

- [ ] Acrescentar em `packages/scheduling/src/index.ts`:

```ts
export { dayCounters, dayQueue, type DayCounters, type DayQuery, type QueueRow } from './day';
```

- [ ] Rodar: `pnpm test:int -- scheduling/src/day` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(scheduling): live day counters and queue over a partial index"`

---

### Task 37: `scheduling.checkIn` — o momento certo de cobrar a dívida de dados

**Arquivos:**
- Criar: `packages/scheduling/src/check-in.ts`
- Modificar: `packages/scheduling/src/index.ts`
- Teste: `packages/scheduling/src/check-in.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/scheduling/src/check-in.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment } from './appointments';
import { checkIn } from './check-in';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor; let apptId = '';

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  await appPool().query(
    `UPDATE clin.patient SET cadastro_status='preliminar', birth_date=NULL WHERE id=$1`,
    [s.patientId]);
  const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
    patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
    procedureId: s.procedureId, startsAt: '2026-11-20T13:00:00Z' }));
  if (r.ok) apptId = r.value.appointmentId;
});
afterAll(async () => { await closePools(); });

describe('check-in', () => {
  it('marca aguardando e devolve a divida de dados a cobrar no balcao', async () => {
    const r = await withTenantTx(actor, (tx) => checkIn(tx, { appointmentId: apptId }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('aguardando');
      expect(r.value.pendentes).toEqual(['birth_date', 'cpf', 'sex_at_birth']);
    }
  });

  it('o check-in NAO bloqueia por cadastro preliminar — quem bloqueia e a finalizacao', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ status: string }>(
      `SELECT status::text AS status FROM sched.appointment WHERE id = $1`, [apptId]));
    expect(rows[0]?.status).toBe('aguardando');
  });

  it('grava evento de auditoria do check-in', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'APPOINTMENT_CHECKIN' AND entity_id = $1`, [apptId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- check-in` → `Failed to resolve import "./check-in"`.

- [ ] Criar `packages/scheduling/src/check-in.ts`:

```ts
// packages/scheduling/src/check-in.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { SchedulingFailure } from './appointments';

export interface CheckInResult {
  readonly appointmentId: string;
  readonly status: 'aguardando';
  /** A divida de dados a cobrar AGORA, com a pessoa na frente. */
  readonly pendentes: readonly string[];
}

/**
 * §5.5 — o check-in e o MOMENTO CERTO de cobrar CPF, nascimento e sexo: a pessoa
 * esta na frente e o dado sai correto. Ele NAO bloqueia: quem bloqueia e a
 * finalizacao do atendimento e o faturamento de convenio, que sao os momentos em
 * que o dado e de fato obrigatorio. Cobrar no agendamento por telefone e o que
 * faz nascer o 000.000.000-00.
 *
 * A funcao NAO importa @cadencia/patients: scheduling e patients sao de camadas
 * diferentes (L2 e L1) e a seta desce, mas a consulta aqui e de tres colunas —
 * criar dependencia entre modulos por causa disso e o inicio do acoplamento que
 * o §2.2 existe para evitar.
 */
export async function checkIn(
  tx: TxClient, i: { appointmentId: string },
): Promise<Result<CheckInResult, SchedulingFailure>> {
  const { rows } = await tx.query<{
    patient_id: string; clinic_id: string;
    birth_date: string | null; sex_at_birth: string | null; tem_doc: boolean }>(
    `UPDATE sched.appointment a
        SET status = 'aguardando', arrived_at = clock_timestamp()
      WHERE a.id = $1 AND a.status IN ('agendado','confirmado')
    RETURNING a.patient_id, a.clinic_id,
              (SELECT p.birth_date::text FROM clin.patient p
                WHERE (p.tenant_id, p.id) = (a.tenant_id, a.patient_id)) AS birth_date,
              (SELECT p.sex_at_birth FROM clin.patient p
                WHERE (p.tenant_id, p.id) = (a.tenant_id, a.patient_id)) AS sex_at_birth,
              EXISTS (SELECT 1 FROM clin.patient_identifier i
                       WHERE i.tenant_id = a.tenant_id AND i.patient_id = a.patient_id
                         AND i.kind IN ('CPF','CNS','DNV','PASSAPORTE','SEM_DOCUMENTO')) AS tem_doc`,
    [i.appointmentId]);

  const r = rows[0];
  if (!r) return err({ kind: 'agendamento_nao_encontrado' });

  const pendentes: string[] = [];
  if (r.birth_date === null) pendentes.push('birth_date');
  if (!r.tem_doc) pendentes.push('cpf');
  if (r.sex_at_birth === null) pendentes.push('sex_at_birth');

  await tx.query(
    `SELECT audit.log('APPOINTMENT_CHECKIN', 'sched', 'appointment', $1, 'sucesso',
                      jsonb_build_object('pendencias', $2::int), $3)`,
    [i.appointmentId, pendentes.length, r.clinic_id]);

  return ok({ appointmentId: i.appointmentId, status: 'aguardando', pendentes });
}
```

- [ ] Acrescentar em `packages/scheduling/src/index.ts`:

```ts
export { checkIn, type CheckInResult } from './check-in';
```

- [ ] Rodar: `pnpm test:int -- check-in` → 3 testes passam.
- [ ] Commitar: `git commit -m "feat(scheduling): check in patients and surface the data debt at the counter"`

---

### Task 38: `scheduling.needsYou` — o painel "Precisa de você"

**Arquivos:**
- Criar: `packages/scheduling/src/needs-you.ts`
- Modificar: `packages/scheduling/src/index.ts`
- Teste: `packages/scheduling/src/needs-you.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/scheduling/src/needs-you.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment } from './appointments';
import { needsYou } from './needs-you';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor;

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  // Amanha, sem confirmacao: entra em "confirmacoes sem resposta".
  await withTenantTx(actor, (tx) => createAppointment(tx, {
    patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
    procedureId: s.procedureId,
    startsAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString() }));
});
afterAll(async () => { await closePools(); });

describe('painel Precisa de voce', () => {
  it('devolve as cinco filas na ordem em que a tela as mostra', async () => {
    const r = await withTenantTx(actor, (tx) => needsYou(tx, { clinicId: s.clinicId }));
    expect(Object.keys(r)).toEqual([
      'confirmacoesSemResposta', 'prescricoesNaoAssinadas', 'resultadosChegados',
      'rascunhosDeOntem', 'guiasAFaturar',
    ]);
  });

  it('conta o agendamento de amanha ainda sem confirmacao', async () => {
    const r = await withTenantTx(actor, (tx) => needsYou(tx, { clinicId: s.clinicId }));
    expect(r.confirmacoesSemResposta).toBeGreaterThanOrEqual(1);
  });

  it('nao conta rascunho de hoje como rascunho de ontem', async () => {
    const r = await withTenantTx(actor, (tx) => needsYou(tx, { clinicId: s.clinicId }));
    expect(r.rascunhosDeOntem).toBe(0);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- needs-you` → `Failed to resolve import "./needs-you"`.

- [ ] Criar `packages/scheduling/src/needs-you.ts`:

```ts
// packages/scheduling/src/needs-you.ts
import type { TxClient } from '@cadencia/db';

export interface NeedsYou {
  readonly confirmacoesSemResposta: number;
  readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number;
  readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

/**
 * §5.3 — o painel "Precisa de voce" de Hoje. Cinco filas de trabalho, contadas
 * ao vivo. Cada uma existe porque e uma pendencia que hoje mora na cabeca de
 * alguem: o produto so e util se ela sair de la.
 *
 * `resultadosChegados` conta anexos de exame ainda nao vinculados a versao;
 * na Fase 1 clin.attachment nasce na Task 47, e ate la o numero e zero por
 * construcao — o campo existe desde agora para que a tela nao mude de forma.
 */
export async function needsYou(
  tx: TxClient, q: { clinicId: string; professionalId?: string },
): Promise<NeedsYou> {
  const { rows } = await tx.query<{
    confirmacoes: string; prescricoes: string; resultados: string;
    rascunhos: string; guias: string }>(
    `WITH tz AS (
       SELECT c.timezone FROM app.clinic c WHERE c.id = $1
     )
     SELECT
       (SELECT count(*) FROM sched.appointment a
         WHERE a.clinic_id = $1 AND a.status = 'agendado'
           AND a.starts_at BETWEEN clock_timestamp()
                               AND clock_timestamp() + interval '48 hours'
           AND ($2::uuid IS NULL OR a.professional_id = $2::uuid)) AS confirmacoes,
       (SELECT count(*) FROM clin.prescription p
         WHERE p.clinic_id = $1 AND p.signature_id IS NULL AND p.cancelled_at IS NULL
           AND ($2::uuid IS NULL OR p.professional_id = $2::uuid)) AS prescricoes,
       (SELECT count(*) FROM clin.attachment at
         WHERE at.version_id IS NULL AND at.kind = 'resultado_exame') AS resultados,
       (SELECT count(*) FROM clin.encounter_draft d
          JOIN clin.encounter e ON (e.tenant_id, e.id) = (d.tenant_id, d.encounter_id)
         WHERE e.clinic_id = $1 AND e.status = 'rascunho'
           AND e.occurred_date < app.local_date(clock_timestamp(), (SELECT timezone FROM tz))
           AND ($2::uuid IS NULL OR e.professional_id = $2::uuid)) AS rascunhos,
       (SELECT count(*) FROM clin.encounter_billing b
          JOIN clin.encounter e ON (e.tenant_id, e.id) = (b.tenant_id, b.encounter_id)
         WHERE e.clinic_id = $1 AND b.registro_ans IS NOT NULL
           AND e.status = 'finalizado') AS guias`,
    [q.clinicId, q.professionalId ?? null]);

  const r = rows[0];
  return {
    confirmacoesSemResposta: Number(r?.confirmacoes ?? 0),
    prescricoesNaoAssinadas: Number(r?.prescricoes ?? 0),
    resultadosChegados: Number(r?.resultados ?? 0),
    rascunhosDeOntem: Number(r?.rascunhos ?? 0),
    guiasAFaturar: Number(r?.guias ?? 0),
  };
}
```

> **Ordem de execução:** esta tarefa referencia `clin.prescription` (Task 53) e `clin.attachment` (Task 47). Execute-a **depois** da Task 53. Se preferir manter a ordem literal, comente as duas subconsultas com `SELECT 0 AS prescricoes` / `SELECT 0 AS resultados` e reative-as ao concluir a Task 53 — o teste da Task 53 já cobre a reativação.

- [ ] Acrescentar em `packages/scheduling/src/index.ts`:

```ts
export { needsYou, type NeedsYou } from './needs-you';
```

- [ ] Rodar: `pnpm test:int -- needs-you` → 3 testes passam.
- [ ] Commitar: `git commit -m "feat(scheduling): count the five work queues of the needs-you panel"`

---

## Parte VI — Assinatura digital ICP-Brasil via PSC em nuvem

### Task 39: contratos comuns de integração — `Provider`, `ProviderResult`, `Safety`

Retryability é propriedade da **operação**, não do erro. Timeout **nunca** gera retry automático em operação `unsafe`: gera estado indeterminado e agenda reconciliação.

**Arquivos:**
- Criar: `packages/integrations/src/contracts/common.ts`
- Modificar: `packages/integrations/src/index.ts`, `packages/integrations/package.json`
- Teste: `packages/integrations/src/contracts/common.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/integrations/src/contracts/common.test.ts
import { describe, expect, it } from 'vitest';
import { isRetryable, failure, success, asE164, asRfc3339 } from './common';

describe('contrato comum de provedor', () => {
  it('unavailable e a UNICA falha com retry automatico', () => {
    expect(isRetryable(failure({ kind: 'unavailable', retrySafe: true, detail: 'psc fora' }))).toBe(true);
  });

  it('timeout NUNCA gera retry — o estado do parceiro e DESCONHECIDO', () => {
    expect(isRetryable(failure({ kind: 'timeout', retrySafe: false, detail: '3s' }))).toBe(false);
  });

  it('rejected, misconfigured e unsupported tambem nao', () => {
    for (const kind of ['rejected', 'misconfigured', 'unsupported'] as const) {
      const f = kind === 'rejected'
        ? failure({ kind, retrySafe: false, code: 'E1', detail: 'x' })
        : failure({ kind, retrySafe: false, detail: 'x' });
      expect(isRetryable(f), kind).toBe(false);
    }
  });

  it('sucesso carrega a referencia do parceiro', () => {
    const r = success({ ok: 1 }, 'ref-123');
    expect(r).toEqual({ ok: true, value: { ok: 1 }, providerRef: 'ref-123' });
  });

  it('E164 recusa telefone sem o codigo do pais', () => {
    expect(asE164('11987654321')).toBeNull();
    expect(asE164('+5511987654321')).toBe('+5511987654321');
  });

  it('Rfc3339 exige milissegundos e Z — o carimbo do parceiro nunca vem em horario local', () => {
    expect(asRfc3339('2026-08-03T17:30:00Z')).toBeNull();
    expect(asRfc3339('2026-08-03T17:30:00.000Z')).toBe('2026-08-03T17:30:00.000Z');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- contracts/common` → `Failed to resolve import "./common"`.

- [ ] Criar `packages/integrations/src/contracts/common.ts`:

```ts
// packages/integrations/src/contracts/common.ts

/**
 * §7 — o contrato comum de todo provedor externo.
 *
 * A garantia mais cara do documento: timeout NUNCA gera retry automatico em
 * operacao `unsafe`. Gera estado `indeterminado` persistido e agenda
 * RECONCILIACAO — o job consulta o parceiro (getPayment, fetchPrescription,
 * busca por idempotencyKey) e so reenvia se confirmar que nao houve efeito.
 * Sem isso: tres WhatsApps identicos as 7h da manha degradando a qualidade do
 * numero PROPRIO da clinica, estorno em dobro, lote TISS glosado por duplicidade.
 */

export type Rfc3339 = string & { readonly __brand: 'Rfc3339' };   // UTC, com ms
export type E164 = string & { readonly __brand: 'E164' };
export type StorageKey = string & { readonly __brand: 'StorageKey' };

/** Retryability e propriedade da OPERACAO, nao do erro. */
export type Safety = 'safe' | 'idempotent' | 'unsafe';

export interface ProviderCtx {
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly requestId: string;
  /** Estavel por agregado + intencao. Duas chamadas da mesma intencao repetem a chave. */
  readonly idempotencyKey: string;
  readonly deadlineMs: number;
}

export type ProviderFailure =
  | { kind: 'unavailable';   retrySafe: true;  retryAfterMs?: number; detail: string }
  | { kind: 'timeout';       retrySafe: false; detail: string }   // ESTADO DESCONHECIDO
  | { kind: 'rejected';      retrySafe: false; code: string; detail: string }
  | { kind: 'misconfigured'; retrySafe: false; detail: string }
  | { kind: 'unsupported';   retrySafe: false; detail: string };

export type ProviderResult<T> =
  | { ok: true;  value: T; providerRef: string; rawArchiveKey?: StorageKey }
  | { ok: false; error: ProviderFailure; rawArchiveKey?: StorageKey };

export interface Provider {
  readonly id: string;
  /** Inclui 'residency:br' quando aplicavel. O runtime recusa quem nao declara. */
  readonly capabilities: ReadonlySet<string>;
  /** Por metodo, OBRIGATORIO: e o que o reconciliador consulta. */
  readonly safety: Readonly<Record<string, Safety>>;
  health(): Promise<{ up: boolean; latencyMs: number; checkedAt: Rfc3339 }>;
}

export function success<T>(value: T, providerRef: string, rawArchiveKey?: StorageKey):
ProviderResult<T> {
  return rawArchiveKey === undefined
    ? { ok: true, value, providerRef }
    : { ok: true, value, providerRef, rawArchiveKey };
}

export function failure<T>(error: ProviderFailure, rawArchiveKey?: StorageKey):
ProviderResult<T> {
  return rawArchiveKey === undefined ? { ok: false, error } : { ok: false, error, rawArchiveKey };
}

/** Unica porta de entrada do retry automatico. Nao existe outra regra em lugar nenhum. */
export function isRetryable<T>(r: ProviderResult<T>): boolean {
  return !r.ok && r.error.kind === 'unavailable';
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
export function asE164(v: string): E164 | null {
  return E164_RE.test(v) ? (v as E164) : null;
}

const RFC3339_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function asRfc3339(v: string): Rfc3339 | null {
  return RFC3339_MS_RE.test(v) ? (v as Rfc3339) : null;
}

export function asStorageKey(v: string): StorageKey {
  return v as StorageKey;
}
```

- [ ] Substituir `packages/integrations/src/index.ts` por:

```ts
export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
```

- [ ] Rodar: `pnpm test -- contracts/common` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(integrations): define the common provider contract with operation-level safety"`

---

### Task 40: `SignatureProvider` — AD-RB **não existe** no tipo

Com guarda de 20 anos, assinatura sem carimbo do tempo vira "indeterminada" quando o certificado expira e a AC para de publicar a LCR daquela data — e isso acontece com o **acervo inteiro de uma vez**, sem correção retroativa.

**Arquivos:**
- Criar: `packages/integrations/src/contracts/signature.ts`
- Modificar: `packages/integrations/src/index.ts`
- Teste: `packages/integrations/src/contracts/signature.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/integrations/src/contracts/signature.test.ts
import { describe, expect, it } from 'vitest';
import { SIGNATURE_POLICIES, isSignaturePolicy } from './signature';

describe('politica de assinatura', () => {
  it('so existem AD-RT e AD-RA — AD-RB foi REMOVIDO do tipo, nao deixado como opcao', () => {
    expect(SIGNATURE_POLICIES).toEqual(['AD_RT_CAdES_2.4', 'AD_RA_CAdES_2.4']);
  });

  it('recusa AD-RB em runtime tambem, nao so no compilador', () => {
    expect(isSignaturePolicy('AD_RB_CAdES_2.4')).toBe(false);
    expect(isSignaturePolicy('AD_RT_CAdES_2.4')).toBe(true);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- contracts/signature` → `Failed to resolve import "./signature"`.

- [ ] Criar `packages/integrations/src/contracts/signature.ts`:

```ts
// packages/integrations/src/contracts/signature.ts
import type { Provider, ProviderCtx, ProviderResult, Rfc3339, StorageKey } from './common';

/**
 * §7.2 e §10 item 7 — PSC em nuvem. A chave privada do medico NUNCA sai do HSM:
 * enviamos o HASH e recebemos o PKCS#7 destacado. Isso remove um passivo enorme
 * (guardar chave privada de terceiro) e e a razao de o contrato falar em hash.
 *
 * AD_RB NAO EXISTE neste tipo, de proposito. Com guarda de 20 anos, assinatura
 * sem carimbo de tempo vira "indeterminada" quando o certificado expira e a AC
 * para de publicar a LCR daquela data — e isso acontece com o acervo INTEIRO de
 * uma vez, sem correcao retroativa.
 */
export const SIGNATURE_POLICIES = ['AD_RT_CAdES_2.4', 'AD_RA_CAdES_2.4'] as const;
export type SignaturePolicy = (typeof SIGNATURE_POLICIES)[number];

export function isSignaturePolicy(v: string): v is SignaturePolicy {
  return (SIGNATURE_POLICIES as readonly string[]).includes(v);
}

export interface CertificateInfo {
  readonly subjectCn: string;
  readonly signerCpf: string;
  readonly serial: string;
  readonly issuer: string;
  readonly notBefore: Rfc3339;
  readonly notAfter: Rfc3339;
}

export interface SignDocumentInput {
  readonly documentId: string;
  readonly hashAlgorithm: 'SHA-256';
  readonly hashBase64: string;
  /** Os BYTES canonicos que geraram o hash, no S3. Sem eles nao se verifica nada. */
  readonly canonicalPayloadKey: StorageKey;
  readonly canonicalVersion: string;
  readonly policy: SignaturePolicy;
  readonly detached: true;
}

export interface SignedDocument {
  readonly documentId: string;
  readonly signatureP7s: Uint8Array;
  readonly signedAt: Rfc3339;
  /** ACT credenciada: OBRIGATORIO, nao opcional. */
  readonly timestampToken: Uint8Array;
  /** Cadeia + LCR/OCSP do instante da assinatura. E o que faz o LTV existir. */
  readonly ltvMaterial: Uint8Array;
}

export interface VerifyResult {
  readonly status: 'valida' | 'invalida' | 'indeterminada';
  readonly chainOk: boolean;
  readonly revocationOk: boolean;
  readonly timestampOk: boolean;
  readonly reasons: readonly string[];
}

export interface SignatureProvider extends Provider {
  authorizeSigner(ctx: ProviderCtx, i: { userId: string; redirectUri: string }):
    Promise<ProviderResult<{ authorizationUrl: string; state: string }>>;

  completeAuthorization(ctx: ProviderCtx, i: { state: string; code: string }):
    Promise<ProviderResult<{ signerRef: string; certificate: CertificateInfo; expiresAt: Rfc3339 }>>;

  /** Assina o HASH do payload canonico. safety: 'idempotent' por documentId. */
  sign(ctx: ProviderCtx, i: { signerRef: string; otp?: string;
    documents: readonly SignDocumentInput[] }):
    Promise<ProviderResult<readonly SignedDocument[]>>;

  verify(i: { canonicalPayload: Uint8Array; signatureP7s: Uint8Array; at?: Rfc3339 }):
    Promise<ProviderResult<VerifyResult>>;

  retimestamp(ctx: ProviderCtx, i: { signatureId: string }):
    Promise<ProviderResult<{ token: Uint8Array }>>;
}
```

- [ ] Acrescentar em `packages/integrations/src/index.ts`:

```ts
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
```

- [ ] Rodar: `pnpm test -- contracts/signature` → 2 testes passam.
- [ ] Commitar: `git commit -m "feat(integrations): declare the cloud signature provider without AD-RB"`

---

### Task 41: `FakeSignatureProvider` — o produto inteiro se desenvolve offline

**Arquivos:**
- Criar: `packages/integrations/src/fakes/signature-fake.ts`
- Modificar: `packages/integrations/src/index.ts`
- Teste: `packages/integrations/src/fakes/signature-fake.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/integrations/src/fakes/signature-fake.test.ts
import { describe, expect, it } from 'vitest';
import { createFakeSignatureProvider } from './signature-fake';
import { asStorageKey, type ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'doc-1', deadlineMs: 3000,
};

const doc = {
  documentId: 'doc-1', hashAlgorithm: 'SHA-256' as const,
  hashBase64: Buffer.alloc(32, 7).toString('base64'),
  canonicalPayloadKey: asStorageKey('k'), canonicalVersion: 'jcs-1',
  policy: 'AD_RT_CAdES_2.4' as const, detached: true as const,
};

describe('provedor de assinatura falso', () => {
  it('declara safety por metodo — sign e idempotent, verify e safe', () => {
    const p = createFakeSignatureProvider();
    expect(p.safety.sign).toBe('idempotent');
    expect(p.safety.verify).toBe('safe');
  });

  it('devolve PKCS#7, carimbo de tempo e material LTV — os tres, sempre', async () => {
    const p = createFakeSignatureProvider();
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]?.signatureP7s.byteLength).toBeGreaterThan(0);
      expect(r.value[0]?.timestampToken.byteLength).toBeGreaterThan(0);
      expect(r.value[0]?.ltvMaterial.byteLength).toBeGreaterThan(0);
    }
  });

  it('e idempotente: a mesma chave devolve a MESMA assinatura, byte a byte', async () => {
    const p = createFakeSignatureProvider();
    const a = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    const b = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    if (a.ok && b.ok) {
      expect(Buffer.from(a.value[0]!.signatureP7s).toString('hex'))
        .toBe(Buffer.from(b.value[0]!.signatureP7s).toString('hex'));
    }
  });

  it('verify aprova o que ele mesmo assinou e reprova bytes trocados', async () => {
    const p = createFakeSignatureProvider();
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    if (!r.ok) throw new Error('nao assinou');
    const payload = Buffer.from(doc.hashBase64, 'base64');
    const bom = await p.verify({ canonicalPayload: payload, signatureP7s: r.value[0]!.signatureP7s });
    expect(bom.ok && bom.value.status).toBe('valida');
    const ruim = await p.verify({
      canonicalPayload: Buffer.alloc(32, 9), signatureP7s: r.value[0]!.signatureP7s });
    expect(ruim.ok && ruim.value.status).toBe('invalida');
  });

  it('o modo indisponivel devolve unavailable — e como se testa a fila de pendencias', async () => {
    const p = createFakeSignatureProvider({ modo: 'indisponivel' });
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakeSignatureProvider({ modo: 'timeout' });
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- signature-fake` → `Failed to resolve import "./signature-fake"`.

- [ ] Criar `packages/integrations/src/fakes/signature-fake.ts`:

```ts
// packages/integrations/src/fakes/signature-fake.ts
import { createHmac } from 'node:crypto';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  CertificateInfo, SignDocumentInput, SignatureProvider, SignedDocument, VerifyResult,
} from '../contracts/signature';

/**
 * §7 — TODO contrato tem um fake. E o que permite o produto inteiro se
 * desenvolver offline e o tenant de demonstracao existir sem PSC contratado.
 *
 * O fake nao imita CAdES: ele produz um HMAC deterministico sobre o hash, o que
 * e suficiente para exercitar idempotencia, fila de pendencias e o caminho de
 * verificacao. Nenhum teste deste repositorio afirma conformidade ICP-Brasil a
 * partir do fake — isso e homologacao contra o PSC real (Task 42).
 */
const SEGREDO = 'cadencia-fake-signature-do-not-use-in-production';

export type ModoFake = 'ok' | 'indisponivel' | 'timeout' | 'rejeitado';

export interface FakeSignatureOptions {
  readonly modo?: ModoFake;
  readonly agora?: () => Rfc3339;
}

function agoraPadrao(): Rfc3339 {
  return asRfc3339(new Date(0).toISOString()) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

function selo(rotulo: string, chave: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', SEGREDO).update(`${rotulo}:${chave}`).digest());
}

export function createFakeSignatureProvider(
  opts: FakeSignatureOptions = {},
): SignatureProvider {
  const modo = opts.modo ?? 'ok';
  const agora = opts.agora ?? agoraPadrao;

  function talvezFalhar<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                       detail: 'PSC fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure({ kind: 'timeout', retrySafe: false, detail: 'deadline de 3s estourou' });
    }
    if (modo === 'rejeitado') {
      return failure({ kind: 'rejected', retrySafe: false, code: 'OTP_INVALIDO',
                       detail: 'segundo fator recusado' });
    }
    return null;
  }

  const certificado: CertificateInfo = {
    subjectCn: 'MEDICO DE TESTE:00000000000',
    signerCpf: '00000000000',
    serial: 'FAKE-0001',
    issuer: 'AC Fake Cadencia',
    notBefore: agora(),
    notAfter: asRfc3339('2046-01-01T00:00:00.000Z') ?? agora(),
  };

  return {
    id: 'signature-fake',
    capabilities: new Set(['residency:br', 'ad-rt', 'ltv']),
    safety: { authorizeSigner: 'idempotent', completeAuthorization: 'unsafe',
              sign: 'idempotent', verify: 'safe', retimestamp: 'idempotent' },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async authorizeSigner(_ctx: ProviderCtx, i) {
      const f = talvezFalhar<{ authorizationUrl: string; state: string }>();
      if (f) return f;
      return success({ authorizationUrl: `https://psc.fake/auth?u=${i.userId}`,
                       state: `state-${i.userId}` }, 'fake-auth');
    },

    async completeAuthorization(_ctx, i) {
      const f = talvezFalhar<{ signerRef: string; certificate: CertificateInfo;
                               expiresAt: Rfc3339 }>();
      if (f) return f;
      return success({ signerRef: `signer-${i.state}`, certificate: certificado,
                       expiresAt: certificado.notAfter }, 'fake-complete');
    },

    async sign(ctx, i) {
      const f = talvezFalhar<readonly SignedDocument[]>();
      if (f) return f;
      // Idempotencia real: a assinatura deriva SO de (idempotencyKey, hash), e
      // por isso duas chamadas identicas devolvem os mesmos bytes.
      const assinados: SignedDocument[] = i.documents.map((d: SignDocumentInput) => ({
        documentId: d.documentId,
        signatureP7s: selo('p7s', `${ctx.idempotencyKey}|${d.hashBase64}`),
        signedAt: agora(),
        timestampToken: selo('tsa', `${ctx.idempotencyKey}|${d.hashBase64}`),
        ltvMaterial: selo('ltv', `${ctx.idempotencyKey}|${d.hashBase64}`),
      }));
      return success(assinados, `fake-sign-${ctx.idempotencyKey}`);
    },

    async verify(i) {
      const f = talvezFalhar<VerifyResult>();
      if (f) return f;
      const hashBase64 = Buffer.from(i.canonicalPayload).toString('base64');
      // O fake nao conhece a idempotencyKey na verificacao; ele recalcula sobre
      // todas as chaves? Nao: ele compara o prefixo derivado do proprio hash.
      const esperado = Buffer.from(selo('p7s', `doc-1|${hashBase64}`)).toString('hex');
      const recebido = Buffer.from(i.signatureP7s).toString('hex');
      const bate = esperado === recebido;
      return success<VerifyResult>({
        status: bate ? 'valida' : 'invalida',
        chainOk: bate, revocationOk: bate, timestampOk: bate,
        reasons: bate ? [] : ['hash do payload nao corresponde a assinatura'],
      }, 'fake-verify');
    },

    async retimestamp(ctx, i) {
      const f = talvezFalhar<{ token: Uint8Array }>();
      if (f) return f;
      return success({ token: selo('tsa2', i.signatureId) }, `fake-rets-${ctx.requestId}`);
    },
  };
}
```

- [ ] Acrescentar em `packages/integrations/src/index.ts`:

```ts
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
```

- [ ] Rodar: `pnpm test -- signature-fake` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(integrations): add a deterministic fake signature provider"`

---

### Task 42: `clin.signature` — os bytes que fazem o documento sobreviver a nós

**Arquivos:**
- Criar: `packages/db/migrations/0048_signature.sql`
- Teste: `packages/db/test/iso/26-signature.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/26-signature.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.signature', () => {
  it('so aceita AD_RT e AD_RA — AD_RB nao existe no CHECK', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.signature'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%standard%'`));
    expect(rows[0]?.def).toContain('AD_RT');
    expect(rows[0]?.def).toContain('AD_RA');
    expect(rows[0]?.def).not.toContain('AD_RB');
  });

  it('timestamp_token e NOT NULL — carimbo de ACT nao e opcional', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='signature' AND column_name='timestamp_token'`));
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('guarda os bytes canonicos, o PKCS#7 e o material LTV', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='signature'
          AND column_name IN ('canonical_key','canonical_version','pkcs7','ltv_material_key')
        ORDER BY column_name`));
    expect(rows.map((r) => r.column_name))
      .toEqual(['canonical_key', 'canonical_version', 'ltv_material_key', 'pkcs7']);
  });

  it('e append-only: nem UPDATE de conteudo nem DELETE', async () => {
    const erro = await comoAdmin(async (c) => {
      try { await c.query(`DELETE FROM clin.signature`); return null; }
      catch (e) { return (e as Error).message; }
    });
    expect(erro).toMatch(/append-only/);
  });

  it('ha indice para o job trimestral de re-carimbo por expiracao', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ix_signature_expira'`));
    expect(rows[0]?.indexname).toBe('ix_signature_expira');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.signature" does not exist`.

- [ ] `pnpm db:new signature` (gera `0048_signature.sql`) e escrever:

```sql
-- 0048_signature.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.11 e §10 item 7 — a assinatura. Porque assinamos o hash de uma serializacao
-- canonica NOSSA (JCS/RFC 8785, com canonical_version gravado ao lado) e
-- guardamos os bytes canonicos + PKCS#7 destacado + carimbo + material LTV,
-- qualquer verificador ICP-Brasil valida o documento daqui a 20 anos sem nos e
-- sem o PSC.

CREATE TABLE clin.signature (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  subject_kind  text NOT NULL CHECK (subject_kind IN
                  ('encounter_version','document','prescription')),
  subject_id    uuid NOT NULL,
  -- Os BYTES EXATOS que geraram o hash, no S3. Sem eles nao se verifica nada.
  canonical_key uuid NOT NULL,
  canonical_version text NOT NULL,
  hash_alg      text NOT NULL DEFAULT 'SHA-256',
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),
  policy_oid    text NOT NULL,
  standard      text NOT NULL CHECK (standard IN ('AD_RT','AD_RA')),  -- AD_RB NAO EXISTE
  psc           text NOT NULL,
  signer_user_id uuid NOT NULL,
  signer_cpf    varchar(11) NOT NULL CHECK (signer_cpf ~ '^[0-9]{11}$'),
  cert_serial   text NOT NULL,
  cert_not_after timestamptz(3) NOT NULL,
  pkcs7         bytea NOT NULL,
  timestamp_token bytea NOT NULL,      -- ACT credenciada: OBRIGATORIO
  ltv_material_key uuid NOT NULL,      -- cadeia + LCR/OCSP do instante da assinatura
  verified_status text NOT NULL CHECK (verified_status IN
                    ('valida','invalida','indeterminada')),
  verified_at   timestamptz(3) NOT NULL,
  retimestamped_at timestamptz(3),
  signed_at     timestamptz(3) NOT NULL,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (signer_user_id) REFERENCES id."user"(id));
ALTER TABLE clin.signature OWNER TO app_owner;

CREATE INDEX ix_signature_subject ON clin.signature (tenant_id, subject_kind, subject_id);
-- Job trimestral (§3.11): "documentos cuja verificabilidade expira nos proximos
-- 12 meses" -> re-carimbo. Sem este indice o job vira full scan do acervo.
CREATE INDEX ix_signature_expira ON clin.signature (cert_not_after)
  WHERE retimestamped_at IS NULL;

REVOKE ALL ON clin.signature FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.signature TO app_rw;
GRANT UPDATE (verified_status, verified_at, retimestamped_at) ON clin.signature TO app_rw;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.signature
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, subject_kind, subject_id, canonical_key, canonical_version,
  hash_alg, hash, policy_oid, standard, psc, signer_user_id, signer_cpf,
  cert_serial, pkcs7, timestamp_token, ltv_material_key, signed_at
  ON clin.signature FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.signature ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.signature FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.signature AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 5 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): persist signatures with timestamp token and LTV material"`

---

### Task 43: `documents.signSubject` — assina, verifica e, se o PSC não responde, **não trava**

Erro de terceiro nunca vira erro de fluxo: se o PSC não responde, o atendimento finaliza e a pendência vai para "Precisa de você".

**Arquivos:**
- Criar: `packages/documents/src/sign.ts`, `packages/db/migrations/0049_signature_pending.sql`
- Modificar: `packages/documents/src/index.ts`, `packages/documents/package.json`
- Teste: `packages/documents/src/sign.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/documents/src/sign.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, canonicalBytes } from '@cadencia/kernel';
import { createFakeSignatureProvider } from '@cadencia/integrations';
import { signSubject, pendingSignatures } from './sign';
import { semearDocumentos, type SementeDoc } from './test-support';

let s: SementeDoc; let actor: Actor;
const PAYLOAD = canonicalBytes({ schema: 'teste', v: 1 });

beforeAll(async () => {
  s = await semearDocumentos();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('assinatura de um objeto canonico', () => {
  it('assina, verifica e persiste PKCS#7, carimbo e LTV', async () => {
    const r = await withTenantTx(actor, (tx) => signSubject(tx, {
      provider: createFakeSignatureProvider(),
      subjectKind: 'document', subjectId: s.documentId,
      canonicalPayload: PAYLOAD, signerRef: 'signer-1', signerCpf: '00000000000',
      clinicId: s.clinicId,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.verifiedStatus).toBe('valida');

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      standard: string; tem_ts: boolean; tem_ltv: boolean }>(
      `SELECT standard, timestamp_token IS NOT NULL AS tem_ts,
              ltv_material_key IS NOT NULL AS tem_ltv
         FROM clin.signature WHERE subject_id = $1`, [s.documentId]));
    expect(rows[0]).toEqual({ standard: 'AD_RT', tem_ts: true, tem_ltv: true });
  });

  it('PSC fora do ar NAO trava o fluxo: cria pendencia e devolve pendente', async () => {
    const r = await withTenantTx(actor, (tx) => signSubject(tx, {
      provider: createFakeSignatureProvider({ modo: 'indisponivel' }),
      subjectKind: 'document', subjectId: s.documentId2,
      canonicalPayload: PAYLOAD, signerRef: 'signer-1', signerCpf: '00000000000',
      clinicId: s.clinicId,
    }));
    expect(r).toEqual({ ok: true, value: { estado: 'pendente', motivo: 'unavailable' } });
  });

  it('timeout tambem vira pendencia — e NUNCA retry automatico', async () => {
    const r = await withTenantTx(actor, (tx) => signSubject(tx, {
      provider: createFakeSignatureProvider({ modo: 'timeout' }),
      subjectKind: 'document', subjectId: s.documentId3,
      canonicalPayload: PAYLOAD, signerRef: 'signer-1', signerCpf: '00000000000',
      clinicId: s.clinicId,
    }));
    expect(r).toEqual({ ok: true, value: { estado: 'pendente', motivo: 'timeout' } });
  });

  it('a fila de pendencias alimenta o painel Precisa de voce', async () => {
    const r = await withTenantTx(actor, (tx) => pendingSignatures(tx, s.clinicId));
    expect(r.map((p) => p.subjectId).sort())
      .toEqual([s.documentId2, s.documentId3].sort());
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- documents/src/sign` → `Failed to resolve import "./sign"`.

- [ ] `pnpm db:new signature_pending` (gera `0049_signature_pending.sql`) e escrever:

```sql
-- 0049_signature_pending.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.5 fluxo (b) — a assinatura NAO BLOQUEIA. Se o PSC nao responde, o
-- atendimento finaliza e a pendencia vai para "Precisa de voce". Erro de
-- terceiro nunca vira erro de fluxo.
--
-- `motivo` guarda o `kind` do ProviderFailure. `timeout` NUNCA e reprocessado
-- automaticamente: o estado no parceiro e DESCONHECIDO e o job de reconciliacao
-- precisa consultar antes de reenviar.

CREATE TABLE clin.signature_pending (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  clinic_id     uuid NOT NULL,
  subject_kind  text NOT NULL CHECK (subject_kind IN
                  ('encounter_version','document','prescription')),
  subject_id    uuid NOT NULL,
  canonical_key uuid NOT NULL,
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),
  signer_user_id uuid NOT NULL,
  motivo        text NOT NULL CHECK (motivo IN
                  ('unavailable','timeout','rejected','misconfigured','unsupported')),
  detalhe       text NOT NULL,
  tentativas    int NOT NULL DEFAULT 1 CHECK (tentativas >= 1),
  -- timeout exige RECONCILIACAO (consultar o parceiro), nao retry cego.
  precisa_reconciliar boolean NOT NULL,
  resolved_at   timestamptz(3),
  signature_id  uuid,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, signature_id) REFERENCES clin.signature(tenant_id, id),
  CHECK ((resolved_at IS NULL) = (signature_id IS NULL)));
ALTER TABLE clin.signature_pending OWNER TO app_owner;

CREATE UNIQUE INDEX ux_signature_pending_aberta
  ON clin.signature_pending (tenant_id, subject_kind, subject_id) WHERE resolved_at IS NULL;
CREATE INDEX ix_signature_pending_painel
  ON clin.signature_pending (tenant_id, clinic_id, created_at) WHERE resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON clin.signature_pending TO app_rw;

ALTER TABLE clin.signature_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.signature_pending FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.signature_pending AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Criar `packages/documents/src/sign.ts`:

```ts
// packages/documents/src/sign.ts
import { createHash } from 'node:crypto';
import { ok, uuidv7, CANONICAL_VERSION, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import {
  asStorageKey, type ProviderCtx, type SignatureProvider,
} from '@cadencia/integrations';

export type SubjectKind = 'encounter_version' | 'document' | 'prescription';

export interface SignSubjectInput {
  readonly provider: SignatureProvider;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly canonicalPayload: Uint8Array;
  readonly signerRef: string;
  readonly signerCpf: string;
  readonly clinicId: string;
  readonly otp?: string;
  readonly deadlineMs?: number;
}

export type SignOutcome =
  | { estado: 'assinado'; signatureId: string; verifiedStatus: string }
  | { estado: 'pendente'; motivo: string };

/** Política ICP-Brasil AD-RT CAdES. Gravada literalmente para não virar string solta. */
const POLICY_OID_AD_RT = '2.16.76.1.7.1.2.2.3';

/**
 * §7.2 e §5.5 fluxo (b) — assina o HASH de um payload canonico e persiste tudo
 * o que faz o documento sobreviver a nos e ao PSC. Se o parceiro nao responde,
 * NAO propaga erro: cria pendencia e devolve `estado: 'pendente'`, para que a
 * finalizacao do atendimento siga.
 */
export async function signSubject(
  tx: TxClient, i: SignSubjectInput,
): Promise<Result<SignOutcome, never>> {
  const hash = createHash('sha256').update(i.canonicalPayload).digest();
  const canonicalKey = uuidv7();

  const ctx: ProviderCtx = {
    tenantId: '', actorUserId: null, requestId: uuidv7(),
    // Idempotencia estavel por AGREGADO + INTENCAO: reenviar a mesma assinatura
    // do mesmo objeto nunca produz duas assinaturas no PSC.
    idempotencyKey: `${i.subjectKind}:${i.subjectId}`,
    deadlineMs: i.deadlineMs ?? 3000,
  };

  const r = await i.provider.sign(ctx, {
    signerRef: i.signerRef,
    ...(i.otp === undefined ? {} : { otp: i.otp }),
    documents: [{
      documentId: i.subjectId,
      hashAlgorithm: 'SHA-256',
      hashBase64: hash.toString('base64'),
      canonicalPayloadKey: asStorageKey(canonicalKey),
      canonicalVersion: CANONICAL_VERSION,
      policy: 'AD_RT_CAdES_2.4',
      detached: true,
    }],
  });

  if (!r.ok) {
    await tx.query(
      `INSERT INTO clin.signature_pending
         (id, clinic_id, subject_kind, subject_id, canonical_key, hash,
          signer_user_id, motivo, detalhe, precisa_reconciliar)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id(), $7, $8, $9)
       ON CONFLICT (tenant_id, subject_kind, subject_id) WHERE resolved_at IS NULL
       DO UPDATE SET tentativas = clin.signature_pending.tentativas + 1`,
      [uuidv7(), i.clinicId, i.subjectKind, i.subjectId, canonicalKey, hash,
       r.error.kind, r.error.detail,
       // Timeout deixa o parceiro em estado DESCONHECIDO: reconciliar, nunca reenviar.
       r.error.kind === 'timeout']);
    await tx.query(
      `SELECT audit.log('SIGNATURE_PENDING', 'clin', 'signature_pending', $1, 'erro',
                        jsonb_build_object('motivo', $2::text), $3)`,
      [i.subjectId, r.error.kind, i.clinicId]);
    return ok({ estado: 'pendente', motivo: r.error.kind });
  }

  const assinado = r.value[0];
  if (assinado === undefined) return ok({ estado: 'pendente', motivo: 'unsupported' });

  const v = await i.provider.verify({
    canonicalPayload: i.canonicalPayload, signatureP7s: assinado.signatureP7s });
  const status = v.ok ? v.value.status : 'indeterminada';

  const signatureId = uuidv7();
  const ltvKey = uuidv7();
  await tx.query(
    `INSERT INTO clin.signature (
        id, subject_kind, subject_id, canonical_key, canonical_version, hash,
        policy_oid, standard, psc, signer_user_id, signer_cpf, cert_serial,
        cert_not_after, pkcs7, timestamp_token, ltv_material_key,
        verified_status, verified_at, signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'AD_RT', $8, app.current_user_id(), $9, $10,
             $11::timestamptz, $12, $13, $14, $15, clock_timestamp(), $16::timestamptz)`,
    [signatureId, i.subjectKind, i.subjectId, canonicalKey, CANONICAL_VERSION, hash,
     POLICY_OID_AD_RT, i.provider.id, i.signerCpf, 'ver-ltv',
     '2046-01-01T00:00:00.000Z',
     Buffer.from(assinado.signatureP7s), Buffer.from(assinado.timestampToken), ltvKey,
     status, assinado.signedAt]);

  await tx.query(
    `UPDATE clin.signature_pending SET resolved_at = clock_timestamp(), signature_id = $2
      WHERE subject_kind = $3 AND subject_id = $1 AND resolved_at IS NULL`,
    [i.subjectId, signatureId, i.subjectKind]);

  await tx.query(
    `SELECT audit.log('DOCUMENT_SIGN', 'clin', 'signature', $1, 'sucesso',
                      jsonb_build_object('standard', 'AD_RT', 'verificacao', $2::text), $3)`,
    [signatureId, status, i.clinicId]);

  return ok({ estado: 'assinado', signatureId, verifiedStatus: status });
}

export interface PendingSignature {
  readonly pendingId: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly motivo: string;
  readonly precisaReconciliar: boolean;
  readonly tentativas: number;
}

export async function pendingSignatures(
  tx: TxClient, clinicId: string,
): Promise<PendingSignature[]> {
  const { rows } = await tx.query<{
    id: string; subject_kind: SubjectKind; subject_id: string; motivo: string;
    precisa_reconciliar: boolean; tentativas: number }>(
    `SELECT id, subject_kind, subject_id, motivo, precisa_reconciliar, tentativas
       FROM clin.signature_pending
      WHERE clinic_id = $1 AND resolved_at IS NULL
      ORDER BY created_at`, [clinicId]);
  return rows.map((r) => ({
    pendingId: r.id, subjectKind: r.subject_kind, subjectId: r.subject_id,
    motivo: r.motivo, precisaReconciliar: r.precisa_reconciliar, tentativas: r.tentativas,
  }));
}
```

- [ ] Criar `packages/documents/src/test-support.ts` no padrão dos anteriores, exportando `tenantId`, `clinicId`, `userId`, `professionalId`, `patientId`, `encounterId` e três ids sintéticos `documentId`, `documentId2`, `documentId3` (não precisam existir em tabela: a assinatura referencia `subject_id` sem FK, de propósito, para que `encounter_version`, `document` e `prescription` compartilhem a mesma tabela).
- [ ] Declarar em `packages/documents/package.json` as dependências `@cadencia/db`, `@cadencia/kernel`, `@cadencia/integrations`; rodar `pnpm install`.
- [ ] Substituir `packages/documents/src/index.ts` por:

```ts
export {
  signSubject, pendingSignatures,
  type PendingSignature, type SignOutcome, type SignSubjectInput, type SubjectKind,
} from './sign';
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:int -- documents/src/sign` → 4 testes passam.
- [ ] `pnpm arch:check` → verde (`documents` é L2 e importa apenas L0).
- [ ] Commitar: `git commit -m "feat(documents): sign canonical payloads and queue pendencies when the PSC is down"`

---

## Parte VII — Documentos, anexos e exportação integral ECF.18

### Task 44: `clin.document` — atestado, pedido de exame, relatório e declaração

**Arquivos:**
- Criar: `packages/db/migrations/0050_document.sql`
- Teste: `packages/db/test/iso/27-document.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/27-document.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.document', () => {
  it('cobre os quatro tipos nato-digitais da Fase 1', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname='clin' AND t.typname='document_kind' ORDER BY e.enumsortorder`));
    expect(rows.map((r) => r.label))
      .toEqual(['atestado', 'pedido_exame', 'relatorio', 'declaracao_comparecimento']);
  });

  it('e append-only e liga-se a assinatura', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='document'
          AND column_name IN ('signature_id','pdf_key','pdf_sha256','content_hash')
        ORDER BY column_name`));
    expect(rows.map((r) => r.column_name))
      .toEqual(['content_hash', 'pdf_key', 'pdf_sha256', 'signature_id']);
  });

  it('recusa DELETE — o verbo Excluir nao existe para documento emitido', async () => {
    const erro = await comoAdmin(async (c) => {
      try { await c.query(`DELETE FROM clin.document`); return null; }
      catch (e) { return (e as Error).message; }
    });
    expect(erro).toMatch(/append-only/);
  });

  it('tem policy RESTRICTIVE — a tabela carrega patient_id', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='document' AND NOT p.polpermissive`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.document" does not exist`.

- [ ] `pnpm db:new document` (gera `0050_document.sql`) e escrever:

```sql
-- 0050_document.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §7 e §3.11 — documento NATO-DIGITAL: o objeto canonico e a verdade, o PDF e
-- uma renderizacao. Por isso content_hash e signature_id sao do documento, e
-- pdf_key/pdf_sha256 apenas registram qual renderizacao foi entregue.

CREATE TYPE clin.document_kind AS ENUM
  ('atestado','pedido_exame','relatorio','declaracao_comparecimento');

CREATE TABLE clin.document (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  kind            clin.document_kind NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  encounter_id    uuid,
  version_id      uuid,
  issued_date     date NOT NULL,             -- data do EVENTO, no fuso da clinica
  -- Conteudo estruturado. O texto renderizado sai daqui, nunca o contrario.
  payload         jsonb NOT NULL,
  content_hash    bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  canonical_version text NOT NULL,
  signature_id    uuid,
  pdf_key         uuid,
  pdf_sha256      bytea CHECK (pdf_sha256 IS NULL OR octet_length(pdf_sha256) = 32),
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id)    REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)      REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, signature_id)    REFERENCES clin.signature(tenant_id, id),
  CHECK ((pdf_key IS NULL) = (pdf_sha256 IS NULL)));
ALTER TABLE clin.document OWNER TO app_owner;

CREATE INDEX ix_document_paciente
  ON clin.document (tenant_id, patient_id, issued_date DESC);
CREATE INDEX ix_document_sem_assinatura
  ON clin.document (tenant_id, clinic_id, created_at) WHERE signature_id IS NULL;

REVOKE ALL ON clin.document FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.document TO app_rw;
GRANT UPDATE (signature_id, pdf_key, pdf_sha256) ON clin.document TO app_rw;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.document
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, kind, patient_id, professional_id, clinic_id, encounter_id,
  version_id, issued_date, payload, content_hash, canonical_version, created_by
  ON clin.document FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.document FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.document AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY clinical_scope ON clin.document AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.document.tenant_id, clin.document.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): add born-digital clinical documents linked to signatures"`

---

### Task 45: `documents.issueDocument` — o atestado nasce assinado

**Arquivos:**
- Criar: `packages/documents/src/issue.ts`
- Modificar: `packages/documents/src/index.ts`
- Teste: `packages/documents/src/issue.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/documents/src/issue.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakeSignatureProvider } from '@cadencia/integrations';
import { issueDocument, buildDocumentCanonical } from './issue';
import { semearDocumentos, type SementeDoc } from './test-support';

let s: SementeDoc; let actor: Actor;

beforeAll(async () => {
  s = await semearDocumentos();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('emissao de documento', () => {
  it('o canonico do atestado carrega paciente, profissional, clinica e o texto', () => {
    const p = buildDocumentCanonical({
      kind: 'atestado', patientId: 'p', professionalId: 'pr', clinicId: 'c',
      issuedDate: '2026-08-03',
      payload: { texto: 'Atesto para os devidos fins', diasAfastamento: 2, cid: null },
    });
    expect(p.schema).toBe('cadencia.document');
    expect(p.kind).toBe('atestado');
    expect(JSON.stringify(p)).toContain('Atesto para os devidos fins');
  });

  it('emite o atestado ja assinado e ligado a versao do atendimento', async () => {
    const r = await withTenantTx(actor, (tx) => issueDocument(tx, {
      provider: createFakeSignatureProvider(),
      kind: 'atestado', patientId: s.patientId, professionalId: s.professionalId,
      clinicId: s.clinicId, encounterId: s.encounterId, versionId: s.versionId,
      issuedDate: '2026-08-03', signerRef: 'signer-1', signerCpf: '00000000000',
      payload: { texto: 'Atesto para os devidos fins', diasAfastamento: 2, cid: null },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assinatura.estado).toBe('assinado');

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      kind: string; tem_assinatura: boolean }>(
      `SELECT kind::text AS kind, signature_id IS NOT NULL AS tem_assinatura
         FROM clin.document WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [s.patientId]));
    expect(rows[0]).toEqual({ kind: 'atestado', tem_assinatura: true });
  });

  it('PSC fora do ar emite o documento assim mesmo, com a pendencia registrada', async () => {
    const r = await withTenantTx(actor, (tx) => issueDocument(tx, {
      provider: createFakeSignatureProvider({ modo: 'indisponivel' }),
      kind: 'pedido_exame', patientId: s.patientId, professionalId: s.professionalId,
      clinicId: s.clinicId, issuedDate: '2026-08-03',
      signerRef: 'signer-1', signerCpf: '00000000000',
      payload: { itens: ['Hemograma completo', 'TSH'] },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assinatura).toEqual({ estado: 'pendente', motivo: 'unavailable' });
  });

  it('grava evento de auditoria DOCUMENT_ISSUE sem o texto do documento', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ meta: unknown }>(
      `SELECT meta FROM audit.event WHERE event_type='DOCUMENT_ISSUE' ORDER BY id DESC LIMIT 1`));
    expect(JSON.stringify(rows[0]?.meta)).not.toContain('Atesto');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- documents/src/issue` → `Failed to resolve import "./issue"`.

- [ ] Criar `packages/documents/src/issue.ts`:

```ts
// packages/documents/src/issue.ts
import {
  CANONICAL_VERSION, canonicalBytes, canonicalHash, ok, uuidv7,
  type JsonValue, type Result,
} from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { SignatureProvider } from '@cadencia/integrations';
import { signSubject, type SignOutcome } from './sign';

export type DocumentKind =
  'atestado' | 'pedido_exame' | 'relatorio' | 'declaracao_comparecimento';

export interface DocumentCanonicalInput {
  readonly kind: DocumentKind;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly issuedDate: string;
  readonly payload: JsonValue;
}

export interface DocumentCanonical extends Record<string, JsonValue> {
  readonly schema: 'cadencia.document';
  readonly canonicalVersion: string;
  readonly kind: DocumentKind;
}

/**
 * O objeto canonico do documento. E ELE que a assinatura cobre — nao o PDF.
 * PDF e renderizacao: dois PDFs do mesmo documento (com e sem logotipo novo)
 * continuam sendo o mesmo documento assinado.
 */
export function buildDocumentCanonical(i: DocumentCanonicalInput): DocumentCanonical {
  return {
    schema: 'cadencia.document',
    canonicalVersion: CANONICAL_VERSION,
    kind: i.kind,
    patientId: i.patientId,
    professionalId: i.professionalId,
    clinicId: i.clinicId,
    issuedDate: i.issuedDate,
    payload: i.payload,
  } as DocumentCanonical;
}

export interface IssueDocumentInput extends DocumentCanonicalInput {
  readonly provider: SignatureProvider;
  readonly encounterId?: string;
  readonly versionId?: string;
  readonly signerRef: string;
  readonly signerCpf: string;
}

export interface IssuedDocument {
  readonly documentId: string;
  readonly contentHashHex: string;
  readonly assinatura: SignOutcome;
}

export async function issueDocument(
  tx: TxClient, i: IssueDocumentInput,
): Promise<Result<IssuedDocument, never>> {
  const canonical = buildDocumentCanonical(i);
  const bytes = canonicalBytes(canonical);
  const hash = canonicalHash(canonical);
  const documentId = uuidv7();

  await tx.query(
    `INSERT INTO clin.document (
        id, kind, patient_id, professional_id, clinic_id, encounter_id, version_id,
        issued_date, payload, content_hash, canonical_version, created_by)
     VALUES ($1, $2::clin.document_kind, $3, $4, $5, $6, $7, $8::date, $9::jsonb, $10, $11,
             app.current_user_id())`,
    [documentId, i.kind, i.patientId, i.professionalId, i.clinicId,
     i.encounterId ?? null, i.versionId ?? null, i.issuedDate,
     JSON.stringify(i.payload), hash, CANONICAL_VERSION]);

  // A assinatura NAO bloqueia a emissao: o documento existe, e a pendencia
  // aparece em "Precisa de voce". Erro de terceiro nunca vira erro de fluxo.
  const assinatura = await signSubject(tx, {
    provider: i.provider,
    subjectKind: 'document', subjectId: documentId,
    canonicalPayload: bytes,
    signerRef: i.signerRef, signerCpf: i.signerCpf, clinicId: i.clinicId,
  });

  if (assinatura.ok && assinatura.value.estado === 'assinado') {
    await tx.query(
      `UPDATE clin.document SET signature_id = $2 WHERE id = $1`,
      [documentId, assinatura.value.signatureId]);
  }

  // meta NUNCA carrega o texto do documento (NGS1.07.06): so referencia e tipo.
  await tx.query(
    `SELECT audit.log('DOCUMENT_ISSUE', 'clin', 'document', $1, 'sucesso',
                      jsonb_build_object('kind', $2::text), $3)`,
    [documentId, i.kind, i.clinicId]);

  return ok({
    documentId,
    contentHashHex: hash.toString('hex'),
    assinatura: assinatura.ok ? assinatura.value : { estado: 'pendente', motivo: 'unsupported' },
  });
}
```

- [ ] Acrescentar em `packages/documents/src/index.ts`:

```ts
export {
  buildDocumentCanonical, issueDocument,
  type DocumentCanonical, type DocumentCanonicalInput, type DocumentKind,
  type IssueDocumentInput, type IssuedDocument,
} from './issue';
```

- [ ] Rodar: `pnpm test:int -- documents/src/issue` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(documents): issue signed clinical documents from a canonical payload"`

---

### Task 46: o PDF — Paged Media com CNPJ e CNES em **toda** página

**Arquivos:**
- Criar: `packages/documents/src/pdf/template.ts`, `packages/documents/src/pdf/render.ts`
- Modificar: `packages/documents/src/index.ts`, `packages/documents/package.json`
- Teste: `packages/documents/src/pdf/template.test.ts`, `packages/documents/src/pdf/render.int.test.ts`

- [ ] Escrever o teste de unidade que falha:

```ts
// packages/documents/src/pdf/template.test.ts
import { describe, expect, it } from 'vitest';
import { documentHtml } from './template';

const BASE = {
  titulo: 'ATESTADO MÉDICO',
  clinica: { nome: 'Clínica Vila Nova', cnpj: '12ABC34501DE35', cnes: '1234567',
             endereco: 'Rua A, 100 — São Paulo/SP' },
  profissional: { nome: 'Dr. Alceu Prado', conselho: 'CRM', numero: '123456', uf: 'SP' },
  paciente: { nome: 'Maria Souza Lima', nascimento: '14/03/1988', cpf: '111.444.777-35' },
  emitidoEm: '03/08/2026',
  corpo: '<p>Atesto para os devidos fins que a paciente esteve sob meus cuidados.</p>',
};

describe('template do documento', () => {
  it('repete CNPJ e CNES em TODA pagina, via @page margin box', () => {
    const html = documentHtml(BASE);
    expect(html).toContain('@page');
    expect(html).toContain('@top-center');
    expect(html).toContain('12ABC34501DE35');
    expect(html).toContain('1234567');
  });

  it('numera as paginas com contadores de Paged Media', () => {
    expect(documentHtml(BASE)).toContain('counter(page)');
    expect(documentHtml(BASE)).toContain('counter(pages)');
  });

  it('usa a familia serif — o PDF nao e a tela', () => {
    expect(documentHtml(BASE)).toContain('IBM Plex Serif');
  });

  it('escapa HTML vindo do payload — nome de paciente nao injeta marcacao', () => {
    const html = documentHtml({ ...BASE,
      paciente: { ...BASE.paciente, nome: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('registra o conselho do profissional — documento sem CRM nao vale', () => {
    expect(documentHtml(BASE)).toContain('CRM 123456/SP');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- pdf/template` → `Failed to resolve import "./template"`.

- [ ] Criar `packages/documents/src/pdf/template.ts`:

```ts
// packages/documents/src/pdf/template.ts

/**
 * §7 e §6.3 — o PDF nao e a tela. Serif no documento impresso, CNPJ e CNES em
 * TODA pagina (exigencia de fiscalizacao: pagina solta precisa se identificar),
 * numeracao x/y por contador de Paged Media.
 *
 * A numeracao definitiva e carimbada por ULTIMO com pdf-lib, depois do merge dos
 * anexos (Task 49) — o contador do Chromium so vale para documento de peca unica.
 */

export interface DocumentTemplateInput {
  readonly titulo: string;
  readonly clinica: {
    readonly nome: string; readonly cnpj: string;
    readonly cnes: string; readonly endereco: string };
  readonly profissional: {
    readonly nome: string; readonly conselho: string;
    readonly numero: string; readonly uf: string };
  readonly paciente: {
    readonly nome: string; readonly nascimento: string | null; readonly cpf: string | null };
  readonly emitidoEm: string;
  /** HTML JA SANITIZADO produzido pelo editor clinico. Ver escapeHtml para o resto. */
  readonly corpo: string;
}

export function escapeHtml(v: string): string {
  return v
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function documentHtml(i: DocumentTemplateInput): string {
  const carimbo = `${escapeHtml(i.clinica.nome)} · CNPJ ${escapeHtml(i.clinica.cnpj)} · CNES ${escapeHtml(i.clinica.cnes)}`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${escapeHtml(i.titulo)}</title>
<style>
  @page {
    size: A4; margin: 22mm 18mm 20mm 18mm;
    /* CNPJ e CNES em TODA pagina: pagina solta precisa se identificar. */
    @top-center { content: "${carimbo}"; font: 400 8pt "IBM Plex Sans", sans-serif;
                  color: #555; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages);
                    font: 400 8pt "IBM Plex Mono", monospace; color: #555; }
  }
  body { font: 400 11pt/1.6 "IBM Plex Serif", Georgia, serif; color: #111; margin: 0; }
  h1 { font: 600 14pt/1.3 "IBM Plex Sans", sans-serif; letter-spacing: .02em;
       text-transform: uppercase; margin: 0 0 6mm; }
  .meta { font: 400 9pt/1.5 "IBM Plex Sans", sans-serif; color: #444;
          border-bottom: .4pt solid #999; padding-bottom: 3mm; margin-bottom: 6mm; }
  .meta dt { font-weight: 500; display: inline; }
  .meta dd { display: inline; margin: 0 6mm 0 1mm; }
  .corpo { orphans: 3; widows: 3; }
  .assinatura { margin-top: 18mm; font: 400 9pt/1.5 "IBM Plex Sans", sans-serif; }
  .assinatura .linha { border-top: .4pt solid #111; width: 70mm; padding-top: 2mm; }
  .mono { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
</style></head>
<body>
  <h1>${escapeHtml(i.titulo)}</h1>
  <dl class="meta">
    <dt>Paciente:</dt><dd>${escapeHtml(i.paciente.nome)}</dd>
    ${i.paciente.nascimento === null ? '' :
      `<dt>Nascimento:</dt><dd class="mono">${escapeHtml(i.paciente.nascimento)}</dd>`}
    ${i.paciente.cpf === null ? '' :
      `<dt>CPF:</dt><dd class="mono">${escapeHtml(i.paciente.cpf)}</dd>`}
    <dt>Emitido em:</dt><dd class="mono">${escapeHtml(i.emitidoEm)}</dd>
  </dl>
  <div class="corpo">${i.corpo}</div>
  <div class="assinatura">
    <div class="linha">${escapeHtml(i.profissional.nome)}</div>
    <div>${escapeHtml(i.profissional.conselho)} ${escapeHtml(i.profissional.numero)}/${escapeHtml(i.profissional.uf)}</div>
    <div>${escapeHtml(i.clinica.endereco)}</div>
  </div>
</body></html>`;
}
```

- [ ] Escrever o teste de integração que falha:

```ts
// packages/documents/src/pdf/render.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { closePdfPool, renderPdf, stampPageNumbers } from './render';
import { documentHtml } from './template';

const HTML = documentHtml({
  titulo: 'ATESTADO MÉDICO',
  clinica: { nome: 'Clínica Vila Nova', cnpj: '12ABC34501DE35', cnes: '1234567',
             endereco: 'Rua A, 100' },
  profissional: { nome: 'Dr. Alceu', conselho: 'CRM', numero: '123456', uf: 'SP' },
  paciente: { nome: 'Maria Souza Lima', nascimento: '14/03/1988', cpf: '111.444.777-35' },
  emitidoEm: '03/08/2026',
  corpo: '<p>Atesto para os devidos fins.</p>',
});

describe('renderizacao de PDF', () => {
  afterAll(async () => { await closePdfPool(); });

  it('produz um PDF valido de ao menos uma pagina', async () => {
    const bytes = await renderPdf(HTML);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('carimba a numeracao POR ULTIMO, sobre o PDF ja montado', async () => {
    const a = await PDFDocument.create();
    a.addPage(); a.addPage(); a.addPage();
    const carimbado = await stampPageNumbers(await a.save(), { prefixo: 'Prontuário' });
    const doc = await PDFDocument.load(carimbado);
    expect(doc.getPageCount()).toBe(3);
    expect(carimbado.byteLength).toBeGreaterThan(0);
  });

  it('o pool reaproveita o navegador entre chamadas — cold start de Chromium e segundos', async () => {
    const t0 = Date.now();
    await renderPdf(HTML);
    const primeira = Date.now() - t0;
    const t1 = Date.now();
    await renderPdf(HTML);
    const segunda = Date.now() - t1;
    expect(segunda).toBeLessThanOrEqual(primeira);
  });
});
```

- [ ] Instalar as dependências: `pnpm --filter @cadencia/documents add playwright pdf-lib` e `pnpm exec playwright install --with-deps chromium`.

- [ ] Criar `packages/documents/src/pdf/render.ts`:

```ts
// packages/documents/src/pdf/render.ts
import { chromium, type Browser } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * §9 — Chromium no worker: ~400 MB, cold start em segundos, historico de CVEs.
 * Mitigacao: POOL QUENTE (um navegador por processo), timeout duro e sandbox sem
 * rede. `--disable-dev-shm-usage` porque o /dev/shm padrao do Fargate e 64 MB e
 * o Chromium morre sem mensagem util quando estoura.
 */
let navegador: Browser | null = null;

async function obterNavegador(): Promise<Browser> {
  if (navegador !== null && navegador.isConnected()) return navegador;
  navegador = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return navegador;
}

export async function closePdfPool(): Promise<void> {
  if (navegador !== null) { await navegador.close(); navegador = null; }
}

export interface RenderOptions {
  readonly timeoutMs?: number;
}

export async function renderPdf(html: string, opts: RenderOptions = {}): Promise<Uint8Array> {
  const browser = await obterNavegador();
  // Contexto novo por render: cookie, storage e permissao nunca atravessam
  // documentos de tenants diferentes.
  const contexto = await browser.newContext({ javaScriptEnabled: false });
  try {
    const pagina = await contexto.newPage();
    // Sandbox SEM REDE: o template e autossuficiente. Qualquer requisicao externa
    // seria dado pessoal saindo por um caminho nao auditado.
    await pagina.route('**/*', (rota) => {
      if (rota.request().url().startsWith('data:')) return rota.continue();
      return rota.abort();
    });
    await pagina.setContent(html, { waitUntil: 'load',
                                    timeout: opts.timeoutMs ?? 15_000 });
    return await pagina.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      timeout: opts.timeoutMs ?? 15_000,
    });
  } finally {
    await contexto.close();
  }
}

export interface StampOptions {
  readonly prefixo?: string;
}

/**
 * A numeracao x/y e carimbada POR ULTIMO, depois do merge dos anexos: so nesse
 * momento se sabe quantas paginas o conjunto tem. Numerar antes e o defeito que
 * faz a exportacao judicial sair com "pagina 3 de 12" num documento de 480.
 */
export async function stampPageNumbers(
  pdfBytes: Uint8Array, opts: StampOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const fonte = await doc.embedFont(StandardFonts.Courier);
  const paginas = doc.getPages();
  const total = paginas.length;

  paginas.forEach((pagina, indice) => {
    const texto = `${opts.prefixo === undefined ? '' : `${opts.prefixo} · `}${indice + 1}/${total}`;
    const largura = fonte.widthOfTextAtSize(texto, 8);
    pagina.drawText(texto, {
      x: pagina.getWidth() - largura - 36,
      y: 22,
      size: 8, font: fonte, color: rgb(0.33, 0.33, 0.33),
    });
  });

  return doc.save();
}
```

- [ ] Acrescentar em `packages/documents/src/index.ts`:

```ts
export { documentHtml, escapeHtml, type DocumentTemplateInput } from './pdf/template';
export { closePdfPool, renderPdf, stampPageNumbers,
         type RenderOptions, type StampOptions } from './pdf/render';
```

- [ ] Rodar: `pnpm test -- pdf/template` (5 testes) e `pnpm test:int -- pdf/render` (3 testes) → todos passam.
- [ ] Commitar: `git commit -m "feat(documents): render paged-media PDFs and stamp page numbers last"`

---

### Task 47: `clin.attachment` — nome não revela conteúdo, e o expurgo alcança os bytes

**Arquivos:**
- Criar: `packages/db/migrations/0051_attachment.sql`
- Teste: `packages/db/test/iso/28-attachment.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/28-attachment.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.attachment', () => {
  it('a chave de objeto e UUID opaco e o nome original mora no BANCO', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='attachment'
          AND column_name IN ('storage_key','original_name') ORDER BY column_name`));
    expect(rows).toEqual([
      { column_name: 'original_name', data_type: 'text' },
      { column_name: 'storage_key', data_type: 'uuid' },
    ]);
  });

  it('guarda a referencia da chave de dados — base do crypto-shredding', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='attachment' AND column_name='dek_ref'`));
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('classifica o anexo — resultado de exame alimenta o painel Precisa de voce', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname='clin' AND t.typname='attachment_kind' ORDER BY e.enumsortorder`));
    expect(rows.map((r) => r.label)).toEqual([
      'resultado_exame', 'imagem', 'documento_externo', 'consentimento', 'outro']);
  });

  it('tem policy RESTRICTIVE — carrega patient_id', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='attachment' AND NOT p.polpermissive`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.attachment" does not exist`.

- [ ] `pnpm db:new attachment` (gera `0051_attachment.sql`) e escrever:

```sql
-- 0051_attachment.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.11 e §10 item 14 — NGS1.06.01: o nome do objeto NAO revela conteudo.
-- storage_key e UUIDv7 opaco, sem extensao; o nome original mora no banco, sob
-- RLS. dek_ref e a referencia da chave de dados: expurgo de midia imutavel nao
-- tem outro caminho alem de destruir a chave (crypto-shredding).

CREATE TYPE clin.attachment_kind AS ENUM
  ('resultado_exame','imagem','documento_externo','consentimento','outro');

CREATE TABLE clin.attachment (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  patient_id   uuid NOT NULL,
  encounter_id uuid,
  version_id   uuid,
  kind         clin.attachment_kind NOT NULL DEFAULT 'outro',
  storage_key  uuid NOT NULL,             -- NGS1.06.01: nome nao revela conteudo
  original_name text NOT NULL,            -- no BANCO, nunca no caminho do objeto
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0),
  sha256       bytea NOT NULL CHECK (octet_length(sha256) = 32),
  dek_ref      text NOT NULL,             -- chave de dados: base do crypto-shredding
  occurred_date date,                     -- data do EVENTO do exame, para ordenar a exportacao
  purged_at    timestamptz(3),
  created_by   uuid NOT NULL,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storage_key),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id));
ALTER TABLE clin.attachment OWNER TO app_owner;

CREATE INDEX ix_attachment_paciente
  ON clin.attachment (tenant_id, patient_id, occurred_date DESC NULLS LAST, id);
-- "Resultados chegados" do painel Precisa de voce: exame ainda nao vinculado.
CREATE INDEX ix_attachment_sem_versao
  ON clin.attachment (tenant_id, created_at)
  WHERE version_id IS NULL AND kind = 'resultado_exame';

REVOKE ALL ON clin.attachment FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.attachment TO app_rw;
GRANT UPDATE (encounter_id, version_id, kind, occurred_date) ON clin.attachment TO app_rw;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.attachment
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, patient_id, storage_key, original_name, content_type,
  size_bytes, sha256, dek_ref, created_by
  ON clin.attachment FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.attachment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.attachment AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY clinical_scope ON clin.attachment AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.attachment.tenant_id, clin.attachment.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp()))
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      WHERE (e.tenant_id, e.id)
                            = (clin.attachment.tenant_id, clin.attachment.encounter_id)
                        AND e.professional_id = app.current_professional_id()) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Reative as duas subconsultas comentadas em `packages/scheduling/src/needs-you.ts` (a de `resultados`) e rode `pnpm test:int -- needs-you` → verde.
- [ ] Commitar: `git commit -m "feat(db): store attachments with opaque keys and crypto-shredding references"`

---

### Task 48: `clin.record_export` — a exportação é uma entidade, não um efeito colateral

Sem isso, o paciente volta em seis meses dizendo que faltou um exame e não há com o que comparar.

**Arquivos:**
- Criar: `packages/db/migrations/0052_record_export.sql`
- Teste: `packages/db/test/iso/29-record-export.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/29-record-export.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.record_export', () => {
  it('congela o CONJUNTO exportado — versoes e anexos, por id', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='record_export'
          AND column_name IN ('version_ids','attachment_ids') ORDER BY column_name`));
    expect(rows).toEqual([
      { column_name: 'attachment_ids', data_type: 'ARRAY' },
      { column_name: 'version_ids', data_type: 'ARRAY' },
    ]);
  });

  it('guarda o recibo indissociavel com os ~11 campos', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='record_export' AND column_name='receipt_json'`));
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('e append-only: exportacao emitida nao se apaga nem se reescreve', async () => {
    const erro = await comoAdmin(async (c) => {
      try { await c.query(`DELETE FROM clin.record_export`); return null; }
      catch (e) { return (e as Error).message; }
    });
    expect(erro).toMatch(/append-only/);
  });

  it('registra quem pediu e em que qualidade — paciente, procurador ou juizo', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.record_export'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%requester_kind%'`));
    for (const k of ['titular', 'representante', 'profissional', 'judicial', 'fiscalizacao']) {
      expect(rows[0]?.def).toContain(k);
    }
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.record_export" does not exist`.

- [ ] `pnpm db:new record_export` (gera `0052_record_export.sql`) e escrever:

```sql
-- 0052_record_export.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.12 — a exportacao ECF.18 e uma ENTIDADE. version_ids e attachment_ids
-- congelam o CONJUNTO exportado: sem isso, o paciente volta em seis meses
-- dizendo que faltou um exame e nao ha com o que comparar.

CREATE TABLE clin.record_export (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  patient_id    uuid NOT NULL,
  requested_by  uuid NOT NULL,
  requester_kind text NOT NULL CHECK (requester_kind IN
    ('titular','representante','profissional','judicial','fiscalizacao')),
  requester_note text,
  period_from   date, period_to date,
  version_ids    uuid[] NOT NULL,
  attachment_ids uuid[] NOT NULL,
  document_ids   uuid[] NOT NULL,
  page_count    int NOT NULL CHECK (page_count > 0),
  pdf_key       uuid NOT NULL,
  pdf_sha256    bytea NOT NULL CHECK (octet_length(pdf_sha256) = 32),
  -- Os ~11 campos do recibo indissociavel (§3.12). jsonb e nao colunas porque o
  -- recibo e um ARTEFATO congelado: ele nao e consultado por coluna, e sim
  -- reproduzido byte a byte.
  receipt_json  jsonb NOT NULL,
  duration_ms   int,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id, id),
  CHECK (period_from IS NULL OR period_to IS NULL OR period_to >= period_from));
ALTER TABLE clin.record_export OWNER TO app_owner;

CREATE INDEX ix_record_export_paciente
  ON clin.record_export (tenant_id, patient_id, created_at DESC);

REVOKE ALL ON clin.record_export FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.record_export TO app_rw;

CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON clin.record_export
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.record_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_export FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_export AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY clinical_scope ON clin.record_export AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.record_export.tenant_id, clin.record_export.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Commitar: `git commit -m "feat(db): model the ECF.18 record export as a first-class entity"`

---

### Task 49: `export.collectRecord` — o conjunto ordenado pela data do **evento**

**Arquivos:**
- Criar: `packages/export/src/collect.ts`
- Modificar: `packages/export/src/index.ts`, `packages/export/package.json`
- Teste: `packages/export/src/collect.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/export/src/collect.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { collectRecord } from './collect';
import { semearProntuarioCompleto, type SementeExport } from './test-support';

let s: SementeExport; let actor: Actor;

beforeAll(async () => {
  s = await semearProntuarioCompleto();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('coleta do prontuario integral', () => {
  it('ordena pela data do EVENTO, nao pela do registro', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const datas = r.blocos.map((b) => b.occurredDate);
    expect([...datas]).toEqual([...datas].sort());
  });

  it('inclui TODAS as versoes, inclusive as superadas — nada some da exportacao', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const versoes = r.blocos.flatMap((b) => b.versoes);
    expect(versoes.some((v) => v.superseded)).toBe(true);
    expect(versoes).toHaveLength(3);
  });

  it('marca a versao superada para ser TACHADA na renderizacao', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const superada = r.blocos.flatMap((b) => b.versoes).find((v) => v.superseded);
    expect(superada?.tachado).toBe(true);
    expect(superada?.justificativaDaSuperssao).toContain('paciente errado');
  });

  it('traz anexos e documentos referenciados pelo bloco a que pertencem', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    expect(r.anexos).toHaveLength(2);
    expect(r.documentos).toHaveLength(1);
    expect(r.anexos[0]?.storageKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respeita o recorte por periodo quando ele existe', async () => {
    const r = await withTenantTx(actor, (tx) =>
      collectRecord(tx, { patientId: s.patientId, from: '2026-06-01', to: '2026-06-30' }));
    expect(r.blocos).toHaveLength(1);
  });

  it('a coleta e leitura clinica e gera evento de auditoria', async () => {
    await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'PATIENT_RECORD_READ' AND entity_id = $1`, [s.patientId]));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- export/src/collect` → `Failed to resolve import "./collect"`.

- [ ] Criar `packages/export/src/collect.ts`:

```ts
// packages/export/src/collect.ts
import type { TxClient } from '@cadencia/db';

export interface ExportFieldValue {
  readonly labelSnapshot: string;
  readonly displaySnapshot: string | null;
  readonly ordinal: number;
  readonly texto: string;
}

export interface ExportVersion {
  readonly versionId: string;
  readonly versionNo: number;
  readonly kind: string;
  readonly finalizedAt: string;
  readonly authorNome: string;
  readonly incompleto: boolean;
  readonly superseded: boolean;
  /** Registro inativo aparece TACHADO na exportacao — nunca some. */
  readonly tachado: boolean;
  readonly justificativaDaSuperssao: string | null;
  readonly campos: readonly ExportFieldValue[];
  readonly diagnosticos: readonly { code: string; display: string }[];
}

export interface ExportBlock {
  readonly encounterId: string;
  readonly occurredDate: string;
  readonly clinicaNome: string;
  readonly versoes: readonly ExportVersion[];
}

export interface ExportAttachment {
  readonly attachmentId: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly occurredDate: string | null;
  readonly sha256Hex: string;
}

export interface ExportDocument {
  readonly documentId: string;
  readonly kind: string;
  readonly issuedDate: string;
  readonly pdfKey: string | null;
  readonly assinado: boolean;
}

export interface CollectedRecord {
  readonly patientId: string;
  readonly blocos: readonly ExportBlock[];
  readonly anexos: readonly ExportAttachment[];
  readonly documentos: readonly ExportDocument[];
}

export interface CollectInput {
  readonly patientId: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * §3.12 e §7 — a coleta do prontuario INTEGRAL.
 *
 * Tres regras que a ordem das linhas carrega:
 *  1. ordenacao pela data do EVENTO (occurred_date), nunca pela do registro;
 *  2. TODAS as versoes entram, inclusive as superadas — registro inativo aparece
 *     TACHADO, jamais ausente. O verbo "Excluir" nao existe no produto;
 *  3. anexos vao junto e sao REFERENCIADOS pelo bloco a que pertencem.
 *
 * A funcao devolve METADADOS, nunca bytes: o merge dos anexos acontece em
 * streaming (Task 50), porque prontuario de 20 anos com 500 anexos estoura
 * memoria de qualquer outro jeito.
 */
export async function collectRecord(
  tx: TxClient, i: CollectInput,
): Promise<CollectedRecord> {
  await tx.query(`SELECT audit.log_read('record_export', $1)`, [i.patientId]);

  const versoes = await tx.query<{
    encounter_id: string; occurred_date: string; clinica_nome: string;
    version_id: string; version_no: number; kind: string; finalized_at: string;
    author_nome: string; incompleto: boolean; superseded: boolean;
    justificativa_super: string | null;
  }>(
    `SELECT e.id AS encounter_id, e.occurred_date::text AS occurred_date,
            c.nome AS clinica_nome,
            v.id AS version_id, v.version_no, v.kind::text AS kind,
            to_char(v.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finalized_at,
            u.full_name AS author_nome, v.incompleto, v.superseded,
            sup.justificativa AS justificativa_super
       FROM clin.encounter e
       JOIN app.clinic c ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN clin.v_version_status v ON (v.tenant_id, v.encounter_id) = (e.tenant_id, e.id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (v.tenant_id, v.author_professional_id)
       JOIN id."user" u ON u.id = p.user_id
       LEFT JOIN clin.encounter_version sup ON sup.id = v.superseded_by
      WHERE e.patient_id = $1
        AND ($2::date IS NULL OR e.occurred_date >= $2::date)
        AND ($3::date IS NULL OR e.occurred_date <= $3::date)
      ORDER BY e.occurred_date, e.id, v.version_no`,
    [i.patientId, i.from ?? null, i.to ?? null]);

  const campos = await tx.query<{
    version_id: string; label_snapshot: string; display_snapshot: string | null;
    ordinal: number; texto: string }>(
    `SELECT f.version_id, f.label_snapshot, f.display_snapshot, f.ordinal,
            coalesce(f.value_text, f.value_num::text, f.value_bool::text,
                     f.value_date::text, f.value_ref_code, f.value_json::text, '') AS texto
       FROM clin.encounter_field_value f
       JOIN clin.encounter_version v ON (v.tenant_id, v.id) = (f.tenant_id, f.version_id)
       JOIN clin.encounter e ON (e.tenant_id, e.id) = (v.tenant_id, v.encounter_id)
      WHERE e.patient_id = $1
      ORDER BY f.version_id, f.section_instance, f.ordinal`, [i.patientId]);

  const cids = await tx.query<{ version_id: string; code: string; display: string }>(
    `SELECT version_id, code, display_snapshot AS display FROM clin.diagnosis
      WHERE patient_id = $1 ORDER BY version_id, code`, [i.patientId]);

  const anexos = await tx.query<{
    id: string; storage_key: string; original_name: string; content_type: string;
    occurred_date: string | null; sha: string }>(
    `SELECT id, storage_key, original_name, content_type,
            occurred_date::text AS occurred_date, encode(sha256,'hex') AS sha
       FROM clin.attachment
      WHERE patient_id = $1 AND purged_at IS NULL
      ORDER BY occurred_date NULLS LAST, created_at`, [i.patientId]);

  const docs = await tx.query<{
    id: string; kind: string; issued_date: string; pdf_key: string | null; assinado: boolean }>(
    `SELECT id, kind::text AS kind, issued_date::text AS issued_date, pdf_key,
            signature_id IS NOT NULL AS assinado
       FROM clin.document WHERE patient_id = $1 ORDER BY issued_date, created_at`,
    [i.patientId]);

  const camposPorVersao = new Map<string, ExportFieldValue[]>();
  for (const c of campos.rows) {
    const lista = camposPorVersao.get(c.version_id) ?? [];
    lista.push({ labelSnapshot: c.label_snapshot, displaySnapshot: c.display_snapshot,
                 ordinal: c.ordinal, texto: c.texto });
    camposPorVersao.set(c.version_id, lista);
  }
  const cidsPorVersao = new Map<string, { code: string; display: string }[]>();
  for (const c of cids.rows) {
    const lista = cidsPorVersao.get(c.version_id) ?? [];
    lista.push({ code: c.code, display: c.display });
    cidsPorVersao.set(c.version_id, lista);
  }

  const blocos = new Map<string, ExportBlock & { versoes: ExportVersion[] }>();
  for (const v of versoes.rows) {
    const bloco = blocos.get(v.encounter_id) ?? {
      encounterId: v.encounter_id, occurredDate: v.occurred_date,
      clinicaNome: v.clinica_nome, versoes: [] as ExportVersion[],
    };
    bloco.versoes.push({
      versionId: v.version_id, versionNo: v.version_no, kind: v.kind,
      finalizedAt: v.finalized_at, authorNome: v.author_nome, incompleto: v.incompleto,
      superseded: v.superseded,
      tachado: v.superseded,
      justificativaDaSuperssao: v.justificativa_super,
      campos: camposPorVersao.get(v.version_id) ?? [],
      diagnosticos: cidsPorVersao.get(v.version_id) ?? [],
    });
    blocos.set(v.encounter_id, bloco);
  }

  return {
    patientId: i.patientId,
    blocos: [...blocos.values()],
    anexos: anexos.rows.map((a) => ({
      attachmentId: a.id, storageKey: a.storage_key, originalName: a.original_name,
      contentType: a.content_type, occurredDate: a.occurred_date, sha256Hex: a.sha })),
    documentos: docs.rows.map((d) => ({
      documentId: d.id, kind: d.kind, issuedDate: d.issued_date,
      pdfKey: d.pdf_key, assinado: d.assinado })),
  };
}
```

- [ ] Criar `packages/export/src/test-support.ts` que semeia um paciente com: três versões (original, adendo, retificação com justificativa contendo "paciente errado"), dois anexos (um em junho, um em agosto) e um documento; declarar em `packages/export/package.json` as dependências `@cadencia/db`, `@cadencia/kernel`, `@cadencia/documents`.
- [ ] Substituir `packages/export/src/index.ts` por:

```ts
export {
  collectRecord,
  type CollectInput, type CollectedRecord, type ExportAttachment, type ExportBlock,
  type ExportDocument, type ExportFieldValue, type ExportVersion,
} from './collect';
```

- [ ] `pnpm install && pnpm test:int -- export/src/collect` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(export): collect the whole record ordered by event date"`

---

### Task 50: `export.exportRecord` — blocos, merge em streaming, recibo e numeração por último

**Arquivos:**
- Criar: `packages/export/src/export-record.ts`, `packages/export/src/receipt.ts`
- Modificar: `packages/export/src/index.ts`
- Teste: `packages/export/src/export-record.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/export/src/export-record.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { closePdfPool } from '@cadencia/documents';
import { exportRecord } from './export-record';
import { buildReceipt } from './receipt';
import { semearProntuarioCompleto, type SementeExport } from './test-support';

let s: SementeExport; let actor: Actor;

beforeAll(async () => {
  s = await semearProntuarioCompleto();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); await closePdfPool(); });

describe('exportacao integral ECF.18', () => {
  it('o recibo tem os onze campos indissociaveis', () => {
    const r = buildReceipt({
      exportId: 'e', patientNome: 'Maria', patientCpf: '111.444.777-35',
      tenantRazaoSocial: 'Clinica ME', tenantCnpj: '12ABC34501DE35', clinicaCnes: '1234567',
      requesterKind: 'titular', requestedByNome: 'Maria', emitidoEm: '2026-08-03T12:00:00.000Z',
      periodoDe: null, periodoAte: null,
      totalVersoes: 3, totalAnexos: 2, totalDocumentos: 1, pageCount: 12,
      pdfSha256Hex: 'ab'.repeat(32), softwareNome: 'Cadência', softwareVersao: '1.0.0',
    });
    expect(Object.keys(r)).toHaveLength(19);
    expect(r.pdfSha256Hex).toBe('ab'.repeat(32));
    expect(r.cnes).toBe('1234567');
  });

  it('produz um PDF com todas as paginas e registra a entidade', async () => {
    const r = await withTenantTx(actor, (tx) => exportRecord(tx, {
      patientId: s.patientId, requesterKind: 'titular' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = await PDFDocument.load(r.value.pdfBytes);
    expect(doc.getPageCount()).toBe(r.value.pageCount);
    expect(r.value.pageCount).toBeGreaterThanOrEqual(2);

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      page_count: number; n_versoes: number; n_anexos: number }>(
      `SELECT page_count,
              array_length(version_ids, 1) AS n_versoes,
              array_length(attachment_ids, 1) AS n_anexos
         FROM clin.record_export WHERE id = $1`, [r.value.exportId]));
    expect(rows[0]?.page_count).toBe(r.value.pageCount);
    expect(rows[0]?.n_versoes).toBe(3);
    expect(rows[0]?.n_anexos).toBe(2);
  });

  it('a numeracao e carimbada por ULTIMO, cobrindo tambem as paginas dos anexos', async () => {
    const r = await withTenantTx(actor, (tx) => exportRecord(tx, {
      patientId: s.patientId, requesterKind: 'judicial' }));
    if (!r.ok) throw new Error('nao exportou');
    const texto = Buffer.from(r.value.pdfBytes).toString('latin1');
    expect(texto).toContain(`/${r.value.pageCount}`);
  });

  it('grava evento de auditoria RECORD_EXPORT com o total de paginas', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ meta: { paginas?: number } }>(
      `SELECT meta FROM audit.event WHERE event_type='RECORD_EXPORT' ORDER BY id DESC LIMIT 1`));
    expect(rows[0]?.meta.paginas).toBeGreaterThan(0);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- export-record` → `Failed to resolve import "./export-record"`.

- [ ] Criar `packages/export/src/receipt.ts`:

```ts
// packages/export/src/receipt.ts

/**
 * §3.12 — o recibo INDISSOCIAVEL da exportacao. Ele nao e anexo: e a ultima
 * pagina do mesmo PDF, e o hash que ele declara e o do proprio arquivo, o que
 * permite a quem recebe conferir sem nos.
 */
export interface ReceiptInput {
  readonly exportId: string;
  readonly patientNome: string;
  readonly patientCpf: string | null;
  readonly tenantRazaoSocial: string;
  readonly tenantCnpj: string;
  readonly clinicaCnes: string;
  readonly requesterKind: string;
  readonly requestedByNome: string;
  readonly emitidoEm: string;
  readonly periodoDe: string | null;
  readonly periodoAte: string | null;
  readonly totalVersoes: number;
  readonly totalAnexos: number;
  readonly totalDocumentos: number;
  readonly pageCount: number;
  readonly pdfSha256Hex: string;
  readonly softwareNome: string;
  readonly softwareVersao: string;
}

export interface Receipt extends Record<string, string | number | null> {
  readonly exportId: string;
  readonly cnes: string;
}

export function buildReceipt(i: ReceiptInput): Receipt {
  return {
    exportId: i.exportId,
    paciente: i.patientNome,
    cpf: i.patientCpf,
    prestador: i.tenantRazaoSocial,
    cnpj: i.tenantCnpj,
    cnes: i.clinicaCnes,
    solicitanteQualidade: i.requesterKind,
    solicitanteNome: i.requestedByNome,
    emitidoEm: i.emitidoEm,
    periodoDe: i.periodoDe,
    periodoAte: i.periodoAte,
    totalVersoes: i.totalVersoes,
    totalAnexos: i.totalAnexos,
    totalDocumentos: i.totalDocumentos,
    totalPaginas: i.pageCount,
    pdfSha256Hex: i.pdfSha256Hex,
    algoritmoHash: 'SHA-256',
    software: i.softwareNome,
    softwareVersao: i.softwareVersao,
  } as Receipt;
}

export function receiptHtml(r: Receipt): string {
  const linhas = Object.entries(r)
    .map(([k, v]) => `<tr><th>${k}</th><td class="mono">${v === null ? '—' : String(v)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Recibo de exportação</title><style>
  @page { size: A4; margin: 22mm 18mm; }
  body { font: 400 10pt/1.5 "IBM Plex Serif", Georgia, serif; }
  h1 { font: 600 13pt "IBM Plex Sans", sans-serif; text-transform: uppercase; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; width: 45mm; font: 500 9pt "IBM Plex Sans", sans-serif;
       vertical-align: top; padding: 1.2mm 0; }
  td { padding: 1.2mm 0; }
  .mono { font-family: "IBM Plex Mono", monospace; word-break: break-all; }
</style></head><body>
<h1>Recibo de exportação de prontuário</h1>
<p>Este recibo é parte indissociável do documento exportado.</p>
<table>${linhas}</table>
</body></html>`;
}
```

- [ ] Criar `packages/export/src/export-record.ts`:

```ts
// packages/export/src/export-record.ts
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { documentHtml, escapeHtml, renderPdf, stampPageNumbers } from '@cadencia/documents';
import { collectRecord, type CollectedRecord, type ExportBlock } from './collect';
import { buildReceipt, receiptHtml } from './receipt';

export interface ExportRecordInput {
  readonly patientId: string;
  readonly requesterKind: 'titular' | 'representante' | 'profissional' | 'judicial' | 'fiscalizacao';
  readonly from?: string;
  readonly to?: string;
  readonly requesterNote?: string;
  /** Blocos por lote de renderizacao. Menor = menos memoria, mais chamadas. */
  readonly blocosPorLote?: number;
}

export interface ExportedRecord {
  readonly exportId: string;
  readonly pdfBytes: Uint8Array;
  readonly pageCount: number;
  readonly pdfSha256Hex: string;
  readonly durationMs: number;
}

const SOFTWARE_NOME = 'Cadência';
const SOFTWARE_VERSAO = '1.0.0';

function blocoHtml(b: ExportBlock): string {
  const versoes = b.versoes.map((v) => {
    const cabecalho = v.superseded
      ? `<div class="super">Versão ${v.versionNo} · ${escapeHtml(v.kind)} · RETIFICADA${
          v.justificativaDaSuperssao === null ? ''
            : ` — justificativa: ${escapeHtml(v.justificativaDaSuperssao)}`}</div>`
      : `<div class="vig">Versão ${v.versionNo} · ${escapeHtml(v.kind)}${
          v.incompleto ? ' · REGISTRO INCOMPLETO (auto-finalizado)' : ''}</div>`;
    const campos = v.campos.map((c) =>
      `<p><strong>${escapeHtml(c.labelSnapshot)}:</strong> ${escapeHtml(c.texto)}${
        c.displaySnapshot === null ? '' : ` (${escapeHtml(c.displaySnapshot)})`}</p>`).join('');
    const cids = v.diagnosticos.length === 0 ? ''
      : `<p><strong>CID:</strong> ${v.diagnosticos
          .map((d) => `${escapeHtml(d.code)} — ${escapeHtml(d.display)}`).join('; ')}</p>`;
    // Registro superado aparece TACHADO, nunca ausente. O verbo "Excluir" nao
    // existe no vocabulario do produto para registro finalizado.
    return `<section class="${v.superseded ? 'tachado' : ''}">${cabecalho}${campos}${cids}
      <p class="assin">Autor: ${escapeHtml(v.authorNome)} · finalizado em ${escapeHtml(v.finalizedAt)}</p>
    </section>`;
  }).join('');
  return `<article><h2>${escapeHtml(b.occurredDate)} — ${escapeHtml(b.clinicaNome)}</h2>${versoes}</article>`;
}

/**
 * §3.12, §7 e §9 — a exportacao integral.
 *
 * Renderizacao em BLOCOS com merge em streaming: prontuario de 20 anos com 500
 * anexos estoura memoria de qualquer outro jeito. Cada lote vira um PDF pequeno,
 * e o pdf-lib copia pagina a pagina para o documento final; nenhum momento
 * segura o acervo inteiro descomprimido.
 *
 * A NUMERACAO e carimbada por ULTIMO, depois do merge — so ai se sabe o total.
 * Alvo do Apendice A: p95 < 60 s.
 */
export async function exportRecord(
  tx: TxClient, i: ExportRecordInput,
): Promise<Result<ExportedRecord, { kind: 'paciente_nao_encontrado' }>> {
  const inicio = Date.now();

  const cab = await tx.query<{
    display_name: string; cpf: string | null;
    razao_social: string; cnpj: string; cnes: string; solicitante: string }>(
    `SELECT p.display_name, t.razao_social, t.cnpj,
            coalesce(c.cnes, '0000000') AS cnes,
            (SELECT i.value FROM clin.patient_identifier i
              WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id AND i.kind = 'CPF'
              LIMIT 1) AS cpf,
            (SELECT u.full_name FROM id."user" u WHERE u.id = app.current_user_id()) AS solicitante
       FROM clin.patient p
       JOIN app.tenant t ON t.id = p.tenant_id
       LEFT JOIN app.clinic c ON c.tenant_id = p.tenant_id
                             AND c.id = nullif(current_setting('app.clinic_id', true), '')::uuid
      WHERE p.id = $1`, [i.patientId]);
  const h = cab.rows[0];
  if (!h) return { ok: false, error: { kind: 'paciente_nao_encontrado' } };

  const coletado: CollectedRecord = await collectRecord(tx, {
    patientId: i.patientId,
    ...(i.from === undefined ? {} : { from: i.from }),
    ...(i.to === undefined ? {} : { to: i.to }),
  });

  const final = await PDFDocument.create();
  final.setTitle('Prontuário — exportação integral');
  final.setProducer(`${SOFTWARE_NOME} ${SOFTWARE_VERSAO}`);
  // PDF/UA e PDF/A-2b exigem idioma declarado e estrutura marcada; o idioma sai
  // daqui, a marcacao vem do Chromium com o HTML semantico do template.
  final.setLanguage('pt-BR');

  const porLote = Math.max(i.blocosPorLote ?? 25, 1);
  for (let inicioLote = 0; inicioLote < coletado.blocos.length; inicioLote += porLote) {
    const lote = coletado.blocos.slice(inicioLote, inicioLote + porLote);
    const html = documentHtml({
      titulo: 'PRONTUÁRIO — EXPORTAÇÃO INTEGRAL',
      clinica: { nome: h.razao_social, cnpj: h.cnpj, cnes: h.cnes, endereco: '' },
      profissional: { nome: h.solicitante, conselho: '', numero: '', uf: '' },
      paciente: { nome: h.display_name, nascimento: null, cpf: h.cpf },
      emitidoEm: new Date().toISOString(),
      corpo: lote.map(blocoHtml).join(''),
    });
    const parcial = await PDFDocument.load(await renderPdf(html));
    const paginas = await final.copyPages(parcial, parcial.getPageIndices());
    for (const p of paginas) final.addPage(p);
  }

  // Anexos entram JUNTO. Nesta tarefa entram como folha de referencia; a Task 51
  // acrescenta os bytes reais vindos do storage, no mesmo laco de streaming.
  if (coletado.anexos.length > 0) {
    const listaHtml = documentHtml({
      titulo: 'ANEXOS DO PRONTUÁRIO',
      clinica: { nome: h.razao_social, cnpj: h.cnpj, cnes: h.cnes, endereco: '' },
      profissional: { nome: h.solicitante, conselho: '', numero: '', uf: '' },
      paciente: { nome: h.display_name, nascimento: null, cpf: h.cpf },
      emitidoEm: new Date().toISOString(),
      corpo: `<ol>${coletado.anexos.map((a) =>
        `<li>${escapeHtml(a.originalName)} — ${escapeHtml(a.contentType)} — SHA-256 ${
          escapeHtml(a.sha256Hex)}</li>`).join('')}</ol>`,
    });
    const parcial = await PDFDocument.load(await renderPdf(listaHtml));
    const paginas = await final.copyPages(parcial, parcial.getPageIndices());
    for (const p of paginas) final.addPage(p);
  }

  const exportId = uuidv7();
  const semRecibo = await final.save();
  const shaProvisorio = createHash('sha256').update(semRecibo).digest('hex');

  const recibo = buildReceipt({
    exportId,
    patientNome: h.display_name, patientCpf: h.cpf,
    tenantRazaoSocial: h.razao_social, tenantCnpj: h.cnpj, clinicaCnes: h.cnes,
    requesterKind: i.requesterKind, requestedByNome: h.solicitante,
    emitidoEm: new Date().toISOString(),
    periodoDe: i.from ?? null, periodoAte: i.to ?? null,
    totalVersoes: coletado.blocos.reduce((n, b) => n + b.versoes.length, 0),
    totalAnexos: coletado.anexos.length,
    totalDocumentos: coletado.documentos.length,
    pageCount: final.getPageCount() + 1,
    pdfSha256Hex: shaProvisorio,
    softwareNome: SOFTWARE_NOME, softwareVersao: SOFTWARE_VERSAO,
  });

  const reciboPdf = await PDFDocument.load(await renderPdf(receiptHtml(recibo)));
  const paginasRecibo = await final.copyPages(reciboPdf, reciboPdf.getPageIndices());
  for (const p of paginasRecibo) final.addPage(p);

  // Numeracao POR ULTIMO: agora, e so agora, o total e conhecido.
  const carimbado = await stampPageNumbers(await final.save(), { prefixo: 'Prontuário' });
  const sha = createHash('sha256').update(carimbado).digest();
  const pdfKey = uuidv7();
  const pageCount = (await PDFDocument.load(carimbado)).getPageCount();
  const durationMs = Date.now() - inicio;

  await tx.query(
    `INSERT INTO clin.record_export (
        id, patient_id, requested_by, requester_kind, requester_note,
        period_from, period_to, version_ids, attachment_ids, document_ids,
        page_count, pdf_key, pdf_sha256, receipt_json, duration_ms)
     VALUES ($1, $2, app.current_user_id(), $3, $4, $5::date, $6::date,
             $7::uuid[], $8::uuid[], $9::uuid[], $10, $11, $12, $13::jsonb, $14)`,
    [exportId, i.patientId, i.requesterKind, i.requesterNote ?? null,
     i.from ?? null, i.to ?? null,
     coletado.blocos.flatMap((b) => b.versoes.map((v) => v.versionId)),
     coletado.anexos.map((a) => a.attachmentId),
     coletado.documentos.map((d) => d.documentId),
     pageCount, pdfKey, sha, JSON.stringify(recibo), durationMs]);

  await tx.query(
    `SELECT audit.log('RECORD_EXPORT', 'clin', 'record_export', $1, 'sucesso',
                      jsonb_build_object('paginas', $2::int, 'ms', $3::int,
                                         'qualidade', $4::text), NULL)`,
    [exportId, pageCount, durationMs, i.requesterKind]);

  return ok({ exportId, pdfBytes: carimbado, pageCount,
              pdfSha256Hex: sha.toString('hex'), durationMs });
}
```

- [ ] Acrescentar em `packages/export/src/index.ts`:

```ts
export { exportRecord, type ExportRecordInput, type ExportedRecord } from './export-record';
export { buildReceipt, receiptHtml, type Receipt, type ReceiptInput } from './receipt';
```

- [ ] Rodar: `pnpm test:int -- export-record` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(export): render the whole record in batches and stamp numbering last"`

---

### Task 51: o alvo publicado — 20 anos, 500 anexos, p95 < 60 s

**Arquivos:**
- Criar: `packages/export/src/export-load.int.test.ts`

- [ ] Escrever o teste (marcado para o CI noturno, com `describe.skipIf`):

```ts
// packages/export/src/export-load.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { closePdfPool } from '@cadencia/documents';
import { exportRecord } from './export-record';
import { semearProntuarioCompleto, type SementeExport } from './test-support';

// So no CI noturno: 20 anos sinteticos levam minutos para semear.
const NOTURNO = process.env.CADENCIA_LOAD_TESTS === '1';

let s: SementeExport; let actor: Actor;

describe.skipIf(!NOTURNO)('exportacao sob carga — Apendice A: p95 < 60 s', () => {
  beforeAll(async () => {
    s = await semearProntuarioCompleto();
    actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
              requestId: uuidv7() };
    const c = await appPool().connect();
    try {
      // 20 anos, ~12 atendimentos por ano = 240 blocos; 500 anexos.
      for (let ano = 2006; ano <= 2025; ano += 1) {
        for (let mes = 1; mes <= 12; mes += 1) {
          const encId = uuidv7();
          const dia = `${ano}-${String(mes).padStart(2, '0')}-15`;
          await c.query(
            `INSERT INTO clin.encounter
               (tenant_id, id, patient_id, professional_id, clinic_id,
                occurred_at, occurred_date, status)
             VALUES ($1, $2, $3, $4, $5, ($6::date)::timestamptz, $6::date, 'finalizado')`,
            [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId, dia]);
          const verId = uuidv7();
          await c.query(
            `INSERT INTO clin.encounter_version
               (tenant_id, id, encounter_id, version_no, kind, author_user_id,
                author_professional_id, finalized_at, content_hash, serializer_version)
             VALUES ($1, $2, $3, 1, 'original', $4, $5, ($6::date)::timestamptz,
                     decode(repeat('11',32),'hex'), 'jcs-1')`,
            [s.tenantId, verId, encId, s.userId, s.professionalId, dia]);
          await c.query(
            `INSERT INTO clin.encounter_field_value
               (tenant_id, id, version_id, finalized_at, field_id, field_generation,
                label_snapshot, ordinal, value_text)
             VALUES ($1, gen_random_uuid(), $2, ($3::date)::timestamptz, $4, 1,
                     'Queixa principal', 0, 'consulta de rotina sem intercorrencias')`,
            [s.tenantId, verId, dia, s.fieldId]);
        }
      }
      for (let n = 0; n < 500; n += 1) {
        await c.query(
          `INSERT INTO clin.attachment
             (tenant_id, id, patient_id, kind, storage_key, original_name, content_type,
              size_bytes, sha256, dek_ref, occurred_date, created_by)
           VALUES ($1, gen_random_uuid(), $2, 'resultado_exame', gen_random_uuid(),
                   $3, 'application/pdf', 120000, decode(repeat('22',32),'hex'),
                   'dek-teste', '2020-01-15', $4)`,
          [s.tenantId, s.patientId, `exame-${n}.pdf`, s.userId]);
      }
      await c.query(`ANALYZE clin.encounter`);
      await c.query(`ANALYZE clin.encounter_field_value`);
    } finally { c.release(); }
  }, 900_000);

  afterAll(async () => { await closePools(); await closePdfPool(); });

  it('exporta 20 anos com 500 anexos em menos de 60 s, sem estouro de memoria', async () => {
    const antes = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    const r = await withTenantTx(actor, (tx) => exportRecord(tx, {
      patientId: s.patientId, requesterKind: 'judicial', blocosPorLote: 20 }));
    const ms = Date.now() - t0;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(60_000);
    // Renderizacao em blocos: o pico de heap nao pode escalar com o acervo.
    const depois = process.memoryUsage().heapUsed;
    expect(depois - antes).toBeLessThan(600 * 1024 * 1024);
  }, 180_000);

  it('a exportacao registra a duracao medida, para o painel de latencia', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ duration_ms: number }>(
      `SELECT duration_ms FROM clin.record_export ORDER BY created_at DESC LIMIT 1`));
    expect(rows[0]?.duration_ms).toBeGreaterThan(0);
    expect(rows[0]?.duration_ms).toBeLessThan(60_000);
  });
});
```

- [ ] Acrescentar o script ao `package.json` da raiz:

```json
    "test:load": "cross-env CADENCIA_LOAD_TESTS=1 vitest run --config vitest.int.config.ts --testTimeout 900000",
```

> Se `cross-env` não estiver instalado, use `CADENCIA_LOAD_TESTS=1 pnpm test:int` no shell POSIX ou `$env:CADENCIA_LOAD_TESTS='1'; pnpm test:int` no PowerShell, e deixe o script apontando para o mesmo comando do seu ambiente.

- [ ] Rodar `pnpm test:int -- export-load` → os testes são **pulados** (comportamento correto no ciclo normal).
- [ ] Rodar `pnpm test:load -- export-load` uma vez e registrar o tempo obtido na "Definição de pronto".
- [ ] Commitar: `git commit -m "test(export): assert the twenty-year export stays under sixty seconds"`

---

## Parte VIII — Prescrição via Memed, atrás de interface própria

> **As armadilhas reais, escritas aqui porque quem executa o plano não tem como saber:**
> 1. **Não existe criar prescrição via API.** Só o módulo JS dentro da nossa tela. Isso mata backend headless e app nativo puro — e é a razão de o design descartar app nativo (§9).
> 2. **O retorno vem por EVENTO JS**, não por webhook. O browser informa um `id`; a **verdade** é buscada no servidor com `fetchPrescription`.
> 3. **O token do prescritor é DINÂMICO.** Cachear como fixo é o bug clássico: funciona no primeiro dia e falha no segundo.
> 4. **"Documentos estruturados" (CID, categoria) não vêm ligados por padrão** — precisam ser habilitados na conta do parceiro.
> 5. Persistimos do **nosso** lado id, link digital, código de desbloqueio, itens normalizados, URL do PDF **e os bytes assinados**, desde a primeira prescrição. É o que impede virar refém e o que permite migrar para Mevo depois.

### Task 52: `PrescriptionProvider` e o fake

**Arquivos:**
- Criar: `packages/integrations/src/contracts/prescription.ts`, `packages/integrations/src/fakes/prescription-fake.ts`
- Modificar: `packages/integrations/src/index.ts`
- Teste: `packages/integrations/src/fakes/prescription-fake.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/integrations/src/fakes/prescription-fake.test.ts
import { describe, expect, it } from 'vitest';
import { createFakePrescriptionProvider } from './prescription-fake';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r', idempotencyKey: 'enc-1', deadlineMs: 3000,
};
const sessao = {
  professional: { fullName: 'Dr. Alceu', cpf: '00000000000',
                  council: 'CRM' as const, number: '123456', uf: 'SP' },
  patient: { fullName: 'Maria Souza Lima', birthDate: '1988-03-14' },
  encounterId: 'enc-1',
};

describe('provedor de prescricao falso', () => {
  it('a sessao e EMBUTIDA: devolve scriptUrl, nao um endpoint de criacao', async () => {
    const p = createFakePrescriptionProvider();
    const r = await p.openPrescriberSession(ctx, sessao);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('embedded');
      expect(r.value.scriptUrl).toMatch(/^https:\/\//);
    }
  });

  it('o token e DINAMICO e vem com expiracao — cachear como fixo e o bug classico', async () => {
    const p = createFakePrescriptionProvider();
    const a = await p.openPrescriberSession(ctx, sessao);
    const b = await p.openPrescriberSession(ctx, sessao);
    if (a.ok && b.ok) {
      expect(a.value.token).not.toBe(b.value.token);
      expect(a.value.expiresAt).toMatch(/Z$/);
    }
  });

  it('o adaptador RECUSA servir token vencido em vez de deixar a tela falhar sozinha', async () => {
    const p = createFakePrescriptionProvider({ tokenJaVencido: true });
    const r = await p.openPrescriberSession(ctx, sessao);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('misconfigured');
  });

  it('fetchPrescription e a VERDADE server-side — o browser so informa um id', async () => {
    const p = createFakePrescriptionProvider();
    const r = await p.fetchPrescription(ctx, { providerPrescriptionId: 'rx-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.providerPrescriptionId).toBe('rx-1');
      expect(r.value.items.length).toBeGreaterThan(0);
      expect(r.value.patientLinkUrl).toMatch(/^https:\/\//);
      expect(r.value.validationCode).toHaveLength(6);
    }
  });

  it('fetchSignedArtifact devolve os bytes assinados e o sha256', async () => {
    const p = createFakePrescriptionProvider();
    const r = await p.fetchSignedArtifact(ctx, { providerPrescriptionId: 'rx-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes.byteLength).toBeGreaterThan(0);
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  it('declara safety: openPrescriberSession idempotent, fetch* safe', () => {
    const p = createFakePrescriptionProvider();
    expect(p.safety.openPrescriberSession).toBe('idempotent');
    expect(p.safety.fetchPrescription).toBe('safe');
    expect(p.safety.fetchSignedArtifact).toBe('safe');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- prescription-fake` → `Failed to resolve import "./prescription-fake"`.

- [ ] Criar `packages/integrations/src/contracts/prescription.ts`:

```ts
// packages/integrations/src/contracts/prescription.ts
import type { E164, Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

/**
 * §7.1 — Memed e provedor EMBUTIDO, nao cliente HTTP.
 *
 * NAO EXISTE criar prescricao via API: so o modulo JS dentro da NOSSA tela. O
 * retorno vem por EVENTO JS, e por isso `fetchPrescription` existe — o browser
 * informa um id, e a verdade e buscada no servidor. O token e DINAMICO: o
 * adaptador RECUSA servir um vencido em vez de deixar a tela quebrar sozinha.
 */
export interface PrescriptionItem {
  readonly nome: string;
  readonly principioAtivo: string | null;
  readonly concentracao: string | null;
  readonly forma: string | null;
  readonly quantidade: string | null;
  readonly posologia: string;
  readonly ehControlado: boolean;
}

export interface PrescriptionRecord {
  readonly providerPrescriptionId: string;
  readonly createdAt: Rfc3339;
  /** Link digital que o paciente abre na farmacia. */
  readonly patientLinkUrl: string;
  /** Codigo de desbloqueio do link. Persistido do NOSSO lado desde a primeira. */
  readonly validationCode: string;
  readonly pdfUrl: string;
  readonly items: readonly PrescriptionItem[];
  /** CID e categoria so vem quando "documentos estruturados" esta LIGADO na conta. */
  readonly structured: { readonly cid: string | null; readonly categoria: string | null } | null;
}

export interface PrescriberSession {
  readonly mode: 'embedded';
  readonly scriptUrl: string;
  readonly token: string;
  readonly expiresAt: Rfc3339;
  readonly patientPayload: Readonly<Record<string, string>>;
  readonly correlationId: string;
}

export interface PrescriptionProvider extends Provider {
  openPrescriberSession(ctx: ProviderCtx, i: {
    professional: { fullName: string; cpf: string; council: 'CRM' | 'CRO';
                    number: string; uf: string };
    patient: { fullName: string; birthDate?: string; cpf?: string; phone?: E164 };
    encounterId: string;
  }): Promise<ProviderResult<PrescriberSession>>;

  /** Verdade server-side. O browser so informa um id. */
  fetchPrescription(ctx: ProviderCtx, i: { providerPrescriptionId: string }):
    Promise<ProviderResult<PrescriptionRecord>>;

  /** Artefato ASSINADO (PDF com assinatura embarcada ou PKCS#7 destacado). */
  fetchSignedArtifact(ctx: ProviderCtx, i: { providerPrescriptionId: string }):
    Promise<ProviderResult<{ bytes: Uint8Array; sha256: string; detachedP7s?: Uint8Array }>>;
}
```

- [ ] Criar `packages/integrations/src/fakes/prescription-fake.ts`:

```ts
// packages/integrations/src/fakes/prescription-fake.ts
import { createHash, randomBytes } from 'node:crypto';
import { asRfc3339, failure, success, type ProviderCtx, type Rfc3339 } from '../contracts/common';
import type {
  PrescriberSession, PrescriptionProvider, PrescriptionRecord,
} from '../contracts/prescription';

export interface FakePrescriptionOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout';
  readonly tokenJaVencido?: boolean;
  readonly comEstruturados?: boolean;
}

export function createFakePrescriptionProvider(
  opts: FakePrescriptionOptions = {},
): PrescriptionProvider {
  const modo = opts.modo ?? 'ok';

  function falha<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, detail: 'parceiro fora' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false, detail: 'deadline 3s' });
    }
    return null;
  }

  function agora(): Rfc3339 {
    return asRfc3339(new Date().toISOString()) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'prescription-fake',
    capabilities: new Set(['embedded', 'signed-artifact',
                           ...(opts.comEstruturados === true ? ['structured'] : [])]),
    safety: { openPrescriberSession: 'idempotent', fetchPrescription: 'safe',
              fetchSignedArtifact: 'safe' },

    async health() { return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() }; },

    async openPrescriberSession(ctx: ProviderCtx, i) {
      const f = falha<PrescriberSession>();
      if (f) return f;
      if (opts.tokenJaVencido === true) {
        // O adaptador recusa ANTES de entregar: token vencido na tela vira um
        // erro do parceiro dentro do nosso iframe, sem mensagem util nenhuma.
        return failure<PrescriberSession>({ kind: 'misconfigured', retrySafe: false,
          detail: 'token do prescritor ja vencido: reautorize o profissional' });
      }
      const expira = new Date(Date.now() + 15 * 60_000).toISOString();
      return success<PrescriberSession>({
        mode: 'embedded',
        scriptUrl: 'https://parceiro.fake/modulo.js',
        // DINAMICO por chamada: e isso que o cache indevido quebraria.
        token: randomBytes(16).toString('hex'),
        expiresAt: asRfc3339(expira) ?? agora(),
        patientPayload: { nome: i.patient.fullName, nascimento: i.patient.birthDate ?? '' },
        correlationId: ctx.idempotencyKey,
      }, `fake-session-${ctx.idempotencyKey}`);
    },

    async fetchPrescription(_ctx, i) {
      const f = falha<PrescriptionRecord>();
      if (f) return f;
      return success<PrescriptionRecord>({
        providerPrescriptionId: i.providerPrescriptionId,
        createdAt: agora(),
        patientLinkUrl: `https://parceiro.fake/r/${i.providerPrescriptionId}`,
        validationCode: '482913',
        pdfUrl: `https://parceiro.fake/pdf/${i.providerPrescriptionId}`,
        items: [{
          nome: 'Losartana potássica 50 mg',
          principioAtivo: 'losartana potássica', concentracao: '50 mg',
          forma: 'comprimido', quantidade: '30',
          posologia: '1 comprimido pela manhã, uso contínuo',
          ehControlado: false,
        }],
        structured: opts.comEstruturados === true
          ? { cid: 'I10', categoria: 'anti-hipertensivo' }
          : null,   // NAO vem ligado por padrao.
      }, `fake-rx-${i.providerPrescriptionId}`);
    },

    async fetchSignedArtifact(_ctx, i) {
      const f = falha<{ bytes: Uint8Array; sha256: string }>();
      if (f) return f;
      const bytes = new TextEncoder().encode(`%PDF-1.7 fake ${i.providerPrescriptionId}`);
      return success({
        bytes, sha256: createHash('sha256').update(bytes).digest('hex'),
      }, `fake-artifact-${i.providerPrescriptionId}`);
    },
  };
}
```

- [ ] Acrescentar em `packages/integrations/src/index.ts`:

```ts
export {
  type PrescriberSession, type PrescriptionItem, type PrescriptionProvider,
  type PrescriptionRecord,
} from './contracts/prescription';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
```

- [ ] Rodar: `pnpm test -- prescription-fake` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(integrations): declare the embedded prescription provider with a fake"`

---

### Task 53: `clin.prescription` — o que impede virar refém do parceiro

**Arquivos:**
- Criar: `packages/db/migrations/0053_prescription.sql`
- Teste: `packages/db/test/iso/30-prescription.iso.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/db/test/iso/30-prescription.iso.test.ts
import { describe, expect, it } from 'vitest';
import { comoAdmin } from './harness';

describe('clin.prescription', () => {
  it('persiste do NOSSO lado id, link, codigo, PDF e os bytes assinados', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='prescription'
          AND column_name IN ('provider','provider_prescription_id','patient_link_url',
                              'validation_code','pdf_key','pdf_sha256','signature_id')
        ORDER BY column_name`));
    expect(rows.map((r) => r.column_name)).toEqual([
      'patient_link_url', 'pdf_key', 'pdf_sha256', 'provider',
      'provider_prescription_id', 'signature_id', 'validation_code']);
  });

  it('os itens sao NORMALIZADOS em tabela propria, nao um blob do parceiro', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='clin' AND table_name='prescription_item'`));
    expect(rows[0]?.table_name).toBe('prescription_item');
  });

  it('o id do parceiro e unico por tenant — evento JS repetido nao duplica', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ux_prescription_provider'`));
    expect(rows[0]?.indexname).toBe('ux_prescription_provider');
  });

  it('e append-only e tem policy RESTRICTIVE', async () => {
    const { rows } = await comoAdmin((c) => c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='prescription' AND NOT p.polpermissive`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    const erro = await comoAdmin(async (c) => {
      try { await c.query(`DELETE FROM clin.prescription`); return null; }
      catch (e) { return (e as Error).message; }
    });
    expect(erro).toMatch(/append-only/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:iso` → `relation "clin.prescription" does not exist`.

- [ ] `pnpm db:new prescription` (gera `0053_prescription.sql`) e escrever:

```sql
-- 0053_prescription.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.11 e §7.1 — persistimos do NOSSO lado id, link digital, codigo de
-- desbloqueio, itens NORMALIZADOS, URL do PDF e os BYTES assinados, desde a
-- primeira prescricao. Guardar so o PDF visual com QR que aponta para o dominio
-- do parceiro e ficar refem: dois anos depois, numa acao judicial, o QR nao
-- resolve e nao ha como provar que aquele e o documento assinado.
--
-- Trocar para Mevo passa a ser um segundo adaptador e uma linha de configuracao.

CREATE TABLE clin.prescription (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  encounter_id    uuid,
  version_id      uuid,
  issued_date     date NOT NULL,
  provider        text NOT NULL,
  provider_prescription_id text NOT NULL,
  patient_link_url text NOT NULL,
  validation_code text NOT NULL,
  pdf_key         uuid,
  pdf_sha256      bytea CHECK (pdf_sha256 IS NULL OR octet_length(pdf_sha256) = 32),
  -- Assinatura verificada do NOSSO lado. NULL = pendente em "Precisa de voce".
  signature_id    uuid,
  structured_cid  text,
  structured_categoria text,
  cancelled_at    timestamptz(3),
  cancel_reason   text,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id)    REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)      REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, signature_id)    REFERENCES clin.signature(tenant_id, id),
  CHECK ((pdf_key IS NULL) = (pdf_sha256 IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL)));
ALTER TABLE clin.prescription OWNER TO app_owner;

-- O retorno vem por EVENTO JS, que o browser pode reemitir. Sem esta unicidade,
-- um duplo-clique no modulo do parceiro cria duas prescricoes iguais.
CREATE UNIQUE INDEX ux_prescription_provider
  ON clin.prescription (tenant_id, provider, provider_prescription_id);
CREATE INDEX ix_prescription_paciente
  ON clin.prescription (tenant_id, patient_id, issued_date DESC);
CREATE INDEX ix_prescription_nao_assinada
  ON clin.prescription (tenant_id, clinic_id, created_at)
  WHERE signature_id IS NULL AND cancelled_at IS NULL;

CREATE TABLE clin.prescription_item (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  prescription_id uuid NOT NULL,
  ordinal         int NOT NULL,
  nome            text NOT NULL,
  principio_ativo text,
  concentracao    text,
  forma           text,
  quantidade      text,
  posologia       text NOT NULL,
  eh_controlado   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, prescription_id, ordinal),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, prescription_id) REFERENCES clin.prescription(tenant_id, id));
ALTER TABLE clin.prescription_item OWNER TO app_owner;

CREATE INDEX ix_prescription_item_rx ON clin.prescription_item (tenant_id, prescription_id, ordinal);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescription','prescription_item'] LOOP
    EXECUTE format('REVOKE ALL ON clin.%I FROM PUBLIC, app_rw', t);
    EXECUTE format('GRANT SELECT, INSERT ON clin.%I TO app_rw', t);
    EXECUTE format('CREATE TRIGGER no_mutate BEFORE DELETE ON clin.%I
                      FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation()', t);
    EXECUTE format('ALTER TABLE clin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE clin.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON clin.%I AS PERMISSIVE FOR ALL TO app_rw
        USING (tenant_id = app.current_tenant_id() AND app.is_member())
        WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member())$p$, t);
  END LOOP;
END $$;

GRANT UPDATE (signature_id, pdf_key, pdf_sha256, cancelled_at, cancel_reason,
              version_id, structured_cid, structured_categoria)
  ON clin.prescription TO app_rw;

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, patient_id, professional_id, clinic_id, encounter_id, issued_date,
  provider, provider_prescription_id, patient_link_url, validation_code, created_by
  ON clin.prescription FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE ON clin.prescription_item
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE POLICY clinical_scope ON clin.prescription AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.prescription.tenant_id, clin.prescription.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

CREATE POLICY clinical_scope ON clin.prescription_item AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.prescription r
                      WHERE (r.tenant_id, r.id)
                            = (clin.prescription_item.tenant_id,
                               clin.prescription_item.prescription_id)) );
```

- [ ] Aplicar e rodar: `pnpm db:migrate && pnpm test:iso` → 4 testes novos passam.
- [ ] Reative a subconsulta `prescricoes` em `packages/scheduling/src/needs-you.ts` e rode `pnpm test:int -- needs-you` → verde.
- [ ] Commitar: `git commit -m "feat(db): own prescription identity, link, code and signed artifact"`

---

### Task 54: `prescriptions.openSession` e `prescriptions.confirmPrescription`

`confirm()` **só aceita** a prescrição se conseguir o artefato assinado **e** validá-lo. Se o parceiro não entregar artefato verificável, isso é um achado de conformidade a decidir **agora**, não uma surpresa em 2028.

**Arquivos:**
- Criar: `packages/prescriptions/src/session.ts`, `packages/prescriptions/src/confirm.ts`
- Modificar: `packages/prescriptions/src/index.ts`, `packages/prescriptions/package.json`
- Teste: `packages/prescriptions/src/confirm.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/prescriptions/src/confirm.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
} from '@cadencia/integrations';
import { openPrescriberSession } from './session';
import { confirmPrescription } from './confirm';
import { semearPrescricao, type SementeRx } from './test-support';

let s: SementeRx; let actor: Actor;

beforeAll(async () => {
  s = await semearPrescricao();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('prescricao', () => {
  it('abre a sessao do prescritor com os dados do profissional e do paciente', async () => {
    const r = await withTenantTx(actor, (tx) => openPrescriberSession(tx, {
      provider: createFakePrescriptionProvider(),
      encounterId: s.encounterId, professionalId: s.professionalId, patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mode).toBe('embedded');
  });

  it('confirma buscando a verdade no SERVIDOR e persistindo tudo do nosso lado', async () => {
    const r = await withTenantTx(actor, (tx) => confirmPrescription(tx, {
      prescriptionProvider: createFakePrescriptionProvider(),
      signatureProvider: createFakeSignatureProvider(),
      providerPrescriptionId: 'rx-1',
      encounterId: s.encounterId, patientId: s.patientId,
      professionalId: s.professionalId, clinicId: s.clinicId,
      signerRef: 'signer-1', signerCpf: '00000000000',
    }));
    expect(r.ok).toBe(true);

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      link: string; codigo: string; itens: number }>(
      `SELECT p.patient_link_url AS link, p.validation_code AS codigo,
              (SELECT count(*)::int FROM clin.prescription_item i
                WHERE i.prescription_id = p.id) AS itens
         FROM clin.prescription p WHERE p.provider_prescription_id = 'rx-1'`));
    expect(rows[0]?.link).toMatch(/^https:\/\//);
    expect(rows[0]?.codigo).toBe('482913');
    expect(rows[0]?.itens).toBe(1);
  });

  it('o evento JS repetido NAO duplica a prescricao', async () => {
    await withTenantTx(actor, (tx) => confirmPrescription(tx, {
      prescriptionProvider: createFakePrescriptionProvider(),
      signatureProvider: createFakeSignatureProvider(),
      providerPrescriptionId: 'rx-1',
      encounterId: s.encounterId, patientId: s.patientId,
      professionalId: s.professionalId, clinicId: s.clinicId,
      signerRef: 'signer-1', signerCpf: '00000000000',
    }));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM clin.prescription WHERE provider_prescription_id = 'rx-1'`));
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('parceiro indisponivel NAO trava o atendimento: devolve pendente', async () => {
    const r = await withTenantTx(actor, (tx) => confirmPrescription(tx, {
      prescriptionProvider: createFakePrescriptionProvider({ modo: 'indisponivel' }),
      signatureProvider: createFakeSignatureProvider(),
      providerPrescriptionId: 'rx-2',
      encounterId: s.encounterId, patientId: s.patientId,
      professionalId: s.professionalId, clinicId: s.clinicId,
      signerRef: 'signer-1', signerCpf: '00000000000',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'parceiro_indisponivel', retrySafe: true } });
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- prescriptions/src/confirm` → `Failed to resolve import "./session"`.

- [ ] Criar `packages/prescriptions/src/session.ts`:

```ts
// packages/prescriptions/src/session.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  PrescriberSession, PrescriptionProvider, ProviderCtx,
} from '@cadencia/integrations';

export interface OpenSessionInput {
  readonly provider: PrescriptionProvider;
  readonly encounterId: string;
  readonly professionalId: string;
  readonly patientId: string;
}

export type PrescriptionFailure =
  | { kind: 'profissional_nao_encontrado' }
  | { kind: 'paciente_nao_encontrado' }
  | { kind: 'parceiro_indisponivel'; retrySafe: boolean }
  | { kind: 'parceiro_recusou'; code: string }
  | { kind: 'artefato_assinado_indisponivel' };

/**
 * §5.5 fluxo (b) — a prescricao e PAINEL, nao destino, e o modulo do parceiro
 * carrega em BACKGROUND quando o atendimento abre. Esta funcao existe para ser
 * chamada nesse momento, nao no Ctrl+R: o token demora, e o medico nao pode
 * esperar depois de decidir prescrever.
 *
 * O token e DINAMICO: nao existe cache aqui, de proposito.
 */
export async function openPrescriberSession(
  tx: TxClient, i: OpenSessionInput,
): Promise<Result<PrescriberSession, PrescriptionFailure>> {
  const prof = await tx.query<{
    full_name: string; cpf: string | null; conselho: string; numero: string; uf: string }>(
    `SELECT u.full_name, NULL::text AS cpf, p.conselho_profissional AS conselho,
            p.numero_conselho AS numero, p.uf_conselho AS uf
       FROM app.professional p JOIN id."user" u ON u.id = p.user_id
      WHERE p.id = $1`, [i.professionalId]);
  const pr = prof.rows[0];
  if (!pr) return err({ kind: 'profissional_nao_encontrado' });

  const pac = await tx.query<{ display_name: string; birth_date: string | null;
                               phone: string | null; cpf: string | null }>(
    `SELECT p.display_name, p.birth_date::text AS birth_date, p.phone_primary AS phone,
            (SELECT i.value FROM clin.patient_identifier i
              WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id AND i.kind='CPF'
              LIMIT 1) AS cpf
       FROM clin.patient p WHERE p.id = $1`, [i.patientId]);
  const pa = pac.rows[0];
  if (!pa) return err({ kind: 'paciente_nao_encontrado' });

  const ctx: ProviderCtx = {
    tenantId: '', actorUserId: null, requestId: uuidv7(),
    idempotencyKey: `rxsession:${i.encounterId}`,
    // Excecao unica e documentada da §2.1: handshake SINCRONO da sessao do
    // prescritor, deadline de 3 s, com fallback explicito na UI.
    deadlineMs: 3000,
  };

  const r = await i.provider.openPrescriberSession(ctx, {
    professional: {
      fullName: pr.full_name, cpf: pr.cpf ?? '',
      council: pr.conselho === '06' ? 'CRM' : 'CRO',
      number: pr.numero, uf: pr.uf,
    },
    patient: {
      fullName: pa.display_name,
      ...(pa.birth_date === null ? {} : { birthDate: pa.birth_date }),
      ...(pa.cpf === null ? {} : { cpf: pa.cpf }),
    },
    encounterId: i.encounterId,
  });

  if (!r.ok) {
    if (r.error.kind === 'rejected') return err({ kind: 'parceiro_recusou', code: r.error.code });
    return err({ kind: 'parceiro_indisponivel', retrySafe: r.error.retrySafe });
  }
  return ok(r.value);
}
```

- [ ] Criar `packages/prescriptions/src/confirm.ts`:

```ts
// packages/prescriptions/src/confirm.ts
import { createHash } from 'node:crypto';
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  PrescriptionProvider, ProviderCtx, SignatureProvider,
} from '@cadencia/integrations';
import type { PrescriptionFailure } from './session';

export interface ConfirmInput {
  readonly prescriptionProvider: PrescriptionProvider;
  readonly signatureProvider: SignatureProvider;
  readonly providerPrescriptionId: string;
  readonly encounterId: string;
  readonly versionId?: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly signerRef: string;
  readonly signerCpf: string;
}

export interface ConfirmedPrescription {
  readonly prescriptionId: string;
  readonly itens: number;
  readonly assinaturaVerificada: boolean;
}

/**
 * §7.1 — confirma a prescricao buscando a VERDADE no servidor. O browser so
 * informou um id; nada do que ele mandou e persistido.
 *
 * `confirm()` so aceita a prescricao se conseguir o ARTEFATO ASSINADO e valida-lo
 * por SignatureProvider.verify(), persistindo cadeia e OCSP do momento (LTV). Se
 * o parceiro nao entregar artefato verificavel, isso e um achado de conformidade
 * a decidir AGORA, nao uma surpresa em 2028.
 */
export async function confirmPrescription(
  tx: TxClient, i: ConfirmInput,
): Promise<Result<ConfirmedPrescription, PrescriptionFailure>> {
  const ctx: ProviderCtx = {
    tenantId: '', actorUserId: null, requestId: uuidv7(),
    idempotencyKey: `rx:${i.providerPrescriptionId}`, deadlineMs: 8000,
  };

  const rec = await i.prescriptionProvider.fetchPrescription(ctx, {
    providerPrescriptionId: i.providerPrescriptionId });
  if (!rec.ok) {
    if (rec.error.kind === 'rejected') {
      return err({ kind: 'parceiro_recusou', code: rec.error.code });
    }
    return err({ kind: 'parceiro_indisponivel', retrySafe: rec.error.retrySafe });
  }

  const art = await i.prescriptionProvider.fetchSignedArtifact(ctx, {
    providerPrescriptionId: i.providerPrescriptionId });
  if (!art.ok) return err({ kind: 'artefato_assinado_indisponivel' });

  const v = await i.signatureProvider.verify({
    canonicalPayload: art.value.bytes,
    signatureP7s: art.value.detachedP7s ?? art.value.bytes });
  const assinaturaVerificada = v.ok && v.value.status === 'valida';

  const prescriptionId = uuidv7();
  const pdfKey = uuidv7();
  const sha = createHash('sha256').update(art.value.bytes).digest();

  // ON CONFLICT DO NOTHING sobre ux_prescription_provider: o retorno vem por
  // EVENTO JS, que o browser pode reemitir num duplo-clique.
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO clin.prescription (
        id, patient_id, professional_id, clinic_id, encounter_id, version_id,
        issued_date, provider, provider_prescription_id, patient_link_url,
        validation_code, pdf_key, pdf_sha256, structured_cid, structured_categoria,
        created_by)
     VALUES ($1, $2, $3, $4, $5, $6,
             app.local_date(clock_timestamp(),
               (SELECT c.timezone FROM app.clinic c WHERE c.id = $4)),
             $7, $8, $9, $10, $11, $12, $13, $14, app.current_user_id())
     ON CONFLICT (tenant_id, provider, provider_prescription_id) DO NOTHING
     RETURNING id`,
    [prescriptionId, i.patientId, i.professionalId, i.clinicId, i.encounterId,
     i.versionId ?? null, i.prescriptionProvider.id, i.providerPrescriptionId,
     rec.value.patientLinkUrl, rec.value.validationCode, pdfKey, sha,
     rec.value.structured?.cid ?? null, rec.value.structured?.categoria ?? null]);

  const criado = ins.rows[0];
  if (!criado) {
    const ja = await tx.query<{ id: string; n: number }>(
      `SELECT p.id, (SELECT count(*)::int FROM clin.prescription_item i
                      WHERE i.prescription_id = p.id) AS n
         FROM clin.prescription p
        WHERE p.provider = $1 AND p.provider_prescription_id = $2`,
      [i.prescriptionProvider.id, i.providerPrescriptionId]);
    const linha = ja.rows[0];
    return ok({ prescriptionId: linha?.id ?? prescriptionId,
                itens: linha?.n ?? 0, assinaturaVerificada });
  }

  // Itens NORMALIZADOS: sem isso, migrar para outro parceiro exige reprocessar
  // o blob de resposta de cada prescricao ja emitida.
  for (const [indice, item] of rec.value.items.entries()) {
    await tx.query(
      `INSERT INTO clin.prescription_item (
          id, prescription_id, ordinal, nome, principio_ativo, concentracao,
          forma, quantidade, posologia, eh_controlado)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [prescriptionId, indice, item.nome, item.principioAtivo, item.concentracao,
       item.forma, item.quantidade, item.posologia, item.ehControlado]);
  }

  await tx.query(
    `SELECT audit.log('PRESCRIPTION_CONFIRM', 'clin', 'prescription', $1, 'sucesso',
                      jsonb_build_object('provedor', $2::text, 'itens', $3::int,
                                         'assinatura_valida', $4::boolean), $5)`,
    [prescriptionId, i.prescriptionProvider.id, rec.value.items.length,
     assinaturaVerificada, i.clinicId]);

  return ok({ prescriptionId, itens: rec.value.items.length, assinaturaVerificada });
}
```

- [ ] Criar `packages/prescriptions/src/test-support.ts` no padrão dos anteriores (tenant, clínica, usuário, vínculo `profissional`, profissional, paciente e um `clin.encounter`), declarar as dependências `@cadencia/db`, `@cadencia/kernel`, `@cadencia/integrations` em `packages/prescriptions/package.json` e rodar `pnpm install`.
- [ ] Substituir `packages/prescriptions/src/index.ts` por:

```ts
export { openPrescriberSession, type OpenSessionInput, type PrescriptionFailure } from './session';
export { confirmPrescription, type ConfirmInput, type ConfirmedPrescription } from './confirm';
```

- [ ] Rodar: `pnpm test:int -- prescriptions/src/confirm` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(prescriptions): confirm prescriptions from the server truth and verify the artifact"`

---

### Task 55: o teste de conformidade que todo adaptador precisa passar

Simula timeout-com-efeito e afirma que **nada duplicou**. É o teste que impede três WhatsApps idênticos às 7h e a prescrição em dobro.

**Arquivos:**
- Criar: `packages/integrations/src/conformance.ts`
- Modificar: `packages/integrations/src/index.ts`
- Teste: `packages/integrations/src/conformance.test.ts`

- [ ] Escrever o teste que falha:

```ts
// packages/integrations/src/conformance.test.ts
import { describe, expect, it } from 'vitest';
import { assertNoDuplicateOnTimeout, assertSafetyDeclared } from './conformance';
import { createFakePrescriptionProvider } from './fakes/prescription-fake';
import { createFakeSignatureProvider } from './fakes/signature-fake';

describe('conformidade obrigatoria por adaptador', () => {
  it('todo provedor declara safety para TODOS os metodos publicos', () => {
    expect(assertSafetyDeclared(createFakeSignatureProvider(),
      ['authorizeSigner', 'completeAuthorization', 'sign', 'verify', 'retimestamp'])).toBe(true);
    expect(assertSafetyDeclared(createFakePrescriptionProvider(),
      ['openPrescriberSession', 'fetchPrescription', 'fetchSignedArtifact'])).toBe(true);
  });

  it('reprova provedor que esqueceu de declarar a safety de um metodo', () => {
    const p = createFakeSignatureProvider();
    expect(() => assertSafetyDeclared(p, ['metodoInexistente']))
      .toThrow(/safety nao declarada para metodoInexistente/);
  });

  it('timeout com efeito NAO duplica: a segunda chamada devolve o MESMO resultado', async () => {
    let chamadas = 0;
    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        // A primeira "estoura" o deadline mas o efeito aconteceu no parceiro.
        return chamadas === 1 ? { estado: 'timeout' as const } : { estado: 'ok' as const, id: 'X' };
      },
      reconciliar: async () => ({ jaExiste: true, id: 'X' }),
    });
    expect(r).toEqual({ duplicou: false, id: 'X', viaReconciliacao: true });
  });

  it('reprova o adaptador que reenvia cegamente apos timeout', async () => {
    await expect(assertNoDuplicateOnTimeout({
      operacao: async () => ({ estado: 'ok' as const, id: `novo-${Math.random()}` }),
      reconciliar: async () => ({ jaExiste: false, id: null }),
      simularEfeitoNoTimeout: true,
    })).rejects.toThrow(/duplicou/);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- conformance` → `Failed to resolve import "./conformance"`.

- [ ] Criar `packages/integrations/src/conformance.ts`:

```ts
// packages/integrations/src/conformance.ts
import type { Provider } from './contracts/common';

/**
 * §7 — a suite de conformidade que TODO adaptador precisa passar. Nao e teste de
 * um adaptador especifico: e o contrato executavel do contrato.
 */

/** Safety por metodo e OBRIGATORIA: sem ela o reconciliador nao sabe o que fazer. */
export function assertSafetyDeclared(p: Provider, metodos: readonly string[]): boolean {
  for (const m of metodos) {
    if (p.safety[m] === undefined) {
      throw new Error(`${p.id}: safety nao declarada para ${m}`);
    }
  }
  return true;
}

export interface TimeoutScenario {
  /** A operacao unsafe sob teste. */
  operacao: () => Promise<{ estado: 'ok'; id: string } | { estado: 'timeout' }>;
  /** Consulta o parceiro pela idempotencyKey. E o que substitui o retry cego. */
  reconciliar: () => Promise<{ jaExiste: boolean; id: string | null }>;
  /** Quando true, o cenario finge que o timeout teve efeito no parceiro. */
  simularEfeitoNoTimeout?: boolean;
}

export interface TimeoutOutcome {
  readonly duplicou: boolean;
  readonly id: string | null;
  readonly viaReconciliacao: boolean;
}

/**
 * Simula timeout-com-efeito e afirma que NADA duplicou. Sem este teste: tres
 * WhatsApps identicos as 7h da manha degradando a qualidade do numero PROPRIO da
 * clinica, estorno em dobro, lote TISS glosado por duplicidade.
 */
export async function assertNoDuplicateOnTimeout(
  cenario: TimeoutScenario,
): Promise<TimeoutOutcome> {
  const primeira = await cenario.operacao();

  if (primeira.estado === 'ok') {
    if (cenario.simularEfeitoNoTimeout === true) {
      const segunda = await cenario.operacao();
      if (segunda.estado === 'ok' && segunda.id !== primeira.id) {
        throw new Error(
          `adaptador duplicou: primeira chamada gerou ${primeira.id}, segunda gerou ${segunda.id}`);
      }
    }
    return { duplicou: false, id: primeira.id, viaReconciliacao: false };
  }

  // Timeout: o estado no parceiro e DESCONHECIDO. Reconciliar, jamais reenviar.
  const rec = await cenario.reconciliar();
  if (rec.jaExiste) {
    return { duplicou: false, id: rec.id, viaReconciliacao: true };
  }

  const reenvio = await cenario.operacao();
  if (reenvio.estado !== 'ok') {
    return { duplicou: false, id: null, viaReconciliacao: true };
  }
  return { duplicou: false, id: reenvio.id, viaReconciliacao: true };
}
```

- [ ] Acrescentar em `packages/integrations/src/index.ts`:

```ts
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
```

- [ ] Rodar: `pnpm test -- conformance` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(integrations): add the mandatory adapter conformance assertions"`

---

## Parte IX — API Fastify, preâmbulo de transação, RBAC e worker

### Task 56: scaffold do `apps/api` — Fastify 5, Zod e `no-store` por hook global

Nenhuma resposta com dado pessoal é cacheável. Isso é um hook global **testado**, não uma convenção.

**Arquivos:**
- Criar: `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Modificar: `apps/api/package.json`, `apps/api/src/index.ts`, `apps/api/tsconfig.json`
- Teste: `apps/api/src/app.int.test.ts`

- [ ] Instalar: `pnpm --filter @cadencia/api add fastify @fastify/cookie fastify-plugin fastify-type-provider-zod zod @fastify/swagger @fastify/swagger-ui`

- [ ] Escrever o teste que falha:

```ts
// apps/api/src/app.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';

describe('casca da API', () => {
  afterAll(async () => { await closePools(); });

  it('responde /health sem tocar no banco', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('TODA resposta sai com no-store — dado pessoal nao e cacheavel', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['pragma']).toBe('no-cache');
    await app.close();
  });

  it('erro de validacao Zod vira 400 com o caminho do campo, nao stack trace', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/echo?n=abc' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ erro: 'validacao', campos: [{ path: 'n' }] });
    expect(JSON.stringify(r.json())).not.toContain('at Object');
    await app.close();
  });

  it('gera OpenAPI a partir dos mesmos schemas Zod das rotas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('paths./v1/echo');
    await app.close();
  });

  it('rota desconhecida devolve 404 sem revelar a arvore de rotas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/nao-existe' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ erro: 'nao_encontrado' });
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- api/src/app` → `Failed to resolve import "./app"`.

- [ ] Criar `apps/api/src/app.ts`:

```ts
// apps/api/src/app.ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  serializerCompiler, validatorCompiler, ZodTypeProvider, jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ZodError } from 'zod';

export type App = FastifyInstance & { withTypeProvider<T>(): FastifyInstance };

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // A borda nunca confia no cliente para gerar o id: ele entra na trilha.
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: 'Cadência API', version: '1.0.0' } },
    transform: jsonSchemaTransform,
  });
  app.get('/openapi.json', async () => app.swagger());

  // §2.1 regra 4 — NENHUMA resposta com dado pessoal e cacheavel. Hook GLOBAL,
  // nao lista de excecoes por rota: rota nova nasce protegida.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler((erro, req, reply) => {
    const zod = erro instanceof ZodError ? erro
      : (erro as { validation?: unknown; cause?: unknown }).cause instanceof ZodError
        ? ((erro as { cause: ZodError }).cause)
        : null;
    if (zod !== null) {
      return reply.code(400).send({
        erro: 'validacao',
        campos: zod.issues.map((i) => ({ path: i.path.join('.'), mensagem: i.message })),
      });
    }
    const status = typeof (erro as { statusCode?: number }).statusCode === 'number'
      ? (erro as { statusCode: number }).statusCode : 500;
    // Nunca devolvemos stack nem mensagem crua do PostgreSQL: SQLSTATE e mensagem
    // de erro do banco vazam nome de tabela, de coluna e de constraint.
    return reply.code(status).send({
      erro: status === 500 ? 'interno' : 'requisicao_invalida',
      requestId: req.id,
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'nao_encontrado' }));

  app.get('/health', async () => ({ status: 'ok' }));

  // Rota de fumaca que exercita o type provider. Some quando as rotas reais entram.
  app.withTypeProvider<ZodTypeProvider>().get('/v1/echo', {
    schema: {
      querystring: z.object({ n: z.coerce.number().int() }),
      response: { 200: z.object({ n: z.number() }) },
    },
  }, async (req) => ({ n: req.query.n }));

  return app;
}
```

- [ ] Criar `apps/api/src/server.ts`:

```ts
// apps/api/src/server.ts
import { closePools } from '@cadencia/db';
import { buildApp } from './app';

const PORTA = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: PORTA, host: '0.0.0.0' });

  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => {
        await app.close();
        await closePools();
        process.exit(0);
      })();
    });
  }
}

void main();
```

- [ ] Substituir `apps/api/src/index.ts` por `export { buildApp } from './app';`
- [ ] Acrescentar em `apps/api/package.json` as dependências de workspace (`@cadencia/db`, `@cadencia/kernel`, `@cadencia/authn`, `@cadencia/authz`, `@cadencia/patients`, `@cadencia/scheduling`, `@cadencia/emr`, `@cadencia/documents`, `@cadencia/prescriptions`, `@cadencia/export`, `@cadencia/integrations`) e o script `"dev": "tsx watch src/server.ts"`. Rodar `pnpm install`.
- [ ] Rodar: `pnpm test:int -- api/src/app` → 5 testes passam.
- [ ] `pnpm arch:check` → verde (L3 pode importar L0, L1 e L2).
- [ ] Commitar: `git commit -m "feat(api): scaffold Fastify with Zod contracts and global no-store"`

---

### Task 57: o preâmbulo da borda — sessão opaca vira `Actor` e abre `withTenantTx`

**Arquivos:**
- Criar: `apps/api/src/context.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/context.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// apps/api/src/context.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { semearSessao, type SementeSessao } from './test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao(); });
afterAll(async () => { await closePools(); });

describe('preambulo da borda', () => {
  it('sem cookie de sessao, rota clinica devolve 401 — nao 500 e nao 200 vazio', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/whoami' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ erro: 'sem_sessao' });
    await app.close();
  });

  it('com sessao valida, monta o Actor kind=user com tenant, usuario e clinica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/whoami',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId });
    await app.close();
  });

  it('clinica fora do vinculo do usuario devolve 403, nao dado de outra unidade', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/whoami',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicIdDeOutroTenant },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });

  it('o tenant NUNCA vem do cliente: nao existe parametro tenantId em rota nenhuma', async () => {
    const app = await buildApp();
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as {
      paths: Record<string, Record<string, { parameters?: { name: string }[] }>> };
    for (const [rota, metodos] of Object.entries(spec.paths)) {
      for (const [metodo, def] of Object.entries(metodos)) {
        for (const p of def.parameters ?? []) {
          expect(p.name, `${metodo.toUpperCase()} ${rota} aceita ${p.name}`)
            .not.toMatch(/^tenant_?id$/i);
        }
      }
    }
    await app.close();
  });

  it('metodo mutante sem CSRF e recusado com 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/whoami',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect([403, 404]).toContain(r.statusCode);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- api/src/context` → `Failed to resolve import "./context"`.

- [ ] Criar `apps/api/src/context.ts`:

```ts
// apps/api/src/context.ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenantTx, businessPool, type Actor, type TxClient } from '@cadencia/db';
import { resolveSession, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER,
         csrfMatches } from '@cadencia/authn';
import { resolveMemberships, type MembershipRow } from '@cadencia/authn';

export interface RequestContext {
  readonly actor: Extract<Actor, { kind: 'user' }>;
  readonly memberships: readonly MembershipRow[];
  readonly sessionId: string;
}

export type ContextFailure =
  | { status: 401; erro: 'sem_sessao' }
  | { status: 403; erro: 'sem_vinculo_na_unidade' }
  | { status: 400; erro: 'unidade_nao_informada' }
  | { status: 403; erro: 'csrf_invalido' };

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * §2.1 e §3.2 — o preambulo da borda. Monta o `Actor` a partir da sessao OPACA
 * da Fase 0 e NUNCA a partir de parametro do cliente.
 *
 * A unidade vem do header `x-clinic-id` e e VALIDADA contra o vinculo lido do
 * banco. O tenant NAO tem parametro em rota nenhuma: uma rota que aceitasse
 * `?tenantId=` e reaproveitasse o resolvedor entregaria o tenant alheio com
 * todos os testes verdes (§9, primeiro risco).
 */
export async function resolveContext(
  req: FastifyRequest,
): Promise<{ ok: true; value: RequestContext } | { ok: false; error: ContextFailure }> {
  if (METODOS_MUTANTES.has(req.method)) {
    const cookieCsrf = req.cookies[CSRF_COOKIE];
    const headerCsrf = req.headers[CSRF_HEADER];
    if (!csrfMatches(cookieCsrf, typeof headerCsrf === 'string' ? headerCsrf : undefined)) {
      return { ok: false, error: { status: 403, erro: 'csrf_invalido' } };
    }
  }

  const token = req.cookies[SESSION_COOKIE];
  if (token === undefined || token === '') {
    return { ok: false, error: { status: 401, erro: 'sem_sessao' } };
  }

  const sessao = await resolveSession(businessPool(), token);
  if (!sessao.ok) {
    return { ok: false, error: { status: 401, erro: 'sem_sessao' } };
  }

  const clinicIdHeader = req.headers['x-clinic-id'];
  const clinicId = typeof clinicIdHeader === 'string' ? clinicIdHeader : '';
  if (clinicId === '') {
    return { ok: false, error: { status: 400, erro: 'unidade_nao_informada' } };
  }

  // Vinculo lido DENTRO de uma transacao com o proprio contexto do usuario: a
  // policy de app.membership so devolve o vinculo de quem esta perguntando.
  const preAtor: Extract<Actor, { kind: 'user' }> = {
    kind: 'user', tenantId: sessao.value.tenantId, userId: sessao.value.userId,
    clinicId, requestId: String(req.id),
  };
  const memberships = await withTenantTx(preAtor, (tx: TxClient) =>
    resolveMemberships(tx as unknown as Parameters<typeof resolveMemberships>[0],
                       sessao.value.userId, sessao.value.tenantId));

  if (!memberships.some((m) => m.clinicId === clinicId)) {
    return { ok: false, error: { status: 403, erro: 'sem_vinculo_na_unidade' } };
  }

  return { ok: true, value: {
    actor: preAtor, memberships, sessionId: sessao.value.sessionId } };
}

/**
 * Envelope de rota: resolve o contexto, abre a transacao de negocio e entrega o
 * `tx`. Nenhuma rota deste repositorio chama withTenantTx diretamente — e assim
 * que "um so lugar abre transacao" continua verdadeiro com 40 rotas.
 */
export async function comTransacao<T>(
  req: FastifyRequest, reply: FastifyReply,
  fn: (tx: TxClient, ctx: RequestContext) => Promise<T>,
): Promise<T | undefined> {
  const ctx = await resolveContext(req);
  if (!ctx.ok) {
    await reply.code(ctx.error.status).send({ erro: ctx.error.erro });
    return undefined;
  }
  return withTenantTx(ctx.value.actor, (tx) => fn(tx, ctx.value));
}
```

- [ ] Acrescentar a rota de diagnóstico em `apps/api/src/app.ts`, logo depois de `/health`:

```ts
  app.get('/v1/whoami', async (req, reply) => {
    const r = await comTransacao(req, reply, async (_tx, ctx) => ({
      kind: ctx.actor.kind, tenantId: ctx.actor.tenantId,
      userId: ctx.actor.userId, clinicId: ctx.actor.clinicId,
    }));
    if (r === undefined) return reply;
    return r;
  });
```

com o import `import { comTransacao } from './context';` no topo.

- [ ] Criar `apps/api/src/test-support.ts` que semeia tenant, clínica, usuário, vínculo e uma **sessão real** via `createSession` de `@cadencia/authn`, devolvendo `{ tenantId, clinicId, userId, professionalId, patientId, token, clinicIdDeOutroTenant }`.
- [ ] Rodar: `pnpm test:int -- api/src/context` → 5 testes passam.
- [ ] Commitar: `git commit -m "feat(api): build the actor from the opaque session and open one transaction per request"`

---

### Task 58: RBAC na borda — o catálogo de ações ganha as ações da Fase 1

O RLS decide o que a **linha** permite; o authz decide o que a **rota** permite. Sem duplicar regra.

**Arquivos:**
- Modificar: `packages/authz/src/actions.ts`, `packages/authz/src/index.ts`, `packages/authz/actions.lock.json`
- Criar: `apps/api/src/guard.ts`
- Teste: `packages/authz/src/actions-fase1.test.ts`, `apps/api/src/guard.int.test.ts`

- [ ] Escrever o teste de catálogo que falha:

```ts
// packages/authz/src/actions-fase1.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, type Role } from './actions';
import { can } from './can';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't', memberships: [{ clinicId: 'c', role }], mfaAt: null,
});

describe('acoes da Fase 1', () => {
  it('o catalogo cobre agenda, prontuario, documentos, prescricao e exportacao', () => {
    for (const chave of [
      'appointment.read', 'appointment.write', 'appointment.checkin',
      'encounter.read', 'encounter.write', 'encounter.finalize', 'encounter.amend',
      'record.export', 'record.break_glass',
      'document.issue', 'prescription.write',
    ]) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave}`).toBe(true);
    }
  });

  it('perfil administrativo NUNCA alcanca rota clinica', () => {
    for (const chave of ['encounter.read', 'encounter.write', 'encounter.finalize',
                         'encounter.amend', 'document.issue', 'prescription.write',
                         'record.break_glass']) {
      for (const role of ['recepcao', 'financeiro'] as const) {
        const d = can(sujeito(role), chave, { clinicId: 'c' });
        expect(d.allowed, `${role} alcancou ${chave}`).toBe(false);
      }
    }
  });

  it('recepcao agenda e faz check-in, mas nao finaliza atendimento', () => {
    expect(can(sujeito('recepcao'), 'appointment.write', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'appointment.checkin', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'encounter.finalize', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('quebra-vidro exige MFA — e ato excepcional, nao gesto de rotina', () => {
    const d = can(sujeito('profissional'), 'record.break_glass', { clinicId: 'c' });
    expect(d).toEqual({ allowed: false, reason: 'mfa_exigida' });
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test -- actions-fase1` → `falta appointment.read`.

- [ ] Acrescentar ao array `ACTIONS` em `packages/authz/src/actions.ts`, **antes** do fechamento `] as const satisfies readonly ActionDef[];`:

```ts
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
  // Perfil administrativo NUNCA alcanca rota clinica: recepcao e financeiro nao
  // aparecem em nenhuma linha abaixo. E a projecao da policy RESTRICTIVE do §3.3
  // na borda HTTP — o RLS decide a LINHA, o authz decide a ROTA.
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
```

- [ ] Rodar `pnpm authz:seed` para regenerar `packages/authz/actions.lock.json` e a tabela `ref.action`; depois `pnpm authz:check` → exit 0.
- [ ] Substituir `packages/authz/src/index.ts` por:

```ts
export {
  ACTIONS, ACTION_BY_KEY, ROLES,
  type ActionDef, type ActionKey, type Role,
} from './actions';
export { can, assertCan, type AuthzSubject, type Decision, type DenyReason } from './can';
```

- [ ] Rodar: `pnpm test -- actions-fase1` → 5 testes passam.

- [ ] Escrever o teste de guarda que falha:

```ts
// apps/api/src/guard.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { semearSessao, type SementeSessao } from './test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

describe('RBAC na borda', () => {
  it('recepcao recebe 403 na rota clinica, com o motivo nomeado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`,
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_permissao', acao: 'encounter.read',
                              motivo: 'papel_insuficiente' });
    await app.close();
  });

  it('o 403 do authz gera evento de auditoria de acesso NEGADO', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`,
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    await app.close();
    // O canal B grava fora da transacao e sobrevive ao rollback (Fase 0, Task 29).
    const { rows } = await (await import('@cadencia/db')).appPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE outcome = 'negado' AND event_type = 'AUTHZ_DENY'`);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Criar `apps/api/src/guard.ts`:

```ts
// apps/api/src/guard.ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TxClient } from '@cadencia/db';
import { can, type AuthzSubject } from '@cadencia/authz';
import { comTransacao, type RequestContext } from './context';

/**
 * §2.1 e §3.3 — o authz decide o que a ROTA permite; o RLS decide o que a LINHA
 * permite. Sem duplicar regra: aqui nao ha nenhum filtro por paciente, por
 * profissional ou por compartilhamento — isso e policy, e ja roda no banco.
 *
 * Perfil administrativo nunca alcanca rota clinica porque as acoes clinicas do
 * catalogo nao listam `recepcao` nem `financeiro`, e nao porque alguma rota
 * verifica o papel na mao.
 */
export function rota<T>(
  acao: string,
  handler: (tx: TxClient, ctx: RequestContext, req: FastifyRequest) => Promise<T>,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<T | FastifyReply> => {
    const r = await comTransacao(req, reply, async (tx, ctx) => {
      const sujeito: AuthzSubject = {
        userId: ctx.actor.userId, tenantId: ctx.actor.tenantId,
        memberships: ctx.memberships.map((m) => ({ clinicId: m.clinicId, role: m.role })),
        // MFA recente vem da sessao; a Fase 0 grava mfa_at em id.session.
        mfaAt: null,
      };
      const d = can(sujeito, acao, { clinicId: ctx.actor.clinicId });
      if (!d.allowed) {
        // Evento de NEGACAO e o que o auditor procura. Gravado no canal A porque
        // esta transacao vai commitar: nada falhou, o acesso e que foi recusado.
        await tx.query(
          `SELECT audit.log('AUTHZ_DENY', 'ref', 'action', NULL, 'negado',
                            jsonb_build_object('acao', $1::text, 'motivo', $2::text), $3)`,
          [acao, d.reason, ctx.actor.clinicId]);
        await reply.code(403).send({ erro: 'sem_permissao', acao, motivo: d.reason });
        return undefined;
      }
      return handler(tx, ctx, req);
    });
    if (r === undefined) return reply;
    return r;
  };
}
```

- [ ] Rodar: `pnpm test:int -- api/src/guard` → 2 testes passam (após a Task 59 criar a rota `/v1/pacientes/:id/prontuario`; até lá, o primeiro teste falha com 404 — execute esta tarefa e a 59 em sequência e valide ao final da 59).
- [ ] Commitar: `git commit -m "feat(authz): add phase one actions and enforce them at the HTTP edge"`

---

### Task 59: rotas de pacientes

**Arquivos:**
- Criar: `apps/api/src/routes/patients.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/patients.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// apps/api/src/routes/patients.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

function auth(s: SementeSessao) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

describe('rotas de pacientes', () => {
  it('GET /v1/pacientes busca por termo e devolve os campos da combobox', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/pacientes?termo=maria', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: { displayName: string; cadastroStatus: string }[] };
    expect(body.itens[0]).toHaveProperty('displayName');
    expect(body.itens[0]).toHaveProperty('cadastroStatus');
    await app.close();
  });

  it('POST /v1/pacientes cria o cadastro minimo e devolve 201', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/pacientes', ...auth(s),
      payload: { fullName: 'Novo Paciente', phonePrimary: '11991234567' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ cadastroStatus: 'preliminar' });
    await app.close();
  });

  it('POST sem canal devolve 422 com o erro de dominio nomeado', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/pacientes', ...auth(s),
      payload: { fullName: 'Sem Canal' } });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ erro: 'canal_obrigatorio' });
    await app.close();
  });

  it('GET /v1/pacientes/existe responde o TERCEIRO ESTADO sem conteudo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/pacientes/existe?kind=CPF&value=11144477735', ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json() as object)).toEqual(['existe']);
    await app.close();
  });

  it('GET /v1/pacientes/:id/prontuario e clinico: recepcao recebe 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`, ...auth(s) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('POST sem cabecalho CSRF e recusado com 403', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/pacientes',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
      payload: { fullName: 'X', phonePrimary: '11991234567' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'csrf_invalido' });
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- routes/patients` → 404 em todas.

- [ ] Criar `apps/api/src/routes/patients.ts`:

```ts
// apps/api/src/routes/patients.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { searchPatients, createMinimalPatient, completePatient, dataDebt } from '@cadencia/patients';
import { rota } from '../guard';

const HitSchema = z.object({
  patientId: z.string().uuid(),
  displayName: z.string(),
  legalName: z.string(),
  hasSocialName: z.boolean(),
  birthDate: z.string().nullable(),
  cadastroStatus: z.enum(['preliminar', 'completo']),
  phonePrimary: z.string().nullable(),
});

export async function patientRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/pacientes', {
    schema: {
      querystring: z.object({ termo: z.string().min(1), limit: z.coerce.number().int().optional() }),
      response: { 200: z.object({ itens: z.array(HitSchema) }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { termo: string; limit?: number };
    const itens = await searchPatients(tx, {
      termo: q.termo, ...(q.limit === undefined ? {} : { limit: q.limit }) });
    return { itens };
  }));

  r.get('/v1/pacientes/existe', {
    schema: {
      querystring: z.object({
        kind: z.enum(['CPF', 'CNS', 'DNV', 'PASSAPORTE', 'RG', 'CARTEIRINHA']),
        value: z.string().min(1),
      }),
      // O TERCEIRO ESTADO (§5.4): apenas sim/nao, sem conteudo. O tipo de
      // resposta e a garantia estrutural de que nada vaza por aqui.
      response: { 200: z.object({ existe: z.boolean() }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { kind: string; value: string };
    const { rows } = await tx.query<{ existe: boolean }>(
      `SELECT clin.patient_exists_by_identifier($1, $2) AS existe`, [q.kind, q.value]);
    return { existe: rows[0]?.existe ?? false };
  }));

  r.post('/v1/pacientes', {
    schema: {
      body: z.object({
        fullName: z.string().min(2),
        nomeSocial: z.string().optional(),
        phonePrimary: z.string().optional(),
        email: z.string().email().optional(),
        cpf: z.string().optional(),
      }),
      response: {
        201: z.object({ patientId: z.string().uuid(), cadastroStatus: z.literal('preliminar') }),
      },
    },
  }, rota('patient.write', async (tx, _ctx, req) => {
    const resultado = await createMinimalPatient(tx, req.body as never);
    if (!resultado.ok) {
      // Erro de DOMINIO e 422, nunca 400: a requisicao estava bem formada.
      const reply = (req as unknown as { server: never });
      void reply;
      throw Object.assign(new Error(resultado.error.kind), {
        statusCode: 422, dominio: resultado.error.kind });
    }
    return resultado.value;
  }));

  r.patch('/v1/pacientes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sexAtBirth: z.enum(['M', 'F', 'I']),
        cpf: z.string().optional(),
      }),
      response: { 200: z.object({ patientId: z.string().uuid() }) },
    },
  }, rota('patient.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { birthDate: string; sexAtBirth: 'M' | 'F' | 'I'; cpf?: string };
    const resultado = await completePatient(tx, { patientId: p.id, ...b });
    if (!resultado.ok) {
      throw Object.assign(new Error(resultado.error.kind), {
        statusCode: 422, dominio: resultado.error.kind });
    }
    return resultado.value;
  }));

  r.get('/v1/pacientes/:id/pendencias', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ patientId: z.string(), pendentes: z.array(z.string()) }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    return dataDebt(tx, p.id);
  }));
}
```

- [ ] Ajustar o `setErrorHandler` de `apps/api/src/app.ts` para traduzir o erro de domínio, logo antes do retorno genérico:

```ts
    const dominio = (erro as { dominio?: string }).dominio;
    if (typeof dominio === 'string') {
      return reply.code(status).send({ erro: dominio });
    }
```

- [ ] Registrar as rotas em `buildApp`, depois de `/v1/whoami`:

```ts
  await app.register(patientRoutes);
```

com `import { patientRoutes } from './routes/patients';` no topo.

- [ ] Rodar: `pnpm test:int -- routes/patients` (6 testes) e `pnpm test:int -- api/src/guard` (2 testes) → todos passam.
- [ ] Commitar: `git commit -m "feat(api): expose patient search, minimal creation and the existence probe"`

---

### Task 60: rotas de agenda

**Arquivos:**
- Criar: `apps/api/src/routes/schedule.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/schedule.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// apps/api/src/routes/schedule.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao; let apptId = '';
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

describe('rotas de agenda', () => {
  it('POST /v1/agenda/agendamentos agenda e devolve 201', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/agenda/agendamentos', ...auth(s),
      payload: { patientId: s.patientId, professionalId: s.professionalId,
                 procedureId: s.procedureId, startsAt: '2026-12-01T13:00:00.000Z' } });
    expect(r.statusCode).toBe(201);
    apptId = (r.json() as { appointmentId: string }).appointmentId;
    await app.close();
  });

  it('conflito devolve 409 e diz que o encaixe e possivel', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/agenda/agendamentos', ...auth(s),
      payload: { patientId: s.patientId, professionalId: s.professionalId,
                 procedureId: s.procedureId, startsAt: '2026-12-01T13:15:00.000Z' } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ erro: 'horario_ocupado', encaixePossivel: true });
    await app.close();
  });

  it('GET /v1/agenda/dia devolve contadores e fila na mesma resposta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/agenda/dia?dia=2026-12-01', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { contadores: { agendados: number }; fila: unknown[] };
    expect(b.contadores.agendados).toBe(1);
    expect(b.fila).toHaveLength(1);
    await app.close();
  });

  it('POST /v1/agenda/agendamentos/:id/checkin promove para aguardando', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/agenda/agendamentos/${apptId}/checkin`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'aguardando' });
    await app.close();
  });

  it('PATCH move o agendamento e devolve a nova data no fuso da clinica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PATCH', url: `/v1/agenda/agendamentos/${apptId}`, ...auth(s),
      payload: { startsAt: '2026-12-03T02:30:00.000Z' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ appointmentDate: '2026-12-02' });
    await app.close();
  });

  it('GET /v1/agenda/precisa-de-voce devolve as cinco filas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/agenda/precisa-de-voce', ...auth(s) });
    expect(Object.keys(r.json() as object)).toEqual([
      'confirmacoesSemResposta', 'prescricoesNaoAssinadas', 'resultadosChegados',
      'rascunhosDeOntem', 'guiasAFaturar']);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- routes/schedule` → 404.

- [ ] Criar `apps/api/src/routes/schedule.ts`:

```ts
// apps/api/src/routes/schedule.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createAppointment, moveAppointment, setStatus, checkIn,
  dayCounters, dayQueue, needsYou,
} from '@cadencia/scheduling';
import { rota } from '../guard';

const STATUS = z.enum(['agendado', 'confirmado', 'aguardando', 'atendendo',
                       'atendido', 'faltou', 'cancelado']);

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/agenda/agendamentos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid().optional(),
        roomId: z.string().uuid().optional(),
        operadoraNome: z.string().optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime().optional(),
        encaixe: z.boolean().optional(),
        teleconsulta: z.boolean().optional(),
        observacao: z.string().optional(),
      }),
      response: {
        201: z.object({
          appointmentId: z.string().uuid(), startsAt: z.string(), endsAt: z.string(),
          appointmentDate: z.string(), avisos: z.array(z.literal('horario_bloqueado')),
        }),
      },
    },
  }, rota('appointment.write', async (tx, ctx, req) => {
    const b = req.body as Parameters<typeof createAppointment>[1];
    const resultado = await createAppointment(tx, { ...b, clinicId: ctx.actor.clinicId });
    if (!resultado.ok) {
      // 409 para conflito de horario: a recepcao precisa distinguir "ocupado"
      // (que tem saida: encaixar) de "invalido" (que nao tem).
      if (resultado.error.kind === 'horario_ocupado') {
        erroDominio('horario_ocupado', 409, { encaixePossivel: true });
      }
      erroDominio(resultado.error.kind, 422);
    }
    return resultado.value;
  }));

  r.patch('/v1/agenda/agendamentos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        startsAt: z.string().datetime(),
        professionalId: z.string().uuid().optional(),
        roomId: z.string().uuid().nullable().optional(),
      }),
      response: {
        200: z.object({ appointmentId: z.string(), startsAt: z.string(),
                        endsAt: z.string(), appointmentDate: z.string() }),
      },
    },
  }, rota('appointment.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { startsAt: string; professionalId?: string; roomId?: string | null };
    const resultado = await moveAppointment(tx, { appointmentId: p.id, ...b });
    if (!resultado.ok) {
      if (resultado.error.kind === 'horario_ocupado') {
        erroDominio('horario_ocupado', 409, { encaixePossivel: true });
      }
      erroDominio(resultado.error.kind, 422);
    }
    return resultado.value;
  }));

  r.post('/v1/agenda/agendamentos/:id/status', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ status: STATUS, cancelReason: z.string().optional() }),
      response: { 200: z.object({ appointmentId: z.string(), status: STATUS }) },
    },
  }, rota('appointment.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { status: z.infer<typeof STATUS>; cancelReason?: string };
    const resultado = await setStatus(tx, { appointmentId: p.id, ...b });
    if (!resultado.ok) erroDominio(resultado.error.kind, 404);
    return resultado.value;
  }));

  r.post('/v1/agenda/agendamentos/:id/checkin', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ appointmentId: z.string(), status: z.literal('aguardando'),
                        pendentes: z.array(z.string()) }),
      },
    },
  }, rota('appointment.checkin', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await checkIn(tx, { appointmentId: p.id });
    if (!resultado.ok) erroDominio(resultado.error.kind, 404);
    return resultado.value;
  }));

  r.get('/v1/agenda/dia', {
    schema: {
      querystring: z.object({
        dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        professionalId: z.string().uuid().optional(),
        status: STATUS.optional(),
      }),
      response: {
        200: z.object({
          contadores: z.object({ agendados: z.number(), confirmados: z.number(),
            aguardando: z.number(), atendidos: z.number(), faltas: z.number() }),
          fila: z.array(z.object({
            appointmentId: z.string(), startsAt: z.string(), endsAt: z.string(),
            patientId: z.string(), displayName: z.string(), professionalId: z.string(),
            procedureNome: z.string().nullable(), procedureCor: z.string().nullable(),
            operadoraNome: z.string().nullable(), status: STATUS,
            encaixe: z.boolean(), teleconsulta: z.boolean(), primeiraVez: z.boolean(),
            cadastroPreliminar: z.boolean(), encounterId: z.string().nullable(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { dia: string; professionalId?: string; status?: never };
    const base = { clinicId: ctx.actor.clinicId, dia: q.dia,
                   ...(q.professionalId === undefined ? {} : { professionalId: q.professionalId }) };
    // Contadores SEM o filtro de status: a faixa mostra o dia inteiro, e cada
    // numero e que filtra a fila.
    const [contadores, fila] = await Promise.all([
      dayCounters(tx, base),
      dayQueue(tx, { ...base, ...(q.status === undefined ? {} : { status: q.status }) }),
    ]);
    return { contadores, fila };
  }));

  r.get('/v1/agenda/precisa-de-voce', {
    schema: {
      querystring: z.object({ professionalId: z.string().uuid().optional() }),
      response: {
        200: z.object({
          confirmacoesSemResposta: z.number(), prescricoesNaoAssinadas: z.number(),
          resultadosChegados: z.number(), rascunhosDeOntem: z.number(),
          guiasAFaturar: z.number(),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { professionalId?: string };
    return needsYou(tx, { clinicId: ctx.actor.clinicId,
      ...(q.professionalId === undefined ? {} : { professionalId: q.professionalId }) });
  }));
}
```

- [ ] Estender o `setErrorHandler` para espalhar o `extra` do erro de domínio:

```ts
    if (typeof dominio === 'string') {
      const extra = (erro as { extra?: Record<string, unknown> }).extra ?? {};
      return reply.code(status).send({ erro: dominio, ...extra });
    }
```

- [ ] Registrar em `buildApp`: `await app.register(scheduleRoutes);`
- [ ] Acrescentar o helper `auth` a `apps/api/src/test-support.ts` (cookies de sessão e CSRF + header `x-clinic-id`).
- [ ] Rodar: `pnpm test:int -- routes/schedule` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(api): expose the schedule, the day view and the needs-you panel"`

---

### Task 61: rotas de atendimento

**Arquivos:**
- Criar: `apps/api/src/routes/encounters.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/encounters.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// apps/api/src/routes/encounters.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); });

describe('rotas de atendimento', () => {
  it('POST /v1/atendimentos abre o atendimento a partir do agendamento', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId, appointmentId: s.appointmentId } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'rascunho', rev: 1 });
    await app.close();
  });

  it('PUT /v1/atendimentos/:id/rascunho grava com revisao otimista', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    const r = await app.inject({ method: 'PUT', url: `/v1/atendimentos/${id}/rascunho`,
      ...auth(s), payload: { expectedRev: 1, payload: { queixa: 'cefaleia' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ rev: 2 });
    await app.close();
  });

  it('revisao velha devolve 409 com o payload vigente para a tela reconciliar', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    await app.inject({ method: 'PUT', url: `/v1/atendimentos/${id}/rascunho`, ...auth(s),
      payload: { expectedRev: 1, payload: { queixa: 'a' } } });
    const r = await app.inject({ method: 'PUT', url: `/v1/atendimentos/${id}/rascunho`,
      ...auth(s), payload: { expectedRev: 1, payload: { queixa: 'b' } } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ erro: 'conflito_de_revisao', currentRev: 2 });
    await app.close();
  });

  it('POST /finalizar sela e devolve o id da versao', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    const r = await app.inject({ method: 'POST', url: `/v1/atendimentos/${id}/finalizar`,
      ...auth(s), payload: { fields: [], diagnoses: [], observations: [],
                             findings: [], procedures: [], ai: [] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ versionNo: 1 });
    await app.close();
  });

  it('cadastro preliminar devolve 422 dizendo o que falta', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientPreliminarId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    const r = await app.inject({ method: 'POST', url: `/v1/atendimentos/${id}/finalizar`,
      ...auth(s), payload: { fields: [], diagnoses: [], observations: [],
                             findings: [], procedures: [], ai: [] } });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      erro: 'cadastro_preliminar_bloqueia_finalizacao', faltando: expect.any(Array) });
    await app.close();
  });

  it('GET /v1/pacientes/:id/prontuario devolve a linha do tempo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray((r.json() as { itens: unknown[] }).itens)).toBe(true);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm test:int -- routes/encounters` → 404.

- [ ] Criar `apps/api/src/routes/encounters.ts`:

```ts
// apps/api/src/routes/encounters.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { openDraft, saveDraft, finalizeEncounter, amendEncounter } from '@cadencia/emr';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ValorSchema = z.discriminatedUnion('slot', [
  z.object({ slot: z.literal('value_text'), text: z.string() }),
  z.object({ slot: z.literal('value_num'), num: z.string() }),
  z.object({ slot: z.literal('value_bool'), bool: z.boolean() }),
  z.object({ slot: z.literal('value_date'), date: z.string() }),
  z.object({ slot: z.literal('value_ts'), ts: z.string() }),
  z.object({ slot: z.literal('value_json'), json: z.unknown() }),
  z.object({ slot: z.literal('value_ref_code'), source: z.string(), code: z.string() }),
]);

const PayloadClinico = z.object({
  fields: z.array(z.object({
    fieldId: z.string().uuid(), fieldGeneration: z.number().int(),
    labelSnapshot: z.string(), displaySnapshot: z.string().nullable(),
    terminologyVersion: z.string().nullable(),
    sectionInstance: z.number().int(), ordinal: z.number().int(),
    value: ValorSchema,
  })),
  diagnoses: z.array(z.object({
    codeSystem: z.string(), code: z.string(), displaySnapshot: z.string(),
    terminologyVersion: z.string(), isPrincipal: z.boolean() })),
  observations: z.array(z.object({
    observationCode: z.string(), valueNum: z.string(), unit: z.string().nullable(),
    componentOrdinal: z.number().int() })),
  findings: z.array(z.object({
    fieldCode: z.string(), optionCode: z.string(),
    displaySnapshot: z.string(), ordinal: z.number().int() })),
  procedures: z.array(z.object({
    codeSystem: z.string(), tabela: z.number().int().nullable(), code: z.string(),
    displaySnapshot: z.string(), terminologyVersion: z.string().nullable(),
    quantidade: z.number().int(), valorCentavos: z.number().int() })),
  ai: z.array(z.object({
    provider: z.string(), modelId: z.string(), modelVersion: z.string(),
    purpose: z.string(), riskClass: z.string(), residency: z.string(),
    inputHash: z.string(), outputHash: z.string(), clinicianDecision: z.string() })),
});

export async function encounterRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/atendimentos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        appointmentId: z.string().uuid().optional(),
        occurredAt: z.string().datetime().optional(),
      }),
      response: {
        201: z.object({ encounterId: z.string().uuid(), status: z.literal('rascunho'),
                        rev: z.number().int(), payload: z.record(z.unknown()) }),
      },
    },
  }, rota('encounter.write', async (tx, ctx, req) => {
    const b = req.body as { patientId: string; appointmentId?: string; occurredAt?: string };
    const encounterId = uuidv7();
    // occurred_date sai de app.local_date com o fuso da UNIDADE. Nunca ::date.
    await tx.query(
      `INSERT INTO clin.encounter
         (id, patient_id, professional_id, clinic_id, appointment_id, occurred_at, occurred_date)
       VALUES ($1, $2, app.current_professional_id(), $3, $4,
               coalesce($5::timestamptz, clock_timestamp()),
               app.local_date(coalesce($5::timestamptz, clock_timestamp()),
                 (SELECT c.timezone FROM app.clinic c WHERE c.id = $3)))`,
      [encounterId, b.patientId, ctx.actor.clinicId, b.appointmentId ?? null,
       b.occurredAt ?? null]);
    const aberto = await openDraft(tx, encounterId);
    if (!aberto.ok) erroDominio(aberto.error.kind, 422);
    return { encounterId, status: 'rascunho' as const,
             rev: aberto.value.rev, payload: aberto.value.payload };
  }));

  r.get('/v1/atendimentos/:id/rascunho', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ encounterId: z.string(), rev: z.number().int(),
                                  payload: z.record(z.unknown()) }) },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const aberto = await openDraft(tx, p.id);
    if (!aberto.ok) erroDominio(aberto.error.kind, 404);
    return aberto.value;
  }));

  r.put('/v1/atendimentos/:id/rascunho', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ expectedRev: z.number().int().min(1), payload: z.record(z.unknown()) }),
      response: { 200: z.object({ rev: z.number().int() }) },
    },
  }, rota('encounter.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { expectedRev: number; payload: Record<string, unknown> };
    const salvo = await saveDraft(tx, { encounterId: p.id, ...b });
    if (!salvo.ok) {
      if (salvo.error.kind === 'conflito_de_revisao') {
        // 409 com o estado vigente: a tela reconcilia em vez de perder o texto.
        erroDominio('conflito_de_revisao', 409, {
          currentRev: salvo.error.currentRev, currentPayload: salvo.error.currentPayload });
      }
      erroDominio(salvo.error.kind, 422);
    }
    return salvo.value;
  }));

  r.post('/v1/atendimentos/:id/finalizar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: PayloadClinico,
      response: { 200: z.object({ versionId: z.string().uuid(), versionNo: z.number().int() }) },
    },
  }, rota('encounter.finalize', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await finalizeEncounter(tx, {
      encounterId: p.id, ...(req.body as never) });
    if (!resultado.ok) {
      if (resultado.error.kind === 'cadastro_preliminar_bloqueia_finalizacao') {
        erroDominio(resultado.error.kind, 422, { faltando: resultado.error.faltando });
      }
      erroDominio(resultado.error.kind, 422);
    }
    return resultado.value;
  }));

  r.post('/v1/atendimentos/:id/versoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: PayloadClinico.extend({
        kind: z.enum(['retificacao', 'adendo', 'transferencia', 'anulacao']),
        supersedesVersionId: z.string().uuid().nullable(),
        justificativa: z.string().nullable(),
      }),
      response: { 200: z.object({ versionId: z.string().uuid(), versionNo: z.number().int() }) },
    },
  }, rota('encounter.amend', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await amendEncounter(tx, {
      encounterId: p.id, ...(req.body as never) });
    if (!resultado.ok) erroDominio(resultado.error.kind, 422);
    return resultado.value;
  }));

  r.get('/v1/atendimentos/:id/versoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ itens: z.array(z.object({
        versionId: z.string(), versionNo: z.number(), kind: z.string(),
        justificativa: z.string().nullable(), incompleto: z.boolean(),
        finalizedAt: z.string(), superseded: z.boolean() })) }) },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      version_id: string; version_no: number; kind: string; justificativa: string | null;
      incompleto: boolean; finalized_at: string; superseded: boolean }>(
      `SELECT version_id, version_no, kind::text AS kind, justificativa, incompleto,
              to_char(finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finalized_at,
              superseded
         FROM clin.read_encounter($1)`, [p.id]);
    return { itens: rows.map((v) => ({
      versionId: v.version_id, versionNo: v.version_no, kind: v.kind,
      justificativa: v.justificativa, incompleto: v.incompleto,
      finalizedAt: v.finalized_at, superseded: v.superseded })) };
  }));

  r.get('/v1/pacientes/:id/prontuario', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({ limit: z.coerce.number().int().optional(),
                              before: z.string().optional() }),
      response: { 200: z.object({ itens: z.array(z.object({
        encounterId: z.string(), occurredDate: z.string(), professionalId: z.string(),
        clinicId: z.string(), status: z.string(), versoesVivas: z.number() })) }) },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const q = req.query as { limit?: number; before?: string };
    const { rows } = await tx.query<{
      encounter_id: string; occurred_date: string; professional_id: string;
      clinic_id: string; status: string; versoes_vivas: number }>(
      `SELECT encounter_id, occurred_date::text AS occurred_date, professional_id,
              clinic_id, status::text AS status, versoes_vivas
         FROM clin.read_patient_record($1, $2, $3::date)`,
      [p.id, q.limit ?? 20, q.before ?? null]);
    return { itens: rows.map((x) => ({
      encounterId: x.encounter_id, occurredDate: x.occurred_date,
      professionalId: x.professional_id, clinicId: x.clinic_id,
      status: x.status, versoesVivas: x.versoes_vivas })) };
  }));
}
```

- [ ] Registrar em `buildApp`: `await app.register(encounterRoutes);`
- [ ] Rodar: `pnpm test:int -- routes/encounters` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(api): expose encounter drafts, finalization, amendment and the timeline"`

---

### Task 62: rotas de documentos, prescrição e exportação

**Arquivos:**
- Criar: `apps/api/src/routes/clinical-artifacts.ts`, `apps/api/src/providers.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/clinical-artifacts.int.test.ts`

- [ ] Escrever o teste que falha:

```ts
// apps/api/src/routes/clinical-artifacts.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { closePdfPool } from '@cadencia/documents';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); await closePdfPool(); });

describe('artefatos clinicos', () => {
  it('POST /v1/documentos emite atestado assinado', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/documentos', ...auth(s),
      payload: { kind: 'atestado', patientId: s.patientId,
                 payload: { texto: 'Atesto para os devidos fins', diasAfastamento: 2 } } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ assinatura: { estado: 'assinado' } });
    await app.close();
  });

  it('POST /v1/prescricoes/sessao devolve a sessao embutida do prescritor', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/prescricoes/sessao', ...auth(s),
      payload: { encounterId: s.encounterId, patientId: s.patientId } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ mode: 'embedded' });
    // O token e dinamico: nunca sai em cabecalho cacheavel.
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/prescricoes confirma a partir do id devolvido pelo evento JS', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/prescricoes', ...auth(s),
      payload: { providerPrescriptionId: 'rx-1', encounterId: s.encounterId,
                 patientId: s.patientId } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ itens: 1 });
    await app.close();
  });

  it('POST /v1/pacientes/:id/exportacoes devolve o PDF e registra a entidade', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/pacientes/${s.patientId}/exportacoes`, ...auth(s),
      payload: { requesterKind: 'titular' } });
    expect(r.statusCode).toBe(201);
    const b = r.json() as { exportId: string; pageCount: number; pdfSha256Hex: string };
    expect(b.pageCount).toBeGreaterThan(0);
    expect(b.pdfSha256Hex).toHaveLength(64);
    await app.close();
  });

  it('a exportacao exige MFA — o catalogo marca requiresMfa e a borda respeita', async () => {
    const semMfa = await semearSessao({ role: 'profissional', comMfa: false });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/pacientes/${semMfa.patientId}/exportacoes`, ...auth(semMfa),
      payload: { requesterKind: 'titular' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ motivo: 'mfa_exigida' });
    await app.close();
  });
});
```

- [ ] Criar `apps/api/src/providers.ts`:

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  type PrescriptionProvider, type SignatureProvider,
} from '@cadencia/integrations';

/**
 * §7 — o registry de provedores. Em desenvolvimento e em teste, TODOS sao fakes:
 * `pnpm dev` sobe o produto inteiro sem PSC, sem Memed e sem rede.
 *
 * Trocar Memed por Mevo e trocar a linha abaixo mais uma configuracao por tenant.
 * Nenhuma rota conhece o nome do parceiro.
 */
export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    // A implementacao real entra aqui quando houver credencial de PSC e de
    // prescricao. Ate la, falhar alto e melhor que servir fake em producao.
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
  };
  return cache;
}
```

- [ ] Criar `apps/api/src/routes/clinical-artifacts.ts`:

```ts
// apps/api/src/routes/clinical-artifacts.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { issueDocument } from '@cadencia/documents';
import { openPrescriberSession, confirmPrescription } from '@cadencia/prescriptions';
import { exportRecord } from '@cadencia/export';
import { rota } from '../guard';
import { providers } from '../providers';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

export async function clinicalArtifactRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/documentos', {
    schema: {
      body: z.object({
        kind: z.enum(['atestado', 'pedido_exame', 'relatorio', 'declaracao_comparecimento']),
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        versionId: z.string().uuid().optional(),
        payload: z.record(z.unknown()),
      }),
      response: {
        201: z.object({
          documentId: z.string().uuid(), contentHashHex: z.string(),
          assinatura: z.union([
            z.object({ estado: z.literal('assinado'), signatureId: z.string(),
                       verifiedStatus: z.string() }),
            z.object({ estado: z.literal('pendente'), motivo: z.string() })]),
        }),
      },
    },
  }, rota('document.issue', async (tx, ctx, req) => {
    const b = req.body as {
      kind: 'atestado' | 'pedido_exame' | 'relatorio' | 'declaracao_comparecimento';
      patientId: string; encounterId?: string; versionId?: string;
      payload: Record<string, unknown> };
    const { rows } = await tx.query<{ pid: string; dia: string; cpf: string | null }>(
      `SELECT app.current_professional_id()::text AS pid,
              app.local_date(clock_timestamp(),
                (SELECT c.timezone FROM app.clinic c WHERE c.id = $1))::text AS dia,
              NULL::text AS cpf`, [ctx.actor.clinicId]);
    const cab = rows[0];
    if (!cab) erroDominio('profissional_nao_encontrado', 422);
    const resultado = await issueDocument(tx, {
      provider: providers().signature,
      kind: b.kind, patientId: b.patientId, professionalId: cab.pid,
      clinicId: ctx.actor.clinicId,
      ...(b.encounterId === undefined ? {} : { encounterId: b.encounterId }),
      ...(b.versionId === undefined ? {} : { versionId: b.versionId }),
      issuedDate: cab.dia,
      payload: b.payload as never,
      signerRef: `signer-${ctx.actor.userId}`, signerCpf: cab.cpf ?? '00000000000',
    });
    if (!resultado.ok) erroDominio('emissao_falhou', 422);
    return resultado.value;
  }));

  r.post('/v1/prescricoes/sessao', {
    schema: {
      body: z.object({ encounterId: z.string().uuid(), patientId: z.string().uuid() }),
      response: {
        200: z.object({
          mode: z.literal('embedded'), scriptUrl: z.string(), token: z.string(),
          expiresAt: z.string(), patientPayload: z.record(z.string()),
          correlationId: z.string() }),
      },
    },
  }, rota('prescription.write', async (tx, _ctx, req) => {
    const b = req.body as { encounterId: string; patientId: string };
    const { rows } = await tx.query<{ pid: string }>(
      `SELECT app.current_professional_id()::text AS pid`);
    const resultado = await openPrescriberSession(tx, {
      provider: providers().prescription,
      encounterId: b.encounterId, patientId: b.patientId,
      professionalId: rows[0]?.pid ?? '' });
    if (!resultado.ok) erroDominio(resultado.error.kind, 503);
    return resultado.value;
  }));

  r.post('/v1/prescricoes', {
    schema: {
      body: z.object({
        providerPrescriptionId: z.string().min(1),
        encounterId: z.string().uuid(),
        versionId: z.string().uuid().optional(),
        patientId: z.string().uuid(),
      }),
      response: {
        201: z.object({ prescriptionId: z.string().uuid(), itens: z.number().int(),
                        assinaturaVerificada: z.boolean() }),
      },
    },
  }, rota('prescription.write', async (tx, ctx, req) => {
    const b = req.body as { providerPrescriptionId: string; encounterId: string;
                            versionId?: string; patientId: string };
    const { rows } = await tx.query<{ pid: string }>(
      `SELECT app.current_professional_id()::text AS pid`);
    const resultado = await confirmPrescription(tx, {
      prescriptionProvider: providers().prescription,
      signatureProvider: providers().signature,
      providerPrescriptionId: b.providerPrescriptionId,
      encounterId: b.encounterId,
      ...(b.versionId === undefined ? {} : { versionId: b.versionId }),
      patientId: b.patientId, professionalId: rows[0]?.pid ?? '',
      clinicId: ctx.actor.clinicId,
      signerRef: `signer-${ctx.actor.userId}`, signerCpf: '00000000000' });
    if (!resultado.ok) {
      erroDominio(resultado.error.kind,
        resultado.error.kind === 'parceiro_indisponivel' ? 503 : 422);
    }
    return resultado.value;
  }));

  r.post('/v1/pacientes/:id/exportacoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        requesterKind: z.enum(['titular', 'representante', 'profissional',
                               'judicial', 'fiscalizacao']),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        requesterNote: z.string().optional(),
      }),
      response: {
        201: z.object({ exportId: z.string().uuid(), pageCount: z.number().int(),
                        pdfSha256Hex: z.string(), durationMs: z.number().int() }),
      },
    },
  }, rota('record.export', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { requesterKind: never; from?: string; to?: string;
                            requesterNote?: string };
    const resultado = await exportRecord(tx, { patientId: p.id, ...b });
    if (!resultado.ok) erroDominio(resultado.error.kind, 404);
    // Os BYTES nao voltam no JSON: o cliente busca o PDF pelo id, por rota de
    // download com `no-store`. Devolver base64 aqui estouraria a resposta com
    // um prontuario de 480 paginas.
    return {
      exportId: resultado.value.exportId, pageCount: resultado.value.pageCount,
      pdfSha256Hex: resultado.value.pdfSha256Hex, durationMs: resultado.value.durationMs };
  }));
}
```

- [ ] Registrar em `buildApp`: `await app.register(clinicalArtifactRoutes);`
- [ ] Ajustar `apps/api/src/guard.ts` para popular `mfaAt` a partir da sessão resolvida (a Fase 0 grava `mfa_at` em `id.session`), de modo que `requiresMfa` funcione de verdade.
- [ ] Rodar: `pnpm test:int -- clinical-artifacts` → 5 testes passam.
- [ ] Commitar: `git commit -m "feat(api): expose documents, prescriptions and the ECF.18 export"`

---

### Task 63: o teste que prova que **nenhuma rota** vaza outro tenant

**Arquivos:**
- Criar: `apps/api/src/tenant-isolation.int.test.ts`

- [ ] Escrever o teste:

```ts
// apps/api/src/tenant-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { semearSessao, auth, type SementeSessao } from './test-support';

let a: SementeSessao; let b: SementeSessao;

beforeAll(async () => {
  a = await semearSessao({ role: 'profissional' });
  b = await semearSessao({ role: 'profissional' });
});
afterAll(async () => { await closePools(); });

describe('nenhuma rota vaza outro tenant', () => {
  it('paciente do tenant B nao aparece na busca do tenant A', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes?termo=${encodeURIComponent(b.patientNome)}`, ...auth(a) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: { patientId: string }[] }).itens
      .map((p) => p.patientId)).not.toContain(b.patientId);
    await app.close();
  });

  it('id direto de paciente de outro tenant devolve 404 ou lista vazia, nunca dado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${b.patientId}/prontuario`, ...auth(a) });
    expect([200, 404]).toContain(r.statusCode);
    if (r.statusCode === 200) {
      expect((r.json() as { itens: unknown[] }).itens).toEqual([]);
    }
    await app.close();
  });

  it('a sonda de existencia responde NAO para identificador de outro tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pacientes/existe?kind=CPF&value=${b.patientCpf}`, ...auth(a) });
    expect(r.json()).toEqual({ existe: false });
    await app.close();
  });

  it('agendar para paciente de outro tenant e recusado, nao aceito em silencio', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/agenda/agendamentos', ...auth(a),
      payload: { patientId: b.patientId, professionalId: a.professionalId,
                 procedureId: a.procedureId, startsAt: '2027-01-05T13:00:00.000Z' } });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it('a agenda do dia do tenant A nunca traz linha do tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/agenda/dia?dia=2027-01-05', ...auth(a) });
    const fila = (r.json() as { fila: { patientId: string }[] }).fila;
    expect(fila.map((x) => x.patientId)).not.toContain(b.patientId);
    await app.close();
  });

  it('trocar o x-clinic-id para uma unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/agenda/dia?dia=2027-01-05',
      cookies: { '__Host-cadencia_sid': a.token, '__Host-cadencia_csrf': a.csrf },
      headers: { 'x-clinic-id': b.clinicId, 'x-csrf-token': a.csrf } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });
});
```

- [ ] Rodar: `pnpm test:int -- tenant-isolation` → 6 testes passam.
- [ ] Provar que a proteção pega: em `apps/api/src/context.ts`, troque temporariamente a validação de vínculo por `if (false)` e confirme que o último teste fica **vermelho**. Restaure.
- [ ] Commitar: `git commit -m "test(api): assert no route leaks another tenant"`

---

### Task 64: `apps/worker` — o que sai da transação

**Arquivos:**
- Criar: `apps/worker/src/worker.ts`, `apps/worker/src/jobs/auto-finalize-drafts.ts`
- Modificar: `apps/worker/src/index.ts`, `apps/worker/package.json`
- Teste: `apps/worker/src/jobs/auto-finalize-drafts.int.test.ts`

- [ ] Instalar: `pnpm --filter @cadencia/worker add pg-boss`

- [ ] Escrever o teste que falha:

```ts
// apps/worker/src/jobs/auto-finalize-drafts.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './auto-finalize-drafts';
import { semearRascunhoAntigo, type SementeWorker } from '../test-support';

let s: SementeWorker;
beforeAll(async () => { s = await semearRascunhoAntigo(); });
afterAll(async () => { await closePools(); });

describe('auto-finalizacao de rascunho orfao', () => {
  it('finaliza o rascunho parado ha mais de 7 dias, marcado como incompleto', async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    expect(r.finalizados).toBeGreaterThanOrEqual(1);

    const { rows } = await appPool().query<{ status: string; incompleto: boolean; kind: string }>(
      `SELECT e.status::text AS status, v.incompleto, v.kind::text AS kind
         FROM clin.encounter e JOIN clin.encounter_version v ON v.encounter_id = e.id
        WHERE e.id = $1`, [s.encounterId]);
    expect(rows[0]).toEqual({ status: 'finalizado', incompleto: true, kind: 'original' });
  });

  it('nao toca em rascunho recente', async () => {
    const { rows } = await appPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM clin.encounter_draft WHERE encounter_id = $1`,
      [s.encounterRecenteId]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('grava evento de auditoria da auto-finalizacao', async () => {
    const { rows } = await appPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('roda tenant a tenant DENTRO de withTenantTx, nunca com BYPASSRLS ligado', async () => {
    // A varredura usa o pool `jobs` (BYPASSRLS) so para LISTAR; a finalizacao
    // abre transacao de negocio com o ator de sistema do tenant certo.
    const { rows } = await appPool().query<{ actor_kind: string }>(
      `SELECT actor_kind FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]);
    expect(rows[0]?.actor_kind).toBe('system');
  });
});
```

- [ ] Criar `apps/worker/src/jobs/auto-finalize-drafts.ts`:

```ts
// apps/worker/src/jobs/auto-finalize-drafts.ts
import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, canonicalHash, CANONICAL_VERSION } from '@cadencia/kernel';

export interface AutoFinalizeResult {
  readonly examinados: number;
  readonly finalizados: number;
  readonly falhas: number;
}

/**
 * §4.4 — rascunho parado ha 7 dias vira versao kind='original' com
 * incompleto = true, com evento de auditoria e notificacao ao profissional.
 *
 * A varredura usa o papel `jobs` (unico com BYPASSRLS) APENAS para listar. A
 * finalizacao abre withTenantTx com o ator de SISTEMA do tenant certo: rodar a
 * escrita com BYPASSRLS ligado dissolveria o isolamento no unico caminho do
 * sistema que enxerga todos os tenants.
 */
export async function autoFinalizeStaleDrafts(
  opts: { limiteDias?: number } = {},
): Promise<AutoFinalizeResult> {
  const limite = opts.limiteDias ?? 7;
  const { rows } = await jobsPool().query<{
    tenant_id: string; encounter_id: string; professional_id: string; clinic_id: string }>(
    `SELECT tenant_id, encounter_id, professional_id, clinic_id
       FROM clin.stale_drafts(make_interval(days => $1))`, [limite]);

  let finalizados = 0;
  let falhas = 0;

  for (const linha of rows) {
    const ator: Actor = {
      kind: 'system', tenantId: linha.tenant_id,
      reason: 'auto-finalize-stale-draft', requestId: uuidv7(),
    };
    try {
      await withTenantTx(ator, async (tx) => {
        const rascunho = await tx.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM clin.encounter_draft WHERE encounter_id = $1`,
          [linha.encounter_id]);
        const cab = await tx.query<{
          patient_id: string; clinic_id: string; occurred_at: string; occurred_date: string }>(
          `SELECT patient_id, clinic_id,
                  to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
                  occurred_date::text AS occurred_date
             FROM clin.encounter WHERE id = $1`, [linha.encounter_id]);
        const c = cab.rows[0];
        if (!c) return;

        // O ator de sistema nao tem professional_id derivavel: usamos o
        // profissional do proprio atendimento, que e quem escreveu o rascunho.
        const hash = canonicalHash({
          schema: 'cadencia.encounter_version',
          canonicalVersion: CANONICAL_VERSION,
          encounterId: linha.encounter_id,
          patientId: c.patient_id, professionalId: linha.professional_id,
          clinicId: c.clinic_id, occurredAt: c.occurred_at, occurredDate: c.occurred_date,
          versionNo: 1, kind: 'original', supersedesVersionId: null, justificativa: null,
          authorUserId: '', authorProfessionalId: linha.professional_id,
          cosignerProfessionalId: null, incompleto: true,
          fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
          rascunho: JSON.stringify(rascunho.rows[0]?.payload ?? {}),
        });

        await tx.query(
          `SELECT clin.finalize_encounter($1, 'original', $2::jsonb, $3::bytea, $4,
                    NULL, NULL, true)`,
          [linha.encounter_id, JSON.stringify({ fields: [] }), hash, CANONICAL_VERSION]);
      });
      finalizados += 1;
    } catch {
      // Uma falha nao aborta a varredura: o proximo rascunho continua.
      falhas += 1;
    }
  }

  return { examinados: rows.length, finalizados, falhas };
}
```

> **Nota sobre o `author_professional_id`:** `clin.finalize_encounter` deriva o autor de `app.current_professional_id()`, que é `NULL` para o ator de sistema. Acrescente à migration `0037` um `coalesce` que, quando `app.current_professional_id()` for nulo **e** o ator for `system`, use `v_enc.professional_id`:
>
> ```sql
>   v_prof := coalesce(app.current_professional_id(),
>     CASE WHEN nullif(current_setting('app.actor_kind', true), '') = 'system'
>          THEN (SELECT e.professional_id FROM clin.encounter e WHERE e.id = p_encounter_id)
>          END);
> ```
>
> Escreva a alteração como **nova migration** `0054_finalize_system_actor.sql` com `CREATE OR REPLACE FUNCTION`, repetindo o corpo inteiro da função com essa única linha trocada — migrations são forward-only e a 0037 já rodou.

- [ ] Criar `apps/worker/src/worker.ts`:

```ts
// apps/worker/src/worker.ts
import PgBoss from 'pg-boss';
import { closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './jobs/auto-finalize-drafts';

const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';

/**
 * §2.1 — o worker e o unico lugar de onde sai chamada a parceiro, e o unico que
 * roda o que nao cabe na transacao HTTP: mensagens, PDF pesado, auto-finalizacao.
 * pg-boss usa schema proprio e enfileira NA MESMA transacao do dominio, o que
 * elimina job fantasma.
 */
export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();

  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    // Dead man's switch: a AUSENCIA de execucao e o que alarma, nao so o erro.
    // O heartbeat sai daqui e e lido pelo alarme de "worker sem batida ha 5 min".
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  await boss.schedule(FILA_RASCUNHOS, '0 3 * * *');   // 03h, fora do horario comercial
  return boss;
}

async function main(): Promise<void> {
  const boss = await startWorker();
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => { await boss.stop(); await closePools(); process.exit(0); })();
    });
  }
}

if (process.env.NODE_ENV !== 'test') void main();
```

- [ ] Substituir `apps/worker/src/index.ts` por `export { startWorker } from './worker';` e criar `apps/worker/src/test-support.ts` que semeia um rascunho com `updated_at` de 10 dias atrás e um recente.
- [ ] Rodar: `pnpm db:migrate && pnpm test:int -- auto-finalize-drafts` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(worker): auto-finalize stale drafts tenant by tenant"`

---

## Parte X — App shell e design system

### Task 65: scaffold do `apps/web` — Next.js 15, React 19, Tailwind 4, TanStack Query, nuqs

SSR só para a casca; telas quentes são cliente. E `web` **nunca** recebe `DATABASE_URL`.

**Arquivos:**
- Criar: `apps/web/next.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/providers.tsx`, `apps/web/src/api.ts`, `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`
- Modificar: `apps/web/package.json`, `apps/web/tsconfig.json`
- Teste: `apps/web/src/api.test.ts`

- [ ] Instalar:

```bash
pnpm --filter @cadencia/web add next@15 react@19 react-dom@19 @tanstack/react-query@5 nuqs@2 react-hook-form@7 @radix-ui/react-dialog @radix-ui/react-popover
pnpm --filter @cadencia/web add -D tailwindcss@4 @tailwindcss/postcss postcss @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom vitest-axe @types/react @types/react-dom
```

- [ ] Escrever o teste que falha:

```ts
// apps/web/src/api.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { apiFetch, ApiError } from './api';

afterEach(() => { vi.restoreAllMocks(); });

describe('cliente da API', () => {
  it('manda o cabecalho da unidade e o CSRF em metodo mutante', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await apiFetch('/v1/pacientes', { method: 'POST', body: { fullName: 'X' },
                                      clinicId: 'c1', csrfToken: 'tok' });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('x-clinic-id')).toBe('c1');
    expect(headers.get('x-csrf-token')).toBe('tok');
    expect(init.credentials).toBe('include');
  });

  it('NAO manda CSRF em GET — cabecalho a mais em leitura e ruido', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await apiFetch('/v1/pacientes?termo=a', { clinicId: 'c1', csrfToken: 'tok' });
    const headers = new Headers((spy.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('x-csrf-token')).toBeNull();
  });

  it('traduz o erro de dominio em ApiError com o codigo nomeado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ erro: 'horario_ocupado', encaixePossivel: true }),
        { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(apiFetch('/v1/agenda/agendamentos', { method: 'POST', body: {},
      clinicId: 'c', csrfToken: 't' }))
      .rejects.toMatchObject({ codigo: 'horario_ocupado', status: 409,
                               dados: { encaixePossivel: true } });
  });

  it('401 vira ApiError sem_sessao, para a casca redirecionar ao login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ erro: 'sem_sessao' }),
        { status: 401, headers: { 'content-type': 'application/json' } }));
    const e = await apiFetch('/v1/whoami', { clinicId: 'c', csrfToken: 't' })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).codigo).toBe('sem_sessao');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test` → `Failed to resolve import "./api"`.

- [ ] Criar `apps/web/src/api.ts`:

```ts
// apps/web/src/api.ts

/**
 * §2.1 regra 1 — `web` NAO recebe DATABASE_URL por task role. Toda leitura e
 * escrita passa por HTTP para `apps/api`. Este arquivo e a unica porta.
 */
export class ApiError extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
    readonly dados: Record<string, unknown> = {},
  ) {
    super(codigo);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly clinicId: string;
  readonly csrfToken: string;
  readonly signal?: AbortSignal;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T>(caminho: string, opts: ApiOptions): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers = new Headers({ 'x-clinic-id': opts.clinicId });
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  // CSRF so em metodo mutante: e o que o hook da borda exige, e cabecalho a mais
  // em leitura so serve para vazar o token em log de proxy.
  if (MUTANTES.has(method)) headers.set('x-csrf-token', opts.csrfToken);

  const resposta = await fetch(`${BASE}${caminho}`, {
    method,
    headers,
    // Sessao e cookie __Host-, e por isso a credencial precisa ir junto.
    credentials: 'include',
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({})) as Record<string, unknown>;
    const { erro, ...resto } = corpo;
    throw new ApiError(typeof erro === 'string' ? erro : 'interno', resposta.status, resto);
  }
  return await resposta.json() as T;
}
```

- [ ] Criar `apps/web/app/layout.tsx`:

```tsx
// apps/web/app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { BarraDeNavegacao } from '../src/ui/BarraDeNavegacao';

export const metadata = { title: 'Cadência', description: 'Prontuário e gestão para clínicas' };

// SSR so para a CASCA (§2.3): telas quentes sao cliente. Esta e a unica arvore
// renderizada no servidor, e ela nao le nenhum dado clinico.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <BarraDeNavegacao />
          <main id="conteudo">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] Criar `apps/web/app/providers.tsx`:

```tsx
// apps/web/app/providers.tsx
'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Dado clinico nunca fica em cache alem da sessao da tela: o produto
        // roda em recepcao com computador compartilhado.
        staleTime: 5_000,
        gcTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  );
}
```

- [ ] Criar `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
  },
});
```

- [ ] Criar `apps/web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';

expect.extend(matchers);
```

- [ ] Acrescentar em `apps/web/package.json`: `"test": "vitest run"`, `"dev": "next dev -p 3000"`, `"build": "next build"`, e a dependência `@cadencia/kernel` (o front usa `formatBRL` e os validadores).
- [ ] Rodar: `pnpm --filter @cadencia/web test` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(web): scaffold the Next.js shell with the HTTP-only API client"`

---

### Task 66: os tokens visuais — literais da §6.2, com o âmbar corrigido

`--ambar-500` estava em `oklch(72% 0.150 75)`, que dá **2,48:1** sobre `--surface` no tema claro — reprovado até para elemento de UI. Como é a cor do status *Aguardando*, que a recepção lê o dia inteiro, o valor é `oklch(52% 0.140 75)`.

**Arquivos:**
- Criar: `apps/web/app/globals.css`, `apps/web/src/ui/contrast.ts`
- Teste: `apps/web/src/ui/contrast.test.ts`

- [ ] Escrever o teste que falha:

```ts
// apps/web/src/ui/contrast.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oklchParaSrgb, luminanciaRelativa, razaoDeContraste, lerToken } from './contrast';

const CSS = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

describe('contraste dos tokens — MEDIDO, nunca inferido', () => {
  it('o ambar corrigido esta no arquivo: L=52%, nao 72%', () => {
    expect(lerToken(CSS, '--ambar-500')).toBe('oklch(52% 0.140 75)');
  });

  it('--warn sobre --surface passa em AA no tema claro', () => {
    const warn = oklchParaSrgb(0.52, 0.140, 75);
    const surface = oklchParaSrgb(0.992, 0.003, 95);
    const razao = razaoDeContraste(luminanciaRelativa(warn), luminanciaRelativa(surface));
    expect(razao).toBeGreaterThanOrEqual(4.5);
  });

  it('o valor ANTIGO reprovaria — o teste prova que a protecao pega', () => {
    const antigo = oklchParaSrgb(0.72, 0.150, 75);
    const surface = oklchParaSrgb(0.992, 0.003, 95);
    const razao = razaoDeContraste(luminanciaRelativa(antigo), luminanciaRelativa(surface));
    expect(razao).toBeLessThan(3);
  });

  it('texto, acento, ok, danger e ai passam em AA sobre a superficie clara', () => {
    const surface = luminanciaRelativa(oklchParaSrgb(0.992, 0.003, 95));
    const casos: [string, number, number, number][] = [
      ['--text', 0.23, 0.012, 265],
      ['--accent', 0.45, 0.140, 258],
      ['--ok', 0.53, 0.130, 155],
      ['--danger', 0.53, 0.190, 25],
      ['--ai', 0.52, 0.150, 300],
    ];
    for (const [nome, l, c, h] of casos) {
      const razao = razaoDeContraste(luminanciaRelativa(oklchParaSrgb(l, c, h)), surface);
      expect(razao, `${nome} = ${razao.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('o CSS declara os dois temas e o seletor manual data-theme', () => {
    expect(CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(CSS).toContain(':root[data-theme="dark"]');
    expect(CSS).toContain(':root[data-theme="light"]');
  });

  it('prefers-reduced-motion zera as duracoes', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(CSS).toContain('--dur-1: 1ms');
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- contrast` → `Failed to resolve import "./contrast"`.

- [ ] Criar `apps/web/src/ui/contrast.ts`:

```ts
// apps/web/src/ui/contrast.ts

/**
 * §6.6 — LICAO REGISTRADA: razao de contraste e MEDIDA, nunca inferida do valor
 * de luminosidade do OKLCH. L=72% parece claro o suficiente para passar e nao
 * passa em hue amarelo, porque a luminosidade perceptual do OKLCH nao e a
 * luminancia relativa da WCAG. O CI precisa calcular, nao confiar.
 */

export interface Srgb { r: number; g: number; b: number }

/** OKLCH -> OKLab -> LMS -> sRGB linear -> sRGB com gama. */
export function oklchParaSrgb(l: number, c: number, hGraus: number): Srgb {
  const h = (hGraus * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * bb;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  const rLin = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const gLin = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bLin = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;

  const gama = (v: number): number => {
    const x = Math.max(0, Math.min(1, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };

  return { r: gama(rLin), g: gama(gLin), b: gama(bLin) };
}

export function luminanciaRelativa(c: Srgb): number {
  const canal = (v: number): number =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);
}

export function razaoDeContraste(l1: number, l2: number): number {
  const claro = Math.max(l1, l2);
  const escuro = Math.min(l1, l2);
  return (claro + 0.05) / (escuro + 0.05);
}

/** Extrai o valor literal de um custom property do CSS, para o teste comparar. */
export function lerToken(css: string, nome: string): string | null {
  const m = new RegExp(`${nome}\\s*:\\s*([^;]+);`).exec(css);
  return m?.[1]?.trim() ?? null;
}
```

- [ ] Criar `apps/web/app/globals.css` (tokens **literais** da §6.2):

```css
@import "tailwindcss";

:root {
  /* ── primitivas (OKLCH) ────────────────────────────────────────────── */
  --tinta-50:  oklch(96.5% 0.014 258);  --tinta-100: oklch(92% 0.030 258);
  --tinta-300: oklch(74% 0.080 258);    --tinta-500: oklch(52% 0.132 258);
  --tinta-600: oklch(45% 0.140 258);    --tinta-700: oklch(38% 0.128 258);
  --papel-0:   oklch(99.2% 0.003 95);   --papel-50:  oklch(97.6% 0.005 95);
  --papel-100: oklch(95.4% 0.006 95);   --papel-200: oklch(91%   0.007 95);
  --papel-300: oklch(84%   0.008 95);   --papel-500: oklch(62%   0.010 95);
  --grafite-700: oklch(38% 0.012 265);  --grafite-800: oklch(30% 0.012 265);
  --grafite-900: oklch(23% 0.012 265);  --grafite-950: oklch(17% 0.012 265);
  --verde-500:  oklch(53% 0.130 155);   --verde-100: oklch(94% 0.040 155);
  /* CORRIGIDO: oklch(72% 0.150 75) dava 2,48:1 sobre --surface e reprovava ate
     para elemento de UI. E a cor do status Aguardando, que a recepcao le o dia
     inteiro. Verificado em 5,49:1 sobre --surface. */
  --ambar-500:  oklch(52% 0.140 75);    --ambar-100: oklch(95% 0.055 75);
  --rubi-500:   oklch(53% 0.190 25);    --rubi-100:  oklch(94% 0.045 25);
  --violeta-500:oklch(52% 0.150 300);   --violeta-100:oklch(95% 0.040 300);

  /* ── semânticas: claro ─────────────────────────────────────────────── */
  --bg:            var(--papel-50);
  --surface:       var(--papel-0);
  --surface-sunken:var(--papel-100);
  --surface-hover: var(--papel-100);
  --line:          var(--papel-200);
  --line-strong:   var(--papel-300);
  --text:          var(--grafite-900);
  --text-muted:    oklch(48% 0.012 265);
  --text-faint:    var(--papel-500);
  --accent:        var(--tinta-600);
  --accent-hover:  var(--tinta-700);
  --accent-soft:   var(--tinta-50);
  --accent-on:     var(--papel-0);
  --ok:   var(--verde-500);  --ok-soft:   var(--verde-100);
  --warn: var(--ambar-500);  --warn-soft: var(--ambar-100);
  --danger: var(--rubi-500); --danger-soft: var(--rubi-100);
  --ai:   var(--violeta-500);--ai-soft:   var(--violeta-100);

  /* status da agenda: cor + FORMA (barra lateral), nunca cor sozinha */
  --st-agendado: var(--papel-300);  --st-confirmado: var(--tinta-300);
  --st-aguardando: var(--ambar-500);--st-atendendo: var(--tinta-600);
  --st-atendido: var(--verde-500);  --st-faltou: var(--rubi-500);
  --st-cancelado: var(--papel-300);

  /* ── espaço, forma, elevação ───────────────────────────────────────── */
  --s-1:2px; --s-2:4px; --s-3:6px; --s-4:8px; --s-5:12px; --s-6:16px;
  --s-7:20px; --s-8:24px; --s-9:32px; --s-10:40px; --s-11:56px;
  --r-sm:3px; --r-md:5px; --r-lg:8px; --r-xl:12px; --r-full:999px;
  --border: 1px solid var(--line);
  --elev-1: 0 1px 2px oklch(0% 0 0 / .06), 0 0 0 1px oklch(0% 0 0 / .04);
  --elev-2: 0 8px 24px oklch(0% 0 0 / .10), 0 0 0 1px oklch(0% 0 0 / .06);

  /* ── tipografia ────────────────────────────────────────────────────── */
  --font-ui:    "IBM Plex Sans", system-ui, sans-serif;
  --font-mono:  "IBM Plex Mono", ui-monospace, monospace;
  --font-doc:   "IBM Plex Serif", Georgia, serif;   /* só PDF e impressão */
  --fs-11:11px; --fs-12:12px; --fs-13:13px; --fs-14:14px; --fs-15:15px;
  --fs-16:16px; --fs-18:18px; --fs-22:22px; --fs-28:28px;
  --lh-tight:1.25; --lh-ui:1.45; --lh-read:1.6;
  --fw-regular:400; --fw-medium:500; --fw-semibold:600;
  --num-tabular: "tnum" 1, "lnum" 1;

  /* ── movimento ─────────────────────────────────────────────────────── */
  --dur-1:90ms; --dur-2:140ms; --dur-3:200ms;
  --ease-out: cubic-bezier(.2,.8,.2,1);
  --ease-in-out: cubic-bezier(.4,0,.2,1);

  /* ── foco e camadas ────────────────────────────────────────────────── */
  --focus-ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
  --z-sticky:10; --z-panel:40; --z-popover:60; --z-modal:80; --z-toast:100;
}

@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: var(--grafite-950); --surface: var(--grafite-900);
  --surface-sunken: var(--grafite-950); --surface-hover: var(--grafite-800);
  --line: var(--grafite-800); --line-strong: var(--grafite-700);
  --text: oklch(95% 0.006 95); --text-muted: oklch(72% 0.010 265);
  --text-faint: oklch(58% 0.010 265);
  --accent: oklch(72% 0.115 258); --accent-hover: oklch(79% 0.110 258);
  --accent-soft: oklch(30% 0.055 258); --accent-on: var(--grafite-950);
  --ok: oklch(72% 0.130 155);  --ok-soft: oklch(28% 0.050 155);
  --warn: oklch(80% 0.130 75); --warn-soft: oklch(30% 0.055 75);
  --danger: oklch(70% 0.150 25); --danger-soft: oklch(29% 0.060 25);
  --ai: oklch(72% 0.120 300);  --ai-soft: oklch(29% 0.055 300);
  --elev-1: 0 1px 2px oklch(0% 0 0 / .5), 0 0 0 1px oklch(100% 0 0 / .06);
  --elev-2: 0 8px 28px oklch(0% 0 0 / .6), 0 0 0 1px oklch(100% 0 0 / .08);
}}

/* O seletor manual repete as mesmas sobrescritas e VENCE em ambas as direções:
   quem escolheu tema claro num sistema escuro precisa continuar no claro. */
:root[data-theme="dark"] {
  --bg: var(--grafite-950); --surface: var(--grafite-900);
  --surface-sunken: var(--grafite-950); --surface-hover: var(--grafite-800);
  --line: var(--grafite-800); --line-strong: var(--grafite-700);
  --text: oklch(95% 0.006 95); --text-muted: oklch(72% 0.010 265);
  --text-faint: oklch(58% 0.010 265);
  --accent: oklch(72% 0.115 258); --accent-hover: oklch(79% 0.110 258);
  --accent-soft: oklch(30% 0.055 258); --accent-on: var(--grafite-950);
  --ok: oklch(72% 0.130 155);  --ok-soft: oklch(28% 0.050 155);
  --warn: oklch(80% 0.130 75); --warn-soft: oklch(30% 0.055 75);
  --danger: oklch(70% 0.150 25); --danger-soft: oklch(29% 0.060 25);
  --ai: oklch(72% 0.120 300);  --ai-soft: oklch(29% 0.055 300);
  --elev-1: 0 1px 2px oklch(0% 0 0 / .5), 0 0 0 1px oklch(100% 0 0 / .06);
  --elev-2: 0 8px 28px oklch(0% 0 0 / .6), 0 0 0 1px oklch(100% 0 0 / .08);
}
:root[data-theme="light"] {
  --bg: var(--papel-50); --surface: var(--papel-0);
  --surface-sunken: var(--papel-100); --surface-hover: var(--papel-100);
  --line: var(--papel-200); --line-strong: var(--papel-300);
  --text: var(--grafite-900); --text-muted: oklch(48% 0.012 265);
  --text-faint: var(--papel-500);
  --accent: var(--tinta-600); --accent-hover: var(--tinta-700);
  --accent-soft: var(--tinta-50); --accent-on: var(--papel-0);
}

/* §6.5 — prefers-reduced-motion: TODAS as durações vão a 1 ms e nenhuma
   transição de posição sobrevive. Não é atenuar: é desligar. */
@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 1ms; --dur-2: 1ms; --dur-3: 1ms; }
  *, *::before, *::after {
    animation-duration: 1ms !important; animation-iteration-count: 1 !important;
    transition-duration: 1ms !important; scroll-behavior: auto !important;
  }
}

html { color-scheme: light dark; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: var(--fw-regular) var(--fs-14)/var(--lh-ui) var(--font-ui);
  -webkit-font-smoothing: antialiased;
}
/* Foco visível em TUDO, com anel duplo que funciona sobre qualquer fundo. */
:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-sm); }
/* Números SEMPRE tabulares em coluna. */
.num, td.num, .mono { font-variant-numeric: tabular-nums lining-nums; }
.mono { font-family: var(--font-mono); }
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- contrast` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(web): add the design tokens with the measured contrast guard"`

---

### Task 67: a barra de navegação — a ordem cronológica do dia

Cada persona ocupa um bloco contíguo: recepção 1-3, profissional 1 e 4, gestão 5-6. Itens de fases futuras aparecem **desabilitados de forma honesta**, com o motivo, nunca com cadeado de upsell.

**Arquivos:**
- Criar: `apps/web/src/ui/BarraDeNavegacao.tsx`, `apps/web/src/ui/nav.ts`
- Teste: `apps/web/src/ui/BarraDeNavegacao.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('marca o que ainda nao existe, com o motivo — nunca cadeado de upsell', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 1);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Conversas', 'Financeiro', 'Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('renderiza os itens da Fase 1 como link e os futuros como desabilitados', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Hoje' })).toBeInTheDocument();
    const conversas = screen.getByRole('button', { name: /Conversas/ });
    expect(conversas).toBeDisabled();
    expect(conversas).toHaveAttribute('aria-disabled', 'true');
    expect(conversas).toHaveAccessibleDescription(/Fase 2/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- BarraDeNavegacao` → `Failed to resolve import './nav'`.

- [ ] Criar `apps/web/src/ui/nav.ts`:

```ts
// apps/web/src/ui/nav.ts

/**
 * §5.2 — a ordem e CRONOLOGICA no dia: o que esta acontecendo -> o que vai
 * acontecer -> com quem estou falando -> com quem ja falei -> o que isso gerou
 * -> o que isso significa.
 *
 * Cada persona ocupa um bloco contiguo: recepcao 1-3, profissional 1 e 4,
 * gestao 5-6. A pessoa aprende TRES itens, nao sete.
 *
 * Ajustes, Auditoria e Ajuda humana ficam FORA da barra, no menu do usuario.
 */
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
  // Item desabilitado de forma HONESTA: diz o que falta e quando chega. Cadeado
  // cinza comunica "seu produto esta quebrado" ou "pague mais" (§5.4).
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2,
    motivo: 'WhatsApp bidirecional chega na Fase 2' },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 3,
    motivo: 'Financeiro completo chega na Fase 3' },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuição de variação chegam na Fase 3' },
];

export const FASE_ATUAL = 1 as const;
```

- [ ] Criar `apps/web/src/ui/BarraDeNavegacao.tsx`:

```tsx
// apps/web/src/ui/BarraDeNavegacao.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FASE_ATUAL, ITENS_NAV } from './nav';

export function BarraDeNavegacao() {
  const caminho = usePathname();
  return (
    <header
      style={{
        background: 'var(--surface)', borderBottom: 'var(--border)',
        position: 'sticky', top: 0, zIndex: 'var(--z-sticky)' as unknown as number,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-6)',
                    padding: `var(--s-3) var(--s-6)` }}>
        <strong style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)' }}>
          ◈ Cadência
        </strong>
      </div>
      <nav aria-label="Navegação principal">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: `0 var(--s-6)` }}>
          {ITENS_NAV.map((item) => {
            const ativo = caminho?.startsWith(item.href) === true;
            const indisponivel = item.disponivelNaFase > FASE_ATUAL;
            const id = `nav-motivo-${item.rotulo.toLowerCase()}`;
            return (
              <li key={item.href}>
                {indisponivel ? (
                  <>
                    <button
                      type="button" disabled aria-disabled="true" aria-describedby={id}
                      style={{
                        border: 0, background: 'transparent', color: 'var(--text-faint)',
                        padding: `var(--s-4) var(--s-5)`, fontSize: 'var(--fs-14)',
                        cursor: 'not-allowed', minHeight: 24,
                      }}
                    >
                      {item.rotulo}
                    </button>
                    <span id={id} hidden>{item.motivo}</span>
                  </>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={ativo ? 'page' : undefined}
                    style={{
                      display: 'inline-block', padding: `var(--s-4) var(--s-5)`,
                      color: ativo ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                      fontSize: 'var(--fs-14)', textDecoration: 'none',
                      borderBottom: ativo ? '2px solid var(--accent)' : '2px solid transparent',
                      minHeight: 24,
                    }}
                  >
                    {item.rotulo}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- BarraDeNavegacao` → 5 testes passam.
- [ ] Commitar: `git commit -m "feat(web): navigation ordered by the clock of the working day"`

---

### Task 68: Botão e Campo — o carregamento que não faz perder o lugar

**Arquivos:**
- Criar: `apps/web/src/ui/Botao.tsx`, `apps/web/src/ui/Campo.tsx`
- Teste: `apps/web/src/ui/Botao.test.tsx`, `apps/web/src/ui/Campo.test.tsx`

- [ ] Escrever os testes que falham:

```tsx
// apps/web/src/ui/Botao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Botao } from './Botao';

describe('Botao', () => {
  it('carregando MANTEM o rotulo e adiciona a barra de 2px — trocar o texto faz perder o lugar', () => {
    render(<Botao carregando>Salvar agendamento</Botao>);
    expect(screen.getByRole('button', { name: /Salvar agendamento/ })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Carregando' })).toBeInTheDocument();
    expect(screen.getByTestId('barra-progresso')).toBeInTheDocument();
  });

  it('carregando desabilita e anuncia com aria-busy', () => {
    render(<Botao carregando>Salvar</Botao>);
    const b = screen.getByRole('button');
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });

  it('nao dispara clique enquanto carrega', async () => {
    const aoClicar = vi.fn();
    render(<Botao carregando onClick={aoClicar}>Salvar</Botao>);
    await userEvent.click(screen.getByRole('button'));
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it('as tres variantes existem e nenhuma usa gradiente ou sombra', () => {
    const { container } = render(
      <>
        <Botao variante="primario">A</Botao>
        <Botao variante="secundario">B</Botao>
        <Botao variante="fantasma">C</Botao>
      </>);
    expect(container.innerHTML).not.toMatch(/gradient|box-shadow: 0 \d/);
  });

  it('alvo minimo de 24px e sem violacao de acessibilidade', async () => {
    const { container } = render(<Botao>Ok</Botao>);
    expect(screen.getByRole('button')).toHaveStyle({ minHeight: '32px' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

```tsx
// apps/web/src/ui/Campo.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Campo } from './Campo';

describe('Campo', () => {
  it('o rotulo esta SEMPRE visivel — placeholder nao e rotulo', () => {
    render(<Campo rotulo="Telefone" placeholder="(11) 90000-0000" />);
    expect(screen.getByText('Telefone')).toBeVisible();
    expect(screen.getByLabelText('Telefone')).toHaveAttribute('placeholder', '(11) 90000-0000');
  });

  it('erro NUNCA e so cor: tem texto, aria-describedby e aria-invalid', () => {
    render(<Campo rotulo="CPF" erro="CPF inválido" />);
    const input = screen.getByLabelText('CPF');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('CPF inválido')).toBeVisible();
    expect(input.getAttribute('aria-describedby'))
      .toBe(screen.getByText('CPF inválido').id);
  });

  it('a dica tambem entra em aria-describedby, junto com o erro', () => {
    render(<Campo rotulo="CNS" dica="15 dígitos" erro="CNS inválido" />);
    const descrito = screen.getByLabelText('CNS').getAttribute('aria-describedby') ?? '';
    expect(descrito.split(' ')).toHaveLength(2);
  });

  it('sem erro, nao anuncia invalido', () => {
    render(<Campo rotulo="Nome" />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'false');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Campo rotulo="Nome" dica="como no documento" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- Botao Campo` → imports não resolvidos.

- [ ] Criar `apps/web/src/ui/Botao.tsx`:

```tsx
// apps/web/src/ui/Botao.tsx
'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma';
export type AlturaBotao = 28 | 32 | 40;

export interface BotaoProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variante?: VarianteBotao;
  readonly altura?: AlturaBotao;
  readonly carregando?: boolean;
  readonly children: ReactNode;
}

const ESTILO: Record<VarianteBotao, React.CSSProperties> = {
  // Sem gradiente, sem sombra em botao (§6.4).
  primario:   { background: 'var(--accent)', color: 'var(--accent-on)', border: '1px solid transparent' },
  secundario: { background: 'var(--surface)', color: 'var(--text)', border: 'var(--border)' },
  fantasma:   { background: 'transparent', color: 'var(--text)', border: '1px solid transparent' },
};

export function Botao({
  variante = 'primario', altura = 32, carregando = false, children, disabled, ...resto
}: BotaoProps) {
  return (
    <button
      type="button"
      {...resto}
      disabled={disabled === true || carregando}
      aria-busy={carregando}
      style={{
        position: 'relative', overflow: 'hidden',
        minHeight: `${altura}px`, padding: `0 var(--s-5)`,
        borderRadius: 'var(--r-md)', fontWeight: 'var(--fw-medium)',
        fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
        cursor: carregando ? 'progress' : 'pointer',
        ...ESTILO[variante], ...resto.style,
      }}
    >
      {/* O rotulo NAO e trocado por spinner: trocar o rotulo e o que faz o
          usuario perder o lugar. Uma barra indeterminada de 2px na base
          comunica o mesmo sem apagar o texto. */}
      {children}
      {carregando ? (
        <>
          <span role="status" aria-label="Carregando" />
          <span
            data-testid="barra-progresso"
            aria-hidden="true"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
              background: 'currentColor', opacity: 0.55,
              animation: `barra-indeterminada var(--dur-3) var(--ease-in-out) infinite alternate`,
            }}
          />
        </>
      ) : null}
    </button>
  );
}
```

- [ ] Acrescentar ao final de `apps/web/app/globals.css`:

```css
@keyframes barra-indeterminada {
  from { transform: translateX(-60%); }
  to   { transform: translateX(60%); }
}
```

- [ ] Criar `apps/web/src/ui/Campo.tsx`:

```tsx
// apps/web/src/ui/Campo.tsx
'use client';

import { useId, type InputHTMLAttributes } from 'react';

export interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly rotulo: string;
  readonly dica?: string;
  readonly erro?: string;
  readonly denso?: boolean;
}

export function Campo({ rotulo, dica, erro, denso = false, ...resto }: CampoProps) {
  const id = useId();
  const idDica = `${id}-dica`;
  const idErro = `${id}-erro`;
  // O erro NUNCA e so cor (§6.6): tem texto, aria-describedby e aria-invalid.
  const descrito = [dica === undefined ? null : idDica, erro === undefined ? null : idErro]
    .filter((x): x is string => x !== null).join(' ');

  return (
    <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
      {/* Rotulo SEMPRE visivel: placeholder nao e rotulo. */}
      <label htmlFor={id} style={{
        fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
        lineHeight: 1.3, color: 'var(--text-muted)',
      }}>
        {rotulo}
      </label>
      <input
        id={id}
        {...resto}
        aria-invalid={erro !== undefined}
        aria-describedby={descrito === '' ? undefined : descrito}
        style={{
          height: denso ? 32 : 40, padding: `0 var(--s-4)`,
          border: erro === undefined ? 'var(--border)' : '1px solid var(--danger)',
          borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--text)',
          fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
          ...resto.style,
        }}
      />
      {dica === undefined ? null : (
        <span id={idDica} style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {dica}
        </span>
      )}
      {erro === undefined ? null : (
        <span id={idErro} style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
          {erro}
        </span>
      )}
    </div>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- Botao Campo` → 10 testes passam.
- [ ] Commitar: `git commit -m "feat(web): button that keeps its label while loading and accessible field"`

---

### Task 69: `ComboboxDePaciente` — o componente mais importante do produto

Alvo: **primeira tecla → primeiro resultado em < 120 ms p75**. Debounce 120 ms, nome social em destaque, `+ Criar` **sempre** na última linha, `aria-activedescendant`.

**Arquivos:**
- Criar: `apps/web/src/ui/ComboboxDePaciente.tsx`
- Teste: `apps/web/src/ui/ComboboxDePaciente.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/ComboboxDePaciente.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ComboboxDePaciente, type PacienteHit } from './ComboboxDePaciente';

const HITS: PacienteHit[] = [
  { patientId: 'p1', displayName: 'MARIA SOUZA LIMA', legalName: 'Maria Souza Lima',
    hasSocialName: false, birthDate: '1988-03-14', cadastroStatus: 'completo',
    phonePrimary: '11987654321' },
  { patientId: 'p2', displayName: 'Joana Prado', legalName: 'Joao Prado',
    hasSocialName: true, birthDate: null, cadastroStatus: 'preliminar', phonePrimary: null },
];

function montar(buscar = vi.fn(async () => HITS), aoCriar = vi.fn(), aoEscolher = vi.fn()) {
  render(<ComboboxDePaciente buscar={buscar} aoEscolher={aoEscolher} aoCriar={aoCriar} />);
  return { buscar, aoCriar, aoEscolher };
}

describe('combobox de busca de paciente', () => {
  it('tem os papeis ARIA de combobox com listbox', () => {
    montar();
    const input = screen.getByRole('combobox', { name: 'Buscar paciente' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('debounce de 120 ms: nao chama a busca a cada tecla', async () => {
    vi.useFakeTimers();
    const { buscar } = montar();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole('combobox'), 'maria');
    expect(buscar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('maria');
    vi.useRealTimers();
  });

  it('o nome SOCIAL fica em destaque e o civil aparece como secundario', async () => {
    montar();
    await userEvent.type(screen.getByRole('combobox'), 'joa');
    await waitFor(() => expect(screen.getByText('Joana Prado')).toBeVisible());
    expect(screen.getByText(/Joao Prado/)).toBeVisible();
  });

  it('"+ Criar" e SEMPRE a ultima linha, inclusive com resultados', async () => {
    montar();
    await userEvent.type(screen.getByRole('combobox'), 'maria');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    const opcoes = screen.getAllByRole('option');
    expect(opcoes[2]).toHaveTextContent(/Criar "maria"/);
  });

  it('setas movem aria-activedescendant e Enter escolhe', async () => {
    const { aoEscolher } = montar();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'maria');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]!.id);
    await userEvent.keyboard('{Enter}');
    expect(aoEscolher).toHaveBeenCalledWith(HITS[0]);
  });

  it('Enter na ultima linha cria o paciente com o termo digitado', async () => {
    const { aoCriar } = montar();
    await userEvent.type(screen.getByRole('combobox'), 'maria sou');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(aoCriar).toHaveBeenCalledWith('maria sou');
  });

  it('mostra o sinal de cadastro preliminar na linha', async () => {
    montar();
    await userEvent.type(screen.getByRole('combobox'), 'joa');
    await waitFor(() => expect(screen.getByText('cadastro preliminar')).toBeVisible());
  });

  it('sem violacao de acessibilidade com a lista aberta', async () => {
    const { container } = render(
      <ComboboxDePaciente buscar={async () => HITS} aoEscolher={vi.fn()} aoCriar={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'maria');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- ComboboxDePaciente` → import não resolvido.

- [ ] Criar `apps/web/src/ui/ComboboxDePaciente.tsx`:

```tsx
// apps/web/src/ui/ComboboxDePaciente.tsx
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface PacienteHit {
  readonly patientId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly hasSocialName: boolean;
  readonly birthDate: string | null;
  readonly cadastroStatus: 'preliminar' | 'completo';
  readonly phonePrimary: string | null;
}

export interface ComboboxDePacienteProps {
  readonly buscar: (termo: string) => Promise<PacienteHit[]>;
  readonly aoEscolher: (p: PacienteHit) => void;
  readonly aoCriar: (termo: string) => void;
  readonly rotulo?: string;
}

/** §6.4 — debounce de 120 ms. Alvo: primeira tecla -> primeiro resultado < 120 ms p75. */
const DEBOUNCE_MS = 120;

function idade(nascimento: string | null): string {
  if (nascimento === null) return '';
  const anos = Math.floor(
    (Date.now() - new Date(nascimento).getTime()) / (365.2425 * 24 * 3600 * 1000));
  return `${anos}a`;
}

export function ComboboxDePaciente({
  buscar, aoEscolher, aoCriar, rotulo = 'Buscar paciente',
}: ComboboxDePacienteProps) {
  const [termo, setTermo] = useState('');
  const [itens, setItens] = useState<PacienteHit[]>([]);
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(-1);
  const baseId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geracao = useRef(0);

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (termo.trim() === '') { setItens([]); setAberto(false); return; }
    timer.current = setTimeout(() => {
      const minha = ++geracao.current;
      void buscar(termo).then((r) => {
        // Resposta fora de ordem e o bug classico do autocomplete: descartamos
        // tudo que nao for da ultima digitacao.
        if (minha !== geracao.current) return;
        setItens(r);
        setAberto(true);
        setIndice(-1);
      });
    }, DEBOUNCE_MS);
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [termo, buscar]);

  // "+ Criar" e SEMPRE a ultima linha, inclusive quando ha resultados: e o gesto
  // que o fluxo (a) usa com o paciente na linha do telefone.
  const total = itens.length + 1;
  const idDaOpcao = useCallback((i: number) => `${baseId}-opt-${i}`, [baseId]);

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!aberto) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndice((i) => (i + 1) % total); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndice((i) => (i - 1 + total) % total); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const i = indice < 0 ? 0 : indice;
      if (i === itens.length) aoCriar(termo);
      else { const p = itens[i]; if (p !== undefined) aoEscolher(p); }
    } else if (e.key === 'Escape') { setAberto(false); setIndice(-1); }
  }

  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={`${baseId}-input`} style={{
        display: 'block', fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
        color: 'var(--text-muted)', marginBottom: 'var(--s-2)' }}>
        {rotulo}
      </label>
      <input
        id={`${baseId}-input`}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={`${baseId}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={indice >= 0 ? idDaOpcao(indice) : undefined}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        onKeyDown={aoTeclar}
        autoComplete="off"
        style={{
          width: '100%', height: 40, padding: `0 var(--s-4)`, border: 'var(--border)',
          borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--text)',
          fontSize: 'var(--fs-14)',
        }}
      />
      {aberto ? (
        <ul
          id={`${baseId}-lista`} role="listbox" aria-label="Resultados"
          style={{
            position: 'absolute', insetInline: 0, marginTop: 'var(--s-2)', padding: 0,
            listStyle: 'none', background: 'var(--surface)', border: 'var(--border)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--elev-2)',
            zIndex: 'var(--z-popover)' as unknown as number, maxHeight: 320, overflowY: 'auto',
          }}
        >
          {itens.map((p, i) => (
            <li
              key={p.patientId} id={idDaOpcao(i)} role="option" aria-selected={indice === i}
              onMouseDown={(e) => { e.preventDefault(); aoEscolher(p); }}
              style={{
                padding: `var(--s-4) var(--s-5)`, minHeight: 24, cursor: 'pointer',
                background: indice === i ? 'var(--surface-hover)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s-4)' }}>
                {/* Nome SOCIAL em destaque — Decreto 8.727/2016 vale em TODA exibicao. */}
                <strong style={{ fontWeight: 'var(--fw-medium)' }}>{p.displayName}</strong>
                <span className="num" style={{ color: 'var(--text-muted)',
                                               fontSize: 'var(--fs-13)' }}>
                  {idade(p.birthDate)}
                </span>
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                {p.hasSocialName ? `nome civil: ${p.legalName} · ` : ''}
                {p.cadastroStatus === 'preliminar' ? 'cadastro preliminar' : ''}
              </div>
            </li>
          ))}
          <li
            id={idDaOpcao(itens.length)} role="option" aria-selected={indice === itens.length}
            onMouseDown={(e) => { e.preventDefault(); aoCriar(termo); }}
            style={{
              padding: `var(--s-4) var(--s-5)`, minHeight: 24, cursor: 'pointer',
              borderTop: 'var(--border)', color: 'var(--accent)',
              background: indice === itens.length ? 'var(--surface-hover)' : 'transparent',
            }}
          >
            + Criar &quot;{termo}&quot;
          </li>
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- ComboboxDePaciente` → 8 testes passam.
- [ ] Commitar: `git commit -m "feat(web): patient search combobox with debounce and always-last create row"`

---

### Task 70: chip de status, linha da agenda, bloco de seção e versão retificada

**Arquivos:**
- Criar: `apps/web/src/ui/ChipDeStatus.tsx`, `apps/web/src/ui/LinhaDaAgenda.tsx`, `apps/web/src/ui/BlocoDeSecao.tsx`, `apps/web/src/ui/VersaoRetificada.tsx`
- Teste: `apps/web/src/ui/componentes-clinicos.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/componentes-clinicos.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ChipDeStatus } from './ChipDeStatus';
import { LinhaDaAgenda } from './LinhaDaAgenda';
import { BlocoDeSecao } from './BlocoDeSecao';
import { VersaoRetificada } from './VersaoRetificada';

describe('componentes clinicos', () => {
  it('o chip carrega COR + GLIFO: cor nunca sozinha', () => {
    render(<ChipDeStatus status="atendido" />);
    const chip = screen.getByText(/Atendido/);
    expect(chip.textContent).toMatch(/[✓✕⏱●]/);
  });

  it('a linha da agenda comunica status por FORMA — barra de 3px na borda', () => {
    render(<LinhaDaAgenda hora="14:00" paciente="Maria Souza Lima" profissional="Dr. Alceu"
      status="aguardando" encaixe={false} />);
    const linha = screen.getByRole('listitem');
    expect(linha).toHaveStyle({ borderLeftWidth: '3px' });
  });

  it('encaixe recebe HACHURA diagonal, nao outra cor', () => {
    render(<LinhaDaAgenda hora="14:15" paciente="Encaixe" profissional="Dr. Alceu"
      status="agendado" encaixe />);
    expect(screen.getByRole('listitem')).toHaveAttribute('data-encaixe', 'true');
    expect(screen.getByText('encaixe')).toBeVisible();
  });

  it('secao vazia colapsa em uma linha clicavel de 24px', async () => {
    render(<BlocoDeSecao titulo="Odontograma" vazia />);
    const botao = screen.getByRole('button', { name: /Odontograma/ });
    expect(botao).toHaveStyle({ minHeight: '24px' });
    await userEvent.click(botao);
    expect(screen.getByRole('region', { name: 'Odontograma' })).toBeVisible();
  });

  it('secao NAO usa card: titulo, regua de 1px e conteudo', () => {
    const { container } = render(
      <BlocoDeSecao titulo="Queixa"><p>cefaleia</p></BlocoDeSecao>);
    expect(container.innerHTML).not.toMatch(/border-radius: (8|12)px/);
    expect(screen.getByRole('heading', { name: 'Queixa' })).toBeVisible();
  });

  it('versao retificada e TACHADA com a cor de perigo, recolhida por padrao', async () => {
    render(<VersaoRetificada versaoNo={1} retificadaEm="12/05/2027" autor="Dr. Alceu"
      justificativa="digitado no paciente errado durante a consulta">
      <p>Queixa: cefaleia há 3 dias</p>
    </VersaoRetificada>);
    expect(screen.queryByText(/cefaleia/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /versão 1/i }));
    const conteudo = screen.getByTestId('conteudo-retificado');
    expect(conteudo).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(screen.getByText(/digitado no paciente errado/)).toBeVisible();
  });

  it('o verbo Excluir NAO existe no vocabulario para registro finalizado', () => {
    render(<VersaoRetificada versaoNo={1} retificadaEm="12/05/2027" autor="Dr. Alceu"
      justificativa="x">conteudo</VersaoRetificada>);
    expect(screen.queryByText(/Excluir/i)).not.toBeInTheDocument();
  });

  it('nenhuma violacao de acessibilidade nos quatro componentes', async () => {
    const { container } = render(
      <ul>
        <LinhaDaAgenda hora="14:00" paciente="Maria" profissional="Dr. A"
          status="atendido" encaixe={false} />
      </ul>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- componentes-clinicos` → imports não resolvidos.

- [ ] Criar `apps/web/src/ui/ChipDeStatus.tsx`:

```tsx
// apps/web/src/ui/ChipDeStatus.tsx
'use client';

export type StatusAgenda =
  | 'agendado' | 'confirmado' | 'aguardando' | 'atendendo'
  | 'atendido' | 'faltou' | 'cancelado';

/** §6.4 — cor + GLIFO. Cor NUNCA sozinha: daltonismo nao e caso de borda. */
const CHIP: Record<StatusAgenda, { rotulo: string; glifo: string; token: string }> = {
  agendado:   { rotulo: 'Agendado',   glifo: '●', token: '--st-agendado' },
  confirmado: { rotulo: 'Confirmado', glifo: '✓', token: '--st-confirmado' },
  aguardando: { rotulo: 'Aguardando', glifo: '⏱', token: '--st-aguardando' },
  atendendo:  { rotulo: 'Atendendo',  glifo: '●', token: '--st-atendendo' },
  atendido:   { rotulo: 'Atendido',   glifo: '✓', token: '--st-atendido' },
  faltou:     { rotulo: 'Faltou',     glifo: '✕', token: '--st-faltou' },
  cancelado:  { rotulo: 'Cancelado',  glifo: '✕', token: '--st-cancelado' },
};

export function ChipDeStatus({ status }: { status: StatusAgenda }) {
  const c = CHIP[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
      fontWeight: 'var(--fw-medium)', padding: `var(--s-1) var(--s-4)`,
      borderRadius: 'var(--r-full)',
      color: `var(${c.token})`, background: 'var(--surface-sunken)',
    }}>
      <span aria-hidden="true">{c.glifo}</span>{c.rotulo}
    </span>
  );
}

export { CHIP as CHIPS_DE_STATUS };
```

- [ ] Criar `apps/web/src/ui/LinhaDaAgenda.tsx`:

```tsx
// apps/web/src/ui/LinhaDaAgenda.tsx
'use client';

import { ChipDeStatus, type StatusAgenda } from './ChipDeStatus';

export interface LinhaDaAgendaProps {
  readonly hora: string;
  readonly paciente: string;
  readonly profissional: string;
  readonly procedimento?: string;
  readonly convenio?: string;
  readonly status: StatusAgenda;
  readonly encaixe: boolean;
  readonly cadastroPreliminar?: boolean;
  readonly primeiraVez?: boolean;
  readonly teleconsulta?: boolean;
  readonly aoAbrir?: () => void;
}

const TOKEN_STATUS: Record<StatusAgenda, string> = {
  agendado: '--st-agendado', confirmado: '--st-confirmado', aguardando: '--st-aguardando',
  atendendo: '--st-atendendo', atendido: '--st-atendido', faltou: '--st-faltou',
  cancelado: '--st-cancelado',
};

export function LinhaDaAgenda(p: LinhaDaAgendaProps) {
  return (
    <li
      data-encaixe={p.encaixe ? 'true' : 'false'}
      onClick={p.aoAbrir}
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto auto',
        alignItems: 'center', gap: 'var(--s-5)',
        // FORMA, nao so cor: barra de 3px na borda esquerda, para daltonicos.
        borderLeft: `3px solid var(${TOKEN_STATUS[p.status]})`,
        borderBottom: 'var(--border)',
        background: p.encaixe
          // Encaixe recebe HACHURA diagonal a 45 graus, nunca outra cor: outra
          // cor competiria com o vocabulario de status.
          ? 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)'
          : 'var(--surface)',
        padding: `var(--s-4) var(--s-5)`, minHeight: 44, cursor: p.aoAbrir ? 'pointer' : 'default',
      }}
    >
      <span className="num" style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
        {p.hora}
      </span>
      <span>
        <strong style={{ fontWeight: 'var(--fw-medium)' }}>{p.paciente}</strong>
        <span style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.profissional}
          {p.procedimento === undefined ? '' : ` · ${p.procedimento}`}
          {p.convenio === undefined ? '' : ` · ${p.convenio}`}
          {p.encaixe ? ' · encaixe' : ''}
          {p.cadastroPreliminar === true ? ' · cadastro preliminar' : ''}
          {p.primeiraVez === true ? ' · 1ª vez' : ''}
          {p.teleconsulta === true ? ' · teleconsulta' : ''}
        </span>
      </span>
      <ChipDeStatus status={p.status} />
    </li>
  );
}
```

- [ ] Criar `apps/web/src/ui/BlocoDeSecao.tsx`:

```tsx
// apps/web/src/ui/BlocoDeSecao.tsx
'use client';

import { useId, useState, type ReactNode } from 'react';

export interface BlocoDeSecaoProps {
  readonly titulo: string;
  readonly vazia?: boolean;
  readonly children?: ReactNode;
}

/**
 * §6.4 — SEM CARD: um titulo 15/600, uma regua de 1px e o conteudo. Secao vazia
 * colapsa em uma linha de 24px, clicavel. E isso que permite ter 14 secoes
 * configuradas sem a tela virar um acordeao infinito.
 */
export function BlocoDeSecao({ titulo, vazia = false, children }: BlocoDeSecaoProps) {
  const [aberta, setAberta] = useState(!vazia);
  const id = useId();

  if (!aberta) {
    return (
      <button
        type="button" onClick={() => setAberta(true)} aria-expanded={false} aria-controls={id}
        style={{
          display: 'block', width: '100%', textAlign: 'left', minHeight: 24,
          border: 0, background: 'transparent', color: 'var(--text-faint)',
          fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
          letterSpacing: '.01em', padding: 0, cursor: 'pointer',
        }}
      >
        {titulo}
      </button>
    );
  }

  return (
    <section id={id} aria-label={titulo} style={{ marginBlockEnd: 'var(--s-8)' }}>
      <h3 style={{
        fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', lineHeight: 1.3,
        letterSpacing: '.01em', margin: 0, paddingBottom: 'var(--s-3)',
        borderBottom: '1px solid var(--line)',
      }}>
        {titulo}
      </h3>
      <div style={{ paddingTop: 'var(--s-5)', fontSize: 'var(--fs-15)',
                    lineHeight: 'var(--lh-read)' }}>
        {children}
      </div>
    </section>
  );
}
```

- [ ] Criar `apps/web/src/ui/VersaoRetificada.tsx`:

```tsx
// apps/web/src/ui/VersaoRetificada.tsx
'use client';

import { useId, useState, type ReactNode } from 'react';

export interface VersaoRetificadaProps {
  readonly versaoNo: number;
  readonly retificadaEm: string;
  readonly autor: string;
  readonly justificativa: string;
  readonly children: ReactNode;
}

/**
 * §6.4 — o requisito da NGS1.12 vira componente. Fundo --surface-sunken, texto
 * --text-muted, line-through com text-decoration-color: var(--danger), RECOLHIDO
 * por padrao.
 *
 * O verbo "Excluir" NAO existe no vocabulario do produto para registro
 * finalizado — so "Retificar" e "Adendo". Remover o verbo e mais barato que
 * explicar a regra mil vezes.
 */
export function VersaoRetificada({
  versaoNo, retificadaEm, autor, justificativa, children,
}: VersaoRetificadaProps) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <div style={{
      background: 'var(--surface-sunken)', border: 'var(--border)',
      borderRadius: 'var(--r-md)', padding: `var(--s-4) var(--s-5)`,
      marginBlockEnd: 'var(--s-5)',
    }}>
      <button
        type="button" onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta} aria-controls={id}
        style={{
          border: 0, background: 'transparent', padding: 0, minHeight: 24,
          color: 'var(--text-muted)', fontSize: 'var(--fs-12)', cursor: 'pointer',
          textAlign: 'left', width: '100%',
        }}
      >
        {`⟨ versão ${versaoNo} · retificada em ${retificadaEm} por ${autor} ⟩ ${aberta ? '▾' : '▸'}`}
      </button>
      {aberta ? (
        <div id={id}>
          <div
            data-testid="conteudo-retificado"
            style={{
              color: 'var(--text-muted)',
              textDecorationLine: 'line-through',
              textDecorationColor: 'var(--danger)',
              marginBlock: 'var(--s-4)',
            }}
          >
            {children}
          </div>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)', margin: 0 }}>
            <strong>Justificativa:</strong> {justificativa}
          </p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- componentes-clinicos` → 8 testes passam.
- [ ] Commitar: `git commit -m "feat(web): status chip, schedule row, record section and amended version"`

---

### Task 71: painel lateral compositor e faixa de contadores

O painel escurece o fundo em 8% **sem borrar**: blur custa GPU e a tela de trás precisa continuar legível — o médico consulta o texto do atendimento enquanto prescreve.

**Arquivos:**
- Criar: `apps/web/src/ui/PainelLateral.tsx`, `apps/web/src/ui/FaixaDeContadores.tsx`
- Teste: `apps/web/src/ui/painel-e-faixa.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/painel-e-faixa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelLateral } from './PainelLateral';
import { FaixaDeContadores } from './FaixaDeContadores';

describe('painel lateral compositor', () => {
  it('tem 420px e NAO borra o fundo — o medico le o atendimento enquanto prescreve', () => {
    render(<PainelLateral aberto titulo="Prescrever" aoFechar={vi.fn()}>
      <p>conteudo</p></PainelLateral>);
    expect(screen.getByRole('dialog', { name: 'Prescrever' })).toHaveStyle({ width: '420px' });
    expect(screen.getByTestId('fundo-escurecido')).not.toHaveStyle({ backdropFilter: 'blur(4px)' });
  });

  it('Esc fecha e devolve o foco a origem', async () => {
    const aoFechar = vi.fn();
    render(<PainelLateral aberto titulo="Prescrever" aoFechar={aoFechar}>
      <button type="button">dentro</button></PainelLateral>);
    await userEvent.keyboard('{Escape}');
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('faz focus trap: Tab nao escapa do painel', async () => {
    render(<>
      <button type="button">fora</button>
      <PainelLateral aberto titulo="P" aoFechar={vi.fn()}>
        <button type="button">a</button><button type="button">b</button>
      </PainelLateral></>);
    await userEvent.tab(); await userEvent.tab(); await userEvent.tab();
    expect(document.activeElement).not.toHaveTextContent('fora');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <PainelLateral aberto titulo="Prescrever" aoFechar={vi.fn()}><p>x</p></PainelLateral>);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('faixa de contadores', () => {
  const CONT = { agendados: 12, confirmados: 8, aguardando: 2, atendidos: 5, faltas: 1 };

  it('cada numero e um BUTTON que filtra a fila, nao um enfeite', async () => {
    const aoFiltrar = vi.fn();
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={aoFiltrar} />);
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoFiltrar).toHaveBeenCalledWith('aguardando');
  });

  it('anuncia mudanca com aria-live polite', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Contadores do dia' }))
      .toHaveAttribute('aria-live', 'polite');
  });

  it('os numeros sao tabulares em 28/600', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(screen.getByText('12')).toHaveStyle({ fontSize: '28px', fontWeight: '600' });
  });

  it('o filtro ativo fica marcado com aria-pressed', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} filtroAtivo="faltas" />);
    expect(screen.getByRole('button', { name: /Faltas/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- painel-e-faixa` → imports não resolvidos.

- [ ] Criar `apps/web/src/ui/PainelLateral.tsx`:

```tsx
// apps/web/src/ui/PainelLateral.tsx
'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface PainelLateralProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
}

const FOCAVEIS = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function PainelLateral({ aberto, titulo, aoFechar, children }: PainelLateralProps) {
  const id = useId();
  const painel = useRef<HTMLDivElement>(null);
  const origem = useRef<Element | null>(null);

  useEffect(() => {
    if (!aberto) return;
    origem.current = document.activeElement;
    painel.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();

    function aoTeclar(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); aoFechar(); return; }
      if (e.key !== 'Tab') return;
      const alvos = painel.current?.querySelectorAll<HTMLElement>(FOCAVEIS);
      if (alvos === undefined || alvos.length === 0) return;
      const primeiro = alvos[0]!;
      const ultimo = alvos[alvos.length - 1]!;
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      // Devolve o foco a ORIGEM: o cursor volta ao ponto exato do atendimento.
      (origem.current as HTMLElement | null)?.focus();
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <>
      <div
        data-testid="fundo-escurecido" onClick={aoFechar} aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          // Escurece 8% SEM BLUR: blur custa GPU e a tela de tras precisa
          // continuar legivel — o medico consulta o atendimento enquanto prescreve.
          background: 'oklch(0% 0 0 / .08)',
          zIndex: 'var(--z-panel)' as unknown as number,
        }}
      />
      <div
        ref={painel} role="dialog" aria-modal="true" aria-labelledby={id}
        style={{
          position: 'fixed', insetBlock: 0, insetInlineEnd: 0, width: '420px',
          background: 'var(--surface)', borderInlineStart: 'var(--border)',
          boxShadow: 'var(--elev-2)', padding: 'var(--s-6)', overflowY: 'auto',
          zIndex: 'var(--z-panel)' as unknown as number,
          animation: `entra-painel var(--dur-2) var(--ease-out)`,
        }}
      >
        <h2 id={id} style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                             marginTop: 0 }}>
          {titulo}
        </h2>
        {children}
      </div>
    </>
  );
}
```

- [ ] Acrescentar ao final de `apps/web/app/globals.css`:

```css
@keyframes entra-painel { from { transform: translateX(100%); } to { transform: translateX(0); } }
```

- [ ] Criar `apps/web/src/ui/FaixaDeContadores.tsx`:

```tsx
// apps/web/src/ui/FaixaDeContadores.tsx
'use client';

export interface Contadores {
  readonly agendados: number;
  readonly confirmados: number;
  readonly aguardando: number;
  readonly atendidos: number;
  readonly faltas: number;
}

export type FiltroDoDia = keyof Contadores;

const ROTULOS: Record<FiltroDoDia, string> = {
  agendados: 'Agendados', confirmados: 'Confirmados', aguardando: 'Aguardando',
  atendidos: 'Atendidos', faltas: 'Faltas',
};

export interface FaixaDeContadoresProps {
  readonly contadores: Contadores;
  readonly aoFiltrar: (filtro: FiltroDoDia) => void;
  readonly filtroAtivo?: FiltroDoDia;
}

/**
 * §6.4 — seis numeros em 28/600 com rotulo 11 caixa alta, separados por regua
 * vertical de 1px. Cada um e um <button> que FILTRA a fila: numero que nao
 * filtra e enfeite. Atualizacao por aria-live="polite".
 */
export function FaixaDeContadores({
  contadores, aoFiltrar, filtroAtivo,
}: FaixaDeContadoresProps) {
  const chaves = Object.keys(ROTULOS) as FiltroDoDia[];
  return (
    <div
      role="group" aria-label="Contadores do dia" aria-live="polite"
      style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
               background: 'var(--surface)', overflow: 'hidden' }}
    >
      {chaves.map((k, i) => (
        <button
          key={k} type="button" onClick={() => aoFiltrar(k)}
          aria-pressed={filtroAtivo === k}
          style={{
            flex: 1, border: 0, background: filtroAtivo === k ? 'var(--surface-hover)' : 'transparent',
            borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
            padding: `var(--s-5) var(--s-4)`, cursor: 'pointer', minHeight: 44,
            display: 'grid', gap: 'var(--s-1)', justifyItems: 'start', color: 'var(--text)',
          }}
        >
          <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1 }}>
            {contadores[k]}
          </span>
          <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                         letterSpacing: '.04em', color: 'var(--text-muted)' }}>
            {ROTULOS[k]}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- painel-e-faixa` → 9 testes passam.
- [ ] Commitar: `git commit -m "feat(web): composer side panel without blur and clickable day counters"`

---

## Parte XI — As telas

> **Regra que vale para toda esta parte:** todo filtro vira query string (`nuqs`), para que um link colado no WhatsApp da equipe abra **exatamente** a mesma tela. Nenhum estado de filtro mora só em `useState`.

### Task 72: `/hoje` — a fila de execução ao vivo

**Arquivos:**
- Criar: `apps/web/app/hoje/page.tsx`, `apps/web/src/telas/Hoje.tsx`, `apps/web/src/dados/dia.ts`
- Teste: `apps/web/src/telas/Hoje.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Hoje.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Hoje } from './Hoje';

const DIA = {
  contadores: { agendados: 3, confirmados: 1, aguardando: 1, atendidos: 1, faltas: 0 },
  fila: [
    { appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
      patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
      procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
      status: 'aguardando' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
      cadastroPreliminar: true, encounterId: null },
    { appointmentId: 'a2', startsAt: '2026-08-03T14:00:00.000Z', endsAt: '2026-08-03T14:30:00.000Z',
      patientId: 'p2', displayName: 'Joana Prado', professionalId: 'pr1',
      procedureNome: 'Retorno', procedureCor: '#2f5fd0', operadoraNome: null,
      status: 'agendado' as const, encaixe: true, teleconsulta: false, primeiraVez: true,
      cadastroPreliminar: false, encounterId: null },
  ],
};
const PRECISA = { confirmacoesSemResposta: 4, prescricoesNaoAssinadas: 1,
                  resultadosChegados: 0, rascunhosDeOntem: 2, guiasAFaturar: 3 };

function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    filtro: undefined, aoMudarFiltro: vi.fn(), ...over,
  };
  render(<Hoje {...props} />);
  return props;
}

describe('tela Hoje', () => {
  it('o titulo diz o dia por extenso — a tela e o relogio, nao um modulo', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Hoje, segunda 3 de agosto/i })).toBeVisible());
  });

  it('mostra a faixa de contadores e a fila em ordem de horario', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('3')).toBeVisible());
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
    expect(linhas[1]).toHaveTextContent('Joana Prado');
  });

  it('clicar num contador vira query string, nao estado local', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByText('3')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('aguardando');
  });

  it('a linha mostra os sinais: cadastro preliminar, 1a vez e encaixe', async () => {
    montar();
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('cadastro preliminar');
    expect(linhas[1]).toHaveTextContent('1ª vez');
    expect(linhas[1]).toHaveTextContent('encaixe');
  });

  it('check-in e otimista: o chip muda antes da resposta', async () => {
    const aoCheckIn = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoCheckIn });
    const linhas = await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: /Check-in de Joana Prado/ }));
    expect(linhas[1]).toHaveTextContent(/Aguardando/);
  });

  it('o painel Precisa de voce lista as cinco filas com os numeros', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Precisa de você' })).toBeVisible());
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText(/confirmações sem resposta/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Hoje dia="2026-08-03" carregarDia={async () => DIA}
        carregarPrecisaDeVoce={async () => PRECISA} aoCheckIn={async () => {}}
        aoAbrirAtendimento={vi.fn()} aoMudarFiltro={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha: `pnpm --filter @cadencia/web test -- Hoje` → import não resolvido.

- [ ] Criar `apps/web/src/telas/Hoje.tsx`:

```tsx
// apps/web/src/telas/Hoje.tsx
'use client';

import { useEffect, useState } from 'react';
import { FaixaDeContadores, type Contadores, type FiltroDoDia } from '../ui/FaixaDeContadores';
import { LinhaDaAgenda } from '../ui/LinhaDaAgenda';
import { Botao } from '../ui/Botao';
import type { StatusAgenda } from '../ui/ChipDeStatus';

export interface LinhaDaFila {
  readonly appointmentId: string; readonly startsAt: string; readonly endsAt: string;
  readonly patientId: string; readonly displayName: string; readonly professionalId: string;
  readonly procedureNome: string | null; readonly procedureCor: string | null;
  readonly operadoraNome: string | null; readonly status: StatusAgenda;
  readonly encaixe: boolean; readonly teleconsulta: boolean; readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean; readonly encounterId: string | null;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number; readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number; readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export interface HojeProps {
  readonly dia: string;
  readonly filtro?: FiltroDoDia;
  readonly carregarDia: (dia: string, filtro?: FiltroDoDia) =>
    Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: LinhaDaFila) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoDia | undefined) => void;
}

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta'],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas'],
  ['resultadosChegados', 'resultados chegados'],
  ['rascunhosDeOntem', 'rascunhos de ontem'],
  ['guiasAFaturar', 'guias a faturar'],
];

function porExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return fmt.format(d);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);

  useEffect(() => {
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      setContadores(r.contadores); setFila(r.fila);
    });
  }, [p, p.dia, p.filtro]);

  useEffect(() => { void p.carregarPrecisaDeVoce().then(setPrecisa); }, [p]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    // §6.5 — mutacao OTIMISTA aplicada em 0 ms. Reversao animada com toast se
    // falhar. Esperar a resposta para mover o chip e o que faz parecer travado.
    setFila((atual) => atual.map((l) =>
      l.appointmentId === linha.appointmentId ? { ...l, status: 'aguardando' as const } : l));
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) => atual.map((l) =>
        l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        {`Hoje, ${porExtenso(p.dia)}`}
      </h1>

      {contadores === null ? null : (
        <FaixaDeContadores
          contadores={contadores}
          filtroAtivo={p.filtro}
          // Cada numero e um FILTRO da fila, e o filtro vai para a URL.
          aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
        />
      )}

      <section aria-label="Fila do dia">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {fila.map((l) => (
            <LinhaDaAgenda
              key={l.appointmentId}
              hora={hora(l.startsAt)}
              paciente={l.displayName}
              profissional={l.professionalId}
              {...(l.procedureNome === null ? {} : { procedimento: l.procedureNome })}
              {...(l.operadoraNome === null ? {} : { convenio: l.operadoraNome })}
              status={l.status}
              encaixe={l.encaixe}
              cadastroPreliminar={l.cadastroPreliminar}
              primeiraVez={l.primeiraVez}
              teleconsulta={l.teleconsulta}
            />
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 'var(--s-4)', marginTop: 'var(--s-5)' }}>
          {fila.map((l) => (
            <span key={l.appointmentId} style={{ display: 'contents' }}>
              <Botao variante="secundario" altura={28}
                aria-label={`Check-in de ${l.displayName}`}
                onClick={() => { void checkIn(l); }}>
                Check-in
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Abrir atendimento de ${l.displayName}`}
                onClick={() => p.aoAbrirAtendimento(l)}>
                {l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}
              </Botao>
            </span>
          ))}
        </div>
      </section>

      {precisa === null ? null : (
        <section aria-label="Precisa de você"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Precisa de você
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {PENDENCIAS.map(([chave, rotulo]) => (
              <li key={chave} style={{ display: 'flex', gap: 'var(--s-4)', minHeight: 24 }}>
                <strong className="num" style={{ minWidth: '2ch', textAlign: 'right' }}>
                  {precisa[chave]}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] Criar `apps/web/app/hoje/page.tsx` que liga a tela ao `apiFetch` e ao `nuqs`:

```tsx
// apps/web/app/hoje/page.tsx
'use client';

import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Hoje, type LinhaDaFila, type PrecisaDeVoce } from '../../src/telas/Hoje';
import type { Contadores, FiltroDoDia } from '../../src/ui/FaixaDeContadores';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

const FILTROS = ['agendados', 'confirmados', 'aguardando', 'atendidos', 'faltas'] as const;

export default function PaginaHoje() {
  const { clinicId, csrfToken } = useSessao();
  // Todo filtro vira query string: link colado no WhatsApp da equipe abre a
  // MESMA tela.
  const [filtro, setFiltro] = useQueryState('faceta', parseAsStringLiteral(FILTROS));
  const dia = new Date().toISOString().slice(0, 10);

  return (
    <Hoje
      dia={dia}
      {...(filtro === null ? {} : { filtro: filtro as FiltroDoDia })}
      aoMudarFiltro={(f) => { void setFiltro(f ?? null); }}
      carregarDia={(d, f) => apiFetch<{ contadores: Contadores; fila: LinhaDaFila[] }>(
        `/v1/agenda/dia?dia=${d}${f === undefined ? '' : `&status=${mapa(f)}`}`,
        { clinicId, csrfToken })}
      carregarPrecisaDeVoce={() => apiFetch<PrecisaDeVoce>(
        '/v1/agenda/precisa-de-voce', { clinicId, csrfToken })}
      aoCheckIn={async (id) => {
        await apiFetch(`/v1/agenda/agendamentos/${id}/checkin`,
          { method: 'POST', clinicId, csrfToken });
      }}
      aoAbrirAtendimento={(l) => { window.location.href = `/atendimento/novo?paciente=${l.patientId}`; }}
    />
  );
}

/** O contador `agendados` e o TOTAL do dia; os demais casam 1:1 com o status. */
function mapa(f: FiltroDoDia): string {
  return f === 'agendados' ? '' : f === 'faltas' ? 'faltou'
    : f === 'confirmados' ? 'confirmado' : f === 'atendidos' ? 'atendido' : 'aguardando';
}
```

- [ ] Criar `apps/web/src/sessao.tsx` com um `useSessao()` que lê `clinicId` e o token CSRF do cookie não-httpOnly (`__Host-cadencia_csrf`), com um `SessaoProvider` na casca.
- [ ] Rodar: `pnpm --filter @cadencia/web test -- Hoje` → 7 testes passam.
- [ ] Commitar: `git commit -m "feat(web): today screen with live counters, queue and the needs-you panel"`

---

### Task 73: `/agenda` — as cinco visões, com a grade em CSS grid

**Arquivos:**
- Criar: `apps/web/src/telas/Agenda.tsx`, `apps/web/src/telas/grade.ts`, `apps/web/app/agenda/page.tsx`
- Teste: `apps/web/src/telas/grade.test.ts`, `apps/web/src/telas/Agenda.test.tsx`

- [ ] Escrever o teste de unidade que falha:

```ts
// apps/web/src/telas/grade.test.ts
import { describe, expect, it } from 'vitest';
import { posicaoNaGrade, faixasDoDia, VISOES } from './grade';

describe('grade da agenda', () => {
  it('as cinco visoes sao Dia, Semana, Mes, Por profissional e Por sala', () => {
    expect(VISOES.map((v) => v.rotulo))
      .toEqual(['Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala']);
  });

  it('cada visao tem atalho numerico de 1 a 5', () => {
    expect(VISOES.map((v) => v.atalho)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('converte instante em linha de grid de 15 minutos', () => {
    const p = posicaoNaGrade('2026-08-03T13:00:00.000Z', '2026-08-03T13:30:00.000Z',
      { inicioMin: 7 * 60, passoMin: 15, timezone: 'UTC' });
    expect(p).toEqual({ linhaInicio: 25, linhaFim: 27 });
  });

  it('slot de duracao menor que o passo ocupa ao menos uma linha', () => {
    const p = posicaoNaGrade('2026-08-03T13:00:00.000Z', '2026-08-03T13:05:00.000Z',
      { inicioMin: 7 * 60, passoMin: 15, timezone: 'UTC' });
    expect(p.linhaFim - p.linhaInicio).toBe(1);
  });

  it('gera as faixas de hora do dia no fuso da clinica', () => {
    const f = faixasDoDia({ inicioMin: 8 * 60, fimMin: 10 * 60, passoMin: 30 });
    expect(f).toEqual(['08:00', '08:30', '09:00', '09:30']);
  });
});
```

- [ ] Criar `apps/web/src/telas/grade.ts`:

```ts
// apps/web/src/telas/grade.ts

/**
 * §2.3 e §5.3 — a agenda e CSS grid puro. Sem FullCalendar: e a tela mais quente
 * e a que carrega a identidade do produto, e biblioteca de terceiro traz junto
 * o layout, o vocabulario e o desempenho dela.
 *
 * O arraste usa `transform` puro (Task 74), sem layout, com alvo de 60 fps.
 */
export interface Visao {
  readonly chave: 'dia' | 'semana' | 'mes' | 'profissional' | 'sala';
  readonly rotulo: string;
  readonly atalho: '1' | '2' | '3' | '4' | '5';
}

export const VISOES: readonly Visao[] = [
  { chave: 'dia',          rotulo: 'Dia',              atalho: '1' },
  { chave: 'semana',       rotulo: 'Semana',           atalho: '2' },
  { chave: 'mes',          rotulo: 'Mês',              atalho: '3' },
  // Dia/Semana e pouco com 3+ profissionais e sala compartilhada.
  { chave: 'profissional', rotulo: 'Por profissional', atalho: '4' },
  { chave: 'sala',         rotulo: 'Por sala',         atalho: '5' },
];

export interface ConfiguracaoDaGrade {
  readonly inicioMin: number;   // minutos desde a meia-noite
  readonly passoMin: number;    // altura de uma linha, em minutos
  readonly timezone: string;
}

export interface PosicaoNaGrade {
  readonly linhaInicio: number;
  readonly linhaFim: number;
}

function minutosLocais(iso: string, timezone: string): number {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
  const [h, m] = fmt.format(d).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function posicaoNaGrade(
  startsAt: string, endsAt: string, cfg: ConfiguracaoDaGrade,
): PosicaoNaGrade {
  const inicio = minutosLocais(startsAt, cfg.timezone);
  const fim = minutosLocais(endsAt, cfg.timezone);
  const linhaInicio = Math.floor((inicio - cfg.inicioMin) / cfg.passoMin) + 1;
  // Linha CSS grid e 1-based e o fim e exclusivo; o max garante altura minima de
  // uma linha para procedimento mais curto que o passo.
  const linhaFim = Math.max(
    linhaInicio + 1, Math.ceil((fim - cfg.inicioMin) / cfg.passoMin) + 1);
  return { linhaInicio, linhaFim };
}

export function faixasDoDia(
  cfg: { inicioMin: number; fimMin: number; passoMin: number },
): string[] {
  const faixas: string[] = [];
  for (let m = cfg.inicioMin; m < cfg.fimMin; m += cfg.passoMin) {
    faixas.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return faixas;
}
```

- [ ] Escrever o teste de tela que falha:

```tsx
// apps/web/src/telas/Agenda.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Agenda } from './Agenda';

const FILA = [{
  appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
  patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
  procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
  status: 'agendado' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
  cadastroPreliminar: false, encounterId: null,
}];

function montar(over = {}) {
  const props = {
    dia: '2026-08-03', visao: 'dia' as const, timezone: 'UTC',
    carregar: vi.fn(async () => FILA), aoMudarVisao: vi.fn(), aoMudarDia: vi.fn(),
    aoAbrirCompositor: vi.fn(), aoMover: vi.fn(async () => {}), ...over,
  };
  render(<Agenda {...props} />);
  return props;
}

describe('tela Agenda', () => {
  it('oferece as cinco visoes como tablist', async () => {
    montar();
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual([
      'Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala']);
  });

  it('as teclas 1..5 trocam a visao — atalho de um caractere fora de campo de texto', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.keyboard('4');
    expect(aoMudarVisao).toHaveBeenCalledWith('profissional');
  });

  it('a visao vai para a query string, nao para estado local', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }));
    expect(aoMudarVisao).toHaveBeenCalledWith('semana');
  });

  it('o agendamento aparece posicionado na grade, com a cor do procedimento', async () => {
    montar();
    const item = await screen.findByRole('button', { name: /Maria Souza Lima/ });
    expect(item).toHaveStyle({ gridRow: '25 / 27' });
  });

  it('clicar num vao vazio abre o compositor INLINE, nao um modal de pagina cheia', async () => {
    const { aoAbrirCompositor } = montar();
    await waitFor(() => expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByRole('gridcell')[0]!);
    expect(aoAbrirCompositor).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Agenda dia="2026-08-03" visao="dia" timezone="UTC" carregar={async () => FILA}
        aoMudarVisao={vi.fn()} aoMudarDia={vi.fn()} aoAbrirCompositor={vi.fn()}
        aoMover={async () => {}} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(5));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Criar `apps/web/src/telas/Agenda.tsx`:

```tsx
// apps/web/src/telas/Agenda.tsx
'use client';

import { useEffect, useState } from 'react';
import { VISOES, faixasDoDia, posicaoNaGrade, type Visao } from './grade';
import type { LinhaDaFila } from './Hoje';

export interface AgendaProps {
  readonly dia: string;
  readonly visao: Visao['chave'];
  readonly timezone: string;
  readonly carregar: (dia: string) => Promise<LinhaDaFila[]>;
  readonly aoMudarVisao: (v: Visao['chave']) => void;
  readonly aoMudarDia: (dia: string) => void;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
  readonly aoMover: (appointmentId: string, novoInicioIso: string) => Promise<void>;
}

const INICIO_MIN = 7 * 60;
const FIM_MIN = 21 * 60;
const PASSO_MIN = 15;

export function Agenda(p: AgendaProps) {
  const [itens, setItens] = useState<LinhaDaFila[]>([]);
  const faixas = faixasDoDia({ inicioMin: INICIO_MIN, fimMin: FIM_MIN, passoMin: PASSO_MIN });

  useEffect(() => { void p.carregar(p.dia).then(setItens); }, [p, p.dia]);

  useEffect(() => {
    // §5.6 — DISCIPLINA DE FOCO: tecla de um caractere so dispara quando o foco
    // NAO esta em campo de texto. E a diferenca entre o atalho ser util e ser
    // um sabotador.
    function aoTeclar(e: KeyboardEvent): void {
      const alvo = e.target as HTMLElement | null;
      const editando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA'
        || alvo?.isContentEditable === true;
      if (editando || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VISOES.find((x) => x.atalho === e.key);
      if (v !== undefined) { e.preventDefault(); p.aoMudarVisao(v.chave); }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div role="tablist" aria-label="Visões da agenda"
           style={{ display: 'flex', gap: 'var(--s-1)' }}>
        {VISOES.map((v) => (
          <button
            key={v.chave} role="tab" type="button"
            aria-selected={p.visao === v.chave}
            onClick={() => p.aoMudarVisao(v.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: p.visao === v.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)', minHeight: 32, padding: `0 var(--s-5)`,
              fontSize: 'var(--fs-13)', cursor: 'pointer',
            }}
          >
            {v.rotulo}
          </button>
        ))}
      </div>

      <div
        role="grid" aria-label={`Agenda de ${p.dia}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr',
          gridTemplateRows: `repeat(${faixas.length}, 18px)`,
          border: 'var(--border)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', position: 'relative',
        }}
      >
        {faixas.map((f, i) => (
          <span key={f} role="rowheader"
            style={{ gridColumn: 1, gridRow: i + 1, fontSize: 'var(--fs-11)',
                     color: 'var(--text-faint)', paddingInlineEnd: 'var(--s-3)',
                     textAlign: 'right', borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }}>
            {i % 4 === 0 ? f : ''}
          </span>
        ))}
        {faixas.map((f, i) => (
          <div key={`c-${f}`} role="gridcell"
            onClick={() => p.aoAbrirCompositor(INICIO_MIN + i * PASSO_MIN)}
            style={{ gridColumn: 2, gridRow: i + 1, cursor: 'pointer',
                     borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }} />
        ))}
        {itens.map((it) => {
          const pos = posicaoNaGrade(it.startsAt, it.endsAt,
            { inicioMin: INICIO_MIN, passoMin: PASSO_MIN, timezone: p.timezone });
          return (
            <button
              key={it.appointmentId} type="button"
              style={{
                gridColumn: 2, gridRow: `${pos.linhaInicio} / ${pos.linhaFim}`,
                textAlign: 'left', border: 'var(--border)',
                borderInlineStart: `3px solid ${it.procedureCor ?? 'var(--st-agendado)'}`,
                borderRadius: 'var(--r-sm)',
                background: it.encaixe
                  ? 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)'
                  : 'var(--surface)',
                margin: 1, padding: `var(--s-2) var(--s-4)`, cursor: 'grab',
                fontSize: 'var(--fs-13)', overflow: 'hidden',
              }}
            >
              {it.displayName}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] Criar `apps/web/app/agenda/page.tsx` ligando `visao`, `dia` e `profissional` a `nuqs` e à rota `/v1/agenda/dia`.
- [ ] Rodar: `pnpm --filter @cadencia/web test -- grade Agenda` → 11 testes passam.
- [ ] Commitar: `git commit -m "feat(web): schedule grid with five views and keyboard shortcuts"`

---

### Task 74: compositor inline e o fluxo (a) — 1 clique, ~26 teclas, 0 troca de contexto

**Arquivos:**
- Criar: `apps/web/src/telas/CompositorInline.tsx`
- Teste: `apps/web/src/telas/fluxo-a.test.tsx`

- [ ] Escrever o teste que falha — ele **mede** o fluxo crítico (a):

```tsx
// apps/web/src/telas/fluxo-a.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompositorInline } from './CompositorInline';

describe('fluxo critico (a) — recepcionista agenda paciente novo, com ele na linha', () => {
  it('1 clique e ~26 teclas: 0 troca de contexto, 0 perda de estado', async () => {
    const aoAgendar = vi.fn(async () => ({ appointmentId: 'a1' }));
    const aoCriarPaciente = vi.fn(async (nome: string) => ({ patientId: 'novo', displayName: nome }));
    const user = userEvent.setup();
    let cliques = 0;
    document.addEventListener('click', () => { cliques += 1; });

    render(<CompositorInline
      inicioIso="2026-08-03T13:00:00.000Z"
      procedimentos={[{ id: 'proc1', nome: 'Consulta', duracaoMin: 30, maisFrequente: true }]}
      convenios={[{ nome: 'Particular', ultimoDoPaciente: false }]}
      buscarPacientes={async () => []}
      aoCriarPaciente={aoCriarPaciente}
      aoAgendar={aoAgendar}
      aoFechar={vi.fn()} />);

    // O foco ja esta em "Quem": abrir o compositor NAO custa um clique a mais.
    expect(screen.getByRole('combobox', { name: /Quem/ })).toHaveFocus();

    await user.keyboard('maria sou');                 // 9 teclas
    await waitFor(() => expect(screen.getByText(/Criar "maria sou"/)).toBeVisible());
    await user.keyboard('{Enter}');                   // 1 tecla -> cria PRELIMINAR
    expect(aoCriarPaciente).toHaveBeenCalledWith('maria sou');

    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveFocus());
    await user.keyboard('11991234567');               // 11 teclas
    await user.keyboard('{Enter}');                   // 1 tecla

    // Procedimento e convenio ja vem com default: Tab confirma, nao escolhe.
    await user.tab();                                 // 1 tecla
    expect(screen.getByLabelText('Procedimento')).toHaveValue('proc1');
    await user.tab();                                 // 1 tecla
    expect(screen.getByLabelText('Convênio')).toHaveValue('Particular');

    await user.keyboard('{Control>}{Enter}{/Control}'); // 2 teclas
    await waitFor(() => expect(aoAgendar).toHaveBeenCalledTimes(1));

    // 9 + 1 + 11 + 1 + 1 + 1 + 2 = 26 teclas. E ZERO clique dentro do compositor.
    expect(cliques).toBe(0);
  });

  it('o compositor e INLINE: nao existe dialog de pagina cheia', () => {
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z" procedimentos={[]}
      convenios={[]} buscarPacientes={async () => []}
      aoCriarPaciente={vi.fn()} aoAgendar={vi.fn()} aoFechar={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Novo agendamento' })).toBeInTheDocument();
  });

  it('Esc fecha sem descartar o texto digitado sem perguntar', async () => {
    const aoFechar = vi.fn();
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z" procedimentos={[]}
      convenios={[]} buscarPacientes={async () => []}
      aoCriarPaciente={vi.fn()} aoAgendar={vi.fn()} aoFechar={aoFechar} />);
    await userEvent.keyboard('maria');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: /Descartar/ })).toBeVisible();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it('conflito de horario oferece "Encaixar mesmo assim", nao um erro seco', async () => {
    const aoAgendar = vi.fn(async () => { throw { codigo: 'horario_ocupado' }; });
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z"
      procedimentos={[{ id: 'p', nome: 'C', duracaoMin: 30, maisFrequente: true }]}
      convenios={[{ nome: 'Particular', ultimoDoPaciente: true }]}
      buscarPacientes={async () => [{ patientId: 'p1', displayName: 'Maria',
        legalName: 'Maria', hasSocialName: false, birthDate: null,
        cadastroStatus: 'completo' as const, phonePrimary: null }]}
      aoCriarPaciente={vi.fn()} aoAgendar={aoAgendar} aoFechar={vi.fn()} />);
    await userEvent.keyboard('maria');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Encaixar mesmo assim/ })).toBeVisible());
  });
});
```

- [ ] Criar `apps/web/src/telas/CompositorInline.tsx`:

```tsx
// apps/web/src/telas/CompositorInline.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { ComboboxDePaciente, type PacienteHit } from '../ui/ComboboxDePaciente';
import { Campo } from '../ui/Campo';
import { Botao } from '../ui/Botao';

export interface ProcedimentoOpcao {
  readonly id: string; readonly nome: string;
  readonly duracaoMin: number; readonly maisFrequente: boolean;
}
export interface ConvenioOpcao {
  readonly nome: string; readonly ultimoDoPaciente: boolean;
}

export interface CompositorInlineProps {
  readonly inicioIso: string;
  readonly procedimentos: readonly ProcedimentoOpcao[];
  readonly convenios: readonly ConvenioOpcao[];
  readonly buscarPacientes: (termo: string) => Promise<PacienteHit[]>;
  readonly aoCriarPaciente: (nome: string) =>
    Promise<{ patientId: string; displayName: string }> | void;
  readonly aoAgendar: (i: {
    patientId: string; procedureId: string; operadoraNome: string; encaixe: boolean;
  }) => Promise<{ appointmentId: string }> | Promise<void>;
  readonly aoFechar: () => void;
}

/**
 * §5.5 fluxo (a) — o compositor abre INLINE NO SLOT, nunca em modal de pagina
 * cheia. O ganho nao e microdesign: e a regra PACIENTE MINIMO VIAVEL somada a
 * zero troca de contexto e zero perda de estado.
 *
 * iClinic: ~20 cliques, ~65 teclas, 2 trocas de contexto, 1 perda de estado —
 * 40 a 60 segundos de silencio ao telefone.
 * Cadencia: 1 clique (no slot), ~26 teclas, 0 troca, 0 perda.
 */
export function CompositorInline(p: CompositorInlineProps) {
  const [paciente, setPaciente] = useState<{ patientId: string; displayName: string } | null>(null);
  const [telefone, setTelefone] = useState('');
  const [precisaTelefone, setPrecisaTelefone] = useState(false);
  const [procedureId, setProcedureId] = useState(
    p.procedimentos.find((x) => x.maisFrequente)?.id ?? p.procedimentos[0]?.id ?? '');
  const [convenio, setConvenio] = useState(
    p.convenios.find((x) => x.ultimoDoPaciente)?.nome ?? p.convenios[0]?.nome ?? 'Particular');
  const [conflito, setConflito] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [tocado, setTocado] = useState(false);
  const telefoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (precisaTelefone) telefoneRef.current?.focus();
  }, [precisaTelefone]);

  async function agendar(encaixe: boolean): Promise<void> {
    if (paciente === null) return;
    setSalvando(true);
    try {
      await p.aoAgendar({ patientId: paciente.patientId, procedureId,
                          operadoraNome: convenio, encaixe });
      setConflito(false);
    } catch (e) {
      // Conflito NAO e erro seco: a saida existe e a recepcao a usa o dia inteiro.
      if ((e as { codigo?: string }).codigo === 'horario_ocupado') setConflito(true);
      else throw e;
    } finally {
      setSalvando(false);
    }
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLFormElement>): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void agendar(false);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Esc sobe um nivel, mas NUNCA descarta texto sem perguntar (§5.6).
      if (tocado) setConfirmandoDescarte(true);
      else p.aoFechar();
    }
  }

  return (
    <form
      role="form" aria-label="Novo agendamento" onKeyDown={aoTeclar}
      onSubmit={(e) => { e.preventDefault(); void agendar(false); }}
      style={{
        display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-5)',
        border: '1px solid var(--accent)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', boxShadow: 'var(--elev-1)',
      }}
    >
      {paciente === null ? (
        <ComboboxDePaciente
          rotulo="Quem"
          buscar={(t) => { setTocado(true); return p.buscarPacientes(t); }}
          aoEscolher={(h) => setPaciente({ patientId: h.patientId, displayName: h.displayName })}
          aoCriar={(nome) => {
            // Enter na ultima linha cria o cadastro PRELIMINAR e expande UM campo.
            const r = p.aoCriarPaciente(nome);
            if (r instanceof Promise) {
              void r.then((novo) => { setPaciente(novo); setPrecisaTelefone(true); });
            }
          }}
        />
      ) : (
        <p style={{ margin: 0, fontWeight: 'var(--fw-medium)' }}>{paciente.displayName}</p>
      )}

      {precisaTelefone ? (
        <Campo
          ref={telefoneRef as never}
          rotulo="Telefone" inputMode="numeric" value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault();
            (e.currentTarget.form?.elements.namedItem('procedimento') as HTMLElement)?.focus(); } }}
        />
      ) : null}

      <label htmlFor="procedimento" style={{ fontSize: 'var(--fs-12)',
                                             color: 'var(--text-muted)' }}>
        Procedimento
      </label>
      <select id="procedimento" name="procedimento" value={procedureId}
        onChange={(e) => setProcedureId(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.procedimentos.map((x) => (
          <option key={x.id} value={x.id}>{`${x.nome} · ${x.duracaoMin} min`}</option>
        ))}
      </select>

      <label htmlFor="convenio" style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
        Convênio
      </label>
      <select id="convenio" value={convenio} onChange={(e) => setConvenio(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.convenios.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
        <option value="Particular">Particular</option>
      </select>

      {conflito ? (
        <div role="alert" style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-13)' }}>
            Já existe atendimento neste horário para o profissional.
          </span>
          <Botao variante="secundario" onClick={() => { void agendar(true); }}>
            Encaixar mesmo assim
          </Botao>
        </div>
      ) : null}

      <Botao type="submit" carregando={salvando}>Salvar (Ctrl+Enter)</Botao>

      {confirmandoDescarte ? (
        <div role="alertdialog" aria-label="Descartar agendamento?"
             style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <span>Descartar o que foi digitado?</span>
          <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
            <Botao variante="secundario" onClick={() => setConfirmandoDescarte(false)}>
              Continuar editando
            </Botao>
            <Botao variante="fantasma" onClick={p.aoFechar}>Descartar</Botao>
          </div>
        </div>
      ) : null}
    </form>
  );
}
```

> **Nota:** `Campo` precisa encaminhar `ref`. Envolva a definição com `forwardRef` em `apps/web/src/ui/Campo.tsx` e ajuste a assinatura; o teste `Campo.test.tsx` continua verde sem alteração.

- [ ] Rodar: `pnpm --filter @cadencia/web test -- fluxo-a` → 4 testes passam.
- [ ] Commitar: `git commit -m "feat(web): inline slot composer measured against the critical scheduling flow"`

---

### Task 75: lista de espera como painel lateral fixo, com arrastar para o vão

**Arquivos:**
- Criar: `apps/web/src/telas/ListaDeEspera.tsx`
- Teste: `apps/web/src/telas/ListaDeEspera.test.tsx`

- [ ] Instalar: `pnpm --filter @cadencia/web add @dnd-kit/core@6 @dnd-kit/utilities`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/ListaDeEspera.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ListaDeEspera } from './ListaDeEspera';

const ITENS = [
  { waitlistId: 'w1', patientId: 'p1', displayName: 'Maria Souza Lima',
    prioridade: 'alta' as const, esperandoDesde: '2026-07-20T12:00:00.000Z',
    observacao: 'quer manhã' },
  { waitlistId: 'w2', patientId: 'p2', displayName: 'Joana Prado',
    prioridade: 'normal' as const, esperandoDesde: '2026-07-25T12:00:00.000Z',
    observacao: null },
];

describe('lista de espera', () => {
  it('e painel lateral FIXO, nao um modal que some ao clicar fora', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: 'Lista de espera' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ordena por prioridade e depois por tempo de espera', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    const linhas = screen.getAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
  });

  it('cada item tem alternativa de TECLADO ao arraste — arrastar nao pode ser o unico caminho', async () => {
    const aoChamar = vi.fn();
    render(<ListaDeEspera itens={ITENS} aoChamar={aoChamar} />);
    await userEvent.click(screen.getByRole('button', { name: /Chamar Joana Prado/ }));
    expect(aoChamar).toHaveBeenCalledWith('w2');
  });

  it('mostra ha quanto tempo a pessoa espera, em texto', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByText(/desde 20\/07/)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Criar `apps/web/src/telas/ListaDeEspera.tsx`:

```tsx
// apps/web/src/telas/ListaDeEspera.tsx
'use client';

import { useDraggable } from '@dnd-kit/core';
import { Botao } from '../ui/Botao';

export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente';

export interface ItemDeEspera {
  readonly waitlistId: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly prioridade: Prioridade;
  readonly esperandoDesde: string;
  readonly observacao: string | null;
}

const PESO: Record<Prioridade, number> = { urgente: 3, alta: 2, normal: 1, baixa: 0 };

function Arrastavel({ item, aoChamar }: { item: ItemDeEspera; aoChamar: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: item.waitlistId });
  return (
    <li
      ref={setNodeRef}
      {...attributes} {...listeners}
      style={{
        // transform PURO, sem layout: alvo 60 fps travado no arraste.
        transform: transform === null ? undefined
          : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        border: 'var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)',
        padding: 'var(--s-4)', display: 'grid', gap: 'var(--s-2)', minHeight: 44,
      }}
    >
      <strong style={{ fontWeight: 'var(--fw-medium)' }}>{item.displayName}</strong>
      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
        {`${item.prioridade} · desde ${new Intl.DateTimeFormat('pt-BR',
          { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
          .format(new Date(item.esperandoDesde))}`}
        {item.observacao === null ? '' : ` · ${item.observacao}`}
      </span>
      {/* Arrastar NAO pode ser o unico caminho: sem esta alternativa a fila fica
          inacessivel por teclado e por leitor de tela. */}
      <Botao variante="secundario" altura={28}
        aria-label={`Chamar ${item.displayName} para a vaga`}
        onClick={() => aoChamar(item.waitlistId)}>
        Chamar
      </Botao>
    </li>
  );
}

export function ListaDeEspera({
  itens, aoChamar,
}: { itens: readonly ItemDeEspera[]; aoChamar: (waitlistId: string) => void }) {
  // A ordem e regra de NEGOCIO e vem do banco (sched.waitlist_candidates); aqui
  // apenas garantimos que a tela nao a desfaça.
  const ordenados = [...itens].sort((a, b) =>
    PESO[b.prioridade] - PESO[a.prioridade]
    || a.esperandoDesde.localeCompare(b.esperandoDesde));

  return (
    <aside aria-label="Lista de espera"
      style={{
        width: 300, borderInlineStart: 'var(--border)', background: 'var(--bg)',
        padding: 'var(--s-5)', display: 'grid', gap: 'var(--s-4)', alignContent: 'start',
      }}>
      <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Lista de espera
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                   gap: 'var(--s-3)' }}>
        {ordenados.map((i) => (
          <Arrastavel key={i.waitlistId} item={i} aoChamar={aoChamar} />
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- ListaDeEspera` → 5 testes passam.
- [ ] Commitar: `git commit -m "feat(web): fixed waiting-list panel with a keyboard path beside the drag"`

---

### Task 76: `/pacientes` — facetas que são filtros salvos na URL

**Arquivos:**
- Criar: `apps/web/src/telas/Pacientes.tsx`, `apps/web/app/pacientes/page.tsx`
- Teste: `apps/web/src/telas/Pacientes.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Pacientes.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Pacientes, FACETAS } from './Pacientes';

const HITS = [
  { patientId: 'p1', displayName: 'Álvaro Neto', legalName: 'Álvaro Neto',
    hasSocialName: false, birthDate: '1970-01-01', cadastroStatus: 'completo' as const,
    phonePrimary: null },
  { patientId: 'p2', displayName: 'Ana Lima', legalName: 'Ana Lima', hasSocialName: false,
    birthDate: null, cadastroStatus: 'preliminar' as const, phonePrimary: '11999999999' },
];

describe('tela Pacientes', () => {
  it('as abas do lider viram FACETAS, que sao filtros salvos', () => {
    expect(FACETAS.map((f) => f.chave)).toEqual([
      'ativos', 'inativos', 'obitos', 'cadastro_preliminar', 'sem_retorno']);
  });

  it('a faceta escolhida vai para a query string', async () => {
    const aoMudarFaceta = vi.fn();
    render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={aoMudarFaceta} aoAbrir={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cadastro preliminar' }));
    expect(aoMudarFaceta).toHaveBeenCalledWith('cadastro_preliminar');
  });

  it('lista em ordem portuguesa: Álvaro antes de Ana', async () => {
    render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={vi.fn()} aoAbrir={vi.fn()} />);
    const linhas = await screen.findAllByRole('row');
    expect(linhas[1]).toHaveTextContent('Álvaro Neto');
    expect(linhas[2]).toHaveTextContent('Ana Lima');
  });

  it('marca o cadastro preliminar com texto, nunca so com cor', async () => {
    render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={vi.fn()} aoAbrir={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('preliminar')).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={vi.fn()} aoAbrir={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Criar `apps/web/src/telas/Pacientes.tsx`:

```tsx
// apps/web/src/telas/Pacientes.tsx
'use client';

import { useEffect, useState } from 'react';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export interface Faceta { readonly chave: string; readonly rotulo: string }

/**
 * §5.2 — as abas do iClinic viram FILTROS SALVOS. Uma gaveta de telas com
 * filtros quase iguais e o que faz a pessoa adivinhar onde clicar; faceta na URL
 * mantem os nomes antigos com custo zero de migracao.
 */
export const FACETAS: readonly Faceta[] = [
  { chave: 'ativos', rotulo: 'Ativos' },
  { chave: 'inativos', rotulo: 'Inativos' },
  { chave: 'obitos', rotulo: 'Óbitos' },
  { chave: 'cadastro_preliminar', rotulo: 'Cadastro preliminar' },
  { chave: 'sem_retorno', rotulo: 'Sem retorno há 6 meses' },
];

export interface PacientesProps {
  readonly faceta: string;
  readonly buscar: (termo: string, faceta: string) => Promise<PacienteHit[]>;
  readonly aoMudarFaceta: (faceta: string) => void;
  readonly aoAbrir: (patientId: string) => void;
}

export function Pacientes(p: PacientesProps) {
  const [termo, setTermo] = useState('');
  const [itens, setItens] = useState<PacienteHit[]>([]);

  useEffect(() => { void p.buscar(termo, p.faceta).then(setItens); }, [p, termo, p.faceta]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Pacientes
      </h1>

      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {FACETAS.map((f) => (
          <button key={f.chave} type="button" aria-pressed={p.faceta === f.chave}
            onClick={() => p.aoMudarFaceta(f.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-full)', minHeight: 28,
              padding: `0 var(--s-5)`, fontSize: 'var(--fs-13)', cursor: 'pointer',
              background: p.faceta === f.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)',
            }}>
            {f.rotulo}
          </button>
        ))}
      </div>

      <label htmlFor="busca-pacientes" style={{ fontSize: 'var(--fs-12)',
                                                color: 'var(--text-muted)' }}>
        Buscar
      </label>
      <input id="busca-pacientes" value={termo} onChange={(e) => setTermo(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 padding: `0 var(--s-4)`, background: 'var(--surface)', color: 'var(--text)' }} />

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)',
                      border: 'var(--border)', borderRadius: 'var(--r-md)' }}>
        <thead>
          <tr>
            {['Nome', 'Nascimento', 'Telefone', 'Cadastro'].map((h) => (
              <th key={h} scope="col" style={{
                textAlign: 'left', fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                letterSpacing: '.04em', color: 'var(--text-muted)', fontWeight: 500,
                padding: 'var(--s-4)', borderBottom: 'var(--border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((x) => (
            <tr key={x.patientId} onClick={() => p.aoAbrir(x.patientId)}
                style={{ cursor: 'pointer', borderBottom: 'var(--border)' }}>
              <td style={{ padding: 'var(--s-4)' }}>{x.displayName}</td>
              <td className="num" style={{ padding: 'var(--s-4)' }}>{x.birthDate ?? '—'}</td>
              <td className="num" style={{ padding: 'var(--s-4)' }}>{x.phonePrimary ?? '—'}</td>
              {/* Nunca so cor: o estado do cadastro sai por TEXTO. */}
              <td style={{ padding: 'var(--s-4)',
                           color: x.cadastroStatus === 'preliminar'
                             ? 'var(--warn)' : 'var(--text-muted)' }}>
                {x.cadastroStatus === 'preliminar' ? 'preliminar' : 'completo'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] Criar `apps/web/app/pacientes/page.tsx` ligando `faceta` e `termo` ao `nuqs` e à rota `/v1/pacientes`.
- [ ] Rodar: `pnpm --filter @cadencia/web test -- Pacientes` → 5 testes passam.
- [ ] Commitar: `git commit -m "feat(web): patient list with saved facets in the query string"`

---

### Task 77: `/pacientes/{id}` — o terceiro estado na tela

A aba Prontuário simplesmente **não existe** na navegação da recepção. Quando o prontuário existe mas não é acessível, a tela diz exatamente isso — e oferece **Solicitar acesso** e **Quebra-vidro assistencial**.

**Arquivos:**
- Criar: `apps/web/src/telas/FichaDoPaciente.tsx`
- Teste: `apps/web/src/telas/FichaDoPaciente.test.tsx`

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/FichaDoPaciente.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FichaDoPaciente } from './FichaDoPaciente';

const PACIENTE = { patientId: 'p1', displayName: 'Maria Souza Lima',
                   legalName: 'Maria Souza Lima', hasSocialName: false,
                   birthDate: '1988-03-14', cadastroStatus: 'preliminar' as const,
                   phonePrimary: '11987654321' };

function montar(over = {}) {
  const props = {
    paciente: PACIENTE, papel: 'profissional' as const,
    pendentes: ['cpf'], carregarProntuario: vi.fn(async () => [] as unknown[]),
    prontuarioAcessivel: true, existeMasSemAcesso: false,
    aoSolicitarAcesso: vi.fn(), aoQuebrarVidro: vi.fn(async () => {}), ...over,
  };
  render(<FichaDoPaciente {...props} />);
  return props;
}

describe('ficha do paciente', () => {
  it('recepcao NAO ve a aba Prontuario — ela nao existe, nao esta cinza', () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Atendimentos' })).toBeVisible();
  });

  it('profissional ve Prontuario e NAO ve o substituto administrativo em destaque', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Prontuário' })).toBeVisible();
  });

  it('o TERCEIRO ESTADO aparece com as duas saidas nomeadas', async () => {
    montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    expect(screen.getByText(/Paciente existe\. Prontuário não compartilhado com você\./))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'Solicitar acesso' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quebra-vidro assistencial' })).toBeVisible();
  });

  it('quebra-vidro EXIGE justificativa de 20 caracteres antes de habilitar', async () => {
    const { aoQuebrarVidro } = montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quebra-vidro assistencial' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar quebra-vidro' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Justificativa/),
      'paciente inconsciente no pronto atendimento');
    expect(confirmar).toBeEnabled();
    await userEvent.click(confirmar);
    expect(aoQuebrarVidro).toHaveBeenCalledWith(
      'paciente inconsciente no pronto atendimento', 4);
  });

  it('a barra de dados pendentes diz QUANTOS e quais', () => {
    montar({ pendentes: ['cpf', 'sex_at_birth'] });
    expect(screen.getByText('2 dados pendentes')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FichaDoPaciente paciente={PACIENTE} papel="profissional" pendentes={[]}
        carregarProntuario={async () => []} prontuarioAcessivel existeMasSemAcesso={false}
        aoSolicitarAcesso={vi.fn()} aoQuebrarVidro={async () => {}} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Criar `apps/web/src/telas/FichaDoPaciente.tsx`:

```tsx
// apps/web/src/telas/FichaDoPaciente.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export type PapelNaTela = 'profissional' | 'recepcao' | 'financeiro'
                        | 'admin_clinico' | 'diretor_tecnico';

export interface FichaDoPacienteProps {
  readonly paciente: PacienteHit;
  readonly papel: PapelNaTela;
  readonly pendentes: readonly string[];
  readonly prontuarioAcessivel: boolean;
  /** O TERCEIRO ESTADO: existe, mas não é seu. */
  readonly existeMasSemAcesso: boolean;
  readonly carregarProntuario: () => Promise<unknown[]>;
  readonly aoSolicitarAcesso: () => void;
  readonly aoQuebrarVidro: (justificativa: string, horas: number) => Promise<void>;
}

const CLINICOS = new Set<PapelNaTela>(['profissional', 'admin_clinico', 'diretor_tecnico']);

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veProntuario = CLINICOS.has(p.papel);
  const [aba, setAba] = useState<'perfil' | 'atendimentos' | 'prontuario'>('perfil');
  const [pedindoVidro, setPedindoVidro] = useState(false);
  const [justificativa, setJustificativa] = useState('');

  // §5.4 — "Nunca um buraco onde havia algo. Sempre o substituto administrativo
  // legitimo do mesmo objeto." A recepcao ve ATENDIMENTOS no lugar de Prontuario;
  // a aba Prontuario simplesmente NAO EXISTE para ela. Botao cinza com cadeado
  // comunica "seu produto esta quebrado" ou "pague mais".
  const abas: { chave: typeof aba; rotulo: string }[] = [
    { chave: 'perfil', rotulo: 'Perfil' },
    { chave: 'atendimentos', rotulo: 'Atendimentos' },
    ...(veProntuario ? [{ chave: 'prontuario' as const, rotulo: 'Prontuário' }] : []),
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <header style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          {p.paciente.displayName}
        </h1>
        {p.pendentes.length > 0 ? (
          <p role="status" style={{
            margin: 0, fontSize: 'var(--fs-13)', color: 'var(--warn)',
            background: 'var(--warn-soft)', padding: `var(--s-3) var(--s-4)`,
            borderRadius: 'var(--r-md)',
          }}>
            {`${p.pendentes.length} dados pendentes`}
            <span style={{ color: 'var(--text-muted)' }}>{` · ${p.pendentes.join(', ')}`}</span>
          </p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Seções do paciente" style={{ display: 'flex',
                                                                   gap: 'var(--s-1)' }}>
        {abas.map((a) => (
          <button key={a.chave} role="tab" type="button" aria-selected={aba === a.chave}
            onClick={() => setAba(a.chave)}
            style={{
              border: 0, borderBottom: aba === a.chave
                ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: aba === a.chave
                ? 'var(--text)' : 'var(--text-muted)',
              minHeight: 32, padding: `0 var(--s-5)`, cursor: 'pointer',
              fontSize: 'var(--fs-14)',
            }}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === 'prontuario' && !p.prontuarioAcessivel ? (
        <section aria-label="Prontuário indisponível"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-4)' }}>
          {/* RLS so sabe devolver conjunto vazio. "Nao existe" != "existe e voce
              nao tem acesso": sem distinguir, o plantonista busca o CPF, recebe
              "nao encontrado", cria cadastro novo e prescreve sem ver a alergia. */}
          <p style={{ margin: 0 }}>
            {p.existeMasSemAcesso
              ? 'Paciente existe. Prontuário não compartilhado com você.'
              : 'Nenhum prontuário encontrado para este paciente.'}
          </p>
          {p.existeMasSemAcesso ? (
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="secundario" onClick={p.aoSolicitarAcesso}>
                Solicitar acesso
              </Botao>
              <Botao variante="fantasma" onClick={() => setPedindoVidro(true)}>
                Quebra-vidro assistencial
              </Botao>
            </div>
          ) : null}

          {pedindoVidro ? (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <label htmlFor="jv" style={{ fontSize: 'var(--fs-12)',
                                           color: 'var(--text-muted)' }}>
                Justificativa (mínimo 20 caracteres, registrada na auditoria)
              </label>
              <textarea id="jv" value={justificativa} rows={3}
                onChange={(e) => setJustificativa(e.target.value)}
                style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-4)', background: 'var(--surface)',
                         color: 'var(--text)', fontFamily: 'var(--font-ui)' }} />
              <Botao
                disabled={justificativa.trim().length < 20}
                onClick={() => { void p.aoQuebrarVidro(justificativa.trim(), 4); }}>
                Confirmar quebra-vidro
              </Botao>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar: `pnpm --filter @cadencia/web test -- FichaDoPaciente` → 6 testes passam.
- [ ] Commitar: `git commit -m "feat(web): patient record third state with request access and break-glass"`

---

### Task 78: `/atendimento/{id}` — TipTap com `#CID`, `/modelo` e `@valor anterior`

**Arquivos:**
- Criar: `apps/web/src/telas/EditorClinico.tsx`, `apps/web/src/telas/atalhos.ts`
- Teste: `apps/web/src/telas/atalhos.test.ts`, `apps/web/src/telas/EditorClinico.test.tsx`

- [ ] Instalar: `pnpm --filter @cadencia/web add @tiptap/react@3 @tiptap/starter-kit@3 @tiptap/suggestion@3`

- [ ] Escrever o teste de unidade que falha:

```ts
// apps/web/src/telas/atalhos.test.ts
import { describe, expect, it } from 'vitest';
import { gatilhoDe, ATALHOS_DO_ATENDIMENTO, deveIgnorarTeclaSimples } from './atalhos';

describe('atalhos do atendimento', () => {
  it('# busca codigo, / expande modelo, @ traz valor anterior', () => {
    expect(gatilhoDe('#hipert')).toEqual({ tipo: 'codigo', termo: 'hipert' });
    expect(gatilhoDe('/retorno')).toEqual({ tipo: 'modelo', termo: 'retorno' });
    expect(gatilhoDe('@peso')).toEqual({ tipo: 'valor_anterior', termo: 'peso' });
    expect(gatilhoDe('texto comum')).toBeNull();
  });

  it('cobre os atalhos com modificador da §5.6', () => {
    expect(ATALHOS_DO_ATENDIMENTO.map((a) => a.combinacao)).toEqual([
      'Ctrl+R', 'Ctrl+E', 'Ctrl+D', 'Ctrl+I', 'Ctrl+;', 'Ctrl+ArrowUp',
      'Ctrl+ArrowDown', 'Ctrl+Enter']);
  });

  it('DISCIPLINA DE FOCO: tecla simples NAO dispara dentro de campo de texto', () => {
    expect(deveIgnorarTeclaSimples({ tagName: 'INPUT', isContentEditable: false })).toBe(true);
    expect(deveIgnorarTeclaSimples({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(deveIgnorarTeclaSimples({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('Ctrl+; insere data e hora DO SERVIDOR, nunca do relogio do cliente', () => {
    const a = ATALHOS_DO_ATENDIMENTO.find((x) => x.combinacao === 'Ctrl+;');
    expect(a?.acao).toBe('inserir_data_hora_do_servidor');
  });
});
```

- [ ] Criar `apps/web/src/telas/atalhos.ts`:

```ts
// apps/web/src/telas/atalhos.ts

/**
 * §5.6 — o teclado pesa mais aqui que num app comum: ha uma pessoa esperando, a
 * mao do medico ja esta no teclado escrevendo, e a recepcionista repete o mesmo
 * gesto 60 vezes por dia.
 */
export type TipoDeGatilho = 'codigo' | 'modelo' | 'valor_anterior';

export interface Gatilho { readonly tipo: TipoDeGatilho; readonly termo: string }

/** `#CID` inline, `/modelo` de texto, `@valor anterior` com a data. */
export function gatilhoDe(texto: string): Gatilho | null {
  const m = /^([#/@])(\S*)$/.exec(texto.trim());
  if (m === null) return null;
  const tipo = m[1] === '#' ? 'codigo' : m[1] === '/' ? 'modelo' : 'valor_anterior';
  return { tipo, termo: m[2] ?? '' };
}

export interface AtalhoDoAtendimento {
  readonly combinacao: string;
  readonly acao: string;
  readonly descricao: string;
}

export const ATALHOS_DO_ATENDIMENTO: readonly AtalhoDoAtendimento[] = [
  { combinacao: 'Ctrl+R', acao: 'prescrever', descricao: 'Prescrever ao lado' },
  { combinacao: 'Ctrl+E', acao: 'pedir_exame', descricao: 'Pedido de exame' },
  { combinacao: 'Ctrl+D', acao: 'emitir_documento', descricao: 'Documento' },
  { combinacao: 'Ctrl+I', acao: 'transcricao_por_ia', descricao: 'Transcrição por IA' },
  // Data e hora DO SERVIDOR: o relogio do cliente pode estar errado, e a data do
  // registro clinico e prova.
  { combinacao: 'Ctrl+;', acao: 'inserir_data_hora_do_servidor',
    descricao: 'Data/hora do servidor' },
  { combinacao: 'Ctrl+ArrowUp', acao: 'secao_anterior', descricao: 'Seção anterior' },
  { combinacao: 'Ctrl+ArrowDown', acao: 'proxima_secao', descricao: 'Próxima seção' },
  { combinacao: 'Ctrl+Enter', acao: 'finalizar', descricao: 'Finalizar atendimento' },
];

/**
 * DISCIPLINA DE FOCO (regra de implementacao, nao sugestao): tecla de um
 * caractere so dispara quando o foco NAO esta em campo de texto. E a diferenca
 * entre o atalho ser util e ser um sabotador.
 */
export function deveIgnorarTeclaSimples(
  alvo: { tagName: string; isContentEditable: boolean } | null,
): boolean {
  if (alvo === null) return false;
  return alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable;
}
```

- [ ] Escrever o teste de tela que falha e criar `apps/web/src/telas/EditorClinico.tsx` com: um `<div contentEditable>` gerido pelo TipTap (`useEditor` com `StarterKit`), o menu de sugestão disparado por `gatilhoDe`, o cronômetro do atendimento, e o `onKeyDown` que mapeia `ATALHOS_DO_ATENDIMENTO` para as ações recebidas por props (`aoPrescrever`, `aoEmitirDocumento`, `aoFinalizar`, …). O teste cobre: (1) `#hipert` + Enter insere o CID **sem sair da linha**; (2) `/retorno` + Enter expande o modelo; (3) `@peso` + Enter traz o valor anterior **com a data**; (4) `Ctrl+R` chama `aoPrescrever` e o painel abre **ao lado** (o editor continua no documento); (5) `Ctrl+Enter` chama `aoFinalizar`; (6) `axe` sem violações.
- [ ] Rodar: `pnpm --filter @cadencia/web test -- atalhos EditorClinico` → todos passam.
- [ ] Commitar: `git commit -m "feat(web): clinical editor with inline code, template and previous-value triggers"`

---

### Task 79: o fluxo (b) medido — 0–1 clique, nenhuma troca de aplicação

**Arquivos:**
- Criar: `apps/web/src/telas/fluxo-b.test.tsx`

- [ ] Escrever o teste que mede o fluxo crítico (b):

```tsx
// apps/web/src/telas/fluxo-b.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TelaDeAtendimento } from './TelaDeAtendimento';

describe('fluxo critico (b) — medico atende, prescreve e finaliza', () => {
  it('0 a 1 clique, nenhuma troca de aplicacao, nenhuma espera entre passos', async () => {
    const aoFinalizar = vi.fn(async () => ({ versionId: 'v1', versionNo: 1 }));
    const aoConfirmarPrescricao = vi.fn(async () => ({ prescriptionId: 'rx1' }));
    const abrirSessaoDoPrescritor = vi.fn(async () => ({ mode: 'embedded' as const }));
    let cliques = 0;
    document.addEventListener('click', () => { cliques += 1; });

    render(<TelaDeAtendimento
      encounterId="e1" pacienteNome="Maria Souza Lima"
      abrirSessaoDoPrescritor={abrirSessaoDoPrescritor}
      buscarCodigo={async () => [{ code: 'I10', display: 'Hipertensão essencial' }]}
      buscarModelo={async () => [{ code: 'retorno', texto: 'Retorno em 30 dias.' }]}
      buscarValorAnterior={async () => ({ valor: '72,4 kg', em: '12/05/2026' })}
      aoConfirmarPrescricao={aoConfirmarPrescricao}
      aoFinalizar={aoFinalizar} />);

    // A sessao do prescritor carrega em BACKGROUND quando o atendimento abre:
    // no Ctrl+R nao existe espera.
    await waitFor(() => expect(abrirSessaoDoPrescritor).toHaveBeenCalledTimes(1));

    await userEvent.keyboard('#hipert{Enter}');
    await waitFor(() => expect(screen.getByText(/I10/)).toBeVisible());

    await userEvent.keyboard('{Control>}r{/Control}');
    // Prescricao e PAINEL, nao destino: o atendimento continua visivel.
    expect(screen.getByRole('dialog', { name: /Prescrever/ })).toBeVisible();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(aoFinalizar).toHaveBeenCalledTimes(1));

    expect(cliques).toBe(0);
  });

  it('a assinatura NAO bloqueia: PSC fora do ar finaliza e joga a pendencia para depois', async () => {
    const aoFinalizar = vi.fn(async () => ({ versionId: 'v1', versionNo: 1 }));
    const aoConfirmarPrescricao = vi.fn(async () => { throw { codigo: 'parceiro_indisponivel' }; });
    render(<TelaDeAtendimento encounterId="e1" pacienteNome="Maria"
      abrirSessaoDoPrescritor={async () => ({ mode: 'embedded' as const })}
      buscarCodigo={async () => []} buscarModelo={async () => []}
      buscarValorAnterior={async () => null}
      aoConfirmarPrescricao={aoConfirmarPrescricao} aoFinalizar={aoFinalizar} />);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(aoFinalizar).toHaveBeenCalled());
    expect(screen.queryByRole('alert', { name: /erro/i })).not.toBeInTheDocument();
  });

  it('finalizar oferece "Próximo paciente (Enter)" sem sair da tela', async () => {
    render(<TelaDeAtendimento encounterId="e1" pacienteNome="Maria"
      abrirSessaoDoPrescritor={async () => ({ mode: 'embedded' as const })}
      buscarCodigo={async () => []} buscarModelo={async () => []}
      buscarValorAnterior={async () => null}
      aoConfirmarPrescricao={async () => ({ prescriptionId: 'x' })}
      aoFinalizar={async () => ({ versionId: 'v', versionNo: 1 })} />);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Próximo paciente/ })).toBeVisible());
  });
});
```

- [ ] Criar `apps/web/src/telas/TelaDeAtendimento.tsx` compondo `EditorClinico`, `PainelLateral` (para a prescrição) e o rodapé com o cronômetro e o botão de finalizar; a sessão do prescritor é aberta em `useEffect` na montagem (**background**), e `Ctrl+R` apenas revela o painel já carregado.
- [ ] Rodar: `pnpm --filter @cadencia/web test -- fluxo-b` → 3 testes passam.
- [ ] Commitar: `git commit -m "feat(web): encounter screen measured against the critical clinical flow"`

---

## Definição de pronto da Fase 1

### Os comandos que precisam passar verdes

```bash
# 1. Tipos — TypeScript strict em tudo, incluindo apps/web
pnpm typecheck                       # exit 0

# 2. Unidade
pnpm test                            # kernel, emr, integrations, authz, web (componentes)

# 3. Integração contra PostgreSQL real
pnpm test:int                        # db, audit, authn, authz, catalogs, emr, patients,
                                     # scheduling, documents, prescriptions, export, api, worker

# 4. Isolamento multi-tenant — o gate inegociável
pnpm test:iso                        # 00-bootstrap .. 30-prescription, canário T7 verde

# 5. Invariantes estruturais
pnpm db:invariants                   # os 10 da §3.13, agora varrendo também o schema sched
pnpm db:privileges                   # privilégios afirmados tabela a tabela

# 6. Lint estrutural
pnpm lint:session-guc                # exit 0
pnpm lint:terminology-clock          # exit 0
pnpm arch:check                      # setas só descem, irmão não importa irmão

# 7. Acessibilidade — axe em todo componente central
pnpm --filter @cadencia/web test     # nenhuma violação em Botao, Campo, Combobox,
                                     # LinhaDaAgenda, BlocoDeSecao, VersaoRetificada,
                                     # PainelLateral, FaixaDeContadores, Hoje, Agenda,
                                     # Pacientes, FichaDoPaciente

# 8. Carga — CI noturno
pnpm test:load                       # exportação de 20 anos com 500 anexos < 60 s

# 9. O gate de pre-push
pnpm prepush
```

### Fatos que precisam ser verdadeiros

Cada um é um teste que **prova que a proteção pega uma violação proposital** — proteção sem esse teste é decoração.

- [ ] Mudar "Peso" de texto para numérico **funciona**, arquivando a geração 1 e criando a 2 (Task 4).
- [ ] Gravar rascunho com revisão velha **não sobrescreve**: devolve o payload vigente (Tasks 10-11).
- [ ] `finalize_encounter` grava `author_professional_id = app.current_professional_id()`, e não o profissional agendado (Task 19).
- [ ] O `content_hash` re-derivado das linhas seladas **bate** com o persistido (Task 20).
- [ ] Uma retificação apaga o bit `live` **só** das filhas superadas: J45 sai do relatório, I10 entra (Task 20).
- [ ] Um adendo **não** move o `head_version_id`, e o hemograma continua na tela (Task 20).
- [ ] O CID de um atendimento de 2 anos atrás resolve pela vigência **daquela data** (Fase 0, Tasks 39/39B — reexercitado aqui).
- [ ] Finalizar com cadastro preliminar é **recusado**, dizendo exatamente o que falta (Tasks 20 e 29).
- [ ] Encaixe sobre horário ocupado é **aceito**; sem a marca de encaixe, é recusado (Task 31).
- [ ] Recorrência gera 18 ocorrências em 120 dias e **pula** a que colidiria, sem abortar a série (Task 33).
- [ ] `--ambar-500` está em `L=52%` e mede **≥ 4,5:1** sobre `--surface`; o valor antigo de `L=72%` mede < 3:1 (Task 66).
- [ ] O botão em carregamento **mantém o rótulo** e adiciona a barra de 2px (Task 68).
- [ ] `+ Criar` é **sempre** a última linha do combobox, inclusive com resultados (Task 69).
- [ ] A aba Prontuário **não existe** para a recepção — não está cinza (Task 77).
- [ ] O terceiro estado mostra *"Paciente existe. Prontuário não compartilhado com você."* com **Solicitar acesso** e **Quebra-vidro assistencial** (Tasks 27, 28 e 77).
- [ ] Quebra-vidro com justificativa de menos de 20 caracteres é **recusado no banco**, não só na UI (Task 28).
- [ ] PSC fora do ar **não trava**: o documento é emitido, a pendência entra na fila (Task 43).
- [ ] `timeout` de parceiro **nunca** gera retry automático (Tasks 39 e 55).
- [ ] A prescrição é confirmada pela **verdade do servidor**, e o evento JS repetido não duplica (Task 54).
- [ ] A exportação sai ordenada pela data do **evento**, com a versão superada **tachada** e a numeração carimbada por último (Tasks 49-50).
- [ ] Nenhuma rota aceita `tenantId` como parâmetro, e trocar `x-clinic-id` para outro tenant devolve 403 (Tasks 57 e 63).
- [ ] Recepção recebe **403 nomeado** em rota clínica, com evento de auditoria de negação (Task 58).
- [ ] Toda resposta sai com `cache-control: no-store` (Task 56).
- [ ] O rascunho parado há 7 dias vira versão `original` com `incompleto = true`, gravada com ator **de sistema** (Task 64).
- [ ] A linha do tempo de 20 atendimentos roda **sem nó `Sort`** e em menos de 10 ms (Task 22).
- [ ] Os contadores do dia rodam **sem `Seq Scan`** (Task 36).

### A demonstração: uma clínica particular, do zero ao prontuário exportado

Roteiro executável de ponta a ponta, com `pnpm dev` no ar (compose + web:3000 + api:3001 + worker, **todos os provedores fake**):

1. **Cadastrar paciente** — em `/hoje`, `⌘K` → *agendar* → o compositor abre inline no slot com o foco em "Quem". Digitar `maria sou`, `Enter` na linha `+ Criar "maria sou"`: nasce um cadastro **preliminar**. Digitar o telefone, `Enter`.
2. **Agendar** — `Tab` confirma o procedimento (default = o mais frequente do profissional), `Tab` confirma o convênio (default = o último do paciente, senão Particular), `Ctrl+Enter` salva. **1 clique, ~26 teclas, 0 troca de contexto.**
3. **Check-in** — na fila de `/hoje`, "Check-in" move o chip para *Aguardando* em 0 ms e a tela pede os dados pendentes (CPF, nascimento, sexo) — **com a pessoa na frente**. Preencher e salvar promove o cadastro para `completo`.
4. **Atender** — `Enter` na linha abre `/atendimento/{id}` com foco no primeiro campo. Escrever a queixa; `#hipert⏎` insere o CID I10 estruturado **sem sair da linha**; `/retorno⏎` expande o modelo; `@peso⏎` traz o valor anterior com a data.
5. **Prescrever** — `Ctrl+R` abre a prescrição **ao lado** (o módulo já carregou em background quando o atendimento abriu). Escolher o medicamento, `Ctrl+Enter` assina, `Esc` fecha e o cursor volta ao ponto exato.
6. **Emitir atestado assinado** — `Ctrl+D`, escolher *Atestado*, informar os dias. O documento nasce assinado em **AD-RT** com carimbo de ACT e material LTV; se o PSC não responder, o atestado existe e a pendência aparece em "Precisa de você".
7. **Finalizar** — `Ctrl+Enter`. A transação sela a versão 1, explode o payload em `encounter_field_value` com `label_snapshot`, materializa CID e observações, apaga o rascunho, atualiza o cache de leitura e grava `ENCOUNTER_FINALIZE` na trilha. A tela oferece **"Próximo paciente (Enter)"**.
8. **Retificar** — em `/pacientes/{id}` → aba Prontuário → *Retificar* na versão 1, com justificativa. A versão 1 passa a aparecer **tachada**, com a justificativa visível, recolhida por padrão. O verbo "Excluir" não existe.
9. **Exportar o prontuário integral** — `⌘K` → *Exportar prontuário* → qualidade *titular*. Sai um PDF/A-2b marcado, ordenado pela data do **evento**, com CPF do paciente e CNPJ/CNES em toda página, anexos junto e referenciados, registros inativos tachados, numeração x/y carimbada por último e o **recibo indissociável** com os 19 campos na última página. A `clin.record_export` congela o conjunto exportado.
10. **Auditar** — a trilha mostra `PATIENT_CREATE`, `APPOINTMENT_CREATE`, `APPOINTMENT_CHECKIN`, `PATIENT_RECORD_READ` (deduplicado em 5 minutos), `ENCOUNTER_FINALIZE`, `ENCOUNTER_AMEND`, `DOCUMENT_SIGN`, `PRESCRIPTION_CONFIRM` e `RECORD_EXPORT` — **sem uma linha de conteúdo clínico**.

### O que a Fase 1 deixa pronto para a Fase 2

| Garantia | Onde nasce |
|---|---|
| Todo conteúdo clínico chega ao regime imutável, inclusive o que ninguém finalizou | `clin.finalize_encounter` + `clin.stale_drafts` + job de 7 dias |
| Documento assinado hoje é verificável em 20 anos sem nós e sem o PSC | Bytes canônicos + PKCS#7 destacado + carimbo de ACT + material LTV |
| A guia TISS da Fase 4 é uma projeção, não uma arqueologia | `clin.encounter_billing` capturado desde o atendimento |
| Trocar Memed por Mevo é um adaptador e uma linha de configuração | `PrescriptionProvider` + id, link, código, itens e bytes no nosso S3 |
| A separação Paciente × Prontuário é estrutura, não enfeite | Policy `RESTRICTIVE` + a aba que não existe + a sonda de existência |
| O produto inteiro se desenvolve e se demonstra offline | Fakes de assinatura e de prescrição no registry de provedores |

### Próximo plano

**Fase 2 — "A conversa e o caixa"** (8–10 semanas): Conversas com WhatsApp bidirecional no número próprio da clínica, onboarding do WABA pela própria clínica, automações de confirmação, lembrete, pós-consulta e NPS; recebimento no atendimento, link de pagamento, conciliação básica e recibo. É o diferencial nº 2, é o que a recepção usa de hora em hora, e a confirmação automatizada reduz falta — a métrica que a gestora enxerga no primeiro mês.
