-- 0132_login_bootstrap.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- O BOOTSTRAP DO LOGIN.
--
-- A policy de app.membership (migration 0007) exige
-- `tenant_id = app.current_tenant_id()`. No login isso e circular: e justamente
-- app.membership que decide QUAL tenant o usuario pode assumir. Sem uma leitura
-- que anteceda o tenant, ninguem consegue escolher a clinica, e nenhuma outra
-- rota do sistema responde 200 — todas exigem `x-clinic-id`.
--
-- A saida e a mesma da 0043 (clin.patient_exists_by_identifier): funcao
-- SECURITY DEFINER de dono DEDICADO e retorno ESTREITO. `app_owner` nao serve
-- como dono porque FORCE ROW LEVEL SECURITY alcanca o proprio dono da tabela, e
-- as policies de app.membership sao todas `TO app_rw` — uma funcao de app_owner
-- cairia na negacao por padrao e devolveria zero linhas para todo mundo.
--
-- id_login e o decimo papel da §3.1. Nasce com o MINIMO absoluto: NOLOGIN,
-- SELECT em tres tabelas, dono de uma unica funcao. Nao tem INSERT, UPDATE nem
-- DELETE em lugar nenhum do cluster, e por isso nao consegue conceder vinculo a
-- ninguem — so enxergar os que ja existem.
--
-- A garantia de que a funcao nao vira enumerador de vinculos alheios e
-- ESTRUTURAL, em duas camadas:
--   1. O parametro e um uuid de usuario que o chamador ja provou possuir — a
--      rota so a invoca DEPOIS de verifyPassword() aceitar a senha daquele id.
--   2. O retorno nao carrega nenhuma coluna de pessoa: nem e-mail, nem CPF, nem
--      nome de usuario. So tenant, clinica e papel — o que a tela de escolha de
--      unidade precisa desenhar e nada alem.

CREATE ROLE id_login NOLOGIN;

-- Mesma razao da 0001: em host gerenciado, quem cria o papel nao ganha
-- `SET ROLE` sobre ele, e o `ALTER FUNCTION ... OWNER TO id_login` do fim deste
-- arquivo falharia. No-op em cluster proprio.
DO $portabilidade$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND current_user <> 'app_owner' THEN
    EXECUTE format('GRANT id_login TO %I WITH SET TRUE', current_user);
  END IF;
END $portabilidade$;

-- CREATE transitorio: o PostgreSQL exige que o novo dono tenha CREATE no schema
-- para aceitar `ALTER FUNCTION ... OWNER TO id_login` no fim deste arquivo.
-- Superusuario ignora a checagem; Postgres gerenciado nao. A 0134 revoga.
GRANT CREATE ON SCHEMA app, id TO id_login;
GRANT USAGE  ON SCHEMA app, id TO id_login;
GRANT SELECT ON app.membership TO id_login;
GRANT SELECT ON app.tenant     TO id_login;
GRANT SELECT ON app.clinic     TO id_login;
GRANT SELECT ON id."user"      TO id_login;

-- As policies sao `USING (true)` de proposito e isso NAO afrouxa o isolamento:
-- id_login nao tem LOGIN, nao e concedido a nenhum papel de conexao, e a unica
-- coisa que existe no cluster rodando como id_login e a funcao abaixo. O filtro
-- real mora no corpo dela.
CREATE POLICY login ON app.membership AS PERMISSIVE FOR SELECT TO id_login USING (true);
CREATE POLICY login ON app.tenant     AS PERMISSIVE FOR SELECT TO id_login USING (true);
CREATE POLICY login ON app.clinic     AS PERMISSIVE FOR SELECT TO id_login USING (true);

CREATE FUNCTION id.memberships_for_login(p_user_id uuid)
RETURNS TABLE (
  tenant_id    uuid,
  tenant_nome  text,
  clinic_id    uuid,
  clinic_nome  text,
  clinic_tz    text,
  role         text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, id, pg_catalog AS $fn$
  SELECT m.tenant_id, t.razao_social, m.clinic_id, c.nome, c.timezone, m.role
    FROM app.membership m
    JOIN app.tenant  t ON t.id = m.tenant_id
    JOIN app.clinic  c ON (c.tenant_id, c.id) = (m.tenant_id, m.clinic_id)
    JOIN id."user"   u ON u.id = m.user_id
   WHERE m.user_id = p_user_id
     AND m.revoked_at  IS NULL
     -- Conta desativada nao lista unidade nenhuma: o vinculo pode continuar
     -- vigente para efeito de auditoria historica sem dar acesso hoje.
     AND u.disabled_at IS NULL
     AND u.status = 'ativo'
   ORDER BY t.razao_social, c.nome, m.role
$fn$;

ALTER FUNCTION id.memberships_for_login(uuid) OWNER TO id_login;
REVOKE ALL   ON FUNCTION id.memberships_for_login(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION id.memberships_for_login(uuid) TO app_rw;
