-- 0176_document_reception_read.sql
-- A recepcao pode reimprimir documentos clinicos ja emitidos, mas continua sem
-- acesso a anexos. A autorizacao HTTP exige document.read; esta policy limita
-- a liberacao adicional aos documentos da propria unidade do vinculo.

DROP POLICY clinical_scope ON clin.document;

CREATE POLICY clinical_scope ON clin.document AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.has_role_in(clinic_id, ARRAY['recepcao'])
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.document.tenant_id, clin.document.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );
