-- 0044_break_glass.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.4 — quebra-vidro assistencial. Nao e excecao a policy: e uma linha em
-- clin.record_share, que a policy RESTRICTIVE ja consulta. O acesso e concedido
-- com JUSTIFICATIVA obrigatoria, PRAZO e evento de auditoria — e por ser uma
-- linha comum, ele expira sozinho, sem job.

-- expires_at nao existia na Fase 0: record_share era concessao manual sem prazo.
ALTER TABLE clin.record_share ADD COLUMN expires_at timestamptz(3);
ALTER TABLE clin.record_share ADD COLUMN break_glass boolean NOT NULL DEFAULT false;
-- Quebra-vidro SEMPRE tem prazo. Concessao manual pode nao ter.
ALTER TABLE clin.record_share ADD CONSTRAINT quebra_vidro_tem_prazo
  CHECK (NOT break_glass OR expires_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- As policies da Fase 0 consultavam apenas revoked_at. Prazo vencido tem de
-- fechar o acesso sem ninguem revogar nada — e tem de fecha-lo em TODA tabela
-- que consulta o compartilhamento, nao so no atendimento. Fechar duas das sete
-- deixaria o quebra-vidro expirar na linha do tempo e continuar valendo para
-- sempre no diagnostico, que e o mesmo prontuario por outra porta.
--
-- clin.encounter_draft e clin.ai_assistance nao aparecem aqui de proposito: a
-- policy delas nunca consultou record_share (compartilhamento nao abre rascunho
-- alheio). clin.encounter_field_value tambem nao: ela delega a
-- clin.version_is_readable(), que le clin.encounter_version sob a RLS do
-- chamador — corrigir a versao corrige a filha.
-- ---------------------------------------------------------------------------

DROP POLICY clinical_scope ON clin.patient_identifier;
CREATE POLICY clinical_scope ON clin.patient_identifier
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.patient_identifier.tenant_id,
                               clin.patient_identifier.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

DROP POLICY clinical_scope ON clin.encounter;
CREATE POLICY clinical_scope ON clin.encounter AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.encounter.tenant_id, clin.encounter.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

DROP POLICY clinical_scope ON clin.encounter_version;
CREATE POLICY clinical_scope ON clin.encounter_version AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR author_professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      JOIN clin.record_share s
                        ON (s.tenant_id, s.patient_id) = (e.tenant_id, e.patient_id)
                     WHERE (e.tenant_id, e.id)
                           = (clin.encounter_version.tenant_id,
                              clin.encounter_version.encounter_id)
                       AND s.grantee_professional_id = app.current_professional_id()
                       AND s.revoked_at IS NULL
                       AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

-- As quatro tabelas de primeira classe nasceram com a policy gerada em laco
-- (migration 0035). A correcao vai pelo mesmo laco: escrever as quatro a mao
-- seria quatro chances de divergir.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnosis','observation','encounter_finding','procedure']
  LOOP
    EXECUTE format('DROP POLICY clinical_scope ON clin.%I', t);
    EXECUTE format($p$
      CREATE POLICY clinical_scope ON clin.%I AS RESTRICTIVE FOR SELECT TO app_rw
        USING ( app.clinical_scope_all()
                OR professional_id = app.current_professional_id()
                OR EXISTS (SELECT 1 FROM clin.record_share s
                            WHERE (s.tenant_id, s.patient_id) = (clin.%I.tenant_id, clin.%I.patient_id)
                              AND s.grantee_professional_id = app.current_professional_id()
                              AND s.revoked_at IS NULL
                              AND (s.expires_at IS NULL
                                   OR s.expires_at > clock_timestamp())) )$p$, t, t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- A trilha registra o PRAZO, nunca a justificativa. `horas` nao estava na
-- whitelist da migration 0009, e chave fora dela derruba a linha inteira no
-- CHECK meta_sem_pii — que e exatamente o desenho: chave nova exige migration
-- revisada. `horas` e um inteiro de 1 a 72 amarrado pelo CHECK da funcao
-- abaixo; nao ha como esconder dado clinico nele.
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',      -- motivo de negacao, de quebra-vidro, de expurgo
              'route',       -- rota HTTP, sem query string
              'method',      -- verbo HTTP
              'status_code',
              'duration_ms',
              'use_case',    -- caso de uso de leitura (deduplicacao, §3.7)
              'record_count',
              'version_no',
              'kind',        -- original | retificacao | adendo | ...
              'role',
              'grant_id',    -- concessao de break-glass
              'horas',       -- prazo do quebra-vidro assistencial (§5.4)
              'ticket',      -- chamado do suporte
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id'
            )
         );
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- O dono da funcao e clin_writer, o papel das funcoes SECURITY DEFINER do
-- nucleo clinico (migration 0001), e NAO app_owner. Com FORCE ROW LEVEL
-- SECURITY o proprio dono da tabela e filtrado pelas policies, e as de
-- clin.record_share sao todas `TO app_rw`: uma funcao definida por app_owner
-- cairia na negacao por padrao e nenhum quebra-vidro seria gravado.
--
-- clin_writer recebe o MINIMO: INSERT, e sob uma policy propria amarrada ao
-- tenant da transacao, no mesmo desenho da policy `writer` da migration 0030.
-- Sem SELECT: a funcao gera o id em vez de le-lo de volta com RETURNING.
-- ---------------------------------------------------------------------------
GRANT INSERT ON clin.record_share TO clin_writer;
CREATE POLICY writer ON clin.record_share AS PERMISSIVE FOR INSERT TO clin_writer
  WITH CHECK (tenant_id = app.require_tenant_id());

CREATE FUNCTION clin.break_glass(
  p_patient_id uuid, p_justificativa text, p_horas int DEFAULT 4)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = clin, app, audit, pg_catalog AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_prof   uuid := app.current_professional_id();
  v_id     uuid := gen_random_uuid();
BEGIN
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'quebra-vidro e ato assistencial: exige profissional'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_justificativa, ''))) < 20 THEN
    RAISE EXCEPTION 'justificativa de quebra-vidro precisa de ao menos 20 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF p_horas < 1 OR p_horas > 72 THEN
    RAISE EXCEPTION 'prazo do quebra-vidro fica entre 1 e 72 horas' USING ERRCODE = '22023';
  END IF;

  INSERT INTO clin.record_share (
      tenant_id, id, patient_id, grantee_professional_id, granted_by_professional_id,
      reason, expires_at, break_glass)
  VALUES (v_tenant, v_id, p_patient_id, v_prof, v_prof,
      p_justificativa, clock_timestamp() + make_interval(hours => p_horas), true);

  -- A justificativa NAO vai para o meta: a trilha nao carrega texto livre que
  -- pode conter dado clinico (NGS1.07.06). Ela fica em clin.record_share.reason,
  -- que e do dominio e tem RLS.
  PERFORM audit.log('RECORD_BREAK_GLASS', 'clin', 'record_share', v_id, 'sucesso',
                    jsonb_build_object('horas', p_horas), NULL);
  RETURN v_id;
END $fn$;

ALTER FUNCTION clin.break_glass(uuid, text, int) OWNER TO clin_writer;
REVOKE ALL ON FUNCTION clin.break_glass(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.break_glass(uuid, text, int) TO app_rw;

-- O indice que o EXISTS das policies percorre ja existe desde a migration 0008
-- (ix_record_share_vigente, mesmas colunas, mesmo WHERE revoked_at IS NULL).
-- expires_at nao entra nele: e filtro residual sobre pouquissimas linhas por
-- (paciente, profissional), e coloca-lo na chave so aumentaria a arvore.
