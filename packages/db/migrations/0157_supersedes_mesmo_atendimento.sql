-- 0157_supersedes_mesmo_atendimento.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Uma versao so pode superar versao DO MESMO ATENDIMENTO.
--
-- `clin.encounter_version` ja tinha FK de tenant e UNIQUE em
-- `supersedes_version_id` (uma versao e superada no maximo uma vez), mas nada
-- amarrava a versao superada ao `encounter_id` de quem a supera. E
-- `clin.finalize_encounter` fecha o bit `live` de diagnosis, observation,
-- encounter_finding e procedure filtrando SO por `version_id`:
--
--     UPDATE clin.diagnosis SET live = false
--      WHERE tenant_id = v_enc.tenant_id AND version_id = p_supersedes_version_id;
--
-- Logo, uma anulacao aberta no atendimento A, apontando `supersedes` para a
-- versao vigente do atendimento B, apagava o registro vigente de B do resultado
-- de `clin.read_encounter` — sem tocar em nenhuma linha de B e gravando o status
-- 'anulado' em A. O prontuario do paciente devolve o `headVersionId` de todos os
-- atendimentos, entao o valor necessario esta ao alcance de quem tem acesso
-- legitimo de leitura.
--
-- A guarda existe agora em duas camadas. A de aplicacao (`selar`, em
-- packages/emr/src/finalize.ts) devolve erro de dominio e e a que fecha o furo
-- para quem usa a API — hoje o unico caminho, porque `app_rw` nao tem INSERT em
-- `clin.encounter_version` e so a funcao SECURITY DEFINER escreve ali.
--
-- Esta camada cobre o que a de cima nao alcanca: `app_owner`, superusuario e
-- qualquer funcao futura que insira a versao sem passar pelo dominio. O valor
-- dela e no dia em que alguem escrever a proxima `finalize_encounter` — a regra
-- nao depende de essa pessoa lembrar que a regra existe.
--
-- Trigger e nao CHECK porque a regra precisa CONSULTAR outra linha da tabela, e
-- CHECK nao pode. Trigger e nao CREATE OR REPLACE de `clin.finalize_encounter`
-- porque a funcao tem duzentas linhas de PL/pgSQL: reescreve-la por inteiro para
-- acrescentar quatro linhas e o mesmo erro que a 0155 cometeu e a 0156 teve que
-- consertar — corpo redigitado perde guarda que ninguem lembrava que existia.

CREATE FUNCTION clin.fn_supersedes_mesmo_atendimento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_encounter_superado uuid;
BEGIN
  IF NEW.supersedes_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT v.encounter_id INTO v_encounter_superado
    FROM clin.encounter_version v
   WHERE v.tenant_id = NEW.tenant_id
     AND v.id = NEW.supersedes_version_id;

  -- `IS DISTINCT FROM` e nao `<>`: se o SELECT nao achou linha, o valor e NULL e
  -- `<>` devolveria NULL, que num IF se comporta como falso — a versao passaria.
  IF v_encounter_superado IS DISTINCT FROM NEW.encounter_id THEN
    RAISE EXCEPTION
      'versao superada % pertence a outro atendimento', NEW.supersedes_version_id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION clin.fn_supersedes_mesmo_atendimento() OWNER TO app_owner;

CREATE TRIGGER trg_supersedes_mesmo_atendimento
  BEFORE INSERT ON clin.encounter_version
  FOR EACH ROW
  EXECUTE FUNCTION clin.fn_supersedes_mesmo_atendimento();
