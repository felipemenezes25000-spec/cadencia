-- 0054_audit_meta_signature_keys.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §7.2 — a trilha da assinatura digital. DOCUMENT_SIGN carimba o standard
-- (AD_RT/AD_RA) e o resultado da verificacao. SIGNATURE_PENDING carimba o motivo
-- da falha. Nenhuma das tres chaves estava na whitelist, e chave fora dela
-- derruba a linha inteira no CHECK meta_sem_pii.
--
-- As tres sao provadamente inocentes: `standard` e um rotulo de dois valores,
-- `verificacao` e um dos tres estados da verificacao, e `motivo` e o kind do
-- ProviderFailure — nenhum carrega dado clinico.

SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',       -- AD_RT ou AD_RA da assinatura (§7.2)
              'verificacao',    -- valida | invalida | indeterminada
              'motivo'          -- kind do ProviderFailure (§7)
            )
         );
$$;

RESET ROLE;
