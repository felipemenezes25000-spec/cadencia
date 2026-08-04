-- 0045_sched_procedure.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — a agenda. O schema `sched` nasce aqui, com o mesmo dono e o mesmo
-- padrao de GRANT dos demais (migration 0002).

CREATE SCHEMA sched AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA sched TO app_rw, clin_writer, app_support;

CREATE TABLE sched.procedure (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  code          text NOT NULL,
  nome          text NOT NULL COLLATE "pt-BR-x-icu",
  -- Cor e DURACAO dirigem a renderizacao do slot: a linha da agenda usa a cor
  -- na barra de 3px da borda esquerda, e a altura do bloco vem da duracao.
  cor           char(7) NOT NULL CHECK (cor ~ '^#[0-9a-f]{6}$'),
  duracao_min   int NOT NULL CHECK (duracao_min > 0 AND duracao_min <= 480),
  valor_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  -- Vinculo com a TUSS para a Fase 4; opcional na Fase 1.
  tuss_tabela   smallint, tuss_codigo varchar(10),
  archived_at   timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  CHECK ((tuss_tabela IS NULL) = (tuss_codigo IS NULL)));
ALTER TABLE sched.procedure OWNER TO app_owner;

CREATE UNIQUE INDEX ux_procedure_viva
  ON sched.procedure (tenant_id, code) WHERE archived_at IS NULL;
CREATE INDEX ix_procedure_ordem
  ON sched.procedure (tenant_id, nome COLLATE "pt-BR-x-icu") WHERE archived_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON sched.procedure TO app_rw;

ALTER TABLE sched.procedure ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.procedure FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.procedure AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
