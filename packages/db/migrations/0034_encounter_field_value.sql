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
-- Segunda excecao declarada ao "indice multi-tenant comeca por tenant_id", no
-- mesmo espirito de clin.ix_draft_parado (migration 0031): a leitura sempre parte
-- de UMA version_id ja resolvida sob RLS, e version_id e chave global de UUIDv7.
-- Liderar por tenant_id so engordaria a chave sem eliminar uma linha sequer.
COMMENT ON INDEX clin.ix_efv_version IS 'tenant-scoped-by-parent';

REVOKE ALL ON clin.encounter_field_value FROM PUBLIC, app_rw;
GRANT SELECT ON clin.encounter_field_value TO app_rw;
GRANT SELECT, INSERT ON clin.encounter_field_value TO clin_writer;

CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON clin.encounter_field_value
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.encounter_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter_field_value FORCE  ROW LEVEL SECURITY;

-- O EXISTS que delega o escopo a clin.encounter_version mora DENTRO desta funcao,
-- e nao inline na policy, por uma razao mecanica: app.secure_partition (migration
-- 0022) recria a policy na particao a partir de pg_get_expr, e o deparse de uma
-- subconsulta correlacionada qualifica a coluna externa com o nome do PAI
-- (`encounter_field_value.version_id`). Reparseada na particao, essa referencia
-- nao resolve e o CREATE POLICY falha. Uma chamada de funcao nao correlaciona
-- nada: o deparse sai `clin.version_is_readable(version_id)` e viaja intacto.
--
-- A funcao e SECURITY INVOKER de proposito. A consulta a encounter_version roda
-- com os privilegios de quem chama e HERDA a policy RESTRICTIVE de la: quem nao
-- pode ler a versao nao le os valores dela — sem duplicar a regra de
-- compartilhamento em dois lugares.
CREATE FUNCTION clin.version_is_readable(p_version_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM clin.encounter_version v WHERE v.id = p_version_id) $$;
ALTER FUNCTION clin.version_is_readable(uuid) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.version_is_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.version_is_readable(uuid) TO app_rw;

CREATE POLICY tenant_isolation ON clin.encounter_field_value AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());
CREATE POLICY writer ON clin.encounter_field_value AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());
CREATE POLICY clinical_scope ON clin.encounter_field_value
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all() OR clin.version_is_readable(version_id) );

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
-- Marca do invariante 8, no mesmo molde de audit.ensure_partitions (0023): o
-- ::date daqui e limite de FAIXA DE PARTICAO, nao data de evento clinico.
COMMENT ON FUNCTION clin.ensure_efv_partitions(int) IS 'clock-derived-date';
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
