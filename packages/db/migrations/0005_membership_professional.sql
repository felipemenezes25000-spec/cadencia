-- 0005_membership_professional.sql
-- Fase 0 · design §3.2, §3.3 e decisao irreversivel §10 itens 2 e 3.
-- Papel e profissional NAO vem do cliente: sao DERIVADOS do vinculo, no banco.

-- §10.2: identidade GLOBAL, sem tenant_id. O medico tem UM certificado ICP-Brasil,
-- logo UMA identidade. Os modulos authn/identity ESTENDEM esta tabela (credencial,
-- TOTP, dispositivo, autorizacao PSC) por migration de expansao, nunca a recriam.
CREATE TABLE id."user" (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  full_name text NOT NULL,
  disabled_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp());
ALTER TABLE id."user" OWNER TO app_owner;
COMMENT ON TABLE id."user" IS 'global-reference';

-- §10.3: papel resolvido POR VINCULO, por clinica, dentro do banco.
CREATE TABLE app.membership (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES id."user"(id),
  clinic_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN
    ('admin_clinico','diretor_tecnico','profissional','recepcao','financeiro')),
  granted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id));
ALTER TABLE app.membership OWNER TO app_owner;

CREATE UNIQUE INDEX ux_membership_vigente
  ON app.membership (tenant_id, user_id, clinic_id, role) WHERE revoked_at IS NULL;
CREATE INDEX ix_membership_lookup
  ON app.membership (tenant_id, user_id) WHERE revoked_at IS NULL;

-- conselho_profissional / numero_conselho / uf_conselho / cbos tem exatamente os
-- mesmos tipos dos campos homonimos da guia TISS (§3.9): a guia e projecao, nao
-- pode precisar converter nada. conselho_profissional guarda o CODIGO do conselho
-- na terminologia TISS (ex.: '06' = CRM), nunca a sigla por extenso.
CREATE TABLE app.professional (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES id."user"(id),
  conselho_profissional varchar(2) NOT NULL,
  numero_conselho varchar(15) NOT NULL,
  uf_conselho char(2) NOT NULL CHECK (uf_conselho ~ '^[A-Z]{2}$'),
  cbos varchar(6),
  inactivated_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  -- app.current_professional_id() devolve UMA linha: a unicidade e obrigatoria.
  UNIQUE (tenant_id, user_id));
ALTER TABLE app.professional OWNER TO app_owner;

CREATE INDEX ix_professional_user ON app.professional (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- Funcoes de derivacao. Moram aqui, e nao na 0002, porque leem app.membership
-- e app.professional — que so existem a partir desta migration.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.current_professional_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT p.id FROM app.professional p
   WHERE p.tenant_id = app.current_tenant_id() AND p.user_id = app.current_user_id() $$;

CREATE FUNCTION app.has_role_in(p_clinic uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.tenant_id = app.current_tenant_id()
                    AND m.user_id = app.current_user_id()
                    AND m.clinic_id = p_clinic AND m.role = ANY(p_roles)
                    AND m.revoked_at IS NULL) $$;

CREATE FUNCTION app.is_member() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id = app.current_user_id()
                    AND m.tenant_id = app.current_tenant_id() AND m.revoked_at IS NULL)
      OR app.current_user_id() IS NULL AND current_setting('app.actor_kind',true)='system' $$;

CREATE FUNCTION app.clinical_scope_all() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id=app.current_user_id() AND m.tenant_id=app.current_tenant_id()
                    AND m.role IN ('admin_clinico','diretor_tecnico') AND m.revoked_at IS NULL) $$;

ALTER FUNCTION app.current_professional_id()   OWNER TO app_owner;
ALTER FUNCTION app.has_role_in(uuid, text[])   OWNER TO app_owner;
ALTER FUNCTION app.is_member()                 OWNER TO app_owner;
ALTER FUNCTION app.clinical_scope_all()        OWNER TO app_owner;

GRANT EXECUTE ON FUNCTION
  app.current_professional_id(),
  app.has_role_in(uuid, text[]),
  app.is_member(),
  app.clinical_scope_all()
TO app_rw;
