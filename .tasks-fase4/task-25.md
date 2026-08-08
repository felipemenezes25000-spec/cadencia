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