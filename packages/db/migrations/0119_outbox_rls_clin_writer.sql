-- 0119_outbox_rls_clin_writer.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Corrige bug introduzido em 0118: clin_writer recebeu INSERT em app.outbox
-- mas nao havia RLS policy para esse papel. O trigger de outbox na finalizacao
-- falhava com "new row violates row-level security policy for table outbox".

CREATE POLICY clin_writer_insert ON app.outbox
  AS PERMISSIVE
  FOR INSERT
  TO clin_writer
  WITH CHECK (tenant_id = app.require_tenant_id());
