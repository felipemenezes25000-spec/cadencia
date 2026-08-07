-- 0117_tiss_guia_counter.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- S3.9 — contador de numero_guia_prestador por tenant. Auto-provisiona na
-- primeira guia. Sem now()/current_date (invariante tiss).

CREATE TABLE tiss.guia_counter (
  tenant_id   uuid NOT NULL,
  next_value  bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id)
);

ALTER TABLE tiss.guia_counter OWNER TO app_owner;

-- RLS: app_rw precisa de acesso para o INSERT ON CONFLICT na funcao.
ALTER TABLE tiss.guia_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.guia_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.guia_counter
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

GRANT SELECT, INSERT, UPDATE ON tiss.guia_counter TO app_rw;

-- Funcao que auto-provisiona e devolve o numero consumido.
-- INSERT ... ON CONFLICT DO UPDATE SET next_value = next_value + 1
-- RETURNING next_value - 1  (o valor CONSUMIDO, nao o proximo livre).
-- Na primeira chamada para um tenant, insere (1) e retorna 1 (next_value apos
-- o upsert e 2, mas retornamos next_value - 1 = 1 — leia o RETURNING).
-- Correcao do desenho original: a primeira guia retornava NULL.
CREATE FUNCTION tiss.next_guia_number(p_tenant_id uuid)
RETURNS bigint
LANGUAGE sql
VOLATILE
AS $$
  INSERT INTO tiss.guia_counter (tenant_id, next_value)
  VALUES (p_tenant_id, 2)
  ON CONFLICT (tenant_id)
  DO UPDATE SET next_value = tiss.guia_counter.next_value + 1
  RETURNING next_value - 1
$$;

ALTER FUNCTION tiss.next_guia_number(uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION tiss.next_guia_number(uuid) TO app_rw;
