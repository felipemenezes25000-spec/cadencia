-- 0186_msg_send_states.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Chamada externa de mensageria nao e atomica com PostgreSQL. `sending` fecha a
-- janela em que um crash apos o envio faria o job repetir e mandar duas vezes;
-- `indeterminate` representa timeout de operacao unsafe sem mentir "failed".

BEGIN;

ALTER TABLE msg.message
  DROP CONSTRAINT IF EXISTS message_status_check;

ALTER TABLE msg.message
  ADD CONSTRAINT message_status_check
  CHECK (status IN ('queued','sending','sent','delivered','read','failed','indeterminate'));

ALTER TABLE msg.message
  ADD COLUMN IF NOT EXISTS send_attempted_at timestamptz(3);

COMMIT;
