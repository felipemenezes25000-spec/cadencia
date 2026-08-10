### Task 19: tipos e createRecursoGlosa — cria recurso em rascunho com glosas iniciais

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/types.ts`
- Criar `packages/tiss/src/recurso-glosa/test-support.ts`
- Criar `packages/tiss/src/recurso-glosa/create-recurso.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/create-recurso.ts`

**Por que**: O ponto de entrada do fluxo de recurso de glosa e a criacao do recurso em rascunho, vinculando glosas selecionadas pelo usuario. Cada glosa precisa estar em status `pendente` e pertencer ao mesmo tenant. A funcao valida essas condicoes, insere o recurso e os itens de vinculo, e atualiza os contadores.

- [ ] Criar o diretorio e o arquivo de tipos `packages/tiss/src/recurso-glosa/types.ts`:

```ts
// packages/tiss/src/recurso-glosa/types.ts

/**
 * Tipos do dominio de recurso de glosa TISS.
 *
 * O recurso de glosa e a contestacao formal do prestador contra glosas
 * aplicadas pela operadora em um demonstrativo de retorno. O ciclo de vida e:
 * rascunho -> pronto -> enviado -> (deferido | indeferido | parcial)
 * Com desvio para 'indeterminado' em caso de timeout no envio (§7 design).
 */

export type RecursoStatus =
  | 'rascunho'
  | 'pronto'
  | 'enviado'
  | 'indeterminado'
  | 'deferido'
  | 'indeferido'
  | 'parcial';

export type GlosaItemResultado = 'deferido' | 'indeferido';

export interface CreateRecursoGlosaInput {
  readonly operadoraId: string;
  readonly createdBy: string;
  readonly itens: readonly CreateRecursoItemInput[];
}

export interface CreateRecursoItemInput {
  readonly glosaId: string;
  readonly justificativa: string;
  readonly valorRecursadoCents: number;
}

export type CreateRecursoFailure =
  | { kind: 'sem_itens' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'glosa_nao_encontrada'; glosaId: string }
  | { kind: 'glosa_nao_pendente'; glosaId: string; status: string }
  | { kind: 'glosa_operadora_divergente'; glosaId: string };

export interface CreatedRecurso {
  readonly recursoId: string;
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type AddGlosaFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'recurso_nao_rascunho'; status: string }
  | { kind: 'glosa_nao_encontrada' }
  | { kind: 'glosa_nao_pendente'; status: string }
  | { kind: 'glosa_operadora_divergente' }
  | { kind: 'glosa_ja_no_recurso' };

export interface AddedGlosaItem {
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type RemoveGlosaFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'recurso_nao_rascunho'; status: string }
  | { kind: 'vinculo_nao_encontrado' };

export interface RemovedGlosaItem {
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type MarkReadyFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'sem_itens' }
  | { kind: 'justificativa_geral_ausente' };

export interface RecursoReadyResult {
  readonly recursoId: string;
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type SubmitRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'transport_indisponivel'; detail: string }
  | { kind: 'transport_rejeitado'; detail: string }
  | { kind: 'transport_nao_suportado'; detail: string }
  | { kind: 'transport_indeterminado'; detail: string };

export interface RecursoSentResult {
  readonly recursoId: string;
  readonly protocoloOperadora?: string;
  readonly storageKey?: string;
}

export interface RecursoIndeterminadoResult {
  readonly recursoId: string;
  readonly detail: string;
}

export type ResolveRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'item_nao_encontrado'; glosaId: string };

export interface ResolveRecursoInput {
  readonly resultado: 'deferido' | 'indeferido' | 'parcial';
  readonly itensResolvidos: readonly ResolveItemInput[];
}

export interface ResolveItemInput {
  readonly glosaId: string;
  readonly resultado: GlosaItemResultado;
}

export interface RecursoResolvedResult {
  readonly recursoId: string;
  readonly resultado: string;
  readonly itensDeferidos: number;
  readonly itensIndeferidos: number;
}
```

- [ ] Criar o arquivo de suporte para testes `packages/tiss/src/recurso-glosa/test-support.ts`:

```ts
// packages/tiss/src/recurso-glosa/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeRecurso {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  loteId: string;
  demonstrativoId: string;
  glosaIds: [string, string, string];
  guiaIds: [string, string, string];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

/**
 * Semeia o grafo completo para testes de recurso de glosa:
 * - tenant, clinica, usuario, profissional, paciente
 * - operadora
 * - 3 encounters finalizados, cada um com encounter_version e guia
 * - 1 lote retornado contendo as 3 guias
 * - 1 demonstrativo de analise vinculado ao lote
 * - 3 demonstrativo_items com glosa (valor_glosa_cents > 0, glosa_codigo preenchido)
 *
 * Os 3 demonstrativo_items servem como "glosas pendentes" para vincular ao recurso.
 * O status dos itens no demonstrativo_item e implicitamente pendente: nenhum recurso
 * foi criado ainda.
 */
export async function semearRecursoGlosa(): Promise<SementeRecurso> {
  const s: SementeRecurso = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    demonstrativoId: uuidv7(),
    glosaIds: [uuidv7(), uuidv7(), uuidv7()],
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const profId = uuidv7();
  const patientId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clinica, usuario, membership, profissional, paciente ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Recurso Glosa', '33ABC44556DE77')`,
      [s.tenantId, `rg-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade RG', '33ABC44556DE77', '3344556', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin RG')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '334455', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente RG', 'completo', '1985-03-10')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora RG', '66XYZ00003DE03', '4.01.00', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- 3 encounters finalizados com guias ---
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      const valorProcedimento = (idx + 1) * 100; // 100, 200, 300 reais

      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id,
            occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-07-${dia}T14:00:00Z', DATE '2026-07-${dia}',
                 'finalizado'::clin.encounter_status)`,
        [s.tenantId, encId, patientId, profId, s.clinicId],
      );
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, profId, `rg-${idx}`],
      );
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '3344556', '06', '334455', 'SP', '225125', '9', '01',
            DATE '2026-07-${dia}', '1', '22', '10101012',
            ${valorProcedimento}.00, true, $7)`,
        [s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
         `RG-${String(idx + 1).padStart(3, '0')}`, s.userId],
      );
    }

    // --- lote retornado com as 3 guias ---
    const totalCents = (100 + 200 + 300) * 100; // 60000 centavos
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'retornado'::tiss.lote_status, '4.01.00', 3, $4,
               'lote/rg.xml', 'aabb0011223344556677889900aabbcc',
               'PROT-RG-001', TIMESTAMPTZ '2026-07-10T10:00:00Z', $5)`,
      [s.tenantId, s.loteId, s.operadoraId, totalCents, s.userId],
    );
    for (let idx = 0; idx < 3; idx++) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.loteId, s.guiaIds[idx], idx + 1],
      );
    }

    // --- demonstrativo de analise ---
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RG-001', 'analise'::tiss.demonstrativo_kind,
               DATE '2026-07-15', 'demonstrativo/rg.xml',
               60000, 45000, 45000, 15000, $5)`,
      [s.tenantId, s.demonstrativoId, s.operadoraId, s.loteId, s.userId],
    );

    // --- 3 demonstrativo_items com glosa (servem como glosas pendentes) ---
    for (let idx = 0; idx < 3; idx++) {
      const valorApresentado = (idx + 1) * 10000; // 10000, 20000, 30000 centavos
      const valorGlosa = (idx + 1) * 1000; // 1000, 2000, 3000 centavos de glosa
      const valorLiberado = valorApresentado - valorGlosa;
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $6, $7, $8,
                 $9, $10)`,
        [
          s.tenantId, s.glosaIds[idx], s.demonstrativoId, s.guiaIds[idx],
          `RG-${String(idx + 1).padStart(3, '0')}`,
          valorApresentado, valorLiberado, valorGlosa,
          `M01${idx}`, `Motivo de glosa ${idx + 1}`,
        ],
      );
    }

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

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/create-recurso.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/create-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('createRecursoGlosa', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('cria recurso em rascunho com 2 glosas vinculadas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Procedimento necessario', valorRecursadoCents: 1000 },
          { glosaId: s.glosaIds[1], justificativa: 'Exame indicado clinicamente', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(2);
    expect(result.value.totalRecursadoCents).toBe(3000);
    expect(result.value.recursoId).toBeTruthy();

    // Verifica status no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; item_count: number; total_recursado_cents: string }>(
        `SELECT status, item_count, total_recursado_cents
           FROM tiss.recurso_glosa WHERE id = $1`,
        [result.value.recursoId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('rascunho');
    expect(rows[0]!.item_count).toBe(2);
    expect(Number(rows[0]!.total_recursado_cents)).toBe(3000);
  });

  it('recusa criacao sem itens', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('sem_itens');
  });

  it('recusa glosa inexistente', async () => {
    const fakeGlosaId = uuidv7();
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: fakeGlosaId, justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('glosa_nao_encontrada');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `create-recurso` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/create-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './create-recurso'`.

- [ ] Criar a implementacao `packages/tiss/src/recurso-glosa/create-recurso.ts`:

```ts
// packages/tiss/src/recurso-glosa/create-recurso.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  CreateRecursoGlosaInput,
  CreatedRecurso,
  CreateRecursoFailure,
} from './types';

/**
 * Cria um recurso de glosa em status rascunho com os itens informados.
 *
 * Validacoes:
 * - Ao menos 1 item
 * - Operadora existe
 * - Cada glosa existe, esta com glosa_codigo preenchido (e portanto glosada),
 *   e pertence a mesma operadora do recurso
 * - Glosa nao esta em outro recurso ativo (nao-cancelado)
 */
export async function createRecursoGlosa(
  tx: TxClient,
  i: CreateRecursoGlosaInput,
): Promise<Result<CreatedRecurso, CreateRecursoFailure>> {
  if (i.itens.length === 0) {
    return err({ kind: 'sem_itens' });
  }

  // 1. Valida operadora
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora WHERE id = $1`,
    [i.operadoraId],
  );
  if (opRows.length === 0) {
    return err({ kind: 'operadora_nao_encontrada' });
  }

  // 2. Valida cada glosa
  for (const item of i.itens) {
    const { rows: glosaRows } = await tx.query<{
      id: string;
      glosa_codigo: string | null;
      valor_glosa_cents: string;
      demonstrativo_id: string;
    }>(
      `SELECT di.id, di.glosa_codigo, di.valor_glosa_cents, di.demonstrativo_id
         FROM tiss.demonstrativo_item di
        WHERE di.id = $1`,
      [item.glosaId],
    );
    if (glosaRows.length === 0) {
      return err({ kind: 'glosa_nao_encontrada', glosaId: item.glosaId });
    }
    const glosa = glosaRows[0]!;

    // Glosa precisa ter glosa_codigo preenchido (indicando que foi glosada)
    if (glosa.glosa_codigo === null) {
      return err({ kind: 'glosa_nao_pendente', glosaId: item.glosaId, status: 'sem_glosa' });
    }

    // Valida que a glosa pertence a mesma operadora
    const { rows: demoRows } = await tx.query<{ operadora_id: string }>(
      `SELECT operadora_id FROM tiss.demonstrativo WHERE id = $1`,
      [glosa.demonstrativo_id],
    );
    if (demoRows.length === 0 || demoRows[0]!.operadora_id !== i.operadoraId) {
      return err({ kind: 'glosa_operadora_divergente', glosaId: item.glosaId });
    }

    // Verifica se a glosa ja esta em outro recurso ativo
    const { rows: existeRows } = await tx.query<{ recurso_id: string }>(
      `SELECT rgi.recurso_id
         FROM tiss.recurso_glosa_item rgi
         JOIN tiss.recurso_glosa rg ON rg.id = rgi.recurso_id AND rg.tenant_id = rgi.tenant_id
        WHERE rgi.glosa_id = $1
          AND rg.status NOT IN ('indeferido')`,
      [item.glosaId],
    );
    if (existeRows.length > 0) {
      return err({ kind: 'glosa_nao_pendente', glosaId: item.glosaId, status: 'ja_recursada' });
    }
  }

  // 3. Obtem encounter_version_id da primeira guia (FK obrigatoria em tiss.recurso_glosa)
  const firstGlosaId = i.itens[0]!.glosaId;
  const { rows: evRows } = await tx.query<{ encounter_version_id: string }>(
    `SELECT gc.encounter_version_id
       FROM tiss.glosa g
       JOIN tiss.encounter_guia_consulta gc ON gc.id = g.guia_id AND gc.tenant_id = g.tenant_id
      WHERE g.id = $1`,
    [firstGlosaId],
  );
  const encounterVersionId = evRows[0]!.encounter_version_id;

  // 4. Gera numero_recurso via contador auto-provisionante (migration 0126)
  const { rows: nrRows } = await tx.query<{ next_recurso_number: string }>(
    `SELECT tiss.next_recurso_number(app.current_tenant_id(), $1) AS next_recurso_number`,
    [i.operadoraId],
  );
  const numeroRecurso = String(nrRows[0]!.next_recurso_number);

  // 5. Insere o recurso
  const recursoId = uuidv7();
  let totalRecursadoCents = 0;
  for (const item of i.itens) {
    totalRecursadoCents += item.valorRecursadoCents;
  }

  await tx.query(
    `INSERT INTO tiss.recurso_glosa
       (id, operadora_id, numero_recurso, encounter_version_id,
        status, item_count, total_recursado_cents, created_by)
     VALUES ($1, $2, $3, $4, 'rascunho'::tiss.recurso_glosa_status, $5, $6, $7)`,
    [recursoId, i.operadoraId, numeroRecurso, encounterVersionId,
     i.itens.length, totalRecursadoCents, i.createdBy],
  );

  // 4. Insere os itens
  for (const item of i.itens) {
    await tx.query(
      `INSERT INTO tiss.recurso_glosa_item
         (recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
       VALUES ($1, $2, $3, $4)`,
      [recursoId, item.glosaId, item.justificativa, item.valorRecursadoCents],
    );
  }

  return ok({
    recursoId,
    itemCount: i.itens.length,
    totalRecursadoCents,
  });
}
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/create-recurso.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 3 testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/types.ts packages/tiss/src/recurso-glosa/test-support.ts packages/tiss/src/recurso-glosa/create-recurso.ts packages/tiss/src/recurso-glosa/create-recurso.int.test.ts
git commit -m "feat(tiss): add createRecursoGlosa with types and test support seed"
```

---

### Task 20: addGlosaToRecurso e removeGlosaFromRecurso — gerenciar itens do recurso em rascunho

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/recurso-items.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/recurso-items.ts`

**Por que**: Apos criar o recurso em rascunho, o usuario pode adicionar ou remover glosas individualmente antes de submeter. Cada operacao atualiza os contadores (item_count, total_recursado_cents) e valida que o recurso esta em rascunho.

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/recurso-items.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/recurso-items.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('addGlosaToRecurso e removeGlosaFromRecurso', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('adiciona glosa a recurso existente em rascunho', async () => {
    // Cria recurso com 1 glosa
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo 1', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    // Adiciona segunda glosa
    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[1], 'Motivo 2', 2000),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(add.value.itemCount).toBe(2);
    expect(add.value.totalRecursadoCents).toBe(3000);
  });

  it('recusa adicionar glosa a recurso que nao esta em rascunho', async () => {
    // Cria recurso com justificativa geral e marca pronto
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Motivo 3', valorRecursadoCents: 3000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    // Atualiza justificativa_geral e marca pronto
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao geral', status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
        [recursoId],
      ),
    );

    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[0], 'Motivo extra', 500),
    );
    expect(add.ok).toBe(false);
    if (add.ok) return;
    expect(add.error.kind).toBe('recurso_nao_rascunho');
  });

  it('recusa adicionar glosa ja vinculada ao mesmo recurso', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo A', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, create.value.recursoId, s.glosaIds[0], 'Duplicata', 500),
    );
    expect(add.ok).toBe(false);
    if (add.ok) return;
    expect(add.error.kind).toBe('glosa_ja_no_recurso');
  });

  it('remove glosa de recurso em rascunho e atualiza contadores', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo X', valorRecursadoCents: 1000 },
          { glosaId: s.glosaIds[1], justificativa: 'Motivo Y', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const remove = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[0]),
    );
    expect(remove.ok).toBe(true);
    if (!remove.ok) return;
    expect(remove.value.itemCount).toBe(1);
    expect(remove.value.totalRecursadoCents).toBe(2000);
  });

  it('recusa remover glosa que nao esta no recurso', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo W', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const remove = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[2]),
    );
    expect(remove.ok).toBe(false);
    if (remove.ok) return;
    expect(remove.error.kind).toBe('vinculo_nao_encontrado');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `recurso-items` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-items.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './recurso-items'`.

- [ ] Criar a implementacao `packages/tiss/src/recurso-glosa/recurso-items.ts`:

```ts
// packages/tiss/src/recurso-glosa/recurso-items.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  AddGlosaFailure,
  AddedGlosaItem,
  RemoveGlosaFailure,
  RemovedGlosaItem,
} from './types';

/**
 * Adiciona uma glosa a um recurso em rascunho. Validacoes:
 * - Recurso existe e esta em rascunho
 * - Glosa existe e esta glosada (glosa_codigo preenchido)
 * - Glosa pertence a mesma operadora do recurso
 * - Glosa nao esta ja vinculada a este recurso
 */
export async function addGlosaToRecurso(
  tx: TxClient,
  recursoId: string,
  glosaId: string,
  justificativa: string,
  valorRecursadoCents: number,
): Promise<Result<AddedGlosaItem, AddGlosaFailure>> {
  // 1. Busca o recurso e valida status
  const { rows: recursoRows } = await tx.query<{
    id: string;
    operadora_id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
  }>(
    `SELECT id, operadora_id, status, item_count, total_recursado_cents
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = recursoRows[0]!;
  if (recurso.status !== 'rascunho') {
    return err({ kind: 'recurso_nao_rascunho', status: recurso.status });
  }

  // 2. Busca a glosa (demonstrativo_item) e valida
  const { rows: glosaRows } = await tx.query<{
    id: string;
    glosa_codigo: string | null;
    demonstrativo_id: string;
  }>(
    `SELECT id, glosa_codigo, demonstrativo_id
       FROM tiss.demonstrativo_item WHERE id = $1`,
    [glosaId],
  );
  if (glosaRows.length === 0) {
    return err({ kind: 'glosa_nao_encontrada' });
  }
  const glosa = glosaRows[0]!;
  if (glosa.glosa_codigo === null) {
    return err({ kind: 'glosa_nao_pendente', status: 'sem_glosa' });
  }

  // 3. Valida operadora
  const { rows: demoRows } = await tx.query<{ operadora_id: string }>(
    `SELECT operadora_id FROM tiss.demonstrativo WHERE id = $1`,
    [glosa.demonstrativo_id],
  );
  if (demoRows.length === 0 || demoRows[0]!.operadora_id !== recurso.operadora_id) {
    return err({ kind: 'glosa_operadora_divergente' });
  }

  // 4. Verifica duplicata
  const { rows: existeRows } = await tx.query<{ recurso_id: string }>(
    `SELECT recurso_id FROM tiss.recurso_glosa_item
      WHERE recurso_id = $1 AND glosa_id = $2`,
    [recursoId, glosaId],
  );
  if (existeRows.length > 0) {
    return err({ kind: 'glosa_ja_no_recurso' });
  }

  // 5. Insere o item
  await tx.query(
    `INSERT INTO tiss.recurso_glosa_item
       (recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
     VALUES ($1, $2, $3, $4)`,
    [recursoId, glosaId, justificativa, valorRecursadoCents],
  );

  // 6. Atualiza contadores
  const newCount = recurso.item_count + 1;
  const newTotal = Number(recurso.total_recursado_cents) + valorRecursadoCents;
  await tx.query(
    `UPDATE tiss.recurso_glosa SET item_count = $2, total_recursado_cents = $3 WHERE id = $1`,
    [recursoId, newCount, newTotal],
  );

  return ok({ itemCount: newCount, totalRecursadoCents: newTotal });
}

/**
 * Remove uma glosa de um recurso em rascunho. Atualiza contadores.
 */
export async function removeGlosaFromRecurso(
  tx: TxClient,
  recursoId: string,
  glosaId: string,
): Promise<Result<RemovedGlosaItem, RemoveGlosaFailure>> {
  // 1. Busca o recurso e valida status
  const { rows: recursoRows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
  }>(
    `SELECT id, status, item_count, total_recursado_cents
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = recursoRows[0]!;
  if (recurso.status !== 'rascunho') {
    return err({ kind: 'recurso_nao_rascunho', status: recurso.status });
  }

  // 2. Remove o item e pega o valor
  const { rows: removedRows } = await tx.query<{ valor_recursado_cents: string }>(
    `DELETE FROM tiss.recurso_glosa_item
      WHERE recurso_id = $1 AND glosa_id = $2
      RETURNING valor_recursado_cents`,
    [recursoId, glosaId],
  );
  if (removedRows.length === 0) {
    return err({ kind: 'vinculo_nao_encontrado' });
  }

  // 3. Atualiza contadores
  const removedCents = Number(removedRows[0]!.valor_recursado_cents);
  const newCount = Math.max(recurso.item_count - 1, 0);
  const newTotal = Math.max(Number(recurso.total_recursado_cents) - removedCents, 0);
  await tx.query(
    `UPDATE tiss.recurso_glosa SET item_count = $2, total_recursado_cents = $3 WHERE id = $1`,
    [recursoId, newCount, newTotal],
  );

  return ok({ itemCount: newCount, totalRecursadoCents: newTotal });
}
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-items.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 5 testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/recurso-items.ts packages/tiss/src/recurso-glosa/recurso-items.int.test.ts
git commit -m "feat(tiss): add addGlosaToRecurso and removeGlosaFromRecurso"
```

---

### Task 21: markRecursoReady — transicao de rascunho para pronto com validacao

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts`

**Por que**: Antes de enviar o recurso, o usuario marca como pronto. A funcao valida que tem pelo menos 1 item e que a justificativa geral esta preenchida (campo `justificativa_geral` no recurso, diferente da justificativa individual de cada item).

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts` com os cenarios de markRecursoReady:

```ts
// packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { removeGlosaFromRecurso } from './recurso-items';
import { markRecursoReady } from './recurso-lifecycle';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('markRecursoReady', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('transiciona recurso de rascunho para pronto com justificativa geral', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo 1', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Preenche justificativa geral
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [create.value.recursoId, 'Todos os procedimentos foram realizados conforme protocolo clinico.'],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.recursoId).toBe(create.value.recursoId);
    expect(ready.value.itemCount).toBe(1);
    expect(ready.value.totalRecursadoCents).toBe(1000);

    // Verifica status no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [create.value.recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('pronto');
  });

  it('recusa marcar pronto sem justificativa geral', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[1], justificativa: 'Motivo 2', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // NAO preenche justificativa_geral
    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('justificativa_geral_ausente');
  });

  it('recusa marcar pronto recurso sem itens', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Motivo 3', valorRecursadoCents: 3000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Remove o unico item
    await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[2]),
    );

    // Preenche justificativa geral
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Geral' WHERE id = $1`,
        [create.value.recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('sem_itens');
  });

  it('recusa marcar pronto recurso que ja esta pronto', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo R', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Geral R', status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
        [create.value.recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('transicao_invalida');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `recurso-lifecycle` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './recurso-lifecycle'`.

- [ ] Criar a implementacao `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` com markRecursoReady:

```ts
// packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
} from './types';

/**
 * Marca o recurso de glosa como pronto para envio. Validacoes:
 * - Recurso existe
 * - Status atual e 'rascunho' (transicao permitida: rascunho -> pronto)
 * - Tem pelo menos 1 item
 * - justificativa_geral esta preenchida
 */
export async function markRecursoReady(
  tx: TxClient,
  recursoId: string,
): Promise<Result<RecursoReadyResult, MarkReadyFailure>> {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
    justificativa_geral: string | null;
  }>(
    `SELECT id, status, item_count, total_recursado_cents, justificativa_geral
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  if (recurso.status !== 'rascunho') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'pronto' });
  }
  if (recurso.item_count === 0) {
    return err({ kind: 'sem_itens' });
  }
  if (!recurso.justificativa_geral || recurso.justificativa_geral.trim() === '') {
    return err({ kind: 'justificativa_geral_ausente' });
  }

  await tx.query(
    `UPDATE tiss.recurso_glosa SET status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
    [recursoId],
  );

  return ok({
    recursoId: recurso.id,
    itemCount: recurso.item_count,
    totalRecursadoCents: Number(recurso.total_recursado_cents),
  });
}
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 4 testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/recurso-lifecycle.ts packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts
git commit -m "feat(tiss): add markRecursoReady with justificativa and item count validation"
```

---

### Task 22: atualizar fake transport e submitRecurso — envio com timeout gerando indeterminado

**Arquivos:**
- Modificar `packages/tiss/src/transport/tiss-arquivo-fake.ts`
- Modificar `packages/tiss/src/transport/tiss-arquivo-fake.test.ts`
- Criar `packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts`
- Modificar `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` (adicionar submitRecurso)

**Por que**: O `submitRecurso` chama `transport.submitRecursoGlosa` para enviar o XML do recurso. O fake transport precisa aceitar o envio (em vez de retornar `unsupported`). Em caso de timeout, o recurso transita para `indeterminado` — NUNCA retry automatico (Design §7). O fake transport no modo `timeout` permite testar esse fluxo.

- [ ] Atualizar `packages/tiss/src/transport/tiss-arquivo-fake.ts` para implementar `submitRecursoGlosa`:

No trecho do metodo `submitRecursoGlosa` existente, substituir o bloco que retorna `unsupported`:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.ts
// SUBSTITUIR o metodo submitRecursoGlosa existente:
// DE:
    async submitRecursoGlosa(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported', retrySafe: false,
        detail: 'submitRecursoGlosa nao disponivel no fake (Fase 5)',
      });
    },
// PARA:
    async submitRecursoGlosa(ctx: ProviderCtx, i) {
      const f = talvezFalhar<TissSubmissionReceipt>();
      if (f) return f;

      const iso = isoFromMs(systemClock.nowMs());
      const ano = iso.slice(0, 4);
      const mes = iso.slice(5, 7);
      const seq = submittedRecursos.length + 1;
      const fileName = `recurso_${i.operadoraCnpj}_${ano}_${mes}_${seq}.xml`;
      const sha256 = createHash('sha256').update(i.xml).digest('hex');
      const storageKey = asStorageKey(`tiss-fake/${ctx.tenantId}/${fileName}`);

      submittedRecursos.push({
        recursoId: i.recursoId,
        xml: new Uint8Array(i.xml),
        operadoraCnpj: i.operadoraCnpj,
      });

      const receipt: TissSubmissionReceipt = {
        kind: 'arquivo',
        storageKey,
        fileName,
        sha256,
        instructions:
          `Acesse o portal da operadora ${i.operadoraCnpj}, ` +
          `menu Recurso de Glosa, importe o arquivo ${fileName}.`,
      };

      return success(receipt, `tiss-fake-recurso-${i.recursoId}`);
    },
```

Adicionar a interface `SubmittedRecurso` e o array de rastreamento. Logo apos a interface `SubmittedBatch` existente, adicionar:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.ts
// APOS a interface SubmittedBatch, adicionar:

export interface SubmittedRecurso {
  readonly recursoId: string;
  readonly xml: Uint8Array;
  readonly operadoraCnpj: string;
}
```

Na interface `FakeTissArquivoTransport`, adicionar o campo de rastreamento:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.ts
// Na interface FakeTissArquivoTransport, APOS submittedBatches:
export interface FakeTissArquivoTransport extends TissTransport {
  readonly submittedBatches: readonly SubmittedBatch[];
  readonly submittedRecursos: readonly SubmittedRecurso[];
}
```

Na funcao `createFakeTissArquivoTransport`, logo apos `const batches`, adicionar:

```ts
  const submittedRecursos: SubmittedRecurso[] = [];
```

E adicionar o getter na interface retornada, logo apos o getter `submittedBatches`:

```ts
    get submittedRecursos(): readonly SubmittedRecurso[] {
      return submittedRecursos;
    },
```

- [ ] Atualizar o teste do fake transport em `packages/tiss/src/transport/tiss-arquivo-fake.test.ts`. Localizar o teste `submitRecursoGlosa retorna unsupported` e substituir:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.test.ts
// SUBSTITUIR o teste:
// DE:
  it('submitRecursoGlosa retorna unsupported', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });
// PARA:
  it('submitRecursoGlosa retorna sucesso com arquivo', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('arquivo');
    expect(transport.submittedRecursos).toHaveLength(1);
    expect(transport.submittedRecursos[0]!.recursoId).toBe('rec-001');
  });

  it('submitRecursoGlosa retorna timeout quando modo e timeout', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-002',
      xml: new Uint8Array([4, 5, 6]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('timeout');
    expect(transport.submittedRecursos).toHaveLength(0);
  });
```

- [ ] Rodar os testes do fake transport para confirmar que passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/transport/tiss-arquivo-fake.test.ts 2>&1 | tail -15
```

Saida esperada: todos os testes passam.

- [ ] Criar o teste de integracao do submitRecurso `packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { createRecursoGlosa } from './create-recurso';
import { markRecursoReady, submitRecurso } from './recurso-lifecycle';
import { createFakeTissArquivoTransport } from '../transport/tiss-arquivo-fake';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('submitRecurso', () => {
  let s: SementeRecurso;
  let actor: Actor;
  let providerCtx: ProviderCtx;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
    providerCtx = {
      tenantId: s.tenantId,
      correlationId: uuidv7(),
      idempotencyKey: uuidv7(),
      deadlineMs: 3000,
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('envia recurso pronto com fake transport e transita para enviado', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    // Cria e marca pronto
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Necessario', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao formal' WHERE id = $1`,
        [recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(ready.ok).toBe(true);

    // Submete
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;
    expect(submit.value.recursoId).toBe(recursoId);
    expect(submit.value.storageKey).toBeTruthy();

    // Verifica estado no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; xml_storage_key: string | null; sent_at: string | null }>(
        `SELECT status, xml_storage_key, sent_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('enviado');
    expect(rows[0]!.xml_storage_key).toBeTruthy();
    expect(rows[0]!.sent_at).toBeTruthy();

    // Verifica que o fake transport recebeu o XML
    expect(transport.submittedRecursos).toHaveLength(1);
  });

  it('timeout no transport transita para indeterminado — NUNCA retry', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[1], justificativa: 'Procedimento indicado', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao timeout' WHERE id = $1`,
        [recursoId],
      ),
    );
    await withTenantTx(actor, (tx) => markRecursoReady(tx, recursoId));

    // Submete — timeout
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(false);
    if (submit.ok) return;
    expect(submit.error.kind).toBe('transport_indeterminado');

    // Verifica estado no banco: INDETERMINADO, nao enviado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('indeterminado');

    // Transport NAO recebeu nada (timeout simulado antes do efeito)
    expect(transport.submittedRecursos).toHaveLength(0);
  });

  it('recusa submeter recurso que nao esta pronto', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Nao marca pronto — status e rascunho
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, create.value.recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(false);
    if (submit.ok) return;
    expect(submit.error.kind).toBe('transicao_invalida');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (funcao `submitRecurso` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com export nao encontrado.

- [ ] Adicionar `submitRecurso` ao arquivo `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts`. Acrescentar ao final do arquivo:

```ts
// --- acrescentar ao final de packages/tiss/src/recurso-glosa/recurso-lifecycle.ts ---

import type { ProviderCtx } from '@cadencia/integrations';
import type { TissTransport } from '../transport/types';
import { XmlBuilder } from '../serializer/xml-builder';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import type {
  SubmitRecursoFailure,
  RecursoSentResult,
} from './types';

/**
 * Submete o recurso de glosa via transport. Fluxo:
 * 1. Valida que o recurso esta em status 'pronto'
 * 2. Busca dados necessarios (operadora, itens)
 * 3. Serializa XML minimo do recurso
 * 4. Chama transport.submitRecursoGlosa
 * 5. Sucesso: transita para 'enviado', grava protocolo/storageKey
 * 6. Timeout: transita para 'indeterminado' — NUNCA retry (Design §7)
 * 7. Outro erro: retorna falha sem mudar estado
 */
export async function submitRecurso(
  tx: TxClient,
  recursoId: string,
  transport: TissTransport,
  providerCtx: ProviderCtx,
): Promise<Result<RecursoSentResult, SubmitRecursoFailure>> {
  // 1. Busca o recurso
  const { rows } = await tx.query<{
    id: string;
    status: string;
    operadora_id: string;
    justificativa_geral: string;
    item_count: number;
  }>(
    `SELECT id, status, operadora_id, justificativa_geral, item_count
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;
  if (recurso.status !== 'pronto') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'enviado' });
  }

  // 2. Busca dados da operadora
  const { rows: opRows } = await tx.query<{
    registro_ans: string;
    cnpj: string;
  }>(
    `SELECT registro_ans, cnpj FROM tiss.operadora WHERE id = $1`,
    [recurso.operadora_id],
  );
  const op = opRows[0]!;

  // 3. Busca itens do recurso com dados da glosa
  const { rows: itemRows } = await tx.query<{
    glosa_id: string;
    justificativa_item: string;
    valor_recursado_cents: string;
    glosa_codigo: string;
    numero_guia_prestador: string;
    data_atendimento: string;
    codigo_procedimento: string;
  }>(
    `SELECT rgi.glosa_id, rgi.justificativa_item, rgi.valor_recursado_cents,
            di.glosa_codigo, di.numero_guia_prestador,
            g.data_atendimento::text, g.codigo_procedimento
       FROM tiss.recurso_glosa_item rgi
       JOIN tiss.demonstrativo_item di ON di.id = rgi.glosa_id AND di.tenant_id = rgi.tenant_id
       JOIN tiss.encounter_guia_consulta g ON g.id = di.guia_id AND g.tenant_id = di.tenant_id
      WHERE rgi.recurso_id = $1
      ORDER BY rgi.glosa_id`,
    [recursoId],
  );

  // 4. Serializa XML minimo do recurso
  const xml = new XmlBuilder();
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', transport.tissVersion);
  xml.tag('ans:registroANS', op.registro_ans);
  xml.close('ans:cabecalho');

  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:recursoGlosa');
  xml.tag('ans:numeroRecursoGlosa', recursoId.slice(0, 20));

  for (let idx = 0; idx < itemRows.length; idx++) {
    const item = itemRows[idx]!;
    xml.open('ans:itemRecursoGlosa');
    xml.tag('ans:sequencialItem', String(idx + 1));
    xml.tag('ans:dataAtendimento', item.data_atendimento);
    xml.tag('ans:numeroGuiaPrestador', item.numero_guia_prestador);
    xml.tag('ans:codigoProcedimento', item.codigo_procedimento);
    xml.tag('ans:codigoGlosa', item.glosa_codigo);
    xml.tag('ans:valorRecursado', formatCentsAsReais(Number(item.valor_recursado_cents)));
    xml.tag('ans:justificativa', item.justificativa_item);
    xml.close('ans:itemRecursoGlosa');
  }

  xml.close('ans:recursoGlosa');
  xml.close('ans:prestadorParaOperadora');
  xml.close('ans:mensagemTISS');

  const encoded = encodeIso8859(xml.toString());

  // 5. Chama o transport
  const transportResult = await transport.submitRecursoGlosa(providerCtx, {
    recursoId,
    xml: encoded.bytes,
    operadoraCnpj: op.cnpj,
  });

  // 6. Trata o resultado
  if (transportResult.ok) {
    const receipt = transportResult.value;
    const storageKey = receipt.kind === 'arquivo' ? receipt.storageKey : undefined;
    const protocolo = receipt.kind === 'protocolo' ? receipt.protocolo : undefined;

    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'enviado'::tiss.recurso_glosa_status,
              protocolo_operadora = $2,
              xml_storage_key = $3,
              sent_at = clock_timestamp()
        WHERE id = $1`,
      [recursoId, protocolo ?? null, storageKey ?? null],
    );

    return ok({
      recursoId,
      protocoloOperadora: protocolo,
      storageKey: storageKey as string | undefined,
    });
  }

  // Timeout: transita para indeterminado — NUNCA retry (Design §7)
  if (transportResult.error.kind === 'timeout') {
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'indeterminado'::tiss.recurso_glosa_status
        WHERE id = $1`,
      [recursoId],
    );
    return err({
      kind: 'transport_indeterminado',
      detail: transportResult.error.detail,
    });
  }

  // Outros erros: nao muda estado
  if (transportResult.error.kind === 'unavailable') {
    return err({ kind: 'transport_indisponivel', detail: transportResult.error.detail });
  }
  if (transportResult.error.kind === 'rejected') {
    return err({ kind: 'transport_rejeitado', detail: transportResult.error.detail });
  }
  return err({ kind: 'transport_nao_suportado', detail: transportResult.error.detail });
}

function formatCentsAsReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

Atualizar os imports no topo de `recurso-lifecycle.ts` para incluir os novos:

```ts
// em packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
// SUBSTITUIR o bloco de imports:
// DE:
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
} from './types';
// PARA:
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { ProviderCtx } from '@cadencia/integrations';
import type { TissTransport } from '../transport/types';
import { XmlBuilder } from '../serializer/xml-builder';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
} from './types';
```

- [ ] Rodar o teste do submit e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 3 testes passam.

- [ ] Rodar o teste do lifecycle para confirmar que markRecursoReady ainda passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/transport/tiss-arquivo-fake.ts packages/tiss/src/transport/tiss-arquivo-fake.test.ts packages/tiss/src/recurso-glosa/recurso-lifecycle.ts packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts
git commit -m "feat(tiss): add submitRecurso with timeout->indeterminado and update fake transport"
```

---

### Task 23: resolveRecurso — resolucao do recurso com resultado por item

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts`
- Modificar `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` (adicionar resolveRecurso)

**Por que**: Quando a operadora responde ao recurso, o usuario registra o resultado: deferido (todos os itens aceitos), indeferido (todos negados), ou parcial (alguns sim, outros nao). A funcao atualiza o status do recurso e o resultado individual de cada item vinculado.

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { resolveRecurso } from './recurso-lifecycle';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('resolveRecurso', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  async function criarRecursoEnviado(glosaIds: string[]): Promise<string> {
    const itens = glosaIds.map((id, idx) => ({
      glosaId: id,
      justificativa: `Motivo ${idx + 1}`,
      valorRecursadoCents: (idx + 1) * 1000,
    }));

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens,
      }),
    );
    if (!create.ok) throw new Error(`Falha ao criar recurso: ${create.error.kind}`);
    const recursoId = create.value.recursoId;

    // Marca pronto e enviado diretamente (para simplificar o teste)
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa
            SET justificativa_geral = 'Contestacao',
                status = 'enviado'::tiss.recurso_glosa_status,
                sent_at = clock_timestamp()
          WHERE id = $1`,
        [recursoId],
      ),
    );

    return recursoId;
  }

  it('resolve recurso como deferido — todos os itens deferidos', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[0], resultado: 'deferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('deferido');
    expect(resolve.value.itensDeferidos).toBe(1);
    expect(resolve.value.itensIndeferidos).toBe(0);

    // Verifica no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; resolved_at: string | null }>(
        `SELECT status, resolved_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('deferido');
    expect(rows[0]!.resolved_at).toBeTruthy();

    // Verifica resultado do item
    const { rows: itemRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ resultado: string }>(
        `SELECT resultado FROM tiss.recurso_glosa_item WHERE recurso_id = $1`,
        [recursoId],
      ),
    );
    expect(itemRows[0]!.resultado).toBe('deferido');
  });

  it('resolve recurso como indeferido — todos os itens indeferidos', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[1]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'indeferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[1], resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('indeferido');
    expect(resolve.value.itensDeferidos).toBe(0);
    expect(resolve.value.itensIndeferidos).toBe(1);
  });

  it('resolve recurso como parcial — mix de deferido e indeferido', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0], s.glosaIds[1]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'parcial',
        itensResolvidos: [
          { glosaId: s.glosaIds[0], resultado: 'deferido' },
          { glosaId: s.glosaIds[1], resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('parcial');
    expect(resolve.value.itensDeferidos).toBe(1);
    expect(resolve.value.itensIndeferidos).toBe(1);
  });

  it('recusa resolver recurso que nao esta enviado', async () => {
    // Cria recurso em rascunho (nao enviado)
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, create.value.recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[2], resultado: 'deferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.error.kind).toBe('transicao_invalida');
  });

  it('recusa resolver com item que nao pertence ao recurso', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[2], resultado: 'deferido' }, // nao esta neste recurso
        ],
      }),
    );
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.error.kind).toBe('item_nao_encontrado');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (funcao `resolveRecurso` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com export nao encontrado.

- [ ] Adicionar `resolveRecurso` ao final de `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts`:

```ts
// --- acrescentar ao final de packages/tiss/src/recurso-glosa/recurso-lifecycle.ts ---

import type {
  ResolveRecursoFailure,
  ResolveRecursoInput,
  RecursoResolvedResult,
} from './types';

/**
 * Resolve o recurso de glosa com o resultado da operadora.
 * Transicao permitida: enviado -> (deferido | indeferido | parcial).
 * Tambem aceita resolver recurso em status 'indeterminado' (apos reconciliacao).
 * Atualiza o resultado individual de cada item vinculado.
 */
export async function resolveRecurso(
  tx: TxClient,
  recursoId: string,
  input: ResolveRecursoInput,
): Promise<Result<RecursoResolvedResult, ResolveRecursoFailure>> {
  // 1. Busca o recurso
  const { rows } = await tx.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  // Transicao permitida: enviado ou indeterminado -> resultado final
  if (recurso.status !== 'enviado' && recurso.status !== 'indeterminado') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: input.resultado });
  }

  // 2. Valida que todos os itens pertencem ao recurso
  for (const item of input.itensResolvidos) {
    const { rows: itemRows } = await tx.query<{ glosa_id: string }>(
      `SELECT glosa_id FROM tiss.recurso_glosa_item
        WHERE recurso_id = $1 AND glosa_id = $2`,
      [recursoId, item.glosaId],
    );
    if (itemRows.length === 0) {
      return err({ kind: 'item_nao_encontrado', glosaId: item.glosaId });
    }
  }

  // 3. Atualiza resultado de cada item
  let deferidos = 0;
  let indeferidos = 0;
  for (const item of input.itensResolvidos) {
    await tx.query(
      `UPDATE tiss.recurso_glosa_item
          SET resultado = $3
        WHERE recurso_id = $1 AND glosa_id = $2`,
      [recursoId, item.glosaId, item.resultado],
    );
    if (item.resultado === 'deferido') deferidos++;
    if (item.resultado === 'indeferido') indeferidos++;
  }

  // 4. Atualiza status e resolved_at do recurso
  await tx.query(
    `UPDATE tiss.recurso_glosa
        SET status = $2::tiss.recurso_glosa_status,
            resolved_at = clock_timestamp()
      WHERE id = $1`,
    [recursoId, input.resultado],
  );

  return ok({
    recursoId: recurso.id,
    resultado: input.resultado,
    itensDeferidos: deferidos,
    itensIndeferidos: indeferidos,
  });
}
```

Atualizar os imports de tipos no topo de `recurso-lifecycle.ts` para incluir os novos tipos de resolve. O bloco de imports de tipos ficara:

```ts
// em packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
// SUBSTITUIR o import de tipos:
// DE:
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
} from './types';
// PARA:
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
  ResolveRecursoFailure,
  ResolveRecursoInput,
  RecursoResolvedResult,
} from './types';
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 5 testes passam.

- [ ] Rodar TODOS os testes do recurso-glosa para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/ 2>&1 | tail -15
```

Saida esperada: todos os testes passam (create, items, lifecycle, submit, resolve).

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/recurso-lifecycle.ts packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts
git commit -m "feat(tiss): add resolveRecurso with per-item deferido/indeferido tracking"
```

---

### Task 24: ciclo completo de integracao e exportacao via index.ts

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/full-cycle.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/index.ts`
- Modificar `packages/tiss/src/index.ts` (re-exportar o modulo recurso-glosa)

**Por que**: O teste de ciclo completo garante que o fluxo inteiro funciona em sequencia: criar recurso -> adicionar glosa -> marcar pronto -> submeter com fake transport -> resolver. Alem disso, o `index.ts` expoe todas as funcoes e tipos para consumo por L3 (API e worker).

- [ ] Criar o barrel `packages/tiss/src/recurso-glosa/index.ts`:

```ts
// packages/tiss/src/recurso-glosa/index.ts
export { createRecursoGlosa } from './create-recurso';
export { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
export { markRecursoReady, submitRecurso, resolveRecurso } from './recurso-lifecycle';
export type {
  RecursoStatus,
  GlosaItemResultado,
  CreateRecursoGlosaInput,
  CreateRecursoItemInput,
  CreateRecursoFailure,
  CreatedRecurso,
  AddGlosaFailure,
  AddedGlosaItem,
  RemoveGlosaFailure,
  RemovedGlosaItem,
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
  RecursoIndeterminadoResult,
  ResolveRecursoFailure,
  ResolveRecursoInput,
  ResolveItemInput,
  RecursoResolvedResult,
} from './types';
```

- [ ] Adicionar a re-exportacao em `packages/tiss/src/index.ts`. Acrescentar ao final:

```ts
// --- acrescentar ao final de packages/tiss/src/index.ts ---

// Recurso de glosa (Fase 5)
export {
  createRecursoGlosa,
  addGlosaToRecurso,
  removeGlosaFromRecurso,
  markRecursoReady,
  submitRecurso,
  resolveRecurso,
  type RecursoStatus,
  type GlosaItemResultado,
  type CreateRecursoGlosaInput,
  type CreateRecursoItemInput,
  type CreateRecursoFailure,
  type CreatedRecurso,
  type AddGlosaFailure,
  type AddedGlosaItem,
  type RemoveGlosaFailure,
  type RemovedGlosaItem,
  type MarkReadyFailure,
  type RecursoReadyResult,
  type SubmitRecursoFailure,
  type RecursoSentResult,
  type RecursoIndeterminadoResult,
  type ResolveRecursoFailure,
  type ResolveRecursoInput,
  type ResolveItemInput,
  type RecursoResolvedResult,
} from './recurso-glosa/index';
```

- [ ] Criar o teste de ciclo completo `packages/tiss/src/recurso-glosa/full-cycle.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/full-cycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { createRecursoGlosa } from './create-recurso';
import { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
import { markRecursoReady, submitRecurso, resolveRecurso } from './recurso-lifecycle';
import { createFakeTissArquivoTransport } from '../transport/tiss-arquivo-fake';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('ciclo completo do recurso de glosa TISS', () => {
  let s: SementeRecurso;
  let actor: Actor;
  let providerCtx: ProviderCtx;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
    providerCtx = {
      tenantId: s.tenantId,
      correlationId: uuidv7(),
      idempotencyKey: uuidv7(),
      deadlineMs: 3000,
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('percorre o ciclo: criar -> adicionar -> remover -> marcar pronto -> submeter -> resolver parcial', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    // 1. Criar recurso com 1 glosa
    const createResult = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Procedimento necessario conforme protocolo', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const recursoId = createResult.value.recursoId;
    expect(createResult.value.itemCount).toBe(1);
    expect(createResult.value.totalRecursadoCents).toBe(1000);

    // 2. Adicionar segunda glosa
    const addResult = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[1], 'Exame indicado clinicamente', 2000),
    );
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;
    expect(addResult.value.itemCount).toBe(2);
    expect(addResult.value.totalRecursadoCents).toBe(3000);

    // 3. Adicionar terceira glosa
    const addResult2 = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[2], 'Retorno medicamente justificado', 3000),
    );
    expect(addResult2.ok).toBe(true);
    if (!addResult2.ok) return;
    expect(addResult2.value.itemCount).toBe(3);
    expect(addResult2.value.totalRecursadoCents).toBe(6000);

    // 4. Remover a terceira glosa (mudou de ideia)
    const removeResult = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, recursoId, s.glosaIds[2]),
    );
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;
    expect(removeResult.value.itemCount).toBe(2);
    expect(removeResult.value.totalRecursadoCents).toBe(3000);

    // 5. Preencher justificativa geral e marcar pronto
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [recursoId, 'Todos os procedimentos contestados foram clinicamente indicados e realizados conforme protocolo vigente.'],
      ),
    );

    const readyResult = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.itemCount).toBe(2);

    // 5b. Nao pode adicionar glosa a recurso pronto
    const addAfterReady = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[2], 'Tarde demais', 500),
    );
    expect(addAfterReady.ok).toBe(false);
    if (addAfterReady.ok) return;
    expect(addAfterReady.error.kind).toBe('recurso_nao_rascunho');

    // 6. Submeter via fake transport
    const submitResult = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.recursoId).toBe(recursoId);

    // Verifica que o transport recebeu o XML
    expect(transport.submittedRecursos).toHaveLength(1);
    expect(transport.submittedRecursos[0]!.recursoId).toBe(recursoId);

    // Verifica status no banco
    const { rows: sentRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; sent_at: string | null }>(
        `SELECT status, sent_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(sentRows[0]!.status).toBe('enviado');
    expect(sentRows[0]!.sent_at).toBeTruthy();

    // 7. Resolver como parcial (glosa 0 deferida, glosa 1 indeferida)
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'parcial',
        itensResolvidos: [
          { glosaId: s.glosaIds[0], resultado: 'deferido' },
          { glosaId: s.glosaIds[1], resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.resultado).toBe('parcial');
    expect(resolveResult.value.itensDeferidos).toBe(1);
    expect(resolveResult.value.itensIndeferidos).toBe(1);

    // Verifica estado final no banco
    const { rows: finalRows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        status: string;
        resolved_at: string | null;
        item_count: number;
        total_recursado_cents: string;
      }>(
        `SELECT status, resolved_at, item_count, total_recursado_cents
           FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(finalRows[0]!.status).toBe('parcial');
    expect(finalRows[0]!.resolved_at).toBeTruthy();
    expect(finalRows[0]!.item_count).toBe(2);
    expect(Number(finalRows[0]!.total_recursado_cents)).toBe(3000);

    // Verifica resultado individual dos itens
    const { rows: itemRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ glosa_id: string; resultado: string }>(
        `SELECT glosa_id, resultado FROM tiss.recurso_glosa_item
          WHERE recurso_id = $1 ORDER BY glosa_id`,
        [recursoId],
      ),
    );
    expect(itemRows).toHaveLength(2);
    const resultadoMap = new Map(itemRows.map(r => [r.glosa_id, r.resultado]));
    expect(resultadoMap.get(s.glosaIds[0])).toBe('deferido');
    expect(resultadoMap.get(s.glosaIds[1])).toBe('indeferido');
  });
});
```

- [ ] Rodar o teste de ciclo completo e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/full-cycle.int.test.ts 2>&1 | tail -20
```

Saida esperada: o teste do ciclo completo passa.

- [ ] Rodar todos os testes do pacote tiss para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/ 2>&1 | tail -15
```

Saida esperada: todos os testes passam (incluindo os novos e os existentes).

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/index.ts packages/tiss/src/recurso-glosa/full-cycle.int.test.ts packages/tiss/src/index.ts
git commit -m "feat(tiss): add recurso de glosa full cycle integration test and barrel exports"
```
