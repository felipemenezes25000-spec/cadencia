-- 0049_waitlist.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — lista de espera como painel lateral fixo da Agenda, com arrastar para o
-- vao. A ordem dos candidatos e regra de NEGOCIO e mora aqui, nao na tela: duas
-- telas com criterios diferentes e como a recepcao perde a confianca na fila.

CREATE TYPE sched.waitlist_priority AS ENUM ('baixa','normal','alta','urgente');

CREATE TABLE sched.waitlist (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid,           -- NULL = qualquer profissional serve
  clinic_id       uuid NOT NULL,
  procedure_id    uuid,
  prioridade      sched.waitlist_priority NOT NULL DEFAULT 'normal',
  janela_de       date,
  janela_ate      date,
  observacao      text,
  -- Chamada: quando a vaga liberou e quem foi avisado.
  called_at       timestamptz(3),
  scheduled_appointment_id uuid,
  closed_at       timestamptz(3),
  close_reason    text,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id),
  FOREIGN KEY (tenant_id, scheduled_appointment_id)
    REFERENCES sched.appointment(tenant_id, id),
  CHECK (janela_de IS NULL OR janela_ate IS NULL OR janela_ate >= janela_de),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL)));
ALTER TABLE sched.waitlist OWNER TO app_owner;

-- coalesce no indice parcial: 'qualquer profissional' e UMA entrada, nao N.
CREATE UNIQUE INDEX ux_waitlist_ativa ON sched.waitlist
  (tenant_id, patient_id, coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE closed_at IS NULL;
CREATE INDEX ix_waitlist_fila ON sched.waitlist
  (tenant_id, clinic_id, prioridade DESC, created_at) WHERE closed_at IS NULL;

CREATE FUNCTION sched.waitlist_candidates(
  p_professional_id uuid, p_starts_at timestamptz, p_limit int DEFAULT 10)
RETURNS TABLE (
  waitlist_id uuid, patient_id uuid, prioridade sched.waitlist_priority,
  esperando_desde timestamptz(3), observacao text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
BEGIN
  RETURN QUERY
    -- A janela desejada e uma DATA, e data depende do fuso da UNIDADE onde a
    -- pessoa espera (§10 item 10). Por isso o fuso vem da clinica da PROPRIA
    -- linha, e nao de uma clinica escolhida a esmo dentro do tenant: rede
    -- SP + Manaus e caso real, e "escolher qualquer uma" deslocaria em um dia a
    -- janela de quem espera na outra ponta.
    SELECT w.id, w.patient_id, w.prioridade, w.created_at, w.observacao
      FROM sched.waitlist w
      JOIN app.clinic c ON c.tenant_id = w.tenant_id AND c.id = w.clinic_id
     WHERE w.tenant_id = v_tenant
       AND w.closed_at IS NULL
       AND (w.professional_id IS NULL OR w.professional_id = p_professional_id)
       AND (w.janela_de  IS NULL
            OR app.local_date(p_starts_at, c.timezone) >= w.janela_de)
       AND (w.janela_ate IS NULL
            OR app.local_date(p_starts_at, c.timezone) <= w.janela_ate)
     -- Prioridade primeiro, tempo de espera depois: quem esta ha mais tempo
     -- na mesma prioridade e chamado antes.
     ORDER BY w.prioridade DESC, w.created_at
     LIMIT greatest(p_limit, 1);
END $fn$;
ALTER FUNCTION sched.waitlist_candidates(uuid, timestamptz, int) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION sched.waitlist_candidates(uuid, timestamptz, int) TO app_rw;

GRANT SELECT, INSERT, UPDATE ON sched.waitlist TO app_rw;
-- Sem DELETE: sair da fila e closed_at + close_reason. Quem entrou e nao foi
-- chamado e a evidencia de que a agenda esta apertada — apagar isso apaga a
-- unica medida que a clinica tem da propria demanda reprimida.

ALTER TABLE sched.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.waitlist FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.waitlist AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
