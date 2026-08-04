-- 0062_audit_meta_prescription_keys.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §7.1 — a confirmacao de prescricao (PRESCRIPTION_CONFIRM) loga `provedor`
-- (id do parceiro), `itens` (total de itens na prescricao) e
-- `assinatura_valida` (booleano: artefato verificado). Nenhum carrega dado clinico.

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
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',           -- id do parceiro de prescricao (§7.1)
              'itens',              -- total de itens na prescricao (§7.1)
              'assinatura_valida'   -- artefato assinado verificado (§7.1)
            )
         );
$$;

RESET ROLE;
