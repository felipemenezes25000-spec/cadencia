-- 0126_tiss_recurso_glosa.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Recurso de glosa TISS e itens do recurso.
-- Design §3.9 — recurso de glosa sempre cita a encounter_version_id usada.
-- Design §2.4 — recurso de glosa precisa reproduzir o dado clinico.
--
-- O numero do recurso e sequencial por operadora dentro do tenant,
-- auto-provisionado na primeira criacao (mesmo padrao de tiss.lote_number_counter).
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. Enum de status do recurso de glosa
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.recurso_glosa_status AS ENUM (
  'rascunho',       -- em edicao
  'pronto',         -- pronto para envio
  'enviado',        -- enviado a operadora
  'indeterminado',  -- timeout no envio SOAP, resultado desconhecido (bloco 04/06)
  'deferido',       -- recurso aceito pela operadora
  'indeferido',     -- recurso negado pela operadora
  'parcial'         -- recurso parcialmente aceito
);

-- ---------------------------------------------------------------------------
-- 2. Contador de numero de recurso por operadora (auto-provisionante)
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.recurso_number_counter (
  tenant_id    uuid NOT NULL,
  operadora_id uuid NOT NULL,
  next_value   bigint NOT NULL DEFAULT 2,
  PRIMARY KEY (tenant_id, operadora_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id)
);
ALTER TABLE tiss.recurso_number_counter OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.recurso_number_counter TO app_rw;

ALTER TABLE tiss.recurso_number_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.recurso_number_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.recurso_number_counter
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Funcao auto-provisionante: primeira chamada insere e devolve 1
-- ---------------------------------------------------------------------------
CREATE FUNCTION tiss.next_recurso_number(p_tenant_id uuid, p_operadora_id uuid)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
  INSERT INTO tiss.recurso_number_counter (tenant_id, operadora_id, next_value)
  VALUES (p_tenant_id, p_operadora_id, 2)
  ON CONFLICT (tenant_id, operadora_id)
  DO UPDATE SET next_value = tiss.recurso_number_counter.next_value + 1
  RETURNING next_value - 1 $$;
ALTER FUNCTION tiss.next_recurso_number(uuid, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION tiss.next_recurso_number(uuid, uuid) TO app_rw;

-- ---------------------------------------------------------------------------
-- 4. Tabela principal: tiss.recurso_glosa
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.recurso_glosa (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  operadora_id            uuid NOT NULL,
  numero_recurso          varchar(20) NOT NULL,
  status                  tiss.recurso_glosa_status NOT NULL DEFAULT 'rascunho',
  justificativa_geral     text,
  encounter_version_id    uuid NOT NULL,
  xml_storage_key         text,
  protocolo_operadora     varchar,
  sent_at                 timestamptz(3),
  item_count              integer NOT NULL DEFAULT 0,
  total_recursado_cents   bigint NOT NULL DEFAULT 0,
  created_by              uuid NOT NULL,
  created_at              timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, numero_recurso),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),

  -- sent_at so existe apos envio (inclui 'indeterminado' — timeout SOAP)
  CHECK (
    (status IN ('enviado', 'indeterminado', 'deferido', 'indeferido', 'parcial') AND sent_at IS NOT NULL)
    OR (status NOT IN ('enviado', 'indeterminado', 'deferido', 'indeferido', 'parcial') AND sent_at IS NULL)
  ),
  -- protocolo so existe apos envio (indeterminado pode nao ter protocolo)
  CHECK (
    (protocolo_operadora IS NOT NULL AND status IN ('enviado', 'deferido', 'indeferido', 'parcial'))
    OR protocolo_operadora IS NULL
  )
);
ALTER TABLE tiss.recurso_glosa OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.recurso_glosa TO app_rw;
GRANT SELECT ON tiss.recurso_glosa TO rpt_owner;

-- Indices
CREATE INDEX ix_recurso_glosa_operadora_status
  ON tiss.recurso_glosa (tenant_id, operadora_id, status);

CREATE INDEX ix_recurso_glosa_created_at
  ON tiss.recurso_glosa (tenant_id, created_at DESC);

-- RLS
ALTER TABLE tiss.recurso_glosa ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.recurso_glosa FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.recurso_glosa
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 5. Tabela de juncao: tiss.recurso_glosa_item
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.recurso_glosa_item (
  tenant_id              uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                     uuid NOT NULL,
  recurso_id             uuid NOT NULL,
  glosa_id               uuid NOT NULL,
  justificativa_item     text NOT NULL,
  valor_recursado_cents  bigint NOT NULL CHECK (valor_recursado_cents > 0),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, recurso_id, glosa_id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, recurso_id)
    REFERENCES tiss.recurso_glosa(tenant_id, id),
  FOREIGN KEY (tenant_id, glosa_id)
    REFERENCES tiss.glosa(tenant_id, id)
);
ALTER TABLE tiss.recurso_glosa_item OWNER TO app_owner;
GRANT SELECT, INSERT, DELETE ON tiss.recurso_glosa_item TO app_rw;
GRANT SELECT ON tiss.recurso_glosa_item TO rpt_owner;

-- Indices
CREATE INDEX ix_recurso_glosa_item_recurso
  ON tiss.recurso_glosa_item (tenant_id, recurso_id);

CREATE INDEX ix_recurso_glosa_item_glosa
  ON tiss.recurso_glosa_item (tenant_id, glosa_id);

-- RLS
ALTER TABLE tiss.recurso_glosa_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.recurso_glosa_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.recurso_glosa_item
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
