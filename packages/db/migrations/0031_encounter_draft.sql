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
-- Este e o unico indice multi-tenant que NAO comeca por tenant_id, e a excecao e
-- declarada, nao esquecida: quem o percorre e o job de varredura, que roda como
-- `jobs` (BYPASSRLS) atras de rascunho parado de TODOS os tenants de uma vez.
-- Liderar por tenant_id obrigaria uma varredura por clinica a cada rodada.
COMMENT ON INDEX clin.ix_draft_parado IS 'tenant-scoped-by-parent';

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
