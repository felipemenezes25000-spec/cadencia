-- 0046_appointment.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — a agenda. Inicio e fim sao instantes; appointment_date e a data no fuso
-- da CLINICA (nao do tenant: rede SP + Manaus e caso real).
--
-- ENCAIXE e overbooking DELIBERADO. A restricao de exclusao o deixa passar
-- explicitamente: sem isso a recepcao descobre que o software nao deixa encaixar
-- e volta para o caderno — e a agenda e a tela onde o produto e julgado.

CREATE TYPE sched.appointment_status AS ENUM
  ('agendado','confirmado','aguardando','atendendo','atendido','faltou','cancelado');

CREATE TABLE sched.appointment (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  room_id         uuid,
  procedure_id    uuid,
  operadora_nome  text,           -- convenio; NULL = particular
  starts_at       timestamptz(3) NOT NULL,
  ends_at         timestamptz(3) NOT NULL,
  appointment_date date NOT NULL, -- app.local_date(starts_at, clinic.timezone)
  status          sched.appointment_status NOT NULL DEFAULT 'agendado',
  encaixe         boolean NOT NULL DEFAULT false,
  teleconsulta    boolean NOT NULL DEFAULT false,
  primeira_vez    boolean NOT NULL DEFAULT false,
  observacao      text,
  -- Origem: recorrencia materializada aponta para a serie que a gerou.
  recurrence_id   uuid,
  confirmed_at    timestamptz(3),
  arrived_at      timestamptz(3),
  started_at      timestamptz(3),
  finished_at     timestamptz(3),
  cancelled_at    timestamptz(3),
  cancel_reason   text,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  periodo         tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, procedure_id)    REFERENCES sched.procedure(tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK ((cancelled_at IS NULL) = (status <> 'cancelado')));
ALTER TABLE sched.appointment OWNER TO app_owner;

-- btree_gist (extensao ja instalada na 0002) e o que permite misturar igualdade
-- de uuid com sobreposicao de intervalo na mesma restricao.
ALTER TABLE sched.appointment ADD CONSTRAINT ex_appointment_sem_sobreposicao
  EXCLUDE USING gist (
    tenant_id WITH =, professional_id WITH =, periodo WITH &&)
  WHERE (NOT encaixe AND status <> 'cancelado');

-- Sala compartilhada: dois profissionais nao ocupam a mesma sala no mesmo horario,
-- nem com encaixe — encaixe e overbooking de AGENDA, nao de espaco fisico.
ALTER TABLE sched.appointment ADD CONSTRAINT ex_appointment_sala
  EXCLUDE USING gist (tenant_id WITH =, room_id WITH =, periodo WITH &&)
  WHERE (room_id IS NOT NULL AND status <> 'cancelado');

-- §3.8: os contadores do dia sao CONSULTA VIVA sobre indice parcial, nunca matview.
-- Contador defasado e lido como "travou", que e a queixa que o produto resolve.
CREATE INDEX ix_appointment_dia
  ON sched.appointment (tenant_id, clinic_id, appointment_date, starts_at)
  INCLUDE (professional_id, patient_id, status, encaixe)
  WHERE status <> 'cancelado';
CREATE INDEX ix_appointment_profissional
  ON sched.appointment (tenant_id, professional_id, appointment_date, starts_at)
  WHERE status <> 'cancelado';
CREATE INDEX ix_appointment_paciente
  ON sched.appointment (tenant_id, patient_id, starts_at DESC);
CREATE INDEX ix_appointment_recorrencia
  ON sched.appointment (tenant_id, recurrence_id) WHERE recurrence_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON sched.appointment TO app_rw;
-- Sem DELETE: agendamento sai de circulacao por status = 'cancelado', e o
-- historico de faltas e cancelamentos e o insumo do Desempenho da Fase 3.

ALTER TABLE sched.appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sched.appointment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sched.appointment AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
-- A agenda NAO recebe policy RESTRICTIVE por profissional: a recepcao precisa
-- ver a agenda inteira da unidade para agendar. Agendamento e dado
-- administrativo — §10 item 18 separa Paciente de Prontuario exatamente aqui.
