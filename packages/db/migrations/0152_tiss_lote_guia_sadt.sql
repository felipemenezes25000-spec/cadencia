-- 0152_tiss_lote_guia_sadt.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Vinculo entre lote e guia SP/SADT.
--
-- POR QUE UMA SEGUNDA TABELA DE VINCULO, e nao uma coluna `tipo` em
-- `tiss.lote_guia`: aquela tabela tem FK composta para
-- `tiss.encounter_guia_consulta(tenant_id, id)`. Tornar o vinculo polimorfico
-- exigiria largar a FK e guardar `guia_id` solto — exatamente o que o
-- invariante #02 proibe ("FK composta e nenhuma coluna *_id orfa"). Uma coluna
-- de id sem FK e um vazamento esperando acontecer: guia apagada, lote apontando
-- para o nada, e o XML saindo com uma guia a menos sem ninguem notar.
--
-- Duas tabelas de vinculo tambem espelham a norma: `guiasTISS` e um `choice`,
-- e um lote MISTO de consulta com SP/SADT e recusado inteiro pela operadora.
-- Com tabelas separadas, o lote misto e impossivel de montar por construcao.
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

CREATE TABLE tiss.lote_guia_sadt (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  lote_id         uuid NOT NULL,
  guia_id         uuid NOT NULL,
  sequencial_item smallint NOT NULL CHECK (sequencial_item >= 1),

  PRIMARY KEY (tenant_id, lote_id, guia_id),
  UNIQUE (tenant_id, lote_id, sequencial_item),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, lote_id)
    REFERENCES tiss.lote(tenant_id, id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_sadt(tenant_id, id)
);

ALTER TABLE tiss.lote_guia_sadt OWNER TO app_owner;

CREATE INDEX ix_lote_guia_sadt_guia
  ON tiss.lote_guia_sadt (tenant_id, guia_id);

ALTER TABLE tiss.lote_guia_sadt ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.lote_guia_sadt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.lote_guia_sadt
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

GRANT SELECT, INSERT, DELETE ON tiss.lote_guia_sadt TO app_rw;
GRANT SELECT ON tiss.lote_guia_sadt TO rpt_owner;
