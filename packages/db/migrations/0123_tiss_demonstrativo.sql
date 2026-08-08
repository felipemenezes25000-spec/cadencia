-- 0123_tiss_demonstrativo.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Demonstrativo de retorno TISS: resultado financeiro que a operadora devolve
-- ao prestador apos processar um lote. Pode ser de analise (pre-pagamento) ou
-- de pagamento (liquidacao). Um demonstrativo pode vir avulso (lote_id NULL)
-- ou vinculado a um lote previamente enviado.
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. Enum de tipo do demonstrativo
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.demonstrativo_kind AS ENUM ('analise', 'pagamento');

-- ---------------------------------------------------------------------------
-- 2. Tabela principal: tiss.demonstrativo
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.demonstrativo (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  operadora_id            uuid NOT NULL,
  lote_id                 uuid,
  protocolo_operadora     varchar NOT NULL,
  kind                    tiss.demonstrativo_kind NOT NULL,
  data_processamento      date NOT NULL,
  data_pagamento          date,
  xml_storage_key         text NOT NULL,
  total_apresentado_cents bigint NOT NULL CHECK (total_apresentado_cents >= 0),
  total_processado_cents  bigint NOT NULL CHECK (total_processado_cents >= 0),
  total_liberado_cents    bigint NOT NULL CHECK (total_liberado_cents >= 0),
  total_glosa_cents       bigint NOT NULL CHECK (total_glosa_cents >= 0),
  imported_at             timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  imported_by             uuid NOT NULL,

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),
  FOREIGN KEY (tenant_id, lote_id)
    REFERENCES tiss.lote(tenant_id, id),

  -- data_pagamento so faz sentido no demonstrativo de pagamento
  CHECK (
    (kind = 'pagamento' AND data_pagamento IS NOT NULL)
    OR (kind = 'analise' AND data_pagamento IS NULL)
  )
);
ALTER TABLE tiss.demonstrativo OWNER TO app_owner;
GRANT SELECT, INSERT ON tiss.demonstrativo TO app_rw;
GRANT SELECT, INSERT ON tiss.demonstrativo TO jobs;

-- Indices
CREATE INDEX ix_demonstrativo_operadora
  ON tiss.demonstrativo (tenant_id, operadora_id);

CREATE INDEX ix_demonstrativo_lote
  ON tiss.demonstrativo (tenant_id, lote_id)
  WHERE lote_id IS NOT NULL;

CREATE INDEX ix_demonstrativo_imported_at
  ON tiss.demonstrativo (tenant_id, imported_at DESC);

-- RLS
ALTER TABLE tiss.demonstrativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.demonstrativo FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.demonstrativo
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_bypass ON tiss.demonstrativo
  AS PERMISSIVE FOR ALL TO jobs
  USING (true) WITH CHECK (true);
