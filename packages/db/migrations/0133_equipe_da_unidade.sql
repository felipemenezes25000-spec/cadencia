-- 0133_equipe_da_unidade.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- LISTAR A EQUIPE.
--
-- A migration 0007 previu esta funcao por escrito, no comentario da policy de
-- app.membership: "Listar a equipe (visao de admin) e Fase 1, por funcao
-- SECURITY DEFINER propria." Esta e ela.
--
-- Por que nao afrouxar a policy: a de app.membership e
-- `tenant_id = current_tenant_id() AND user_id = current_user_id()` — so o dono
-- le o proprio vinculo. Ela nao pode chamar app.is_member() porque is_member()
-- le esta mesma tabela e o planejador aborta com recursao infinita. Trocar o
-- predicado por "qualquer membro do tenant le todos os vinculos" resolveria a
-- listagem e abriria a raiz da confianca: um contexto forjado passaria a
-- enumerar a equipe inteira em vez de encontrar conjunto vazio.
--
-- A funcao e ESTREITA por tres razoes acumuladas:
--   1. recebe a clinica e devolve so quem tem vinculo VIGENTE nela;
--   2. o tenant NAO vem por parametro — vem de app.current_tenant_id(), que e o
--      preambulo da transacao. Quem chama nao escolhe o tenant que le;
--   3. devolve nome, e-mail, papel e conselho. Nao devolve credencial, TOTP,
--      CPF nem nada de outro tenant.
--
-- O dono e id_login, o papel minimo criado na 0132: NOLOGIN, sem nenhum
-- privilegio de escrita no cluster, ja com SELECT em app.membership e id."user".
-- O invariante 3 checa que ele continue assim.

CREATE FUNCTION app.equipe_da_unidade(p_clinic_id uuid)
RETURNS TABLE (
  user_id    uuid,
  nome       text,
  email      text,
  role       text,
  conselho   text,
  granted_at timestamptz(3)
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, id, pg_catalog AS $fn$
  SELECT m.user_id,
         u.full_name,
         u.email::text,
         m.role,
         -- Conselho vem de app.professional: quem nao e profissional de saude
         -- (recepcao, financeiro) devolve NULL, e a tela usa isso para decidir
         -- se mostra a coluna de registro.
         CASE WHEN pr.id IS NULL THEN NULL
              ELSE pr.conselho_profissional || ' ' || pr.numero_conselho
                   || '/' || pr.uf_conselho END,
         m.granted_at
    FROM app.membership m
    JOIN id."user" u ON u.id = m.user_id
    LEFT JOIN app.professional pr
           ON pr.tenant_id = m.tenant_id AND pr.user_id = m.user_id
   WHERE m.tenant_id = app.current_tenant_id()
     AND m.clinic_id = p_clinic_id
     AND m.revoked_at IS NULL
     AND u.disabled_at IS NULL
   ORDER BY u.full_name COLLATE "pt-BR-x-icu"
$fn$;

-- app.professional ainda nao e legivel por id_login: sem este par
-- GRANT + POLICY a funcao devolveria NULL em `conselho` para todo mundo, em
-- silencio — o pior modo de falha possivel para uma listagem.
GRANT SELECT ON app.professional TO id_login;
CREATE POLICY login ON app.professional AS PERMISSIVE FOR SELECT TO id_login
  USING (true);

ALTER FUNCTION app.equipe_da_unidade(uuid) OWNER TO id_login;
REVOKE ALL    ON FUNCTION app.equipe_da_unidade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.equipe_da_unidade(uuid) TO app_rw;
