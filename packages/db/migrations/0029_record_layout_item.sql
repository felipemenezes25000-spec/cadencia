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
