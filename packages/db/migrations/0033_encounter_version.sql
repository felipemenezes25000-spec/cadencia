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
