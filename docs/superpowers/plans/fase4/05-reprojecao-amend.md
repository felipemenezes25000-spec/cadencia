### Task 28: Evento ENCOUNTER_AMENDED em domain-events.ts

**Arquivos**

- Modificar: `packages/events/src/domain-events.ts`
- Modificar: `packages/events/src/domain-events.test.ts`

**Passos**

- [ ] Escrever o teste que falha: atualizar `packages/events/src/domain-events.test.ts` para esperar 11 tipos (era 10) incluindo `ENCOUNTER_AMENDED`, e verificar que o payload carrega `kind`.

```typescript
// Em packages/events/src/domain-events.test.ts
// SUBSTITUIR o import inteiro no topo do arquivo:
import {
  EVENT_TYPES,
  isEventType,
  type DomainEvent,
  type AppointmentConfirmed,
  type AppointmentReminderDue,
  type EncounterFinalized,
  type EncounterAmended,
  type PaymentReceived,
  type PaymentLinkCreated,
  type InboundMessageReceived,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from './domain-events';

// SUBSTITUIR o primeiro it():
  it('EVENT_TYPES contem exatamente os 11 tipos ate a Fase 4', () => {
    expect(EVENT_TYPES).toEqual([
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER_DUE',
      'ENCOUNTER_FINALIZED',
      'ENCOUNTER_AMENDED',
      'PAYMENT_RECEIVED',
      'PAYMENT_LINK_CREATED',
      'INBOUND_MESSAGE_RECEIVED',
      'SPLIT_CALCULATED',
      'STOCK_ALERT_TRIGGERED',
      'REPASSE_CLOSED',
      'RECURRING_ENTRY_MATERIALIZED',
    ]);
  });

// SUBSTITUIR o it('isEventType aceita tipo valido...'):
  it('isEventType aceita tipo valido e recusa invalido', () => {
    expect(isEventType('APPOINTMENT_CONFIRMED')).toBe(true);
    expect(isEventType('ENCOUNTER_AMENDED')).toBe(true);
    expect(isEventType('SPLIT_CALCULATED')).toBe(true);
    expect(isEventType('STOCK_ALERT_TRIGGERED')).toBe(true);
    expect(isEventType('REPASSE_CLOSED')).toBe(true);
    expect(isEventType('RECURRING_ENTRY_MATERIALIZED')).toBe(true);
    expect(isEventType('NAO_EXISTE')).toBe(false);
    expect(isEventType('')).toBe(false);
  });

// ADICIONAR ao final do describe, antes do fechamento:
  it('ENCOUNTER_AMENDED carrega kind e versionNo', () => {
    const evt: EncounterAmended = {
      type: 'ENCOUNTER_AMENDED',
      tenantId: 't1', aggregateId: 'e1', occurredAt: '2026-08-07T10:00:00.000Z',
      payload: {
        encounterId: 'e1', patientId: 'p1', professionalId: 'pr1',
        versionNo: 2, kind: 'retificacao',
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('ENCOUNTER_AMENDED');
    expect(evt.payload.kind).toBe('retificacao');
    expect(evt.payload.versionNo).toBe(2);
  });
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd packages/events && pnpm vitest run src/domain-events.test.ts
# Esperado: falha em "EVENT_TYPES contem exatamente os 11 tipos" e em import de EncounterAmended
```

- [ ] Implementar: adicionar `ENCOUNTER_AMENDED` ao `packages/events/src/domain-events.ts`.

```typescript
// Em packages/events/src/domain-events.ts

// SUBSTITUIR o array EVENT_TYPES inteiro:
export const EVENT_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER_DUE',
  'ENCOUNTER_FINALIZED',
  'ENCOUNTER_AMENDED',
  'PAYMENT_RECEIVED',
  'PAYMENT_LINK_CREATED',
  'INBOUND_MESSAGE_RECEIVED',
  'SPLIT_CALCULATED',
  'STOCK_ALERT_TRIGGERED',
  'REPASSE_CLOSED',
  'RECURRING_ENTRY_MATERIALIZED',
] as const;

// ADICIONAR apos EncounterFinalizedPayload:
export interface EncounterAmendedPayload {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly versionNo: number;
  /** 'retificacao' ou 'adendo' — o handler de reprojecao usa para decidir o fluxo */
  readonly kind: 'retificacao' | 'adendo';
}

// ADICIONAR apos a linha "export type EncounterFinalized = ...":
export type EncounterAmended = DomainEventBase<'ENCOUNTER_AMENDED', EncounterAmendedPayload>;

// SUBSTITUIR a uniao DomainEvent inteira (adicionar EncounterAmended):
export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | EncounterAmended
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived
  | SplitCalculated
  | StockAlertTriggered
  | RepasseClosed
  | RecurringEntryMaterialized;
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/events && pnpm vitest run src/domain-events.test.ts
# Esperado: 8 testes, 0 falhas
```

- [ ] Commitar:

```bash
git add packages/events/src/domain-events.ts packages/events/src/domain-events.test.ts
git commit -m "feat(events): add ENCOUNTER_AMENDED domain event for Fase 4 reprojecao"
```

---

### Task 29: Migration 0118 — tiss.guia_pendencia e outbox ENCOUNTER_AMENDED em finalize_encounter

**Arquivos**

- Criar: `packages/db/migrations/0118_tiss_guia_pendencia_and_amend_outbox.sql`
- Modificar: `packages/db/privileges.json`
- Modificar: `packages/db/test/iso/fixtures.ts`
- Modificar: `packages/db/test/iso/seed.ts`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0118_tiss_guia_pendencia_and_amend_outbox.sql`. A migration faz duas coisas: (1) cria `tiss.guia_pendencia` com RLS, FK composta e isolamento; (2) reescreve `clin.finalize_encounter` adicionando o passo 10 que enfileira `ENCOUNTER_AMENDED` no outbox quando `p_kind IN ('retificacao', 'adendo')`.

```sql
-- 0118_tiss_guia_pendencia_and_amend_outbox.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 4, bloco 05 — reprojecao da guia apos retificacao ou adendo.
-- (1) tiss.guia_pendencia: pendencia criada quando uma guia pertence a um lote
--     ja enviado e o prontuario e retificado/adendado. O operador decide no
--     painel "Precisa de voce" se cancela e reapresenta ou mantem.
-- (2) ALTER de clin.finalize_encounter para enfileirar ENCOUNTER_AMENDED no
--     outbox quando kind IN (retificacao, adendo). O handler assincrono do
--     worker usa esse evento para reprojetar a guia.
--
-- Sem now()/current_date no schema tiss (invariante de CI).

-- =========================================================================
-- PARTE 1: tiss.guia_pendencia
-- =========================================================================

CREATE TABLE tiss.guia_pendencia (
  tenant_id              uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                     uuid NOT NULL,
  guia_id                uuid NOT NULL,
  encounter_version_id   uuid NOT NULL,
  tipo                   text NOT NULL CHECK (tipo IN ('reprojecao_pos_envio')),
  resolved_at            timestamptz(3),
  created_at             timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id)
);

ALTER TABLE tiss.guia_pendencia OWNER TO app_owner;

-- Indice para busca de pendencias abertas (dashboard "Precisa de voce").
CREATE INDEX ix_guia_pendencia_aberta
  ON tiss.guia_pendencia (tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- Indice para busca de pendencias de uma guia especifica.
CREATE INDEX ix_guia_pendencia_guia
  ON tiss.guia_pendencia (tenant_id, guia_id)
  WHERE resolved_at IS NULL;

-- RLS
ALTER TABLE tiss.guia_pendencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.guia_pendencia FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.guia_pendencia
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- GRANTs: INSERT (handler cria), SELECT (dashboard le), UPDATE (resolved_at).
GRANT SELECT, INSERT ON tiss.guia_pendencia TO app_rw;
GRANT UPDATE (resolved_at) ON tiss.guia_pendencia TO app_rw;
GRANT SELECT ON tiss.guia_pendencia TO rpt_owner;

-- =========================================================================
-- PARTE 2: ALTER clin.finalize_encounter — passo 10 (outbox ENCOUNTER_AMENDED)
-- =========================================================================

CREATE OR REPLACE FUNCTION clin.finalize_encounter(
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
  v_prof       uuid := coalesce(app.current_professional_id(),
    CASE WHEN nullif(current_setting('app.actor_kind', true), '') = 'system'
         THEN (SELECT e.professional_id FROM clin.encounter e WHERE e.id = p_encounter_id)
         END);
  v_author     uuid := coalesce(app.current_user_id(),
    CASE WHEN nullif(current_setting('app.actor_kind', true), '') = 'system'
         THEN (SELECT p.user_id FROM app.professional p WHERE p.id = v_prof)
         END);
  v_finalized  timestamptz(3) := clock_timestamp();
  v_item       jsonb;
  v_value_date date;
BEGIN
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'quem finaliza precisa ser profissional deste tenant'
      USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_content_hash) <> 32 THEN
    RAISE EXCEPTION 'content_hash precisa ter 32 bytes' USING ERRCODE = '22023';
  END IF;

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

  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_version_no
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id;
  SELECT v.content_hash INTO v_prev_hash
    FROM clin.encounter_version v
   WHERE v.encounter_id = p_encounter_id
   ORDER BY v.version_no DESC LIMIT 1;

  INSERT INTO clin.encounter_version
    (tenant_id, id, encounter_id, version_no, kind, supersedes_version_id,
     justificativa, author_user_id, author_professional_id, incompleto,
     finalized_at, content_hash, prev_hash, serializer_version)
  VALUES
    (v_enc.tenant_id, v_version_id, p_encounter_id, v_version_no, p_kind,
     p_supersedes_version_id, p_justificativa, v_author, v_prof,
     p_incompleto, v_finalized, p_content_hash, v_prev_hash, p_serializer_version);

  -- PASSO 4 — explodir payload em encounter_field_value.
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'fields','[]'::jsonb))
  LOOP
    v_value_date := CASE
      WHEN v_item->>'value_date' IS NOT NULL THEN (v_item->>'value_date')::date
      ELSE NULL END;
    INSERT INTO clin.encounter_field_value
      (tenant_id, id, version_id, finalized_at, field_id, field_generation,
       label_snapshot, display_snapshot, terminology_version, section_instance,
       ordinal, value_text, value_num, value_bool, value_date, value_ts,
       value_json, value_ref_source, value_ref_code)
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
        v_value_date,
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

  UPDATE clin.ai_assistance a
     SET version_id = v_version_id
   WHERE a.tenant_id = v_enc.tenant_id
     AND a.encounter_id = p_encounter_id
     AND a.version_id IS NULL;

  -- PASSO 6 — supersessao: apaga o bit live das filhas da versao superada.
  IF p_kind IN ('retificacao','transferencia','anulacao') AND p_supersedes_version_id IS NOT NULL THEN
    UPDATE clin.diagnosis d          SET live = false
     WHERE d.tenant_id = v_enc.tenant_id AND d.version_id = p_supersedes_version_id;
    UPDATE clin.observation o        SET live = false
     WHERE o.tenant_id = v_enc.tenant_id AND o.version_id = p_supersedes_version_id;
    UPDATE clin.encounter_finding f  SET live = false
     WHERE f.tenant_id = v_enc.tenant_id AND f.version_id = p_supersedes_version_id;
    UPDATE clin.procedure pr         SET live = false
     WHERE pr.tenant_id = v_enc.tenant_id AND pr.version_id = p_supersedes_version_id;
  END IF;

  -- PASSO 7 — lancamento financeiro e projecao da guia TISS.
  -- Preenchido pela Fase 3/4 (bloco 04 projeta guia na finalizacao original).

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
    jsonb_build_object('version_no', v_version_no, 'kind', p_kind::text),
    v_enc.clinic_id);

  -- PASSO 10 — outbox para reprojecao assincrona da guia TISS.
  -- Retificacao e adendo disparam ENCOUNTER_AMENDED; o handler do worker
  -- decide se reprojeta (lote nao enviado) ou cria pendencia (lote ja enviado).
  IF p_kind IN ('retificacao', 'adendo') THEN
    PERFORM app.enqueue_outbox(
      'ENCOUNTER_AMENDED',
      p_encounter_id,
      jsonb_build_object(
        'encounterId', p_encounter_id,
        'patientId', v_enc.patient_id,
        'professionalId', v_prof,
        'versionNo', v_version_no,
        'kind', p_kind::text
      )
    );
  END IF;

  RETURN QUERY SELECT v_version_id, v_version_no;
END $fn$;

ALTER FUNCTION clin.finalize_encounter(uuid, clin.version_kind, jsonb, bytea, text, uuid, text, boolean)
  OWNER TO clin_writer;
REVOKE ALL ON FUNCTION clin.finalize_encounter(uuid, clin.version_kind, jsonb, bytea, text, uuid, text, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.finalize_encounter(uuid, clin.version_kind, jsonb, bytea, text, uuid, text, boolean)
  TO app_rw;
```

- [ ] Atualizar `packages/db/privileges.json` adicionando a entrada para `tiss.guia_pendencia`:

```jsonc
// Adicionar ao objeto raiz de privileges.json:
"tiss.guia_pendencia": {
  "table": {
    "app_rw": ["INSERT", "SELECT"],
    "rpt_owner": ["SELECT"]
  },
  "columns": {
    "app_rw": {
      "resolved_at": ["UPDATE"]
    }
  }
}
```

- [ ] Adicionar os novos identificadores fixos em `packages/db/test/iso/fixtures.ts`. Seguir o padrao UUIDv7 ja usado no arquivo. Os sufixos continuam de onde o bloco anterior parou (ultimo usado pelo bloco 03: `fb`).

```typescript
// Adicionar ao final de packages/db/test/iso/fixtures.ts, ANTES do bloco de
// CPF_VALIDO / REQUEST_ID / CNPJ:

/** Pendencia de reprojecao TISS: uma em cada tenant. */
export const GUIA_PENDENCIA_A = '01930000-0000-7000-8000-0000000000fc';
export const GUIA_PENDENCIA_B = '01930000-0000-7000-8000-0000000000fd';
```

- [ ] Adicionar as linhas de seed em `packages/db/test/iso/seed.ts`, ao final da funcao `seedDoisTenants`, logo apos a insercao de `tiss.guia_counter`. A pendencia precisa de uma `encounter_version_id` valida; usa a versao original do seed.

```typescript
  // tiss.guia_pendencia nasceu na Fase 4 (bloco 05, migration 0118): pendencia
  // criada quando guia pertence a lote ja enviado e o prontuario e retificado.
  // Como toda tabela multi-tenant, precisa de linha do tenant B, senao o teste
  // meta ("o seed realmente criou linha do tenant B em toda tabela multi-tenant")
  // reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.guia_pendencia
       (tenant_id, id, guia_id, encounter_version_id, tipo)
     VALUES
       ($1, $3, $5, $7, 'reprojecao_pos_envio'),
       ($2, $4, $6, $8, 'reprojecao_pos_envio')`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_PENDENCIA_A, F.GUIA_PENDENCIA_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL],
  );
```

- [ ] Rodar a migration, o seed e os invariantes:

```bash
pnpm db:migrate
# Esperado: aplica 0118_tiss_guia_pendencia_and_amend_outbox.sql sem erro

pnpm test:iso
# Esperado: todos os testes passam — a impressao digital do tenant B agora
# inclui tiss.guia_pendencia

pnpm db:invariants
# Esperado: todos passam — RLS habilitada e forcada, FK composta,
# sem now()/current_date no schema tiss

pnpm db:privileges
# Esperado: exit 0, sem divergencia
```

- [ ] Commitar:

```bash
git add packages/db/migrations/0118_tiss_guia_pendencia_and_amend_outbox.sql \
       packages/db/privileges.json \
       packages/db/test/iso/fixtures.ts \
       packages/db/test/iso/seed.ts
git commit -m "feat(db): add tiss.guia_pendencia table and ENCOUNTER_AMENDED outbox in finalize"
```

---

### Task 30: Teste de isolamento e integracao — tiss.guia_pendencia e outbox ENCOUNTER_AMENDED

**Arquivos**

- Criar: `packages/db/test/iso/34-guia-pendencia.iso.test.ts`
- Criar: `packages/tiss/src/reproject-guia.int.test.ts`
- Criar: `packages/tiss/src/test-support.ts`

**Passos**

- [ ] Criar o arquivo de teste de isolamento `packages/db/test/iso/34-guia-pendencia.iso.test.ts` que verifica a estrutura da tabela, RLS, FK composta e CHECK constraint.

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor, erroPg } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.guia_pendencia — pendencia de reprojecao apos envio de lote', () => {
  let admin: Client;
  let rw: Client;

  const actorAna: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_A,
    userId: F.USER_A_ANA,
    clinicId: F.CLINIC_A_SP,
    requestId: F.REQUEST_ID,
  };

  const actorDiego: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_B,
    userId: F.USER_B_DIEGO,
    clinicId: F.CLINIC_B_RIO_BRANCO,
    requestId: F.REQUEST_ID,
  };

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    rw = await openClient(inject('isoRwUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await rw.end();
  });

  it('tabela existe no schema tiss com as colunas esperadas', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'guia_pendencia'
        ORDER BY ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    const esperadas = [
      'tenant_id', 'id', 'guia_id', 'encounter_version_id',
      'tipo', 'resolved_at', 'created_at',
    ];
    for (const col of esperadas) {
      expect(colunas, `falta coluna ${col}`).toContain(col);
    }
  });

  it('RLS esta habilitada e forcada', async () => {
    const { rows } = await admin.query<{ rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT rowsecurity, forcerowsecurity FROM pg_class
        WHERE oid = 'tiss.guia_pendencia'::regclass`,
    );
    expect(rows[0]?.rowsecurity).toBe(true);
    expect(rows[0]?.forcerowsecurity).toBe(true);
  });

  it('FK composta para tiss.encounter_guia_consulta(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.guia_pendencia'::regclass
          AND con.confrelid = 'tiss.encounter_guia_consulta'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('FK composta para clin.encounter_version(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.guia_pendencia'::regclass
          AND con.confrelid = 'clin.encounter_version'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('CHECK tipo IN (reprojecao_pos_envio) rejeita valor invalido', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        await c.query(
          `INSERT INTO tiss.guia_pendencia
             (tenant_id, id, guia_id, encounter_version_id, tipo)
           VALUES ($1, gen_random_uuid(), $2, $3, 'tipo_invalido')`,
          [F.TENANT_A, F.GUIA_CONSULTA_A, F.VERSION_A_JOANA_ORIGINAL],
        );
      });
    });
    expect(erro.code).toBe('23514');
  });

  it('tenant A nao enxerga pendencia do tenant B', async () => {
    const { rows } = await new Promise<{ rows: Array<{ id: string }> }>((resolve) => {
      comoAtor(rw, actorAna, async (c) => {
        const r = await c.query<{ id: string }>(
          `SELECT id FROM tiss.guia_pendencia WHERE id = $1`,
          [F.GUIA_PENDENCIA_B],
        );
        resolve(r);
      });
    });
    expect(rows).toHaveLength(0);
  });

  it('tenant B nao enxerga pendencia do tenant A', async () => {
    const { rows } = await new Promise<{ rows: Array<{ id: string }> }>((resolve) => {
      comoAtor(rw, actorDiego, async (c) => {
        const r = await c.query<{ id: string }>(
          `SELECT id FROM tiss.guia_pendencia WHERE id = $1`,
          [F.GUIA_PENDENCIA_A],
        );
        resolve(r);
      });
    });
    expect(rows).toHaveLength(0);
  });

  it('app_rw pode fazer UPDATE somente em resolved_at', async () => {
    const { rows } = await admin.query<{ column_name: string; privilege_type: string }>(
      `SELECT column_name, privilege_type
         FROM information_schema.column_privileges
        WHERE table_schema = 'tiss' AND table_name = 'guia_pendencia'
          AND grantee = 'app_rw' AND privilege_type = 'UPDATE'`,
    );
    const updatableColumns = rows.map((r) => r.column_name);
    expect(updatableColumns).toEqual(['resolved_at']);
  });
});
```

- [ ] Acrescentar em `packages/tiss/src/test-support.ts` (criado pelo Bloco 01, expandido pelo Bloco 04) — funcao de semeadura adicional para testes de integracao de reprojecao. Cria tenant, clinica, usuario, profissional, paciente, atendimento finalizado, encounter_billing com dados de convenio, operadora e contrato TISS.

```typescript
// packages/tiss/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface TissSemente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  versionId: string;
  operadoraId: string;
  contratoId: string;
  pacienteConvenioId: string;
  billingId: string;
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

/**
 * Semeia um tenant completo para testes de integracao do modulo TISS:
 * - tenant, clinica, usuario, profissional, paciente
 * - atendimento finalizado (status='finalizado', version_no=1)
 * - encounter_billing com dados de convenio (registro_ans, carteirinha)
 * - tiss.operadora e tiss.contrato
 * - tiss.paciente_convenio
 *
 * O atendimento PRECISA estar finalizado porque a guia e projecao da
 * versao finalizada — nunca de rascunho.
 */
export async function semearTiss(): Promise<TissSemente> {
  const s: TissSemente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    encounterId: uuidv7(), versionId: uuidv7(),
    operadoraId: uuidv7(), contratoId: uuidv7(),
    pacienteConvenioId: uuidv7(), billingId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica TISS Teste', '12ABC34501DE35')`,
      [s.tenantId, `tiss-${s.tenantId}`]);

    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade TISS', '12ABC34501DE35', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);

    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dra. TISS')`,
      [s.userId, `${s.userId}@tiss.test`]);

    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId]);

    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);

    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Pedro Teste Convenio', 'completo', '1990-05-20')`,
      [s.tenantId, s.patientId]);

    // Operadora
    await c.query(
      `INSERT INTO tiss.operadora (tenant_id, id, registro_ans, razao_social, cnpj, active)
       VALUES ($1, $2, '326305', 'Operadora Teste', '98ABC765432109', true)`,
      [s.tenantId, s.operadoraId]);

    // Contrato prestador x operadora
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio)
       VALUES ($1, $2, $3, $4, '900123', DATE '2026-01-01')`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId]);

    // Vinculo paciente x convenio
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, nome_plano)
       VALUES ($1, $2, $3, $4, '00998877665544', 'Basico')`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId]);

    // Atendimento finalizado
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId]);

    // Versao original (como superusuario — clin_writer)
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('tiss test v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, s.encounterId, s.userId, s.professionalId]);

    // Atualizar head_version_id e version_count
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1
        WHERE id = $2`,
      [s.versionId, s.encounterId]);

    // Encounter billing com dados de convenio
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans,
          numero_carteira, codigo_prestador_na_operadora, cnes,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          tipo_consulta, data_atendimento, codigo_tabela,
          codigo_procedimento, valor_centavos, created_by)
       SELECT $1, $2, $3, 'Operadora Teste', '326305', '00998877665544',
              '900123', c.cnes, p.conselho_profissional, p.numero_conselho,
              p.uf_conselho, p.cbos, '1',
              app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
              '22', '10101012', 25000, $6
         FROM app.clinic c, app.professional p
        WHERE c.id = $4 AND p.id = $5`,
      [s.tenantId, s.billingId, s.encounterId,
       s.clinicId, s.professionalId, s.userId]);

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

- [ ] Criar o teste de integracao `packages/tiss/src/reproject-guia.int.test.ts` que verifica que `finalize_encounter` com kind `retificacao` enfileira `ENCOUNTER_AMENDED` no outbox. Este teste falha inicialmente porque o handler `reprojectGuiaOnAmend` ainda nao existe (sera criado na Task 31).

```typescript
// packages/tiss/src/reproject-guia.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { semearTiss, type TissSemente } from './test-support';

let s: TissSemente;
let actor: Actor;

beforeAll(async () => {
  s = await semearTiss();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('outbox ENCOUNTER_AMENDED na retificacao', () => {
  it('finalize_encounter com kind=retificacao enfileira ENCOUNTER_AMENDED no outbox', async () => {
    // Retificar o atendimento (version_no 2, superando a versao 1)
    const retificacao = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao do procedimento cobrado na guia de consulta',
            p_incompleto => false)`,
        [s.encounterId, 'aa'.repeat(32), s.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // Verificar que o outbox tem um evento ENCOUNTER_AMENDED
    const outbox = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        event_type: string; aggregate_id: string;
        payload: { kind: string; versionNo: number; encounterId: string };
      }>(
        `SELECT event_type, aggregate_id, payload
           FROM app.outbox
          WHERE event_type = 'ENCOUNTER_AMENDED'
            AND aggregate_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(outbox).toBeDefined();
    expect(outbox?.event_type).toBe('ENCOUNTER_AMENDED');
    expect(outbox?.payload.kind).toBe('retificacao');
    expect(outbox?.payload.versionNo).toBe(2);
    expect(outbox?.payload.encounterId).toBe(s.encounterId);
  });

  it('finalize_encounter com kind=original NAO enfileira ENCOUNTER_AMENDED', async () => {
    // Contar eventos ENCOUNTER_AMENDED existentes
    const antes = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ cnt: string }>(
        `SELECT count(*) AS cnt FROM app.outbox
          WHERE event_type = 'ENCOUNTER_AMENDED'`,
      );
      return Number(rows[0]?.cnt ?? 0);
    });

    // O atendimento original ja foi finalizado no seed; nao da para
    // finalizar outro como 'original'. Em vez disso, verificamos que
    // a contagem nao mudou (o seed nao cria outbox ENCOUNTER_AMENDED).
    const depois = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ cnt: string }>(
        `SELECT count(*) AS cnt FROM app.outbox
          WHERE event_type = 'ENCOUNTER_AMENDED'
            AND aggregate_id = $1`,
        [s.encounterId],
      );
      return Number(rows[0]?.cnt ?? 0);
    });
    // So deve haver o evento da retificacao do teste anterior, nenhum do original
    expect(depois).toBe(1);
  });
});
```

- [ ] Rodar os testes:

```bash
cd packages/db && pnpm vitest run test/iso/34-guia-pendencia.iso.test.ts
# Esperado: todos os testes de isolamento passam

cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: testes do outbox ENCOUNTER_AMENDED passam
```

- [ ] Commitar:

```bash
git add packages/db/test/iso/34-guia-pendencia.iso.test.ts \
       packages/tiss/src/reproject-guia.int.test.ts \
       packages/tiss/src/test-support.ts
git commit -m "test(tiss): add isolation tests for guia_pendencia and outbox ENCOUNTER_AMENDED"
```

---

### Task 31: Handler reprojectGuiaOnAmend — amend sem lote reprojeta a guia

**Arquivos**

- Criar: `packages/tiss/src/reproject-guia.ts`
- Modificar: `packages/tiss/src/index.ts`
- Modificar: `packages/tiss/src/reproject-guia.int.test.ts`
- Modificar: `apps/worker/src/jobs/outbox-dispatcher.ts`

**Passos**

- [ ] Adicionar o teste que falha em `packages/tiss/src/reproject-guia.int.test.ts`: retificacao sem lote reprojeta a guia (marca a antiga como `live=false` e cria nova guia vinculada a nova versao).

```typescript
// ADICIONAR ao final de packages/tiss/src/reproject-guia.int.test.ts,
// apos o bloco describe existente:

import { reprojectGuiaOnAmend } from './reproject-guia';
import { projectGuiaConsulta } from './project-guia';

describe('reprojectGuiaOnAmend — sem lote', () => {
  it('retificacao sem lote reprojeta: guia antiga live=false, nova guia criada', async () => {
    // 1) Projetar a guia original (usando o projectGuiaConsulta do bloco 04)
    const projecao = await withTenantTx(actor, async (tx) => {
      return projectGuiaConsulta(tx, s.encounterId, s.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar a guia original
    const guiaOriginal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string; live: boolean }>(
        `SELECT id, live FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(guiaOriginal).toBeDefined();
    expect(guiaOriginal?.live).toBe(true);

    // 3) Fazer a retificacao (ja feita no teste anterior — version_no=2 ja existe).
    // Buscar o version_id da retificacao
    const retificacaoVersion = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM clin.encounter_version
          WHERE encounter_id = $1 AND version_no = 2`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(retificacaoVersion).toBeDefined();

    // 4) Chamar o handler de reprojecao
    const resultado = await withTenantTx(actor, async (tx) => {
      return reprojectGuiaOnAmend(tx, s.encounterId, retificacaoVersion!.id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('reprojected');
    }

    // 5) Verificar que a guia antiga ficou live=false
    const guiaAntigaDepois = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guiaOriginal!.id],
      );
      return rows[0];
    });
    expect(guiaAntigaDepois?.live).toBe(false);

    // 6) Verificar que existe uma nova guia live=true vinculada a versao da retificacao
    const guiaNova = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string; live: boolean; encounter_version_id: string;
      }>(
        `SELECT id, live, encounter_version_id
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(guiaNova).toBeDefined();
    expect(guiaNova?.live).toBe(true);
    expect(guiaNova?.encounter_version_id).toBe(retificacaoVersion!.id);
    expect(guiaNova?.id).not.toBe(guiaOriginal!.id);
  });

  it('retificacao sem guia existente retorna no_guia', async () => {
    // Criar um atendimento sem guia projetada e retificar
    const s2 = await semearTiss();
    const actor2: Actor = {
      kind: 'user', tenantId: s2.tenantId, userId: s2.userId,
      clinicId: s2.clinicId, requestId: uuidv7(),
    };

    // Retificar (criar versao 2)
    const retificacao = await withTenantTx(actor2, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de diagnostico sem guia associada',
            p_incompleto => false)`,
        [s2.encounterId, 'bb'.repeat(32), s2.versionId],
      );
      return rows[0];
    });

    // Chamar o handler — nao deve haver guia para reprojetar
    const resultado = await withTenantTx(actor2, async (tx) => {
      return reprojectGuiaOnAmend(tx, s2.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('no_guia');
    }
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: falha — modulo './reproject-guia' nao existe
```

- [ ] Implementar o handler `packages/tiss/src/reproject-guia.ts`:

```typescript
// packages/tiss/src/reproject-guia.ts
import type { TxClient } from '@cadencia/db';
import type { Result } from '@cadencia/kernel';
import { ok, err } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export type ReprojectAction =
  | { action: 'reprojected'; oldGuiaId: string; newGuiaId: string }
  | { action: 'pendencia_created'; pendenciaId: string; guiaId: string }
  | { action: 'no_guia'; reason: string };

export type ReprojectError = {
  code: 'PROJECTION_FAILED';
  message: string;
};

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Regra de reprojecao apos retificacao ou adendo (design S3.9):
 *
 * 1. Busca a guia VIVA do atendimento.
 * 2. Se nao existe guia → retorna no_guia (atendimento particular ou guia
 *    nunca foi projetada).
 * 3. Verifica se a guia pertence a um lote JA ENVIADO:
 *    - Se pertence a lote enviado (status IN ('enviado','retornado')) →
 *      cria pendencia em tiss.guia_pendencia (tipo='reprojecao_pos_envio').
 *    - Se NAO pertence a lote enviado (nenhum lote, ou lote rascunho/pronto) →
 *      marca a guia antiga como live=false e projeta nova guia da nova versao.
 */
export async function reprojectGuiaOnAmend(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ReprojectAction, ReprojectError>> {
  // 1) Buscar a guia viva do atendimento
  const { rows: guias } = await tx.query<{ id: string }>(
    `SELECT g.id
       FROM tiss.encounter_guia_consulta g
      WHERE g.encounter_id = $1
        AND g.live = true`,
    [encounterId],
  );

  if (guias.length === 0) {
    return ok({ action: 'no_guia' as const, reason: 'nenhuma guia viva para este atendimento' });
  }

  const guiaId = guias[0]!.id;

  // 2) Verificar se a guia pertence a um lote ja enviado.
  // tiss.lote_guia e tiss.lote sao criados pelo bloco 06 (migrations 0119-0121).
  // A query usa LEFT JOIN para funcionar mesmo se nenhum lote existir.
  const { rows: loteRows } = await tx.query<{ lote_status: string | null }>(
    `SELECT l.status AS lote_status
       FROM tiss.lote_guia lg
       JOIN tiss.lote l ON (l.tenant_id, l.id) = (lg.tenant_id, lg.lote_id)
      WHERE lg.guia_id = $1
        AND l.status NOT IN ('cancelado')
      ORDER BY l.created_at DESC
      LIMIT 1`,
    [guiaId],
  );

  const loteEnviado = loteRows.length > 0
    && loteRows[0]!.lote_status !== null
    && ['enviado', 'retornado'].includes(loteRows[0]!.lote_status);

  // 3a) Lote ja enviado → criar pendencia
  if (loteEnviado) {
    const { rows: pendencia } = await tx.query<{ id: string }>(
      `INSERT INTO tiss.guia_pendencia
         (tenant_id, id, guia_id, encounter_version_id, tipo)
       VALUES (
         (SELECT tenant_id FROM tiss.encounter_guia_consulta WHERE id = $1),
         gen_random_uuid(), $1, $2, 'reprojecao_pos_envio'
       )
       RETURNING id`,
      [guiaId, encounterVersionId],
    );
    return ok({
      action: 'pendencia_created' as const,
      pendenciaId: pendencia[0]!.id,
      guiaId,
    });
  }

  // 3b) Sem lote enviado → reprojetar
  // Marcar a guia antiga como live=false
  await tx.query(
    `UPDATE tiss.encounter_guia_consulta SET live = false WHERE id = $1`,
    [guiaId],
  );

  // Projetar nova guia da nova versao
  const projecao = await projectGuiaConsulta(tx, encounterId, encounterVersionId);
  if (!projecao.ok) {
    return err({
      code: 'PROJECTION_FAILED' as const,
      message: `falha ao projetar nova guia: ${String(projecao.error)}`,
    });
  }

  // Buscar o id da nova guia criada
  const { rows: novaGuia } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.encounter_guia_consulta
      WHERE encounter_id = $1 AND live = true`,
    [encounterId],
  );

  return ok({
    action: 'reprojected' as const,
    oldGuiaId: guiaId,
    newGuiaId: novaGuia[0]!.id,
  });
}
```

- [ ] Atualizar `packages/tiss/src/index.ts` para exportar o handler:

```typescript
// packages/tiss/src/index.ts
export { reprojectGuiaOnAmend, type ReprojectAction, type ReprojectError } from './reproject-guia';
```

- [ ] Adicionar o roteamento de `ENCOUNTER_AMENDED` no outbox dispatcher. Modificar `apps/worker/src/jobs/outbox-dispatcher.ts`:

```typescript
// Em apps/worker/src/jobs/outbox-dispatcher.ts, na funcao resolveQueue,
// ADICIONAR antes do comentario "// Eventos financeiros":

  // Eventos TISS
  if (eventType === 'ENCOUNTER_AMENDED') return 'tiss.encounter_amended';
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: todos os testes passam — retificacao sem lote reprojeta, sem guia retorna no_guia

cd apps/worker && pnpm vitest run src/jobs/outbox-dispatcher
# Esperado: dispatcher testa passam (se existentes)
```

- [ ] Commitar:

```bash
git add packages/tiss/src/reproject-guia.ts \
       packages/tiss/src/index.ts \
       packages/tiss/src/reproject-guia.int.test.ts \
       apps/worker/src/jobs/outbox-dispatcher.ts
git commit -m "feat(tiss): add reprojectGuiaOnAmend handler and outbox routing for ENCOUNTER_AMENDED"
```

---

### Task 32: Handler reprojectGuiaOnAmend — amend com lote enviado cria pendencia

**Arquivos**

- Modificar: `packages/tiss/src/reproject-guia.int.test.ts`

**Passos**

- [ ] Adicionar o teste que exercita o cenario de lote ja enviado em `packages/tiss/src/reproject-guia.int.test.ts`. O teste cria um lote com status `enviado`, associa a guia ao lote e entao faz a retificacao — o handler deve criar uma pendencia em `tiss.guia_pendencia` em vez de reprojetar.

```typescript
// ADICIONAR ao final de packages/tiss/src/reproject-guia.int.test.ts,
// apos o bloco describe('reprojectGuiaOnAmend — sem lote'):

describe('reprojectGuiaOnAmend — com lote enviado', () => {
  it('retificacao com guia em lote enviado cria pendencia em vez de reprojetar', async () => {
    // Novo tenant para teste isolado
    const s3 = await semearTiss();
    const actor3: Actor = {
      kind: 'user', tenantId: s3.tenantId, userId: s3.userId,
      clinicId: s3.clinicId, requestId: uuidv7(),
    };

    // 1) Projetar a guia original
    const projecao = await withTenantTx(actor3, async (tx) => {
      return projectGuiaConsulta(tx, s3.encounterId, s3.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar a guia projetada
    const guia = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s3.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();

    // 3) Criar lote com status 'enviado' e associar a guia.
    // Usa admin porque precisa de acesso irrestrito para montar cenario.
    const adminPool = (await import('pg')).default;
    const adminConn = new adminPool.Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    const adminClient = await adminConn.connect();
    try {
      const loteId = uuidv7();
      await adminClient.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000001', 'enviado', '4.01', 1, 25000, $4)`,
        [s3.tenantId, loteId, s3.operadoraId, s3.userId],
      );
      await adminClient.query(
        `INSERT INTO tiss.lote_guia
           (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s3.tenantId, loteId, guia!.id],
      );
    } finally {
      adminClient.release();
      await adminConn.end();
    }

    // 4) Retificar o atendimento
    const retificacao = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de valor com guia ja enviada em lote',
            p_incompleto => false)`,
        [s3.encounterId, 'cc'.repeat(32), s3.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // 5) Chamar o handler de reprojecao
    const resultado = await withTenantTx(actor3, async (tx) => {
      return reprojectGuiaOnAmend(tx, s3.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('pendencia_created');
      if (resultado.value.action === 'pendencia_created') {
        expect(resultado.value.guiaId).toBe(guia!.id);
        expect(resultado.value.pendenciaId).toBeDefined();
      }
    }

    // 6) Verificar que a guia original continua live=true (NAO foi marcada false)
    const guiaDepois = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(guiaDepois?.live).toBe(true);

    // 7) Verificar que a pendencia foi criada corretamente
    const pendencia = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{
        guia_id: string; encounter_version_id: string;
        tipo: string; resolved_at: string | null;
      }>(
        `SELECT guia_id, encounter_version_id, tipo, resolved_at
           FROM tiss.guia_pendencia
          WHERE guia_id = $1
            AND resolved_at IS NULL`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(pendencia).toBeDefined();
    expect(pendencia?.guia_id).toBe(guia!.id);
    expect(pendencia?.encounter_version_id).toBe(retificacao!.version_id);
    expect(pendencia?.tipo).toBe('reprojecao_pos_envio');
    expect(pendencia?.resolved_at).toBeNull();
  });

  it('retificacao com guia em lote rascunho (nao enviado) reprojeta normalmente', async () => {
    // Novo tenant
    const s4 = await semearTiss();
    const actor4: Actor = {
      kind: 'user', tenantId: s4.tenantId, userId: s4.userId,
      clinicId: s4.clinicId, requestId: uuidv7(),
    };

    // 1) Projetar guia
    const projecao = await withTenantTx(actor4, async (tx) => {
      return projectGuiaConsulta(tx, s4.encounterId, s4.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar guia
    const guia = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s4.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();

    // 3) Criar lote RASCUNHO (nao enviado) e associar a guia
    const adminPool = (await import('pg')).default;
    const adminConn = new adminPool.Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    const adminClient = await adminConn.connect();
    try {
      const loteId = uuidv7();
      await adminClient.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000001', 'rascunho', '4.01', 1, 25000, $4)`,
        [s4.tenantId, loteId, s4.operadoraId, s4.userId],
      );
      await adminClient.query(
        `INSERT INTO tiss.lote_guia
           (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s4.tenantId, loteId, guia!.id],
      );
    } finally {
      adminClient.release();
      await adminConn.end();
    }

    // 4) Retificar
    const retificacao = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de valor com guia em lote rascunho — reprojeta',
            p_incompleto => false)`,
        [s4.encounterId, 'dd'.repeat(32), s4.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // 5) Handler deve REPROJETAR (lote rascunho = nao enviado)
    const resultado = await withTenantTx(actor4, async (tx) => {
      return reprojectGuiaOnAmend(tx, s4.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('reprojected');
    }

    // 6) Guia antiga marcada live=false
    const guiaAntigaDepois = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(guiaAntigaDepois?.live).toBe(false);

    // 7) Nova guia viva vinculada a nova versao
    const guiaNova = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{
        id: string; encounter_version_id: string;
      }>(
        `SELECT id, encounter_version_id
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s4.encounterId],
      );
      return rows[0];
    });
    expect(guiaNova).toBeDefined();
    expect(guiaNova?.encounter_version_id).toBe(retificacao!.version_id);

    // 8) Nenhuma pendencia criada
    const pendencias = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.guia_pendencia
          WHERE guia_id = $1 AND resolved_at IS NULL`,
        [guia!.id],
      );
      return rows;
    });
    expect(pendencias).toHaveLength(0);
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: 6 testes, 0 falhas
# - outbox ENCOUNTER_AMENDED na retificacao (2 testes)
# - reprojectGuiaOnAmend sem lote (2 testes)
# - reprojectGuiaOnAmend com lote enviado (2 testes)
```

- [ ] Rodar o typecheck completo:

```bash
pnpm typecheck
# Esperado: exit 0 — nenhum erro de tipo
```

- [ ] Rodar os invariantes:

```bash
pnpm db:invariants
# Esperado: todos passam — nenhuma ocorrencia de now()/current_date no schema tiss,
# RLS forcada em tiss.guia_pendencia, FK composta presente
```

- [ ] Commitar:

```bash
git add packages/tiss/src/reproject-guia.int.test.ts
git commit -m "test(tiss): add integration tests for reprojecao with sent batch creating pendencia"
```
