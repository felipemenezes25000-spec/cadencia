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
