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