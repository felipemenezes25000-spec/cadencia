### Task 5: CRUD de operadora no packages/tiss

**Arquivos**
- Criar: `packages/tiss/src/operadora.ts`
- Criar: `packages/tiss/src/operadora.int.test.ts`
- Modificar: `packages/tiss/src/index.ts`
- Modificar: `packages/tiss/package.json`

**Passos**

- [ ] Adicionar as dependencias no `packages/tiss/package.json`:

```json
{
  "name": "@cadencia/tiss",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*",
    "@cadencia/db": "workspace:*"
  },
  "devDependencies": {
    "pg": "^8.16.0",
    "vitest": "^3.2.1"
  }
}
```

- [ ] Escrever o teste que falha em `packages/tiss/src/operadora.int.test.ts`:

```typescript
// packages/tiss/src/operadora.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createOperadora, updateOperadora, deactivateOperadora, listOperadoras,
  type CreateOperadoraInput,
} from './operadora';

interface Semente {
  tenantId: string; clinicId: string; userId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss Operadora', '77ABC88901DE55')`,
      [s.tenantId, `to-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss', '7777777', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Tiss')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semear();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createOperadora — cria operadora de convenio', () => {
  it('cria operadora com todos os campos obrigatorios', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '326305',
      razaoSocial: 'Operadora Meridiano Saude Ltda',
      nomeFantasia: 'Meridiano Saude',
      cnpj: '11ABC22233DE44',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.registroAns).toBe('326305');
    expect(r.value.razaoSocial).toBe('Operadora Meridiano Saude Ltda');
    expect(r.value.cnpj).toBe('11ABC22233DE44');
    expect(r.value.active).toBe(true);
  });

  it('recusa registro ANS duplicado no mesmo tenant', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '326305',
      razaoSocial: 'Outra Operadora',
      cnpj: '99XYZ00011DE22',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('registro_ans_duplicado');
  });

  it('recusa CNPJ com formato invalido', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '999999',
      razaoSocial: 'Operadora Invalida',
      cnpj: '12345678901234',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('cnpj_invalido');
  });

  it('recusa registro ANS com formato invalido', async () => {
    const input: CreateOperadoraInput = {
      registroAns: 'ABCDEF',
      razaoSocial: 'Operadora ANS Invalida',
      cnpj: '33ABC44455DE66',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('registro_ans_invalido');
  });
});

describe('updateOperadora — atualiza operadora', () => {
  let operadoraId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, {
        registroAns: '111111',
        razaoSocial: 'Para Atualizar',
        cnpj: '44ABC55566DE77',
      }, s.userId));
    if (r.ok) operadoraId = r.value.id;
  });

  it('atualiza nome fantasia e telefone', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateOperadora(tx, {
        id: operadoraId,
        nomeFantasia: 'Novo Nome Fantasia',
        telefone: '11999998888',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nomeFantasia).toBe('Novo Nome Fantasia');
    expect(r.value.telefone).toBe('11999998888');
  });

  it('retorna erro para operadora inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateOperadora(tx, { id: uuidv7(), razaoSocial: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('operadora_nao_encontrada');
  });
});

describe('deactivateOperadora — desativa operadora', () => {
  let operadoraId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, {
        registroAns: '222222',
        razaoSocial: 'Para Desativar',
        cnpj: '55ABC66677DE88',
      }, s.userId));
    if (r.ok) operadoraId = r.value.id;
  });

  it('desativa operadora ativa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateOperadora(tx, operadoraId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar operadora ja desativada', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateOperadora(tx, operadoraId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativada');
  });
});

describe('listOperadoras — lista operadoras do tenant', () => {
  it('lista somente ativas por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listOperadoras(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });

  it('lista todas incluindo desativadas', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listOperadoras(tx, false));
    const inativos = lista.filter((a) => !a.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo `./operadora` nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/operadora.int.test.ts 2>&1 | head -30
```

Saida esperada: erro de importacao — modulo `./operadora` nao encontrado.

- [ ] Implementar `packages/tiss/src/operadora.ts`:

```typescript
// packages/tiss/src/operadora.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type OperadoraFailure =
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'registro_ans_duplicado' }
  | { kind: 'registro_ans_invalido' }
  | { kind: 'cnpj_invalido' }
  | { kind: 'ja_desativada' };

export interface CreateOperadoraInput {
  readonly registroAns: string;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string;
  readonly cnpj: string;
  readonly telefone?: string;
  readonly email?: string;
  readonly portalUrl?: string;
  readonly portalLogin?: string;
  readonly portalObs?: string;
}

export interface OperadoraRow {
  readonly id: string;
  readonly registroAns: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly cnpj: string;
  readonly telefone: string | null;
  readonly email: string | null;
  readonly portalUrl: string | null;
  readonly portalLogin: string | null;
  readonly portalObs: string | null;
  readonly active: boolean;
}

export interface UpdateOperadoraInput {
  readonly id: string;
  readonly razaoSocial?: string;
  readonly nomeFantasia?: string | null;
  readonly telefone?: string | null;
  readonly email?: string | null;
  readonly portalUrl?: string | null;
  readonly portalLogin?: string | null;
  readonly portalObs?: string | null;
}

// ---------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------

const ANS_RE = /^[0-9]{6}$/;
const CNPJ_RE = /^[A-Z0-9]{12}[0-9]{2}$/;

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export async function createOperadora(
  tx: TxClient,
  i: CreateOperadoraInput,
  createdBy: string,
): Promise<Result<OperadoraRow, OperadoraFailure>> {
  if (!ANS_RE.test(i.registroAns)) {
    return err({ kind: 'registro_ans_invalido' });
  }
  if (!CNPJ_RE.test(i.cnpj)) {
    return err({ kind: 'cnpj_invalido' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, nome_fantasia, cnpj,
          telefone, email, portal_url, portal_login, portal_obs, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11)`,
      [id, i.registroAns, i.razaoSocial, i.nomeFantasia ?? null, i.cnpj,
       i.telefone ?? null, i.email ?? null, i.portalUrl ?? null,
       i.portalLogin ?? null, i.portalObs ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('registro_ans')) {
      return err({ kind: 'registro_ans_duplicado' });
    }
    throw e;
  }

  return ok({
    id, registroAns: i.registroAns,
    razaoSocial: i.razaoSocial,
    nomeFantasia: i.nomeFantasia ?? null,
    cnpj: i.cnpj,
    telefone: i.telefone ?? null,
    email: i.email ?? null,
    portalUrl: i.portalUrl ?? null,
    portalLogin: i.portalLogin ?? null,
    portalObs: i.portalObs ?? null,
    active: true,
  });
}

export async function updateOperadora(
  tx: TxClient,
  i: UpdateOperadoraInput,
): Promise<Result<OperadoraRow, OperadoraFailure>> {
  const { rows } = await tx.query<{
    id: string; registro_ans: string; razao_social: string;
    nome_fantasia: string | null; cnpj: string;
    telefone: string | null; email: string | null;
    portal_url: string | null; portal_login: string | null;
    portal_obs: string | null; active: boolean;
  }>(
    `SELECT id::text, registro_ans, razao_social, nome_fantasia, cnpj,
            telefone, email, portal_url, portal_login, portal_obs, active
       FROM tiss.operadora WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'operadora_nao_encontrada' });

  const razaoSocial = i.razaoSocial ?? existing.razao_social;
  const nomeFantasia = i.nomeFantasia !== undefined ? i.nomeFantasia : existing.nome_fantasia;
  const telefone = i.telefone !== undefined ? i.telefone : existing.telefone;
  const email = i.email !== undefined ? i.email : existing.email;
  const portalUrl = i.portalUrl !== undefined ? i.portalUrl : existing.portal_url;
  const portalLogin = i.portalLogin !== undefined ? i.portalLogin : existing.portal_login;
  const portalObs = i.portalObs !== undefined ? i.portalObs : existing.portal_obs;

  await tx.query(
    `UPDATE tiss.operadora
        SET razao_social = $2, nome_fantasia = $3,
            telefone = $4, email = $5, portal_url = $6,
            portal_login = $7, portal_obs = $8
      WHERE id = $1`,
    [i.id, razaoSocial, nomeFantasia, telefone, email,
     portalUrl, portalLogin, portalObs]);

  return ok({
    id: existing.id, registroAns: existing.registro_ans,
    razaoSocial, nomeFantasia, cnpj: existing.cnpj,
    telefone, email, portalUrl, portalLogin, portalObs,
    active: existing.active,
  });
}

export async function deactivateOperadora(
  tx: TxClient,
  operadoraId: string,
): Promise<Result<{ id: string }, OperadoraFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.operadora WHERE id = $1`, [operadoraId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'operadora_nao_encontrada' });
  if (!existing.active) return err({ kind: 'ja_desativada' });

  await tx.query(
    `UPDATE tiss.operadora SET active = false WHERE id = $1`,
    [operadoraId]);

  return ok({ id: operadoraId });
}

export async function listOperadoras(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<OperadoraRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; registro_ans: string; razao_social: string;
    nome_fantasia: string | null; cnpj: string;
    telefone: string | null; email: string | null;
    portal_url: string | null; portal_login: string | null;
    portal_obs: string | null; active: boolean;
  }>(
    `SELECT id::text, registro_ans, razao_social, nome_fantasia, cnpj,
            telefone, email, portal_url, portal_login, portal_obs, active
       FROM tiss.operadora
      WHERE 1=1 ${whereActive}
      ORDER BY razao_social COLLATE "pt-BR-x-icu"`);
  return rows.map((r) => ({
    id: r.id, registroAns: r.registro_ans,
    razaoSocial: r.razao_social,
    nomeFantasia: r.nome_fantasia,
    cnpj: r.cnpj,
    telefone: r.telefone, email: r.email,
    portalUrl: r.portal_url, portalLogin: r.portal_login,
    portalObs: r.portal_obs,
    active: r.active,
  }));
}
```

- [ ] Atualizar `packages/tiss/src/index.ts` para exportar o modulo:

```typescript
export {
  createOperadora,
  updateOperadora,
  deactivateOperadora,
  listOperadoras,
  type CreateOperadoraInput,
  type UpdateOperadoraInput,
  type OperadoraRow,
  type OperadoraFailure,
} from './operadora';
```

- [ ] Rodar o teste e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/operadora.int.test.ts
```

Saida esperada: todos os testes de operadora passam.

- [ ] Commitar:

```
feat(tiss): add operadora CRUD with integration tests
```

---