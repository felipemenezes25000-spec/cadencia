### Task 38: funcoes addGuiaToLote e removeGuiaFromLote com validacoes

**Arquivos**

- Criar `packages/tiss/src/lote-guias.ts`
- Criar `packages/tiss/src/lote-guias.int.test.ts`
- Modificar `packages/tiss/src/index.ts`

**Passos**

- [ ] Criar `packages/tiss/src/lote-guias.ts`:

```typescript
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type AddGuiaFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_nao_rascunho'; status: string }
  | { kind: 'guia_nao_encontrada' }
  | { kind: 'guia_inativa' }
  | { kind: 'guia_operadora_divergente' }
  | { kind: 'guia_ja_em_lote'; loteId: string };

export type RemoveGuiaFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_nao_rascunho'; status: string }
  | { kind: 'vinculo_nao_encontrado' };

export interface AddGuiaInput {
  readonly loteId: string;
  readonly guiaId: string;
}

export interface AddedGuia {
  readonly sequencialItem: number;
  readonly guiaCount: number;
  readonly totalValueCents: number;
}

/**
 * Adiciona uma guia a um lote em rascunho. Validacoes:
 * - Lote existe e esta em rascunho
 * - Guia existe e esta com live=true
 * - Guia pertence a mesma operadora do lote
 * - Guia nao esta em outro lote (indice unico garante, mas validamos antes)
 */
export async function addGuiaToLote(
  tx: TxClient,
  i: AddGuiaInput,
): Promise<Result<AddedGuia, AddGuiaFailure>> {
  // 1. Busca o lote e valida status
  const { rows: loteRows } = await tx.query<{
    id: string;
    operadora_id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, operadora_id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (loteRows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = loteRows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'lote_nao_rascunho', status: lote.status });
  }

  // 2. Busca a guia e valida
  const { rows: guiaRows } = await tx.query<{
    id: string;
    operadora_id: string;
    live: boolean;
    valor_procedimento: string;
  }>(
    `SELECT id, operadora_id, live, valor_procedimento
       FROM tiss.encounter_guia_consulta WHERE id = $1`,
    [i.guiaId],
  );
  if (guiaRows.length === 0) {
    return err({ kind: 'guia_nao_encontrada' });
  }
  const guia = guiaRows[0]!;
  if (!guia.live) {
    return err({ kind: 'guia_inativa' });
  }
  if (guia.operadora_id !== lote.operadora_id) {
    return err({ kind: 'guia_operadora_divergente' });
  }

  // 3. Verifica se guia ja esta em outro lote
  const { rows: existeRows } = await tx.query<{ lote_id: string }>(
    `SELECT lote_id FROM tiss.lote_guia WHERE guia_id = $1`,
    [i.guiaId],
  );
  if (existeRows.length > 0) {
    return err({ kind: 'guia_ja_em_lote', loteId: existeRows[0]!.lote_id });
  }

  // 4. Calcula proximo sequencial_item
  const { rows: seqRows } = await tx.query<{ max_seq: number | null }>(
    `SELECT MAX(sequencial_item) AS max_seq
       FROM tiss.lote_guia WHERE lote_id = $1`,
    [i.loteId],
  );
  const nextSeq = (seqRows[0]?.max_seq ?? 0) + 1;

  // 5. Insere o vinculo
  await tx.query(
    `INSERT INTO tiss.lote_guia (lote_id, guia_id, sequencial_item)
     VALUES ($1, $2, $3)`,
    [i.loteId, i.guiaId, nextSeq],
  );

  // 6. Atualiza contadores no lote
  // valor_procedimento e numeric(12,2) na guia; convertemos para centavos
  const valorCents = Math.round(Number(guia.valor_procedimento) * 100);
  const newCount = lote.guia_count + 1;
  const newTotal = Number(lote.total_value_cents) + valorCents;

  await tx.query(
    `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
    [i.loteId, newCount, newTotal],
  );

  return ok({
    sequencialItem: nextSeq,
    guiaCount: newCount,
    totalValueCents: newTotal,
  });
}

/**
 * Remove uma guia de um lote em rascunho. Atualiza contadores.
 */
export async function removeGuiaFromLote(
  tx: TxClient,
  i: { loteId: string; guiaId: string },
): Promise<Result<{ guiaCount: number; totalValueCents: number }, RemoveGuiaFailure>> {
  // 1. Busca o lote e valida status
  const { rows: loteRows } = await tx.query<{
    id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (loteRows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = loteRows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'lote_nao_rascunho', status: lote.status });
  }

  // 2. Remove o vinculo e pega o valor da guia
  const { rows: guiaRows } = await tx.query<{ valor_procedimento: string }>(
    `DELETE FROM tiss.lote_guia lg
      USING tiss.encounter_guia_consulta g
      WHERE lg.lote_id = $1 AND lg.guia_id = $2
        AND g.id = lg.guia_id AND g.tenant_id = lg.tenant_id
      RETURNING g.valor_procedimento`,
    [i.loteId, i.guiaId],
  );
  if (guiaRows.length === 0) {
    return err({ kind: 'vinculo_nao_encontrado' });
  }

  // 3. Atualiza contadores
  const valorCents = Math.round(Number(guiaRows[0]!.valor_procedimento) * 100);
  const newCount = lote.guia_count - 1;
  const newTotal = Number(lote.total_value_cents) - valorCents;

  await tx.query(
    `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
    [i.loteId, Math.max(newCount, 0), Math.max(newTotal, 0)],
  );

  return ok({
    guiaCount: Math.max(newCount, 0),
    totalValueCents: Math.max(newTotal, 0),
  });
}
```

- [ ] Criar o teste `packages/tiss/src/lote-guias.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';
import { addGuiaToLote, removeGuiaFromLote } from './lote-guias';

interface SementeGuias {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  operadoraBId: string;
  guiaId: string;
  guiaBId: string;
  guiaInativaId: string;
  guiaOutraOperadoraId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearGuias(): Promise<SementeGuias> {
  const s: SementeGuias = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    operadoraId: uuidv7(), operadoraBId: uuidv7(),
    guiaId: uuidv7(), guiaBId: uuidv7(),
    guiaInativaId: uuidv7(), guiaOutraOperadoraId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Guias', '22ABC33445DE66')`,
      [s.tenantId, `g-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Guias', '2223344', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Guias')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '222333', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Guias', 'completo')`,
      [s.tenantId, s.patientId]);

    // Duas operadoras
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active)
       VALUES ($1, $2, '326305', 'Meridiano Saude', '99XYZ000001DE01', '3.05', true),
              ($1, $3, '111222', 'Outra Operadora', '77XYZ000003DE03', '3.05', true)`,
      [s.tenantId, s.operadoraId, s.operadoraBId]);

    // Encounter para vincular as guias
    const encounterId = uuidv7();
    const encounterBId = uuidv7();
    const encounterCId = uuidv7();
    const encounterDId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T14:00:00Z', DATE '2026-08-01'),
              ($1, $6, $3, $4, $5, TIMESTAMPTZ '2026-08-02T14:00:00Z', DATE '2026-08-02'),
              ($1, $7, $3, $4, $5, TIMESTAMPTZ '2026-08-03T14:00:00Z', DATE '2026-08-03'),
              ($1, $8, $3, $4, $5, TIMESTAMPTZ '2026-08-04T14:00:00Z', DATE '2026-08-04')`,
      [s.tenantId, encounterId, s.patientId, s.professionalId, s.clinicId,
       encounterBId, encounterCId, encounterDId]);

    // Versoes de encounter para FK de encounter_guia_consulta
    const versionId = uuidv7();
    const versionBId = uuidv7();
    const versionCId = uuidv7();
    const versionDId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $9, $10, sha256('v1'::bytea), 'jcs-1'),
              ($1, $4, $5, 1, 'original', $9, $10, sha256('v2'::bytea), 'jcs-1'),
              ($1, $6, $7, 1, 'original', $9, $10, sha256('v3'::bytea), 'jcs-1'),
              ($1, $8, $11, 1, 'original', $9, $10, sha256('v4'::bytea), 'jcs-1')`,
      [s.tenantId, versionId, encounterId, versionBId, encounterBId,
       versionCId, encounterCId, versionDId, encounterDId,
       s.userId, s.professionalId]);

    // Guias: ativa operadora A, ativa operadora A (segunda), inativa, outra operadora
    const guiaCounterId = uuidv7();
    await c.query(
      `INSERT INTO tiss.guia_numero_counter (tenant_id, id, next_value)
       VALUES ($1, $2, 5)
       ON CONFLICT DO NOTHING`,
      [s.tenantId, guiaCounterId]);

    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES
         ($1, $2, $12, $16, $6, '326305', 'G001', '00998877665544', false,
          '900123', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $10),
         ($1, $3, $13, $17, $6, '326305', 'G002', '00998877665544', false,
          '900123', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-02', '1', '22', '10101012', 180.00, true, $10),
         ($1, $4, $14, $18, $6, '326305', 'G003', '00998877665544', false,
          '900123', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-03', '1', '22', '10101012', 300.00, false, $10),
         ($1, $5, $15, $19, $7, '111222', 'G004', '00112233445566', false,
          '800456', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-04', '1', '22', '10101012', 200.00, true, $10)`,
      [s.tenantId, s.guiaId, s.guiaBId, s.guiaInativaId, s.guiaOutraOperadoraId,
       s.operadoraId, s.operadoraBId,
       encounterId, encounterBId, encounterCId, encounterDId,
       s.userId,
       encounterId, encounterBId, encounterCId, encounterDId,
       versionId, versionBId, versionCId, versionDId]);

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

describe('addGuiaToLote e removeGuiaFromLote', () => {
  let s: SementeGuias;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearGuias();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('adiciona guia ativa a lote rascunho e atualiza contadores', async () => {
    // Cria um lote
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    // Adiciona a guia
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sequencialItem).toBe(1);
    expect(result.value.guiaCount).toBe(1);
    expect(result.value.totalValueCents).toBe(25000);
  });

  it('adiciona segunda guia e incrementa sequencial e contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaId }),
    );
    const r2 = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaBId }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.sequencialItem).toBe(2);
    expect(r2.value.guiaCount).toBe(2);
    expect(r2.value.totalValueCents).toBe(43000); // 25000 + 18000
  });

  it('recusa guia inativa (live=false)', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: loteResult.value.loteId, guiaId: s.guiaInativaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_inativa');
  });

  it('recusa guia de operadora diferente da do lote', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: loteResult.value.loteId, guiaId: s.guiaOutraOperadoraId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_operadora_divergente');
  });

  it('recusa guia ja inclusa em outro lote', async () => {
    // Cria dois lotes
    const l1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    const l2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(l1.ok && l2.ok).toBe(true);
    if (!l1.ok || !l2.ok) return;

    // Adiciona guia ao primeiro lote
    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: l1.value.loteId, guiaId: s.guiaId }),
    );

    // Tenta adicionar a mesma guia ao segundo lote
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: l2.value.loteId, guiaId: s.guiaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_ja_em_lote');
  });

  it('remove guia de lote rascunho e atualiza contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaBId }),
    );

    const result = await withTenantTx(actor, (tx) =>
      removeGuiaFromLote(tx, { loteId, guiaId: s.guiaBId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiaCount).toBe(0);
    expect(result.value.totalValueCents).toBe(0);
  });

  it('recusa remocao de guia de lote inexistente', async () => {
    const result = await withTenantTx(actor, (tx) =>
      removeGuiaFromLote(tx, { loteId: uuidv7(), guiaId: s.guiaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_nao_encontrado');
  });
});
```

- [ ] Atualizar `packages/tiss/src/index.ts` adicionando as novas exportacoes:

```typescript
export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
export {
  addGuiaToLote, removeGuiaFromLote,
  type AddGuiaInput, type AddedGuia, type AddGuiaFailure, type RemoveGuiaFailure,
} from './lote-guias';
```

- [ ] Rodar o teste:

```bash
cd packages/tiss && pnpm vitest run src/lote-guias.int.test.ts
```

Saida esperada: 7 testes passando.

---