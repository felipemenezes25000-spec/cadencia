<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:
  1. migration 0070: coluna phone_number renomeada para phone (text),
     alinhando com Blocos 03, 07 e 08 que referenciam phone.
  2. migration 0070: status CHECK ampliado para incluir 'verified'
     (usado por Bloco 07 na resolucao de webhook).
  3. migration 0070: indice ux_channel_identity_phone atualizado.
  4. A migration 0073 do Bloco 03 (duplicata de channel_identity)
     FOI REMOVIDA — esta migration 0070 e a unica fonte.
─────────────────────────────────────────────────────────────────── -->

### Task 6: Migration 0070 — schema `msg`, tabelas `channel_identity` e `template`

Cria o schema `msg` com o mesmo padrao dos demais (dono `app_owner`, GRANT USAGE para `app_rw`, `clin_writer`, `app_support`). Cria as tabelas de identidade de canal e template de mensagem, ambas com RLS habilitada e forcada, FK composta por `(tenant_id, id)`.

**Arquivos**

- Criar `packages/db/migrations/0070_msg_schema_channel_template.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0070_msg_schema_channel_template.sql`:

```sql
-- 0070_msg_schema_channel_template.sql
-- Fase 2 · design §7.3 e §5.3 — mensageria.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- O schema `msg` nasce aqui, com o mesmo dono e padrao de GRANT dos demais.
-- A identidade de canal e POR TENANT: a clinica e dona do WABA, nao nos.

CREATE SCHEMA msg AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA msg TO app_rw, clin_writer, app_support;

-- ---------------------------------------------------------------------------
-- msg.channel_identity — canal da clinica (WhatsApp, SMS, email)
-- ---------------------------------------------------------------------------
CREATE TABLE msg.channel_identity (
  tenant_id      uuid NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid NOT NULL,
  channel        text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  display_name   text NOT NULL,
  phone          text NOT NULL,           -- E.164
  waba_ref       text,                   -- WABA ID da Meta, opcional
  provider_ref   text,                   -- referencia do provedor
  status         text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','active','suspended','blocked','verified')),
  quality_rating text,                   -- WhatsApp business quality rating
  created_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id));
ALTER TABLE msg.channel_identity OWNER TO app_owner;

-- Telefone unico por canal dentro do tenant.
CREATE UNIQUE INDEX ux_channel_identity_phone
  ON msg.channel_identity (tenant_id, channel, phone);

GRANT SELECT, INSERT, UPDATE ON msg.channel_identity TO app_rw;

ALTER TABLE msg.channel_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_identity FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.channel_identity AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.template — templates de mensagem aprovados pela Meta
-- ---------------------------------------------------------------------------
CREATE TABLE msg.template (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  channel            text NOT NULL CHECK (channel IN ('whatsapp')),
  name               text NOT NULL,
  language           text NOT NULL DEFAULT 'pt_BR',
  category           text NOT NULL CHECK (category IN ('marketing','utility','authentication')),
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  body_template      text NOT NULL,
  header_template    text,
  footer_template    text,
  variables          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id));
ALTER TABLE msg.template OWNER TO app_owner;

-- Nome unico por canal identity + idioma.
CREATE UNIQUE INDEX ux_template_name
  ON msg.template (tenant_id, channel_identity_id, name, language);

GRANT SELECT, INSERT, UPDATE ON msg.template TO app_rw;

ALTER TABLE msg.template ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.template FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.template AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar a migration e verificar**

```bash
pnpm db:migrate
```

Saida esperada: migration 0070 aplicada sem erro.

Verificar que as tabelas existem com RLS forcada:

```bash
psql "$DATABASE_URL_ADMIN" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'msg' AND c.relkind = 'r'
   ORDER BY c.relname;"
```

Saida esperada:

```
   relname          | relrowsecurity | relforcerowsecurity
--------------------+----------------+---------------------
 channel_identity   | t              | t
 template           | t              | t
```

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0070_msg_schema_channel_template.sql
git commit -m "feat(db): create msg schema with channel_identity and template tables (migration 0070)

RLS enabled and forced on both tables. channel_identity holds the
clinic's own channel (WhatsApp WABA, SMS, email) with provider_ref and
quality_rating. template holds Meta-approved message templates.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Migration 0071 — tabelas `conversation`, `message` e `inbound_event`

Cria as tres tabelas centrais da mensageria: conversa com paciente, mensagem individual e payload bruto do webhook. Todas com RLS habilitada e forcada, FK composta por `(tenant_id, id)`.

**Arquivos**

- Criar `packages/db/migrations/0071_msg_conversation_message.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0071_msg_conversation_message.sql`:

```sql
-- 0071_msg_conversation_message.sql
-- Fase 2 · design §7.3 — conversas, mensagens e eventos de entrada.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- msg.conversation.patient_id e NULLABLE: numero desconhecido nao e vinculado
-- automaticamente (privacidade). resolveConversation faz lookup pelo telefone do
-- paciente quando cria uma conversa nova, mas nunca para numero novo sem match.
--
-- msg.inbound_event e append-only: o payload bruto do webhook e gravado ANTES de
-- parsear — parser bugado nao perde mensagem de paciente.

-- ---------------------------------------------------------------------------
-- msg.conversation — conversa com paciente, keyed por NOSSO id
-- ---------------------------------------------------------------------------
CREATE TABLE msg.conversation (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  patient_id          uuid,              -- NULLABLE: numero desconhecido
  remote_phone        varchar(20) NOT NULL,  -- E.164 do paciente/contato
  external_ref        text,              -- id do parceiro (WhatsApp conversation id)
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  last_message_at     timestamptz(3),
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)
    REFERENCES clin.patient(tenant_id, id));
ALTER TABLE msg.conversation OWNER TO app_owner;

-- Busca por telefone para resolveConversation: uma conversa ativa por telefone.
CREATE UNIQUE INDEX ux_conversation_phone
  ON msg.conversation (tenant_id, channel_identity_id, remote_phone)
  WHERE status = 'active';
-- Busca por paciente.
CREATE INDEX ix_conversation_patient
  ON msg.conversation (tenant_id, patient_id) WHERE patient_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON msg.conversation TO app_rw;

ALTER TABLE msg.conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.conversation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.conversation AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.message — mensagem individual (inbound ou outbound)
-- ---------------------------------------------------------------------------
CREATE TABLE msg.message (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  conversation_id uuid NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  body_text       text,
  body_media_key  text,                -- storage ref (StorageKey)
  template_key    text,                -- se veio de template
  status          text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','read','failed')),
  external_id     text,                -- providerMessageId
  sent_at         timestamptz(3),
  delivered_at    timestamptz(3),
  read_at         timestamptz(3),
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES msg.conversation(tenant_id, id));
ALTER TABLE msg.message OWNER TO app_owner;

-- Timeline de mensagens de uma conversa.
CREATE INDEX ix_message_conversation
  ON msg.message (tenant_id, conversation_id, created_at DESC);
-- Lookup por external_id para status updates do webhook.
CREATE INDEX ix_message_external
  ON msg.message (tenant_id, external_id) WHERE external_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON msg.message TO app_rw;

ALTER TABLE msg.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.message AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.inbound_event — payload bruto do webhook, append-only
-- ---------------------------------------------------------------------------
CREATE TABLE msg.inbound_event (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  raw_payload         jsonb NOT NULL,
  received_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  processed_at        timestamptz(3),
  error               text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id));
ALTER TABLE msg.inbound_event OWNER TO app_owner;

-- Eventos pendentes de processamento.
CREATE INDEX ix_inbound_event_pending
  ON msg.inbound_event (tenant_id, channel_identity_id, received_at)
  WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON msg.inbound_event TO app_rw;

ALTER TABLE msg.inbound_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.inbound_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.inbound_event AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar a migration e verificar**

```bash
pnpm db:migrate
```

Saida esperada: migration 0071 aplicada sem erro.

Verificar que as tabelas existem com RLS forcada:

```bash
psql "$DATABASE_URL_ADMIN" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'msg' AND c.relkind = 'r'
   ORDER BY c.relname;"
```

Saida esperada: 5 tabelas (channel_identity, conversation, inbound_event, message, template), todas com `t | t`.

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0071_msg_conversation_message.sql
git commit -m "feat(db): add conversation, message and inbound_event tables (migration 0071)

conversation.patient_id is nullable — unknown numbers stay unlinked
for privacy. inbound_event stores the raw webhook payload before parsing
so a parser bug never loses a patient message.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Migration 0072 — tabela `automation_rule`

Cria a tabela de regras de automacao que vincula gatilhos de dominio (agendamento criado, lembrete, atendimento finalizado, NPS) a templates de mensagem com timing configuravel.

**Arquivos**

- Criar `packages/db/migrations/0072_msg_automation_rule.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0072_msg_automation_rule.sql`:

```sql
-- 0072_msg_automation_rule.sql
-- Fase 2 · design §5.3 secao CONVERSAS — automacoes.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Uma regra de automacao diz: "quando ocorrer ESTE gatilho, enviar ESTE template
-- pelo canal DESTA identidade, com ESTE offset de tempo". timing_offset_minutes
-- negativo significa ANTES do evento (e.g., -1440 = 24h antes do agendamento).

CREATE TABLE msg.automation_rule (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  trigger             text NOT NULL
    CHECK (trigger IN (
      'appointment_created',
      'appointment_reminder',
      'encounter_finalized',
      'nps_due')),
  template_id         uuid NOT NULL,
  timing_offset_minutes int NOT NULL DEFAULT 0,
  channel             text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id),
  FOREIGN KEY (tenant_id, template_id)
    REFERENCES msg.template(tenant_id, id));
ALTER TABLE msg.automation_rule OWNER TO app_owner;

-- Uma regra ativa por trigger por canal identity.
CREATE UNIQUE INDEX ux_automation_rule_trigger
  ON msg.automation_rule (tenant_id, channel_identity_id, trigger)
  WHERE active = true;

GRANT SELECT, INSERT, UPDATE ON msg.automation_rule TO app_rw;

ALTER TABLE msg.automation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.automation_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.automation_rule AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar a migration e verificar**

```bash
pnpm db:migrate
```

Saida esperada: migration 0072 aplicada sem erro.

Verificar que todas as 6 tabelas do schema `msg` existem com RLS forcada:

```bash
psql "$DATABASE_URL_ADMIN" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'msg' AND c.relkind = 'r'
   ORDER BY c.relname;"
```

Saida esperada:

```
     relname        | relrowsecurity | relforcerowsecurity
--------------------+----------------+---------------------
 automation_rule    | t              | t
 channel_identity   | t              | t
 conversation       | t              | t
 inbound_event      | t              | t
 message            | t              | t
 template           | t              | t
```

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0072_msg_automation_rule.sql
git commit -m "feat(db): add automation_rule table for message triggers (migration 0072)

Links domain triggers (appointment_created, appointment_reminder,
encounter_finalized, nps_due) to message templates with configurable
timing offset. One active rule per trigger per channel identity.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Semente de teste e configuracao de `packages/messaging`

Configura as dependencias de `packages/messaging` e cria a funcao de semente para testes de integracao, seguindo o padrao de `packages/scheduling/src/test-support.ts`.

**Arquivos**

- Modificar `packages/messaging/package.json`
- Criar `packages/messaging/src/test-support.ts`

---

- [ ] **Passo 1 — adicionar dependencias ao `package.json`**

Modificar `packages/messaging/package.json`:

```json
{
  "name": "@cadencia/messaging",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "@types/pg": "^8.20.3"
  }
}
```

---

- [ ] **Passo 2 — instalar dependencias**

```bash
pnpm install
```

Saida esperada: lockfile atualizado, sem erro.

---

- [ ] **Passo 3 — criar a semente de teste**

Criar `packages/messaging/src/test-support.ts`:

```ts
// packages/messaging/src/test-support.ts
//
// Semeia tenant, clinica, usuario, vinculo, paciente com telefone, identidade de
// canal e template para os testes de integracao da mensageria.
//
// Roda com a conexao ADMINISTRATIVA pelo mesmo motivo de
// packages/scheduling/src/test-support.ts: cria o tenant, que e a raiz do
// isolamento e nao tem transacao de negocio capaz de cria-lo — app_rw so tem
// SELECT em app.tenant (0007).
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeMensageria {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientId: string;
  patientPhone: string;
  channelIdentityId: string;
  templateId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`',
    );
  }
  return url;
}

export async function semearMensageria(): Promise<SementeMensageria> {
  const s: SementeMensageria = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    patientId: uuidv7(),
    patientPhone: '+5511999990001',
    channelIdentityId: uuidv7(),
    templateId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Mensageria', '12ABC34501DE35')`,
      [s.tenantId, `m-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Msg', '7654321', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Atendente')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, phone_primary, cadastro_status)
       VALUES ($1, $2, 'Joana Teste', $3, 'completo')`,
      [s.tenantId, s.patientId, s.patientPhone]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone_number, provider_ref, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica WhatsApp', '+5511988880001', 'waba-fake-001', 'active')`,
      [s.tenantId, s.channelIdentityId]);
    await c.query(
      `INSERT INTO msg.template
         (tenant_id, id, channel_identity_id, channel, name, language, category,
          status, body_template, variables)
       VALUES ($1, $2, $3, 'whatsapp', 'confirmacao_consulta', 'pt_BR', 'utility',
               'approved', 'Ola {{1}}, sua consulta esta confirmada para {{2}} as {{3}}.', '["nome","data","hora"]'::jsonb)`,
      [s.tenantId, s.templateId, s.channelIdentityId]);
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

---

- [ ] **Passo 4 — verificar compilacao**

```bash
pnpm tsc --noEmit -p packages/messaging/tsconfig.json
```

Saida esperada: sem erro de tipo.

---

- [ ] **Passo 5 — commitar**

```bash
git add packages/messaging/package.json packages/messaging/src/test-support.ts
git commit -m "feat(messaging): test support seed for integration tests

Seeds tenant, clinic, user, membership, patient with phone, channel
identity and approved template. Follows the same pattern as
packages/scheduling/src/test-support.ts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: `resolveConversation` — achar ou criar conversa por telefone

Implementa a funcao de dominio que encontra uma conversa ativa pelo telefone do contato ou cria uma nova. Quando cria, faz lookup do paciente pelo `phone_primary` — mas para numero desconhecido (sem match), o `patient_id` fica NULL (privacidade).

**Arquivos**

- Criar `packages/messaging/src/messaging.ts`
- Criar `packages/messaging/src/messaging.int.test.ts`
- Modificar `packages/messaging/src/index.ts`

---

- [ ] **Passo 1 — teste que falha: resolveConversation cria conversa e vincula paciente por telefone**

Criar `packages/messaging/src/messaging.int.test.ts`:

```ts
// packages/messaging/src/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveConversation } from './messaging';
import { semearMensageria, type SementeMensageria } from './test-support';

let s: SementeMensageria;
let actor: Actor;

beforeAll(async () => {
  s = await semearMensageria();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('resolveConversation', () => {
  it('cria conversa nova e vincula paciente pelo telefone', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.conversationId).toBeTruthy();
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('retorna conversa existente sem criar duplicata', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(false);
  });

  it('cria conversa com patient_id NULL para numero desconhecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511888880000',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.patientId).toBeNull();
  });

  it('usa patient_id explicito quando fornecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511777770000',
      patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: uuidv7(),
      remotePhone: '+5511999990001',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: falha — modulo `./messaging` nao existe.

---

- [ ] **Passo 2 — implementar resolveConversation**

Criar `packages/messaging/src/messaging.ts`:

```ts
// packages/messaging/src/messaging.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos de falha
// ---------------------------------------------------------------------------

export type MessagingFailure =
  | { kind: 'canal_nao_encontrado' }
  | { kind: 'conversa_nao_encontrada' }
  | { kind: 'canal_inativo' };

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

export interface ResolveConversationInput {
  readonly channelIdentityId: string;
  readonly remotePhone: string;
  readonly patientId?: string;
}

export interface ResolvedConversation {
  readonly conversationId: string;
  readonly created: boolean;
  readonly patientId: string | null;
}

export async function resolveConversation(
  tx: TxClient, i: ResolveConversationInput,
): Promise<Result<ResolvedConversation, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Buscar conversa ativa pelo telefone.
  const existente = await tx.query<{ id: string; patient_id: string | null }>(
    `SELECT id, patient_id FROM msg.conversation
      WHERE channel_identity_id = $1
        AND remote_phone = $2
        AND status = 'active'`,
    [i.channelIdentityId, i.remotePhone]);

  if (existente.rows.length > 0) {
    const conv = existente.rows[0]!;
    return ok({
      conversationId: conv.id,
      created: false,
      patientId: conv.patient_id,
    });
  }

  // 3. Criar conversa nova.
  let patientId: string | null = i.patientId ?? null;

  // Se patientId nao foi fornecido, tenta lookup pelo telefone do paciente.
  if (patientId === null) {
    const paciente = await tx.query<{ id: string }>(
      `SELECT id FROM clin.patient
        WHERE phone_primary = $1
        LIMIT 1`,
      [i.remotePhone]);
    if (paciente.rows.length > 0) {
      patientId = paciente.rows[0]!.id;
    }
  }

  const conversationId = uuidv7();
  await tx.query(
    `INSERT INTO msg.conversation
       (id, channel_identity_id, patient_id, remote_phone, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [conversationId, i.channelIdentityId, patientId, i.remotePhone]);

  return ok({ conversationId, created: true, patientId });
}
```

---

- [ ] **Passo 3 — reexportar pelo barrel**

Modificar `packages/messaging/src/index.ts`:

```ts
// packages/messaging/src/index.ts
export {
  resolveConversation,
  type ResolveConversationInput, type ResolvedConversation,
  type MessagingFailure,
} from './messaging';
```

---

- [ ] **Passo 4 — rodar e confirmar que os testes passam**

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: 5 testes passando.

---

- [ ] **Passo 5 — commitar**

```bash
git add packages/messaging/src/messaging.ts packages/messaging/src/messaging.int.test.ts packages/messaging/src/index.ts
git commit -m "feat(messaging): resolveConversation finds or creates conversation by phone

Looks up patient by phone_primary for auto-linking. Unknown numbers
get patient_id=NULL for privacy. Returns existing active conversation
when one already exists for the same channel+phone pair.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: `sendMessage` e `receiveInbound` — envio e recebimento de mensagem

Adiciona as duas funcoes restantes do dominio de mensageria. `sendMessage` cria uma mensagem outbound com status `queued` (o worker despacha pelo provedor). `receiveInbound` grava o payload bruto em `inbound_event` ANTES de qualquer parse, resolve a conversa e cria a mensagem inbound.

**Arquivos**

- Modificar `packages/messaging/src/messaging.ts`
- Modificar `packages/messaging/src/messaging.int.test.ts`
- Modificar `packages/messaging/src/index.ts`

---

- [ ] **Passo 1 — teste que falha: sendMessage cria mensagem com status queued**

Adicionar ao final de `packages/messaging/src/messaging.int.test.ts`:

```ts
// Adicionar ao final do arquivo, DENTRO do escopo do modulo (apos os describes existentes)
import { sendMessage, receiveInbound } from './messaging';

let conversationId = '';

describe('sendMessage', () => {
  beforeAll(async () => {
    // Garantir que existe uma conversa para usar nos testes.
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511666660000',
    }));
    if (r.ok) conversationId = r.value.conversationId;
  });

  it('cria mensagem outbound com status queued', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola, sua consulta esta confirmada!',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; channel: string;
    }>(
      `SELECT direction, status, body_text, channel
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]).toEqual({
      direction: 'outbound',
      status: 'queued',
      body_text: 'Ola, sua consulta esta confirmada!',
      channel: 'whatsapp',
    });
  });

  it('cria mensagem outbound com template_key', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola Maria, sua consulta esta confirmada para 14/08 as 10:00.',
      templateKey: 'confirmacao_consulta',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      template_key: string | null;
    }>(
      `SELECT template_key FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]?.template_key).toBe('confirmacao_consulta');
  });

  it('atualiza last_message_at da conversa', async () => {
    const antes = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tAntes = antes.rows[0]?.last_message_at;

    await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId, bodyText: 'outra mensagem',
    }));

    const depois = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tDepois = depois.rows[0]?.last_message_at;
    expect(tDepois).not.toBeNull();
    if (tAntes !== null && tDepois !== null) {
      expect(tDepois >= tAntes).toBe(true);
    }
  });

  it('recusa conversa inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId: uuidv7(),
      bodyText: 'nao vai',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'conversa_nao_encontrada' } });
  });
});

describe('receiveInbound', () => {
  it('grava payload bruto em inbound_event e cria mensagem inbound', async () => {
    const rawPayload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-fake-001', changes: [{ value: { messages: [{ id: 'wamid.xyz' }] } }] }],
    };

    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload,
      remotePhone: '+5511555550000',
      bodyText: 'Quero marcar consulta',
      externalId: 'wamid.xyz',
      sentAt: '2026-08-04T10:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.eventId).toBeTruthy();
    expect(r.value.messageId).toBeTruthy();
    expect(r.value.conversationId).toBeTruthy();

    // Verificar inbound_event gravado
    const { rows: evtRows } = await withTenantTx(actor, (tx) => tx.query<{
      raw_payload: unknown; processed_at: string | null;
    }>(
      `SELECT raw_payload, processed_at FROM msg.inbound_event WHERE id = $1`,
      [r.value.eventId]));
    expect(evtRows[0]?.raw_payload).toEqual(rawPayload);
    expect(evtRows[0]?.processed_at).not.toBeNull();

    // Verificar mensagem inbound criada
    const { rows: msgRows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; external_id: string;
    }>(
      `SELECT direction, status, body_text, external_id
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(msgRows[0]).toEqual({
      direction: 'inbound',
      status: 'delivered',
      body_text: 'Quero marcar consulta',
      external_id: 'wamid.xyz',
    });
  });

  it('vincula paciente na conversa quando telefone bate', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload: { test: true },
      remotePhone: s.patientPhone,
      bodyText: 'Boa tarde',
      externalId: 'wamid.abc',
      sentAt: '2026-08-04T11:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // A conversa para o telefone do paciente ja existe (criada no describe anterior);
    // deve ter o patient_id vinculado.
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      patient_id: string | null;
    }>(
      `SELECT patient_id FROM msg.conversation WHERE id = $1`,
      [r.value.conversationId]));
    expect(rows[0]?.patient_id).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: uuidv7(),
      rawPayload: {},
      remotePhone: '+5511999990001',
      bodyText: 'teste',
      externalId: 'wamid.000',
      sentAt: '2026-08-04T12:00:00.000Z',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: falha — `sendMessage` e `receiveInbound` nao existem em `./messaging`.

---

- [ ] **Passo 2 — implementar sendMessage**

Adicionar ao final de `packages/messaging/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  readonly conversationId: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly templateKey?: string;
}

export async function sendMessage(
  tx: TxClient, i: SendMessageInput,
): Promise<Result<{ messageId: string }, MessagingFailure>> {
  // 1. Verificar que a conversa existe e obter o canal.
  const conv = await tx.query<{ channel: string }>(
    `SELECT ci.channel
       FROM msg.conversation c
       JOIN msg.channel_identity ci
         ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
      WHERE c.id = $1`,
    [i.conversationId]);
  if (conv.rows.length === 0) return err({ kind: 'conversa_nao_encontrada' });

  const channel = conv.rows[0]!.channel;
  const messageId = uuidv7();

  // 2. Inserir mensagem com status queued (o worker despacha via provedor).
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        template_key, status)
     VALUES ($1, $2, 'outbound', $3, $4, $5, $6, 'queued')`,
    [messageId, i.conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null, i.templateKey ?? null]);

  // 3. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [i.conversationId]);

  return ok({ messageId });
}
```

---

- [ ] **Passo 3 — implementar receiveInbound**

Adicionar ao final de `packages/messaging/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// receiveInbound
// ---------------------------------------------------------------------------

export interface ReceiveInboundInput {
  readonly channelIdentityId: string;
  readonly rawPayload: unknown;
  readonly remotePhone: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly externalId: string;
  readonly sentAt: string;            // RFC 3339
}

export interface ReceivedInbound {
  readonly eventId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export async function receiveInbound(
  tx: TxClient, i: ReceiveInboundInput,
): Promise<Result<ReceivedInbound, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Gravar payload bruto em inbound_event — ANTES de qualquer parse.
  //    Parser bugado nao perde mensagem de paciente.
  const eventId = uuidv7();
  await tx.query(
    `INSERT INTO msg.inbound_event
       (id, channel_identity_id, raw_payload, processed_at)
     VALUES ($1, $2, $3, clock_timestamp())`,
    [eventId, i.channelIdentityId, JSON.stringify(i.rawPayload)]);

  // 3. Resolver conversa pelo telefone.
  const convResult = await resolveConversation(tx, {
    channelIdentityId: i.channelIdentityId,
    remotePhone: i.remotePhone,
  });
  if (!convResult.ok) return convResult;

  const conversationId = convResult.value.conversationId;

  // 4. Obter o canal da identidade.
  const chQuery = await tx.query<{ channel: string }>(
    `SELECT channel FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  const channel = chQuery.rows[0]!.channel;

  // 5. Criar mensagem inbound.
  const messageId = uuidv7();
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        status, external_id, sent_at)
     VALUES ($1, $2, 'inbound', $3, $4, $5, 'delivered', $6, $7::timestamptz)`,
    [messageId, conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null,
     i.externalId, i.sentAt]);

  // 6. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [conversationId]);

  return ok({ eventId, messageId, conversationId });
}
```

---

- [ ] **Passo 4 — atualizar o barrel para exportar tudo**

Modificar `packages/messaging/src/index.ts`:

```ts
// packages/messaging/src/index.ts
export {
  resolveConversation,
  sendMessage,
  receiveInbound,
  type ResolveConversationInput, type ResolvedConversation,
  type SendMessageInput,
  type ReceiveInboundInput, type ReceivedInbound,
  type MessagingFailure,
} from './messaging';
```

---

- [ ] **Passo 5 — rodar e confirmar que todos os testes passam**

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: 12 testes passando (5 de resolveConversation + 4 de sendMessage + 3 de receiveInbound).

---

- [ ] **Passo 6 — verificar que arch:check passa**

```bash
pnpm arch:check
```

Saida esperada: sem violacao. `@cadencia/messaging` (L2) importa apenas de `@cadencia/kernel` (L0) e `@cadencia/db` (L0).

---

- [ ] **Passo 7 — commitar**

```bash
git add packages/messaging/src/messaging.ts packages/messaging/src/messaging.int.test.ts packages/messaging/src/index.ts
git commit -m "feat(messaging): sendMessage and receiveInbound domain functions

sendMessage creates a queued outbound message — the worker dispatches
via the provider. receiveInbound stores the raw webhook payload in
inbound_event BEFORE any parsing (parser bugs never lose patient
messages), then resolves the conversation and creates the inbound
message record.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
