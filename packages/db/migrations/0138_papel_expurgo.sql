-- 0138_papel_expurgo.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- O expurgo de 0136/0137 nao funcionava porque a funcao era de `app_owner`, e
-- `app_owner` NAO TEM POLITICA em nenhuma tabela clinica: as politicas sao de
-- `app_rw`, `clin_writer` e `id_login`. Com FORCE ROW LEVEL SECURITY, dono sem
-- politica aplicavel enxerga zero linhas — e a funcao concluia "tenant
-- inexistente" para um tenant que existe.
--
-- A saida NAO e dar politica ampla ao dono. `app_owner` e quem faz DDL; se ele
-- tambem enxergasse dado de todos os tenants, qualquer funcao SECURITY DEFINER
-- escrita depois herdaria essa visao por acidente.
--
-- A saida e o padrao que o proprio esquema ja usa duas vezes — `clin_writer`
-- para escrita clinica, `id_login` para o bootstrap de sessao: um papel NOLOGIN,
-- com o MINIMO de privilegio, dono da funcao e sujeito a uma politica propria.

CREATE ROLE clin_purger NOLOGIN;
COMMENT ON ROLE clin_purger IS
  'Dono de clin.purge_expired. NOLOGIN. Le o necessario para calcular a janela '
  'de retencao e so pode UPDATE nas duas tabelas expurgaveis.';

GRANT USAGE ON SCHEMA app, clin, audit TO clin_purger;

-- Leitura: o minimo para decidir O QUE expurgar.
GRANT SELECT ON app.tenant                     TO clin_purger;
GRANT SELECT ON clin.encounter                 TO clin_purger;
GRANT SELECT ON clin.encounter_version         TO clin_purger;
GRANT SELECT ON clin.encounter_field_value     TO clin_purger;
GRANT SELECT ON clin.attachment                TO clin_purger;

-- Escrita: SOMENTE as duas tabelas que tem `purged_at`. Sem DELETE em lugar
-- nenhum — expurgo destroi conteudo, nunca remove linha.
GRANT UPDATE ON clin.encounter_field_value TO clin_purger;
GRANT UPDATE ON clin.attachment            TO clin_purger;

-- Politicas: mesmo isolamento por tenant que todo mundo. O papel privilegiado
-- nao ganha visao global; ele ganha o direito de agir DENTRO de um tenant.
CREATE POLICY purger ON app.tenant AS PERMISSIVE FOR SELECT TO clin_purger
  USING (id = app.current_tenant_id());
CREATE POLICY purger ON clin.encounter AS PERMISSIVE FOR SELECT TO clin_purger
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY purger ON clin.encounter_version AS PERMISSIVE FOR SELECT TO clin_purger
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY purger ON clin.encounter_field_value AS PERMISSIVE FOR ALL TO clin_purger
  USING      (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY purger ON clin.attachment AS PERMISSIVE FOR ALL TO clin_purger
  USING      (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- audit.log e SECURITY DEFINER e ja concede a quem precisa registrar.
GRANT EXECUTE ON FUNCTION audit.log(text, text, text, uuid, text, jsonb, uuid)
  TO clin_purger;

-- ALTER ... OWNER TO exige que o papel corrente seja membro do papel alvo.
GRANT clin_purger TO current_user WITH SET TRUE;
-- E exige CREATE no schema onde a funcao mora. Concedido aqui e revogado no
-- fim: privilegio transitorio de migration nao pode sobrar no cluster.
GRANT CREATE ON SCHEMA clin TO clin_purger;

ALTER FUNCTION clin.purge_expired(uuid, int) OWNER TO clin_purger;

REVOKE CREATE ON SCHEMA clin FROM clin_purger;
REVOKE ALL ON FUNCTION clin.purge_expired(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.purge_expired(uuid, int) TO jobs;
