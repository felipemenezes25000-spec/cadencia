-- 0048_recurrence.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — recorrencia MATERIALIZADA, horizonte 120 dias, nao regra calculada em
-- runtime. Duas razoes: (1) recalcular a serie toda vez que a agenda abre custa
-- na tela mais quente do produto; (2) com regra, arrastar UMA ocorrencia quebra
-- a regra — materializada, cada ocorrencia e uma linha comum que se move,
-- cancela e encaixa como qualquer outra.

CREATE TYPE sched.recurrence_freq AS ENUM ('diaria','semanal','quinzenal','mensal');

CREATE TABLE sched.recurrence (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  procedure_id    uuid,
  freq            sched.recurrence_freq NOT NULL,
  intervalo       int NOT NULL DEFAULT 1 CHECK (intervalo BETWEEN 1 AND 12),
  first_starts_at timestamptz(3) NOT NULL,
  duracao_min     int NOT NULL CHECK (duracao_min > 0),
  horizonte_ate   date NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id));
ALTER TABLE sched.recurrence OWNER TO app_owner;

-- A 0046 deixou sched.appointment.recurrence_id sem FK porque a serie ainda nao
-- existia. Agora existe, e a coluna passa a apontar de verdade.
ALTER TABLE sched.appointment ADD CONSTRAINT appointment_recurrence_fkey
  FOREIGN KEY (tenant_id, recurrence_id) REFERENCES sched.recurrence(tenant_id, id);

GRANT SELECT, INSERT, UPDATE ON sched.recurrence TO app_rw;
-- Sem DELETE: apagar a serie nao apagaria o que ela ja gerou, e a ocorrencia
-- materializada sai de circulacao por status = 'cancelado', como qualquer outra.

ALTER TABLE sched.recurrence ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.recurrence FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.recurrence AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- A trilha registra QUANTAS ocorrencias nasceram, quantas foram puladas por
-- colisao e com que frequencia — nada mais. Nenhuma das tres chaves estava na
-- whitelist da migration 0009, e chave fora dela derruba a linha inteira no
-- CHECK meta_sem_pii, que e exatamente o desenho: chave nova exige migration
-- revisada (mesmo caminho que a 0044 abriu para `horas`).
--
-- As tres sao provadamente inocentes: `geradas` e `puladas` sao inteiros
-- limitados pelo horizonte de 120 dias, e `freq` e um rotulo de enum de quatro
-- valores. Nao ha onde esconder dado clinico nelas.
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',      -- motivo de negacao, de quebra-vidro, de expurgo
              'route',       -- rota HTTP, sem query string
              'method',      -- verbo HTTP
              'status_code',
              'duration_ms',
              'use_case',    -- caso de uso de leitura (deduplicacao, §3.7)
              'record_count',
              'version_no',
              'kind',        -- original | retificacao | adendo | ...
              'role',
              'grant_id',    -- concessao de break-glass
              'horas',       -- prazo do quebra-vidro assistencial (§5.4)
              'geradas',     -- ocorrencias materializadas pela recorrencia (§5.3)
              'puladas',     -- ocorrencias que colidiram e foram puladas (§5.3)
              'freq',        -- diaria | semanal | quinzenal | mensal
              'ticket',      -- chamado do suporte
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id'
            )
         );
$$;

RESET ROLE;

CREATE FUNCTION sched.materialize_recurrence(
  p_patient_id      uuid,
  p_professional_id uuid,
  p_clinic_id       uuid,
  p_first_starts_at timestamptz,
  p_duracao_min     int,
  p_freq            sched.recurrence_freq,
  p_intervalo       int DEFAULT 1,
  p_horizonte_dias  int DEFAULT 120,
  p_procedure_id    uuid DEFAULT NULL)
RETURNS TABLE (recurrence_id uuid, geradas int, puladas int)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_id     uuid := gen_random_uuid();
  v_tz     text;
  v_ate    timestamptz;
  v_at     timestamptz := p_first_starts_at;
  v_passo  interval;
  v_ger    int := 0;
  v_pul    int := 0;
BEGIN
  IF p_horizonte_dias < 1 OR p_horizonte_dias > 120 THEN
    RAISE EXCEPTION 'horizonte da recorrencia fica entre 1 e 120 dias, recebido %',
      p_horizonte_dias USING ERRCODE = '22023';
  END IF;

  SELECT c.timezone INTO v_tz FROM app.clinic c
   WHERE c.tenant_id = v_tenant AND c.id = p_clinic_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'unidade % nao encontrada', p_clinic_id USING ERRCODE = 'P0002';
  END IF;

  v_passo := CASE p_freq
    WHEN 'diaria'    THEN make_interval(days   => p_intervalo)
    WHEN 'semanal'   THEN make_interval(weeks  => p_intervalo)
    WHEN 'quinzenal' THEN make_interval(weeks  => 2 * p_intervalo)
    WHEN 'mensal'    THEN make_interval(months => p_intervalo) END;
  v_ate := p_first_starts_at + make_interval(days => p_horizonte_dias);

  INSERT INTO sched.recurrence (
      tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
      freq, intervalo, first_starts_at, duracao_min, horizonte_ate, created_by)
  VALUES (v_tenant, v_id, p_patient_id, p_professional_id, p_clinic_id, p_procedure_id,
      p_freq, p_intervalo, p_first_starts_at, p_duracao_min,
      app.local_date(v_ate, v_tz), app.current_user_id());

  WHILE v_at <= v_ate LOOP
    BEGIN
      INSERT INTO sched.appointment (
          tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, recurrence_id, created_by)
      VALUES (v_tenant, gen_random_uuid(), p_patient_id, p_professional_id, p_clinic_id,
          p_procedure_id, v_at, v_at + make_interval(mins => p_duracao_min),
          app.local_date(v_at, v_tz), v_id, app.current_user_id());
      v_ger := v_ger + 1;
    EXCEPTION WHEN exclusion_violation THEN
      -- Uma colisao NAO aborta a serie: a recepcionista resolve as puladas
      -- depois, na tela. Abortar tudo por causa de um feriado e o comportamento
      -- que faz a pessoa desistir do recurso.
      v_pul := v_pul + 1;
    END;
    v_at := v_at + v_passo;
  END LOOP;

  PERFORM audit.log('APPOINTMENT_RECURRENCE_CREATE', 'sched', 'recurrence', v_id, 'sucesso',
                    jsonb_build_object('geradas', v_ger, 'puladas', v_pul,
                                       'freq', p_freq::text), p_clinic_id);

  RETURN QUERY SELECT v_id, v_ger, v_pul;
END $fn$;

ALTER FUNCTION sched.materialize_recurrence(
  uuid, uuid, uuid, timestamptz, int, sched.recurrence_freq, int, int, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION sched.materialize_recurrence(
  uuid, uuid, uuid, timestamptz, int, sched.recurrence_freq, int, int, uuid) TO app_rw;
