-- 0125_tiss_glosa.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Glosa TISS: item glosado pela operadora em um demonstrativo de retorno.
-- Cada glosa vincula um demonstrativo_item a guia e a versao do prontuario
-- que gerou a guia glosada (Design §2.4 — recurso de glosa precisa reproduzir).
--
-- O codigo_glosa segue o padrao ANS (tabela de motivos de glosa, 4 caracteres).
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. Enum de status da glosa
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.glosa_status AS ENUM (
  'pendente',    -- recem-criada a partir do demonstrativo
  'aceita',      -- clinica aceita a glosa (ou recurso indeferido)
  'contestada',  -- recurso de glosa em andamento
  'revertida'    -- recurso deferido, operadora devolveu o valor
);

-- ---------------------------------------------------------------------------
-- 2. Tabela principal: tiss.glosa
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.glosa (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  demonstrativo_item_id   uuid NOT NULL,
  guia_id                 uuid NOT NULL,
  encounter_version_id    uuid NOT NULL,
  codigo_glosa            varchar(4) NOT NULL,
  descricao_glosa         text NOT NULL,
  valor_glosado_cents     bigint NOT NULL CHECK (valor_glosado_cents > 0),
  status                  tiss.glosa_status NOT NULL DEFAULT 'pendente',
  resolved_at             timestamptz(3),
  resolved_by             uuid,
  created_at              timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, demonstrativo_item_id)
    REFERENCES tiss.demonstrativo_item(tenant_id, id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),

  -- resolved_at e resolved_by vivem ou morrem juntos, e so existem em aceita/revertida
  CHECK (
    (status IN ('aceita', 'revertida') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    OR (status IN ('pendente', 'contestada') AND resolved_at IS NULL AND resolved_by IS NULL)
  )
);
ALTER TABLE tiss.glosa OWNER TO app_owner;

-- Insercao e leitura livres; atualizacao restrita a status e resolucao
GRANT SELECT, INSERT ON tiss.glosa TO app_rw;
GRANT UPDATE (status, resolved_at, resolved_by) ON tiss.glosa TO app_rw;
GRANT SELECT ON tiss.glosa TO rpt_owner;

-- Indices
CREATE INDEX ix_glosa_demonstrativo_item
  ON tiss.glosa (tenant_id, demonstrativo_item_id);

CREATE INDEX ix_glosa_guia
  ON tiss.glosa (tenant_id, guia_id);

CREATE INDEX ix_glosa_pendente
  ON tiss.glosa (tenant_id, created_at DESC)
  WHERE status = 'pendente';

CREATE INDEX ix_glosa_status
  ON tiss.glosa (tenant_id, status);

-- RLS
ALTER TABLE tiss.glosa ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.glosa FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.glosa
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
