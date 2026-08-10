-- Migration 0158: id_equipe role + SECURITY DEFINER functions for team management
-- Creates conceder_vinculo, revogar_vinculo, desativar_totp_admin
-- Updates equipe_da_unidade with tem_totp column

-- ── Role NOLOGIN ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'id_equipe') THEN
    CREATE ROLE id_equipe NOLOGIN;
  END IF;
END $$;

-- Portabilidade: em Postgres gerenciado, quem cria o papel nao ganha SET ROLE
-- automaticamente. No-op em cluster proprio com superusuario.
DO $portabilidade$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT id_equipe TO %I WITH SET TRUE', current_user);
  END IF;
END $portabilidade$;

-- CREATE transitorio: o PostgreSQL exige que o novo dono tenha CREATE no schema
-- para aceitar `ALTER FUNCTION ... OWNER TO id_equipe`. Revogado no fim.
GRANT CREATE ON SCHEMA app, id TO id_equipe;
GRANT USAGE  ON SCHEMA app, id, public TO id_equipe;

-- Grants minimos
GRANT SELECT, INSERT ON id."user"          TO id_equipe;
GRANT SELECT, INSERT ON id.user_credential TO id_equipe;
GRANT SELECT, INSERT, UPDATE ON app.membership   TO id_equipe;
GRANT SELECT, INSERT, UPDATE ON app.professional  TO id_equipe;
GRANT SELECT, DELETE ON id.user_totp TO id_equipe;
GRANT SELECT ON app.clinic   TO id_equipe;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO id_equipe;
GRANT EXECUTE ON FUNCTION app.current_user_id()   TO id_equipe;

-- RLS policies para id_equipe (NOLOGIN — seguro)
CREATE POLICY id_equipe_user ON id."user"
  FOR ALL TO id_equipe USING (true);

CREATE POLICY id_equipe_cred ON id.user_credential
  FOR ALL TO id_equipe USING (true);

CREATE POLICY id_equipe_membership ON app.membership
  FOR ALL TO id_equipe USING (true);

CREATE POLICY id_equipe_professional ON app.professional
  FOR ALL TO id_equipe USING (true);

CREATE POLICY id_equipe_totp ON id.user_totp
  FOR ALL TO id_equipe USING (true);

CREATE POLICY id_equipe_clinic ON app.clinic
  FOR ALL TO id_equipe USING (true);

-- ── conceder_vinculo ──────────────────────────────────────────────────────────

SET ROLE id_equipe;

CREATE FUNCTION app.conceder_vinculo(
  p_clinic_id    uuid,
  p_email        citext,
  p_nome         text,
  p_role         text,
  p_senha_hash   text,
  p_cpf          varchar(11) DEFAULT NULL,
  p_conselho     varchar(2)  DEFAULT NULL,
  p_num_conselho varchar(15) DEFAULT NULL,
  p_uf_conselho  char(2)     DEFAULT NULL,
  p_cbos         varchar(6)  DEFAULT NULL
)
RETURNS TABLE (r_user_id uuid, r_membership_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, id, pg_catalog
AS $$
DECLARE
  v_tenant_id  uuid := app.current_tenant_id();
  v_granted_by uuid := app.current_user_id();
  v_user_id    uuid;
  v_mem_id     uuid;
BEGIN
  -- Criar ou reutilizar usuario
  INSERT INTO id."user" (id, email, full_name, cpf, status)
  VALUES (gen_random_uuid(), p_email, p_nome, p_cpf, 'ativo')
  ON CONFLICT (email) DO NOTHING;

  SELECT u.id INTO v_user_id FROM id."user" u WHERE u.email = p_email;

  -- Criar credencial (nao sobrescreve existente)
  INSERT INTO id.user_credential (user_id, password_hash)
  VALUES (v_user_id, p_senha_hash)
  ON CONFLICT (user_id) DO NOTHING;

  -- Criar vinculo
  v_mem_id := gen_random_uuid();
  INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role, granted_by)
  VALUES (v_tenant_id, v_mem_id, v_user_id, p_clinic_id, p_role, v_granted_by);

  -- Profissional (se aplicavel)
  IF p_conselho IS NOT NULL THEN
    INSERT INTO app.professional (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
    VALUES (v_tenant_id, gen_random_uuid(), v_user_id, p_conselho, p_num_conselho, p_uf_conselho, p_cbos)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET conselho_profissional = EXCLUDED.conselho_profissional,
          numero_conselho       = EXCLUDED.numero_conselho,
          uf_conselho           = EXCLUDED.uf_conselho,
          cbos                  = EXCLUDED.cbos;
  END IF;

  r_user_id       := v_user_id;
  r_membership_id := v_mem_id;
  RETURN NEXT;
END;
$$;

RESET ROLE;

ALTER FUNCTION app.conceder_vinculo(uuid, citext, text, text, text, varchar, varchar, varchar, char, varchar)
  OWNER TO id_equipe;
REVOKE ALL ON FUNCTION app.conceder_vinculo(uuid, citext, text, text, text, varchar, varchar, varchar, char, varchar)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.conceder_vinculo(uuid, citext, text, text, text, varchar, varchar, varchar, char, varchar)
  TO app_rw;

-- ── revogar_vinculo ───────────────────────────────────────────────────────────

SET ROLE id_equipe;

CREATE FUNCTION app.revogar_vinculo(
  p_clinic_id uuid,
  p_user_id   uuid,
  p_role      text,
  p_motivo    text DEFAULT NULL
)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  WITH updated AS (
    UPDATE app.membership
       SET revoked_at     = clock_timestamp(),
           revoked_reason = p_motivo
     WHERE tenant_id  = app.current_tenant_id()
       AND clinic_id  = p_clinic_id
       AND user_id    = p_user_id
       AND role       = p_role
       AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM updated;
$$;

RESET ROLE;

ALTER FUNCTION app.revogar_vinculo(uuid, uuid, text, text)
  OWNER TO id_equipe;
REVOKE ALL ON FUNCTION app.revogar_vinculo(uuid, uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.revogar_vinculo(uuid, uuid, text, text)
  TO app_rw;

-- ── desativar_totp_admin ──────────────────────────────────────────────────────

SET ROLE id_equipe;

CREATE FUNCTION id.desativar_totp_admin(p_user_id uuid)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = id, pg_catalog
AS $$
  WITH deleted AS (
    DELETE FROM id.user_totp WHERE user_id = p_user_id RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

RESET ROLE;

ALTER FUNCTION id.desativar_totp_admin(uuid)
  OWNER TO id_equipe;
REVOKE ALL ON FUNCTION id.desativar_totp_admin(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION id.desativar_totp_admin(uuid)
  TO app_rw;

-- ── Atualizar equipe_da_unidade — adiciona tem_totp ───────────────────────────

-- id_login (owner da funcao) precisa ler user_totp
GRANT SELECT ON id.user_totp TO id_login;

CREATE POLICY id_login_totp ON id.user_totp
  FOR SELECT TO id_login USING (true);

DROP FUNCTION IF EXISTS app.equipe_da_unidade(uuid);

CREATE FUNCTION app.equipe_da_unidade(p_clinic_id uuid)
RETURNS TABLE (
  user_id     uuid,
  nome        text,
  email       citext,
  role        text,
  conselho    text,
  granted_at  timestamptz,
  tem_totp    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, id, pg_catalog
AS $$
  SELECT
    m.user_id,
    u.full_name                        AS nome,
    u.email,
    m.role,
    CASE WHEN p.numero_conselho IS NOT NULL
         THEN p.conselho_profissional || ' ' || p.numero_conselho || '/' || p.uf_conselho
         ELSE NULL
    END                                AS conselho,
    m.granted_at,
    EXISTS (
      SELECT 1 FROM id.user_totp t
       WHERE t.user_id = m.user_id
         AND t.confirmed_at IS NOT NULL
    )                                  AS tem_totp
  FROM app.membership m
  JOIN id."user" u ON u.id = m.user_id
  LEFT JOIN app.professional p
    ON p.tenant_id = m.tenant_id AND p.user_id = m.user_id
  WHERE m.clinic_id  = p_clinic_id
    AND m.tenant_id  = app.current_tenant_id()
    AND m.revoked_at IS NULL;
$$;

ALTER FUNCTION app.equipe_da_unidade(uuid) OWNER TO id_login;
REVOKE ALL    ON FUNCTION app.equipe_da_unidade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.equipe_da_unidade(uuid) TO app_rw;

-- ── Auditoria — chaves de metadados ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id',
              'professional_id',
              'percentage',
              'priority',
              'period_start',
              'period_end',
              'total_entries',
              'total_professional_share',
              'product_name',
              'quantity',
              'movement_kind',
              'reference_type',
              'threshold',
              'current_stock',
              'sku',
              'numero_guia',
              'operadora_nome',
              'registro_ans',
              'guia_status',
              'guia_count',
              'numero_lote',
              'item_count',
              'total_recursado_cents',
              'total_resultados',
              'deferidos',
              'valores_expurgados',
              'anexos_expurgados',
              'corte_retencao',
              'ocorrencias',
              'target_user_id',
              'membership_id'
            )
         );
$fn$;

-- ── Fechar porta transitoria ─────────────────────────────────────────────────
-- CREATE no schema era necessario para ALTER FUNCTION ... OWNER TO id_equipe.
-- Todas as transferencias de posse ja aconteceram; revogar evita que qualquer
-- funcao SECURITY DEFINER futura consiga criar objetos nesses schemas.
REVOKE CREATE ON SCHEMA app, id FROM id_equipe;
