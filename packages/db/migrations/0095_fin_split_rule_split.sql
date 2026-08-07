-- 0095_fin_split_rule_split.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · repasse medico. Regras de divisao (split_rule) e divisoes
-- calculadas por lancamento (split). Dinheiro em centavos inteiros (bigint).

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado para status do split
-- ---------------------------------------------------------------------------
CREATE TYPE fin.split_status AS ENUM ('pendente', 'creditado', 'pago');

-- ---------------------------------------------------------------------------
-- 2. Regra de repasse
-- ---------------------------------------------------------------------------
CREATE TABLE fin.split_rule (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  professional_id    uuid NOT NULL,
  procedure_id       uuid,              -- NULL = regra default do profissional
  convention_name    text COLLATE "pt-BR-x-icu",  -- NULL = particular
  percentage         numeric(5,2) CHECK (percentage >= 0 AND percentage <= 100),
  fixed_amount_cents bigint CHECK (fixed_amount_cents > 0),
  priority           int NOT NULL DEFAULT 1,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Unicidade: so uma regra ativa por combinacao (professional, procedure, convention).
  -- COALESCE transforma NULL em sentinela para o indice unico.
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id),
  -- Pelo menos um dos dois deve ser preenchido: percentage ou fixed_amount_cents
  CHECK (num_nonnulls(percentage, fixed_amount_cents) >= 1)
);
ALTER TABLE fin.split_rule OWNER TO app_owner;

-- Indice unico parcial: impede regra duplicada para a mesma combinacao.
-- COALESCE transforma NULL em sentinela para que o indice unico funcione.
CREATE UNIQUE INDEX ux_split_rule_combo ON fin.split_rule (
  tenant_id,
  professional_id,
  COALESCE(procedure_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(convention_name, '__PARTICULAR__')
) WHERE active = true;

CREATE INDEX ix_split_rule_professional
  ON fin.split_rule (tenant_id, professional_id) WHERE active = true;

GRANT SELECT, INSERT, UPDATE ON fin.split_rule TO app_rw;

ALTER TABLE fin.split_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.split_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.split_rule AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Divisao calculada por lancamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.split (
  tenant_id                uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                       uuid NOT NULL,
  entry_id                 uuid NOT NULL,
  split_rule_id            uuid NOT NULL,
  professional_id          uuid NOT NULL,
  clinic_share_cents       bigint NOT NULL CHECK (clinic_share_cents >= 0),
  professional_share_cents bigint NOT NULL CHECK (professional_share_cents >= 0),
  status                   fin.split_status NOT NULL DEFAULT 'pendente',
  statement_id             uuid,           -- FK para fin.repasse_statement (migration 0095)
  created_at               timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Um split por entry (1:1)
  UNIQUE (tenant_id, entry_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, entry_id)       REFERENCES fin.entry(tenant_id, id),
  FOREIGN KEY (tenant_id, split_rule_id)  REFERENCES fin.split_rule(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id)
);
ALTER TABLE fin.split OWNER TO app_owner;

-- Constraint: a soma das partes deve ser igual ao amount_cents do entry.
-- Implementada como trigger pois CHECK nao pode cruzar tabelas.
CREATE OR REPLACE FUNCTION fin.check_split_sum()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry_amount bigint;
BEGIN
  SELECT amount_cents INTO v_entry_amount
    FROM fin.entry WHERE tenant_id = NEW.tenant_id AND id = NEW.entry_id;

  IF (NEW.clinic_share_cents + NEW.professional_share_cents) <> v_entry_amount THEN
    RAISE EXCEPTION 'split shares (% + %) <> entry amount_cents (%)',
      NEW.clinic_share_cents, NEW.professional_share_cents, v_entry_amount
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION fin.check_split_sum() OWNER TO app_owner;

CREATE TRIGGER trg_check_split_sum
  BEFORE INSERT OR UPDATE ON fin.split
  FOR EACH ROW EXECUTE FUNCTION fin.check_split_sum();

CREATE INDEX ix_split_professional
  ON fin.split (tenant_id, professional_id, status);
CREATE INDEX ix_split_entry
  ON fin.split (tenant_id, entry_id);
CREATE INDEX ix_split_statement
  ON fin.split (tenant_id, statement_id) WHERE statement_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON fin.split TO app_rw;

ALTER TABLE fin.split ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.split FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.split AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Medico ve so o proprio repasse (§5.4)
CREATE POLICY own_splits ON fin.split AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    app.has_role_in(
      (SELECT e.clinic_id FROM fin.entry e
        WHERE e.tenant_id = fin.split.tenant_id AND e.id = fin.split.entry_id),
      ARRAY['admin_clinico', 'diretor_tecnico', 'financeiro']
    )
    OR professional_id = app.current_professional_id()
  );

-- jobs precisa de acesso para o job de fechamento mensal
GRANT SELECT, INSERT, UPDATE ON fin.split TO jobs;
GRANT SELECT, INSERT, UPDATE ON fin.split_rule TO jobs;
