### Task 21: tipos e contrato de resultado para `projectGuiaConsulta`

**Arquivos**

- Criar `packages/tiss/src/project-guia.ts`
- Teste `packages/tiss/src/project-guia.test.ts`

- [ ] **Passo 1 — escrever o teste de unidade dos tipos**

```bash
# nenhum arquivo existe ainda; o teste a seguir valida que a assinatura compila
```

Criar `packages/tiss/src/project-guia.test.ts`:

```ts
// packages/tiss/src/project-guia.test.ts
import { describe, expect, it } from 'vitest';
import type { ProjectionResult, ProjectionError } from './project-guia';
import { ok, err, isOk, isErr, type Result } from '@cadencia/kernel';

describe('tipos de projectGuiaConsulta', () => {
  it('Result.ok com projecao completa carrega guiaId e status completa', () => {
    const r: Result<ProjectionResult, ProjectionError> = ok({
      kind: 'projected',
      guiaId: '00000000-0000-0000-0000-000000000001',
      numeroGuia: '1',
      status: 'completa',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe('projected');
      expect(r.value.status).toBe('completa');
    }
  });

  it('Result.ok com skip quando atendimento e particular', () => {
    const r: Result<ProjectionResult, ProjectionError> = ok({
      kind: 'skipped',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe('skipped');
    }
  });

  it('Result.err com lista de campos ausentes quando dados obrigatorios faltam', () => {
    const r: Result<ProjectionResult, ProjectionError> = err({
      kind: 'dados_obrigatorios_ausentes',
      guiaId: '00000000-0000-0000-0000-000000000002',
      missingFields: ['numero_carteira', 'cnes'],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe('dados_obrigatorios_ausentes');
      expect(r.error.missingFields).toContain('numero_carteira');
    }
  });

  it('Result.err com tuss_nao_vigente quando procedimento nao existe na TUSS', () => {
    const r: Result<ProjectionResult, ProjectionError> = err({
      kind: 'tuss_nao_vigente',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      dataAtendimento: '2026-08-01',
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe('tuss_nao_vigente');
    }
  });
});
```

- [ ] **Passo 2 — rodar e confirmar a falha (modulo nao existe)**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test packages/tiss/src/project-guia.test.ts
```

Esperado: FALHA com erro de importacao — `./project-guia` exporta apenas `{}`.

- [ ] **Passo 3 — implementar os tipos**

Criar `packages/tiss/src/project-guia.ts`:

```ts
// packages/tiss/src/project-guia.ts
import type { Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Resultado de sucesso
// ---------------------------------------------------------------------------

/** Guia projetada com sucesso (completa ou incompleta). */
export interface ProjectedResult {
  readonly kind: 'projected';
  readonly guiaId: string;
  readonly numeroGuia: string;
  readonly status: 'completa' | 'incompleta';
}

/** Atendimento particular — nenhuma guia projetada. */
export interface SkippedResult {
  readonly kind: 'skipped';
}

export type ProjectionResult = ProjectedResult | SkippedResult;

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Dados obrigatorios da guia ausentes. A guia FOI criada com status incompleta. */
export interface DadosAusentesError {
  readonly kind: 'dados_obrigatorios_ausentes';
  readonly guiaId: string;
  readonly missingFields: readonly string[];
}

/** Procedimento nao existe na TUSS vigente na data do atendimento. */
export interface TussNaoVigenteError {
  readonly kind: 'tuss_nao_vigente';
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly dataAtendimento: string;
}

export type ProjectionError = DadosAusentesError | TussNaoVigenteError;

// ---------------------------------------------------------------------------
// Assinatura — implementacao nas proximas tarefas
// ---------------------------------------------------------------------------

export declare function projectGuiaConsulta(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ProjectionResult, ProjectionError>>;
```

- [ ] **Passo 4 — rodar e confirmar que o teste de tipos passa**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test packages/tiss/src/project-guia.test.ts
```

Esperado: PASSA (4 testes).

- [ ] **Passo 5 — atualizar o barrel export**

Editar `packages/tiss/src/index.ts`:

```ts
// packages/tiss/src/index.ts
export type {
  ProjectionResult, ProjectedResult, SkippedResult,
  ProjectionError, DadosAusentesError, TussNaoVigenteError,
} from './project-guia';
export { projectGuiaConsulta } from './project-guia';
```

- [ ] **Passo 6 — typecheck**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck
```

Esperado: PASSA.

- [ ] **Passo 7 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/project-guia.ts packages/tiss/src/project-guia.test.ts packages/tiss/src/index.ts
git commit -m "feat(tiss): add type contract for projectGuiaConsulta"
```

---

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

### Task 23: seed de teste para projecao TISS — `packages/tiss/src/test-support.ts`

**Arquivos**

- Modificar `packages/tiss/src/test-support.ts` (criado pelo Bloco 01, Task 7)

- [ ] **Passo 1 — estender a funcao de semeadura**

A semeadura cria todo o grafo necessario para testar a projecao: tenant, clinica, usuario, vinculo, profissional, paciente, atendimento em rascunho com encounter_billing, operadora, contrato, paciente_convenio, e termo TUSS de amostra. Roda com a conexao administrativa.

Acrescentar em `packages/tiss/src/test-support.ts` (substituindo o `semearTiss` basico do Bloco 01 pela versao expandida):

```ts
// packages/tiss/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface TissSemente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  pacienteConvenioId: string;
  sectionId: string;
  fieldQueixaId: string;
}

/** Semente para testes de projecao de guia: SEM convenio (particular). */
export interface TissSementeParticular {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  sectionId: string;
  fieldQueixaId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`',
    );
  }
  return url;
}

/**
 * Semeia o grafo completo para projecao de guia TISS.
 * Inclui: tenant, clinica, usuario, profissional, paciente (cadastro completo),
 * atendimento em rascunho, encounter_billing COM convenio, operadora, contrato,
 * paciente_convenio e termo TUSS vigente.
 */
export async function semearProjecaoTiss(): Promise<TissSemente> {
  const s: TissSemente = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    pacienteConvenioId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- Infraestrutura base (mesmo padrao do emr test-support) ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica TISS Teste', '11ABC22233DE44')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade TISS', '11ABC22233DE44', '2233445', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. Convenio')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '654321', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Joao da Silva', 'completo', '1980-05-20')`,
      [s.tenantId, s.patientId],
    );

    // --- Prontuario: secao e campo minimos ---
    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    // --- Atendimento em rascunho ---
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // --- Encounter billing COM convenio ---
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans, numero_carteira,
          atendimento_rn, cnes, codigo_prestador_na_operadora,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Unimed Rio', '326305', '1234567890123456',
               false, '2233445', 'PREST001',
               '06', '654321', 'RJ', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 15000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    // --- Operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, active)
       VALUES ($1, $2, '326305', '28123456000199', 'Unimed Rio', true)`,
      [s.tenantId, s.operadoraId],
    );

    // --- Contrato (vinculo operadora x prestador) ---
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio)
       VALUES ($1, $2, $3, $4, 'PREST001', '2025-01-01')`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId],
    );

    // --- Paciente convenio (vinculo paciente x operadora) ---
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, validade)
       VALUES ($1, $2, $3, $4, '1234567890123456', '2027-12-31')`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId],
    );

    // --- Termo TUSS vigente para o procedimento de amostra ---
    // Usa INSERT ... ON CONFLICT DO NOTHING: o termo pode ja existir de outra semeadura.
    await c.query(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       VALUES (22, '10101012', 'Consulta em consultorio', '[2020-01-01,)', '202001', 'inclusao')
       ON CONFLICT DO NOTHING`,
    );

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

/**
 * Semeia um atendimento PARTICULAR (sem convenio).
 * O encounter_billing tem registro_ans e numero_carteira NULL.
 */
export async function semearProjecaoParticular(): Promise<TissSementeParticular> {
  const s: TissSementeParticular = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Particular', '55ABC66677DE88')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade Part', '55ABC66677DE88', '7766554', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. Particular')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111222', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Ana Costa', 'completo', '1992-11-03')`,
      [s.tenantId, s.patientId],
    );

    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Billing PARTICULAR: registro_ans e numero_carteira sao NULL, codigo_tabela NAO e 18.
    // O CHECK (registro_ans IS NULL) = (numero_carteira IS NULL) permite ambos NULL.
    // Precisa de ao menos um dos tres: codigo_prestador, cpf_contratado, cnpj_contratado.
    // Como e particular SEM convenio, usamos cpf_contratado.
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id,
          cnes, cpf_contratado,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               '7766554', '12345678901',
               '06', '111222', 'SP', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 20000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

- [ ] **Passo 2 — verificar compilacao**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck
```

Esperado: PASSA. A funcao de semeadura usa apenas tipos do `pg` e `@cadencia/kernel` (L0 importando L0 — permitido).

- [ ] **Passo 3 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/test-support.ts
git commit -m "feat(tiss): add test seed for guia projection integration tests"
```

---

### Task 24: TDD — `projectGuiaConsulta` retorna skip quando atendimento e particular

**Arquivos**

- Teste `packages/tiss/src/project-guia.int.test.ts`
- Modificar `packages/tiss/src/project-guia.ts`

- [ ] **Passo 1 — escrever o teste que falha**

Criar `packages/tiss/src/project-guia.int.test.ts`:

```ts
// packages/tiss/src/project-guia.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { isOk, uuidv7 } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';
import {
  semearProjecaoParticular,
  type TissSementeParticular,
} from './test-support';

let sp: TissSementeParticular;
let actorParticular: Actor;

beforeAll(async () => {
  sp = await semearProjecaoParticular();
  actorParticular = {
    kind: 'user',
    tenantId: sp.tenantId,
    userId: sp.userId,
    clinicId: sp.clinicId,
    requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('projectGuiaConsulta — atendimento particular', () => {
  it('retorna ok com kind skipped quando encounter_billing nao tem registro_ans', async () => {
    // Primeiro, finalizar o atendimento para obter o versionId
    const versionResult = await withTenantTx(actorParticular, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'original',
            p_payload => $2::jsonb,
            p_content_hash => decode($3, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => NULL,
            p_justificativa => NULL,
            p_incompleto => false)`,
        [
          sp.encounterId,
          JSON.stringify({
            fields: [{
              field_id: sp.fieldQueixaId, code: 'queixa', label: 'Queixa principal',
              field_generation: 1, section_instance: 1, ordinal: 0,
              value_text: 'dor de cabeca ha 2 dias',
            }],
            diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
          }),
          'aa'.repeat(32),
        ],
      );
      return rows[0]!;
    });

    // Agora, projetar a guia
    const result = await withTenantTx(actorParticular, async (tx) => {
      return projectGuiaConsulta(tx, sp.encounterId, versionResult.version_id);
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.kind).toBe('skipped');
    }
  });
});
```

- [ ] **Passo 2 — rodar e confirmar a falha**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Esperado: FALHA — `projectGuiaConsulta` e `declare function`, nao tem implementacao.

- [ ] **Passo 3 — implementar o caso particular em `project-guia.ts`**

Editar `packages/tiss/src/project-guia.ts` — substituir a declaracao pela implementacao:

```ts
// packages/tiss/src/project-guia.ts
import { ok, err, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Resultado de sucesso
// ---------------------------------------------------------------------------

export interface ProjectedResult {
  readonly kind: 'projected';
  readonly guiaId: string;
  readonly numeroGuia: string;
  readonly status: 'completa' | 'incompleta';
}

export interface SkippedResult {
  readonly kind: 'skipped';
}

export type ProjectionResult = ProjectedResult | SkippedResult;

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export interface DadosAusentesError {
  readonly kind: 'dados_obrigatorios_ausentes';
  readonly guiaId: string;
  readonly missingFields: readonly string[];
}

export interface TussNaoVigenteError {
  readonly kind: 'tuss_nao_vigente';
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly dataAtendimento: string;
}

export type ProjectionError = DadosAusentesError | TussNaoVigenteError;

// ---------------------------------------------------------------------------
// Leitura de encounter_billing
// ---------------------------------------------------------------------------

interface BillingRow {
  tenant_id: string;
  encounter_id: string;
  operadora_nome: string | null;
  registro_ans: string | null;
  numero_carteira: string | null;
  atendimento_rn: boolean;
  cnes: string;
  cnpj_contratado: string | null;
  cpf_contratado: string | null;
  codigo_prestador_na_operadora: string | null;
  conselho_profissional: string;
  numero_conselho: string;
  uf_conselho: string;
  cbos: string;
  indicacao_acidente: string;
  regime_atendimento: string;
  tipo_consulta: string;
  saude_ocupacional: string | null;
  data_atendimento: string;
  codigo_tabela: string;
  codigo_procedimento: string;
  valor_centavos: string;
  observacao: string | null;
}

async function readBilling(tx: TxClient, encounterId: string): Promise<BillingRow | undefined> {
  const { rows } = await tx.query<BillingRow>(
    `SELECT tenant_id, encounter_id, operadora_nome, registro_ans, numero_carteira,
            atendimento_rn, cnes, cnpj_contratado, cpf_contratado,
            codigo_prestador_na_operadora, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento, tipo_consulta,
            saude_ocupacional, data_atendimento::text AS data_atendimento,
            codigo_tabela, codigo_procedimento, valor_centavos::text AS valor_centavos,
            observacao
       FROM clin.encounter_billing
      WHERE encounter_id = $1`,
    [encounterId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Projeta a guia de consulta TISS a partir do atendimento finalizado.
 *
 * - Atendimento particular (sem registro_ans): retorna ok({ kind: 'skipped' }).
 * - Dados obrigatorios ausentes: insere guia com status 'incompleta' e retorna
 *   err com lista de campos faltando.
 * - Procedimento nao vigente na TUSS: retorna err sem inserir guia.
 * - Tudo ok: insere guia com status 'completa' e retorna ok.
 */
export async function projectGuiaConsulta(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ProjectionResult, ProjectionError>> {
  // 1. Le encounter_billing
  const billing = await readBilling(tx, encounterId);
  if (billing === undefined) {
    // Sem billing: nada a projetar (nao deveria acontecer, mas e seguro)
    return ok({ kind: 'skipped' });
  }

  // 2. Particular: registro_ans NULL → skip
  if (billing.registro_ans === null) {
    return ok({ kind: 'skipped' });
  }

  // 3. Busca operadora pelo registro_ans
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora
      WHERE registro_ans = $1
      LIMIT 1`,
    [billing.registro_ans],
  );
  const operadora = opRows[0];
  if (operadora === undefined) {
    // Operadora nao cadastrada — guia incompleta
    return insertIncompleteGuia(tx, billing, encounterVersionId, encounterId, ['operadora_nao_cadastrada']);
  }

  // 4. Busca paciente_convenio
  const { rows: pcRows } = await tx.query<{ numero_carteira: string }>(
    `SELECT numero_carteira FROM tiss.paciente_convenio
      WHERE encounter_id IS NOT NULL OR TRUE
        AND operadora_id = $1
        AND numero_carteira = $2
      LIMIT 1`,
    [operadora.id, billing.numero_carteira],
  );

  // 5. Busca contrato
  const { rows: ctRows } = await tx.query<{
    codigo_prestador_na_operadora: string | null;
  }>(
    `SELECT codigo_prestador_na_operadora FROM tiss.contrato
      WHERE operadora_id = $1
      LIMIT 1`,
    [operadora.id],
  );

  // 6. Valida TUSS vigente na data do atendimento
  const { rows: tussRows } = await tx.query<{ codigo: string }>(
    `SELECT codigo FROM ref.tuss_at($1::smallint, $2, $3::date)`,
    [billing.codigo_tabela, billing.codigo_procedimento, billing.data_atendimento],
  );
  if (tussRows.length === 0) {
    return err({
      kind: 'tuss_nao_vigente',
      codigoTabela: billing.codigo_tabela,
      codigoProcedimento: billing.codigo_procedimento,
      dataAtendimento: billing.data_atendimento,
    });
  }

  // 7. Verifica campos obrigatorios
  const missingFields: string[] = [];
  if (!billing.numero_carteira) missingFields.push('numero_carteira');
  if (!billing.cnes) missingFields.push('cnes');
  if (!billing.conselho_profissional) missingFields.push('conselho_profissional');
  if (!billing.numero_conselho) missingFields.push('numero_conselho');
  if (!billing.uf_conselho) missingFields.push('uf_conselho');
  if (!billing.cbos) missingFields.push('cbos');
  if (
    !billing.codigo_prestador_na_operadora &&
    !billing.cpf_contratado &&
    !billing.cnpj_contratado
  ) {
    missingFields.push('identificacao_prestador');
  }

  if (missingFields.length > 0) {
    return insertIncompleteGuia(tx, billing, encounterVersionId, encounterId, missingFields);
  }

  // 8. Gera numero da guia
  const { rows: guiaNumRows } = await tx.query<{ next_guia_number: string }>(
    `SELECT tiss.next_guia_number($1)`,
    [billing.tenant_id],
  );
  const numeroGuia = String(guiaNumRows[0]!.next_guia_number);

  // 9. Insere a guia completa
  const guiaId = await insertGuia(tx, billing, encounterVersionId, operadora.id, numeroGuia, 'completa');

  return ok({
    kind: 'projected',
    guiaId,
    numeroGuia,
    status: 'completa',
  });
}

// ---------------------------------------------------------------------------
// Helpers de insercao
// ---------------------------------------------------------------------------

async function insertGuia(
  tx: TxClient,
  billing: BillingRow,
  encounterVersionId: string,
  operadoraId: string,
  numeroGuia: string,
  status: 'completa' | 'incompleta',
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO tiss.encounter_guia_consulta (
        tenant_id, id, encounter_id, encounter_version_id,
        operadora_id, registro_ans, numero_guia_prestador, numero_carteira,
        atendimento_rn, codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado,
        cnes, conselho_profissional, numero_conselho, uf_conselho, cbos,
        indicacao_acidente, regime_atendimento, saude_ocupacional,
        data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
        valor_procedimento, observacao, status, created_by)
     VALUES (
        $1, gen_random_uuid(), $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19,
        $20::date, $21, $22, $23,
        $24, $25, $26, app.current_user_id())
     RETURNING id::text AS id`,
    [
      billing.tenant_id, billing.encounter_id, encounterVersionId,
      operadoraId, billing.registro_ans, numeroGuia, billing.numero_carteira,
      billing.atendimento_rn, billing.codigo_prestador_na_operadora,
      billing.cpf_contratado, billing.cnpj_contratado,
      billing.cnes, billing.conselho_profissional, billing.numero_conselho,
      billing.uf_conselho, billing.cbos,
      billing.indicacao_acidente, billing.regime_atendimento, billing.saude_ocupacional,
      billing.data_atendimento, billing.tipo_consulta, billing.codigo_tabela,
      billing.codigo_procedimento,
      (Number(billing.valor_centavos) / 100).toFixed(2),
      billing.observacao, status,
    ],
  );
  return rows[0]!.id;
}

async function insertIncompleteGuia(
  tx: TxClient,
  billing: BillingRow,
  encounterVersionId: string,
  encounterId: string,
  missingFields: string[],
): Promise<Result<ProjectionResult, ProjectionError>> {
  // Busca operadora para o INSERT. Se nao existir, usa placeholder.
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora WHERE registro_ans = $1 LIMIT 1`,
    [billing.registro_ans],
  );
  const operadoraId = opRows[0]?.id;

  if (operadoraId === undefined) {
    // Sem operadora cadastrada nao da para inserir guia (FK obrigatoria)
    return err({
      kind: 'dados_obrigatorios_ausentes',
      guiaId: '',
      missingFields,
    });
  }

  // Gera numero da guia mesmo para incompleta
  const { rows: guiaNumRows } = await tx.query<{ next_guia_number: string }>(
    `SELECT tiss.next_guia_number($1)`,
    [billing.tenant_id],
  );
  const numeroGuia = String(guiaNumRows[0]!.next_guia_number);

  const guiaId = await insertGuia(tx, billing, encounterVersionId, operadoraId, numeroGuia, 'incompleta');

  return err({
    kind: 'dados_obrigatorios_ausentes',
    guiaId,
    missingFields,
  });
}
```

- [ ] **Passo 4 — rodar e confirmar que o teste passa**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Esperado: PASSA (1 teste — atendimento particular retorna skipped).

- [ ] **Passo 5 — atualizar o barrel export**

Editar `packages/tiss/src/index.ts`:

```ts
// packages/tiss/src/index.ts
export type {
  ProjectionResult, ProjectedResult, SkippedResult,
  ProjectionError, DadosAusentesError, TussNaoVigenteError,
} from './project-guia';
export { projectGuiaConsulta } from './project-guia';
```

- [ ] **Passo 6 — typecheck**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck
```

Esperado: PASSA.

- [ ] **Passo 7 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/project-guia.ts packages/tiss/src/project-guia.int.test.ts packages/tiss/src/index.ts
git commit -m "feat(tiss): implement projectGuiaConsulta skip for particular encounters"
```

---

### Task 25: TDD — `projectGuiaConsulta` projeta guia completa para atendimento com convenio

**Arquivos**

- Modificar `packages/tiss/src/project-guia.int.test.ts`

- [ ] **Passo 1 — escrever o teste que falha**

Acrescentar ao arquivo `packages/tiss/src/project-guia.int.test.ts`:

```ts
// Acrescentar APOS os imports existentes e ANTES do describe existente:
import { isErr } from '@cadencia/kernel';
import {
  semearProjecaoTiss,
  type TissSemente,
} from './test-support';

let st: TissSemente;
let actorConvenio: Actor;

// Acrescentar dentro do beforeAll existente, APOS as linhas do sp:
// (Na pratica, criar um segundo beforeAll ou expandir o existente)

// --- Bloco a acrescentar no arquivo ---
// Adicionar apos o primeiro describe:

describe('projectGuiaConsulta — atendimento com convenio', () => {
  let versionId: string;

  beforeAll(async () => {
    st = await semearProjecaoTiss();
    actorConvenio = {
      kind: 'user',
      tenantId: st.tenantId,
      userId: st.userId,
      clinicId: st.clinicId,
      requestId: uuidv7(),
    };

    // Finalizar o atendimento
    const r = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'original',
            p_payload => $2::jsonb,
            p_content_hash => decode($3, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => NULL,
            p_justificativa => NULL,
            p_incompleto => false)`,
        [
          st.encounterId,
          JSON.stringify({
            fields: [{
              field_id: st.fieldQueixaId, code: 'queixa', label: 'Queixa principal',
              field_generation: 1, section_instance: 1, ordinal: 0,
              value_text: 'dor lombar ha 5 dias',
            }],
            diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
          }),
          'bb'.repeat(32),
        ],
      );
      return rows[0]!;
    });
    versionId = r.version_id;
  });

  it('insere guia completa em tiss.encounter_guia_consulta', async () => {
    const result = await withTenantTx(actorConvenio, async (tx) => {
      return projectGuiaConsulta(tx, st.encounterId, versionId);
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.kind).toBe('projected');
    if (result.value.kind !== 'projected') return;
    expect(result.value.status).toBe('completa');
    expect(result.value.guiaId).toBeTruthy();
    expect(result.value.numeroGuia).toBeTruthy();
  });

  it('a guia persistida tem os dados corretos do encounter_billing', async () => {
    // Projetar a guia (pode ja existir do teste anterior, usar tx separada)
    let guiaId: string | undefined;
    const result = await withTenantTx(actorConvenio, async (tx) => {
      // Verificar se ja existe guia para este encounter
      const { rows: existing } = await tx.query<{ id: string }>(
        `SELECT id::text AS id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      if (existing[0]) {
        guiaId = existing[0].id;
        return;
      }
      const r = await projectGuiaConsulta(tx, st.encounterId, versionId);
      if (isOk(r) && r.value.kind === 'projected') {
        guiaId = r.value.guiaId;
      }
    });

    expect(guiaId).toBeTruthy();

    // Ler a guia e verificar os campos
    const guia = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{
        registro_ans: string;
        numero_carteira: string;
        cnes: string;
        conselho_profissional: string;
        numero_conselho: string;
        uf_conselho: string;
        cbos: string;
        codigo_tabela: string;
        codigo_procedimento: string;
        tipo_consulta: string;
        status: string;
        live: boolean;
        codigo_prestador_na_operadora: string | null;
      }>(
        `SELECT registro_ans, numero_carteira, cnes, conselho_profissional,
                numero_conselho, uf_conselho, cbos, codigo_tabela,
                codigo_procedimento, tipo_consulta, status, live,
                codigo_prestador_na_operadora
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      return rows[0];
    });

    expect(guia).toBeDefined();
    expect(guia!.registro_ans).toBe('326305');
    expect(guia!.numero_carteira).toBe('1234567890123456');
    expect(guia!.cnes).toBe('2233445');
    expect(guia!.conselho_profissional).toBe('06');
    expect(guia!.numero_conselho).toBe('654321');
    expect(guia!.uf_conselho).toBe('RJ');
    expect(guia!.cbos).toBe('225125');
    expect(guia!.codigo_tabela).toBe('22');
    expect(guia!.codigo_procedimento).toBe('10101012');
    expect(guia!.tipo_consulta).toBe('1');
    expect(guia!.status).toBe('completa');
    expect(guia!.live).toBe(true);
    expect(guia!.codigo_prestador_na_operadora).toBe('PREST001');
  });

  it('o numero_guia_prestador e unico por tenant e auto-incrementado', async () => {
    const guia = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{ numero_guia_prestador: string }>(
        `SELECT numero_guia_prestador FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      return rows[0];
    });

    expect(guia).toBeDefined();
    // O numero deve ser um inteiro positivo (como string)
    const num = parseInt(guia!.numero_guia_prestador, 10);
    expect(num).toBeGreaterThan(0);
  });
});
```

NOTA: o arquivo completo `project-guia.int.test.ts` combina os dois describe blocks. Reescrever o arquivo completo com os imports corretos:

```ts
// packages/tiss/src/project-guia.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { isOk, isErr, uuidv7 } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';
import {
  semearProjecaoParticular,
  semearProjecaoTiss,
  type TissSemente,
  type TissSementeParticular,
} from './test-support';

let sp: TissSementeParticular;
let actorParticular: Actor;
let st: TissSemente;
let actorConvenio: Actor;

beforeAll(async () => {
  sp = await semearProjecaoParticular();
  actorParticular = {
    kind: 'user', tenantId: sp.tenantId, userId: sp.userId,
    clinicId: sp.clinicId, requestId: uuidv7(),
  };
  st = await semearProjecaoTiss();
  actorConvenio = {
    kind: 'user', tenantId: st.tenantId, userId: st.userId,
    clinicId: st.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

// --- Helper: finalizar atendimento ---
async function finalizarEncounter(
  actor: Actor, encounterId: string, fieldQueixaId: string, texto: string, hashByte: string,
): Promise<{ versionId: string; versionNo: number }> {
  return withTenantTx(actor, async (tx) => {
    const { rows } = await tx.query<{ version_id: string; version_no: number }>(
      `SELECT * FROM clin.finalize_encounter(
          p_encounter_id => $1,
          p_kind => 'original',
          p_payload => $2::jsonb,
          p_content_hash => decode($3, 'hex'),
          p_serializer_version => 'jcs-1',
          p_supersedes_version_id => NULL,
          p_justificativa => NULL,
          p_incompleto => false)`,
      [
        encounterId,
        JSON.stringify({
          fields: [{
            field_id: fieldQueixaId, code: 'queixa', label: 'Queixa principal',
            field_generation: 1, section_instance: 1, ordinal: 0,
            value_text: texto,
          }],
          diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
        }),
        hashByte.repeat(32),
      ],
    );
    return rows[0]!;
  });
}

describe('projectGuiaConsulta — atendimento particular', () => {
  it('retorna ok com kind skipped quando encounter_billing nao tem registro_ans', async () => {
    const { versionId } = await finalizarEncounter(
      actorParticular, sp.encounterId, sp.fieldQueixaId, 'dor de cabeca ha 2 dias', 'aa',
    );
    const result = await withTenantTx(actorParticular, async (tx) => {
      return projectGuiaConsulta(tx, sp.encounterId, versionId);
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.kind).toBe('skipped');
    }
  });
});

describe('projectGuiaConsulta — atendimento com convenio', () => {
  let versionId: string;

  beforeAll(async () => {
    const r = await finalizarEncounter(
      actorConvenio, st.encounterId, st.fieldQueixaId, 'dor lombar ha 5 dias', 'bb',
    );
    versionId = r.versionId;
  });

  it('insere guia completa em tiss.encounter_guia_consulta', async () => {
    const result = await withTenantTx(actorConvenio, async (tx) => {
      return projectGuiaConsulta(tx, st.encounterId, versionId);
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.kind).toBe('projected');
    if (result.value.kind !== 'projected') return;
    expect(result.value.status).toBe('completa');
    expect(result.value.guiaId).toBeTruthy();
    expect(result.value.numeroGuia).toBeTruthy();
  });

  it('a guia persistida tem os dados corretos do encounter_billing', async () => {
    const guia = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{
        registro_ans: string; numero_carteira: string; cnes: string;
        conselho_profissional: string; numero_conselho: string; uf_conselho: string;
        cbos: string; codigo_tabela: string; codigo_procedimento: string;
        tipo_consulta: string; status: string; live: boolean;
        codigo_prestador_na_operadora: string | null;
      }>(
        `SELECT registro_ans, numero_carteira, cnes, conselho_profissional,
                numero_conselho, uf_conselho, cbos, codigo_tabela,
                codigo_procedimento, tipo_consulta, status, live,
                codigo_prestador_na_operadora
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      return rows[0];
    });

    expect(guia).toBeDefined();
    expect(guia!.registro_ans).toBe('326305');
    expect(guia!.numero_carteira).toBe('1234567890123456');
    expect(guia!.cnes).toBe('2233445');
    expect(guia!.conselho_profissional).toBe('06');
    expect(guia!.numero_conselho).toBe('654321');
    expect(guia!.uf_conselho).toBe('RJ');
    expect(guia!.cbos).toBe('225125');
    expect(guia!.codigo_tabela).toBe('22');
    expect(guia!.codigo_procedimento).toBe('10101012');
    expect(guia!.tipo_consulta).toBe('1');
    expect(guia!.status).toBe('completa');
    expect(guia!.live).toBe(true);
    expect(guia!.codigo_prestador_na_operadora).toBe('PREST001');
  });

  it('o numero_guia_prestador e unico por tenant e auto-incrementado', async () => {
    const guia = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{ numero_guia_prestador: string }>(
        `SELECT numero_guia_prestador FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();
    const num = parseInt(guia!.numero_guia_prestador, 10);
    expect(num).toBeGreaterThan(0);
  });
});
```

- [ ] **Passo 2 — rodar e confirmar que todos os testes passam**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Esperado: PASSA (4 testes — 1 particular, 3 convenio).

- [ ] **Passo 3 — confirmar que o trigger de outbox emitiu o evento**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Acrescentar um teste ao describe do convenio (dentro do mesmo arquivo):

```ts
  it('a finalizacao emitiu ENCOUNTER_FINALIZED no outbox', async () => {
    const evento = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{ event_type: string; payload: Record<string, unknown> }>(
        `SELECT event_type, payload FROM app.outbox
          WHERE aggregate_id = $1 AND event_type = 'ENCOUNTER_FINALIZED'
          ORDER BY created_at DESC LIMIT 1`,
        [st.encounterId],
      );
      return rows[0];
    });
    expect(evento).toBeDefined();
    expect(evento!.event_type).toBe('ENCOUNTER_FINALIZED');
    expect(evento!.payload).toHaveProperty('encounterId', st.encounterId);
    expect(evento!.payload).toHaveProperty('patientId', st.patientId);
  });
```

- [ ] **Passo 4 — rodar novamente**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Esperado: PASSA (5 testes).

- [ ] **Passo 5 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/project-guia.int.test.ts
git commit -m "test(tiss): add integration tests for guia projection happy path"
```

---

### Task 26: TDD — `projectGuiaConsulta` com dados incompletos retorna guia incompleta

**Arquivos**

- Modificar `packages/tiss/src/project-guia.int.test.ts`
- Modificar `packages/tiss/src/test-support.ts`

- [ ] **Passo 1 — acrescentar semente para dados incompletos**

Acrescentar em `packages/tiss/src/test-support.ts`:

```ts
/** Semente com convenio mas SEM numero_carteira no billing — dados incompletos. */
export interface TissSementeIncompleta {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  sectionId: string;
  fieldQueixaId: string;
}

/**
 * Semeia atendimento com convenio mas com dados obrigatorios FALTANDO.
 * O encounter_billing tem registro_ans preenchido mas numero_carteira NULL
 * (invalido para guia completa). A operadora e contrato existem.
 */
export async function semearProjecaoIncompleta(): Promise<TissSementeIncompleta> {
  const s: TissSementeIncompleta = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Incompleta', '99ABC88877DE66')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade Inc', '99ABC88877DE66', '9988776', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. Incompleto')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'MG', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Pedro Santos', 'completo', '1975-02-28')`,
      [s.tenantId, s.patientId],
    );

    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Billing COM convenio mas com dados que levarao a guia incompleta:
    // numero_carteira PRESENTE (exigido pelo CHECK), mas
    // codigo_prestador_na_operadora, cpf_contratado e cnpj_contratado:
    // usamos cpf_contratado para satisfazer o CHECK, mas o campo que o
    // teste vai verificar como faltando e a OPERADORA NAO CADASTRADA
    // (registro_ans '000000' nao tem operadora correspondente no tiss).
    // Na verdade, para testar dados incompletos no billing, precisamos
    // que a operadora EXISTA mas algum campo obrigatorio do billing esteja
    // ausente. O CHECK do billing impede carteira NULL com ans preenchido.
    // Estrategia: todos os campos do billing preenchidos, mas a operadora
    // NAO esta cadastrada em tiss.operadora — isso gera 'operadora_nao_cadastrada'.
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans, numero_carteira,
          atendimento_rn, cnes, codigo_prestador_na_operadora,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Operadora Fantasma', '999999', '9999888877776666',
               false, '9988776', 'PREST999',
               '06', '999888', 'MG', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 12000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    // Operadora com registro_ans '999999' NAO cadastrada em tiss.operadora
    // (de proposito, para testar o fluxo de dados incompletos)

    // Termo TUSS para o procedimento (global, pode ja existir)
    await c.query(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       VALUES (22, '10101012', 'Consulta em consultorio', '[2020-01-01,)', '202001', 'inclusao')
       ON CONFLICT DO NOTHING`,
    );

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

- [ ] **Passo 2 — escrever o teste**

Acrescentar ao `packages/tiss/src/project-guia.int.test.ts`:

```ts
// Adicionar import no topo:
import {
  semearProjecaoIncompleta,
  type TissSementeIncompleta,
} from './test-support';

// Adicionar variaveis globais:
let si: TissSementeIncompleta;
let actorIncompleto: Actor;

// No beforeAll, acrescentar:
  si = await semearProjecaoIncompleta();
  actorIncompleto = {
    kind: 'user', tenantId: si.tenantId, userId: si.userId,
    clinicId: si.clinicId, requestId: uuidv7(),
  };

// Novo describe:
describe('projectGuiaConsulta — dados incompletos', () => {
  let versionId: string;

  beforeAll(async () => {
    const r = await finalizarEncounter(
      actorIncompleto, si.encounterId, si.fieldQueixaId, 'tosse persistente', 'cc',
    );
    versionId = r.versionId;
  });

  it('retorna err com lista de campos ausentes quando operadora nao cadastrada', async () => {
    const result = await withTenantTx(actorIncompleto, async (tx) => {
      return projectGuiaConsulta(tx, si.encounterId, versionId);
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe('dados_obrigatorios_ausentes');
    if (result.error.kind !== 'dados_obrigatorios_ausentes') return;
    expect(result.error.missingFields).toContain('operadora_nao_cadastrada');
  });

  it('a finalizacao NAO falha mesmo com projecao incompleta — o atendimento esta selado', async () => {
    const enc = await withTenantTx(actorIncompleto, async (tx) => {
      const { rows } = await tx.query<{ status: string; version_count: number }>(
        `SELECT status::text AS status, version_count FROM clin.encounter WHERE id = $1`,
        [si.encounterId],
      );
      return rows[0];
    });
    expect(enc).toBeDefined();
    expect(enc!.status).toBe('finalizado');
    expect(enc!.version_count).toBe(1);
  });
});
```

- [ ] **Passo 3 — rodar e confirmar que os testes passam**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Esperado: PASSA (7 testes — 1 particular, 4 convenio, 2 incompleto).

- [ ] **Passo 4 — typecheck**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck
```

Esperado: PASSA.

- [ ] **Passo 5 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/project-guia.int.test.ts packages/tiss/src/test-support.ts
git commit -m "test(tiss): add integration tests for incomplete guia projection"
```

---

### Task 27: TDD — validacao TUSS com `ref.tuss_at` e teste de procedimento nao vigente

**Arquivos**

- Modificar `packages/tiss/src/project-guia.int.test.ts`
- Modificar `packages/tiss/src/test-support.ts`

- [ ] **Passo 1 — acrescentar semente com procedimento nao vigente**

Acrescentar em `packages/tiss/src/test-support.ts`:

```ts
/** Semente com convenio mas procedimento TUSS nao vigente na data do atendimento. */
export interface TissSementeTussInvalido {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  pacienteConvenioId: string;
  sectionId: string;
  fieldQueixaId: string;
}

/**
 * Semeia atendimento com convenio completo mas procedimento TUSS
 * que NAO esta vigente na data do atendimento.
 * O codigo '99999999' nao existe em ref.tuss_term.
 */
export async function semearProjecaoTussInvalido(): Promise<TissSementeTussInvalido> {
  const s: TissSementeTussInvalido = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    pacienteConvenioId: uuidv7(),
    sectionId: uuidv7(),
    fieldQueixaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica TUSS Inv', '77ABC44455DE66')`,
      [s.tenantId, `t-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade TUSS Inv', '77ABC44455DE66', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. TussInv')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Carlos Lima', 'completo', '1970-09-15')`,
      [s.tenantId, s.patientId],
    );

    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'consulta', 'Consulta', 1)`,
      [s.tenantId, s.sectionId],
    );
    await c.query(
      `INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldQueixaId, s.sectionId],
    );

    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'), 'rascunho'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Billing COM convenio valido, mas procedimento '99999999' que NAO existe na TUSS
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans, numero_carteira,
          atendimento_rn, cnes, codigo_prestador_na_operadora,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Unimed SP', '356247', '5566778899001122',
               false, '4455667', 'PREST007',
               '06', '777666', 'SP', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '99999999', 18000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    -- Operadora
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, active)
       VALUES ($1, $2, '356247', '33445566000177', 'Unimed SP', true)`,
      [s.tenantId, s.operadoraId],
    );

    -- Contrato
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio)
       VALUES ($1, $2, $3, $4, 'PREST007', '2025-01-01')`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId],
    );

    -- Paciente convenio
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, validade)
       VALUES ($1, $2, $3, $4, '5566778899001122', '2027-12-31')`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId],
    );

    // NAO inserimos o procedimento '99999999' em ref.tuss_term — esse e o ponto do teste.

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

NOTA: Corrigir os `--` para `//` (SQL dentro de template JS):

Os blocos acima com `--` devem usar `//` pois estao dentro de template literals TypeScript. Reescrevendo as linhas:

```ts
    // Operadora
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, active)
       VALUES ($1, $2, '356247', '33445566000177', 'Unimed SP', true)`,
      [s.tenantId, s.operadoraId],
    );

    // Contrato
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio)
       VALUES ($1, $2, $3, $4, 'PREST007', '2025-01-01')`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId],
    );

    // Paciente convenio
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, validade)
       VALUES ($1, $2, $3, $4, '5566778899001122', '2027-12-31')`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId],
    );
```

- [ ] **Passo 2 — escrever o teste**

Acrescentar ao `packages/tiss/src/project-guia.int.test.ts`:

```ts
// Adicionar import:
import {
  semearProjecaoTussInvalido,
  type TissSementeTussInvalido,
} from './test-support';

// Adicionar variaveis globais:
let sti: TissSementeTussInvalido;
let actorTussInv: Actor;

// No beforeAll, acrescentar:
  sti = await semearProjecaoTussInvalido();
  actorTussInv = {
    kind: 'user', tenantId: sti.tenantId, userId: sti.userId,
    clinicId: sti.clinicId, requestId: uuidv7(),
  };

// Novo describe:
describe('projectGuiaConsulta — procedimento TUSS nao vigente', () => {
  let versionId: string;

  beforeAll(async () => {
    const r = await finalizarEncounter(
      actorTussInv, sti.encounterId, sti.fieldQueixaId, 'febre ha 3 dias', 'dd',
    );
    versionId = r.versionId;
  });

  it('retorna err com kind tuss_nao_vigente quando procedimento nao existe na TUSS', async () => {
    const result = await withTenantTx(actorTussInv, async (tx) => {
      return projectGuiaConsulta(tx, sti.encounterId, versionId);
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe('tuss_nao_vigente');
    if (result.error.kind !== 'tuss_nao_vigente') return;
    expect(result.error.codigoProcedimento).toBe('99999999');
    expect(result.error.codigoTabela).toBe('22');
  });

  it('NAO insere guia quando procedimento nao e vigente', async () => {
    const guia = await withTenantTx(actorTussInv, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id::text AS id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1`,
        [sti.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeUndefined();
  });

  it('a data usada na validacao TUSS e occurred_date, NUNCA occurred_at::date', async () => {
    // Verifica que a funcao usa a data do billing (que e = occurred_date)
    const billing = await withTenantTx(actorTussInv, async (tx) => {
      const { rows } = await tx.query<{ data_atendimento: string }>(
        `SELECT data_atendimento::text AS data_atendimento
           FROM clin.encounter_billing WHERE encounter_id = $1`,
        [sti.encounterId],
      );
      return rows[0];
    });
    expect(billing).toBeDefined();
    // A data e a mesma que o encounter.occurred_date
    const encounter = await withTenantTx(actorTussInv, async (tx) => {
      const { rows } = await tx.query<{ occurred_date: string }>(
        `SELECT occurred_date::text AS occurred_date FROM clin.encounter WHERE id = $1`,
        [sti.encounterId],
      );
      return rows[0];
    });
    expect(billing!.data_atendimento).toBe(encounter!.occurred_date);
  });
});
```

- [ ] **Passo 3 — rodar e confirmar que todos passam**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int packages/tiss/src/project-guia.int.test.ts
```

Esperado: PASSA (10 testes — 1 particular, 4 convenio, 2 incompleto, 3 TUSS invalido).

- [ ] **Passo 4 — rodar a suite completa de integracao**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:int
```

Esperado: PASSA. Nenhum teste existente quebra.

- [ ] **Passo 5 — rodar o lint de terminologia-clock**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm lint:terminology-clock
```

Esperado: PASSA. Nenhum `now()` ou `current_date` nos arquivos TISS.

- [ ] **Passo 6 — typecheck e invariantes**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck
pnpm db:invariants
```

Esperado: PASSA.

- [ ] **Passo 7 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/project-guia.int.test.ts packages/tiss/src/test-support.ts
git commit -m "test(tiss): add TUSS validation tests and complete projection test suite"
```
