-- 0047_sched_block.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — bloqueios e ausencias. Bloqueio NAO e agendamento: ele nao tem paciente,
-- e por isso vive em tabela propria. A tela desenha bloqueio listrado em
-- --papel-200 (§6.4), nunca com a cor de um status de atendimento.
--
-- Bloqueio nao impede o INSERT de um agendamento: quem decide encaixar sobre o
-- almoco e a recepcao, com a pessoa na frente. O que existe e sched.is_blocked,
-- que a tela consulta para AVISAR — a diferenca entre software que ajuda e
-- software que atrapalha.

CREATE TYPE sched.block_kind AS ENUM
  ('almoco','ausencia','feriado','bloqueio','manutencao');

CREATE TABLE sched.block (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  professional_id uuid,           -- NULL = bloqueio da unidade inteira (feriado)
  clinic_id       uuid NOT NULL,
  room_id         uuid,
  starts_at       timestamptz(3) NOT NULL,
  ends_at         timestamptz(3) NOT NULL,
  kind            sched.block_kind NOT NULL,
  motivo          text NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  periodo         tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  CHECK (ends_at > starts_at));
ALTER TABLE sched.block OWNER TO app_owner;

-- Parcial de proposito: bloqueio da unidade inteira (professional_id NULL) nao
-- conflita com nada — dois feriados no mesmo periodo sao dado administrativo.
ALTER TABLE sched.block ADD CONSTRAINT ex_block_sem_sobreposicao
  EXCLUDE USING gist (tenant_id WITH =, professional_id WITH =, periodo WITH &&)
  WHERE (professional_id IS NOT NULL);

CREATE INDEX ix_block_periodo ON sched.block USING gist (tenant_id, clinic_id, periodo);

CREATE FUNCTION sched.is_blocked(
  p_professional_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sched.block b
     WHERE b.tenant_id = app.current_tenant_id()
       AND (b.professional_id = p_professional_id OR b.professional_id IS NULL)
       AND b.periodo && tstzrange(p_starts_at, p_ends_at, '[)'))
$$;
ALTER FUNCTION sched.is_blocked(uuid, timestamptz, timestamptz) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION sched.is_blocked(uuid, timestamptz, timestamptz) TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON sched.block TO app_rw;
-- DELETE aqui e legitimo: desmarcar o congresso apaga o bloqueio.

ALTER TABLE sched.block ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.block FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.block AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
