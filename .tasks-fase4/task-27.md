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