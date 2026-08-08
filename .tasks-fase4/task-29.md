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