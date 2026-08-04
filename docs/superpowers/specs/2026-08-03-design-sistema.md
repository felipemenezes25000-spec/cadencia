# Design — **Cadência**

*O nome vem da tese do produto: a clínica não é organizada por módulos, é organizada por ritmo — o dia de trabalho tem um compasso, e o software ou acompanha ou atrapalha; "cadência" também nomeia exatamente o que falta ao líder de mercado, cuja queixa nº 1 é travamento.*

Repositório: `cadencia/` · Domínio: `cadencia.med.br` · App: `app.cadencia.med.br`

---

## 1. Tese do produto

Cadência é o sistema de prontuário e gestão para clínicas médicas brasileiras de 1 a 30 profissionais que faturam particular e convênio. Entrega a mesma cobertura funcional do líder — agenda, prontuário, financeiro, TISS, relatórios — com três diferenças que são a aposta: **interface que não trava** (orçamento de latência tratado como requisito, medido no cliente e por clínica), **WhatsApp bidirecional no número da própria clínica** (o líder tem notificação unidirecional em número compartilhado) e **suporte humano com nome**.

A aposta central é estrutural, não cosmética: as obrigações regulatórias brasileiras — registro append-only, trilha imutável sem dado clínico, guarda de 20 anos, assinatura ICP-Brasil, isolamento auditável — são invariantes do banco de dados desde a primeira migration. Concorrente que as trate como feature futura precisa reescrever a fundação; nós não. Preço-alvo R$ 89–249 por profissional/mês.

---

## 2. Arquitetura em uma página

### 2.1 Processos

```
                          Internet (BR)
                               │
                    ALB · TLS · sa-east-1 · WAF
              ┌────────────────┼─────────────────┐
      /api/*  │       /hooks/* │       /*        │
   ┌──────────▼───┐   ┌────────▼───┐   ┌─────────▼────┐
   │ api          │   │ api        │   │ web          │
   │ Fastify 5    │   │ (árvore de │   │ Next.js 15   │
   │ sessão+CSRF  │   │  plugin    │   │ standalone   │
   │              │   │  própria:  │   │ SEM DATABASE │
   │              │   │  HMAC)     │   │ _URL na task │
   └──┬────────┬──┘   └─────┬──────┘   └──────────────┘
      │        │            │
      │   pool audit (2 conexões, fora da transação de negócio)
      │        │
 ┌────▼────────▼───────────────────┐        ┌─────────────────────┐
 │ PostgreSQL 18 · Multi-AZ · RLS  │◄───────│ worker              │
 │ schemas: app clin fin tiss ref  │ pg-boss│ pg-boss + Chromium  │
 │          audit rpt pgboss       │        │ + despachante outbox│
 └───────────────┬─────────────────┘        └──────────┬──────────┘
                 │                                     │
          S3 sa-east-1 (SSE-KMS,                Memed · PSC · Meta WA
          chave UUIDv7 opaca,                   PSP · ANS · IA (BR)
          Object Lock GOVERNANCE)
```

**Regras invioláveis da topologia.** (1) Só `api` e `worker` abrem conexão com o banco — `web` não recebe `DATABASE_URL` por task role. (2) Chamada a parceiro sai só do `worker`, disparada pelo outbox; exceção única e documentada: o handshake síncrono da sessão do prescritor (deadline 3 s, fallback explícito na UI). (3) Webhooks e telemetria vivem em prefixos separados (`/hooks/*`, `/telemetry/*`) com **árvore de plugins própria** — não em lista de exceções dentro do plugin de sessão. (4) Nenhuma resposta com dado pessoal é cacheável (`no-store` por hook global, testado).

### 2.2 Grafo de módulos (DAG estrito, verificado no CI)

```
L3  apps         web ──HTTP──► api        worker
                                 │           │
                                 └─────┬─────┘
L2  operação   scheduling  emr  documents  prescriptions  billing
               payments  tiss  messaging  inventory  reports  export
               retention                    (ZERO arestas horizontais)
                                 │
L1  cadastros  identity ─ tenancy ─ people ─ patients ─ catalogs
                                 │
L0  plataforma kernel  db  audit  authn  authz  storage  jobs
               outbox  integrations  events
```

Três regras mecânicas, `dependency-cruiser` no CI:

1. **Setas só descem.** Nenhum import ascendente.
2. **Irmão nunca importa irmão — nem o `index.ts`.** É proibição absoluta, sem exceção. *(Correção da crítica: permitir importar o `index` do irmão para pegar um tipo de evento é o caminho pelo qual o ciclo volta em seis meses.)* Contratos de evento moram em `packages/events`, em L0, sem comportamento e sem dependências.
3. **Composição entre irmãos é responsabilidade de L3.** "Emitir atestado durante o atendimento" é uma rota que lê `emr.snapshotFor(encounterId)` e passa como argumento para `documents.issue(...)`, dentro da mesma transação. Eventos servem para propagação **assíncrona** (billing, tiss, messaging, reports); nunca para dependência síncrona. Sem essa frase escrita, a primeira sprint decide sozinha — e decide errado.

`reports` **não lê matview diretamente** (ver §3.8).

### 2.3 Stack final

| Camada | Escolha | Versão | Por quê em uma linha |
|---|---|---|---|
| Linguagem | TypeScript `strict` + `noUncheckedIndexedAccess` | 5.9 | Uma linguagem para web/api/worker/contratos; os pacotes de auditoria de Laravel/Django gravam diff do modelo, o que a NGS1.07.06 proíbe — o "ganho de meses" não existe |
| Runtime | Node.js LTS | 24 | LTS longo, ESM estável |
| Banco | PostgreSQL gerenciado RDS Multi-AZ, sa-east-1 | 18 | RLS forçado, `EXCLUDE`, particionamento, `pg_stat_statements` |
| Extensões | `pgcrypto`, `btree_gist`, **`btree_gin`**, `pg_trgm`, `unaccent`, `citext`, `pg_partman` | — | `btree_gin` é obrigatório: sem ele não existe índice GIN liderado por `tenant_id` |
| Dados | Drizzle + `pg` Pool | 0.44 / 8.16 | Metade do schema é DDL que ORM não gera; migrations `.sql` legíveis por auditor |
| API | Fastify + `fastify-type-provider-zod` + Swagger | 5 | OpenAPI gerado do mesmo Zod do front; contrato legível fora do TypeScript |
| Fila | `pg-boss` (schema próprio) | 10 | Enfileiramento na mesma transação do domínio: sem job fantasma |
| Front | Next.js App Router + React | 15 / 19 | SSR só para casca; telas quentes são cliente |
| Estado | TanStack Query 5 · RHF 7 · nuqs 2 | — | Cache/otimismo; formulários gigantes sem re-render de árvore; filtro na URL |
| Estilo | Tailwind 4 + tokens CSS + Radix headless | — | Acessibilidade correta, aparência 100% nossa |
| Editor clínico | TipTap (ProseMirror) | 3 | Documento JSON canônico versionável |
| Agenda e gráficos | CSS grid + dnd-kit 6 + react-virtual 3 + visx 3 | — | Sem FullCalendar/Recharts: é a tela mais quente e a que carrega a identidade |
| PDF | Playwright Chromium + `pdf-lib` | — | Paged Media para cabeçalho CNPJ/CNES; `pdf-lib` mescla anexos e **carimba a numeração por último** |
| Cripto | `@node-rs/argon2`, `otpauth` | — | Argon2id nativo, TOTP sem SMS |
| Dinheiro / tempo | centavos inteiros + `dinero.js` v2 · `date-fns` 4 + `@date-fns/tz` | — | Nunca float; nunca `Date` cru |
| Infra | ECS Fargate (3 serviços) · ALB · S3 SSE-KMS · Secrets Manager · Terraform · GH Actions · SES · OTel→CloudWatch | — | Tudo em sa-east-1; sem CDN na frente de HTML/API |

### 2.4 Contradições entre facetas — quem venceu

| Conflito | Decisão | Por quê |
|---|---|---|
| Guia TISS: tabela-projeção 1:1 (dados) × snapshot em evento (módulos) | **Ambas, corrigidas**: guia é tabela persistida com `encounter_version_id`, e `tiss` recebe o snapshot por evento — incluindo o novo `emr.encounter.amended` | Persistência ganha do lado do dado (recurso de glosa precisa reproduzir); fronteira de módulo ganha do lado do código; o evento que faltava é o de retificação |
| Papel na policy: `app.role` escalar (arquitetura) × `app.has_role()` (dados) | **Nenhum dos dois**: papel é resolvido *por linha* via `app.membership` (usuário × clínica × papel) dentro do banco | Médico com papéis diferentes em unidades diferentes é a norma no Brasil; papel escalar por sessão dá acesso total ou nenhum |
| `current_version_id` como "o registro" (dados) × prontuário como histórico (IA) | **IA venceu**: o registro vigente é o *conjunto* de versões não superadas | Adendo cria ramo; ler só o ponteiro faz sumir o hemograma que chegou depois |
| Matviews para relatórios (arquitetura) × isolamento no banco (dados) | **Dados venceu**: matview sem GRANT para a aplicação, exposta por view `security_barrier` com predicado de tenant e de papel | Matview não suporta RLS; expor direto anula a decisão fundadora |
| Contadores do Painel via matview (arquitetura) × "Hoje" é tempo real (IA) | **IA venceu**: contadores do dia são consulta viva sobre índice parcial | Contador defasado é lido como "travou" — a queixa que o produto existe para resolver |
| `emr` esconde o layout do EAV (arquitetura) × definição de campo é parte do registro (dados) | **Dados venceu**: definição de campo é append-only e versionada, e o valor guarda `label_snapshot` + `display_snapshot` | Valor órfão sobrevive, significado não |

---

## 3. Modelo de dados

Convenções universais: `timestamptz(3)`, default `clock_timestamp()`, cluster em UTC com NTP, **fonte de tempo persistido é sempre o Postgres** (o `Clock` do Node serve só para medição e para o componente temporal do UUIDv7). Chaves são UUIDv7 geradas na aplicação. Schemas: `app` (plataforma, agenda, identidade de tenant), `clin` (clínico), `fin`, `tiss`, `ref` (referência global), `audit`, `rpt` (matviews), `id` (identidade global).

### 3.1 Papéis — a fundação

```sql
CREATE ROLE app_owner   NOLOGIN;   -- dono do schema, roda migrations, sem login em runtime
CREATE ROLE app_rw      NOLOGIN;   -- papel funcional da aplicação, sujeito a RLS
CREATE ROLE clin_writer NOLOGIN;   -- único com INSERT no núcleo clínico; funções SECURITY DEFINER
CREATE ROLE audit_owner NOLOGIN;   -- dono exclusivo do schema audit
CREATE ROLE rpt_owner   NOLOGIN;   -- dono das matviews; app_rw não tem GRANT nelas

CREATE ROLE api     LOGIN IN ROLE app_rw;      -- pool da aplicação
CREATE ROLE support LOGIN IN ROLE app_support; -- break-glass, pool separado
CREATE ROLE jobs    LOGIN;                     -- ÚNICO papel com BYPASSRLS

ALTER ROLE api     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE support NOSUPERUSER NOBYPASSRLS;
ALTER ROLE jobs    NOSUPERUSER BYPASSRLS;      -- selo, drift, expurgo, partman, carga TUSS
ALTER ROLE api SET row_security = on;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
```

Invariantes testadas no CI: `api` não é superuser, não tem `BYPASSRLS`, **não é dono de nenhuma relação** (logo não consegue `DISABLE ROW LEVEL SECURITY` nem `DROP POLICY`); `jobs` é o único `rolbypassrls = true` do cluster; toda execução de `jobs` grava evento próprio e tem *dead man's switch* (alarme por **ausência** de execução, não só por erro).

*(Correção da crítica: sem o papel `jobs`, o detector de drift do financeiro e o selo da auditoria — os dois controles compensatórios que sustentam promessas do desenho — rodariam vendo zero linhas e reportando sucesso para sempre.)*

### 3.2 Contexto de transação

```sql
CREATE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app.require_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE t uuid := app.current_tenant_id();
BEGIN IF t IS NULL THEN RAISE EXCEPTION 'contexto de tenant ausente' USING ERRCODE='42501'; END IF;
      RETURN t; END $$;

-- Papel e profissional NÃO vêm do cliente: são DERIVADOS do vínculo, no banco.
CREATE FUNCTION app.current_professional_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT p.id FROM app.professional p
   WHERE p.tenant_id = app.current_tenant_id() AND p.user_id = app.current_user_id() $$;
CREATE FUNCTION app.has_role_in(p_clinic uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.tenant_id = app.current_tenant_id()
                    AND m.user_id = app.current_user_id()
                    AND m.clinic_id = p_clinic AND m.role = ANY(p_roles)
                    AND m.revoked_at IS NULL) $$;
```

O preâmbulo é o **único lugar do sistema que abre transação** (`packages/db/src/tx.ts`):

```ts
export type Actor =
  | { kind: 'user';   tenantId: string; userId: string; clinicId: string; requestId: string }
  | { kind: 'system'; tenantId: string; reason: string; requestId: string }   // worker/outbox
  | { kind: 'anon';   tenantId: string; requestId: string };                  // agendamento online

// SELECT set_config('app.tenant_id',$1,TRUE), set_config('app.user_id',$2,TRUE), ...
```

O `TRUE` é o item mais importante do documento inteiro: com PgBouncer em *transaction mode* a conexão é reciclada entre tenants, e um `SET` de sessão vaza o tenant anterior para a requisição seguinte. Mitigação em quatro camadas: um só lugar abre transação; lint proíbe a string `SET app.` fora dele; teste T5 (sem preâmbulo → zero linhas); **teste T5b para cada tipo de `Actor`** — o ator de sistema e o anônimo não têm `user_id`, e `''::uuid` explode, por isso **toda leitura de GUC usa `nullif(...,'')`**, sem exceção. *(Correção: o desenho original quebrava em 100% dos caminhos de worker, webhook e agendamento online.)*

### 3.3 O padrão de tabela e a RLS real

```sql
CREATE TABLE app.tenant (
  id uuid PRIMARY KEY, slug citext NOT NULL UNIQUE, razao_social text NOT NULL,
  -- IN RFB 2.229/2024 (desde 01/07/2026): CNPJ é ALFANUMÉRICO.
  cnpj varchar(14) NOT NULL CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  -- Lei 13.787/2018 art.6 §5: 20 anos é MÍNIMO. NULL = indefinido. Jamais hard-code 20.
  retencao_anos smallint CHECK (retencao_anos IS NULL OR retencao_anos >= 20),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp());

CREATE TABLE app.clinic (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL, nome text NOT NULL,
  cnpj varchar(14) CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cnes char(7) CHECK (cnes ~ '^[0-9]{7}$'),   -- SEM DEFAULT. Ver §3.9.
  -- Fuso é da UNIDADE, não do tenant: rede SP+Manaus é caso real.
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  PRIMARY KEY (id), UNIQUE (tenant_id, id));

CREATE TABLE clin.patient (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL,
  full_name text NOT NULL,
  nome_social text,                       -- Decreto 8.727/2016: usado em TODA exibição
  identidade_genero text,                 -- separado de sexo ao nascer
  birth_date date,                        -- NULLABLE: ver cadastro preliminar
  sex_at_birth char(1) CHECK (sex_at_birth IN ('M','F','I')),
  phone_primary varchar(20), email citext,
  cadastro_status text NOT NULL DEFAULT 'preliminar'
    CHECK (cadastro_status IN ('preliminar','completo')),
  deceased_at date, inactivated_at timestamptz(3),
  ai_refused_at timestamptz(3),           -- CFM 2.454/2026, no nível do titular
  merged_into_id uuid,                    -- unificação: aponta para o sobrevivente
  search_name text GENERATED ALWAYS AS (app.imm_unaccent(lower(
      coalesce(nome_social, full_name)))) STORED,
  search_digits text,                     -- só dígitos: CPF, telefone (normalizado na app)
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id));

-- CPF é UM identificador entre vários, não O identificador.
CREATE TABLE clin.patient_identifier (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, patient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CPF','CNS','DNV','PASSAPORTE','RG','CARTEIRINHA','SEM_DOCUMENTO')),
  value text NOT NULL, issuer text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id,id));
CREATE UNIQUE INDEX ux_pid ON clin.patient_identifier (tenant_id, kind, value)
  WHERE kind <> 'SEM_DOCUMENTO';
CREATE INDEX ix_patient_busca ON clin.patient USING gin (tenant_id, search_name gin_trgm_ops);
CREATE INDEX ix_patient_digits ON clin.patient (tenant_id, search_digits varchar_pattern_ops);
```

*(Correções aplicadas: recém-nascido, estrangeiro e paciente inconsciente não podem forçar a recepção a inventar CPF — dado inventado contamina gráficos e guias para sempre. O índice de busca é liderado por `tenant_id` via `btree_gin`, senão a recepcionista de uma clínica paga o preço do crescimento da base de todas as outras — o *noisy neighbor* que é exatamente o sintoma de lentidão do líder.)*

**A policy.** Duas camadas, mais uma verificação que o desenho original não tinha:

```sql
ALTER TABLE clin.patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.patient FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.patient AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())   -- 0 linhas se ausente
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());  -- exceção se ausente

CREATE FUNCTION app.is_member() RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id = app.current_user_id()
                    AND m.tenant_id = app.current_tenant_id() AND m.revoked_at IS NULL)
      OR app.current_user_id() IS NULL AND current_setting('app.actor_kind',true)='system' $$;
```

A assimetria é deliberada: leitura **falha fechada em silêncio** (zero linhas é sempre seguro), escrita **falha alto** (INSERT sem tenant é bug que precisa aparecer no Sentry). A checagem de `membership` fecha o buraco real: RLS protege contra `WHERE` esquecido, **não** contra contexto forjado — uma rota que aceite `?tenantId=` e reaproveite o resolvedor entregaria o tenant alheio com todos os testes verdes.

Segunda camada, `RESTRICTIVE` (fazem `AND` com as permissivas — policy nova nunca "abre" acesso), replicada em **todas** as tabelas com conteúdo clínico:

```sql
CREATE FUNCTION app.clinical_scope_all() RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id=app.current_user_id() AND m.tenant_id=app.current_tenant_id()
                    AND m.role IN ('admin_clinico','diretor_tecnico') AND m.revoked_at IS NULL) $$;

CREATE POLICY clinical_scope ON clin.encounter AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()                       -- STABLE: avaliada 1x pelo planner
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id,s.patient_id)=(clin.encounter.tenant_id,
                                                        clin.encounter.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
```

Invariante de CI: **toda tabela em `clin.*` com coluna `patient_id` ou `version_id` tem ao menos uma policy `RESTRICTIVE`.** Sem isso, o controle de compartilhamento é contornável escolhendo outra tabela — lê-se `clin.observation` e sai queixa, CID e sinais vitais de todos os pacientes de outro profissional.

### 3.4 O que impede um bug de aplicação de vazar dados: FK composta

```sql
CREATE TABLE clin.encounter (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, patient_id uuid NOT NULL, professional_id uuid NOT NULL,
  clinic_id uuid NOT NULL, appointment_id uuid,
  occurred_at timestamptz(3) NOT NULL,
  -- Data do EVENTO no fuso da CLÍNICA. Toda derivação diária usa esta coluna,
  -- nunca occurred_at::date. É o que impede a guia sair com a data errada em Rio Branco.
  occurred_date date NOT NULL,
  status clin.encounter_status NOT NULL DEFAULT 'rascunho',
  head_version_id uuid,       -- cache de leitura, NÃO "o registro" (ver §4)
  version_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id,id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id,id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id,id));
```

O par `(tenant_id, patient_id)` só existe se o paciente for **deste** tenant: referência cruzada não é "invisível na leitura", é **violação de integridade referencial na escrita** (`23503`). Regra do projeto verificada no CI: **nenhuma FK de tabela multi-tenant é de coluna única**, e **nenhuma coluna terminada em `_id` que referencie tabela conhecida fica sem FK** — `fin.entry` do desenho original tinha seis colunas assim, e é onde o repasse médico é calculado.

`clin.encounter` **não é livremente atualizável**: `REVOKE UPDATE` total, com `GRANT UPDATE (head_version_id, version_count, status)` apenas para `clin_writer`. `patient_id`, `professional_id`, `clinic_id` e `occurred_at` **entram na serialização canônica que gera o `content_hash`**. Lançar atendimento no paciente errado — o erro mais comum de recepção — não se conserta com `UPDATE`: usa-se `clin.transfer_encounter()`, que cria versão `kind='transferencia'` com justificativa e evento de auditoria.

### 3.5 Persistência clínica append-only

Escolha: **tabela de versões com snapshot integral + cadeia de hash**, não event sourcing puro. O argumento decisivo é jurídico: event sourcing precisaria de uma projeção para atender leitura, impressão e exportação — e essa projeção *seria* a tabela de versões, criando dois artefatos e a pergunta "qual dos dois é o prontuário?". Além disso a assinatura ICP-Brasil cobre um objeto canônico: **a versão é a unidade assinável; o evento não é nada.**

```sql
CREATE TYPE clin.version_kind AS ENUM
  ('original','retificacao','adendo','transferencia','anulacao');

CREATE TABLE clin.encounter_version (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_no int NOT NULL,
  kind clin.version_kind NOT NULL,
  supersedes_version_id uuid,           -- retificação aponta para a que invalida
  justificativa text,                   -- NGS1.12.01: correção EXIGE justificativa
  author_user_id uuid NOT NULL,
  author_professional_id uuid NOT NULL, -- QUEM ESCREVEU, não quem estava agendado
  cosigner_professional_id uuid,        -- residente + preceptor, modelado agora
  cosigned_at timestamptz(3),
  incompleto boolean NOT NULL DEFAULT false,   -- auto-finalização (§4.4)
  finalized_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash)=32),
  prev_hash bytea,
  serializer_version text NOT NULL,     -- fixa qual canonicalizador gerou o hash
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (encounter_id, version_no),
  UNIQUE (supersedes_version_id),       -- 'superada' é DERIVÁVEL, não coluna atualizada
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id,id),
  FOREIGN KEY (tenant_id, supersedes_version_id)
    REFERENCES clin.encounter_version(tenant_id,id),
  CHECK ((version_no=1) = (kind='original')),
  CHECK (kind NOT IN ('retificacao','transferencia','anulacao')
         OR (supersedes_version_id IS NOT NULL AND char_length(btrim(justificativa))>=10)),
  CHECK (kind <> 'adendo' OR supersedes_version_id IS NULL));

-- IMUTABILIDADE POR PERMISSÃO. app_rw NÃO INSERE: só lê.
REVOKE ALL ON clin.encounter_version FROM PUBLIC, app_rw;
GRANT SELECT ON clin.encounter_version TO app_rw;
GRANT INSERT ON clin.encounter_version TO clin_writer;   -- só via SECURITY DEFINER
CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON clin.encounter_version
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
```

*(Correção estrutural: no desenho original o pai era imutável mas os filhos tinham `GRANT INSERT` para a aplicação — nada impedia inserir um campo novo em uma versão de 2027 no ano de 2035. Retirando o INSERT direto e concentrando toda escrita clínica em funções `SECURITY DEFINER` de domínio, "pai selado" passa a valer para o agregado inteiro. A crítica que dizia "não há UPDATE possível para o `amend`" também morre aqui: **não existe UPDATE em lugar nenhum** — a supersessão é derivada da linha nova.)*

Valores por campo, **particionados desde o dia 1** (a válvula de escape declarada no desenho original era inexecutável: a tabela não tinha a coluna de partição e a PK teria que ser recriada em tabela sem `UPDATE`):

```sql
CREATE TABLE clin.encounter_field_value (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, version_id uuid NOT NULL,
  finalized_at timestamptz(3) NOT NULL,     -- copiado da versão: chave de partição
  field_id uuid NOT NULL, field_generation int NOT NULL,
  label_snapshot text NOT NULL,             -- congela o rótulo que o médico viu
  display_snapshot text,                    -- congela a DESCRIÇÃO do código (CID, TUSS, medicamento)
  terminology_version text,                 -- competência da terminologia consultada
  section_instance smallint NOT NULL DEFAULT 1, ordinal int NOT NULL DEFAULT 0,
  value_text text, value_num numeric, value_bool boolean, value_date date,
  value_ts timestamptz(3), value_json jsonb,
  value_ref_source text, value_ref_code text,
  purged_at timestamptz(3),                 -- expurgo legal: ver §3.10
  PRIMARY KEY (finalized_at, id),
  UNIQUE (version_id, field_id, section_instance, ordinal),   -- múltipla escolha = N linhas
  FOREIGN KEY (tenant_id, version_id) REFERENCES clin.encounter_version(tenant_id,id),
  CHECK (purged_at IS NOT NULL OR num_nonnulls(value_text,value_num,value_bool,
         value_date,value_ts,value_json,value_ref_code)=1)
) PARTITION BY RANGE (finalized_at);
CREATE INDEX ix_efv_version ON clin.encounter_field_value (version_id, ordinal)
  INCLUDE (field_id, label_snapshot);
```

*(Duas correções aplicadas: `ordinal` entra na unicidade — sem isso "Comorbidades" com 4 marcações vira `jsonb` e a clínica não consegue listar os diabéticos; e `display_snapshot` estende ao conteúdo codificado o mesmo princípio que motivou o `label_snapshot` — o prontuário de 2027 impresso em 2035 mostra a descrição de CID que estava na tela, não a de 2035.)*

**Rascunho é a única superfície mutável**, com concorrência otimista (o médico dita no celular e digita no desktop):

```sql
CREATE TABLE clin.encounter_draft (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  encounter_id uuid NOT NULL PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  rev int NOT NULL DEFAULT 1,               -- last-write-wins é bug, não simplicidade
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL,
  UNIQUE (tenant_id, encounter_id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id,id));
```

### 3.6 Tabelas de primeira classe e a regra do EAV

Um domínio **sai** do EAV quando: **(a)** é eixo de filtro/agregação de relatório que entregamos; **(b)** é referenciado por norma externa (CID, TUSS, TISS, RNDS); **(c)** tem regra regulatória própria; **(d)** tem ciclo de vida próprio no atendimento.

Primeira classe: `encounter_diagnosis`, `observation` (numéricos promovidos), `encounter_finding` (categóricos promovidos), `encounter_procedure`, `prescription`, `signed_document`, `signature`, `attachment`, `ai_assistance`, `fin.entry`, `tiss.encounter_guia_consulta`. Fica no EAV: queixa, HMA, exame físico, revisão de sistemas, condutas, campos de especialidade, odontograma, curva de crescimento, óculos, DPP/IG, orçamento.

O truque que faz o EAV não custar caro em relatório é **desnormalizar `occurred_date` e `patient_id` nas filhas** — e a **flag derivada `live`**:

```sql
CREATE TABLE clin.encounter_diagnosis (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  code_system text NOT NULL CHECK (code_system IN ('CID10','CID11')),
  code text NOT NULL, display_snapshot text NOT NULL, is_principal boolean NOT NULL DEFAULT false,
  -- BIT DE ÍNDICE, não registro clínico: false quando a versão é superada.
  -- Fora da serialização canônica (invariante de CI). A linha nunca some da auditoria.
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id,id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id,id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id,id));
REVOKE ALL ON clin.encounter_diagnosis FROM PUBLIC, app_rw;
GRANT SELECT ON clin.encounter_diagnosis TO app_rw;
GRANT INSERT, UPDATE (live) ON clin.encounter_diagnosis TO clin_writer;

CREATE INDEX ix_diag_report ON clin.encounter_diagnosis
  (tenant_id, code_system, code, occurred_date DESC)
  INCLUDE (patient_id, professional_id, encounter_id, is_principal) WHERE live;
```

Sem a flag, uma consulta finalizada com J45 e retificada para I10 aparece **nas duas** contagens do relatório "atendimentos por CID", para sempre — e o peso digitado como 700 kg e retificado para 70 kg mostra os dois pontos no gráfico de acompanhamento. A alternativa (anti-join com `encounter_version` em todo relatório) destruiria exatamente a promessa de "um index scan" que justificava tirar esses dados do EAV. O custo honesto: um bit mutável, mantido só dentro da função de retificação, nunca no hash.

Sinais vitais e categóricos usam catálogo global, não texto livre:

```sql
CREATE TABLE ref.observation_code (   -- alinhado ao BR-Core; sem RLS, global
  code text PRIMARY KEY, display text NOT NULL, unit text,
  value_kind text NOT NULL CHECK (value_kind IN ('numeric','coded','text')),
  min_plausible numeric, max_plausible numeric);
-- 'PA' é um campo COMPOSTO que produz DUAS observações (PA_SIS, PA_DIA).
CREATE TABLE clin.record_field_component (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), id uuid NOT NULL,
  field_id uuid NOT NULL, ordinal int NOT NULL,
  observation_code text NOT NULL REFERENCES ref.observation_code(code),
  label text NOT NULL, unit text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id), UNIQUE (tenant_id, field_id, ordinal),
  FOREIGN KEY (tenant_id, field_id) REFERENCES clin.record_field(tenant_id,id));
```

*(Correção: o desenho original promovia para `observation` apenas campos com um único `value_num` — o que exclui pressão arterial, o sinal vital mais medido do país, e deixava `observation_code` como texto livre, fragmentando a série do mesmo paciente entre "PESO" e "peso_kg".)*

### 3.7 Trilha de auditoria

```sql
CREATE SCHEMA audit AUTHORIZATION audit_owner;
CREATE TABLE audit.event (
  id bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  tenant_id uuid,                      -- NULLABLE: tentativa sem contexto também é evento
  clinic_id uuid,                      -- carimbado NO EVENTO, não na hora de exportar
  actor_user_id uuid, actor_kind text NOT NULL,
  event_type text NOT NULL,
  entity_schema text NOT NULL, entity_table text NOT NULL,
  entity_id uuid,                      -- REFERÊNCIA, nunca conteúdo (NGS1.07.06)
  outcome text NOT NULL CHECK (outcome IN ('sucesso','negado','erro')),
  ip inet, session_id uuid, request_id uuid, user_agent_hash bytea,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (occurred_at, id),
  CONSTRAINT meta_sem_pii CHECK (audit.meta_keys_ok(meta))   -- whitelist de chaves
) PARTITION BY RANGE (occurred_at);
CREATE INDEX ix_audit_tenant ON audit.event (tenant_id, occurred_at DESC, id);

REVOKE ALL ON audit.event FROM PUBLIC, app_rw, app_owner;
GRANT SELECT ON audit.event TO app_rw;          -- e nada mais: sem INSERT direto
ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON audit.event AS PERMISSIVE FOR SELECT TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());
-- SEM ESTA POLICY A TRILHA NASCE MORTA: com FORCE RLS o próprio dono é filtrado,
-- e a função SECURITY DEFINER (que roda como audit_owner) não conseguiria inserir.
CREATE POLICY writer ON audit.event AS PERMISSIVE FOR INSERT TO audit_owner WITH CHECK (true);
CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.deny();
```

*(Essa policy de INSERT é a correção mais barata e mais crítica do documento inteiro: sem ela, `finalize_encounter` chama `audit.log`, o INSERT viola a RLS, a transação aborta e **nenhum atendimento pode ser finalizado no primeiro deploy**.)*

**Dois canais de gravação, por razões diferentes:**

| Canal | O quê | Como | Por quê |
|---|---|---|---|
| A — domínio | Finalização, retificação, exportação, envio de lote | Dentro da transação de negócio | O evento só é verdade se a escrita commitou |
| B — segurança e acesso | Login, acesso negado, leitura de prontuário, break-glass, tentativa sem contexto | **Pool dedicado, fora da transação**; buffer em disco se o banco recusar | Evento de negação é o que o auditor procura, e no desenho original ele desaparecia no `ROLLBACK` junto com a transação que falhou |

**Auditoria de leitura**, que o desenho original deixou inteiramente na disciplina de código: acesso clínico passa por `clin.read_encounter()` / `clin.read_patient_record()`, que registram antes de retornar. Granularidade decidida: **um evento por (usuário, paciente, caso de uso), deduplicado em janela de 5 minutos** — não por linha, não por componente, senão a lista virtualizada de 50 pacientes gera 50 INSERTs por scroll e a trilha cresce mais rápido que o domínio. Teste de cobertura por rota: exercita toda rota de leitura clínica e reprova se nenhum evento foi gerado.

**Selo diário** (a única garantia real: dentro do banco, superuser sempre vence `REVOKE`):

```sql
CREATE TABLE audit.seal (
  tenant_id uuid NOT NULL, seal_date date NOT NULL,
  first_id bigint NOT NULL, last_id bigint NOT NULL, row_count bigint NOT NULL,
  chain_hash bytea NOT NULL, prev_chain_hash bytea,
  -- Marca d'água de visibilidade: o dia D só é selado quando não há transação
  -- mais antiga que o início de D+1. Sem isso, um lote TISS que começa 23h58 e
  -- commita 00h03 entra num dia já selado e a verificação futura acusa adulteração.
  snapshot_xmin bigint NOT NULL,
  signed_pkcs7 bytea, sealed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, seal_date));
```

Selo exportado diariamente para bucket com Object Lock em **conta separada**. A promessa honesta não é "imutável", é **"adulteração detectável"**: adulterar exige mexer no Postgres e em um objeto travado em outra conta, e ainda assim quebra a cadeia de forma verificável. Exportação NGS1.07.08 sai de uma view única (CSV via `COPY`, XML via `query_to_xml`), com `clinic_id` **do evento**, `current_setting(..., true)` em toda leitura de GUC, e nome/versão do software vindo de tabela de metadados de deploy — não de GUC de sessão, que faz a view inteira falhar quando ausente.

### 3.8 Relatórios sem furar o isolamento

Matviews vivem em `rpt`, propriedade de `rpt_owner`, **sem nenhum GRANT para `app_rw`**. São expostas por views com barreira:

```sql
CREATE VIEW app_rpt.atendimentos WITH (security_barrier = true) AS
  SELECT * FROM rpt.mv_atendimentos m
   WHERE m.tenant_id = app.current_tenant_id() AND app.is_member()
     AND (app.clinical_scope_all() OR m.professional_id = app.current_professional_id());
GRANT SELECT ON app_rpt.atendimentos TO app_rw;
```

Invariante de CI: **nenhuma matview tem GRANT para `app_rw`**, e o teste de conformidade varre `relkind IN ('r','p','m','v','f')` — no desenho original ele filtrava `'r'`, tornando matview, view e tabela particionada invisíveis ao único controle que deveria pegá-las.

Divisão por horizonte, para o painel não parecer travado:

| Bloco | Fonte | Latência-alvo |
|---|---|---|
| Contadores do dia, aniversariantes, fila | **Consulta viva** sobre índice parcial `(tenant_id, clinic_id, starts_at) WHERE occurred_date = CURRENT_DATE` | < 20 ms |
| Séries históricas, distribuição etária, análises | Matview com refresh incremental por período fechado, **nunca full em horário comercial**, com carimbo "dados até HH:MM" na tela | < 200 ms |

### 3.9 TISS e terminologia versionada

```sql
CREATE TABLE ref.tuss_term (        -- GLOBAL, sem RLS: 200 mil linhas x N clínicas é absurdo
  tabela smallint NOT NULL, codigo varchar(10) NOT NULL, termo text NOT NULL,
  vigencia daterange NOT NULL, competencia char(6) NOT NULL,
  acao text NOT NULL,
  PRIMARY KEY (tabela, codigo, vigencia),
  -- Impossível carregar competência da ANS que sobreponha vigências do mesmo código.
  EXCLUDE USING gist (tabela WITH =, codigo WITH =, vigencia WITH &&));

CREATE FUNCTION ref.tuss_at(p_tabela smallint, p_codigo varchar, p_data date)
RETURNS ref.tuss_term LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM ref.tuss_term
   WHERE tabela=p_tabela AND codigo=p_codigo AND vigencia @> p_data $$;
```

Item 211 do Componente Organizacional: vale a terminologia vigente **na data do atendimento**. Invariante de CI: **nenhuma ocorrência de `now()` ou `current_date` dentro do schema `tiss`**. Carga bimestral (≈97 mil termos) por staging + swap de partição lógica, nunca `UPDATE` em massa com a tabela sendo lida por trigger de gravação de guia.

A guia é **projeção do atendimento**, com os ~14 campos capturados desde a Fase 1 mesmo sem módulo TISS — e, corrigindo o desenho original, **append-only, com autoria e vínculo à versão**:

```sql
CREATE TABLE tiss.encounter_guia_consulta (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), id uuid NOT NULL,
  encounter_id uuid NOT NULL,
  encounter_version_id uuid NOT NULL,     -- de QUAL versão esta guia deriva
  operadora_id uuid NOT NULL, registro_ans char(6) NOT NULL,
  numero_guia_prestador varchar(20) NOT NULL, numero_guia_operadora varchar(20),
  numero_carteira varchar(20) NOT NULL, atendimento_rn boolean NOT NULL,
  codigo_prestador_na_operadora varchar(14),
  cpf_contratado varchar(11), cnpj_contratado varchar(14)
    CHECK (cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cnes char(7) NOT NULL,                  -- SEM DEFAULT '9999999': dado falso vira lote glosado
  conselho_profissional varchar(2) NOT NULL, numero_conselho varchar(15) NOT NULL,
  uf_conselho char(2) NOT NULL, cbos varchar(6) NOT NULL,
  indicacao_acidente char(1) NOT NULL, regime_atendimento char(2) NOT NULL,
  saude_ocupacional char(1), cobertura_especial char(1),
  data_atendimento date NOT NULL,         -- = encounter.occurred_date (fuso da clínica)
  tipo_consulta char(1) NOT NULL,
  codigo_tabela char(2) NOT NULL CHECK (codigo_tabela <> '18'),
  codigo_procedimento varchar(10) NOT NULL,
  valor_procedimento numeric(12,2) NOT NULL CHECK (valor_procedimento >= 0),
  observacao varchar(500),
  live boolean NOT NULL DEFAULT true,     -- reprojeção após amend
  created_by uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero_guia_prestador),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id,id),
  CHECK (num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1));
CREATE UNIQUE INDEX ux_guia_live ON tiss.encounter_guia_consulta (tenant_id, encounter_id)
  WHERE live;
```

Sem coluna de CID: item 32 proíbe a operadora de exigir CID na guia. Ajuste de faturamento (trocar código para casar com a tabela da operadora — prática corriqueira) não sobrescreve: entra em `tiss.guia_ajuste` com motivo e autor, e a divergência prontuário × faturamento fica **visível**, que é o oposto de silenciosa.

Regra de reprojeção após retificação, que o desenho original não tinha caminho para expressar: **lote não enviado → reprojeta; lote já enviado → pendência "guia enviada diverge do prontuário"** com o fluxo de cancelamento/reapresentação. Recurso de glosa sempre cita a versão usada.

`numero_guia_prestador` vem de contador por tenant que **se auto-provisiona e devolve o valor consumido** (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING next_value - 1`) — no desenho original a primeira guia de todo cliente novo retornava `NULL` e falhava.

### 3.10 Financeiro, consentimento e expurgo

```sql
CREATE TABLE fin.daily_rollup (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), clinic_id uuid NOT NULL,
  day date NOT NULL,
  -- DUAS bases: 'competencia' e 'caixa' (paid_at). Fluxo de caixa e extrato são caixa.
  basis text NOT NULL CHECK (basis IN ('competencia','caixa')),
  kind fin.entry_kind NOT NULL,
  category_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',  -- sentinela
  status text NOT NULL, amount numeric(14,2) NOT NULL DEFAULT 0,
  entries int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, clinic_id, day, basis, kind, category_id, status));
ALTER TABLE fin.daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.daily_rollup FORCE  ROW LEVEL SECURITY;
```

*(Duas correções: `category_id` nullable em PK quebra no primeiro recebimento avulso sem categoria — que na recepção brasileira acontece no primeiro dia; e agregar só por competência deixa "Fluxo de caixa" caindo em agregação ao vivo.)* Detector de divergência noturno obrigatório, rodando como `jobs`, com a data da última verificação exibida no painel.

Consentimento — repare no que **não** existe no enum:

```sql
CREATE TYPE app.consent_type AS ENUM ('uso_secundario_pesquisa','marketing_comunicacao',
  'compartilhamento_terceiro','teleconsulta_gravacao','ia_apoio_decisao','uso_de_imagem');
-- NÃO existe 'atendimento'. A base legal da assistência é o art. 11 II f (tutela da saúde).
-- Se o valor não existe no tipo, ninguém consegue escrever o código que bloqueia
-- atendimento esperando aceite: a regra jurídica vive no sistema de tipos.
CREATE UNIQUE INDEX ux_consent_vigente ON app.consent (tenant_id, patient_id, consent_type)
  WHERE is_current;    -- no máximo UMA cadeia vigente por (paciente, tipo)
```

Sem esse índice parcial, o paciente aceita marketing no balcão (linha A) e no portal (linha B), revoga pelo WhatsApp (linha C supersede B) — e continua recebendo mensagens, com registro no próprio sistema provando que revogou.

**Expurgo** (o desenho original prometia retenção configurável e não tinha nenhum caminho técnico, porque `DELETE` está revogado e apagar linhas invalida selos já assinados):

- **Anexos e payloads brutos de parceiro**: *crypto-shredding*. Cada objeto é cifrado com chave de dados envelopada por KEK por tenant. Expurgo = destruir a chave. Os bytes podem continuar em mídia imutável; ficam ilegíveis.
- **Linhas do banco**: `clin.purge_version()` (SECURITY DEFINER, papel próprio, dupla aprovação) anula as colunas de valor, preenche `purged_at`, grava `clin.purge_record` append-only com o hash do que foi removido e anota o selo. A verificação futura distingue **"adulterado"** de **"expurgado conforme política"** — sem isso, cumprir a lei parece fraude.
- Object Lock em modo **GOVERNANCE com prazo finito igual à política do tenant**, não COMPLIANCE indefinido: compliance com retenção infinita cria dado que nem a conta root apaga, contra o próprio módulo de retenção.

### 3.11 Assinatura, documentos, prescrição e anexos

Ausentes do desenho original apesar de "a versão é a unidade assinável" ser a justificativa central de uma decisão marcada como irreversível:

```sql
CREATE TABLE clin.signature (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('encounter_version','document','prescription')),
  subject_id uuid NOT NULL,
  canonical_key uuid NOT NULL,          -- bytes EXATOS que geraram o hash, no S3
  canonical_version text NOT NULL,      -- versão do esquema canônico (JCS/RFC 8785)
  hash_alg text NOT NULL DEFAULT 'SHA-256', hash bytea NOT NULL,
  policy_oid text NOT NULL,
  standard text NOT NULL CHECK (standard IN ('AD_RT','AD_RA')),  -- AD_RB NÃO EXISTE
  psc text NOT NULL, signer_cpf varchar(11) NOT NULL,
  cert_serial text NOT NULL, cert_not_after timestamptz(3) NOT NULL,
  pkcs7 bytea NOT NULL,
  timestamp_token bytea NOT NULL,       -- ACT credenciada: OBRIGATÓRIO, não opcional
  ltv_material_key uuid NOT NULL,       -- cadeia + LCR/OCSP do instante da assinatura
  verified_status text NOT NULL, verified_at timestamptz(3) NOT NULL,
  retimestamped_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id));

CREATE TABLE clin.attachment (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), id uuid NOT NULL,
  patient_id uuid NOT NULL, encounter_id uuid, version_id uuid,
  storage_key uuid NOT NULL,            -- NGS1.06.01: nome não revela conteúdo
  original_name text NOT NULL,          -- no BANCO, nunca no caminho do objeto
  content_type text NOT NULL, size_bytes bigint NOT NULL, sha256 bytea NOT NULL,
  dek_ref text NOT NULL,                -- chave de dados: base do crypto-shredding
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id,id));
```

`clin.prescription` guarda `provider`, `provider_prescription_id`, `patient_link_url`, `validation_code`, itens normalizados, `pdf_key`, `sha256` **e** o vínculo com `clin.signature` — a prescrição só é confirmada se o artefato **assinado** for obtido e verificado do nosso lado. Guardar só o PDF visual com QR que aponta para o domínio do parceiro é ficar refém: dois anos depois, numa ação judicial, o QR não resolve e não há como provar que aquele é o documento assinado.

**AD-RB foi removido do tipo, não deixado como opção**, e `timestamp_token` é `NOT NULL`. Com guarda de 20 anos, assinatura sem carimbo do tempo vira "indeterminada" quando o certificado expira e a AC para de publicar a LCR daquela data — e isso acontece com o **acervo inteiro de uma vez**, sem correção retroativa. Job trimestral: "documentos cuja verificabilidade expira nos próximos 12 meses" → re-carimbo.

### 3.12 Exportação ECF.18 como entidade

```sql
CREATE TABLE clin.record_export (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), id uuid NOT NULL,
  patient_id uuid NOT NULL, requested_by uuid NOT NULL, requester_kind text NOT NULL,
  period_from date, period_to date,
  version_ids uuid[] NOT NULL, attachment_ids uuid[] NOT NULL,  -- conjunto IMUTÁVEL exportado
  page_count int NOT NULL, pdf_key uuid NOT NULL, pdf_sha256 bytea NOT NULL,
  receipt_json jsonb NOT NULL,          -- os ~11 campos do recibo indissociável
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id));
```

Sem isso, o paciente volta em seis meses dizendo que faltou um exame e não há com o que comparar.

### 3.13 O que o CI verifica a cada merge

1. Toda tabela/partição/view/matview em `app clin fin tiss audit` tem `tenant_id`, RLS habilitada, **forçada** e ≥1 policy — exceções declaradas por `COMMENT ON TABLE ... IS 'global-reference'` **em migration revisada com CODEOWNERS**, nunca por `Set` editável em arquivo de teste.
2. Toda FK dessas tabelas é composta e inclui `tenant_id`; toda coluna `*_id` que referencie tabela conhecida **tem** FK.
3. `api` não é superuser, não tem BYPASSRLS, não é dono de relação; `jobs` é o único com BYPASSRLS.
4. Regra genérica (não lista manual): **toda tabela em `clin.*` com coluna `version_id` é append-only** — sem `UPDATE`/`DELETE` para `app_rw`, exceto `UPDATE (live)` para `clin_writer`.
5. Toda tabela em `clin.*` com `patient_id`/`version_id` tem ao menos uma policy `RESTRICTIVE`.
6. Nenhum GRANT direto de INSERT em `audit.event`; nenhum GRANT em `rpt.*` para `app_rw`.
7. Privilégios afirmados tabela a tabela (não só policies): `ALTER DEFAULT PRIVILEGES` não substitui a asserção — tabela nova com policy correta e sem GRANT dá 500 na primeira recepcionista às 8h, e o alarme de rollback por taxa global não dispara.
8. Nenhuma coluna `numeric`/`bigint` chamada `cnpj`; nenhum `now()`/`current_date` em `tiss`; nenhum `::date` sobre `timestamptz` fora de `app.local_date()`; nenhum valor `'atendimento'` em `app.consent_type`; índice de tabela multi-tenant começa por `tenant_id` (inclusive GIN/GiST).
9. `audit.log` executado num teste real insere linha; a suíte inteira reprova se o total de eventos for zero.
10. Matriz CRUD cruzada por tabela descoberta do catálogo, aceitando como sucesso tanto `rowCount = 0` quanto exceção de privilégio (distinguindo os dois no relatório) — e usando coluna sabidamente presente, não `updated_at`.

---

## 4. O motor de prontuário

É o coração e o principal risco: se ficar lento ou perder significado, nada mais importa.

### 4.1 Modelo conceitual

```
ref.record_template (global, versionado)  ──instancia──►  clin.record_section (por tenant)
        │                                                          │
        │                                                    clin.record_field
        │                                                     (append-only,
        │                                                      generation N)
        ▼                                                          │
clin.record_layout_item (ordem e visibilidade POR PROFISSIONAL) ────┘
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        ▼                                                      ▼
clin.encounter_draft (MUTÁVEL, rev otimista)   ──finalizar──►  clin.encounter_version
                                                                (IMUTÁVEL)
                                                                      │
        ┌───────────────┬──────────────┬──────────────┬───────────────┤
        ▼               ▼              ▼              ▼               ▼
 encounter_field_value  diagnosis   observation    finding      ai_assistance
   (narrativa, EAV)     (CID)      (numéricos)   (categóricos)   (CFM 2.454)
```

Catálogo de templates é **global e versionado** (`ref.record_template`), e cada seção do tenant registra de qual template e de qual versão veio. Sem isso, melhorar o modelo de anamnese pediátrica depois de 300 clínicas ativas vira um script que adivinha correspondência por `code`.

### 4.2 Tipos de campo

| Tipo | Slot | Promove para | Observação |
|---|---|---|---|
| `texto_longo`, `texto_curto` | `value_text` | — | Núcleo narrativo; suporta `#`, `/`, `@` inline |
| `numerico` | `value_num` | `observation` se `is_reportable` | `unit` + faixa plausível de `ref.observation_code` |
| `composto` | N linhas | N `observation` | PA → `PA_SIS` + `PA_DIA`; **existe desde o dia 1** |
| `booleano`, `data` | `value_bool`/`value_date` | — | |
| `lista_unica` | `value_ref_code` | `encounter_finding` | Opção referenciável, filtrável |
| `multipla_escolha` | **N linhas** (`ordinal`) | `encounter_finding` | Comorbidades, alergias, hábitos |
| `busca_tabela` | `value_ref_code` + `display_snapshot` | `diagnosis`/`procedure` | CID-10/11, TUSS, medicamento |
| `imc`, `dpp_ig` | `value_num` derivado | `observation` | Calculado no servidor, nunca no cliente |
| `curva_crescimento`, `odontograma`, `oculos`, `orcamento` | `value_json` | — | Prosa estruturada, não eixo de relatório |

**Evolução da definição.** Mudar tipo ou opções **arquiva e cria nova geração** (`generation + 1`); mudar só o rótulo é permitido porque `label_snapshot` já protegeu o passado. Unicidade por índice parcial `WHERE archived_at IS NULL` — sem isso, o gesto mais comum da tela "Seções do prontuário" (mudar "Peso" de texto para numérico para poder ter gráfico) falha com `23505` e o médico vê "erro ao salvar configuração".

### 4.3 Finalizar: a transação que sela

`clin.finalize_encounter(...)` é `SECURITY DEFINER` (roda como `clin_writer`, sujeito a RLS) e faz, em uma transação:

1. `SELECT ... FOR UPDATE` do agregado (RLS já filtrou o tenant).
2. Calcula `version_no`, lê `prev_hash`.
3. Insere a versão com `author_professional_id = app.current_professional_id()` — **quem escreveu**, não quem estava agendado; o plantonista que cobre o titular não pode ser gravado como o titular.
4. Explode o payload em `encounter_field_value` com `label_snapshot`, `display_snapshot`, `terminology_version`, `field_generation`.
5. Materializa primeira classe: CID, observações (inclusive componentes), findings, procedimentos, IA.
6. Se `kind IN ('retificacao','transferencia','anulacao')`: `UPDATE ... SET live = false` nas filhas da versão superada.
7. Gera lançamento financeiro e projeta a guia TISS (se convênio).
8. Apaga o rascunho, atualiza `head_version_id`/`version_count`/`status`.
9. `audit.log('ENCOUNTER_FINALIZE' | 'ENCOUNTER_AMEND' | ...)`.

Depois disso, o conteúdo é imutável **por `REVOKE`, não por convenção**. O `content_hash` cobre: `patient_id`, `professional_id`, `clinic_id`, `occurred_at`, `occurred_date`, todos os valores de campo, os códigos materializados e o `ai_assistance` (modelo, versão, hash da saída, decisão do médico). O que **não** entra: `live`, `head_version_id`, `version_count`.

### 4.4 Rascunho e o atendimento que ninguém finaliza

A obrigação legal recai sobre o registro finalizado; por isso o rascunho é mutável (autosave append-only multiplicaria as escritas por ~100 e comeria a latência de digitação, que é o diferencial vendável). Mas 3–8% dos atendimentos nunca são finalizados, e eles contêm queixa, HMA e exame físico.

**Política decidida:** rascunho parado há **7 dias** é auto-finalizado como versão `kind='original'` com `incompleto = true`, com evento de auditoria e notificação ao profissional. Assim tudo chega ao registro imutável, entra na exportação integral e entra na política de retenção. Nenhum conteúdo clínico fica fora do regime — que é o que aconteceria com 15 mil rascunhos órfãos depois de dois anos.

### 4.5 Histórico: o registro vigente é um conjunto

```sql
CREATE VIEW clin.v_version_status AS
SELECT v.*, (s.id IS NOT NULL) AS superseded, s.id AS superseded_by, s.finalized_at AS superseded_at
FROM clin.encounter_version v
LEFT JOIN clin.encounter_version s ON s.supersedes_version_id = v.id;
```

O prontuário de um atendimento = **todas as versões não superadas, em ordem cronológica**. `head_version_id` é cache da última versão da cadeia base (original/retificação), usado para pré-carregar — nunca como "o registro". Adendo é bloco adicional, não substituto.

O cenário que a correção evita: v1 = consulta; v2 = adendo com hemograma que chegou dois dias depois; v3 = retificação de v1 montada do rascunho reaberto. Lendo só o ponteiro, **o hemograma some da tela do médico na consulta seguinte** — e nada alerta, porque v2 continua na tabela.

Leitura da linha do tempo (20 atendimentos, ~1,1 versões por atendimento, ~40 campos por versão ≈ 900 linhas): `Index Only Scan` em `ix_encounter_hist` → nested loop nas versões vivas → `ix_efv_version` já ordenado. **Sem recursão, sem fold, sem window function, sem `DISTINCT ON`.** Alvo < 10 ms. É o dividendo direto da escolha por tabela de versões.

### 4.6 IA como parte do prontuário

```sql
CREATE TABLE clin.ai_assistance (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(), id uuid NOT NULL,
  encounter_id uuid NOT NULL, version_id uuid, patient_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('transcricao_anamnese','sugestao_cid',
    'resumo_historico','sugestao_conduta','triagem')),
  risk_class text NOT NULL CHECK (risk_class IN ('I','IIa','IIb','III')),
  provider text NOT NULL, model_id text NOT NULL, model_version text NOT NULL,
  residency text NOT NULL CHECK (residency IN ('br','other')),
  input_key uuid,                    -- entrada RECUPERÁVEL sob controle de acesso
  input_hash bytea NOT NULL, output text NOT NULL, output_hash bytea NOT NULL,
  clinician_decision clin.ai_decision NOT NULL DEFAULT 'nao_avaliado',
  decided_by_user_id uuid, decided_at timestamptz(3),
  patient_refused boolean NOT NULL DEFAULT false, refused_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id));
```

Três correções sobre o desenho original: (1) `output_hash` **entra na serialização canônica da versão** — sem isso não dá para provar o que a IA produziu e o que o médico editou; (2) a entrada é recuperável, não só hasheada — hash de entrada não permite auditar alucinação; (3) `version_id` vira `NOT NULL` na finalização e a linha é selada por trigger no mesmo instante. Recusa do paciente é verificada **no adaptador**, antes de o áudio sair do processo, e no banco por trigger — não na UI.

Áudio bruto de consulta é o dado mais sensível do produto: descartado após transcrição confirmada, com retenção máxima de 7 dias e cifrado com a chave do tenant.

---

## 5. Arquitetura de informação

### 5.1 A tese

O iClinic navega pelo **organograma do software**; Cadência navega pelo **relógio do dia de trabalho**. Duas separações estruturais carregam quase todo o ganho:

1. **Paciente (a pessoa) é objeto distinto de Prontuário (o registro clínico).** A recepcionista precisa achar paciente sem poder ver prontuário; no iClinic o único caminho para achar alguém se chama "Prontuários". Separando os objetos, o controle de acesso vira **consequência da estrutura**, e a navegação passa a ser a projeção visível da policy `RESTRICTIVE` do §3.3 — não uma camada de enfeite sobre ela.
2. **A paleta de comandos é navegação primária, não atalho de power user** — porque a recepcionista tem alguém na linha e o médico tem alguém na frente. Latência aqui tem custo social, não só cognitivo.

### 5.2 Navegação

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◈ Cadência  [Clínica Vila Nova ▾]   ⌘K Buscar ou executar…    [RN ▾] │
├──────────────────────────────────────────────────────────────────────┤
│  Hoje │ Agenda │ Conversas ² │ Pacientes │ Financeiro │ Desempenho   │
└──────────────────────────────────────────────────────────────────────┘
     ▲ recepção+profissional   ▲ recepção  ▲ todos   ▲ gestão
   fora da barra (menu do usuário): Ajustes · Auditoria · Ajuda humana
```

A ordem é **cronológica no dia**: o que está acontecendo → o que vai acontecer → com quem estou falando → com quem já falei → o que isso gerou → o que isso significa. Cada persona ocupa um bloco contíguo: recepção 1‑3, profissional 1 e 4, gestão 5‑6. A pessoa aprende três itens, não sete.

| iClinic | Cadência | Movimento | Problema de fluxo que resolve |
|---|---|---|---|
| Painel | **Hoje** | Reformulado | O Painel serve dois donos; recepção às 8h não olha distribuição etária. Hoje = fila de execução, ao vivo; gráficos vão para Desempenho |
| Agenda | **Agenda** | Ampliado | Dia/Semana é pouco com 3+ profissionais e sala compartilhada: entram Mês, Por profissional, **Por sala** |
| Prontuários | **Pacientes** (+ Prontuário como aba) | Cindido | Separa Pessoa de Registro Clínico; a permissão nasce da estrutura |
| Gestão | **Financeiro** + **Desempenho** | Cindido | Transacional diário × investigativo semanal; é a raiz da tripla redundância "Finanças > análises" / "Painel Financeiro" / "Relatórios > análises financeiras" |
| Gestão › TISS | Financeiro › **Convênios** | Rebaixado | Filas de trabalho ("a faturar", "lotes", "glosas"), não a estrutura do padrão |
| 11 relatórios | Desempenho › **Explorar** + visões salvas | Fundido | Uma gaveta de onze telas com filtros quase iguais; visões salvas mantêm os nomes antigos, custo zero de migração |
| Pagamentos | Financeiro › Recebimentos + link no agendamento | Rebaixado | Era destino porque é produto da Afya, não porque é tarefa |
| Outros (Bulas, CID, Contatos) | Paleta + inline + `/referencias` | Eliminado | Ninguém navega até a tabela CID; consulta-se com `#` dentro do texto |
| Outros › Logs | **Auditoria** | Promovido | NGS1.07 não é "outro": é obrigação e argumento de venda |
| Configurações (4 árvores) | **Ajustes** (1 árvore + seletor de escopo) | Achatado | "Convênios" existe em dois escopos; a pessoa adivinha |
| — | **Conversas** | Adicionado | Diferencial nº 2 precisa de endereço |
| — | **Ajuda humana** | Adicionado | Diferencial nº 3, com nome literal para contrastar com "suporte só por IA" |

### 5.3 Mapa de telas

`[P]` permissão clínica · `[$]` financeira · `[A]` auditoria · `⟨plano⟩` gated

```
HOJE → /hoje
├── Faixa ao vivo: agendados · confirmados · aguardando · atendidos · faltas
│    (cada número é um filtro, não um enfeite; consulta viva, nunca matview)
├── Fila do dia — hora · paciente · profissional · procedimento · convênio ·
│    status · sinais (cadastro preliminar, a receber, 1ª vez, teleconsulta)
│    ações: check-in · abrir atendimento [P] · reagendar · cobrar [$] · mensagem
├── Precisa de você: confirmações sem resposta · prescrições não assinadas [P] ·
│    resultados chegados [P] · rascunhos de ontem [P] · guias a faturar [$]
├── Aniversariantes · Nota do dia (era "Observações da agenda")
└── Sala de espera virtual ⟨plano⟩

AGENDA → /agenda
├── Visões: Dia · Semana · Mês · Por profissional · Por sala
├── Compositor inline no slot (nunca modal de página cheia)
├── Lista de espera: painel lateral fixo, arrastar para o vão
├── Bloqueios, ausências, recorrência (materializada, horizonte 120 dias)
└── Imprimir/Exportar (ação da visão atual) · Agendamento online ⟨plano⟩

CONVERSAS → /conversas
├── Caixa de entrada (WhatsApp bidirecional, número da clínica)
│    painel de contexto: agendamentos, pendências, cadastro — nunca clínica
├── Modelos · Automações (confirmação, lembrete, pós-consulta, aniversário, NPS)
└── Envios (absorve "SMS enviados") · Canais e limites

PACIENTES → /pacientes
├── Lista com facetas (ativos, inativos, óbitos, convênio, cadastro preliminar,
│    sem retorno há N meses) — as abas do iClinic viram filtros salvos
└── /pacientes/{id}
    ├── Cabeçalho: nome social · idade · convênio · alertas · ações rápidas
    ├── Perfil (as 3 abas viram uma página com blocos progressivos +
    │    barra "3 dados pendentes")
    ├── Atendimentos          ← o que a RECEPÇÃO vê no lugar do Prontuário
    ├── Prontuário [P] → linha do tempo · evolução · problemas · medicação ·
    │    alergias · exames · prescrições · documentos · arquivos ·
    │    registros de apoio por IA · Exportar integral (ECF.18)
    ├── Financeiro [$] · Consentimentos
    └── /atendimento/{id} [P] — tela de foco, sem barra global

FINANCEIRO [$] → Visão · Caixa · A receber · A pagar · Recebimentos ·
                 Repasse · Convênios (a faturar → lotes → retornos e glosas) · Estoque
DESEMPENHO   → Variações do período · Explorar · Atendimentos · Satisfação · Exportar
AJUSTES      → seletor de escopo (Conta · Clínica · Profissional · Meu perfil), busca única
AUDITORIA [A]→ Trilha · Exportar · Exportações emitidas · Acessos negados ·
               Consentimentos · Retenção e expurgo · Versões retificadas
REFERÊNCIAS  → sem entrada na barra; só pela paleta
```

Todo filtro vira query string (`/pacientes?faceta=inativos&convenio=unimed`), para que um link colado no WhatsApp da equipe abra exatamente a mesma tela.

### 5.4 A regra que impede a navegação de parecer mutilada

> **Nunca um buraco onde havia algo. Sempre o substituto administrativo legítimo do mesmo objeto.**

```
PACIENTE — pela RECEPÇÃO                PACIENTE — pelo MÉDICO
├── Perfil                              ├── Perfil
├── Atendimentos   ← substituto         ├── Prontuário  ← o objeto real
│   data · hora · profissional          │   linha do tempo, evolução,
│   procedimento · convênio             │   problemas, prescrições,
│   status · faturamento                │   exames, arquivos, IA
├── Financeiro                          ├── Financeiro (só o próprio repasse)
└── Consentimentos                      └── Consentimentos
```

Botão cinza com cadeado comunica "seu produto está quebrado" ou "pague mais". A aba Prontuário simplesmente **não existe** na navegação da recepção.

**O terceiro estado, que o desenho original não tinha.** RLS só sabe devolver conjunto vazio, e "não existe" ≠ "existe e você não tem acesso". Sem distinguir, o plantonista busca o CPF, recebe "não encontrado", cria cadastro novo, e prescreve sem ver a alergia que estava no primeiro prontuário. Decidido: função `SECURITY DEFINER` estreita e auditada responde **apenas** "existe paciente com este identificador neste tenant: sim/não", sem conteúdo. A UI mostra *"Paciente existe. Prontuário não compartilhado com você."* com dois botões: **Solicitar acesso** e **Quebra-vidro assistencial** (justificativa obrigatória, prazo, evento de auditoria, notificação ao profissional responsável). A interseção RLS/RBAC não é vazia; é pequena, e está documentada.

### 5.5 Os três fluxos críticos

> Contagens do iClinic são **estimadas** a partir do inventário de navegação, não cronometradas. A comparação sobrevive a ±20% de erro, porque o ganho vem de eliminar **trocas de contexto**, não de economizar cliques.

**(a) Recepcionista agenda paciente novo, com o paciente na linha**

*iClinic:* Agenda → slot → campo paciente → digita → sem resultado → "Cadastrar paciente" → **sai do agendamento** → 6 campos obrigatórios → salvar → volta para a lista de pacientes, **não para o slot** → Agenda → achar o slot de novo → digitar de novo → procedimento, convênio, duração → salvar → (opcional) navegar até SMS.
**≈ 20 cliques · ≈ 65 teclas · 2 trocas de contexto · 1 perda de estado.** 40–60 segundos de silêncio ao telefone. É por isso que recepcionista digita `000.000.000-00`.

*Cadência:*
```
1  clique no slot (ou N, ou ⌘K → "agendar")  → compositor abre inline, foco em "Quem"
2  ~9 teclas "maria sou"  → primeira linha da lista: + Criar "Maria Sou…"
3  Enter        → cria paciente PRELIMINAR e expande um campo
4  ~11 teclas   telefone → Enter
5  Tab → Procedimento (default = mais frequente do profissional)
6  Tab → Convênio (default = último do paciente, senão Particular)
7  Ctrl+Enter   → salva; confirmação por WhatsApp já marcada, dispara sozinha
```
**1 clique · ≈ 26 teclas · 0 troca de contexto · 0 perda de estado.**

O ganho não é microdesign: é a regra **paciente mínimo viável**. Nome + um canal bastam para agendar. CPF, nascimento e convênio viram *dívida de dados*: a linha ganha o sinal `cadastro preliminar`, o check-in pede com a pessoa na frente (momento certo), e **o faturamento de convênio e a finalização do atendimento bloqueiam** (momento em que são de fato obrigatórios). Dado exigido na hora errada é dado falso — e dado falso contamina o gráfico de distribuição etária e o disparo de aniversariantes para sempre.

**(b) Médico atende, prescreve e finaliza**

*iClinic:* Agenda → paciente → prontuário → aba Atendimento → escrever → buscar CID em campo separado → aba Prescrições (**troca de aplicação**, iClinic Rx carrega) → buscar medicamento → posologia → assinar → voltar (**segunda espera**) → documentos → finalizar. **≈ 17 cliques + 2 esperas de carregamento externo.**

*Cadência:*
```
0  já está em Hoje, primeiro paciente selecionado
1  Enter        → abre Atendimento com foco no 1º campo
2  escreve      #hipert⏎ insere CID I10 estruturado sem sair da linha
                /retorno⏎ expande modelo de texto
                @peso⏎    traz o valor anterior com a data
3  Ctrl+R       → prescrição abre AO LADO (atendimento continua visível)
4  "losar"⏎     → medicamento; posologia favorita preenchida
5  Ctrl+Enter   → assina (PSC em nuvem, push no celular: sai hash, volta PKCS#7)
6  Esc          → fecha o painel, cursor volta ao ponto exato
7  Ctrl+Enter   → finaliza; oferece "Próximo paciente (Enter)"
```
**0–1 clique · nenhuma troca de aplicação · nenhuma espera entre passos.**

Três ganhos estruturais: a prescrição é **painel, não destino** e o módulo do parceiro carrega em *background* quando o atendimento abre; o CID é **inline** (estrutura sem pedágio de sair da redação); e a **assinatura não bloqueia** — se o PSC não responde, o atendimento finaliza e a prescrição entra em "Precisa de você". Erro de terceiro nunca vira erro de fluxo.

**(c) Gestora descobre por que o faturamento caiu**

*iClinic:* Painel Financeiro mostra **que** caiu → Relatórios › análises financeiras → Relatórios › faltas → Relatórios › atendimentos realizados → exportar → Excel. **≈ 15 navegações e a resposta é obtida fora do produto.**

*Cadência:*
```
1  ⌘K "desempenho" ⏎
   ┌──────────────────────────────────────────────────┐
   │ Julho 2026 vs Junho 2026                         │
   │ Receita caiu R$ 14.200 (−18%)                 ›  │
   │ Ticket médio subiu R$ 12 (+4%)                ›  │
   │ Ocupação caiu 9 pontos                        ›  │
   └──────────────────────────────────────────────────┘
2  clique na 1ª frase → DECOMPOSIÇÃO em reais:
     faltas e cancelamentos  −R$ 9.800  ██████████
     mix de convênio         −R$ 3.100  ████
     glosas não recuperadas  −R$ 2.400  ███
     ticket médio            +R$ 1.100  ██
3  clique em "faltas" → 37 atendimentos perdidos, agrupados por profissional,
   dia da semana e faixa de horário
     ↳ 22 das 37 são segunda de manhã; 19 sem confirmação respondida
4  AÇÃO na mesma tela: "Ativar confirmação 24h antes para segundas de manhã"
```
**3 cliques até a causa, 1 até a ação.** A diferença de categoria: o líder entrega **visualização**; nós entregamos **atribuição**. Gráfico existe como prova da frase, não como resposta.

### 5.6 Teclado

Pesa mais aqui que num app comum por quatro razões: há uma pessoa esperando; a mão do médico já está no teclado escrevendo; velocidade é onde o líder é mais fraco; e a recepcionista repete o mesmo gesto 60 vezes por dia — é um dos poucos produtos de gestão em que memória muscular realmente se forma.

**Paleta ⌘K — três modos num campo só**, modo inferido do que se digita:

| Prefixo | Modo | Exemplos |
|---|---|---|
| `>` | Fazer | Novo agendamento · Lançar despesa · Gerar lote · Exportar prontuário · Fechar caixa |
| `g`+letra | Ir para | `g h` Hoje · `g a` Agenda · `g c` Conversas · `g p` Pacientes · `g f` Financeiro · `g d` Desempenho |
| `@` | Pessoas | pacientes, profissionais, usuários |
| `#` | Códigos | CID-10/11, TUSS, procedimento |
| `$` | Dinheiro | contas, guias, lotes |
| (nada) | Tudo | ranqueado por relevância e recência |

Comportamentos: abrir vazia mostra as 5 últimas ações e 3 últimos pacientes; a linha do resultado carrega ações secundárias por `→`; **comando indisponível não aparece** (cinza é publicidade de upsell e polui a busca de todo mundo); o resultado é recortado por perfil; **buscar paciente é evento auditável** — ver o nome já é acesso a dado pessoal.

```
Globais    ⌘K paleta · / busca da tela · g+letra ir · n novo contextual ·
           ? atalhos · Esc subir um nível (nunca descarta texto sem perguntar) ·
           ⌘\ recolher navegação
Listas     j/k mover · Enter abrir · . menu do item · x marcar · e ação primária ·
           [ ] período · t hoje · 1..5 visão da agenda
Atendimento #CID inline · /modelo · @valor anterior · Ctrl+R prescrever ·
           Ctrl+E exame · Ctrl+D documento · Ctrl+I transcrição por IA ·
           Ctrl+; data/hora do SERVIDOR · Ctrl+↑↓ seções · Ctrl+Enter finalizar
```

**Disciplina de foco** (regra de implementação, não sugestão): tecla de um caractere só dispara quando o foco **não** está em campo de texto; dentro de campo, só combinações com modificador; `Esc` sai do campo e devolve os atalhos. É a diferença entre o atalho ser útil e ser um sabotador.

---

## 6. Linguagem visual

### 6.1 Tese

**Papel técnico, não dashboard.** A referência não é software de BI nem app de consumo: é um documento clínico bem composto. Consequências: hierarquia por **tipografia e linha**, não por caixa dentro de caixa; sombra só onde há elevação real (popover, modal); cor é **semântica reservada** — quase toda a tela é neutra, e o pouco de cor que existe significa alguma coisa (status, atenção, erro, IA). Densidade alta por padrão, porque a agenda de 3 médicos e o extrato de 200 lançamentos precisam caber. Um acento só: **azul-caneta**, a cor da tinta com que se assina.

Isso é deliberadamente o oposto do iClinic (cartões coloridos, azul-turquesa de fundo, ícones grandes) e do genérico de IA (gradiente roxo, cartões arredondados, glassmorphism).

### 6.2 Tokens

```css
:root {
  /* ── primitivas (OKLCH; fallback hex gerado no build) ─────────────── */
  --tinta-50:  oklch(96.5% 0.014 258);  --tinta-100: oklch(92% 0.030 258);
  --tinta-300: oklch(74% 0.080 258);    --tinta-500: oklch(52% 0.132 258);
  --tinta-600: oklch(45% 0.140 258);    --tinta-700: oklch(38% 0.128 258);
  --papel-0:   oklch(99.2% 0.003 95);   --papel-50:  oklch(97.6% 0.005 95);
  --papel-100: oklch(95.4% 0.006 95);   --papel-200: oklch(91%   0.007 95);
  --papel-300: oklch(84%   0.008 95);   --papel-500: oklch(62%   0.010 95);
  --grafite-700: oklch(38% 0.012 265);  --grafite-800: oklch(30% 0.012 265);
  --grafite-900: oklch(23% 0.012 265);  --grafite-950: oklch(17% 0.012 265);
  --verde-500:  oklch(53% 0.130 155);   --verde-100: oklch(94% 0.040 155);
  --ambar-500:  oklch(52% 0.140 75);    --ambar-100: oklch(95% 0.055 75);
  --rubi-500:   oklch(53% 0.190 25);    --rubi-100:  oklch(94% 0.045 25);
  --violeta-500:oklch(52% 0.150 300);   --violeta-100:oklch(95% 0.040 300);

  /* ── semânticas: claro ────────────────────────────────────────────── */
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

  /* ── espaço, forma, elevação ──────────────────────────────────────── */
  --s-1:2px; --s-2:4px; --s-3:6px; --s-4:8px; --s-5:12px; --s-6:16px;
  --s-7:20px; --s-8:24px; --s-9:32px; --s-10:40px; --s-11:56px;
  --r-sm:3px; --r-md:5px; --r-lg:8px; --r-xl:12px; --r-full:999px;
  --border: 1px solid var(--line);
  --elev-1: 0 1px 2px oklch(0% 0 0 / .06), 0 0 0 1px oklch(0% 0 0 / .04);
  --elev-2: 0 8px 24px oklch(0% 0 0 / .10), 0 0 0 1px oklch(0% 0 0 / .06);

  /* ── tipografia ───────────────────────────────────────────────────── */
  --font-ui:    "IBM Plex Sans", system-ui, sans-serif;
  --font-mono:  "IBM Plex Mono", ui-monospace, monospace;
  --font-doc:   "IBM Plex Serif", Georgia, serif;   /* só PDF e impressão */
  --fs-11:11px; --fs-12:12px; --fs-13:13px; --fs-14:14px; --fs-15:15px;
  --fs-16:16px; --fs-18:18px; --fs-22:22px; --fs-28:28px;
  --lh-tight:1.25; --lh-ui:1.45; --lh-read:1.6;
  --fw-regular:400; --fw-medium:500; --fw-semibold:600;
  --num-tabular: "tnum" 1, "lnum" 1;

  /* ── movimento ────────────────────────────────────────────────────── */
  --dur-1:90ms; --dur-2:140ms; --dur-3:200ms;
  --ease-out: cubic-bezier(.2,.8,.2,1);
  --ease-in-out: cubic-bezier(.4,0,.2,1);

  /* ── foco e camadas ───────────────────────────────────────────────── */
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
:root[data-theme="dark"] { /* mesmas sobrescritas, aplicadas pelo seletor manual */ }
```

### 6.3 Tipografia

**IBM Plex Sans** para interface, **IBM Plex Mono** para códigos (CID, TUSS, número de guia, valores em colunas), **IBM Plex Serif** só no PDF impresso. A escolha não é estética pura: Plex tem diacríticos portugueses desenhados com cuidado (til, cedilha, circunflexo em caixa alta), tem versão mono metricamente compatível, e é uma família técnica — o oposto do Inter/Poppins que fazem tudo parecer o mesmo produto.

| Papel | Tamanho / peso / entrelinha | Onde |
|---|---|---|
| Título de tela | 22 / 600 / 1.25 | "Hoje, quarta 3 de agosto" |
| Título de seção | 15 / 600 / 1.3, `letter-spacing: .01em` | Blocos do prontuário |
| Corpo de UI | 14 / 400 / 1.45 | Padrão |
| **Texto clínico** | **15 / 400 / 1.6** | Área de escrita e leitura do prontuário — maior de propósito: é onde o médico passa o tempo |
| Rótulo de campo | 12 / 500 / 1.3, `--text-muted` | |
| Dado tabular | 13 / 400 / 1.4, `font-variant-numeric: tabular-nums` | Financeiro, relatórios |
| Código | 13 mono / 400 | CID, TUSS, guia |
| Micro | 11 / 500, caixa alta com `.04em` | Cabeçalho de tabela, status |

Números **sempre** tabulares em coluna. Valor monetário alinhado à direita, com o símbolo em `--text-faint`.

### 6.4 Componentes centrais

**Botão** — três variantes (primário sólido `--accent`, secundário com `--border`, fantasma), três alturas (`28 / 32 / 40`), raio `--r-md`, peso 500. Sem gradiente, sem sombra em botão. Estado de carregamento **não troca o rótulo por spinner**: mantém o texto e adiciona uma barra de progresso indeterminada de 2px na base — trocar o rótulo é o que faz o usuário perder o lugar.

**Campo** — altura 32 (denso) / 40 (formulário), `--border`, foco = `--focus-ring` + borda `--accent`. Erro: borda `--danger`, mensagem abaixo com `aria-describedby`, **nunca** só cor vermelha. Rótulo sempre visível (placeholder não é rótulo).

**Combobox de busca de paciente** — o componente mais importante do produto.
```
┌───────────────────────────────────────────────────┐
│ 🔍 maria sou                                   ⌘K │
├───────────────────────────────────────────────────┤
│ MARIA SOUZA LIMA          38a · Unimed         →  │  ← nome social em destaque
│   próx.: 12/08 14:00 · Dr. Alceu                  │
│ MARIA SOUSA               52a · Particular     →  │
│ ─────────────────────────────────────────────     │
│ + Criar "maria sou…"                       Enter  │  ← sempre a última linha
└───────────────────────────────────────────────────┘
```
Debounce 120 ms, resposta otimista do cache local, `aria-activedescendant`, `→` abre ações secundárias. Alvo: **primeira tecla → primeiro resultado em < 120 ms p75**, medido por RUM.

**Linha da agenda** — barra de status de 3px na borda esquerda (**forma**, para daltônicos) + fundo `--surface` + hover `--surface-hover`. Encaixe recebe hachura diagonal a 45°, não outra cor. Bloqueio é listrado em `--papel-200`. Arraste: a linha ganha `--elev-2` e o slot de destino ganha borda tracejada `--accent`.

**Bloco de seção do prontuário** — sem card: um título 15/600, uma régua de 1px `--line` abaixo, e o conteúdo. Seção vazia colapsa em uma linha de 24px com o título em `--text-faint`, clicável. Isso é o que permite ter 14 seções configuradas sem a tela virar um acordeão infinito.

**Versão retificada** — o requisito da NGS1.12 vira componente:
```
┌ ── ⟨ versão 1 · retificada em 12/05/2027 por Dr. Alceu ⟩ ─────────── ▾ ┐
│  Queixa: c̶e̶f̶a̶l̶e̶i̶a̶ ̶h̶á̶ ̶3̶ ̶d̶i̶a̶s̶                                        │
│  Justificativa: "digitado no paciente errado durante a consulta"      │
└──────────────────────────────────────────────────────────────────────┘
```
Fundo `--surface-sunken`, texto `--text-muted`, `text-decoration: line-through` com `text-decoration-color: var(--danger)`, recolhido por padrão. **O verbo "Excluir" não existe no vocabulário do produto** para registro finalizado — só "Retificar" e "Adendo". Remover o verbo é mais barato que explicar a regra mil vezes.

**Chip de status** — 11px caixa alta, `--r-full`, fundo soft + texto na cor forte, **mais um glifo** (✓ ✕ ⏱ ●). Cor nunca sozinha.

**Painel lateral (compositor)** — 420px, entra por `translateX` em 140 ms, escurece o fundo em 8% sem borrar (blur custa GPU e a tela de trás precisa continuar legível: o médico consulta o texto do atendimento enquanto prescreve). `Esc` fecha e devolve o cursor à posição exata.

**Faixa de contadores (Hoje)** — seis números em 28/600 com rótulo 11 caixa alta, separados por régua vertical de 1px. Cada um é um `<button>` que filtra a fila. Atualização por `aria-live="polite"`.

### 6.5 Movimento

Doutrina: **animação só comunica mudança de estado; nunca anuncia chegada de conteúdo.**

| Situação | Regra |
|---|---|
| Mutação (check-in, arrastar, marcar falta) | Otimista, aplicada em 0 ms; reversão animada em 200 ms com toast se falhar |
| Resposta < 200 ms | **Nada.** Sem spinner, sem skeleton — piscar é pior que esperar |
| Resposta 200 ms–1 s | Barra indeterminada de 2px no topo da região |
| Resposta > 1 s | Skeleton com a **forma real** do conteúdo |
| Entrada de lista/tabela | Sem stagger, sem fade-in. Lista que "monta" parece lenta |
| Painel/modal | 140 ms `--ease-out` na entrada, 90 ms na saída |
| Troca de status | Cor e glifo cruzam em 140 ms |
| Arraste na agenda | `transform` puro, sem layout; alvo 60 fps travado |
| `prefers-reduced-motion` | Todas as durações → 1 ms; nenhuma transição de posição |

### 6.6 Acessibilidade

Meta: **WCAG 2.2 AA**, verificada em CI (axe no Playwright) e por revisão manual de teclado a cada release.

- Contraste ≥ 4.5:1 texto, ≥ 3:1 elementos de UI e foco — os tokens acima foram escolhidos em OKLCH justamente para manter a razão em ambos os temas.

  **Verificação medida (não declarada).** Conversão OKLCH → sRGB → luminância relativa, contra `--surface` em cada tema:

  | Token | Claro | Escuro |
  |---|---|---|
  | `--text` | 16,51:1 ✓ AAA | 14,61:1 ✓ AAA |
  | `--text-muted` | 6,39:1 ✓ AA | 6,81:1 ✓ AA |
  | `--text-faint` | 3,56:1 ✓ AA grande/UI | 3,94:1 ✓ AA grande/UI |
  | `--accent` | 7,39:1 ✓ AAA | 6,79:1 ✓ AA |
  | `--ok` | 4,85:1 ✓ | 7,19:1 ✓ AAA |
  | `--warn` | **5,49:1 ✓** *(corrigido)* | 8,89:1 ✓ AAA |
  | `--danger` | 5,69:1 ✓ | 5,92:1 ✓ |
  | `--ai` | 5,76:1 ✓ | 6,54:1 ✓ |

  `--text-faint` é reservado a texto ≥ 18px ou não essencial (símbolo monetário, metadado); nunca a rótulo ou valor. `--line` fica em ~1,3:1 por projeto — é divisória decorativa, fora do escopo do 1.4.11, que rege elementos necessários para *identificar* um controle. Fronteira de controle usa `--line-strong`.

  > **Defeito encontrado e corrigido nesta revisão:** `--ambar-500` estava em `oklch(72% 0.150 75)`, que dá **2,48:1** sobre `--surface` no tema claro — reprovado até para elemento de UI. Como é a cor do status *Aguardando*, que a recepção lê o dia inteiro, o valor foi corrigido para `oklch(52% 0.140 75)`, verificado em 5,49:1 sobre `--surface`, 5,24:1 sobre `--bg` e 4,77:1 sobre `--ambar-100` (fundo do chip). O tema escuro já passava e não mudou.
  >
  > Lição registrada para a implementação: **razão de contraste é medida, nunca inferida do valor de luminosidade do OKLCH.** `L=72%` parece claro o suficiente para passar e não passa em hue amarelo, porque a luminosidade perceptual do OKLCH não é a luminância relativa da WCAG. O CI precisa calcular, não confiar.
- Foco visível em **tudo**, com anel duplo (halo da superfície + anel de acento) que funciona sobre qualquer fundo.
- Alvo mínimo 24×24 px (2.2 AA); 44×44 no modo toque.
- Ordem de tabulação segue a ordem visual; painel lateral e modal fazem *focus trap* e devolvem o foco à origem.
- Cor nunca é o único portador: status tem glifo, versão retificada tem tachado e rótulo, erro tem texto.
- `aria-live="polite"` para contadores e chegada de mensagem; `assertive` só para falha de assinatura e perda de conexão.
- Formulários: rótulo associado, erro com `aria-describedby`, `aria-invalid`, e foco no primeiro campo inválido.
- Zoom 200% sem perda de função; a agenda vira lista vertical abaixo de 640px.
- PDF da exportação sai **marcado (PDF/UA) e em PDF/A-2b** — é documento que vai para tribunal e para fiscalização.

---

## 7. Integrações atrás de interface

Contrato comum (`packages/integrations/src/contracts/common.ts`):

```ts
export type Rfc3339 = string & { readonly __brand: 'Rfc3339' };   // UTC, com ms
export type E164 = string & { readonly __brand: 'E164' };
export type StorageKey = string & { readonly __brand: 'StorageKey' };

/** Retryability é propriedade da OPERAÇÃO, não do erro. */
export type Safety = 'safe' | 'idempotent' | 'unsafe';

export interface ProviderCtx {
  tenantId: string; actorUserId: string | null; requestId: string;
  idempotencyKey: string;      // estável por agregado + intenção
  deadlineMs: number;
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
  readonly capabilities: ReadonlySet<string>;   // inclui 'residency:br' quando aplicável
  readonly safety: Readonly<Record<string, Safety>>;   // por método, obrigatório
  health(): Promise<{ up: boolean; latencyMs: number; checkedAt: Rfc3339 }>;
}
```

**A garantia comum, e a correção mais cara do documento.** Timeout **nunca** gera retry automático em operação `unsafe`: gera estado `indeterminado` persistido e agenda **reconciliação** — o job consulta o parceiro (`getPayment`, `fetchPrescription`, busca por `idempotencyKey`) e só reenvia se confirmar que não houve efeito. Sem isso: três WhatsApps idênticos às 7h da manhã degradando a qualidade do número **próprio da clínica** (o diferencial nº 2), estorno em dobro, lote TISS glosado por duplicidade. Teste de conformidade obrigatório por adaptador: simula timeout-com-efeito e afirma que nada duplicou.

`rawArchiveKey` é **classificado**, não universal: chamadas com dado pessoal são arquivadas com TTL de 90 dias e **linha de índice `raw_archive(tenant_id, subject_ref, key)`** para que o expurgo alcance; eventos de status de alto volume não são arquivados; artefatos juridicamente relevantes (assinatura, lote, pagamento) ficam pelo prazo do tenant, cifrados com a chave do tenant. Sem a classificação, o arquivo bruto vira um repositório sombra do prontuário sem RLS, sem trilha e sem retenção — e o paciente "expurgado" continua legível no S3.

**Todo contrato tem um `fake`** em `src/fakes/`, usado nos testes e no tenant de demonstração: o produto inteiro se desenvolve offline.

```ts
/* 7.1 PrescriptionProvider — Memed. É provedor EMBUTIDO, não cliente HTTP. */
export interface PrescriptionProvider extends Provider {
  // safety: openPrescriberSession = 'idempotent', fetch* = 'safe'
  openPrescriberSession(ctx: ProviderCtx, i: {
    professional: { fullName: string; cpf: string; council: 'CRM'|'CRO'; number: string; uf: string };
    patient: { fullName: string; birthDate?: string; cpf?: string; phone?: E164 };
    encounterId: string;
  }): Promise<ProviderResult<{
    mode: 'embedded'; scriptUrl: string;
    token: string; expiresAt: Rfc3339;      // DINÂMICO: adapter recusa servir vencido
    patientPayload: Record<string,string>; correlationId: string;
  }>>;
  /** Verdade server-side. O browser só informa um id. */
  fetchPrescription(ctx: ProviderCtx, i: { providerPrescriptionId: string }):
    Promise<ProviderResult<PrescriptionRecord>>;
  /** Artefato ASSINADO (PDF com assinatura embarcada ou PKCS#7 destacado). */
  fetchSignedArtifact(ctx: ProviderCtx, i: { providerPrescriptionId: string }):
    Promise<ProviderResult<{ bytes: Uint8Array; sha256: string; detachedP7s?: Uint8Array }>>;
}
```
**Garante:** toda prescrição já emitida continua sendo exibida, impressa, exportada e anexada ao lote mesmo se a Memed sumir, porque id, link, código, itens normalizados **e os bytes assinados** estão no nosso S3 desde a emissão. `confirm()` **só aceita** a prescrição se conseguir o artefato assinado **e** validá-lo por `SignatureProvider.verify()`, persistindo cadeia e OCSP do momento (LTV). Se o parceiro não entregar artefato verificável, isso é um achado de conformidade a decidir **agora**, não uma surpresa em 2028. Trocar para Mevo é um segundo adaptador e uma linha de configuração por tenant.

```ts
/* 7.2 SignatureProvider — PSC em nuvem. AD_RB NÃO EXISTE no tipo. */
export type SignaturePolicy = 'AD_RT_CAdES_2.4' | 'AD_RA_CAdES_2.4';
export interface SignatureProvider extends Provider {
  authorizeSigner(ctx: ProviderCtx, i: { userId: string; redirectUri: string }):
    Promise<ProviderResult<{ authorizationUrl: string; state: string }>>;
  completeAuthorization(ctx: ProviderCtx, i: { state: string; code: string }):
    Promise<ProviderResult<{ signerRef: string; certificate: CertificateInfo; expiresAt: Rfc3339 }>>;
  /** Assina o HASH do payload canônico; a chave privada nunca sai do HSM. */
  sign(ctx: ProviderCtx, i: { signerRef: string; otp?: string; documents: Array<{
      documentId: string; hashAlgorithm: 'SHA-256'; hashBase64: string;
      canonicalPayloadKey: StorageKey; canonicalVersion: string;
      policy: SignaturePolicy; detached: true; }> }):
    Promise<ProviderResult<Array<{ documentId: string; signatureP7s: Uint8Array;
      signedAt: Rfc3339; timestampToken: Uint8Array;      // OBRIGATÓRIO
      ltvMaterial: Uint8Array; }>>>;
  verify(i: { canonicalPayload: Uint8Array; signatureP7s: Uint8Array; at?: Rfc3339 }):
    Promise<ProviderResult<{ status: 'valida'|'invalida'|'indeterminada';
      chainOk: boolean; revocationOk: boolean; timestampOk: boolean; reasons: string[] }>>;
  retimestamp(ctx: ProviderCtx, i: { signatureId: string }): Promise<ProviderResult<{ token: Uint8Array }>>;
}
```
**Garante:** porque assinamos o hash de uma serialização canônica **nossa** (JCS/RFC 8785, com `canonicalVersion` gravado ao lado) e guardamos os bytes canônicos + PKCS#7 destacado + carimbo + material LTV, qualquer verificador ICP-Brasil valida o documento daqui a 20 anos sem nós e sem o PSC. Pré-condição em código, **mensurável**: `sign()` compara o relógio do processo com `now()` do Postgres e recusa se o desvio exceder 500 ms — "consultar o NTP do host" não é implementável em Fargate, e uma pré-condição que não pode ser medida não existe.

```ts
/* 7.3 MessagingProvider — WhatsApp/SMS/e-mail, número PRÓPRIO da clínica */
export interface MessagingProvider extends Provider {
  readonly channel: 'whatsapp'|'sms'|'email'; readonly supportsInbound: boolean;
  registerChannelIdentity(ctx: ProviderCtx, i: { displayName: string; phone: E164; wabaRef?: string }):
    Promise<ProviderResult<{ channelIdentityRef: string; status: 'pending'|'verified'|'rejected' }>>;
  send(ctx: ProviderCtx, i: { channelIdentityRef: string; to: E164|string;
    body: OutboundBody; conversationId: string }):   // NOSSO id, não o do parceiro
    Promise<ProviderResult<{ providerMessageId: string }>>;   // safety: 'unsafe'
  findByIdempotencyKey(ctx: ProviderCtx, i: { key: string }):
    Promise<ProviderResult<{ providerMessageId: string } | null>>;   // reconciliação
  verifyWebhook(raw: Buffer, headers: Record<string,string>): { valid: boolean; reason?: string };
  parseInbound(raw: Buffer): InboundEvent[];
  fetchMedia(ctx: ProviderCtx, i: { providerMediaId: string }):
    Promise<ProviderResult<{ bytes: Uint8Array; mime: string; sha256: string }>>;
}
```
**Garante:** o webhook grava o payload bruto em `inbound_event` (append-only) **antes** de parsear — bug de parser não perde mensagem de paciente. Conversas, mídias e status vivem no nosso banco, chaveados pelo nosso `conversationId`; o parceiro é transporte. Se a Meta bloquear o número, o histórico continua e o envio entra em "aguardando canal", nunca em descarte silencioso. A identidade do canal é **por tenant** — o diferencial é propriedade do modelo de dados, não configuração global.

```ts
/* 7.4 PaymentProvider — PSP */
export interface PaymentProvider extends Provider {
  createPaymentLink(ctx: ProviderCtx, i: {...}): Promise<ProviderResult<{...}>>;   // 'idempotent'
  getPayment(ctx: ProviderCtx, i: { providerPaymentId: string }):
    Promise<ProviderResult<PaymentSnapshot>>;                                       // 'safe'
  refund(ctx: ProviderCtx, i: { providerPaymentId: string; amountCents?: number; reason: string }):
    Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;           // 'unsafe'
  verifyWebhook(raw: Buffer, h: Record<string,string>): { valid: boolean; reason?: string };
  /** Conciliação: taxa REAL vem do PSP; nunca calculamos por conta própria. */
  fetchSettlements(ctx: ProviderCtx, i: { from: Rfc3339; to: Rfc3339 }):
    Promise<ProviderResult<Settlement[]>>;
}
```
**Garante:** o razão financeiro é nosso; o PSP é fonte de **eventos**, não de verdade contábil. Se ele cair, a clínica continua faturando e lançando pagamento manual — degrada só a automação de link e maquininha.

```ts
/* 7.5 TissTransport — arquivo hoje, SOAP depois. NUNCA constrói XML. */
export type TissSubmissionReceipt =
  | { kind: 'protocolo'; protocolo: string; recebidoEm: Rfc3339 }
  | { kind: 'arquivo'; storageKey: StorageKey; fileName: string; sha256: string; instructions: string };
export interface TissTransport extends Provider {
  readonly mode: 'arquivo' | 'webservice';
  readonly tissVersion: string;   // do LOTE, acordado por operadora — não a versão de hoje
  submitBatch(ctx: ProviderCtx, i: { loteId: string; xml: Uint8Array;   // ISO-8859-1, MD5 embutido
    operadoraCnpj: string; prestador: { cnpj: string; cnes: string } }):
    Promise<ProviderResult<TissSubmissionReceipt>>;                      // 'unsafe'
  fetchDemonstrativo(ctx: ProviderCtx, i: { protocolo: string; operadoraCnpj: string }):
    Promise<ProviderResult<{ xml: Uint8Array; kind: 'analise'|'pagamento' }>>;
  submitRecursoGlosa(ctx: ProviderCtx, i: { recursoId: string; xml: Uint8Array;
    operadoraCnpj: string }): Promise<ProviderResult<TissSubmissionReceipt>>;
}
```
**Garante:** a Fase 4 é uma classe nova, não um refactor. A construção do XML vive em `tiss/serializer`, pura, determinística, testada byte a byte contra os XSD da ANS com `xmllint`; o transporte só move bytes. O recibo é união discriminada — o caso de uso trata as duas implementações sem `if (mode === ...)`. **Bloqueio físico:** o diretório `tiss-soap/` não existe no repositório até haver credencial de cliente real, e um teste garante que o registry só conhece `tiss-arquivo`.

```ts
/* 7.6 ClinicalAiProvider — a integração que faltava no desenho original */
export interface ClinicalAiProvider extends Provider {
  // capabilities DEVE conter 'residency:br' para ser elegível quando a política do tenant exige
  transcribe(ctx: ProviderCtx, i: { encounterId: string; patientId: string;
    audioKey: StorageKey; language: 'pt-BR' }): Promise<ProviderResult<AiUsageRecord>>;
  suggest(ctx: ProviderCtx, i: { purpose: 'sugestao_cid'|'resumo_historico'|'sugestao_conduta';
    encounterId: string; patientId: string; contextKey: StorageKey }):
    Promise<ProviderResult<AiUsageRecord>>;
}
export interface AiUsageRecord {   // CFM 2.454/2026 — obrigatório, não opcional
  provider: string; modelId: string; modelVersion: string; residency: 'br'|'other';
  riskClass: 'I'|'IIa'|'IIb'|'III';
  inputKey: StorageKey; inputHash: string; output: string; outputHash: string;
}
```
**Garante:** áudio de consulta é o dado com pior perfil de residência do produto. O runtime **recusa** adaptador fora do Brasil quando a política do tenant exige, e a recusa do paciente é verificada **dentro do adaptador** — sem consentimento, o áudio não sai do processo. Toda saída retorna um `AiUsageRecord` que o `emr` grava na mesma transação do registro clínico. Sem esse contrato, a primeira sprint de transcrição instala o SDK mais conveniente, o áudio vai para us-east-1, **nenhum lint reclama e nenhum teste falha** — e a promessa de zero transferência internacional cai sem ninguém perceber.

---

## 8. Faseamento

Princípio de ordenação: **primeiro o que é impossível retrofitar, depois o que é vendável sozinho.** Append-only, trilha, RLS e canonicalização não entram depois; tudo o mais entra.

### Fase 0 — Fundação (4–6 semanas, 1 pessoa)
`kernel` (Result, erros, UUIDv7, `Clock`, `Money`, canonicalização JCS, validadores CPF/CNPJ alfanumérico/CNS/CRM) · `db` com `withTenantTx` · **a suíte `test:iso` é o primeiro teste do repositório, antes da primeira tela** · papéis e GRANTs · `audit` com os dois canais e o selo · `authn` (sessão opaca, Argon2id, TOTP, SameSite+CSRF) · `authz` (catálogo de ações com fonte única) · `identity`/`tenancy`/`people`/`patients`/`catalogs` (CID-10 e TUSS **já versionada por data**) · pipeline com os 10 invariantes de CI · `restore:drill`.
Entregável visível: nenhum. É o único trecho do projeto sem entregável, e é inegociável.

### Fase 1 — "O dia" (10–14 semanas, 1 pessoa) — **útil sozinha**
Hoje · Agenda (dia/semana/mês/profissional/sala, encaixe, lista de espera, recorrência materializada) · Pacientes com cadastro mínimo e identificadores · **motor de prontuário** (seções × campos, finalizar, retificar, adendo) · Documentos e atestados com **assinatura ICP-Brasil AD-RT** · **Exportação integral ECF.18** · Auditoria · Prescrição via Memed.
**Por que isso é útil sozinho:** uma clínica particular de 1–5 médicos substitui papel, planilha e agenda de parede; emite atestado e prescrição assinados; e atende pedido judicial de prontuário integral com um comando. Já vale R$ 89/profissional/mês sem nenhuma linha de financeiro. E `export` entra aqui, não na fase 3: se entrar depois, reescreve a camada de leitura inteira.
Os ~14 campos da guia de consulta são capturados desde já, com o módulo `tiss` inexistente. Custa dias agora e meses depois.

### Fase 2 — "A conversa e o caixa" (8–10 semanas)
Conversas (WhatsApp bidirecional com número próprio, onboarding do WABA pela clínica, automações de confirmação/lembrete/pós-consulta, NPS) · recebimento no atendimento, link de pagamento, conciliação básica, recibo.
**Por quê antes do financeiro completo:** é o diferencial nº 2, é o que a recepção usa de hora em hora, e a confirmação automatizada reduz falta — a métrica que a gestora enxerga no primeiro mês.

### Fase 3 — "O dinheiro" (8–10 semanas)
Financeiro completo (a receber/a pagar, fluxo de caixa, extrato, categorias, centro de custo, contas bancárias), **repasse**, estoque, Desempenho (Explorar + as 11 visões salvas + atribuição de variação).

### Fase 4 — "Os convênios" (10–12 semanas)
TISS Fase 1 e 2: guia como projeção, lote, XML ISO-8859-1 com hash proprietário, exportação de arquivo (legal pelo art. 15 §3º da RN 501 — o prestador escolhe portal ou webservice). Aqui o ICP muda: até a Fase 3 o alvo é clínica particular; a partir daqui, clínica de convênio.

### Fase 5 — "A glosa e o SOAP" (sob demanda)
Demonstrativo, recurso de glosa (onde está o valor percebido) e, **só com credencial de cliente real em mãos**, `tiss-soap`. Credenciais e homologação pertencem ao prestador, não a nós.

**Fora de ordem, contínuo:** RUM próprio com amostragem adaptativa (100% em tenant pequeno, 100% de erro e de marca de negócio) desde a Fase 1 — senão o diferencial de velocidade não é mensurável; e o ensaio mensal de restauração desde a Fase 0.

---

## 9. Riscos e o que fica de fora

### Riscos que podem matar o produto

| Risco | Por que é real | Mitigação | Gatilho de reavaliação |
|---|---|---|---|
| **Vazamento entre clínicas por contexto errado** | RLS protege contra `WHERE` esquecido, não contra `app.tenant_id` forjado ou preâmbulo esquecido | `EXISTS(membership)` dentro da policy; um só lugar abre transação; lint; T5/T6 por tipo de `Actor`; canário que roda a suíte inteira como tenant A e afirma que nada de B foi tocado | Qualquer ocorrência = incidente P0 com notificação ANPD em 3 dias úteis |
| **Selo da auditoria falha em silêncio** | É a única garantia real de imutabilidade, e job que para não faz barulho | *Dead man's switch* por ausência de execução; verificação da cadeia em amostragem semanal; painel interno com "último selo válido: D-1" | Duas falhas no trimestre → mover o selo para função gerenciada fora da nossa conta |
| **Canonicalização quebrada por upgrade de biblioteca** | Ordem de chaves, normalização Unicode ou formatação numérica invalidam a verificação de **todo** o histórico | `canonicalVersion` gravada em cada assinatura + **todos os verificadores antigos mantidos para sempre**; teste com vetores congelados | Nunca alterar; se houver necessidade, é versão nova, jamais alteração da existente |
| **Memed** | Módulo JS na nossa tela (impede app nativo puro), retorno por evento JS, token dinâmico, credencial revogável em até 180 dias | Interface + cópia própria do PDF assinado + verificação LTV do nosso lado; segundo adaptador (Mevo) especificado antes de precisar | Aviso de revogação, ou 3 incidentes de indisponibilidade > 30 min no trimestre |
| **WhatsApp / Meta** | Aprovação de template, qualidade do número e bloqueio acontecem sem aviso | *Fallback* automático para SMS na confirmação; onboarding desenhado para a clínica ser dona do WABA (o bloqueio é dela, não nosso); estado explícito na UI | Bloqueio de mais de 2% dos números ativos |
| **EAV degradando relatório** | É o modo de falha clássico do padrão | Regra (a/b/c/d) de primeira classe, `occurred_date` desnormalizado, flag `live`, e teste de performance com 500 mil atendimentos sintéticos no CI noturno | p95 de qualquer relatório > 2 s com volume sintético |
| **RLS custando no planejador** | Policies com `OR` e subconsulta podem virar nested loop caro em relatórios grandes | `app.clinical_scope_all()` STABLE avaliada uma vez; `EXPLAIN ANALYZE` publicado por relatório com alvo, não só para as três queries fáceis | Qualquer relatório sem alvo medido não vai para produção |
| **`encounter_field_value`** | Cresce como (atendimentos × campos × versões) | Particionada desde o dia 1 por `finalized_at`; monitoramento do gatilho, não descoberta em incidente | 30 M linhas |
| **Chromium no worker** | ~400 MB, cold start em segundos, histórico de CVEs; e prontuário de 20 anos com 500 anexos estoura memória | Pool quente, timeout duro, sandbox sem rede, **renderização em blocos com merge em streaming**, teste noturno com prontuário sintético de 20 anos | Exportação > 60 s p95 |
| **Break-glass do suporte** | É, por definição, caminho legítimo para dado clínico de todos os tenants — a maior superfície interna | Papel de banco separado (`app_support`), `support_grant` com chamado e prazo, sem escrita clínica, notificação automática à clínica, 2FA com step-up, revisão mensal | Um único acesso sem chamado |
| **Sem CDN** | Pico ou ataque volumétrico bate direto no ALB | Shield Standard, WAF gerenciado, rate limit por IP e sessão | Se medirmos necessidade, entra em `static.` que por construção não carrega dado pessoal |
| **Equipe de uma pessoa mantendo 3 deployables** | Overhead real; o risco concreto é o worker ficar sem observabilidade | Mesma imagem base, mesmo módulo Terraform, alarme de "worker sem heartbeat há 5 min" com severidade de página | — |

### O que decidimos **não** fazer

| Fora | Por quê | O que nos faria reconsiderar |
|---|---|---|
| **Adquirência própria** (maquininha nossa) | É outro negócio, com risco regulatório e de crédito; o líder tem porque a Afya quer vender | Nunca na fase de produto; só com escala > 1.000 clínicas |
| **Prescrição própria** | Exige inscrição da plataforma no CRM e Diretor Técnico médico pessoalmente responsável (CFM 2.299/2021 art. 5) | Se o custo por prescrição do parceiro superar o custo de um DT contratado |
| **Vídeo de teleconsulta próprio** | WebRTC com gravação e consentimento é um produto inteiro | Integramos; construímos só se nenhum parceiro atender LGPD em território nacional |
| **App nativo** | O módulo do prescritor é web e forçaria WebView; PWA cobre 90% do uso móvel real (recepção olhando agenda) | Quando a transcrição por IA em consulta virar uso majoritário |
| **RNDS / interoperabilidade FHIR em runtime** | Naming alinhado ao BR-Core, mas FHIR no runtime hoje é custo sem cliente pagante | Exigência contratual de operadora ou de rede pública |
| **Faturamento SUS (BPA/APAC)** | Público-alvo é clínica privada; é outro padrão inteiro | Cliente âncora com serviço contratualizado |
| **Internação, centro cirúrgico, prontuário hospitalar** | Outro produto, outro ciclo de venda | Nunca nesta linha |
| **Odontologia completa** (odontograma como cidadão de primeira classe) | Cabe no `value_json` para clínica mista; CRO como especialidade não é foco | Se >15% dos leads forem odonto |
| **Marketplace / agendamento público tipo Doctoralia** | Aquisição de paciente é outro negócio | — |
| **Multi-idioma e multi-país** | Todo o valor está na conformidade brasileira | — |

### O que sabemos que vai doer e aceitamos

A regra "FK sempre composta" é um imposto permanente sobre a produtividade: um índice `UNIQUE(tenant_id, id)` por tabela e todo join mais verboso. Vai gerar pressão por exceções, e **a primeira exceção destrói a garantia**. Escrever isso aqui é a mitigação: quando alguém pedir a exceção, este parágrafo é a resposta.

---

## 10. Decisões irreversíveis

Precisa estar certo no dia 1 porque depois é migração de dezenas de milhões de linhas append-only, ou perda de valor probatório do acervo inteiro.

1. **RLS com `FORCE` + FK composta `(tenant_id, id)` em toda relação + papel de login sem posse e sem `BYPASSRLS`.** Isolamento vira propriedade estrutural do grafo de dados; referência cruzada é erro `23503`, não vazamento silencioso.
2. **Identidade global × vínculo por tenant.** `id.user` (credencial, TOTP, dispositivo, autorização PSC) é global e sem `tenant_id`; `app.membership(user_id, tenant_id, clinic_id, role)` carrega o tenant. Separar depois significa reescrever authn, authz e reindexar uma trilha que é append-only. O médico tem **um** certificado ICP-Brasil, logo **uma** identidade.
3. **Papel resolvido por vínculo, por clínica, dentro do banco** — nunca `app.role` escalar vindo do cliente. Papel escalar dá acesso total ou nenhum ao médico que é admin em uma unidade e assistente em outra.
4. **Tabela de versões com snapshot integral + cadeia de hash, e o registro vigente como CONJUNTO** (original + adendos − superadas). Adendo cria ramo; ponteiro único perde informação clínica.
5. **Escrita clínica exclusivamente por funções `SECURITY DEFINER`; `app_rw` só lê.** Imutabilidade por permissão vale para o agregado inteiro, não só para a linha-pai.
6. **Serialização canônica JCS/RFC 8785 com `canonicalVersion` e `serializer_version` gravados**, cobrindo paciente, profissional, clínica, `occurred_at`, valores e o `output_hash` da IA. É o contrato mais permanente do sistema.
7. **Assinatura mínima AD-RT com carimbo de ACT credenciada e material LTV arquivado.** AD-RB não existe no tipo. Com guarda de 20 anos, a falha aparece no acervo inteiro de uma vez e não tem correção retroativa.
8. **Trilha sem conteúdo clínico e sem identificador de paciente, com whitelist de chaves em `meta`, RLS forçada com policy de INSERT para o dono, dois canais de gravação e selo diário assinado em bucket WORM em conta separada.**
9. **Identificador de paciente é tabela (`patient_identifier`), com CPF opcional, e a unificação nunca reescreve linha** — usa `clin.patient_merge` + `clin.patient_group()`. Recém-nascido e paciente sem documento existem; `patient_id` desnormalizado em tabela append-only não pode ser corrigido.
10. **Fuso pertence à clínica, e `occurred_date` é coluna derivada gravada na escrita.** Nenhuma derivação diária usa `timestamptz::date`. Erro de fuso é silencioso e contamina TISS, caixa e relatório.
11. **Terminologia versionada por data do evento** (`daterange` + `EXCLUDE USING gist`), CID e TUSS em `ref` global, com `display_snapshot` gravado no valor. Lookup por `current_date` é o erro que só aparece meses depois num lote rejeitado.
12. **CNPJ como `varchar(14)` alfanumérico** (`^[A-Z0-9]{12}[0-9]{2}$`), com invariante de CI proibindo coluna numérica chamada `cnpj`.
13. **`app.consent_type` sem o valor `'atendimento'`.** A base legal da assistência é o art. 11 II f; codificar isso no sistema de tipos impede que alguém escreva o código que bloqueia atendimento esperando aceite.
14. **UUIDv7 em tudo + chave de object storage igual ao UUID, sem extensão, com nome original só no banco** (NGS1.06.01), e crypto-shredding por chave de dados desde o primeiro anexo — expurgo de mídia imutável não tem outro caminho.
15. **`encounter_field_value` particionada desde o dia 1** por `finalized_at`, com `ordinal` na chave de unicidade (múltipla escolha) e `field_generation` gravado.
16. **Região sa-east-1, sem CDN na frente de HTML/API, e residência declarada como capability em toda integração de IA.** É o que transforma "não há transferência internacional" em propriedade de arquitetura, não cláusula contratual.
17. **Retenção por tenant (`NULL` = indefinido, `CHECK >= 20`), Object Lock em GOVERNANCE com prazo finito, e cópia externa em segundo provedor no Brasil incluindo os **bytes** dos anexos.** Snapshot na mesma conta AWS morre junto com a conta; inventário de anexos sem os bytes é a prova do que foi perdido, não o backup.

18. **Separação Paciente × Prontuário na navegação, espelhando a policy `RESTRICTIVE`.** É irreversível porque a partir do momento em que existe uma tela única com campos ocultos por permissão, a exportação, a impressão e a URL direta vazam — e a correção é reescrever toda a camada de leitura clínica.

19. **Locale do cluster em `C.UTF-8`, com `COLLATE "pt-BR-x-icu"` por coluna onde ordem alfabética importa.** *(Acrescentado durante a execução da Task 2, a partir de medição no cluster real.)*

    O locale do cluster é fixado pelo `initdb` e só muda recriando o volume — em produção, dump e reload de todo o acervo. Escolhemos `C.UTF-8` deliberadamente: é determinístico e imune ao **versionamento de collation do glibc**, que altera a ordem de comparação entre versões de sistema operacional e corrompe índices `btree` de texto silenciosamente num upgrade de imagem. Num sistema com guarda de 20 anos, atravessar várias gerações de SO é certeza, não hipótese.

    O preço é que a ordenação nativa fica errada para português:

    ```
    ORDER BY nome sob C.UTF-8 →  Ana · Bruno · Zeca · Álvaro
    ```

    Isso **não** afeta a busca: `clin.patient.search_name` é `unaccent(lower(...))`, imune ao locale. Afeta qualquer `ORDER BY` direto sobre nome — ou seja, a listagem de pacientes da Fase 1.

    **Regra vinculante:** toda coluna cuja ordenação seja apresentada a um humano recebe `COLLATE "pt-BR-x-icu"` explícito na definição, e o índice que a serve carrega o mesmo `COLLATE`. O PostgreSQL 18 traz ICU embutido, e a collation ICU é versionada pelo próprio ICU — o que a torna estável de forma verificável, ao contrário do glibc. Ordenar sem collation explícita não é um bug que aparece em teste: aparece como um paciente "sumido" da lista para a recepcionista que procura por ele na letra certa.

---

## Apêndice A — Alvos de latência publicados (requisito, não aspiração)

| Caminho | Alvo | Onde é medido |
|---|---|---|
| `GET /v1/agenda/semana` | p95 servidor < 300 ms | k6 + `pg_stat_statements` |
| Agenda do dia (query) | < 2 ms, ~45 linhas, **sem nó `Sort`** | `EXPLAIN` no CI noturno |
| Busca de paciente: tecla → resultado | p75 cliente < 120 ms, com 200 mil pacientes sintéticos | RUM + k6 |
| `prontuario.open` (clique → utilizável) | p75 cliente < 1,2 s | RUM |
| Linha do tempo do paciente (20 atendimentos) | < 10 ms | `EXPLAIN` no CI |
| Painel financeiro do mês (rollup) | < 1 ms, ~240 linhas | `EXPLAIN` no CI |
| Exportação ECF.18, prontuário de 20 anos com 500 anexos | p95 < 60 s, sem estouro de memória | CI noturno |
| Exportação da trilha, 1 ano de um tenant | p95 < 30 s | CI noturno |
| INP global | p75 < 200 ms | RUM |
| Entrega de lembrete dentro da janela | 99,5% | fila |

Política de orçamento de erro: estourou o mês, congela feature e o time vai para confiabilidade — que é literalmente a proposta de valor.

## Apêndice B — Comandos

```bash
pnpm dev                # compose + web:3000 + api:3001 + worker, todos os providers fake
pnpm db:new <nome>      # migration .sql vazia (DDL de segurança é escrito à mão)
pnpm db:migrate         # expand/contract, forward-only, sem down migration
pnpm authz:seed         # regenera o catálogo de ações a partir de actions.ts
pnpm test:iso           # SÓ isolamento multi-tenant — obrigatório, roda no pre-push
pnpm test:int           # Testcontainers com migrations reais
pnpm arch:check         # dependency-cruiser: camadas, ciclos, imports entre irmãos
pnpm test:perf          # k6 + Lighthouse; quebra o PR em regressão
pnpm restore:drill      # restauração em VPC isolada + verify-restore (mensal; trimestral
                        # a partir do SEGUNDO provedor, senão a cópia externa nunca foi testada)
pnpm audit:export --tenant <id> --from 2026-01-01 --to 2026-12-31 --format xml
```

---

**Este documento é o contrato.** Onde ele conflitar com uma implementação futura, ele vence até ser explicitamente emendado — e as emendas às §10 exigem justificativa escrita, porque cada item de lá custa uma migração de dados imutáveis para desfazer.