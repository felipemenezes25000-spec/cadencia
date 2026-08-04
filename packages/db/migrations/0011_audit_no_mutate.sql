-- 0011_audit_no_mutate.sql
-- REVOKE detem app_rw e app_owner. Nao detem superusuario nem o papel jobs
-- (BYPASSRLS). Trigger detem: dispara para qualquer papel, sem excecao.

SET ROLE audit_owner;

CREATE FUNCTION audit.deny() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.event e append-only: % nao e permitido nesta tabela', TG_OP
    USING ERRCODE = '42501',
          HINT = 'A trilha so aceita INSERT. Correcao de registro se faz com evento novo.';
END $$;

CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.deny();

RESET ROLE;
