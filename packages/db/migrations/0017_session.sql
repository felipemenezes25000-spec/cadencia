-- 0017_session.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Sessao OPACA (§8 Fase 0). Token aleatorio de 32 bytes entregue ao navegador;
-- no banco fica so o sha256. Nunca JWT com claim de tenant: claim assinada nao
-- se revoga, e desligamento, revogacao de vinculo e break-glass exigem revogacao
-- com efeito imediato.
--
-- Fica no schema `id`, que e global e sem RLS: e por isso que a sessao pode ser
-- resolvida ANTES de existir contexto de tenant. Em `app` a resolucao dependeria
-- do tenant que ainda nao foi escolhido.
-- `app.uuidv7()` — o gerador que o DEFAULT abaixo usa.
--
-- O PostgreSQL 18 traz `uuidv7()` nativo; o 17 nao. Como o produto pode rodar
-- em Postgres gerenciado que ainda esta no 17, esta funcao delega para o nativo
-- quando ele existe e implementa a RFC 9562 quando nao existe. Nos dois casos o
-- componente temporal vem de `clock_timestamp()`, que e a fonte de tempo
-- persistido do sistema (§3) — o mesmo relogio que carimba `created_at`.
--
-- Continua sendo o BANCO quem gera, e nao o Node: `authn` nao pode importar o
-- gerador do kernel (irmaos em L0, §2.2) e duplicar o algoritmo em TypeScript
-- seria pior que delegar.
CREATE FUNCTION app.uuidv7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE
SET search_path = pg_catalog AS $fn$
DECLARE
  v_ms bigint;
  v_bytes bytea;
BEGIN
  -- Nativo quando disponivel: implementacao em C, testada pelo upstream.
  IF to_regprocedure('pg_catalog.uuidv7()') IS NOT NULL THEN
    RETURN pg_catalog.uuidv7();
  END IF;

  -- Layout da RFC 9562: 48 bits de milissegundos Unix, versao 7, variante 10xx,
  -- e o resto aleatorio. A ordenacao por tempo e o que mantem o indice btree
  -- append-friendly em tabela que so cresce.
  v_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_bytes := set_byte(set_byte(set_byte(set_byte(set_byte(set_byte(
               gen_random_bytes(16),
               0, ((v_ms >> 40) & 255)::int),
               1, ((v_ms >> 32) & 255)::int),
               2, ((v_ms >> 24) & 255)::int),
               3, ((v_ms >> 16) & 255)::int),
               4, ((v_ms >>  8) & 255)::int),
               5, ( v_ms        & 255)::int);
  -- Nibble alto do byte 6 = versao 7; dois bits altos do byte 8 = variante 10.
  v_bytes := set_byte(v_bytes, 6, ((get_byte(v_bytes, 6) & 15) | 112));
  v_bytes := set_byte(v_bytes, 8, ((get_byte(v_bytes, 8) & 63) | 128));
  RETURN encode(v_bytes, 'hex')::uuid;
END $fn$;
ALTER FUNCTION app.uuidv7() OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.uuidv7() TO app_rw, jobs;

CREATE TABLE id.session (
  id                  uuid PRIMARY KEY DEFAULT app.uuidv7(),
  user_id             uuid NOT NULL REFERENCES id."user"(id),
  token_hash          bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  -- Tenant ativo da sessao: e LINHA DE BANCO, revogavel, nao claim assinada.
  active_tenant_id    uuid REFERENCES app.tenant(id),
  active_clinic_id    uuid,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  last_seen_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  idle_expires_at     timestamptz(3) NOT NULL,
  absolute_expires_at timestamptz(3) NOT NULL,
  revoked_at          timestamptz(3),
  revoked_reason      text,
  mfa_at              timestamptz(3),
  ip                  inet,
  user_agent_hash     bytea
);
ALTER TABLE id.session OWNER TO app_owner;
COMMENT ON TABLE id.session IS 'global-reference';

CREATE INDEX ix_session_user_vivo ON id.session (user_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT ON id.session TO app_rw;
-- Sem UPDATE em user_id nem em token_hash: trocar qualquer um dos dois seria
-- transferir a sessao de uma pessoa para outra.
GRANT UPDATE (last_seen_at, idle_expires_at, revoked_at, revoked_reason,
              active_tenant_id, active_clinic_id, mfa_at) ON id.session TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON id.session TO jobs;
