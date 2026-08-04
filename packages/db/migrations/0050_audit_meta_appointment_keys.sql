-- 0050_audit_meta_appointment_keys.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.3 — a trilha do agendamento. APPOINTMENT_CREATE carimba se a linha nasceu
-- como encaixe, e APPOINTMENT_STATUS carimba para qual status ela foi. Nenhuma
-- das duas chaves estava na whitelist da 0009 (revisada pela 0044 e pela 0048),
-- e chave fora dela derruba a linha inteira no CHECK meta_sem_pii — que e
-- exatamente o desenho: chave nova exige migration revisada.
--
-- As duas sao provadamente inocentes: `encaixe` e um boolean, e `status` e um
-- rotulo de sched.appointment_status, enum fechado de sete valores
-- administrativos. Nao ha onde esconder dado clinico nelas.
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',      -- motivo de negacao, de quebra-vidro, de expurgo
              'route',       -- rota HTTP, sem query string
              'method',      -- verbo HTTP
              'status_code',
              'duration_ms',
              'use_case',    -- caso de uso de leitura (deduplicacao, §3.7)
              'record_count',
              'version_no',
              'kind',        -- original | retificacao | adendo | ...
              'role',
              'grant_id',    -- concessao de break-glass
              'horas',       -- prazo do quebra-vidro assistencial (§5.4)
              'geradas',     -- ocorrencias materializadas pela recorrencia (§5.3)
              'puladas',     -- ocorrencias que colidiram e foram puladas (§5.3)
              'freq',        -- diaria | semanal | quinzenal | mensal
              'encaixe',     -- overbooking deliberado do agendamento (§5.3)
              'status',      -- rotulo de sched.appointment_status (§5.3)
              'ticket',      -- chamado do suporte
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id'
            )
         );
$$;

RESET ROLE;
