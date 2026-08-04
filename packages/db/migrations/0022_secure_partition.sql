-- 0022_secure_partition.sql
-- Particao NAO herda relrowsecurity, relforcerowsecurity nem pg_policy do pai.
-- Quem consultar a particao diretamente escapa da policy. A Task 26 resolveu isso
-- a mao para audit.event (audit.ensure_partitions); esta funcao generaliza a regra
-- para qualquer particao futura, e o invariante 1 pega quem esquecer de chama-la.

CREATE FUNCTION app.secure_partition(p_partition regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_parent regclass;
  v_pol    record;
BEGIN
  SELECT inhparent INTO v_parent FROM pg_inherits WHERE inhrelid = p_partition;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION '% nao e particao de ninguem', p_partition USING ERRCODE = '42809';
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_partition::text);
  EXECUTE format('ALTER TABLE %s FORCE  ROW LEVEL SECURITY', p_partition::text);

  FOR v_pol IN
    SELECT p.polname,
           p.polpermissive,
           p.polcmd,
           pg_get_expr(p.polqual,      p.polrelid) AS using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
           CASE WHEN 0 = ANY (p.polroles) THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(r.rolname), ', ')
                        FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END AS roles
      FROM pg_policy p
     WHERE p.polrelid = v_parent
       AND NOT EXISTS (SELECT 1 FROM pg_policy q
                        WHERE q.polrelid = p_partition AND q.polname = p.polname)
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %s AS %s FOR %s TO %s %s %s',
      v_pol.polname,
      p_partition::text,
      CASE WHEN v_pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE v_pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
      v_pol.roles,
      CASE WHEN v_pol.using_expr IS NULL THEN '' ELSE 'USING (' || v_pol.using_expr || ')' END,
      CASE WHEN v_pol.check_expr IS NULL THEN '' ELSE 'WITH CHECK (' || v_pol.check_expr || ')' END);
  END LOOP;
END $$;

ALTER FUNCTION app.secure_partition(regclass) OWNER TO app_owner;
REVOKE ALL ON FUNCTION app.secure_partition(regclass) FROM PUBLIC;

-- Rede de seguranca para as particoes que ja existem. As de audit.event ja vieram
-- em conformidade pela audit.ensure_partitions da 0009: aqui o laco e no-op nelas
-- (ENABLE/FORCE sao idempotentes e o laco de policy pula as que ja existem).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS rel
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relispartition
              -- relispartition tambem e verdadeiro para indice particionado
              -- (audit.event_202609_pkey e afins). RLS so existe em tabela.
              AND c.relkind IN ('r', 'p')
              AND n.nspname IN ('app', 'clin', 'fin', 'tiss', 'audit')
  LOOP
    PERFORM app.secure_partition(r.rel);
  END LOOP;
END $$;
