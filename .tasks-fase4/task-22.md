### Task 22: migration 0117 — coluna status na guia, trigger de outbox na finalizacao e chaves de auditoria

**Arquivos**

- Criar `packages/db/migrations/0117_tiss_guia_status_outbox_audit_keys.sql`
- Teste: `pnpm db:migrate` + `pnpm test:iso` + `pnpm db:invariants`

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0117_tiss_guia_status_outbox_audit_keys.sql`:

```sql
-- 0117_tiss_guia_status_outbox_audit_keys.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Tres responsabilidades:
-- 1. Coluna status em tiss.encounter_guia_consulta para distinguir guia completa
--    de incompleta (dados obrigatorios ausentes na projecao).
-- 2. Trigger em clin.encounter_version que enfileira ENCOUNTER_FINALIZED no outbox
--    — desacopla tiss de emr: nenhum import entre irmaos L2.
-- 3. Chaves de auditoria para o modulo tiss (guia, lote).

-- ---------------------------------------------------------------------------
-- 1. Coluna status na guia
-- ---------------------------------------------------------------------------
ALTER TABLE tiss.encounter_guia_consulta
  ADD COLUMN status text NOT NULL DEFAULT 'completa'
  CHECK (status IN ('completa', 'incompleta'));

COMMENT ON COLUMN tiss.encounter_guia_consulta.status IS
  'completa = todos os dados obrigatorios presentes; incompleta = projecao parcial, pendente de complemento';

-- Indice para o painel "a faturar" filtrar por guias incompletas
CREATE INDEX ix_guia_incompleta
  ON tiss.encounter_guia_consulta (tenant_id, data_atendimento DESC)
  WHERE live AND status = 'incompleta';

-- ---------------------------------------------------------------------------
-- 2. Trigger de outbox na finalizacao
-- ---------------------------------------------------------------------------
-- A funcao roda como clin_writer (mesmo papel de finalize_encounter).
-- clin_writer ja tem GRANT de INSERT em app.outbox via app.enqueue_outbox
-- (migration 0069 concedeu EXECUTE para clin_writer).
CREATE FUNCTION clin.trg_encounter_version_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = clin, app, pg_catalog AS $$
DECLARE
  v_patient_id uuid;
  v_professional_id uuid;
BEGIN
  SELECT e.patient_id, e.professional_id
    INTO v_patient_id, v_professional_id
    FROM clin.encounter e
   WHERE e.id = NEW.encounter_id;

  PERFORM app.enqueue_outbox(
    'ENCOUNTER_FINALIZED',
    NEW.encounter_id,
    jsonb_build_object(
      'encounterId', NEW.encounter_id,
      'patientId', v_patient_id,
      'professionalId', v_professional_id,
      'versionNo', NEW.version_no
    )
  );
  RETURN NEW;
END $$;

ALTER FUNCTION clin.trg_encounter_version_outbox() OWNER TO clin_writer;

CREATE TRIGGER trg_encounter_version_outbox
  AFTER INSERT ON clin.encounter_version
  FOR EACH ROW
  EXECUTE FUNCTION clin.trg_encounter_version_outbox();

-- ---------------------------------------------------------------------------
-- 3. Chaves de auditoria para tiss
-- ---------------------------------------------------------------------------
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
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id',
              'professional_id',
              'percentage',
              'priority',
              'period_start',
              'period_end',
              'total_entries',
              'total_professional_share',
              'product_name',
              'quantity',
              'movement_kind',
              'reference_type',
              'threshold',
              'current_stock',
              'sku',
              'numero_guia',
              'operadora_nome',
              'registro_ans',
              'guia_status',
              'guia_count',
              'numero_lote'
            )
         );
$$;

RESET ROLE;
```

- [ ] **Passo 2 — aplicar a migration**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Esperado: termina em `0117_tiss_guia_status_outbox_audit_keys.sql` sem erro.

- [ ] **Passo 3 — rodar invariantes e isolamento**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:invariants
pnpm test:iso
```

Esperado: PASSA. A coluna status e o trigger nao violam nenhum invariante. O trigger dispara em encounter_version (schema clin, que ja tem RLS).

- [ ] **Passo 4 — atualizar privileges.json**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:privileges
```

Esperado: `privileges.json` atualizado. Verificar que `tiss.encounter_guia_consulta` agora mostra as colunas novas e que a funcao trigger aparece.

- [ ] **Passo 5 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/db/migrations/0117_tiss_guia_status_outbox_audit_keys.sql packages/db/privileges.json
git commit -m "feat(db): add guia status column, encounter outbox trigger and tiss audit keys"
```

---