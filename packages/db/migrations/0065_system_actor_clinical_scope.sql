-- 0065_system_actor_clinical_scope.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.2 — o worker (ator system) precisa ler tabelas clinicas dentro de
-- withTenantTx para montar o hash canonical antes de chamar finalize_encounter.
-- A politica RESTRICTIVE clinical_scope usava clinical_scope_all(), que so
-- reconhecia admin_clinico/diretor_tecnico. O sistema nunca e nenhum dos dois
-- e o SELECT retornava zero linhas, fazendo o callback desistir silenciosamente.
--
-- A correcao segue o mesmo padrao de is_member(): ator system com user_id NULL
-- recebe acesso total dentro do tenant — ja isolado pelo PERMISSIVE de tenant.

CREATE OR REPLACE FUNCTION app.clinical_scope_all() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id = app.current_user_id()
                    AND m.tenant_id = app.current_tenant_id()
                    AND m.role IN ('admin_clinico','diretor_tecnico')
                    AND m.revoked_at IS NULL)
      OR app.current_user_id() IS NULL
         AND current_setting('app.actor_kind', true) = 'system' $$;

-- O worker de selo e o de auto-finalizacao verificam encounter_version
-- para conferir integridade. O job so LE — nunca insere diretamente.
GRANT SELECT ON clin.encounter_version TO jobs;
