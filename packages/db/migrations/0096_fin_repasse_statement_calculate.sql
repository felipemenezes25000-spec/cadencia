-- 0096_fin_repasse_statement_calculate.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · extrato de repasse e funcao de calculo automatico de splits.

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado para status do extrato
-- ---------------------------------------------------------------------------
CREATE TYPE fin.repasse_statement_status AS ENUM ('aberto', 'fechado', 'pago');

-- ---------------------------------------------------------------------------
-- 2. Extrato de repasse
-- ---------------------------------------------------------------------------
CREATE TABLE fin.repasse_statement (
  tenant_id                uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                       uuid NOT NULL,
  professional_id          uuid NOT NULL,
  clinic_id                uuid NOT NULL,
  period_start             date NOT NULL,
  period_end               date NOT NULL,
  total_entries            int NOT NULL DEFAULT 0,
  total_professional_share bigint NOT NULL DEFAULT 0,
  total_clinic_share       bigint NOT NULL DEFAULT 0,
  status                   fin.repasse_statement_status NOT NULL DEFAULT 'aberto',
  paid_at                  timestamptz(3),
  created_at               timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Um extrato por profissional por periodo por clinica
  UNIQUE (tenant_id, professional_id, clinic_id, period_start, period_end),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  CHECK (period_end >= period_start),
  CHECK (total_entries >= 0),
  CHECK (total_professional_share >= 0),
  CHECK (total_clinic_share >= 0),
  CHECK ((status = 'pago') = (paid_at IS NOT NULL))
);
ALTER TABLE fin.repasse_statement OWNER TO app_owner;

CREATE INDEX ix_repasse_statement_professional
  ON fin.repasse_statement (tenant_id, professional_id, period_start DESC);
CREATE INDEX ix_repasse_statement_status
  ON fin.repasse_statement (tenant_id, status) WHERE status <> 'pago';

GRANT SELECT, INSERT, UPDATE ON fin.repasse_statement TO app_rw;
GRANT SELECT, INSERT, UPDATE ON fin.repasse_statement TO jobs;

ALTER TABLE fin.repasse_statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.repasse_statement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.repasse_statement AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Medico ve so o proprio extrato (§5.4)
CREATE POLICY own_statements ON fin.repasse_statement AS RESTRICTIVE FOR SELECT TO app_rw
  USING (
    app.has_role_in(clinic_id, ARRAY['admin_clinico', 'diretor_tecnico', 'financeiro'])
    OR professional_id = app.current_professional_id()
  );

-- ---------------------------------------------------------------------------
-- 3. FK de fin.split.statement_id para fin.repasse_statement
-- ---------------------------------------------------------------------------
ALTER TABLE fin.split
  ADD CONSTRAINT fk_split_statement
    FOREIGN KEY (tenant_id, statement_id)
    REFERENCES fin.repasse_statement(tenant_id, id);

-- ---------------------------------------------------------------------------
-- 4. Funcao SECURITY DEFINER: calcula o split de um entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin.calculate_splits(
  p_tenant_id uuid,
  p_entry_id  uuid
) RETURNS void
LANGUAGE plpgsql SET search_path = fin, app, sched, pg_catalog AS $$
DECLARE
  v_entry        RECORD;
  v_procedure_id uuid;
  v_convention    text;
  v_rule         RECORD;
  v_professional_share bigint;
  v_clinic_share       bigint;
BEGIN
  -- 1. Buscar o entry
  SELECT e.id, e.tenant_id, e.professional_id, e.appointment_id,
         e.amount_cents, e.kind::text AS kind, e.status::text AS status
    INTO v_entry
    FROM fin.entry e
   WHERE e.tenant_id = p_tenant_id AND e.id = p_entry_id;

  IF NOT FOUND THEN RETURN; END IF;
  -- So calcula para receitas pagas
  IF v_entry.kind <> 'receita' OR v_entry.status <> 'pago' THEN RETURN; END IF;
  -- Se ja existe split, nao recalcula
  IF EXISTS (SELECT 1 FROM fin.split s
              WHERE s.tenant_id = p_tenant_id AND s.entry_id = p_entry_id) THEN
    RETURN;
  END IF;

  -- 2. Resolver procedure_id e convention via appointment
  IF v_entry.appointment_id IS NOT NULL THEN
    SELECT a.procedure_id, a.operadora_nome
      INTO v_procedure_id, v_convention
      FROM sched.appointment a
     WHERE a.tenant_id = p_tenant_id AND a.id = v_entry.appointment_id;
  END IF;

  -- 3. Buscar a regra mais especifica (maior prioridade)
  -- Ordem de especificidade: professional + procedure + convention > professional + procedure > professional + convention > professional default
  SELECT r.id, r.percentage, r.fixed_amount_cents
    INTO v_rule
    FROM fin.split_rule r
   WHERE r.tenant_id = p_tenant_id
     AND r.professional_id = v_entry.professional_id
     AND r.active = true
     AND (r.procedure_id IS NULL OR r.procedure_id = v_procedure_id)
     AND (r.convention_name IS NULL OR r.convention_name = v_convention)
   ORDER BY r.priority DESC
   LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  -- 4. Calcular as partes
  IF v_rule.fixed_amount_cents IS NOT NULL THEN
    -- Valor fixo: o profissional recebe o fixo, clinica fica com o restante
    v_professional_share := LEAST(v_rule.fixed_amount_cents, v_entry.amount_cents);
    v_clinic_share := v_entry.amount_cents - v_professional_share;
  ELSE
    -- Percentual: arredonda centavo para o profissional
    v_professional_share := ROUND(v_entry.amount_cents * v_rule.percentage / 100);
    v_clinic_share := v_entry.amount_cents - v_professional_share;
  END IF;

  -- 5. Inserir o split
  INSERT INTO fin.split
    (tenant_id, id, entry_id, split_rule_id, professional_id,
     clinic_share_cents, professional_share_cents, status)
  VALUES
    (p_tenant_id, gen_random_uuid(), p_entry_id, v_rule.id,
     v_entry.professional_id,
     v_clinic_share, v_professional_share, 'pendente');
END;
$$;
ALTER FUNCTION fin.calculate_splits(uuid, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION fin.calculate_splits(uuid, uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION fin.calculate_splits(uuid, uuid) TO jobs;
