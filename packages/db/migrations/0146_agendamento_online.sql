-- 0146_agendamento_online.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- AGENDAMENTO ONLINE — o paciente marca sozinho, sem login.
--
-- `Actor.kind = 'anon'` existe na camada de transacao desde a Fase 1, com o
-- comentario "agendamento online" ao lado, e NENHUMA politica o contempla: hoje
-- uma transacao anonima enxerga zero linha em tudo. Isso e o fail-closed
-- funcionando, e e o ponto de partida certo.
--
-- A abertura NAO e uma politica para `anon` nas tabelas. Politica em tabela e
-- ampla demais: bastaria uma coluna nova, ou um JOIN esquecido numa rota futura,
-- para o publico enxergar agenda de paciente. A abertura sao DUAS FUNCOES que
-- devolvem exatamente o que pode ser publico, e nada mais.
--
-- O que o publico ve: horarios LIVRES. Nao ve quem esta marcado, nem quantos,
-- nem os nomes. "Das 14h as 15h esta ocupado" ja e informacao de agenda alheia;
-- por isso a funcao devolve so o que sobra.

CREATE ROLE sched_public NOLOGIN;
COMMENT ON ROLE sched_public IS
  'Dono das funcoes de agendamento online. NOLOGIN. Le o minimo para calcular '
  'horario livre e cria paciente preliminar + agendamento.';

GRANT USAGE ON SCHEMA app, sched, clin TO sched_public;
GRANT SELECT ON app.clinic, app.professional, app.membership TO sched_public;
GRANT SELECT ON sched.procedure, sched.appointment, sched.block TO sched_public;
GRANT SELECT, INSERT ON clin.patient TO sched_public;
GRANT SELECT, INSERT ON sched.appointment TO sched_public;
GRANT SELECT ON id."user" TO sched_public;

CREATE POLICY publico ON app.clinic AS PERMISSIVE FOR SELECT TO sched_public
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY publico ON app.professional AS PERMISSIVE FOR SELECT TO sched_public
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY publico ON app.membership AS PERMISSIVE FOR SELECT TO sched_public
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY publico ON sched.procedure AS PERMISSIVE FOR SELECT TO sched_public
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY publico ON sched.block AS PERMISSIVE FOR SELECT TO sched_public
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY publico ON sched.appointment AS PERMISSIVE FOR ALL TO sched_public
  USING      (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY publico ON clin.patient AS PERMISSIVE FOR ALL TO sched_public
  USING      (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- ── horarios livres ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sched.horarios_livres(
  p_clinic_id    uuid,
  p_dia          date,
  p_procedure_id uuid,
  p_professional_id uuid DEFAULT NULL
) RETURNS TABLE (
  professional_id uuid,
  professional_nome text,
  inicio timestamptz,
  fim    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sched, app, clin
AS $fn$
DECLARE
  v_tenant uuid;
  v_tz     text;
  v_dur    int;
BEGIN
  SELECT c.tenant_id, c.timezone INTO v_tenant, v_tz
    FROM app.clinic c WHERE c.id = p_clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unidade nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  SELECT p.duracao_min INTO v_dur
    FROM sched.procedure p
   WHERE p.tenant_id = v_tenant AND p.id = p_procedure_id
     AND p.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'procedimento nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Janela fixa 08:00–18:00 no fuso da CLINICA. Agenda de trabalho configuravel
  -- por profissional e um passo seguinte; enquanto nao existe, o horario padrao
  -- e explicito aqui em vez de implicito em outro lugar.
  RETURN QUERY
  WITH prof AS (
    SELECT pr.id, u.full_name AS nome
      FROM app.professional pr
      JOIN id."user" u ON u.id = pr.user_id
      JOIN app.membership m
        ON m.tenant_id = pr.tenant_id AND m.user_id = pr.user_id
       AND m.clinic_id = p_clinic_id AND m.revoked_at IS NULL
     WHERE pr.tenant_id = v_tenant
       AND pr.inactivated_at IS NULL
       AND (p_professional_id IS NULL OR pr.id = p_professional_id)
  ), grade AS (
    SELECT pf.id, pf.nome,
           gs AS ini,
           gs + make_interval(mins => v_dur) AS fim
      FROM prof pf
      CROSS JOIN LATERAL generate_series(
        (p_dia::text || ' 08:00')::timestamp AT TIME ZONE v_tz,
        (p_dia::text || ' 18:00')::timestamp AT TIME ZONE v_tz
          - make_interval(mins => v_dur),
        make_interval(mins => v_dur)) AS gs
  )
  SELECT g.id, g.nome, g.ini, g.fim
    FROM grade g
   WHERE NOT EXISTS (
           SELECT 1 FROM sched.appointment a
            WHERE a.tenant_id = v_tenant
              AND a.professional_id = g.id
              AND a.status <> 'cancelado'
              AND (a.starts_at, a.ends_at) OVERLAPS (g.ini, g.fim))
     AND NOT EXISTS (
           SELECT 1 FROM sched.block b
            WHERE b.tenant_id = v_tenant
              AND (b.professional_id = g.id OR b.professional_id IS NULL)
              AND b.clinic_id = p_clinic_id
              AND (b.starts_at, b.ends_at) OVERLAPS (g.ini, g.fim))
     -- Passado nao e horario livre. Sem isto, quem abre a pagina de manha
     -- consegue marcar as 08h de ontem.
     AND g.ini > clock_timestamp()
   ORDER BY g.id, g.ini;
END $fn$;

ALTER FUNCTION sched.horarios_livres(uuid, date, uuid, uuid) OWNER TO sched_public;
REVOKE ALL ON FUNCTION sched.horarios_livres(uuid, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sched.horarios_livres(uuid, date, uuid, uuid) TO app_rw;

-- ── marcar ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sched.agendar_online(
  p_clinic_id       uuid,
  p_professional_id uuid,
  p_procedure_id    uuid,
  p_inicio          timestamptz,
  p_nome            text,
  p_telefone        text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sched, app, clin
AS $fn$
DECLARE
  v_tenant  uuid;
  v_tz      text;
  v_dur     int;
  v_paciente uuid := gen_random_uuid();
  v_agenda   uuid := gen_random_uuid();
  v_criador  uuid;
BEGIN
  IF btrim(coalesce(p_nome, '')) = '' OR btrim(coalesce(p_telefone, '')) = '' THEN
    RAISE EXCEPTION 'nome e telefone sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT c.tenant_id, c.timezone INTO v_tenant, v_tz
    FROM app.clinic c WHERE c.id = p_clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unidade nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  IF p_inicio <= clock_timestamp() THEN
    RAISE EXCEPTION 'horario no passado' USING ERRCODE = '22023';
  END IF;

  SELECT p.duracao_min INTO v_dur
    FROM sched.procedure p
   WHERE p.tenant_id = v_tenant AND p.id = p_procedure_id
     AND p.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'procedimento nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- `created_by` e NOT NULL e nao ha usuario logado: fica o proprio profissional
  -- que vai atender. E o mais honesto disponivel — a alternativa seria forjar um
  -- usuario de sistema e a trilha diria que alguem da clinica marcou.
  SELECT pr.user_id INTO v_criador
    FROM app.professional pr
   WHERE pr.tenant_id = v_tenant AND pr.id = p_professional_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profissional nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Cadastro PRELIMINAR: nome e telefone bastam para marcar. Exigir CPF e data
  -- de nascimento de quem esta marcando pelo celular faz a pessoa desistir ou
  -- inventar — e dado inventado depois vira paciente duplicado. O bloqueio de
  -- finalizacao por cadastro preliminar ja existe e cobra o resto na recepcao.
  INSERT INTO clin.patient (tenant_id, id, full_name, phone_primary, cadastro_status)
  VALUES (v_tenant, v_paciente, btrim(p_nome), btrim(p_telefone), 'preliminar');

  -- A constraint de sobreposicao decide quem ganhou a vaga. Duas pessoas
  -- clicando no mesmo horario e o caso NORMAL de agendamento online, e quem
  -- perder recebe 409 em vez de uma consulta fantasma.
  INSERT INTO sched.appointment
    (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
     starts_at, ends_at, appointment_date, status, primeira_vez, created_by)
  VALUES
    (v_tenant, v_agenda, v_paciente, p_professional_id, p_clinic_id, p_procedure_id,
     p_inicio, p_inicio + make_interval(mins => v_dur),
     app.local_date(p_inicio, v_tz), 'agendado', true, v_criador);

  RETURN v_agenda;
END $fn$;

ALTER FUNCTION sched.agendar_online(uuid, uuid, uuid, timestamptz, text, text)
  OWNER TO sched_public;
REVOKE ALL ON FUNCTION sched.agendar_online(uuid, uuid, uuid, timestamptz, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sched.agendar_online(uuid, uuid, uuid, timestamptz, text, text)
  TO app_rw;
