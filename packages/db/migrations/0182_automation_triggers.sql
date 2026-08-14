-- 0182_automation_triggers.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- Amplia o catalogo de gatilhos de msg.automation_rule de 4 para 9.
--
-- Os quatro originais cobrem o ciclo do agendamento e o NPS. O que falta sao
-- justamente os dois maiores vazamentos silenciosos de receita de uma clinica:
-- o paciente que parou de vir e a fatura que ninguem cobrou. Os dados dos dois
-- ja existem no banco (sched.appointment.status, fin.entry vencido,
-- clin.patient sem atendimento recente) — nada os lia.
--
--   appointment_no_show  falta registrada -> remarcar
--   patient_birthday     aniversario
--   patient_inactive     sem atendimento ha N dias -> reativacao
--   recall_due           retorno clinico previsto
--   payment_overdue      titulo vencido -> regua de cobranca
--
-- LGPD: aniversario e reativacao NAO se apoiam na "tutela da saude" do art. 7,
-- VIII — sao uso secundario com finalidade de marketing/relacionamento e
-- exigem consentimento proprio (app.lgpd_consent, migration 0181, proposito
-- 'marketing'). Quem dispara a regra e responsavel por checar. O banco nao
-- consegue impor isso aqui porque a checagem e por PACIENTE, e a regra e por
-- tenant; a barreira fica no worker, junto do envio.

BEGIN;

ALTER TABLE msg.automation_rule
  DROP CONSTRAINT IF EXISTS automation_rule_trigger_check;

ALTER TABLE msg.automation_rule
  ADD CONSTRAINT automation_rule_trigger_check
  CHECK (trigger IN (
    'appointment_created',
    'appointment_reminder',
    'encounter_finalized',
    'nps_due',
    'appointment_no_show',
    'patient_birthday',
    'patient_inactive',
    'recall_due',
    'payment_overdue'));

COMMENT ON COLUMN msg.automation_rule.trigger IS
  'Gatilho da regra. Ver 0182 para o catalogo e para a nota de base legal LGPD '
  'de patient_birthday e patient_inactive.';

COMMIT;
