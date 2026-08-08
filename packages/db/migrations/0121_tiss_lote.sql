-- 0121_tiss_lote.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Lote TISS: agrupamento de guias para envio a operadora. O numero do lote e
-- sequencial por operadora dentro do tenant, auto-provisionado na primeira
-- criacao. O ciclo de vida e: rascunho -> pronto -> enviado -> retornado.
-- Cancelamento so e permitido antes do envio.
--
-- Nenhuma ocorrencia de now() ou current_date neste schema (invariante de CI).

-- ---------------------------------------------------------------------------
-- 1. Enum de status do lote
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.lote_status AS ENUM (
  'rascunho', 'pronto', 'enviado', 'retornado', 'cancelado'
);

-- ---------------------------------------------------------------------------
-- 2. Contador de numero de lote por operadora (auto-provisionante)
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.lote_number_counter (
  tenant_id    uuid NOT NULL,
  operadora_id uuid NOT NULL,
  next_value   bigint NOT NULL DEFAULT 2,
  PRIMARY KEY (tenant_id, operadora_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id)
);
ALTER TABLE tiss.lote_number_counter OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.lote_number_counter TO app_rw;

ALTER TABLE tiss.lote_number_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.lote_number_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.lote_number_counter
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Funcao auto-provisionante: primeira chamada insere e devolve 1
-- ---------------------------------------------------------------------------
CREATE FUNCTION tiss.next_lote_number(p_tenant_id uuid, p_operadora_id uuid)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
  INSERT INTO tiss.lote_number_counter (tenant_id, operadora_id, next_value)
  VALUES (p_tenant_id, p_operadora_id, 2)
  ON CONFLICT (tenant_id, operadora_id)
  DO UPDATE SET next_value = tiss.lote_number_counter.next_value + 1
  RETURNING next_value - 1 $$;
ALTER FUNCTION tiss.next_lote_number(uuid, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION tiss.next_lote_number(uuid, uuid) TO app_rw;

-- ---------------------------------------------------------------------------
-- 4. Tabela principal: tiss.lote
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.lote (
  tenant_id             uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                    uuid NOT NULL,
  operadora_id          uuid NOT NULL,
  numero_lote           varchar(12) NOT NULL,
  status                tiss.lote_status NOT NULL DEFAULT 'rascunho',
  tiss_version          varchar(5) NOT NULL,
  guia_count            int NOT NULL DEFAULT 0 CHECK (guia_count >= 0),
  total_value_cents     bigint NOT NULL DEFAULT 0 CHECK (total_value_cents >= 0),
  xml_storage_key       text,
  xml_hash_md5          char(32),
  protocolo_operadora   varchar,
  sent_at               timestamptz(3),
  created_by            uuid NOT NULL,
  created_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, numero_lote),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),
  -- sent_at so pode existir se o lote foi enviado ou retornado
  CHECK (
    (status IN ('enviado', 'retornado') AND sent_at IS NOT NULL)
    OR (status NOT IN ('enviado', 'retornado') AND sent_at IS NULL)
  ),
  -- protocolo so existe apos envio
  CHECK (
    (protocolo_operadora IS NOT NULL AND status IN ('enviado', 'retornado'))
    OR protocolo_operadora IS NULL
  ),
  -- xml_storage_key e xml_hash_md5 vivem ou morrem juntos
  CHECK (num_nonnulls(xml_storage_key, xml_hash_md5) IN (0, 2))
);
ALTER TABLE tiss.lote OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.lote TO app_rw;

CREATE INDEX ix_lote_operadora_status
  ON tiss.lote (tenant_id, operadora_id, status);

CREATE INDEX ix_lote_created_at
  ON tiss.lote (tenant_id, created_at DESC);

ALTER TABLE tiss.lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.lote FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.lote
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
