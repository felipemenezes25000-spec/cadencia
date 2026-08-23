-- 0203_finding_field_link.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- `clin.finalize_encounter` recebe os achados categoricos no payload canônico
-- como (field_code, option_code, display_snapshot, ordinal). O modelo de hash
-- deliberadamente não inclui o UUID operacional do campo, mas a tabela
-- `clin.encounter_finding` exige `field_id NOT NULL` para permitir reprojeção e
-- retificação segura. A função de finalização historicamente tentava ler
-- `field_id` do JSON mesmo sem o contrato expô-lo, produzindo NULL.
--
-- Resolver o vínculo no banco mantém uma única fonte de verdade: o field_code
-- selado é associado ao record_field vivo do MESMO tenant antes da constraint e
-- da FK serem avaliadas. Não se remove NOT NULL e não se cria achado órfão.

CREATE FUNCTION clin.resolve_finding_field_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clin, app, pg_catalog
AS $fn$
DECLARE
  v_field_id uuid;
BEGIN
  IF NEW.field_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT f.id
    INTO v_field_id
    FROM clin.record_field f
   WHERE f.tenant_id = NEW.tenant_id
     AND f.code = NEW.field_code
     AND f.archived_at IS NULL
   ORDER BY f.generation DESC
   LIMIT 1;

  IF v_field_id IS NULL THEN
    RAISE EXCEPTION 'campo % nao encontrado para achado clinico', NEW.field_code
      USING ERRCODE = '23503';
  END IF;

  NEW.field_id := v_field_id;
  RETURN NEW;
END
$fn$;

ALTER FUNCTION clin.resolve_finding_field_id() OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.resolve_finding_field_id() FROM PUBLIC;

CREATE TRIGGER resolve_field_id
  BEFORE INSERT ON clin.encounter_finding
  FOR EACH ROW
  EXECUTE FUNCTION clin.resolve_finding_field_id();
