### Task 37: funcao de dominio createLote — cria lote em status rascunho

**Arquivos**

- Criar `packages/tiss/src/create-lote.ts`
- Criar `packages/tiss/src/create-lote.int.test.ts`
- Modificar `packages/tiss/src/index.ts`
- Modificar `packages/tiss/package.json`

**Passos**

- [ ] Adicionar dependencias ao `packages/tiss/package.json`:

```json
{
  "name": "@cadencia/tiss",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*"
  },
  "devDependencies": {
    "pg": "^8.16.0",
    "vitest": "^3.2.1"
  }
}
```

- [ ] Criar `packages/tiss/src/create-lote.ts`:

```typescript
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type CreateLoteFailure =
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'operadora_inativa' };

export interface CreateLoteInput {
  readonly operadoraId: string;
  readonly createdBy: string;
}

export interface CreatedLote {
  readonly loteId: string;
  readonly numeroLote: string;
  readonly tissVersion: string;
}

/**
 * Cria um lote TISS em status rascunho para a operadora informada.
 * O numero do lote e gerado automaticamente via tiss.next_lote_number(),
 * que se auto-provisiona na primeira chamada. A versao TISS vem do
 * cadastro da operadora (a versao acordada, nao a versao vigente hoje).
 */
export async function createLote(
  tx: TxClient,
  i: CreateLoteInput,
): Promise<Result<CreatedLote, CreateLoteFailure>> {
  // 1. Busca a operadora para pegar tiss_version e validar que existe e esta ativa
  const { rows: opRows } = await tx.query<{
    id: string;
    tiss_version: string;
    active: boolean;
    tenant_id: string;
  }>(
    `SELECT id, tiss_version, active, tenant_id
       FROM tiss.operadora WHERE id = $1`,
    [i.operadoraId],
  );
  if (opRows.length === 0) {
    return err({ kind: 'operadora_nao_encontrada' });
  }
  const op = opRows[0]!;
  if (!op.active) {
    return err({ kind: 'operadora_inativa' });
  }

  // 2. Gera numero sequencial do lote para esta operadora
  const { rows: numRows } = await tx.query<{ n: string }>(
    `SELECT tiss.next_lote_number($1, $2) AS n`,
    [op.tenant_id, i.operadoraId],
  );
  const numeroLote = String(numRows[0]!.n);

  // 3. Insere o lote em status rascunho
  const loteId = uuidv7();
  await tx.query(
    `INSERT INTO tiss.lote
       (id, operadora_id, numero_lote, status, tiss_version,
        guia_count, total_value_cents, created_by)
     VALUES ($1, $2, $3, 'rascunho', $4, 0, 0, $5)`,
    [loteId, i.operadoraId, numeroLote, op.tiss_version, i.createdBy],
  );

  return ok({
    loteId,
    numeroLote,
    tissVersion: op.tiss_version,
  });
}
```

- [ ] Criar o teste `packages/tiss/src/create-lote.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';

interface SementeLote {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  operadoraInativaId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearLote(): Promise<SementeLote> {
  const s: SementeLote = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(), operadoraInativaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Lote', '11ABC22334DE55')`,
      [s.tenantId, `l-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Lote', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Lote')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active)
       VALUES ($1, $2, '326305', 'Meridiano Saude', '99XYZ000001DE01', '3.05', true),
              ($1, $3, '999999', 'Operadora Inativa', '88XYZ000002DE02', '3.05', false)`,
      [s.tenantId, s.operadoraId, s.operadoraInativaId]);
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

describe('createLote', () => {
  let s: SementeLote;

  beforeAll(async () => {
    s = await semearLote();
  });

  afterAll(async () => {
    await closePools();
  });

  it('cria lote em status rascunho com numero sequencial', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.numeroLote).toBe('1');
    expect(result.value.tissVersion).toBe('3.05');
    expect(result.value.loteId).toBeTruthy();
  });

  it('segundo lote da mesma operadora recebe numero sequencial incrementado', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const r1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(Number(r2.value.numeroLote)).toBe(Number(r1.value.numeroLote) + 1);
  });

  it('recusa operadora inexistente', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: uuidv7(), createdBy: s.userId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('operadora_nao_encontrada');
  });

  it('recusa operadora inativa', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraInativaId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('operadora_inativa');
  });
});
```

- [ ] Atualizar `packages/tiss/src/index.ts`:

```typescript
export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
```

- [ ] Rodar o teste:

```bash
cd packages/tiss && pnpm vitest run src/create-lote.int.test.ts
```

Saida esperada: 4 testes passando.

---