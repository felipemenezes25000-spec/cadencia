-- 0059_fix_record_export_expires.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Corrige a policy clinical_scope de clin.record_export: toda policy que consulta
-- record_share DEVE olhar expires_at (invariante do quebra-vidro, test 20).

DROP POLICY clinical_scope ON clin.record_export;
CREATE POLICY clinical_scope ON clin.record_export AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.record_export.tenant_id, clin.record_export.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );
