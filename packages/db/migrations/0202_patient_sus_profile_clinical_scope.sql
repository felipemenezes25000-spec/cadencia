-- 0202_patient_sus_profile_clinical_scope.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- 0200 criou clin.patient_sus_profile com tenant_isolation (PERMISSIVE) e parou
-- ai. Ficou a unica das treze tabelas de clin com patient_id sem policy
-- RESTRICTIVE, e o invariante 5 reprovava por isso.
--
-- A lacuna nao era formal. Sem o ramo RESTRICTIVE, o compartilhamento de
-- prontuario e contornavel trocando de tabela: o profissional sem record_share
-- para aquele cidadao nao le clin.encounter nem clin.diagnosis, mas lia daqui
-- vulnerabilidade, territorio, microarea e situacao de acamado — dado sensivel
-- que descreve a pessoa tanto quanto o proprio prontuario.
--
-- Os tres ramos sao os mesmos de clin.patient_identifier (0008), na mesma ordem
-- e pelo mesmo motivo:
--   1. papel de escopo total no tenant (admin_clinico / diretor_tecnico);
--   2. quem NAO e profissional — recepcao e o ator 'system' do worker;
--   3. profissional com compartilhamento VIGENTE para aquele cidadao — o ramo
--      checa revoked_at E expires_at, como a 0044 fixou para as demais: sem a
--      segunda condicao um compartilhamento expirado continuaria valendo.

BEGIN;

CREATE POLICY clinical_scope ON clin.patient_sus_profile
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.patient_sus_profile.tenant_id,
                               clin.patient_sus_profile.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

COMMIT;
