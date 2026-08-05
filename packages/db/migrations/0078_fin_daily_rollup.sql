-- 0078_fin_daily_rollup.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.7 — daily_rollup com DUAS bases (competencia e caixa). O sentinel UUID
-- 00000000-0000-0000-0000-000000000000 substitui NULL em category_id na PK.
-- Materializado por job noturno. Detector de divergencia obrigatorio.

CREATE TABLE fin.daily_rollup (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id    uuid NOT NULL,
  day          date NOT NULL,
  basis        text NOT NULL CHECK (basis IN ('competencia', 'caixa')),
  kind         fin.entry_kind NOT NULL,
  category_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  status       text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0,
  entries      int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, clinic_id, day, basis, kind, category_id, status),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
ALTER TABLE fin.daily_rollup OWNER TO app_owner;

ALTER TABLE fin.daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.daily_rollup FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.daily_rollup AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

GRANT SELECT, INSERT, UPDATE ON fin.daily_rollup TO app_rw;

-- O job noturno precisa de INSERT/UPDATE/DELETE para recalcular o rollup.
-- O papel `jobs` tem BYPASSRLS e nao usa withTenantTx; acessa diretamente.
GRANT SELECT, INSERT, UPDATE, DELETE ON fin.daily_rollup TO jobs;
