-- 0187_appointment_updated_at.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Integracao de calendario precisa saber se um agendamento foi movido,
-- cancelado ou reatribuido desde o ultimo sync. created_at nao responde isso.

BEGIN;

ALTER TABLE sched.appointment
  ADD COLUMN IF NOT EXISTS updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION sched.touch_appointment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, sched
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
ALTER FUNCTION sched.touch_appointment_updated_at() OWNER TO app_owner;
REVOKE ALL ON FUNCTION sched.touch_appointment_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_appointment_updated_at ON sched.appointment;
CREATE TRIGGER trg_appointment_updated_at
BEFORE UPDATE ON sched.appointment
FOR EACH ROW EXECUTE FUNCTION sched.touch_appointment_updated_at();

COMMIT;
